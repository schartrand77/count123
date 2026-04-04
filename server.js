const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 80);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const SESSION_COOKIE_NAME = "count123_sid";
const SESSION_TTL_MS = 60 * 60 * 1000;
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
const FORCE_HTTPS = process.env.FORCE_HTTPS === "true";
const ALLOW_INSECURE_BANK_URLS = process.env.ALLOW_INSECURE_BANK_URLS === "true";
const APP_ORIGIN = (process.env.APP_ORIGIN || "").trim();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const DEFAULT_ACCOUNTS = [
  { code: "1000", name: "Cash", type: "asset" },
  { code: "1100", name: "Accounts Receivable", type: "asset" },
  { code: "1150", name: "GST/HST Recoverable", type: "asset" },
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "2100", name: "GST/HST Payable", type: "liability" },
  { code: "3000", name: "Owner Equity", type: "equity" },
  { code: "4000", name: "Service Revenue", type: "revenue" },
  { code: "6100", name: "Operating Expense", type: "expense" },
];

const sessions = new Map();
const loginAttempts = new Map();

function now() {
  return Date.now();
}

function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(defaultStore(), null, 2));
  }
}

function defaultStore() {
  return {
    company: {
      name: "Count123",
      currency: "CAD",
      taxName: "GST/HST",
      defaultTaxRate: 0.13,
    },
    counters: {
      client: 0,
      vendor: 0,
      account: 0,
      invoice: 1000,
      bill: 800,
      purchaseOrder: 500,
      journal: 0,
      bankTransaction: 0,
    },
    clients: [],
    vendors: [],
    accounts: DEFAULT_ACCOUNTS.map((account) => ({
      id: `acct_${account.code}`,
      ...account,
      system: true,
    })),
    invoices: [],
    bills: [],
    purchaseOrders: [],
    journalEntries: [],
    recurringTemplates: [],
    bankAccounts: [],
    bankTransactions: [],
    closeChecklist: [
      { id: "close_bank", label: "Review bank balances and cash movements", done: false },
      { id: "close_receivables", label: "Confirm open invoices and customer collections", done: false },
      { id: "close_payables", label: "Review supplier bills and scheduled payments", done: false },
      { id: "close_tax", label: "Validate GST/HST balances and remittance position", done: false },
      { id: "close_reports", label: "Review P&L and balance sheet before close", done: false },
    ],
  };
}

function defaultCloseChecklist() {
  return defaultStore().closeChecklist.map((item) => ({ ...item }));
}

function normalizeStore(store) {
  const normalized = store && typeof store === "object" ? store : {};

  normalized.company = {
    ...defaultStore().company,
    ...(normalized.company || {}),
  };

  normalized.counters = {
    ...defaultStore().counters,
    ...(normalized.counters || {}),
  };

  normalized.clients = Array.isArray(normalized.clients) ? normalized.clients : [];
  normalized.vendors = Array.isArray(normalized.vendors) ? normalized.vendors : [];
  normalized.accounts = Array.isArray(normalized.accounts) ? normalized.accounts : [];
  normalized.invoices = Array.isArray(normalized.invoices) ? normalized.invoices : [];
  normalized.bills = Array.isArray(normalized.bills) ? normalized.bills : [];
  normalized.purchaseOrders = Array.isArray(normalized.purchaseOrders)
    ? normalized.purchaseOrders
    : [];
  normalized.journalEntries = Array.isArray(normalized.journalEntries)
    ? normalized.journalEntries
    : [];
  normalized.recurringTemplates = Array.isArray(normalized.recurringTemplates)
    ? normalized.recurringTemplates
    : [];
  normalized.bankAccounts = Array.isArray(normalized.bankAccounts) ? normalized.bankAccounts : [];
  normalized.bankTransactions = Array.isArray(normalized.bankTransactions)
    ? normalized.bankTransactions
    : [];
  normalized.closeChecklist = Array.isArray(normalized.closeChecklist)
    ? normalized.closeChecklist
    : defaultCloseChecklist();

  normalized.invoices = normalized.invoices.map((invoice) => ({
    paymentHistory: [],
    notes: "",
    status: "sent",
    ...invoice,
    paymentHistory: Array.isArray(invoice.paymentHistory) ? invoice.paymentHistory : [],
  }));

  normalized.bills = normalized.bills.map((bill) => ({
    paymentHistory: [],
    notes: "",
    status: "open",
    ...bill,
    paymentHistory: Array.isArray(bill.paymentHistory) ? bill.paymentHistory : [],
  }));

  normalized.purchaseOrders = normalized.purchaseOrders.map((order) => ({
    notes: "",
    status: "draft",
    convertedBillId: null,
    ...order,
  }));

  normalized.closeChecklist = defaultCloseChecklist().map((defaultItem) => {
    const existing = normalized.closeChecklist.find((item) => item.id === defaultItem.id);
    return {
      ...defaultItem,
      ...(existing || {}),
    };
  });

  normalized.bankTransactions = normalized.bankTransactions.map((transaction) => ({
    status: "unmatched",
    notes: "",
    matchType: null,
    matchId: null,
    matchLabel: null,
    matchedAt: null,
    source: "manual",
    ...transaction,
  }));

  return normalized;
}

function readStore() {
  ensureDataStore();
  const raw = fs.readFileSync(STORE_FILE, "utf8");
  const store = normalizeStore(JSON.parse(raw));

  for (const account of DEFAULT_ACCOUNTS) {
    if (!store.accounts.some((existing) => existing.code === account.code)) {
      store.accounts.push({
        id: `acct_${account.code}`,
        ...account,
        system: true,
      });
    }
  }

  return store;
}

