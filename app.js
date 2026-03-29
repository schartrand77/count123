const state = {
  app: null,
  bank: null,
};

const adminBadge = document.getElementById("admin-badge");
const adminLogoutButton = document.getElementById("admin-logout");
const adminLoginForm = document.getElementById("admin-login-form");
const adminEmailInput = document.getElementById("admin-email");
const adminUsernameInput = document.getElementById("admin-username");
const adminPasswordInput = document.getElementById("admin-password");
const adminLoginSubmit = document.getElementById("admin-login-submit");
const adminMessage = document.getElementById("admin-message");
const authPanel = document.getElementById("auth-panel");
const workspace = document.getElementById("workspace");
const companyName = document.getElementById("company-name");
const summaryGrid = document.getElementById("summary-grid");
const bankSummaryGrid = document.getElementById("bank-summary-grid");
const bankAccounts = document.getElementById("bank-accounts");
const invoiceList = document.getElementById("invoice-list");
const billList = document.getElementById("bill-list");
const purchaseOrderList = document.getElementById("purchase-order-list");
const accountList = document.getElementById("account-list");
const journalList = document.getElementById("journal-list");
const taxGrid = document.getElementById("tax-grid");
const reportGrid = document.getElementById("report-grid");
const clientList = document.getElementById("client-list");
const vendorList = document.getElementById("vendor-list");
const connectBankButton = document.getElementById("connect-bank");

const clientForm = document.getElementById("client-form");
const vendorForm = document.getElementById("vendor-form");
const companyForm = document.getElementById("company-form");
const accountForm = document.getElementById("account-form");
const invoiceForm = document.getElementById("invoice-form");
const billForm = document.getElementById("bill-form");
const purchaseOrderForm = document.getElementById("purchase-order-form");
const journalForm = document.getElementById("journal-form");
const companyNameInput = document.getElementById("company-name-input");
const companyCurrencyInput = document.getElementById("company-currency-input");
const companyTaxNameInput = document.getElementById("company-tax-name-input");
const companyTaxRateInput = document.getElementById("company-tax-rate-input");
const invoiceTaxRateInput = document.getElementById("invoice-tax-rate");
const billTaxRateInput = document.getElementById("bill-tax-rate");

