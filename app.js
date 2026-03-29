const state = { app: null, bank: null, activePage: "dashboard", sidebarCollapsed: false };

const el = {
  adminBadge: document.getElementById("admin-badge"),
  adminLogoutButton: document.getElementById("admin-logout"),
  adminLoginForm: document.getElementById("admin-login-form"),
  adminEmailInput: document.getElementById("admin-email"),
  adminUsernameInput: document.getElementById("admin-username"),
  adminPasswordInput: document.getElementById("admin-password"),
  adminLoginSubmit: document.getElementById("admin-login-submit"),
  adminMessage: document.getElementById("admin-message"),
  authPanel: document.getElementById("auth-panel"),
  workspace: document.getElementById("workspace"),
  workspaceShell: document.getElementById("workspace-shell"),
  sidebarToggle: document.getElementById("sidebar-toggle"),
  companyName: document.getElementById("company-name"),
  summaryGrid: document.getElementById("summary-grid"),
  bankSummaryGrid: document.getElementById("bank-summary-grid"),
  bankAccounts: document.getElementById("bank-accounts"),
  bankTransactionList: document.getElementById("bank-transaction-list"),
  bankReconciliationList: document.getElementById("bank-reconciliation-list"),
  bankTimelineList: document.getElementById("bank-timeline-list"),
  invoiceList: document.getElementById("invoice-list"),
  billList: document.getElementById("bill-list"),
  purchaseOrderList: document.getElementById("purchase-order-list"),
  accountList: document.getElementById("account-list"),
  journalList: document.getElementById("journal-list"),
  taxGrid: document.getElementById("tax-grid"),
  reportGrid: document.getElementById("report-grid"),
  clientList: document.getElementById("client-list"),
  vendorList: document.getElementById("vendor-list"),
  settingsClientList: document.getElementById("settings-client-list"),
  settingsVendorList: document.getElementById("settings-vendor-list"),
  recurringList: document.getElementById("recurring-list"),
  checklistList: document.getElementById("checklist-list"),
  syncBankButton: document.getElementById("sync-bank"),
  connectBankButton: document.getElementById("connect-bank"),
  clientForm: document.getElementById("client-form"),
  vendorForm: document.getElementById("vendor-form"),
  companyForm: document.getElementById("company-form"),
  accountForm: document.getElementById("account-form"),
  invoiceForm: document.getElementById("invoice-form"),
  billForm: document.getElementById("bill-form"),
  purchaseOrderForm: document.getElementById("purchase-order-form"),
  journalForm: document.getElementById("journal-form"),
  recurringForm: document.getElementById("recurring-form"),
  bankTransactionForm: document.getElementById("bank-transaction-form"),
  companyNameInput: document.getElementById("company-name-input"),
  companyCurrencyInput: document.getElementById("company-currency-input"),
  companyTaxNameInput: document.getElementById("company-tax-name-input"),
  companyTaxRateInput: document.getElementById("company-tax-rate-input"),
  invoiceTaxRateInput: document.getElementById("invoice-tax-rate"),
  billTaxRateInput: document.getElementById("bill-tax-rate"),
  recurringTaxRateInput: document.getElementById("recurring-tax-rate"),
  pageButtons: Array.from(document.querySelectorAll(".sidebar-tab[data-page]")),
  pagePanels: Array.from(document.querySelectorAll(".workspace-page[data-page]")),
};

function currency(value) {
  const code = state.app?.company?.currency || "CAD";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: code,
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function empty(target, message) {
  target.innerHTML = `<p class="empty-state">${message}</p>`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function setActivePage(page) {
  state.activePage = page;
  localStorage.setItem("count123:active-page", page);

  el.pageButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.page === page);
  });

  el.pagePanels.forEach((panel) => {
    const isActive = panel.dataset.page === page;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });
}

function applySidebarState() {
  el.workspaceShell.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  el.sidebarToggle.textContent = state.sidebarCollapsed ? "Expand" : "Collapse";
}

function initializeWorkspaceChrome() {
  const savedPage = localStorage.getItem("count123:active-page");
  const savedSidebarState = localStorage.getItem("count123:sidebar-collapsed");

  if (savedPage && el.pagePanels.some((panel) => panel.dataset.page === savedPage)) {
    state.activePage = savedPage;
  }

  state.sidebarCollapsed = savedSidebarState === "true";
  applySidebarState();
  setActivePage(state.activePage);
}

