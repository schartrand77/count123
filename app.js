const datasets = {
  "7d": [
    { label: "Cash", value: "$24,900", note: "Chequing and savings" },
    { label: "Open Invoices", value: "$8,340", note: "4 clients outstanding" },
    { label: "Payables Due", value: "$2,190", note: "3 supplier bills this week" },
    { label: "Net Income", value: "$6,870", note: "Month to date after expenses" },
  ],
  "30d": [
    { label: "Cash", value: "$26,120", note: "Average ending balance" },
    { label: "Open Invoices", value: "$10,280", note: "Average 12 day collection cycle" },
    { label: "Payables Due", value: "$3,420", note: "Vendors and software renewals" },
    { label: "Net Income", value: "$8,330", note: "Trailing 30 days" },
  ],
  "90d": [
    { label: "Cash", value: "$23,480", note: "Volatility down 8.2%" },
    { label: "Open Invoices", value: "$11,640", note: "Project invoices increased" },
    { label: "Payables Due", value: "$4,160", note: "Equipment and contractor bills" },
    { label: "Net Income", value: "$14,210", note: "Quarter to date" },
  ],
};

const journalEntries = [
  {
    title: "Client invoice recorded",
    meta: "2026-03-29 | Consulting income",
    lines: "Dr Accounts Receivable / Cr Service Revenue",
    amount: "$1,840",
  },
  {
    title: "Supplier bill posted",
    meta: "2026-03-28 | Accounts payable",
    lines: "Dr Office Expense / Cr Accounts Payable",
    amount: "$329",
  },
  {
    title: "Bank reconciliation adjustment",
    meta: "2026-03-27 | Month-end close",
    lines: "Dr Bank Charges / Cr Cash",
    amount: "$428",
  },
];

const statsGrid = document.getElementById("stats-grid");
const rangeSwitcher = document.getElementById("range-switcher");
const journalList = document.getElementById("journal-list");
const postEntryButton = document.getElementById("post-entry");
const connectBankButton = document.getElementById("connect-bank");
const bankStatus = document.getElementById("bank-status");
const bankStatusNote = document.getElementById("bank-status-note");
const bankAccountCount = document.getElementById("bank-account-count");
const bankAccountNote = document.getElementById("bank-account-note");
const bankLastSync = document.getElementById("bank-last-sync");
const bankLastSyncNote = document.getElementById("bank-last-sync-note");
const bankAccounts = document.getElementById("bank-accounts");

function renderStats(range) {
  statsGrid.innerHTML = "";

  datasets[range].forEach((item) => {
    const card = document.createElement("article");
    card.className = "stat-card";
    card.innerHTML = `
      <span>${item.label}</span>
      <strong>${item.value}</strong>
      <small>${item.note}</small>
    `;
    statsGrid.appendChild(card);
  });
}

function renderJournalEntries() {
  journalList.innerHTML = "";

  journalEntries.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "journal-item";
    item.innerHTML = `
      <div>
        <h5>${entry.title}</h5>
        <p class="journal-meta">${entry.meta}</p>
        <p class="journal-lines">${entry.lines}</p>
      </div>
      <div class="journal-amount">${entry.amount}</div>
    `;
    journalList.appendChild(item);
  });
}

function formatTimestamp(value) {
  if (!value) {
    return "Pending";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Pending";
  }

  return date.toLocaleString();
}

function renderBankAccounts(accounts) {
  if (!accounts.length) {
    bankAccounts.innerHTML =
      '<p class="bank-empty">Connect RBC to load business bank accounts and balances into Count123.</p>';
    return;
  }

  bankAccounts.innerHTML = accounts
    .map((account) => {
      const balance = account.balance ?? account.availableBalance ?? "Unavailable";
      const currency = account.currency ?? "CAD";
      const type = account.type ?? "Business account";

      return `
        <article class="journal-item">
          <div>
            <h5>${account.name ?? "Unnamed account"}</h5>
            <p class="journal-meta">${type}</p>
            <p class="journal-lines">${account.id ?? "No account identifier returned"}</p>
          </div>
          <div class="journal-amount">${balance} ${currency}</div>
        </article>
      `;
    })
    .join("");
}

async function loadBankStatus() {
  try {
    const response = await fetch("/api/rbc/status");
    const payload = await response.json();

    bankStatus.textContent = payload.connected
      ? "Connected"
      : payload.configured
        ? "Ready to connect"
        : "Not configured";

    bankStatusNote.textContent = payload.connected
      ? "OAuth credentials are configured and an access token is active."
      : payload.configured
        ? "Server credentials are present. Connect RBC to sync account data."
        : "Add RBC API credentials in the server environment.";

    bankAccountCount.textContent = String(payload.accounts.length);
    bankAccountNote.textContent = payload.connected
      ? "Accounts returned from the configured RBC accounts endpoint."
      : "No account data has been synced yet.";

    bankLastSync.textContent = formatTimestamp(payload.lastSyncAt);
    bankLastSyncNote.textContent = payload.lastSyncAt
      ? "Latest successful account sync from the bank API."
      : "Waiting for a successful bank connection.";

    renderBankAccounts(payload.accounts);

    if (connectBankButton) {
      connectBankButton.disabled = !payload.configured;
      connectBankButton.textContent = payload.connected ? "Reconnect RBC" : "Connect RBC";
    }
  } catch (error) {
    bankStatus.textContent = "Unavailable";
    bankStatusNote.textContent = "The bank integration endpoint is not responding.";
  }
}

rangeSwitcher.addEventListener("click", (event) => {
  const button = event.target.closest("[data-range]");

  if (!button) {
    return;
  }

  rangeSwitcher.querySelectorAll(".pill").forEach((pill) => {
    pill.classList.remove("active");
  });

  button.classList.add("active");
  renderStats(button.dataset.range);
});

postEntryButton.addEventListener("click", () => {
  const today = new Date().toISOString().slice(0, 10);

  journalEntries.unshift({
    title: "Purchase order converted to bill",
    meta: `${today} | Purchasing workflow`,
    lines: "Dr Inventory or Expense / Cr Accounts Payable",
    amount: "$960",
  });

  if (journalEntries.length > 5) {
    journalEntries.pop();
  }

  renderJournalEntries();
});

connectBankButton?.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/rbc/connect-url");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to build RBC connect URL.");
    }

    window.location.href = payload.url;
  } catch (error) {
    bankStatus.textContent = "Connection blocked";
    bankStatusNote.textContent = error.message;
  }
});

renderStats("7d");
renderJournalEntries();
loadBankStatus();
