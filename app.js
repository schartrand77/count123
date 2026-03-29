const datasets = {
  "7d": [
    { label: "Cash", value: "$248,900", note: "Across 4 accounts" },
    { label: "Accounts Receivable", value: "$83,410", note: "11 invoices outstanding" },
    { label: "Accounts Payable", value: "$26,190", note: "6 bills due this week" },
    { label: "Net Income", value: "$41,870", note: "Month to date" },
  ],
  "30d": [
    { label: "Cash", value: "$261,220", note: "Average ending balance" },
    { label: "Accounts Receivable", value: "$102,780", note: "Net 18 day collection cycle" },
    { label: "Accounts Payable", value: "$38,420", note: "2 vendor batches pending" },
    { label: "Net Income", value: "$58,330", note: "Trailing 30 days" },
  ],
  "90d": [
    { label: "Cash", value: "$233,480", note: "Volatility down 8.2%" },
    { label: "Accounts Receivable", value: "$118,640", note: "Expansion invoices increased" },
    { label: "Accounts Payable", value: "$42,160", note: "Prepaid software renewals included" },
    { label: "Net Income", value: "$146,210", note: "Quarter to date" },
  ],
};

const journalEntries = [
  {
    title: "March subscription close",
    meta: "2026-03-29 • Revenue recognition",
    lines: "Dr Deferred Revenue / Cr SaaS Revenue",
    amount: "$18,400",
  },
  {
    title: "Payroll accrual",
    meta: "2026-03-28 • Accruals",
    lines: "Dr Payroll Expense / Cr Accrued Liabilities",
    amount: "$12,930",
  },
  {
    title: "AWS invoice posted",
    meta: "2026-03-27 • Accounts payable",
    lines: "Dr Hosting Expense / Cr Accounts Payable",
    amount: "$4,280",
  },
];

const statsGrid = document.getElementById("stats-grid");
const rangeSwitcher = document.getElementById("range-switcher");
const journalList = document.getElementById("journal-list");
const postEntryButton = document.getElementById("post-entry");

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
    title: "Cash receipt batch",
    meta: `${today} • Bank sync`,
    lines: "Dr Cash / Cr Accounts Receivable",
    amount: "$9,640",
  });

  if (journalEntries.length > 5) {
    journalEntries.pop();
  }

  renderJournalEntries();
});

renderStats("7d");
renderJournalEntries();