function writeStore(store) {
  ensureDataStore();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function nextCounter(store, key) {
  store.counters[key] = Number(store.counters[key] || 0) + 1;
  return store.counters[key];
}

function formatSequence(prefix, value) {
  return `${prefix}-${String(value).padStart(4, "0")}`;
}

function toCurrencyAmount(value) {
  const numeric = Number(value || 0);
  return Math.round(numeric * 100) / 100;
}

function accountSign(type) {
  return type === "asset" || type === "expense" ? 1 : -1;
}

function getAccountMap(store) {
  return new Map(store.accounts.map((account) => [account.code, account]));
}

function computeAccountBalances(store) {
  const accountMap = getAccountMap(store);
  const balances = new Map(store.accounts.map((account) => [account.code, 0]));

  for (const entry of store.journalEntries) {
    for (const line of entry.lines) {
      const account = accountMap.get(line.accountCode);

      if (!account) {
        continue;
      }

      const effect =
        accountSign(account.type) *
        (toCurrencyAmount(line.debit) - toCurrencyAmount(line.credit));

      balances.set(account.code, toCurrencyAmount((balances.get(account.code) || 0) + effect));
    }
  }

  return balances;
}

function findAccount(store, code) {
  return store.accounts.find((account) => account.code === code);
}

function requireAccount(store, code) {
  const account = findAccount(store, code);

  if (!account) {
    throw new Error(`Unknown account code: ${code}`);
  }

  return account;
}

function sumOutstanding(records) {
  return toCurrencyAmount(
    records.reduce((total, record) => total + Number(record.balanceDue || 0), 0)
  );
}

function buildReports(store, balances) {
  const revenue = store.accounts
    .filter((account) => account.type === "revenue")
    .reduce((sum, account) => sum + (balances.get(account.code) || 0), 0);

  const expenses = store.accounts
    .filter((account) => account.type === "expense")
    .reduce((sum, account) => sum + (balances.get(account.code) || 0), 0);

  const assets = store.accounts
    .filter((account) => account.type === "asset")
    .reduce((sum, account) => sum + (balances.get(account.code) || 0), 0);

  const liabilities = store.accounts
    .filter((account) => account.type === "liability")
    .reduce((sum, account) => sum + (balances.get(account.code) || 0), 0);

  return {
    profitAndLoss: {
      revenue: toCurrencyAmount(revenue),
      expenses: toCurrencyAmount(expenses),
      netIncome: toCurrencyAmount(revenue - expenses),
    },
    balanceSheet: {
      assets: toCurrencyAmount(assets),
      liabilities: toCurrencyAmount(liabilities),
      equity: toCurrencyAmount(assets - liabilities),
    },
  };
}

function buildTaxSummary(store) {
  const collected = store.invoices.reduce(
    (sum, invoice) => sum + Number(invoice.taxAmount || 0),
    0
  );
  const recoverable = store.bills.reduce(
    (sum, bill) => sum + Number(bill.taxAmount || 0),
    0
  );

  return {
    collected: toCurrencyAmount(collected),
    recoverable: toCurrencyAmount(recoverable),
    netRemittance: toCurrencyAmount(collected - recoverable),
  };
}

function buildSummary(store, balances) {
  const reports = buildReports(store, balances);
  const openInvoices = store.invoices.filter((invoice) => invoice.status !== "paid");
  const openBills = store.bills.filter((bill) => bill.status !== "paid");

  return {
    cash: toCurrencyAmount(balances.get("1000") || 0),
    openInvoices: sumOutstanding(openInvoices),
    payablesDue: sumOutstanding(openBills),
    netIncome: reports.profitAndLoss.netIncome,
    taxPayable: buildTaxSummary(store).netRemittance,
  };
}

function buildCashflowTimeline(store) {
  const periods = new Map();

  for (const transaction of store.bankTransactions || []) {
    if (!transaction.postedDate || transaction.status === "ignored") {
      continue;
    }

    const period = String(transaction.postedDate).slice(0, 7);
    const amount = toCurrencyAmount(transaction.amount);
    const current = periods.get(period) || { period, inflow: 0, outflow: 0, net: 0 };

    if (amount >= 0) {
      current.inflow = toCurrencyAmount(current.inflow + amount);
    } else {
      current.outflow = toCurrencyAmount(current.outflow + Math.abs(amount));
    }

    current.net = toCurrencyAmount(current.inflow - current.outflow);
    periods.set(period, current);
  }

  return [...periods.values()].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 6);
}

