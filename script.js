/* =====================================================
   Spendly Pro — Expense & Earnings Tracker
   NOTE: accounts and data live in the browser (localStorage).
   Connect a real backend before storing sensitive data.
   ===================================================== */

const STORAGE_KEY = "spendly-expenses-v2";
const EARNINGS_KEY = "spendly-earnings-v2";
const AUTH_KEY = "spendly-session";
const USERS_KEY = "spendly-users-v1";
const DEMO_EMAIL = "demo@spendly.io";
const BUDGET_KEY = "spendly-budget-v1";
const DEMO_KEY = "spendly-demo-expiry";
const DEMO_MS = 2 * 60 * 1000; // demo length: 2 minutes

const CATEGORIES = {
  Food: { color: "#ff5a3c" }, Transport: { color: "#3b82f6" }, Shopping: { color: "#8b5cf6" },
  Bills: { color: "#e0a800" }, Entertainment: { color: "#34c77b" }, Health: { color: "#ec4899" }, Other: { color: "#64748b" },
};
const catColor = (n) => (CATEGORIES[n] ? CATEGORIES[n].color : "#64748b");

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const formatMoney = (n) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
function todayISO() {
  const n = new Date(), p = (x) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
let toastTimer;
function toast(msg, type = "ok", action) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show " + type;
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "toast-action"; btn.textContent = action.label;
    btn.onclick = () => { t.classList.remove("show"); action.fn(); };
    t.append(btn);
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), action ? 6000 : 2600);
}

/* ---------- state ---------- */
let currentUser = localStorage.getItem(AUTH_KEY);
let expenses = [], earnings = [];
let searchQuery = "", categoryFilter = "All", selectedCategory = "Food";
let period = todayISO().slice(0, 7), editingId = null, budget = 0;
let barChart = null, pieChart = null, lineChart = null;

const userKey = (base) => `${base}:${currentUser}`;
const getUsers = () => { try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; } catch (e) { return {}; } };

/* ---------- auth ---------- */
async function hashPassword(pw, salt) {
  if (!(window.crypto && crypto.subtle)) return btoa(salt + pw);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + pw));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function authError(id, msg) { $(id).textContent = msg; }
function startSession(email) {
  localStorage.setItem(AUTH_KEY, email);
  currentUser = email;
  document.querySelectorAll(".auth-form").forEach((f) => f.reset());
  authError("loginError", ""); authError("signupError", "");
  showAppScreen();
}

window.flipAuthCard = (showSignup) => {
  $("authFrontFace").classList.toggle("hidden-face", showSignup);
  $("authBackFace").classList.toggle("hidden-face", !showSignup);
};
window.handleLogin = async (e) => {
  e.preventDefault();
  const email = $("loginEmail").value.trim().toLowerCase();
  const user = getUsers()[email];
  if (!user || user.hash !== (await hashPassword($("loginPassword").value, user.salt))) {
    return authError("loginError", "Incorrect email or password.");
  }
  startSession(email);
};
window.handleSignup = async (e) => {
  e.preventDefault();
  const name = $("signupName").value.trim();
  const email = $("signupEmail").value.trim().toLowerCase();
  const pw = $("signupPassword").value;
  const users = getUsers();
  if (pw.length < 6) return authError("signupError", "Password must be at least 6 characters.");
  if (users[email]) return authError("signupError", "An account with this email already exists. Sign in instead.");
  const salt = uid();
  users[email] = { name, salt, hash: await hashPassword(pw, salt) };
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  startSession(email);
};
window.handleDemo = async () => {
  const users = getUsers();
  if (!users[DEMO_EMAIL]) {
    const salt = uid();
    users[DEMO_EMAIL] = { name: "Demo User", salt, hash: await hashPassword(uid(), salt) };
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }
  localStorage.setItem(DEMO_KEY, String(Date.now() + DEMO_MS));
  startSession(DEMO_EMAIL);
};

