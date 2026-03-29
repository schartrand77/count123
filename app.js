const state = { app: null, bank: null };

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
  companyName: document.getElementById("company-name"),
  summaryGrid: document.getElementById("summary-grid"),
  bankSummaryGrid: document.getElementById("bank-summary-grid"),
  bankAccounts: document.getElementById("bank-accounts"),
  invoiceList: document.getElementById("invoice-list"),
  billList: document.getElementById("bill-list"),
  purchaseOrderList: document.getElementById("purchase-order-list"),
  accountList: document.getElementById("account-list"),
  journalList: document.getElementById("journal-list"),
  taxGrid: document.getElementById("tax-grid"),
  reportGrid: document.getElementById("report-grid"),
  clientList: document.getElementById("client-list"),
  vendorList: document.getElementById("vendor-list"),
  recurringList: document.getElementById("recurring-list"),
  checklistList: document.getElementById("checklist-list"),
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
  companyNameInput: document.getElementById("company-name-input"),
  companyCurrencyInput: document.getElementById("company-currency-input"),
  companyTaxNameInput: document.getElementById("company-tax-name-input"),
  companyTaxRateInput: document.getElementById("company-tax-rate-input"),
  invoiceTaxRateInput: document.getElementById("invoice-tax-rate"),
  billTaxRateInput: document.getElementById("bill-tax-rate"),
  recurringTaxRateInput: document.getElementById("recurring-tax-rate"),
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
  if (!state.app.clients.length) {
    empty(el.clientList, "No clients yet.");
  } else {
    el.clientList.innerHTML = state.app.clients
      .map(
        (client) => `
          <article class="mini-row">
            <strong>${escapeHtml(client.name)}</strong>
            <small>${escapeHtml(client.email || "No email")}</small>
          </article>
        `
      )
      .join("");
  }

  if (!state.app.vendors.length) {
    empty(el.vendorList, "No vendors yet.");
  } else {
    el.vendorList.innerHTML = state.app.vendors
      .map(
        (vendor) => `
          <article class="mini-row">
            <strong>${escapeHtml(vendor.name)}</strong>
            <small>${escapeHtml(vendor.email || "No email")}</small>
          </article>
        `
      )
      .join("");
  }
}

function renderBank() {
  const bank = state.bank || { configured: false, connected: false, accounts: [] };
  el.bankSummaryGrid.innerHTML = [
    { label: "Status", value: bank.connected ? "Connected" : bank.configured ? "Ready" : "Not configured" },
    { label: "Accounts", value: String(bank.accounts.length) },
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

  if (!bank.accounts.length) {
    empty(el.bankAccounts, "Connect RBC after signing in to sync bank balances.");
  } else {
    el.bankAccounts.innerHTML = bank.accounts
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

async function initialize() {
  try {
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
