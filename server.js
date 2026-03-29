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
  };
}

function readStore() {
  ensureDataStore();
  const raw = fs.readFileSync(STORE_FILE, "utf8");
  const store = JSON.parse(raw);

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
    status: "sent",
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
    status: "open",
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
    status: "open",
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

    cookies[rawName] = decodeURIComponent(rawValue.join("=") || "");
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

  if (!sessionId || !signature || sign(sessionId) !== signature) {
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

function readStaticFile(filePath) {
  const resolvedPath = path.resolve(ROOT, filePath);

  if (!resolvedPath.startsWith(ROOT)) {
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

function getRbcStatusPayload(session) {
  return {
    provider: "RBC",
    configured: hasRbcConfig(),
    connected: isConnected(session),
    expiresAt: session.expiresAt,
    lastSyncAt: session.lastSyncAt,
    accounts: session.accounts,
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

  if (url.pathname === "/api/rbc/status" && req.method === "GET") {
    sendJson(req, res, 200, getRbcStatusPayload(session));
    return;
  }

  if (url.pathname === "/api/rbc/disconnect" && req.method === "POST") {
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
      await fetchRbcAccounts(session);
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
    if ((req.url || "").startsWith("/api/")) {
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