/* ---------- timed demo: 2 minutes, then wipe demo data and return to sign-up ---------- */
let demoTimer;
function eraseDemoData() {
  [STORAGE_KEY, EARNINGS_KEY, BUDGET_KEY].forEach((k) => localStorage.removeItem(`${k}:${DEMO_EMAIL}`));
}
function startDemoTimer() {
  clearInterval(demoTimer);
  const bar = $("demoBar");
  const tick = () => {
    const ms = Number(localStorage.getItem(DEMO_KEY)) - Date.now();
    if (ms <= 0) return endDemo();
    const s = Math.ceil(ms / 1000);
    $("demoLeft").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    bar.classList.toggle("urgent", s <= 30);
  };
  bar.classList.remove("hidden");
  tick();
  demoTimer = setInterval(tick, 1000);
}
function stopDemoTimer() { clearInterval(demoTimer); $("demoBar").classList.add("hidden"); }
function endDemo(early) {
  closeEarningsModal();
  cancelEdit();
  eraseDemoData(); // the demo account never keeps data past its session
  window.handleLogout();
  window.flipAuthCard(true); // open "Create your account"
  const note = $("authNotice");
  note.textContent = early ? "Demo data was cleared. Create an account to keep your own." : "Your 2-minute demo has ended and its data was cleared. Create an account to keep using Spendly.";
  note.classList.remove("hidden");
}

window.handleLogout = () => {
  stopDemoTimer();
  localStorage.removeItem(DEMO_KEY);
  $("authNotice").classList.add("hidden");
  localStorage.removeItem(AUTH_KEY);
  currentUser = null;
  expenses = []; earnings = [];
  window.flipAuthCard(false);
  $("authScreen").classList.remove("hidden");
  $("appScreen").classList.add("hidden");
};
function showAppScreen() {
  if (currentUser === DEMO_EMAIL) {
    if (Number(localStorage.getItem(DEMO_KEY)) <= Date.now()) return endDemo(); // demo time is already up
    startDemoTimer();
  } else stopDemoTimer();
  const user = getUsers()[currentUser];
  expenses = loadExpenses();
  earnings = loadEarnings();
  budget = Number(localStorage.getItem(userKey(BUDGET_KEY))) || 0;
  period = todayISO().slice(0, 7);
  $("userGreeting").textContent = "Hi, " + ((user && user.name) || "there").split(" ")[0];
  $("authScreen").classList.add("hidden");
  $("appScreen").classList.remove("hidden");
  renderCategoryChips();
  render();
}
window.addEventListener("DOMContentLoaded", () => {
  if (currentUser && getUsers()[currentUser]) showAppScreen();
  else { localStorage.removeItem(AUTH_KEY); currentUser = null; }
  $("date").value = todayISO();
});