function setAdminUi(adminStatus) {
  const configured = Boolean(adminStatus?.configured);
  const authenticated = Boolean(adminStatus?.authenticated);

  el.adminBadge.textContent = authenticated
    ? `Admin online: ${adminStatus.username}`
    : configured
      ? "Admin offline"
      : "Admin unconfigured";

  el.adminLogoutButton.disabled = !authenticated;
  el.adminLoginSubmit.disabled = !configured || authenticated;
  el.adminEmailInput.disabled = !configured || authenticated;
  el.adminUsernameInput.disabled = !configured || authenticated;
  el.adminPasswordInput.disabled = !configured || authenticated;
  el.authPanel.hidden = authenticated;
  el.workspace.hidden = !authenticated;

  if (!configured) {
    el.adminMessage.textContent =
      "Configure ADMIN_EMAIL, ADMIN_USERNAME, and ADMIN_PASSWORD_HASH first.";
  } else if (!authenticated) {
    el.adminMessage.textContent =
      "Enter the configured admin credentials to access the accounting workspace.";
  }
}

function renderSummaryCards() {
  const summary = state.app.summary;
  const taxName = state.app.company.taxName;

  el.summaryGrid.innerHTML = [
    { label: "Cash", value: currency(summary.cash), note: "Live balance from journals" },
    { label: "Open Invoices", value: currency(summary.openInvoices), note: "Outstanding receivables" },
    { label: "Payables Due", value: currency(summary.payablesDue), note: "Open supplier obligations" },
    { label: "Net Income", value: currency(summary.netIncome), note: "Derived from posted entries" },
    { label: `${taxName} Payable`, value: currency(summary.taxPayable), note: `Current ${taxName} position` },
  ]
    .map(
      (item) => `
        <article class="metric-card">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
          <small>${item.note}</small>
        </article>
      `
    )
    .join("");
}

function paymentHistoryHtml(history) {
  if (!history?.length) {
    return "<small>No payments recorded.</small>";
  }

  const recent = history
    .map((payment) => `${escapeHtml(payment.paymentDate)} ${currency(payment.amount)}`)
    .join(" | ");

  return `<small>${recent}</small>`;
}

function findInvoice(identifier) {
  const value = String(identifier || "").trim().toLowerCase();
  return state.app.invoices.find(
    (invoice) =>
      invoice.id.toLowerCase() === value || String(invoice.number || "").toLowerCase() === value
  );
}

function findBill(identifier) {
  const value = String(identifier || "").trim().toLowerCase();
  return state.app.bills.find(
    (bill) => bill.id.toLowerCase() === value || String(bill.number || "").toLowerCase() === value
  );
}