function currency(value) {
  const currencyCode = state.app?.company?.currency || "CAD";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currencyCode,
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
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function setAdminUi(adminStatus) {
  const configured = Boolean(adminStatus?.configured);
  const authenticated = Boolean(adminStatus?.authenticated);

  adminBadge.textContent = authenticated
    ? `Admin online: ${adminStatus.username}`
    : configured
      ? "Admin offline"
      : "Admin unconfigured";

  adminLogoutButton.disabled = !authenticated;
  adminLoginSubmit.disabled = !configured || authenticated;
  adminEmailInput.disabled = !configured || authenticated;
  adminUsernameInput.disabled = !configured || authenticated;
  adminPasswordInput.disabled = !configured || authenticated;

  authPanel.hidden = authenticated;
  workspace.hidden = !authenticated;

  if (!configured) {
    adminMessage.textContent =
      "Configure ADMIN_EMAIL, ADMIN_USERNAME, and ADMIN_PASSWORD_HASH first.";
  } else if (!authenticated) {
    adminMessage.textContent =
      "Enter the configured admin credentials to access the accounting workspace.";
  }
}

function renderSimpleList(target, rows, config) {
  if (!rows.length) {
    target.innerHTML = `<p class="empty-state">${config.empty}</p>`;
    return;
  }

  target.innerHTML = rows.map((row) => config.render(row)).join("");
}

function renderSummaryCards() {
  const summary = state.app.summary;

  summaryGrid.innerHTML = [
    { label: "Cash", value: currency(summary.cash), note: "Live balance from journals" },
    { label: "Open Invoices", value: currency(summary.openInvoices), note: "Outstanding receivables" },
    { label: "Payables Due", value: currency(summary.payablesDue), note: "Open supplier obligations" },
    { label: "Net Income", value: currency(summary.netIncome), note: "Derived from posted entries" },
    {
      label: `${state.app.company.taxName} Payable`,
      value: currency(summary.taxPayable),
      note: `Current ${state.app.company.taxName} position`,
    },
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

function renderInvoices() {
  renderSimpleList(invoiceList, state.app.invoices, {
    empty: "No invoices posted yet.",
    render: (invoice) => `
      <article class="data-row">
        <div>
          <h4>${escapeHtml(invoice.number)} | ${escapeHtml(invoice.clientName)}</h4>
          <p>${escapeHtml(invoice.description)}</p>
          <small>Issued ${escapeHtml(invoice.issueDate)} | Due ${escapeHtml(invoice.dueDate)}</small>
        </div>
        <div class="row-meta">
          <strong>${currency(invoice.total)}</strong>
          <span>${escapeHtml(invoice.status)}</span>
          <small>Balance ${currency(invoice.balanceDue)}</small>
          ${
            invoice.status !== "paid"
              ? `<button class="ghost-button action-button" data-action="pay-invoice" data-id="${escapeHtml(invoice.id)}">Record Payment</button>`
              : ""
          }
        </div>
      </article>
    `,
  });
}

function renderBills() {
  renderSimpleList(billList, state.app.bills, {
    empty: "No bills posted yet.",
    render: (bill) => `
      <article class="data-row">
        <div>
          <h4>${escapeHtml(bill.number)} | ${escapeHtml(bill.vendorName)}</h4>
          <p>${escapeHtml(bill.description)}</p>
          <small>Issued ${escapeHtml(bill.issueDate)} | Due ${escapeHtml(bill.dueDate)}</small>
        </div>
        <div class="row-meta">
          <strong>${currency(bill.total)}</strong>
          <span>${escapeHtml(bill.status)}</span>
          <small>Balance ${currency(bill.balanceDue)}</small>
          ${
            bill.status !== "paid"
              ? `<button class="ghost-button action-button" data-action="pay-bill" data-id="${escapeHtml(bill.id)}">Mark Paid</button>`
              : ""
          }
        </div>
      </article>
    `,
  });
}

function renderPurchaseOrders() {
  renderSimpleList(purchaseOrderList, state.app.purchaseOrders, {
    empty: "No purchase orders created yet.",
    render: (order) => `
      <article class="data-row">
        <div>
          <h4>${escapeHtml(order.number)} | ${escapeHtml(order.vendorName)}</h4>
          <p>${escapeHtml(order.description)}</p>
          <small>Expected ${escapeHtml(order.expectedDate)}</small>
        </div>
        <div class="row-meta">
          <strong>${currency(order.amount)}</strong>
          <span>${escapeHtml(order.status)}</span>
          ${
            order.status === "open"
              ? `<button class="ghost-button action-button" data-action="convert-po" data-id="${escapeHtml(order.id)}">Convert to Bill</button>`
              : ""
          }
        </div>
      </article>
    `,
  });
}

function renderAccounts() {
  renderSimpleList(accountList, state.app.accounts, {
    empty: "No accounts available.",
    render: (account) => `
      <article class="table-row">
        <div><span>Code</span><strong>${escapeHtml(account.code)}</strong></div>
        <div><span>Account</span><strong>${escapeHtml(account.name)}</strong></div>
        <div><span>Type</span><strong>${escapeHtml(account.type)}</strong></div>
        <div><span>Balance</span><strong>${currency(account.balance)}</strong></div>
      </article>
    `,
  });
}

function renderJournals() {
  renderSimpleList(journalList, state.app.journalEntries, {
    empty: "No journal entries posted yet.",
    render: (entry) => `
      <article class="data-row">
        <div>
          <h4>${escapeHtml(entry.reference)} | ${escapeHtml(entry.memo)}</h4>
          <p>${entry.lines
            .map(
              (line) =>
                `${escapeHtml(line.accountCode)} Dr ${currency(line.debit)} / Cr ${currency(line.credit)}`
            )
            .join("<br />")}</p>
          <small>${escapeHtml(entry.date)} | ${escapeHtml(entry.sourceType)}</small>
        </div>
      </article>
    `,
  });
}

function renderTaxAndReports() {
  const tax = state.app.tax;
  const reports = state.app.reports;

  taxGrid.innerHTML = [
    { label: `Collected ${state.app.company.taxName}`, value: currency(tax.collected) },
    { label: `Recoverable ${state.app.company.taxName}`, value: currency(tax.recoverable) },
    { label: `Net ${state.app.company.taxName}`, value: currency(tax.netRemittance) },
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

  reportGrid.innerHTML = `
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
  renderSimpleList(clientList, state.app.clients, {
    empty: "No clients yet.",
    render: (client) => `
      <article class="mini-row">
        <strong>${escapeHtml(client.name)}</strong>
        <small>${escapeHtml(client.email || "No email")}</small>
      </article>
    `,
  });

  renderSimpleList(vendorList, state.app.vendors, {
    empty: "No vendors yet.",
    render: (vendor) => `
      <article class="mini-row">
        <strong>${escapeHtml(vendor.name)}</strong>
        <small>${escapeHtml(vendor.email || "No email")}</small>
      </article>
    `,
  });
}

function renderBank() {
  const bank = state.bank || { configured: false, connected: false, accounts: [] };

  bankSummaryGrid.innerHTML = [
    {
      label: "Status",
      value: bank.connected ? "Connected" : bank.configured ? "Ready" : "Not configured",
    },
    { label: "Accounts", value: String(bank.accounts.length) },
    {
      label: "Last Sync",
      value: bank.lastSyncAt ? new Date(bank.lastSyncAt).toLocaleString() : "Pending",
    },
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

  renderSimpleList(bankAccounts, bank.accounts, {
    empty: "Connect RBC after signing in to sync bank balances.",
    render: (account) => `
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
    `,
  });

  connectBankButton.disabled = !bank.configured;
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
}

function renderWorkspace() {
  companyName.textContent = `${state.app.company.name} Workspace`;
  companyNameInput.value = state.app.company.name;
  companyCurrencyInput.value = state.app.company.currency;
  companyTaxNameInput.value = state.app.company.taxName;
  companyTaxRateInput.value = state.app.company.defaultTaxRate;
  invoiceTaxRateInput.value = state.app.company.defaultTaxRate;
  billTaxRateInput.value = state.app.company.defaultTaxRate;
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    adminMessage.textContent = "Signing in...";
    const payload = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        email: adminEmailInput.value,
        username: adminUsernameInput.value,
        password: adminPasswordInput.value,
      }),
    });

    adminPasswordInput.value = "";
    setAdminUi(payload);
    await refreshApp();
  } catch (error) {
    adminPasswordInput.value = "";
    adminMessage.textContent = error.message;
  }
});

adminLogoutButton.addEventListener("click", async () => {
  try {
    const payload = await api("/api/admin/logout", {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.app = null;
    state.bank = null;
    setAdminUi(payload);
  } catch (error) {
    adminMessage.textContent = error.message;
  }
});

clientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(clientForm, "/api/clients", (payload) => payload);
});

vendorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(vendorForm, "/api/vendors", (payload) => payload);
});

companyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(companyForm, "/api/company", (payload) => ({
    ...payload,
    defaultTaxRate: Number(payload.defaultTaxRate),
    currency: String(payload.currency || "").toUpperCase(),
  }));
});

accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(accountForm, "/api/accounts", (payload) => payload);
});

invoiceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(invoiceForm, "/api/invoices", (payload) => ({
    ...payload,
    subtotal: Number(payload.subtotal),
    taxRate: Number(payload.taxRate),
  }));
});

billForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(billForm, "/api/bills", (payload) => ({
    ...payload,
    subtotal: Number(payload.subtotal),
    taxRate: Number(payload.taxRate),
  }));
});

purchaseOrderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(purchaseOrderForm, "/api/purchase-orders", (payload) => ({
    ...payload,
    amount: Number(payload.amount),
  }));
});

journalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitJsonForm(journalForm, "/api/journal-entries", (payload) => ({
    ...payload,
    amount: Number(payload.amount),
  }));
});

document.body.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");

  if (!button) {
    return;
  }

  try {
    if (button.dataset.action === "pay-invoice") {
      const result = await api(`/api/invoices/${button.dataset.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ paymentDate: today() }),
      });
      state.app = result.app;
      renderWorkspace();
    }

    if (button.dataset.action === "pay-bill") {
      const result = await api(`/api/bills/${button.dataset.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ paymentDate: today() }),
      });
      state.app = result.app;
      renderWorkspace();
    }

    if (button.dataset.action === "convert-po") {
      const result = await api(`/api/purchase-orders/${button.dataset.id}/convert`, {
        method: "POST",
        body: JSON.stringify({
          issueDate: today(),
          dueDate: today(),
          taxRate: state.app.company.defaultTaxRate,
          expenseAccountCode: "6100",
        }),
      });
      state.app = result.app;
      renderWorkspace();
    }
  } catch (error) {
    adminMessage.textContent = error.message;
  }
});

connectBankButton.addEventListener("click", async () => {
  try {
    const payload = await api("/api/rbc/connect-url", { method: "GET", headers: {} });
    window.location.href = payload.url;
  } catch (error) {
    adminMessage.textContent = error.message;
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
    adminMessage.textContent = error.message;
  }
}

initialize();