/* ---------- storage ---------- */
function readList(key) {
  try { const raw = localStorage.getItem(userKey(key)); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function loadExpenses() {
  const saved = readList(STORAGE_KEY);
  if (saved) return saved;
  const seed = currentUser !== DEMO_EMAIL ? [] : [
    { id: uid(), title: "Groceries", amount: 1250, category: "Food", date: todayISO() },
    { id: uid(), title: "Auto ride", amount: 90, category: "Transport", date: todayISO() },
    { id: uid(), title: "Movie tickets", amount: 540, category: "Entertainment", date: todayISO() },
    { id: uid(), title: "Electricity bill", amount: 1830, category: "Bills", date: todayISO() },
  ];
  saveExpenses(seed);
  return seed;
}
function loadEarnings() {
  const saved = readList(EARNINGS_KEY);
  if (saved) return saved;
  const seed = currentUser !== DEMO_EMAIL ? [] : [{ id: uid(), title: "Monthly salary", amount: 35000, date: todayISO() }];
  saveEarnings(seed);
  return seed;
}
function saveExpenses(d) { try { localStorage.setItem(userKey(STORAGE_KEY), JSON.stringify(d)); } catch (e) { toast("Could not save — browser storage is full or blocked.", "err"); } }
function saveEarnings(d) { try { localStorage.setItem(userKey(EARNINGS_KEY), JSON.stringify(d)); } catch (e) { toast("Could not save — browser storage is full or blocked.", "err"); } }

/* ---------- render ---------- */
const els = {
  search: $("search"), monthTotal: $("month-total"), monthSub: $("month-sub"), summaryBars: $("summary-bars"),
  chips: $("category-chips"), filterChips: $("filter-chips"), form: $("expense-form"), title: $("title"),
  amount: $("amount"), date: $("date"), list: $("expense-list"), empty: $("empty-state"),
  customField: $("customCategoryField"), customInput: $("customCategoryInput"),
};
const sum = (arr) => arr.reduce((s, e) => s + e.amount, 0);
const inPeriod = (e) => period === "all" || e.date.startsWith(period);
const periodExpenses = () => expenses.filter(inPeriod);
const periodEarnings = () => earnings.filter(inPeriod);
const monthLabel = (m) => new Date(m + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
function textOn(hex) { // readable text colour for a chip background
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 140 ? "#16130f" : "#fff";
}

function render() {
  renderPeriod(); renderStats(); renderBudget(); renderSummary(); renderFilterChips();
  renderList(); renderEarnings(); renderCharts();
  const none = periodExpenses().length === 0;
  document.querySelectorAll(".chart-empty").forEach((el) => el.classList.toggle("hidden", !none));
}

function renderPeriod() {
  // Lists every month (Jan–Dec) for the current year and any year that has data.
  const years = new Set([new Date().getFullYear()]);
  [...expenses, ...earnings].forEach((e) => years.add(Number(e.date.slice(0, 4))));
  if (period !== "all") years.add(Number(period.slice(0, 4)));
  const names = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString("en-IN", { month: "long" }));
  $("periodSelect").innerHTML = `<option value="all">All months</option>` +
    [...years].sort((a, b) => b - a).map((y) =>
      `<optgroup label="${y}">` + names.map((n, i) => `<option value="${y}-${String(i + 1).padStart(2, "0")}">${n} ${y}</option>`).join("") + `</optgroup>`).join("");
  $("periodSelect").value = period;
}

function renderStats() {
  const ex = periodExpenses(), en = periodEarnings();
  const spent = sum(ex), earned = sum(en), saved = earned - spent;
  const balance = sum(earnings) - sum(expenses);
  els.monthTotal.textContent = formatMoney(balance);
  els.monthTotal.classList.toggle("negative", balance < 0);
  els.monthSub.textContent = `${formatMoney(sum(earnings))} earned · ${formatMoney(sum(expenses))} spent, all time`;
  $("stat-spent").textContent = formatMoney(spent);
  $("stat-count").textContent = plural(ex.length, "transaction");
  $("stat-earned").textContent = formatMoney(earned);
  $("stat-earn-count").textContent = plural(en.length, "income entry").replace("entrys", "entries");
  $("stat-saved").textContent = formatMoney(saved);
  $("stat-saved").classList.toggle("negative-text", saved < 0);
  $("stat-rate").textContent = earned > 0 ? `${Math.round((saved / earned) * 100)}% of income` : "No income recorded";
}

function renderBudget() {
  $("budget-card").classList.toggle("hidden", period === "all");
  if (period === "all") return;
  if (document.activeElement !== $("budgetInput")) $("budgetInput").value = budget || "";
  const spent = sum(periodExpenses()), fill = $("budget-fill"), txt = $("budget-text");
  if (!budget) { fill.style.width = "0%"; txt.textContent = "Set a monthly budget to see how much you have left."; return; }
  const pct = (spent / budget) * 100;
  fill.style.width = Math.min(pct, 100) + "%";
  fill.style.background = pct >= 100 ? "var(--danger)" : pct >= 80 ? "#e0a800" : "var(--mint)";
  txt.textContent = spent > budget
    ? `${formatMoney(spent - budget)} over your ${formatMoney(budget)} budget`
    : `${formatMoney(budget - spent)} left of ${formatMoney(budget)} (${Math.round(pct)}% used)`;
}

function renderSummary() {
  const ex = periodExpenses(), totals = {};
  ex.forEach((e) => { totals[e.category || "Other"] = (totals[e.category || "Other"] || 0) + e.amount; });
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]), grand = sum(ex);
  const insight = $("insight");
  if (!entries.length) { insight.textContent = ""; els.summaryBars.innerHTML = `<p class="muted">Add an expense to see where your money goes.</p>`; return; }
  let text = `${entries[0][0]} is your biggest spend, at ${Math.round((entries[0][1] / grand) * 100)}% of the total.`;
  if (period !== "all") {
    const [y, m] = period.split("-").map(Number);
    const prevKey = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const prev = sum(expenses.filter((e) => e.date.startsWith(prevKey)));
    if (prev > 0) { const d = Math.round(((grand - prev) / prev) * 100); text += ` Spending is ${Math.abs(d)}% ${d >= 0 ? "higher" : "lower"} than ${monthLabel(prevKey)}.`; }
  }
  insight.textContent = text;
  els.summaryBars.innerHTML = entries.map(([name, v]) => `
    <div class="bar-row"><span>${escapeHTML(name)}</span>
      <div class="bar-track"><div class="bar-fill" data-width="${(v / grand) * 100}" style="background:${catColor(name)}"></div></div>
      <span class="bar-amount">${formatMoney(v)}</span></div>`).join("");
  requestAnimationFrame(() => els.summaryBars.querySelectorAll(".bar-fill").forEach((el) => { el.style.width = el.dataset.width + "%"; }));
}