function renderInvoices() {
  if (!state.app.invoices.length) {
    empty(el.invoiceList, "No invoices posted yet.");
    return;
  }

  el.invoiceList.innerHTML = state.app.invoices
    .map(
      (invoice) => `
        <article class="data-row">
          <div>
            <h4>${escapeHtml(invoice.number)} | ${escapeHtml(invoice.clientName)}</h4>
            <p>${escapeHtml(invoice.description)}</p>
            <small>Issued ${escapeHtml(invoice.issueDate)} | Due ${escapeHtml(invoice.dueDate)} | ${escapeHtml(invoice.notes || "No note")}</small>
            ${paymentHistoryHtml(invoice.paymentHistory)}
          </div>
          <div class="row-meta">
            <strong>${currency(invoice.total)}</strong>
            <span>${escapeHtml(invoice.status)}</span>
            <small>Balance ${currency(invoice.balanceDue)}</small>
            <div class="row-actions">
              ${
                invoice.status !== "paid"
                  ? `<button class="ghost-button action-button" data-action="pay-invoice" data-id="${escapeHtml(invoice.id)}">Record Payment</button>`
                  : ""
              }
              <button class="ghost-button action-button" data-action="invoice-status" data-id="${escapeHtml(invoice.id)}">Update Status</button>
              <button class="ghost-button action-button" data-action="invoice-note" data-id="${escapeHtml(invoice.id)}">Edit Note</button>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderBills() {
  if (!state.app.bills.length) {
    empty(el.billList, "No bills posted yet.");
    return;
  }

  el.billList.innerHTML = state.app.bills
    .map(
      (bill) => `
        <article class="data-row">
          <div>
            <h4>${escapeHtml(bill.number)} | ${escapeHtml(bill.vendorName)}</h4>
            <p>${escapeHtml(bill.description)}</p>
            <small>Issued ${escapeHtml(bill.issueDate)} | Due ${escapeHtml(bill.dueDate)} | ${escapeHtml(bill.notes || "No note")}</small>
            ${paymentHistoryHtml(bill.paymentHistory)}
          </div>
          <div class="row-meta">
            <strong>${currency(bill.total)}</strong>
            <span>${escapeHtml(bill.status)}</span>
            <small>Balance ${currency(bill.balanceDue)}</small>
            <div class="row-actions">
              ${
                bill.status !== "paid"
                  ? `<button class="ghost-button action-button" data-action="pay-bill" data-id="${escapeHtml(bill.id)}">Record Payment</button>`
                  : ""
              }
              <button class="ghost-button action-button" data-action="bill-status" data-id="${escapeHtml(bill.id)}">Update Status</button>
              <button class="ghost-button action-button" data-action="bill-note" data-id="${escapeHtml(bill.id)}">Edit Note</button>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderPurchaseOrders() {
  if (!state.app.purchaseOrders.length) {
    empty(el.purchaseOrderList, "No purchase orders created yet.");
    return;
  }

  el.purchaseOrderList.innerHTML = state.app.purchaseOrders
    .map(
      (order) => `
        <article class="data-row">
          <div>
            <h4>${escapeHtml(order.number)} | ${escapeHtml(order.vendorName)}</h4>
            <p>${escapeHtml(order.description)}</p>
            <small>Expected ${escapeHtml(order.expectedDate)} | ${escapeHtml(order.notes || "No note")}</small>
          </div>
          <div class="row-meta">
            <strong>${currency(order.amount)}</strong>
            <span>${escapeHtml(order.status)}</span>
            <div class="row-actions">
              ${
                order.status !== "billed"
                  ? `<button class="ghost-button action-button" data-action="po-status" data-id="${escapeHtml(order.id)}">Update Status</button>`
                  : ""
              }
              ${
                order.status !== "billed"
                  ? `<button class="ghost-button action-button" data-action="convert-po" data-id="${escapeHtml(order.id)}">Convert to Bill</button>`
                  : ""
              }
              <button class="ghost-button action-button" data-action="po-note" data-id="${escapeHtml(order.id)}">Edit Note</button>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderAccounts() {
  if (!state.app.accounts.length) {
    empty(el.accountList, "No accounts available.");
    return;
  }

  el.accountList.innerHTML = state.app.accounts
    .map(
      (account) => `
        <article class="table-row">
          <div><span>Code</span><strong>${escapeHtml(account.code)}</strong></div>
          <div><span>Account</span><strong>${escapeHtml(account.name)}</strong></div>
          <div><span>Type</span><strong>${escapeHtml(account.type)}</strong></div>
          <div><span>Balance</span><strong>${currency(account.balance)}</strong></div>
        </article>
      `
    )
    .join("");
}

function renderJournals() {
  if (!state.app.journalEntries.length) {
    empty(el.journalList, "No journal entries posted yet.");
    return;
  }

  el.journalList.innerHTML = state.app.journalEntries
    .map(
      (entry) => `
        <article class="data-row">
          <div>
            <h4>${escapeHtml(entry.reference)} | ${escapeHtml(entry.memo)}</h4>
            <p>${entry.lines
              .map((line) => `${escapeHtml(line.accountCode)} Dr ${currency(line.debit)} / Cr ${currency(line.credit)}`)
              .join("<br />")}</p>
            <small>${escapeHtml(entry.date)} | ${escapeHtml(entry.sourceType)}</small>
          </div>
        </article>
      `
    )
    .join("");
}

function renderTaxAndReports() {
  const tax = state.app.tax;
  const reports = state.app.reports;
  const taxName = state.app.company.taxName;

  el.taxGrid.innerHTML = [
    { label: `Collected ${taxName}`, value: currency(tax.collected) },
    { label: `Recoverable ${taxName}`, value: currency(tax.recoverable) },
    { label: `Net ${taxName}`, value: currency(tax.netRemittance) },
  ]
    .map(
      (item) => `
        <article class="metric-card compact">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
        </article>
      `
    )
    .join("");

  el.reportGrid.innerHTML = `
    <article class="report-card">
      <span>Profit & Loss</span>
      <strong>${currency(reports.profitAndLoss.netIncome)}</strong>
      <small>Revenue ${currency(reports.profitAndLoss.revenue)} | Expenses ${currency(reports.profitAndLoss.expenses)}</small>
    </article>
    <article class="report-card">
      <span>Balance Sheet</span>
      <strong>${currency(reports.balanceSheet.assets)}</strong>
      <small>Assets ${currency(reports.balanceSheet.assets)} | Liabilities ${currency(reports.balanceSheet.liabilities)}</small>
    </article>
  `;
}

function renderMasterLists() {
  const clientHtml = !state.app.clients.length
    ? `<p class="empty-state">No clients yet.</p>`
    : state.app.clients
        .map(
          (client) => `
            <article class="mini-row">
              <strong>${escapeHtml(client.name)}</strong>
              <small>${escapeHtml(client.email || "No email")}</small>
            </article>
          `
        )
        .join("");

  const vendorHtml = !state.app.vendors.length
    ? `<p class="empty-state">No vendors yet.</p>`
    : state.app.vendors
        .map(
          (vendor) => `
            <article class="mini-row">
              <strong>${escapeHtml(vendor.name)}</strong>
              <small>${escapeHtml(vendor.email || "No email")}</small>
            </article>
          `
        )
        .join("");

  el.clientList.innerHTML = clientHtml;
  el.settingsClientList.innerHTML = clientHtml;
  el.vendorList.innerHTML = vendorHtml;
  el.settingsVendorList.innerHTML = vendorHtml;
}

function renderBank() {
  const bank = state.bank || { configured: false, connected: false, accounts: [] };
  const banking = state.app.banking || {
    accounts: [],
    transactions: [],
    reconciliation: { unmatchedCount: 0, matchedCount: 0, ignoredCount: 0, suggestedCount: 0, unmatchedAmount: 0 },
    timeline: [],
    exceptionQueue: [],
  };
  el.bankSummaryGrid.innerHTML = [
    { label: "Status", value: bank.connected ? "Connected" : bank.configured ? "Ready" : "Not configured" },
    { label: "Accounts", value: String(banking.accounts.length || bank.accounts.length) },
    { label: "Transactions", value: String(banking.transactions.length) },
    { label: "Unmatched", value: String(banking.reconciliation.unmatchedCount) },
    { label: "Suggested", value: String(banking.reconciliation.suggestedCount) },
    { label: "Last Sync", value: bank.lastSyncAt ? new Date(bank.lastSyncAt).toLocaleString() : "Pending" },
  ]
    .map(
      (item) => `
        <article class="metric-card compact">
          <span>${item.label}</span>
          <strong>${escapeHtml(item.value)}</strong>
        </article>
      `
    )
    .join("");

  const visibleAccounts = banking.accounts.length ? banking.accounts : bank.accounts;

  if (!visibleAccounts.length) {
    empty(el.bankAccounts, "Connect RBC after signing in to sync bank balances.");
  } else {
    el.bankAccounts.innerHTML = visibleAccounts
      .map(
        (account) => `
          <article class="data-row">
            <div>
              <h4>${escapeHtml(account.name)}</h4>
              <p>${escapeHtml(account.type || "Business account")}</p>
              <small>${escapeHtml(account.id || "")}</small>
            </div>
            <div class="row-meta">
              <strong>${currency(account.balance || account.availableBalance || 0)}</strong>
              <span>${escapeHtml(account.currency || state.app.company.currency)}</span>
            </div>
          </article>
        `
      )
      .join("");
  }

  el.connectBankButton.disabled = !bank.configured;
  el.syncBankButton.disabled = !bank.configured && !visibleAccounts.length;
}

function renderBankTimeline() {
  const timeline = state.app.banking?.timeline || [];

  if (!timeline.length) {
    empty(el.bankTimelineList, "Import bank transactions to build the cashflow timeline.");
    return;
  }

  el.bankTimelineList.innerHTML = timeline
    .map(
      (period) => `
        <article class="table-row">
          <div>
            <span>Period</span>
            <strong>${escapeHtml(period.period)}</strong>
          </div>
          <div>
            <span>Inflow</span>
            <strong>${currency(period.inflow)}</strong>
          </div>
          <div>
            <span>Outflow</span>
            <strong>${currency(period.outflow)}</strong>
          </div>
          <div>
            <span>Net</span>
            <strong>${currency(period.net)}</strong>
          </div>
        </article>
      `
    )
    .join("");
}

function renderBankTransactions() {
  const transactions = state.app.banking?.transactions || [];

  if (!transactions.length) {
    empty(el.bankTransactionList, "No bank transactions imported yet.");
    return;
  }

  el.bankTransactionList.innerHTML = transactions
    .map((transaction) => {
      const suggestion = transaction.suggestion
        ? `<small>Suggestion: ${escapeHtml(transaction.suggestion.label)} (${escapeHtml(transaction.suggestion.targetType)})</small>`
        : "<small>No suggested match.</small>";

      return `
        <article class="data-row">
          <div>
            <h4>${escapeHtml(transaction.description)}</h4>
            <p>${escapeHtml(transaction.accountName)} | ${escapeHtml(transaction.postedDate)}</p>
            <small>${escapeHtml(transaction.status)}${transaction.matchLabel ? ` | ${escapeHtml(transaction.matchLabel)}` : ""}</small>
            ${suggestion}
          </div>
          <div class="row-meta">
            <strong class="${transaction.amount >= 0 ? "amount-inflow" : "amount-outflow"}">${currency(Math.abs(transaction.amount))}</strong>
            <span>${transaction.amount >= 0 ? "Inflow" : "Outflow"}</span>
            <div class="row-actions">
              ${
                transaction.status === "unmatched" && transaction.suggestion
                  ? `<button class="ghost-button action-button" data-action="bank-match-suggested" data-id="${escapeHtml(transaction.id)}">Accept Suggestion</button>`
                  : ""
              }
              ${
                transaction.status === "unmatched"
                  ? `<button class="ghost-button action-button" data-action="bank-match-record" data-kind="${transaction.amount >= 0 ? "invoice" : "bill"}" data-id="${escapeHtml(transaction.id)}">Match ${transaction.amount >= 0 ? "Invoice" : "Bill"}</button>`
                  : ""
              }
              ${
                transaction.status === "unmatched"
                  ? `<button class="ghost-button action-button" data-action="bank-match-journal" data-id="${escapeHtml(transaction.id)}">Post Journal</button>`
                  : ""
              }
              <button class="ghost-button action-button" data-action="bank-ignore" data-id="${escapeHtml(transaction.id)}">${transaction.status === "ignored" ? "Restore" : "Ignore"}</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderReconciliationQueue() {
  const queue = state.app.banking?.exceptionQueue || [];

  if (!queue.length) {
    empty(el.bankReconciliationList, "No reconciliation exceptions. Bank activity is clear.");
    return;
  }

  el.bankReconciliationList.innerHTML = queue
    .map(
      (transaction) => `
        <article class="data-row compact-row">
          <div>
            <h4>${escapeHtml(transaction.accountName)} | ${escapeHtml(transaction.description)}</h4>
            <small>${escapeHtml(transaction.postedDate)} | ${currency(Math.abs(transaction.amount))}</small>
            <small>${transaction.suggestion ? `Suggested ${escapeHtml(transaction.suggestion.targetType)}: ${escapeHtml(transaction.suggestion.label)}` : "Manual review required"}</small>
          </div>
        </article>
      `
    )
    .join("");
}

function renderRecurringTemplates() {
  if (!state.app.recurringTemplates.length) {
    empty(el.recurringList, "No recurring templates yet.");
    return;
  }

  el.recurringList.innerHTML = state.app.recurringTemplates
    .map(
      (template) => `
        <article class="data-row">
          <div>
            <h4>${escapeHtml(template.label)}</h4>
            <p>${escapeHtml(template.description)}</p>
            <small>${escapeHtml(template.type)} | ${escapeHtml(template.interval)} | next ${escapeHtml(template.nextDate)}</small>
          </div>
          <div class="row-meta">
            <strong>${currency(template.subtotal)}</strong>
            <span>${template.active ? "active" : "inactive"}</span>
            <button class="ghost-button action-button" data-action="run-recurring" data-id="${escapeHtml(template.id)}">Run Now</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderChecklist() {
  if (!state.app.closeChecklist.length) {
    empty(el.checklistList, "No close checklist items.");
    return;
  }

  el.checklistList.innerHTML = state.app.closeChecklist
    .map(
      (item) => `
        <article class="data-row compact-row">
          <div>
            <h4>${escapeHtml(item.label)}</h4>
            <small>${item.done ? "Completed" : "Open"}</small>
          </div>
          <div class="row-meta">
            <button class="ghost-button action-button" data-action="toggle-checklist" data-id="${escapeHtml(item.id)}">${item.done ? "Mark Open" : "Mark Done"}</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderSelectOptions() {
  const clientOptions = state.app.clients
    .map((client) => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`)
    .join("");
  const vendorOptions = state.app.vendors
    .map((vendor) => `<option value="${escapeHtml(vendor.id)}">${escapeHtml(vendor.name)}</option>`)
    .join("");
  const accountOptions = state.app.accounts
    .map((account) => `<option value="${escapeHtml(account.code)}">${escapeHtml(account.code)} | ${escapeHtml(account.name)}</option>`)
    .join("");
  const expenseOptions = state.app.accounts
    .filter((account) => account.type === "expense")
    .map((account) => `<option value="${escapeHtml(account.code)}">${escapeHtml(account.code)} | ${escapeHtml(account.name)}</option>`)
    .join("");

  document.getElementById("invoice-client").innerHTML = clientOptions;
  document.getElementById("bill-vendor").innerHTML = vendorOptions;
  document.getElementById("po-vendor").innerHTML = vendorOptions;
  document.getElementById("journal-debit").innerHTML = accountOptions;
  document.getElementById("journal-credit").innerHTML = accountOptions;
  document.getElementById("bill-account").innerHTML = expenseOptions || accountOptions;
  document.getElementById("recurring-client").innerHTML = `<option value="">Select client</option>${clientOptions}`;
  document.getElementById("recurring-vendor").innerHTML = `<option value="">Select vendor</option>${vendorOptions}`;
  document.getElementById("recurring-expense-account").innerHTML = expenseOptions || accountOptions;
}

function renderWorkspace() {
  el.companyName.textContent = `${state.app.company.name} Workspace`;
  el.companyNameInput.value = state.app.company.name;
  el.companyCurrencyInput.value = state.app.company.currency;
  el.companyTaxNameInput.value = state.app.company.taxName;
  el.companyTaxRateInput.value = state.app.company.defaultTaxRate;
  el.invoiceTaxRateInput.value = state.app.company.defaultTaxRate;
  el.billTaxRateInput.value = state.app.company.defaultTaxRate;
  el.recurringTaxRateInput.value = state.app.company.defaultTaxRate;
  renderSummaryCards();
  renderSelectOptions();
  renderInvoices();
  renderBills();
  renderPurchaseOrders();
  renderAccounts();
  renderJournals();
  renderTaxAndReports();
  renderMasterLists();
  renderBank();
  renderBankTimeline();
  renderBankTransactions();
  renderReconciliationQueue();
  renderRecurringTemplates();
  renderChecklist();
}

async function refreshApp() {
  state.app = await api("/api/app/bootstrap", { method: "GET", headers: {} });
  state.bank = await api("/api/rbc/status", { method: "GET", headers: {} });
  renderWorkspace();
}

async function submitJsonForm(form, path, transform) {
  const formData = new FormData(form);
  const payload = transform(Object.fromEntries(formData.entries()));
  const result = await api(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.app = result.app;
  renderWorkspace();
  form.reset();
}

function updateLocalApp(result) {
  state.app = result.app;
  renderWorkspace();
}

async function promptAndPost(path, bodyFactory) {
  const body = bodyFactory();

  if (!body) {
    return;
  }

  const result = await api(path, { method: "POST", body: JSON.stringify(body) });
  updateLocalApp(result);
}

el.adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    el.adminMessage.textContent = "Signing in...";
    const payload = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        email: el.adminEmailInput.value,
        username: el.adminUsernameInput.value,
        password: el.adminPasswordInput.value,
      }),
    });
    el.adminPasswordInput.value = "";
    setAdminUi(payload);
    await refreshApp();
  } catch (error) {
    el.adminPasswordInput.value = "";
    el.adminMessage.textContent = error.message;
  }
});

el.adminLogoutButton.addEventListener("click", async () => {
  try {
    const payload = await api("/api/admin/logout", { method: "POST", body: JSON.stringify({}) });
    state.app = null;
    state.bank = null;
    setAdminUi(payload);
  } catch (error) {
    el.adminMessage.textContent = error.message;
  }
});

el.clientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(el.clientForm, "/api/clients", (payload) => payload);
});

el.vendorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(el.vendorForm, "/api/vendors", (payload) => payload);
});

el.companyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(el.companyForm, "/api/company", (payload) => ({
    ...payload,
    defaultTaxRate: Number(payload.defaultTaxRate),
    currency: String(payload.currency || "").toUpperCase(),
  }));
});

el.accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(el.accountForm, "/api/accounts", (payload) => payload);
});

el.invoiceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(el.invoiceForm, "/api/invoices", (payload) => ({
    ...payload,
    subtotal: Number(payload.subtotal),
    taxRate: Number(payload.taxRate),
  }));
});

el.billForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(el.billForm, "/api/bills", (payload) => ({
    ...payload,
    subtotal: Number(payload.subtotal),
    taxRate: Number(payload.taxRate),
  }));
});

el.purchaseOrderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(el.purchaseOrderForm, "/api/purchase-orders", (payload) => ({
    ...payload,
    amount: Number(payload.amount),
  }));
});

el.journalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(el.journalForm, "/api/journal-entries", (payload) => ({
    ...payload,
    amount: Number(payload.amount),
  }));
});

el.recurringForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(el.recurringForm, "/api/recurring-templates", (payload) => ({
    ...payload,
    subtotal: Number(payload.subtotal),
    taxRate: Number(payload.taxRate),
  }));
});

el.bankTransactionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(el.bankTransactionForm, "/api/bank/transactions", (payload) => ({
    ...payload,
    amount: Number(payload.amount),
  }));
});

el.pageButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActivePage(button.dataset.page);
  });
});

el.sidebarToggle.addEventListener("click", () => {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem("count123:sidebar-collapsed", String(state.sidebarCollapsed));
  applySidebarState();
});

document.body.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  try {
    if (button.dataset.action === "pay-invoice") {
      await promptAndPost(`/api/invoices/${button.dataset.id}/pay`, () => {
        const amount = window.prompt("Payment amount");
        if (!amount) return null;
        return { paymentDate: today(), amount: Number(amount) };
      });
    }

    if (button.dataset.action === "invoice-status") {
      await promptAndPost(`/api/invoices/${button.dataset.id}/status`, () => {
        const status = window.prompt("Invoice status", "sent");
        if (!status) return null;
        return { status };
      });
    }

    if (button.dataset.action === "invoice-note") {
      await promptAndPost(`/api/invoices/${button.dataset.id}/status`, () => {
        const notes = window.prompt("Invoice note");
        if (notes === null) return null;
        return { notes };
      });
    }

    if (button.dataset.action === "pay-bill") {
      await promptAndPost(`/api/bills/${button.dataset.id}/pay`, () => {
        const amount = window.prompt("Payment amount");
        if (!amount) return null;
        return { paymentDate: today(), amount: Number(amount) };
      });
    }

    if (button.dataset.action === "bill-status") {
      await promptAndPost(`/api/bills/${button.dataset.id}/status`, () => {
        const status = window.prompt("Bill status", "open");
        if (!status) return null;
        return { status };
      });
    }

    if (button.dataset.action === "bill-note") {
      await promptAndPost(`/api/bills/${button.dataset.id}/status`, () => {
        const notes = window.prompt("Bill note");
        if (notes === null) return null;
        return { notes };
      });
    }

    if (button.dataset.action === "po-status") {
      await promptAndPost(`/api/purchase-orders/${button.dataset.id}/status`, () => {
        const status = window.prompt("PO status", "approved");
        if (!status) return null;
        return { status };
      });
    }

    if (button.dataset.action === "po-note") {
      await promptAndPost(`/api/purchase-orders/${button.dataset.id}/status`, () => {
        const notes = window.prompt("Purchase order note");
        if (notes === null) return null;
        return { notes };
      });
    }

    if (button.dataset.action === "convert-po") {
      await promptAndPost(`/api/purchase-orders/${button.dataset.id}/convert`, () => ({
        issueDate: today(),
        dueDate: today(),
        taxRate: state.app.company.defaultTaxRate,
        expenseAccountCode: "6100",
      }));
    }

    if (button.dataset.action === "run-recurring") {
      await promptAndPost(`/api/recurring-templates/${button.dataset.id}/run`, () => ({
        runDate: today(),
        dueDate: today(),
      }));
    }

    if (button.dataset.action === "toggle-checklist") {
      await promptAndPost(`/api/close-checklist/${button.dataset.id}/toggle`, () => ({}));
    }

    if (button.dataset.action === "bank-match-suggested") {
      const transaction = state.app.banking.transactions.find((item) => item.id === button.dataset.id);
      if (!transaction?.suggestion) {
        return;
      }

      await promptAndPost(`/api/bank/transactions/${button.dataset.id}/match`, () => ({
        matchType: transaction.suggestion.targetType,
        targetId: transaction.suggestion.targetId,
        paymentDate: transaction.postedDate,
        amount: Math.abs(Number(transaction.amount)),
      }));
    }

    if (button.dataset.action === "bank-match-record") {
      const kind = button.dataset.kind;
      const rawIdentifier = window.prompt(
        `${kind === "invoice" ? "Invoice" : "Bill"} number or id`
      );
      if (!rawIdentifier) return;

      const record = kind === "invoice" ? findInvoice(rawIdentifier) : findBill(rawIdentifier);
      if (!record) {
        throw new Error(`${kind === "invoice" ? "Invoice" : "Bill"} not found.`);
      }

      const transaction = state.app.banking.transactions.find((item) => item.id === button.dataset.id);
      await promptAndPost(`/api/bank/transactions/${button.dataset.id}/match`, () => ({
        matchType: kind,
        targetId: record.id,
        paymentDate: transaction?.postedDate || today(),
        amount: Math.abs(Number(transaction?.amount || 0)),
      }));
    }

    if (button.dataset.action === "bank-match-journal") {
      const transaction = state.app.banking.transactions.find((item) => item.id === button.dataset.id);
      const offsetAccountCode = window.prompt("Offset account code", "6100");
      if (!offsetAccountCode) return;
      const memo = window.prompt("Journal memo", transaction?.description || "Bank transaction");
      if (memo === null) return;

      await promptAndPost(`/api/bank/transactions/${button.dataset.id}/match`, () => ({
        matchType: "journal",
        offsetAccountCode,
        memo,
        paymentDate: transaction?.postedDate || today(),
      }));
    }

    if (button.dataset.action === "bank-ignore") {
      await promptAndPost(`/api/bank/transactions/${button.dataset.id}/ignore`, () => ({}));
    }
  } catch (error) {
    el.adminMessage.textContent = error.message;
  }
});

el.connectBankButton.addEventListener("click", async () => {
  try {
    const payload = await api("/api/rbc/connect-url", { method: "GET", headers: {} });
    window.location.href = payload.url;
  } catch (error) {
    el.adminMessage.textContent = error.message;
  }
});

el.syncBankButton.addEventListener("click", async () => {
  try {
    const result = await api("/api/bank/sync", { method: "POST", body: JSON.stringify({}) });
    state.app = result.app;
    state.bank = result.bank || (await api("/api/rbc/status", { method: "GET", headers: {} }));
    renderWorkspace();
  } catch (error) {
    el.adminMessage.textContent = error.message;
  }
});

async function initialize() {
  try {
    initializeWorkspaceChrome();
    const adminStatus = await api("/api/admin/status", { method: "GET", headers: {} });
    setAdminUi(adminStatus);
    if (adminStatus.authenticated) {
      await refreshApp();
    }
  } catch (error) {
    el.adminMessage.textContent = error.message;
  }
}

initialize();