function findBestBankSuggestion(store, transaction) {
  const absoluteAmount = toCurrencyAmount(Math.abs(transaction.amount || 0));
  const description = String(transaction.description || "").toLowerCase();
  const candidates = [];

  for (const invoice of store.invoices.filter((item) => item.balanceDue > 0)) {
    let score = 0;
    if (toCurrencyAmount(invoice.balanceDue) === absoluteAmount) score += 3;
    if (description.includes(String(invoice.number || "").toLowerCase())) score += 3;
    if (description.includes(String(invoice.clientName || "").toLowerCase())) score += 2;
    if (transaction.amount > 0 && score > 0) {
      candidates.push({
        score,
        targetType: "invoice",
        targetId: invoice.id,
        label: `${invoice.number} | ${invoice.clientName}`,
      });
    }
  }

  for (const bill of store.bills.filter((item) => item.balanceDue > 0)) {
    let score = 0;
    if (toCurrencyAmount(bill.balanceDue) === absoluteAmount) score += 3;
    if (description.includes(String(bill.number || "").toLowerCase())) score += 3;
    if (description.includes(String(bill.vendorName || "").toLowerCase())) score += 2;
    if (transaction.amount < 0 && score > 0) {
      candidates.push({
        score,
        targetType: "bill",
        targetId: bill.id,
        label: `${bill.number} | ${bill.vendorName}`,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return candidates[0] || null;
}

function buildBankingPayload(store) {
  const transactions = [...(store.bankTransactions || [])]
    .sort((a, b) => {
      const dateCompare = String(b.postedDate || "").localeCompare(String(a.postedDate || ""));
      return dateCompare || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    })
    .map((transaction) => ({
      ...transaction,
      suggestion: transaction.status === "unmatched" ? findBestBankSuggestion(store, transaction) : null,
    }));

  const unmatched = transactions.filter((item) => item.status === "unmatched");
  const matched = transactions.filter((item) => item.status === "matched");
  const ignored = transactions.filter((item) => item.status === "ignored");
  const suggested = unmatched.filter((item) => item.suggestion);

  return {
    accounts: [...(store.bankAccounts || [])].sort((a, b) => a.name.localeCompare(b.name)),
    transactions,
    reconciliation: {
      unmatchedCount: unmatched.length,
      matchedCount: matched.length,
      ignoredCount: ignored.length,
      suggestedCount: suggested.length,
      unmatchedAmount: toCurrencyAmount(
        unmatched.reduce((sum, item) => sum + Math.abs(Number(item.amount || 0)), 0)
      ),
    },
    timeline: buildCashflowTimeline(store),
    exceptionQueue: unmatched,
  };
}

function buildBootstrapPayload(store, session) {
  const balances = computeAccountBalances(store);
  const reports = buildReports(store, balances);
  const tax = buildTaxSummary(store);

  return {
    company: store.company,
    admin: {
      username: session.adminUsername,
      email: session.adminEmail,
    },
    summary: buildSummary(store, balances),
    clients: [...store.clients].sort((a, b) => a.name.localeCompare(b.name)),
    vendors: [...store.vendors].sort((a, b) => a.name.localeCompare(b.name)),
    accounts: store.accounts
      .map((account) => ({
        ...account,
        balance: toCurrencyAmount(balances.get(account.code) || 0),
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    invoices: [...store.invoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    bills: [...store.bills].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    purchaseOrders: [...store.purchaseOrders].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    ),
    journalEntries: [...store.journalEntries].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    ),
    recurringTemplates: [...(store.recurringTemplates || [])].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    ),
    banking: buildBankingPayload(store),
    closeChecklist: [...(store.closeChecklist || [])],
    reports,
    tax,
  };
}

function recordJournalEntry(store, entry) {
  const journalNumber = nextCounter(store, "journal");
  const totalDebit = entry.lines.reduce(
    (sum, line) => sum + Number(line.debit || 0),
    0
  );
  const totalCredit = entry.lines.reduce(
    (sum, line) => sum + Number(line.credit || 0),
    0
  );

  if (toCurrencyAmount(totalDebit) !== toCurrencyAmount(totalCredit)) {
    throw new Error("Journal entry is not balanced.");
  }

  entry.lines.forEach((line) => requireAccount(store, line.accountCode));

  const record = {
    id: `je_${journalNumber}`,
    reference: formatSequence("JE", journalNumber),
    date: entry.date,
    memo: entry.memo,
    sourceType: entry.sourceType || "manual",
    sourceId: entry.sourceId || null,
    createdAt: new Date().toISOString(),
    lines: entry.lines.map((line) => ({
      accountCode: line.accountCode,
      debit: toCurrencyAmount(line.debit || 0),
      credit: toCurrencyAmount(line.credit || 0),
      memo: line.memo || "",
    })),
  };

  store.journalEntries.push(record);
  return record;
}

function createInvoice(store, payload) {
  const client = store.clients.find((item) => item.id === payload.clientId);

  if (!client) {
    throw new Error("Client is required.");
  }

  const subtotal = toCurrencyAmount(payload.subtotal);
  const taxRate = Number(payload.taxRate ?? store.company.defaultTaxRate);
  const taxAmount = toCurrencyAmount(subtotal * taxRate);
  const total = toCurrencyAmount(subtotal + taxAmount);
  const sequence = nextCounter(store, "invoice");
  const invoice = {
    id: `invoice_${sequence}`,
    number: formatSequence("INV", sequence),
    clientId: client.id,
    clientName: client.name,
    description: String(payload.description || "").trim(),
    issueDate: payload.issueDate,
    dueDate: payload.dueDate,
    subtotal,
    taxRate,
    taxAmount,
    total,
    balanceDue: total,
    status: String(payload.status || "sent"),
    notes: String(payload.notes || "").trim(),
    paymentHistory: [],
    createdAt: new Date().toISOString(),
    paidAt: null,
  };

  recordJournalEntry(store, {
    date: invoice.issueDate,
    memo: `Invoice ${invoice.number} for ${client.name}`,
    sourceType: "invoice",
    sourceId: invoice.id,
    lines: [
      { accountCode: "1100", debit: total, credit: 0, memo: invoice.number },
      { accountCode: "4000", debit: 0, credit: subtotal, memo: invoice.number },
      { accountCode: "2100", debit: 0, credit: taxAmount, memo: invoice.number },
    ],
  });

  store.invoices.push(invoice);
  return invoice;
}

function payInvoice(store, invoiceId, payload) {
  const invoice = store.invoices.find((item) => item.id === invoiceId);

  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  if (invoice.status === "paid" || invoice.balanceDue <= 0) {
    throw new Error("Invoice is already paid.");
  }

  const amount = toCurrencyAmount(payload.amount || invoice.balanceDue);

  if (amount <= 0 || amount > invoice.balanceDue) {
    throw new Error("Invalid payment amount.");
  }

  recordJournalEntry(store, {
    date: payload.paymentDate,
    memo: `Payment received for ${invoice.number}`,
    sourceType: "invoice_payment",
    sourceId: invoice.id,
    lines: [
      { accountCode: "1000", debit: amount, credit: 0, memo: invoice.number },
      { accountCode: "1100", debit: 0, credit: amount, memo: invoice.number },
    ],
  });

  invoice.paymentHistory.push({
    id: `invoice_payment_${invoice.paymentHistory.length + 1}`,
    amount,
    paymentDate: payload.paymentDate,
    createdAt: new Date().toISOString(),
  });
  invoice.balanceDue = toCurrencyAmount(invoice.balanceDue - amount);
  invoice.status = invoice.balanceDue <= 0 ? "paid" : "partial";
  invoice.paidAt = payload.paymentDate;
  return invoice;
}

function createBill(store, payload) {
  const vendor = store.vendors.find((item) => item.id === payload.vendorId);

  if (!vendor) {
    throw new Error("Vendor is required.");
  }

  const subtotal = toCurrencyAmount(payload.subtotal);
  const taxRate = Number(payload.taxRate ?? store.company.defaultTaxRate);
  const taxAmount = toCurrencyAmount(subtotal * taxRate);
  const total = toCurrencyAmount(subtotal + taxAmount);
  const expenseAccountCode = payload.expenseAccountCode || "6100";
  const sequence = nextCounter(store, "bill");
  const bill = {
    id: `bill_${sequence}`,
    number: formatSequence("BILL", sequence),
    vendorId: vendor.id,
    vendorName: vendor.name,
    description: String(payload.description || "").trim(),
    issueDate: payload.issueDate,
    dueDate: payload.dueDate,
    expenseAccountCode,
    subtotal,
    taxRate,
    taxAmount,
    total,
    balanceDue: total,
    status: String(payload.status || "open"),
    notes: String(payload.notes || "").trim(),
    paymentHistory: [],
    createdAt: new Date().toISOString(),
    paidAt: null,
  };

  requireAccount(store, expenseAccountCode);

  recordJournalEntry(store, {
    date: bill.issueDate,
    memo: `Supplier bill ${bill.number} from ${vendor.name}`,
    sourceType: "bill",
    sourceId: bill.id,
    lines: [
      { accountCode: expenseAccountCode, debit: subtotal, credit: 0, memo: bill.number },
      { accountCode: "1150", debit: taxAmount, credit: 0, memo: bill.number },
      { accountCode: "2000", debit: 0, credit: total, memo: bill.number },
    ],
  });

  store.bills.push(bill);
  return bill;
}

function payBill(store, billId, payload) {
  const bill = store.bills.find((item) => item.id === billId);

  if (!bill) {
    throw new Error("Bill not found.");
  }

  if (bill.status === "paid" || bill.balanceDue <= 0) {
    throw new Error("Bill is already paid.");
  }

  const amount = toCurrencyAmount(payload.amount || bill.balanceDue);

  if (amount <= 0 || amount > bill.balanceDue) {
    throw new Error("Invalid payment amount.");
  }

  recordJournalEntry(store, {
    date: payload.paymentDate,
    memo: `Payment sent for ${bill.number}`,
    sourceType: "bill_payment",
    sourceId: bill.id,
    lines: [
      { accountCode: "2000", debit: amount, credit: 0, memo: bill.number },
      { accountCode: "1000", debit: 0, credit: amount, memo: bill.number },
    ],
  });

  bill.paymentHistory.push({
    id: `bill_payment_${bill.paymentHistory.length + 1}`,
    amount,
    paymentDate: payload.paymentDate,
    createdAt: new Date().toISOString(),
  });
  bill.balanceDue = toCurrencyAmount(bill.balanceDue - amount);
  bill.status = bill.balanceDue <= 0 ? "paid" : "partial";
  bill.paidAt = payload.paymentDate;
  return bill;
}

function createPurchaseOrder(store, payload) {
  const vendor = store.vendors.find((item) => item.id === payload.vendorId);

  if (!vendor) {
    throw new Error("Vendor is required.");
  }

  const sequence = nextCounter(store, "purchaseOrder");
  const order = {
    id: `po_${sequence}`,
    number: formatSequence("PO", sequence),
    vendorId: vendor.id,
    vendorName: vendor.name,
    description: String(payload.description || "").trim(),
    amount: toCurrencyAmount(payload.amount),
    expectedDate: payload.expectedDate,
    status: String(payload.status || "draft"),
    notes: String(payload.notes || "").trim(),
    createdAt: new Date().toISOString(),
    convertedBillId: null,
  };

  store.purchaseOrders.push(order);
  return order;
}

function convertPurchaseOrderToBill(store, orderId, payload) {
  const order = store.purchaseOrders.find((item) => item.id === orderId);

  if (!order) {
    throw new Error("Purchase order not found.");
  }

  if (order.status === "billed") {
    throw new Error("Purchase order has already been converted.");
  }

  const bill = createBill(store, {
    vendorId: order.vendorId,
    description: payload.description || order.description,
    issueDate: payload.issueDate,
    dueDate: payload.dueDate,
    subtotal: payload.subtotal || order.amount,
    taxRate: payload.taxRate,
    expenseAccountCode: payload.expenseAccountCode,
  });

  order.status = "billed";
  order.convertedBillId = bill.id;
  return bill;
}

function createManualJournal(store, payload) {
  return recordJournalEntry(store, {
    date: payload.date,
    memo: String(payload.memo || "").trim(),
    sourceType: "manual",
    lines: [
      {
        accountCode: payload.debitAccountCode,
        debit: toCurrencyAmount(payload.amount),
        credit: 0,
        memo: payload.memo,
      },
      {
        accountCode: payload.creditAccountCode,
        debit: 0,
        credit: toCurrencyAmount(payload.amount),
        memo: payload.memo,
      },
    ],
  });
}

function updateRecordWorkflow(record, payload) {
  if (payload.status) {
    record.status = String(payload.status).trim().toLowerCase();
  }

  if (Object.prototype.hasOwnProperty.call(payload, "notes")) {
    record.notes = String(payload.notes || "").trim();
  }

  record.updatedAt = new Date().toISOString();
  return record;
}

function createRecurringTemplate(store, payload) {
  const type = String(payload.type || "").trim().toLowerCase();

  if (!["invoice", "bill"].includes(type)) {
    throw new Error("Recurring template type must be invoice or bill.");
  }

  const template = {
    id: `recurring_${store.recurringTemplates.length + 1}`,
    type,
    label: String(payload.label || "").trim(),
    clientId: payload.clientId || null,
    vendorId: payload.vendorId || null,
    description: String(payload.description || "").trim(),
    subtotal: toCurrencyAmount(payload.subtotal),
    taxRate: Number(payload.taxRate ?? store.company.defaultTaxRate),
    expenseAccountCode: payload.expenseAccountCode || "6100",
    interval: String(payload.interval || "monthly").trim().toLowerCase(),
    nextDate: payload.nextDate,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    active: true,
  };

  if (!template.label || !template.description || !template.nextDate) {
    throw new Error("Recurring template label, description, and next date are required.");
  }

  if (type === "invoice" && !template.clientId) {
    throw new Error("Recurring invoice requires a client.");
  }

  if (type === "bill" && !template.vendorId) {
    throw new Error("Recurring bill requires a vendor.");
  }

  store.recurringTemplates.push(template);
  return template;
}

function runRecurringTemplate(store, templateId, payload) {
  const template = store.recurringTemplates.find((item) => item.id === templateId);

  if (!template) {
    throw new Error("Recurring template not found.");
  }

  if (!template.active) {
    throw new Error("Recurring template is inactive.");
  }

  const runDate = payload.runDate || template.nextDate;
  let result;

  if (template.type === "invoice") {
    result = createInvoice(store, {
      clientId: template.clientId,
      description: template.description,
      subtotal: template.subtotal,
      taxRate: template.taxRate,
      issueDate: runDate,
      dueDate: payload.dueDate || runDate,
      notes: `Generated from ${template.label}`,
      status: "sent",
    });
  } else {
    result = createBill(store, {
      vendorId: template.vendorId,
      description: template.description,
      subtotal: template.subtotal,
      taxRate: template.taxRate,
      expenseAccountCode: template.expenseAccountCode,
      issueDate: runDate,
      dueDate: payload.dueDate || runDate,
      notes: `Generated from ${template.label}`,
      status: "open",
    });
  }

  template.lastRunAt = new Date().toISOString();
  template.nextDate = payload.nextDate || template.nextDate;
  return result;
}

function toggleChecklistItem(store, itemId) {
  const item = (store.closeChecklist || []).find((entry) => entry.id === itemId);

  if (!item) {
    throw new Error("Checklist item not found.");
  }

  item.done = !item.done;
  item.updatedAt = new Date().toISOString();
  return item;
}

function persistBankAccounts(store, accounts, source) {
  const mappedAccounts = (accounts || []).map((account, index) => ({
    id: String(account.id || account.maskedId || `bank_account_${index + 1}`),
    maskedId: String(account.id || account.maskedId || ""),
    name: String(account.name || "Business account"),
    type: String(account.type || "Business account"),
    balance: account.balance == null ? null : toCurrencyAmount(account.balance),
    availableBalance:
      account.availableBalance == null ? null : toCurrencyAmount(account.availableBalance),
    currency: String(account.currency || store.company.currency || "CAD"),
    source: source || "RBC",
    lastSyncedAt: new Date().toISOString(),
  }));

  store.bankAccounts = mappedAccounts;
  return store.bankAccounts;
}

function createBankTransaction(store, payload) {
  const amount = toCurrencyAmount(payload.amount);
  const sequence = nextCounter(store, "bankTransaction");
  const accountName = String(payload.accountName || "").trim();
  const description = String(payload.description || "").trim();
  const postedDate = String(payload.postedDate || "").trim();

  if (!accountName || !description || !postedDate || !amount) {
    throw new Error("Account name, posted date, description, and non-zero amount are required.");
  }

  const transaction = {
    id: `bank_tx_${sequence}`,
    externalId: payload.externalId ? String(payload.externalId) : null,
    accountId: String(payload.accountId || accountName),
    accountName,
    postedDate,
    description,
    amount,
    currency: String(payload.currency || store.company.currency || "CAD"),
    source: String(payload.source || "manual"),
    status: "unmatched",
    notes: String(payload.notes || "").trim(),
    matchType: null,
    matchId: null,
    matchLabel: null,
    matchedAt: null,
    createdAt: new Date().toISOString(),
  };

  store.bankTransactions.push(transaction);
  return transaction;
}

function importBankTransactions(store, payload) {
  const transactions = Array.isArray(payload.transactions) ? payload.transactions : [payload];
  const imported = [];

  for (const item of transactions) {
    const externalId = item.externalId ? String(item.externalId) : null;
    if (externalId && store.bankTransactions.some((entry) => entry.externalId === externalId)) {
      continue;
    }

    imported.push(createBankTransaction(store, item));
  }

  return imported;
}

function findBankTransaction(store, transactionId) {
  const transaction = store.bankTransactions.find((item) => item.id === transactionId);

  if (!transaction) {
    throw new Error("Bank transaction not found.");
  }

  return transaction;
}

function setBankTransactionIgnored(store, transactionId) {
  const transaction = findBankTransaction(store, transactionId);
  transaction.status = transaction.status === "ignored" ? "unmatched" : "ignored";
  transaction.notes = transaction.status === "ignored" ? "Ignored during reconciliation." : "";
  transaction.matchedAt = transaction.status === "ignored" ? new Date().toISOString() : null;
  return transaction;
}

function matchBankTransaction(store, transactionId, payload) {
  const transaction = findBankTransaction(store, transactionId);
  const matchType = String(payload.matchType || "").trim().toLowerCase();
  const amount = toCurrencyAmount(payload.amount || Math.abs(transaction.amount));

  if (transaction.status === "matched") {
    throw new Error("Bank transaction is already matched.");
  }

  if (!amount || amount > Math.abs(transaction.amount)) {
    throw new Error("Invalid match amount.");
  }

  if (matchType === "invoice") {
    if (transaction.amount <= 0) {
      throw new Error("Invoice matches require an inflow transaction.");
    }

    const invoice = payInvoice(store, payload.targetId, {
      paymentDate: payload.paymentDate || transaction.postedDate,
      amount,
    });
    transaction.status = "matched";
    transaction.matchType = "invoice";
    transaction.matchId = invoice.id;
    transaction.matchLabel = invoice.number;
    transaction.notes = String(payload.notes || `Matched to ${invoice.number}`);
    transaction.matchedAt = new Date().toISOString();
    return transaction;
  }

  if (matchType === "bill") {
    if (transaction.amount >= 0) {
      throw new Error("Bill matches require an outflow transaction.");
    }

    const bill = payBill(store, payload.targetId, {
      paymentDate: payload.paymentDate || transaction.postedDate,
      amount,
    });
    transaction.status = "matched";
    transaction.matchType = "bill";
    transaction.matchId = bill.id;
    transaction.matchLabel = bill.number;
    transaction.notes = String(payload.notes || `Matched to ${bill.number}`);
    transaction.matchedAt = new Date().toISOString();
    return transaction;
  }

  if (matchType === "journal") {
    const offsetAccountCode = String(payload.offsetAccountCode || "").trim();

    if (!offsetAccountCode) {
      throw new Error("Offset account code is required for journal matching.");
    }

    requireAccount(store, offsetAccountCode);

    recordJournalEntry(store, {
      date: payload.paymentDate || transaction.postedDate,
      memo: String(payload.memo || transaction.description || "Bank transaction"),
      sourceType: "bank_transaction",
      sourceId: transaction.id,
      lines:
        transaction.amount >= 0
          ? [
              { accountCode: "1000", debit: amount, credit: 0, memo: transaction.description },
              { accountCode: offsetAccountCode, debit: 0, credit: amount, memo: transaction.description },
            ]
          : [
              { accountCode: offsetAccountCode, debit: amount, credit: 0, memo: transaction.description },
              { accountCode: "1000", debit: 0, credit: amount, memo: transaction.description },
            ],
    });

    transaction.status = "matched";
    transaction.matchType = "journal";
    transaction.matchId = offsetAccountCode;
    transaction.matchLabel = offsetAccountCode;
    transaction.notes = String(payload.notes || `Posted to ${offsetAccountCode}`);
    transaction.matchedAt = new Date().toISOString();
    return transaction;
  }

  throw new Error("Unsupported bank match type.");
}

function toCsv(rows, headers) {
  const encode = (value) => {
    const raw = String(value ?? "");
    return `"${raw.replaceAll('"', '""')}"`;
  };

  return [headers.map((header) => encode(header.label)).join(",")]
    .concat(
      rows.map((row) => headers.map((header) => encode(row[header.key])).join(","))
    )
    .join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseCookies(req) {
  const header = req.headers.cookie;

  if (!header) {
    return {};
  }

  return header.split(";").reduce((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split("=");

    if (!rawName) {
      return cookies;
    }

    try {
      cookies[rawName] = decodeURIComponent(rawValue.join("=") || "");
    } catch {
      cookies[rawName] = rawValue.join("=") || "";
    }
    return cookies;
  }, {});
}

function sign(value) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("base64url");
}

function buildSessionCookie(sessionId, req) {
  const isSecure = isSecureRequest(req);
  const signedValue = `${sessionId}.${sign(sessionId)}`;
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(signedValue)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];

  if (isSecure || FORCE_HTTPS) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function buildExpiredCookie(req) {
  const isSecure = isSecureRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (isSecure || FORCE_HTTPS) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function createSession() {
  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    createdAt: now(),
    updatedAt: now(),
    adminAuthenticated: false,
    adminUsername: null,
    adminEmail: null,
    oauthState: null,
    codeVerifier: null,
    accessToken: null,
    refreshToken: null,
    tokenType: "Bearer",
    expiresAt: null,
    accounts: [],
    lastSyncAt: null,
  };

  sessions.set(sessionId, session);
  return session;
}

function getSessionFromRequest(req) {
  const cookieValue = parseCookies(req)[SESSION_COOKIE_NAME];

  if (!cookieValue) {
    return null;
  }

  const [sessionId, signature] = cookieValue.split(".");

  if (!sessionId || !signature) {
    return null;
  }

  const expectedSignature = sign(sessionId);
  const signatureIsValid =
    signature.length === expectedSignature.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

  if (!signatureIsValid) {
    return null;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  if (now() - session.updatedAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }

  session.updatedAt = now();
  return session;
}

function ensureSession(req, res) {
  const existing = getSessionFromRequest(req);

  if (existing) {
    res.setHeader("Set-Cookie", buildSessionCookie(existing.id, req));
    return existing;
  }

  const session = createSession();
  res.setHeader("Set-Cookie", buildSessionCookie(session.id, req));
  return session;
}

function destroySession(req, res) {
  const existing = getSessionFromRequest(req);

  if (existing) {
    sessions.delete(existing.id);
  }

  res.setHeader("Set-Cookie", buildExpiredCookie(req));
}

function resetBankSession(session) {
  session.oauthState = null;
  session.codeVerifier = null;
  session.accessToken = null;
  session.refreshToken = null;
  session.tokenType = "Bearer";
  session.expiresAt = null;
  session.accounts = [];
  session.lastSyncAt = null;
}

function cleanupSessions() {
  const cutoff = now() - SESSION_TTL_MS;

  for (const [id, session] of sessions.entries()) {
    if (session.updatedAt < cutoff) {
      sessions.delete(id);
    }
  }
}

function pruneLoginAttempts() {
  const cutoff = now() - LOGIN_WINDOW_MS;

  for (const [key, attempt] of loginAttempts.entries()) {
    if (attempt.windowStartedAt < cutoff) {
      loginAttempts.delete(key);
    }
  }
}

function getClientAddress(req) {
  if (TRUST_PROXY) {
    const forwardedFor = req.headers["x-forwarded-for"];

    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
      return forwardedFor.split(",")[0].trim();
    }
  }

  return req.socket.remoteAddress || "unknown";
}

function isSecureRequest(req) {
  if (TRUST_PROXY) {
    const forwardedProto = req.headers["x-forwarded-proto"];

    if (typeof forwardedProto === "string") {
      return forwardedProto.split(",")[0].trim() === "https";
    }
  }

  return Boolean(req.socket.encrypted);
}

function getRequestOrigin(req) {
  if (APP_ORIGIN) {
    return APP_ORIGIN;
  }

  const protocol = isSecureRequest(req) ? "https" : "http";
  return `${protocol}://${req.headers.host}`;
}

function assertHttpsForSensitiveRoutes(req) {
  if (FORCE_HTTPS && !isSecureRequest(req)) {
    throw new Error("HTTPS is required for this route.");
  }
}

function validateUrlEnv(name, allowHttp = false) {
  const value = process.env[name];

  if (!value) {
    return null;
  }

  const parsed = new URL(value);

  if (!allowHttp && parsed.protocol !== "https:" && !ALLOW_INSECURE_BANK_URLS) {
    throw new Error(`${name} must use HTTPS.`);
  }

  return parsed.toString();
}

function getAdminConfig() {
  return {
    email: process.env.ADMIN_EMAIL || "",
    username: process.env.ADMIN_USERNAME || "",
    passwordHash: process.env.ADMIN_PASSWORD_HASH || "",
  };
}

function hasAdminConfig() {
  const config = getAdminConfig();
  return Boolean(config.email && config.username && config.passwordHash);
}

function parsePasswordHash(serialized) {
  const parts = serialized.split("$");

  if (parts.length !== 6 || parts[0] !== "scrypt") {
    throw new Error("ADMIN_PASSWORD_HASH must use scrypt format.");
  }

  return {
    n: Number(parts[1]),
    r: Number(parts[2]),
    p: Number(parts[3]),
    salt: parts[4],
    hash: parts[5],
  };
}

function safeEqualString(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyPassword(password, serializedHash) {
  const parsed = parsePasswordHash(serializedHash);
  const derivedKey = crypto.scryptSync(password, parsed.salt, 64, {
    N: parsed.n,
    r: parsed.r,
    p: parsed.p,
  });
  const expectedKey = Buffer.from(parsed.hash, "base64url");

  if (derivedKey.length !== expectedKey.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedKey, expectedKey);
}

function validateRequestOrigin(req) {
  const origin = req.headers.origin;

  if (!origin) {
    return true;
  }

  return origin === getRequestOrigin(req);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;

      if (size > 64 * 1024) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const contentType = req.headers["content-type"] || "";

  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new Error("Expected application/json.");
  }

  const body = await readRequestBody(req);

  if (!body) {
    return {};
  }

  return JSON.parse(body);
}

function getLoginAttemptState(req) {
  pruneLoginAttempts();
  const key = getClientAddress(req);
  const existing = loginAttempts.get(key);

  if (!existing || now() - existing.windowStartedAt > LOGIN_WINDOW_MS) {
    const fresh = { count: 0, windowStartedAt: now() };
    loginAttempts.set(key, fresh);
    return fresh;
  }

  return existing;
}

function recordFailedLogin(req) {
  const state = getLoginAttemptState(req);
  state.count += 1;
}

function clearFailedLogins(req) {
  loginAttempts.delete(getClientAddress(req));
}

function isLoginBlocked(req) {
  return getLoginAttemptState(req).count >= MAX_LOGIN_ATTEMPTS;
}

function hasRbcConfig() {
  return Boolean(
    process.env.RBC_CLIENT_ID &&
      process.env.RBC_CLIENT_SECRET &&
      process.env.RBC_AUTH_URL &&
      process.env.RBC_TOKEN_URL &&
      process.env.RBC_REDIRECT_URI
  );
}

function isConnected(session) {
  return Boolean(
    session.accessToken && (!session.expiresAt || session.expiresAt > now())
  );
}

function buildSecurityHeaders(req, contentType, cacheControl = "no-store") {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    Pragma: "no-cache",
    Expires: "0",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy":
      "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; upgrade-insecure-requests",
  };

  if (isSecureRequest(req) || FORCE_HTTPS) {
    headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains";
  }

  return headers;
}

function sendJson(req, res, statusCode, payload) {
  res.writeHead(statusCode, buildSecurityHeaders(req, CONTENT_TYPES[".json"]));
  res.end(JSON.stringify(payload));
}

function sendHtml(req, res, statusCode, html) {
  res.writeHead(statusCode, buildSecurityHeaders(req, CONTENT_TYPES[".html"]));
  res.end(html);
}

function sendCsv(req, res, statusCode, filename, csv) {
  const headers = buildSecurityHeaders(req, "text/csv; charset=utf-8", "no-store");
  headers["Content-Disposition"] = `attachment; filename="${filename}"`;
  res.writeHead(statusCode, headers);
  res.end(csv);
}

function readStaticFile(filePath) {
  const resolvedPath = path.resolve(ROOT, filePath);
  const relativePath = path.relative(ROOT, resolvedPath);

  if (
    path.isAbsolute(relativePath) ||
    relativePath.startsWith("..") ||
    relativePath.includes(`${path.sep}..${path.sep}`) ||
    relativePath === ".."
  ) {
    return null;
  }

  if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
    return null;
  }

  return resolvedPath;
}

function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = readStaticFile(`.${requestPath}`);

  if (!filePath) {
    sendJson(req, res, 404, { error: "Not found" });
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[extension] || "application/octet-stream";
  const cacheControl =
    extension === ".html"
      ? "no-store"
      : "public, max-age=300, stale-while-revalidate=300";

  res.writeHead(200, buildSecurityHeaders(req, contentType, cacheControl));
  fs.createReadStream(filePath).pipe(res);
}

function base64UrlSha256(value) {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function buildConnectUrl(session) {
  validateUrlEnv("RBC_AUTH_URL");
  validateUrlEnv("RBC_REDIRECT_URI", true);

  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = base64UrlSha256(codeVerifier);

  session.oauthState = state;
  session.codeVerifier = codeVerifier;

  const url = new URL(process.env.RBC_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.RBC_CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.RBC_REDIRECT_URI);
  url.searchParams.set("scope", process.env.RBC_SCOPES || "accounts transactions");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

async function exchangeCodeForToken(session, code) {
  validateUrlEnv("RBC_TOKEN_URL");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.RBC_REDIRECT_URI,
    client_id: process.env.RBC_CLIENT_ID,
    client_secret: process.env.RBC_CLIENT_SECRET,
    code_verifier: session.codeVerifier,
  });

  const response = await fetch(process.env.RBC_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const payload = await response.json();

  if (!response.ok || !payload.access_token) {
    throw new Error("Token exchange failed.");
  }

  session.accessToken = payload.access_token;
  session.refreshToken = payload.refresh_token || null;
  session.tokenType = payload.token_type || "Bearer";
  session.expiresAt = payload.expires_in
    ? now() + Number(payload.expires_in) * 1000
    : null;
  session.oauthState = null;
  session.codeVerifier = null;
}

async function fetchRbcAccounts(session) {
  if (!process.env.RBC_ACCOUNTS_URL) {
    return [];
  }

  validateUrlEnv("RBC_ACCOUNTS_URL");

  const response = await fetch(process.env.RBC_ACCOUNTS_URL, {
    headers: {
      Authorization: `${session.tokenType} ${session.accessToken}`,
      Accept: "application/json",
    },
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error("Accounts sync failed.");
  }

  const accounts = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.accounts)
      ? payload.accounts
      : [];

  session.accounts = accounts.map((account) => {
    const rawId = account.id || account.accountId || account.number || null;

    return {
      id: rawId ? `****${String(rawId).slice(-4)}` : null,
      name: account.name || account.nickname || account.productName || "Business account",
      type: account.type || account.accountType || account.category || "Business account",
      balance:
        account.balance?.current ||
        account.currentBalance ||
        account.ledgerBalance ||
        account.balance ||
        null,
      availableBalance: account.availableBalance || account.balance?.available || null,
      currency: account.currency || account.currencyCode || "CAD",
    };
  });
  session.lastSyncAt = new Date().toISOString();
  session.updatedAt = now();

  return session.accounts;
}

async function fetchRbcTransactions(session) {
  if (!process.env.RBC_TRANSACTIONS_URL) {
    return [];
  }

  validateUrlEnv("RBC_TRANSACTIONS_URL");

  const response = await fetch(process.env.RBC_TRANSACTIONS_URL, {
    headers: {
      Authorization: `${session.tokenType} ${session.accessToken}`,
      Accept: "application/json",
    },
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error("Transaction sync failed.");
  }

  const transactions = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.transactions)
      ? payload.transactions
      : [];

  return transactions.map((transaction, index) => {
    const rawAmount =
      transaction.amount?.value ??
      transaction.amount ??
      transaction.transactionAmount ??
      transaction.signedAmount ??
      0;

    return {
      externalId: String(
        transaction.id ||
          transaction.transactionId ||
          transaction.reference ||
          `rbc_tx_${Date.now()}_${index}`
      ),
      accountId: String(transaction.accountId || transaction.account?.id || "RBC"),
      accountName: String(
        transaction.accountName ||
          transaction.account?.name ||
          transaction.accountNickname ||
          "RBC account"
      ),
      postedDate: String(
        transaction.postedDate ||
          transaction.bookingDate ||
          transaction.date ||
          new Date().toISOString().slice(0, 10)
      ),
      description: String(
        transaction.description ||
          transaction.memo ||
          transaction.narrative ||
          transaction.reference ||
          "RBC transaction"
      ),
      amount: toCurrencyAmount(rawAmount),
      currency: String(
        transaction.currency ||
          transaction.amount?.currency ||
          transaction.currencyCode ||
          "CAD"
      ),
      source: "RBC",
    };
  });
}

function getRbcStatusPayload(session) {
  return {
    provider: "RBC",
    configured: hasRbcConfig(),
    connected: isConnected(session),
    expiresAt: session.expiresAt,
    lastSyncAt: session.lastSyncAt,
    accounts: session.accounts,
    transactionSyncConfigured: Boolean(process.env.RBC_TRANSACTIONS_URL),
  };
}

function getAdminStatusPayload(session) {
  return {
    configured: hasAdminConfig(),
    authenticated: Boolean(session.adminAuthenticated),
    username: session.adminAuthenticated ? session.adminUsername : null,
    email: session.adminAuthenticated ? session.adminEmail : null,
  };
}

function requireAdmin(req, res, session) {
  if (!session.adminAuthenticated) {
    sendJson(req, res, 401, { error: "Admin authentication required." });
    return false;
  }

  return true;
}

async function handleDataMutation(req, res, session, action) {
  if (!requireAdmin(req, res, session)) {
    return;
  }

  assertHttpsForSensitiveRoutes(req);

  try {
    const payload = await readJsonBody(req);
    const store = readStore();
    const result = action(store, payload);
    writeStore(store);
    sendJson(req, res, 200, {
      ok: true,
      result,
      app: buildBootstrapPayload(store, session),
    });
  } catch (error) {
    sendJson(req, res, 400, { error: error.message || "Request failed." });
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, getRequestOrigin(req));
  const session = ensureSession(req, res);

  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method || "")) {
    if (!validateRequestOrigin(req)) {
      sendJson(req, res, 403, { error: "Invalid request origin." });
      return;
    }
  }

  if (url.pathname === "/api/admin/status" && req.method === "GET") {
    sendJson(req, res, 200, getAdminStatusPayload(session));
    return;
  }

  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    assertHttpsForSensitiveRoutes(req);

    if (!hasAdminConfig()) {
      sendJson(req, res, 400, {
        error:
          "Admin login is not configured. Set ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_PASSWORD_HASH, and SESSION_SECRET.",
      });
      return;
    }

    if (isLoginBlocked(req)) {
      sendJson(req, res, 429, {
        error: "Too many failed login attempts. Try again later.",
      });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const email = String(payload.email || "").trim().toLowerCase();
      const username = String(payload.username || "").trim();
      const password = String(payload.password || "");
      const config = getAdminConfig();
      const emailMatches = safeEqualString(email, config.email.trim().toLowerCase());
      const usernameMatches = safeEqualString(username, config.username.trim());
      const passwordMatches = verifyPassword(password, config.passwordHash.trim());

      if (!emailMatches || !usernameMatches || !passwordMatches) {
        recordFailedLogin(req);
        sendJson(req, res, 401, { error: "Invalid credentials." });
        return;
      }

      clearFailedLogins(req);
      session.adminAuthenticated = true;
      session.adminUsername = config.username.trim();
      session.adminEmail = config.email.trim().toLowerCase();
      session.updatedAt = now();

      sendJson(req, res, 200, getAdminStatusPayload(session));
    } catch {
      sendJson(req, res, 400, { error: "Invalid login payload." });
    }

    return;
  }

  if (url.pathname === "/api/admin/logout" && req.method === "POST") {
    destroySession(req, res);
    sendJson(req, res, 200, {
      configured: hasAdminConfig(),
      authenticated: false,
      username: null,
      email: null,
    });
    return;
  }

  if (url.pathname === "/api/app/bootstrap" && req.method === "GET") {
    if (!requireAdmin(req, res, session)) {
      return;
    }

    const store = readStore();
    sendJson(req, res, 200, buildBootstrapPayload(store, session));
    return;
  }

  if (url.pathname === "/api/company" && req.method === "POST") {
    await handleDataMutation(req, res, session, (store, payload) => {
      const name = String(payload.name || "").trim();
      const currency = String(payload.currency || "").trim().toUpperCase();
      const taxName = String(payload.taxName || "").trim();
      const defaultTaxRate = Number(payload.defaultTaxRate);

      if (!name || !currency || !taxName || Number.isNaN(defaultTaxRate)) {
        throw new Error("Company name, currency, tax name, and default tax rate are required.");
      }

      store.company = {
        name,
        currency,
        taxName,
        defaultTaxRate,
      };

      return store.company;
    });
    return;
  }

  if (url.pathname === "/api/clients" && req.method === "POST") {
    await handleDataMutation(req, res, session, (store, payload) => {
      const name = String(payload.name || "").trim();

      if (!name) {
        throw new Error("Client name is required.");
      }

      const client = {
        id: `client_${nextCounter(store, "client")}`,
        name,
        email: String(payload.email || "").trim().toLowerCase(),
        createdAt: new Date().toISOString(),
      };

      store.clients.push(client);
      return client;
    });
    return;
  }

  if (url.pathname === "/api/vendors" && req.method === "POST") {
    await handleDataMutation(req, res, session, (store, payload) => {
      const name = String(payload.name || "").trim();

      if (!name) {
        throw new Error("Vendor name is required.");
      }

      const vendor = {
        id: `vendor_${nextCounter(store, "vendor")}`,
        name,
        email: String(payload.email || "").trim().toLowerCase(),
        createdAt: new Date().toISOString(),
      };

      store.vendors.push(vendor);
      return vendor;
    });
    return;
  }

  if (url.pathname === "/api/accounts" && req.method === "POST") {
    await handleDataMutation(req, res, session, (store, payload) => {
      const code = String(payload.code || "").trim();
      const name = String(payload.name || "").trim();
      const type = String(payload.type || "").trim().toLowerCase();

      if (!code || !name || !type) {
        throw new Error("Account code, name, and type are required.");
      }

      if (store.accounts.some((account) => account.code === code)) {
        throw new Error("Account code already exists.");
      }

      const account = {
        id: `account_${nextCounter(store, "account")}`,
        code,
        name,
        type,
        system: false,
      };

      store.accounts.push(account);
      return account;
    });
    return;
  }

  if (url.pathname === "/api/invoices" && req.method === "POST") {
    await handleDataMutation(req, res, session, createInvoice);
    return;
  }

  if (url.pathname.startsWith("/api/invoices/") && url.pathname.endsWith("/status") && req.method === "POST") {
    const invoiceId = url.pathname.split("/")[3];
    await handleDataMutation(req, res, session, (store, payload) => {
      const invoice = store.invoices.find((item) => item.id === invoiceId);

      if (!invoice) {
        throw new Error("Invoice not found.");
      }

      return updateRecordWorkflow(invoice, payload);
    });
    return;
  }

  if (url.pathname.startsWith("/api/invoices/") && url.pathname.endsWith("/pay") && req.method === "POST") {
    const invoiceId = url.pathname.split("/")[3];
    await handleDataMutation(req, res, session, (store, payload) =>
      payInvoice(store, invoiceId, payload)
    );
    return;
  }

  if (url.pathname === "/api/bills" && req.method === "POST") {
    await handleDataMutation(req, res, session, createBill);
    return;
  }

  if (url.pathname.startsWith("/api/bills/") && url.pathname.endsWith("/status") && req.method === "POST") {
    const billId = url.pathname.split("/")[3];
    await handleDataMutation(req, res, session, (store, payload) => {
      const bill = store.bills.find((item) => item.id === billId);

      if (!bill) {
        throw new Error("Bill not found.");
      }

      return updateRecordWorkflow(bill, payload);
    });
    return;
  }

  if (url.pathname.startsWith("/api/bills/") && url.pathname.endsWith("/pay") && req.method === "POST") {
    const billId = url.pathname.split("/")[3];
    await handleDataMutation(req, res, session, (store, payload) =>
      payBill(store, billId, payload)
    );
    return;
  }

  if (url.pathname === "/api/purchase-orders" && req.method === "POST") {
    await handleDataMutation(req, res, session, createPurchaseOrder);
    return;
  }

  if (
    url.pathname.startsWith("/api/purchase-orders/") &&
    url.pathname.endsWith("/status") &&
    req.method === "POST"
  ) {
    const orderId = url.pathname.split("/")[3];
    await handleDataMutation(req, res, session, (store, payload) => {
      const order = store.purchaseOrders.find((item) => item.id === orderId);

      if (!order) {
        throw new Error("Purchase order not found.");
      }

      return updateRecordWorkflow(order, payload);
    });
    return;
  }

  if (
    url.pathname.startsWith("/api/purchase-orders/") &&
    url.pathname.endsWith("/convert") &&
    req.method === "POST"
  ) {
    const orderId = url.pathname.split("/")[3];
    await handleDataMutation(req, res, session, (store, payload) =>
      convertPurchaseOrderToBill(store, orderId, payload)
    );
    return;
  }

  if (url.pathname === "/api/journal-entries" && req.method === "POST") {
    await handleDataMutation(req, res, session, createManualJournal);
    return;
  }

  if (url.pathname === "/api/bank/transactions" && req.method === "POST") {
    await handleDataMutation(req, res, session, (store, payload) => importBankTransactions(store, payload));
    return;
  }

  if (url.pathname === "/api/bank/sync" && req.method === "POST") {
    if (!requireAdmin(req, res, session)) {
      return;
    }

    assertHttpsForSensitiveRoutes(req);

    try {
      const store = readStore();

      if (isConnected(session) && session.accounts?.length) {
        persistBankAccounts(store, session.accounts, "RBC");
      }

      let imported = [];

      if (isConnected(session) && process.env.RBC_TRANSACTIONS_URL) {
        imported = importBankTransactions(store, {
          transactions: await fetchRbcTransactions(session),
        });
      }

      writeStore(store);
      sendJson(req, res, 200, {
        ok: true,
        result: {
          accounts: store.bankAccounts.length,
          importedTransactions: imported.length,
        },
        app: buildBootstrapPayload(store, session),
        bank: getRbcStatusPayload(session),
      });
    } catch (error) {
      sendJson(req, res, 400, { error: error.message || "Bank sync failed." });
    }
    return;
  }

  if (
    url.pathname.startsWith("/api/bank/transactions/") &&
    url.pathname.endsWith("/match") &&
    req.method === "POST"
  ) {
    const transactionId = url.pathname.split("/")[4];
    await handleDataMutation(req, res, session, (store, payload) =>
      matchBankTransaction(store, transactionId, payload)
    );
    return;
  }

  if (
    url.pathname.startsWith("/api/bank/transactions/") &&
    url.pathname.endsWith("/ignore") &&
    req.method === "POST"
  ) {
    const transactionId = url.pathname.split("/")[4];
    await handleDataMutation(req, res, session, (store) =>
      setBankTransactionIgnored(store, transactionId)
    );
    return;
  }

  if (url.pathname === "/api/recurring-templates" && req.method === "POST") {
    await handleDataMutation(req, res, session, createRecurringTemplate);
    return;
  }

  if (
    url.pathname.startsWith("/api/recurring-templates/") &&
    url.pathname.endsWith("/run") &&
    req.method === "POST"
  ) {
    const templateId = url.pathname.split("/")[3];
    await handleDataMutation(req, res, session, (store, payload) =>
      runRecurringTemplate(store, templateId, payload)
    );
    return;
  }

  if (
    url.pathname.startsWith("/api/close-checklist/") &&
    url.pathname.endsWith("/toggle") &&
    req.method === "POST"
  ) {
    const itemId = url.pathname.split("/")[3];
    await handleDataMutation(req, res, session, (store) => toggleChecklistItem(store, itemId));
    return;
  }

  if (url.pathname === "/exports/invoices.csv" && req.method === "GET") {
    if (!requireAdmin(req, res, session)) {
      return;
    }

    const store = readStore();
    const csv = toCsv(store.invoices, [
      { key: "number", label: "Invoice" },
      { key: "clientName", label: "Client" },
      { key: "issueDate", label: "Issue Date" },
      { key: "dueDate", label: "Due Date" },
      { key: "status", label: "Status" },
      { key: "total", label: "Total" },
      { key: "balanceDue", label: "Balance Due" },
    ]);
    sendCsv(req, res, 200, "invoices.csv", csv);
    return;
  }

  if (url.pathname === "/exports/bills.csv" && req.method === "GET") {
    if (!requireAdmin(req, res, session)) {
      return;
    }

    const store = readStore();
    const csv = toCsv(store.bills, [
      { key: "number", label: "Bill" },
      { key: "vendorName", label: "Vendor" },
      { key: "issueDate", label: "Issue Date" },
      { key: "dueDate", label: "Due Date" },
      { key: "status", label: "Status" },
      { key: "total", label: "Total" },
      { key: "balanceDue", label: "Balance Due" },
    ]);
    sendCsv(req, res, 200, "bills.csv", csv);
    return;
  }

  if (url.pathname === "/exports/journals.csv" && req.method === "GET") {
    if (!requireAdmin(req, res, session)) {
      return;
    }

    const store = readStore();
    const rows = store.journalEntries.flatMap((entry) =>
      entry.lines.map((line) => ({
        reference: entry.reference,
        date: entry.date,
        memo: entry.memo,
        sourceType: entry.sourceType,
        accountCode: line.accountCode,
        debit: line.debit,
        credit: line.credit,
      }))
    );
    const csv = toCsv(rows, [
      { key: "reference", label: "Journal" },
      { key: "date", label: "Date" },
      { key: "memo", label: "Memo" },
      { key: "sourceType", label: "Source" },
      { key: "accountCode", label: "Account" },
      { key: "debit", label: "Debit" },
      { key: "credit", label: "Credit" },
    ]);
    sendCsv(req, res, 200, "journals.csv", csv);
    return;
  }

  if (url.pathname === "/api/rbc/status" && req.method === "GET") {
    sendJson(req, res, 200, getRbcStatusPayload(session));
    return;
  }

  if (url.pathname === "/api/rbc/disconnect" && req.method === "POST") {
    if (!requireAdmin(req, res, session)) {
      return;
    }

    assertHttpsForSensitiveRoutes(req);
    resetBankSession(session);
    sendJson(req, res, 200, { disconnected: true });
    return;
  }

  if (url.pathname === "/api/rbc/connect-url" && req.method === "GET") {
    if (!requireAdmin(req, res, session)) {
      return;
    }

    assertHttpsForSensitiveRoutes(req);

    if (!hasRbcConfig()) {
      sendJson(req, res, 400, {
        error:
          "RBC API is not configured. Set RBC_CLIENT_ID, RBC_CLIENT_SECRET, RBC_AUTH_URL, RBC_TOKEN_URL, RBC_REDIRECT_URI, and SESSION_SECRET.",
      });
      return;
    }

    sendJson(req, res, 200, { url: buildConnectUrl(session) });
    return;
  }

  if (url.pathname === "/api/rbc/callback" && req.method === "GET") {
    assertHttpsForSensitiveRoutes(req);

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      sendHtml(
        req,
        res,
        400,
        "<h1>RBC connection failed</h1><p>The bank returned an error.</p><p><a href=\"/\">Return to Count123</a></p>"
      );
      return;
    }

    if (!code || !state || state !== session.oauthState || !session.codeVerifier) {
      sendHtml(
        req,
        res,
        400,
        "<h1>Invalid RBC callback</h1><p>The OAuth state, PKCE verifier, or authorization code was invalid.</p><p><a href=\"/\">Return to Count123</a></p>"
      );
      return;
    }

    try {
      await exchangeCodeForToken(session, code);
      const accounts = await fetchRbcAccounts(session);
      const store = readStore();
      persistBankAccounts(store, accounts, "RBC");
      writeStore(store);
      sendHtml(
        req,
        res,
        200,
        "<h1>RBC connected</h1><p>Your business accounts were synced successfully.</p><p><a href=\"/\">Return to Count123</a></p>"
      );
    } catch {
      sendHtml(
        req,
        res,
        502,
        "<h1>RBC sync failed</h1><p>The bank token exchange or account sync did not complete successfully.</p><p><a href=\"/\">Return to Count123</a></p>"
      );
    }

    return;
  }

  sendJson(req, res, 404, { error: "Unknown API route" });
}

const server = http.createServer(async (req, res) => {
  cleanupSessions();

  try {
    if ((req.url || "").startsWith("/api/") || (req.url || "").startsWith("/exports/")) {
      await handleApi(req, res);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    const message =
      error instanceof Error ? escapeHtml(error.message) : "Internal server error";
    sendJson(req, res, 500, { error: message });
  }
});

ensureDataStore();

server.listen(PORT, () => {
  console.log(`Count123 listening on port ${PORT}`);
});