function chipHTML(attr, name, active) {
  const c = catColor(name);
  const style = active && name !== "All" ? `background:${c};color:${textOn(c)};border-color:transparent;` : "";
  return `<button type="button" class="chip ${active ? "active" : ""}" ${attr}="${escapeHTML(name)}" aria-pressed="${active}" style="${style}">${escapeHTML(name)}</button>`;
}
function renderFilterChips() {
  const cats = ["All", ...Object.keys(CATEGORIES)];
  expenses.forEach((e) => { if (e.category && !cats.includes(e.category)) cats.push(e.category); });
  if (!cats.includes(categoryFilter)) categoryFilter = "All";
  els.filterChips.innerHTML = cats.map((n) => chipHTML("data-filter", n, n === categoryFilter)).join("");
}
function renderCategoryChips() {
  els.chips.innerHTML = Object.keys(CATEGORIES).map((n) => chipHTML("data-category", n, n === selectedCategory)).join("");
  const other = selectedCategory === "Other";
  els.customField.classList.toggle("hidden", !other);
  if (!other) els.customInput.value = "";
}

function visibleExpenses() {
  const q = searchQuery.trim().toLowerCase();
  return periodExpenses()
    .filter((e) => categoryFilter === "All" || e.category === categoryFilter)
    .filter((e) => !q || e.title.toLowerCase().includes(q) || (e.category || "").toLowerCase().includes(q))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
function itemHTML(kind, e, dot, meta, amount, cls = "") {
  const edit = kind === "exp" ? `<button class="icon-mini" data-edit="${e.id}" aria-label="Edit ${escapeHTML(e.title)}"><i class="fa-solid fa-pen"></i></button>` : "";
  return `<li class="expense-item" data-id="${e.id}"><span class="dot" style="background:${dot}"></span>
    <div class="expense-info"><p class="expense-title">${escapeHTML(e.title)}</p><p class="expense-meta">${meta}</p></div>
    <span class="expense-amount ${cls}">${amount}</span>${edit}
    <button class="delete-btn" ${kind === "exp" ? "data-delete" : "data-delete-earn"}="${e.id}" aria-label="Delete ${escapeHTML(e.title)}">✕</button></li>`;
}
function renderList() {
  const items = visibleExpenses();
  els.empty.classList.toggle("hidden", items.length > 0);
  els.list.innerHTML = items.map((e) => itemHTML("exp", e, catColor(e.category), `${escapeHTML(e.category)} · ${formatDate(e.date)}`, formatMoney(e.amount))).join("");
}
function renderEarnings() {
  const items = periodEarnings().sort((a, b) => (a.date < b.date ? 1 : -1));
  $("earn-empty").classList.toggle("hidden", items.length > 0);
  $("earnings-list").innerHTML = items.map((e) => itemHTML("earn", e, "#34c77b", formatDate(e.date), "+" + formatMoney(e.amount), "income")).join("");
}

/* ---------- charts ---------- */
function renderCharts() {
  if (typeof Chart === "undefined") return; // CDN unavailable: dashboard still works
  const ex = periodExpenses(), spent = sum(ex), earned = sum(periodEarnings()), net = earned - spent;
  const tip = { callbacks: { label: (c) => " " + formatMoney(c.raw) } };
  const grid = { y: { grid: { color: "rgba(22,19,15,0.05)" } }, x: { grid: { display: false } } };
  const base = { responsive: true, maintainAspectRatio: false, animation: false };

  const barData = [earned, spent, net];
  if (!barChart) {
    barChart = new Chart($("barAnalyticsChart"), { type: "bar",
      data: { labels: ["Earnings", "Spending", "Net"], datasets: [{ data: barData, backgroundColor: ["#34c77b", "#ff5a3c", "#3b82f6"], borderRadius: 8 }] },
      options: { ...base, plugins: { legend: { display: false }, tooltip: tip }, scales: grid } });
  } else { barChart.data.datasets[0].data = barData; barChart.update("none"); }

  const cat = {};
  ex.forEach((e) => { cat[e.category || "Other"] = (cat[e.category || "Other"] || 0) + e.amount; });
  const labels = Object.keys(cat), vals = labels.map((k) => cat[k]), colors = labels.map(catColor);
  if (!pieChart) {
    pieChart = new Chart($("pieAnalyticsChart"), { type: "doughnut",
      data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderWidth: 2, borderColor: "#fffdf8" }] },
      options: { ...base, plugins: { legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${formatMoney(c.raw)}` } } } } });
  } else {
    pieChart.data.labels = labels; pieChart.data.datasets[0].data = vals; pieChart.data.datasets[0].backgroundColor = colors; pieChart.update("none");
  }

  const byDate = {};
  ex.forEach((e) => { byDate[e.date] = (byDate[e.date] || 0) + e.amount; });
  const dates = Object.keys(byDate).sort(), dayLabels = dates.map(formatDate), dayVals = dates.map((d) => byDate[d]);
  if (!lineChart) {
    lineChart = new Chart($("lineAnalyticsChart"), { type: "line",
      data: { labels: dayLabels, datasets: [{ data: dayVals, borderColor: "#ff5a3c", backgroundColor: "rgba(255,90,60,0.1)", fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: "#ff5a3c" }] },
      options: { ...base, plugins: { legend: { display: false }, tooltip: tip }, scales: grid } });
  } else { lineChart.data.labels = dayLabels; lineChart.data.datasets[0].data = dayVals; lineChart.update("none"); }
}

/* ---------- earnings modal ---------- */
window.openEarningsModal = () => {
  $("earnings-form").reset();
  $("earnDate").value = todayISO();
  $("earningsModal").classList.remove("hidden");
  $("earnTitle").focus();
};
window.closeEarningsModal = () => $("earningsModal").classList.add("hidden");
window.handleEarningsSubmit = (e) => {
  e.preventDefault();
  const title = $("earnTitle").value.trim(), amount = parseFloat($("earnAmount").value), date = $("earnDate").value;
  if (!title || isNaN(amount) || amount <= 0 || !date) return toast("Enter a source, an amount above ₹0 and a date.", "err");
  earnings.unshift({ id: uid(), title, amount, date });
  saveEarnings(earnings);
  closeEarningsModal();
  render();
  toast("Earnings added");
};
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeEarningsModal(); });
$("earningsModal").addEventListener("click", (e) => { if (e.target.id === "earningsModal") closeEarningsModal(); });

/* ---------- export ---------- */
window.exportCSV = () => {
  const cell = (c) => { let s = String(c); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const rows = [["Type", "Title", "Category", "Amount (INR)", "Date"],
    ...expenses.map((e) => ["Expense", e.title, e.category, e.amount, e.date]),
    ...earnings.map((e) => ["Income", e.title, "", e.amount, e.date])];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `spendly-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Export downloaded");
};

/* ---------- events ---------- */
function cancelEdit() {
  editingId = null;
  $("form-title").textContent = "Add an expense";
  $("submitBtn").textContent = "Add expense";
  $("cancelEdit").classList.add("hidden");
  els.form.reset();
  els.date.value = todayISO();
  selectedCategory = "Food";
  renderCategoryChips();
  ["title", "amount", "date", "customCategory", "category"].forEach((f) => setError(f, ""));
}
function startEdit(id) {
  const e = expenses.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  els.title.value = e.title; els.amount.value = e.amount; els.date.value = e.date;
  selectedCategory = CATEGORIES[e.category] ? e.category : "Other";
  renderCategoryChips();
  if (selectedCategory === "Other") els.customInput.value = e.category;
  $("form-title").textContent = "Edit expense";
  $("submitBtn").textContent = "Save changes";
  $("cancelEdit").classList.remove("hidden");
  els.form.scrollIntoView({ behavior: "smooth", block: "center" });
  els.title.focus({ preventScroll: true });
}

els.chips.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-category]");
  if (!btn) return;
  selectedCategory = btn.dataset.category;
  setError("category", "");
  renderCategoryChips();
});
els.filterChips.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-filter]");
  if (!btn) return;
  categoryFilter = btn.dataset.filter;
  renderFilterChips();
  renderList();
});
els.search.addEventListener("input", () => { searchQuery = els.search.value; renderList(); });
$("periodSelect").addEventListener("change", (e) => { period = e.target.value; render(); });
$("cancelEdit").addEventListener("click", cancelEdit);
$("budget-form").addEventListener("submit", (e) => {
  e.preventDefault();
  budget = Math.max(0, parseFloat($("budgetInput").value) || 0);
  try { localStorage.setItem(userKey(BUDGET_KEY), String(budget)); } catch (err) {}
  renderBudget();
  toast(budget ? "Budget saved" : "Budget cleared");
});

els.form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  ["title", "amount", "date", "customCategory", "category"].forEach((f) => setError(f, ""));
  let ok = true;
  const title = els.title.value.trim(), amount = parseFloat(els.amount.value), date = els.date.value;
  let category = selectedCategory;
  if (selectedCategory === "Other") {
    const custom = els.customInput.value.trim();
    if (!custom) { setError("customCategory", "Enter a name for your category."); ok = false; } else category = custom;
  }
  if (!title) { setError("title", "Enter a title for this expense."); ok = false; }
  if (els.amount.value === "" || isNaN(amount)) { setError("amount", "Enter an amount."); ok = false; }
  else if (amount <= 0) { setError("amount", "Amount must be above ₹0."); ok = false; }
  if (!date) { setError("date", "Pick a date."); ok = false; }
  if (!ok) return;

  const wasEdit = !!editingId;
  if (wasEdit) Object.assign(expenses.find((x) => x.id === editingId), { title, amount, category, date });
  else expenses.unshift({ id: uid(), title, amount, category, date });
  saveExpenses(expenses);
  if (period !== "all" && !date.startsWith(period)) period = date.slice(0, 7); // keep the saved item visible
  cancelEdit();
  render();
  toast(wasEdit ? "Changes saved" : "Expense added");
});

els.list.addEventListener("click", (ev) => {
  const edit = ev.target.closest("[data-edit]");
  if (edit) return startEdit(edit.dataset.edit);
  const btn = ev.target.closest("[data-delete]");
  if (!btn) return;
  const id = btn.dataset.delete, row = btn.closest(".expense-item");
  if (row) row.classList.add("row-exit");
  setTimeout(() => {
    const idx = expenses.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const [removed] = expenses.splice(idx, 1);
    if (editingId === id) cancelEdit();
    saveExpenses(expenses);
    render();
    toast("Expense deleted", "ok", { label: "Undo", fn: () => { expenses.splice(idx, 0, removed); saveExpenses(expenses); render(); toast("Expense restored"); } });
  }, 280);
});
$("earnings-list").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-delete-earn]");
  if (!btn) return;
  const idx = earnings.findIndex((e) => e.id === btn.dataset.deleteEarn);
  if (idx < 0) return;
  const [removed] = earnings.splice(idx, 1);
  saveEarnings(earnings);
  render();
  toast("Earnings deleted", "ok", { label: "Undo", fn: () => { earnings.splice(idx, 0, removed); saveEarnings(earnings); render(); toast("Earnings restored"); } });
});

function setError(field, msg) {
  const el = document.querySelector(`[data-error-for="${field}"]`);
  if (el) el.textContent = msg;
}