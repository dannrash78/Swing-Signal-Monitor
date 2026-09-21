const DEFAULTS = {
  symbols: ["NVDA","AMD","MU","AVGO","TSLA","AAPL","AMZN","META","MSFT","GOOGL"],
  companyNames: {
    NVDA: "NVIDIA Corporation",
    AMD: "Advanced Micro Devices, Inc.",
    MU: "Micron Technology, Inc.",
    AVGO: "Broadcom Inc.",
    TSLA: "Tesla, Inc.",
    AAPL: "Apple Inc.",
    AMZN: "Amazon.com, Inc.",
    META: "Meta Platforms, Inc.",
    MSFT: "Microsoft Corporation",
    GOOGL: "Alphabet Inc."
  },
  regions: {
    AAPL: "Американски",
    AMD: "Американски",
    AMZN: "Американски",
    AVGO: "Американски",
    GOOGL: "Американски",
    META: "Американски",
    MSFT: "Американски",
    MU: "Американски",
    NVDA: "Американски",
    TSLA: "Американски"
  },
  target: 10,
  levels: [5,8,10],
  backend: "https://swing-signal-backend.danniel-rashev.workers.dev",
  providers: {
    alphavantage: { enabled: true, priority: 1, name: "Alpha Vantage" },
    twelvedata: { enabled: true, priority: 2, name: "Twelve Data" },
    finnhub: { enabled: false, priority: 3, name: "Finnhub" }
  }
};

let state = JSON.parse(localStorage.getItem("swingState") || "null") || {
  symbols: DEFAULTS.symbols,
  positions: {},
  selectedSymbols: DEFAULTS.symbols.slice(),
  lastResults: [],
  hiddenSymbols: [],
  sortOrder: "alpha",
  viewMode: "cards"
};

state.symbols = Array.isArray(state.symbols) ? state.symbols : DEFAULTS.symbols.slice();
state.positions = state.positions || {};
Object.keys(state.positions).forEach(s => {
  if (typeof state.positions[s] === "number") state.positions[s] = [state.positions[s]];
  else if (!Array.isArray(state.positions[s])) delete state.positions[s];
});
state.selectedSymbols = Array.isArray(state.selectedSymbols)
  ? state.selectedSymbols.filter(s => state.symbols.includes(s))
  : state.symbols.slice();
state.lastResults = Array.isArray(state.lastResults) ? state.lastResults : [];
state.hiddenSymbols = Array.isArray(state.hiddenSymbols) ? state.hiddenSymbols.filter(s => state.symbols.includes(s)) : [];
state.sortOrder = ["alpha","priceDesc","priceAsc"].includes(state.sortOrder) ? state.sortOrder : "alpha";
state.viewMode = state.viewMode === "table" ? "table" : "cards";
state.providers = state.providers || {};
Object.keys(DEFAULTS.providers).forEach(p => {
  state.providers[p] = { ...DEFAULTS.providers[p], ...(state.providers[p] || {}) };
});

// One-time migration: restore AMD only if it was actually missing.
// IMPORTANT: never unhide an existing AMD entry. From this point onward,
// visibility is entirely controlled by the user's hiddenSymbols choice.
if (!localStorage.getItem("swingAmdMigrationV2")) {
  const amdWasMissing = !state.symbols.includes("AMD");
  if (amdWasMissing) {
    state.symbols.splice(1, 0, "AMD");
    if (!state.selectedSymbols.includes("AMD")) state.selectedSymbols.push("AMD");
    state.hiddenSymbols = state.hiddenSymbols.filter(s => s !== "AMD");
    save();
  }
  localStorage.setItem("swingAmdMigrationV2", "1");
}

const $ = id => document.getElementById(id);
$("backendUrl").value = localStorage.getItem("swingBackend") || DEFAULTS.backend;
$("targetPct").value = DEFAULTS.target;
$("levels").value = DEFAULTS.levels.join(",");
if ($("sortOrder")) $("sortOrder").value = state.sortOrder;
if ($("viewMode")) $("viewMode").value = state.viewMode;
if ($("sortOrder")) $("sortOrder").onchange = e => {
  state.sortOrder = e.target.value;
  save();
  logActivity("settings", "Watchlist sort changed", {sortOrder:state.sortOrder});
  renderCards();
};
if ($("viewMode")) $("viewMode").onchange = e => {
  state.viewMode = e.target.value === "table" ? "table" : "cards";
  save();
  logActivity("settings", "Watchlist view changed", {viewMode:state.viewMode});
  renderCards();
};
renderProviderSettings();
renderActivityLog();
scheduleUsageReset();
$("saveProviderHeader").onclick = () => {
  saveProviderSettings();
  logActivity("settings", "Provider enablement/priority saved", {
    providers: enabledProviders().map(p => ({provider:p, enabled:state.providers[p].enabled, priority:state.providers[p].priority}))
  });
};

$("saveSettings").onclick = () => {
  const backend = $("backendUrl").value.trim().replace(/\/$/,"");
  localStorage.setItem("swingBackend", backend);
  saveProviderSettings();
  logActivity("settings", "Backend/settings saved", {backend, targetPct:$("targetPct").value, levels:$("levels").value});
  renderCards();
renderActivityLog();
};

$("updateBtn").onclick = updateSelected;
$("healthBtn").onclick = checkHealth;
$("hiddenToggleBtn").onclick = () => {
  const section = document.querySelector(".hidden-section");
  const hidden = section.hasAttribute("hidden");
  if (hidden) section.removeAttribute("hidden"); else section.setAttribute("hidden", "");
  updateHiddenToggle();
};

function populatePositionSymbols(){
  const select = $("symbol");
  if (!select) return [];
  const visible = state.symbols
    .filter(s => !state.hiddenSymbols.includes(s))
    .sort((a,b) => a.localeCompare(b,"en"));
  select.innerHTML = visible.map(s =>
    '<option value="' + escapeHtml(s) + '">' +
      escapeHtml(s) + ' — ' + escapeHtml(companyName(s)) +
    '</option>'
  ).join("");
  return visible;
}

$("addBtn").onclick = () => {
  const visible = populatePositionSymbols();
  if (!visible.length) {
    alert("Няма видими акции, за които да се въведе позиция.");
    return;
  }
  $("symbol").value = visible[0];
  $("holding").checked = false;
  $("entryPrice").value = "";
  $("entryPrice").disabled = true;
  $("stockDialog").showModal();
};
$("holding").onchange = e => $("entryPrice").disabled = !e.target.checked;
$("cancelStock").onclick = () => $("stockDialog").close();

$("stockForm").onsubmit = e => {
  e.preventDefault();
  const s = $("symbol").value.trim().toUpperCase();
  const visibleSymbols = state.symbols.filter(x => !state.hiddenSymbols.includes(x));
  if (!visibleSymbols.includes(s)) return alert("Избери акция от видимия списък.");
  if ($("holding").checked && Number($("entryPrice").value) > 0) {
    const entries = Array.isArray(state.positions[s]) ? state.positions[s] : [];
    entries.push(Number($("entryPrice").value));
    state.positions[s] = entries;
  } else {
    delete state.positions[s];
  }
  save();
  $("stockDialog").close();
  logActivity("settings", $("holding").checked ? "Position added/updated" : "Position cleared / sold", {symbol:s, holding:$("holding").checked});
  renderCards();
};

function save(){ localStorage.setItem("swingState", JSON.stringify(state)); }

function renderProviderSettings(){
  Object.keys(DEFAULTS.providers).forEach(p => {
    const e = $("provider-" + p + "-enabled");
    const q = $("provider-" + p + "-priority");
    if (e) e.checked = !!state.providers[p].enabled;
    if (q) q.value = String(state.providers[p].priority);
  });
  updateUsagePanel();
}
function saveProviderSettings(){
  Object.keys(DEFAULTS.providers).forEach(p => {
    const e = $("provider-" + p + "-enabled");
    const q = $("provider-" + p + "-priority");
    if (e) state.providers[p].enabled = e.checked;
    if (q) state.providers[p].priority = Number(q.value) || DEFAULTS.providers[p].priority;
  });
  save();
}
function enabledProviders(){
  return Object.keys(state.providers)
    .filter(p => state.providers[p].enabled)
    .sort((a,b) => state.providers[a].priority - state.providers[b].priority || a.localeCompare(b));
}
function localUsageDate(){
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function resetUsageIfNeeded(){
  const today = localUsageDate();
  const key = "swingProviderDailyUsage";
  const stored = JSON.parse(localStorage.getItem(key) || "null");
  if (!stored || stored.date !== today) {
    const fresh = {date:today, alphavantage:0, twelvedata:0, finnhub:0};
    localStorage.setItem(key, JSON.stringify(fresh));
    return fresh;
  }
  return stored;
}
function updateUsagePanel(usage){
  const el = $("providerUsage");
  if (!el) return;
  const stored = resetUsageIfNeeded();
  ["alphavantage","twelvedata","finnhub"].forEach(p => {
    const calls = Number(usage?.[p]?.apiCalls) || 0;
    if (calls > 0) stored[p] += calls;
  });
  localStorage.setItem("swingProviderDailyUsage", JSON.stringify(stored));

  const avLimit = 25;
  const tdLimit = 800;
  const avRemaining = Math.max(0, avLimit - stored.alphavantage);
  const tdRemaining = Math.max(0, tdLimit - stored.twelvedata);
  const minuteLeft = usage?.twelvedata?.minuteCreditsLeft;

  el.innerHTML =
    "<div><b>Alpha Vantage:</b> " + avRemaining + " / " + avLimit + " заявки остават <span class='usage-note'>(локална оценка)</span></div>" +
    "<div class='usage-sub'>Използвани днес: " + stored.alphavantage + "</div>" +
    "<div><b>Twelve Data:</b> " + tdRemaining + " / " + tdLimit + " дневни кредита остават <span class='usage-note'>(локална оценка)</span></div>" +
    "<div class='usage-sub'>Използвани днес: " + stored.twelvedata + " · текущата минута: " + (Number.isFinite(minuteLeft) ? minuteLeft : "—") + "</div>" +
    "<div><b>Finnhub:</b> " + stored.finnhub + " заявки направени днес</div>" +
    "<div class='usage-sub'>Точен дневен остатък не се показва, защото backend-ът няма надежден дневен free quota отговoр.</div>" +
    "<div class='usage-note'>⚠️ Това е локален брояч за този браузър/API ключ. Нулиране на UI брояча: 00:00 местно време.</div>";
}
function scheduleUsageReset(){
  const now = new Date();
  const next = new Date(now);
  next.setHours(24,0,0,0);
  const delay = Math.max(1000, next.getTime() - now.getTime() + 250);
  setTimeout(() => { resetUsageIfNeeded(); updateUsagePanel(); renderActivityLog(); scheduleUsageReset(); }, delay);
}
function providerName(source){
  return ({alphavantage:"Alpha Vantage",twelvedata:"Twelve Data",finnhub:"Finnhub",cache:"Cache"})[source] || source || "—";
}
function renderHealthProviders(providers){
  const el = $("providerHealth");
  if (!el) return;
  el.innerHTML = Object.entries(providers).map(([p,v]) =>
    '<div class="health-provider-row"><span class="provider-badge ' + (v.configured ? 'ok' : 'off') + '">' +
    escapeHtml(DEFAULTS.providers[p]?.name || p) + ": " + (v.configured ? "configured" : "not configured") +
    (v.network ? " · HTTP " + escapeHtml(String(v.network.httpStatus ?? "—")) + " · " + escapeHtml(String(v.network.latencyMs ?? "—")) + " ms" : "") +
    '</span><button type="button" class="provider-test health-test" data-provider-test="' + escapeHtml(p) + '">Test NVDA</button></div>'
  ).join("");
  el.querySelectorAll("[data-provider-test]").forEach(btn => {
    btn.onclick = () => testProvider(btn.dataset.providerTest);
  });
}

function updateHiddenToggle(){
  const btn = $("hiddenToggleBtn");
  if (btn) btn.textContent = "Невидим списък (" + state.hiddenSymbols.length + ")";
}

function removeStock(s){
  state.symbols = state.symbols.filter(x=>x!==s);
  state.selectedSymbols = state.selectedSymbols.filter(x=>x!==s);
  state.lastResults = state.lastResults.filter(x=>x.symbol!==s);
  state.hiddenSymbols = state.hiddenSymbols.filter(x=>x!==s);
  delete state.positions[s];
  save();
  renderCards();
}

function setSelected(symbol, checked){
  if (checked) {
    if (!state.selectedSymbols.includes(symbol)) state.selectedSymbols.push(symbol);
  } else {
    state.selectedSymbols = state.selectedSymbols.filter(x=>x!==symbol);
  }
  save();
  const card = document.querySelector('[data-symbol-card="' + CSS.escape(symbol) + '"]');
  if (card) card.classList.toggle("selected", checked);
}

function hideStock(s){
  if (!state.hiddenSymbols.includes(s)) state.hiddenSymbols.push(s);
  save();
  renderCards();
}

function showStock(s){
  state.hiddenSymbols = state.hiddenSymbols.filter(x=>x!==s);
  save();
  renderCards();
}

function renderHiddenList(){
  const list = $("hiddenList");
  if (!list) return;
  list.innerHTML = "";
  if (!state.hiddenSymbols.length) {
    list.innerHTML = '<span class="hidden-empty">Няма скрити акции.</span>';
    return;
  }
  state.hiddenSymbols.slice().sort((a,b)=>a.localeCompare(b,"en")).forEach(symbol => {
    const item = document.createElement("div");
    item.className = "hidden-item";
    item.innerHTML = '<span>' + escapeHtml(symbol) + '</span><button type="button" class="show-btn" data-show="' + escapeHtml(symbol) + '">Покажи</button>';
    item.querySelector("[data-show]").onclick = () => showStock(symbol);
    list.appendChild(item);
  });
}

function logActivity(type, message, details = {}, level = "info"){
  const key = "swingActivityLog";
  let logs = [];
  try { logs = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
  logs.push({
    ts: new Date().toISOString(),
    localTime: new Date().toLocaleString(),
    type, level, message, details
  });
  if (logs.length > 1000) logs = logs.slice(-1000);
  localStorage.setItem(key, JSON.stringify(logs));
  renderActivityLog();
}
function getActivityLogs(){
  try { return JSON.parse(localStorage.getItem("swingActivityLog") || "[]"); } catch { return []; }
}
function renderActivityLog(){
  const el = $("activityLog");
  if (!el) return;
  const logs = getActivityLogs();
  if (!logs.length) {
    el.innerHTML = '<div class="log-entry"><span class="log-time">—</span> Няма записана активност.</div>';
    return;
  }
  el.innerHTML = logs.slice().reverse().map(x =>
    '<div class="log-entry ' + (x.level === "error" ? "log-error" : "") + '">' +
      '<span class="log-time">' + escapeHtml(x.localTime || x.ts) + '</span> · <b>' + escapeHtml(x.type) + '</b> · ' +
      escapeHtml(x.message) + (Object.keys(x.details || {}).length ? ' · ' + escapeHtml(JSON.stringify(x.details)) : '') +
    '</div>'
  ).join("");
}
function exportActivityLog(){
  const logs = getActivityLogs();
  const blob = new Blob([JSON.stringify(logs,null,2)], {type:"application/json;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "swing-signal-activity-log-" + localUsageDate() + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("exportLog").onclick = exportActivityLog;
$("clearLog").onclick = () => {
  if (!confirm("Изтрий локалния Activity Log?")) return;
  localStorage.removeItem("swingActivityLog");
  renderActivityLog();
};
function getVisibleSymbols(results){
  const visible = state.symbols.filter(symbol => !state.hiddenSymbols.includes(symbol));
  return visible.sort((a,b) => {
    if (state.sortOrder === "priceAsc" || state.sortOrder === "priceDesc") {
      const pa = Number(results.get(a)?.price);
      const pb = Number(results.get(b)?.price);
      const aValid = Number.isFinite(pa);
      const bValid = Number.isFinite(pb);
      if (!aValid && !bValid) return a.localeCompare(b,"en");
      if (!aValid) return 1;
      if (!bValid) return -1;
      if (pa !== pb) return state.sortOrder === "priceAsc" ? pa - pb : pb - pa;
    }
    return a.localeCompare(b,"en");
  });
}

function renderWatchlistControls(){
  if ($("sortOrder")) $("sortOrder").value = state.sortOrder;
  if ($("viewMode")) $("viewMode").value = state.viewMode;
}

function renderCards(){
  const cards = $("cards");
  const target = Number($("targetPct").value) || 10;
  const levels = $("levels").value.split(",").map(Number).filter(x=>x>0);
  const results = new Map(state.lastResults.map(x=>[x.symbol,x]));
  cards.innerHTML = "";

  if (!state.symbols.length) {
    cards.innerHTML = '<div class="card"><b>Watchlist е празен.</b><p>Добави акция, за да започнеш.</p></div>';
    renderWatchlistControls();
    renderHiddenList();
    updateHiddenToggle();
    return;
  }

  const visibleSymbols = getVisibleSymbols(results);
  if (state.viewMode === "table") {
    renderTableView(cards, visibleSymbols, results, target, levels);
  } else {
    visibleSymbols.forEach(symbol => {
      const result = results.get(symbol);
      cards.appendChild(result ? card(result,target,levels) : placeholderCard(symbol));
    });
  }

  renderWatchlistControls();
  renderHiddenList();
  updateHiddenToggle();
}

function renderTableView(container, symbols, results, target, levels){
  const wrap=document.createElement("div");
  wrap.className="table-wrap";

  const table=document.createElement("table");
  table.className="watchlist-table";
  table.innerHTML =
    '<thead><tr>' +
      '<th>Update</th><th>Акция</th><th>Price</th><th>Сигнал</th><th>60d high</th>' +
      '<th>От връха</th><th>Ден</th><th>Обновено</th><th>Позиция</th><th>Data</th><th></th>' +
    '</tr></thead>';
  const tbody=document.createElement("tbody");

  symbols.forEach(symbol => {
    const x=results.get(symbol);
    if (x && x.status && x.status !== "ok") {
      const row=document.createElement("tr");
      row.className="table-row error";
      row.innerHTML =
        '<td>' + checkboxHtml(symbol) + '</td>' +
        '<td><b>' + escapeHtml(symbol) + '</b><span class="table-company">' + escapeHtml(companyName(symbol)) + '</span></td>' +
        '<td>—</td>' +
        '<td><b>' + escapeHtml(statusLabel(x.status)) + '</b></td>' +
        '<td colspan="5">' + escapeHtml(x.error || "Няма данни.") + '</td>' +
        '<td>' + escapeHtml(providerName(x.source)) + '</td>' +
        '<td><button type="button" class="hide-btn" data-hide="' + escapeHtml(symbol) + '">Скрий</button></td>';
      bindTableRow(row,symbol);
      tbody.appendChild(row);
      return;
    }

    if (!x) {
      const row=document.createElement("tr");
      row.className="table-row";
      row.innerHTML =
        '<td>' + checkboxHtml(symbol) + '</td>' +
        '<td><b>' + escapeHtml(symbol) + '</b><span class="table-company">' + escapeHtml(companyName(symbol)) + '</span></td>' +
        '<td colspan="8">Няма заредени данни</td>' +
        '<td><button type="button" class="hide-btn" data-hide="' + escapeHtml(symbol) + '">Скрий</button></td>';
      bindTableRow(row,symbol);
      tbody.appendChild(row);
      return;
    }

    const rendered = tableSignalState(x,target,levels);
    const entries=positionEntries(x.symbol);
    let positionText="—";
    if(entries.length){
      const avg=entries.reduce((sum,v)=>sum+v,0)/entries.length;
      const pnl=(x.price/avg-1)*100;
      positionText='Входове: ' + entries.length + ' · avg $' + num(avg) + ' · P/L ' + pnl.toFixed(2) + '%';
    } else {
      const sortedLevels=levels.slice().sort((a,b)=>a-b);
      if(sortedLevels.length){
        const reached=sortedLevels.filter(l => x.drawdownPct <= -l).pop();
        const next=sortedLevels.find(l => x.drawdownPct > -l);
        const planLevel=reached || next || sortedLevels[sortedLevels.length-1];
        const planPrice=x.high60*(1-planLevel/100);
        positionText='Предполагаем вход: $' + num(planPrice) + ' · -' + planLevel + '%';
      }
    }

    const row=document.createElement("tr");
    row.className="table-row " + rendered.cls;
    row.innerHTML =
      '<td>' + checkboxHtml(symbol) + '</td>' +
      '<td><b>' + escapeHtml(symbol) + '</b><span class="table-company">' + escapeHtml(companyName(symbol)) + '</span></td>' +
      '<td><b>$' + num(x.price) + '</b></td>' +
      '<td><b>' + rendered.signal + '</b></td>' +
      '<td>$' + num(x.high60) + '</td>' +
      '<td>' + Number(x.drawdownPct).toFixed(2) + '%</td>' +
      '<td>' + (x.changePct>=0?"+":"") + Number(x.changePct).toFixed(2) + '%</td>' +
      '<td>' + escapeHtml(x.date || "—") + '</td>' +
      '<td>' + escapeHtml(positionText) + '</td>' +
      '<td>' + escapeHtml(providerName(x.source)) + '</td>' +
      '<td><button type="button" class="hide-btn" data-hide="' + escapeHtml(symbol) + '">Скрий</button></td>';
    bindTableRow(row,symbol);
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

function checkboxHtml(symbol){
  const selected=state.selectedSymbols.includes(symbol);
  return '<label class="table-selection"><input type="checkbox" data-select="' + escapeHtml(symbol) + '"' + (selected ? " checked" : "") + '></label>';
}

function bindTableRow(row,symbol){
  const select=row.querySelector("[data-select]");
  const hide=row.querySelector("[data-hide]");
  if(select) select.onchange=e=>setSelected(symbol,e.target.checked);
  if(hide) hide.onclick=()=>hideStock(symbol);
  row.classList.toggle("selected", state.selectedSymbols.includes(symbol));
}

function statusLabel(status){
  return ({
    rate_limited: "⚠️ API LIMIT",
    no_data: "⚠️ NO DATA",
    invalid_symbol: "❌ INVALID SYMBOL",
    insufficient_history: "⚠️ INSUFFICIENT HISTORY",
    error: "⚠️ DATA ERROR",
    provider_unavailable: "⚠️ PROVIDER UNAVAILABLE"
  })[status] || "⚠️ DATA ERROR";
}

function tableSignalState(x,target,levels){
  const entries=positionEntries(x.symbol);
  if(entries.length){
    const avgEntry=entries.reduce((sum,v)=>sum+v,0)/entries.length;
    const pnl=(x.price/avgEntry-1)*100;
    if(pnl >= target) return {cls:"exit",signal:"🔵 EXIT ZONE"};
    return {cls:"watch",signal:"🟡 HOLD / WATCH"};
  }
  const dd=x.drawdownPct;
  const sortedLevels=levels.slice().sort((a,b)=>a-b);
  const reached=sortedLevels.filter(l => dd <= -l).pop();
  if(reached) return {cls:"entry",signal:"🟢 ENTRY ZONE"};
  return {cls:"wait",signal:"⚪ WAIT"};
}


function placeholderCard(symbol){
  const selected = state.selectedSymbols.includes(symbol);
  const div = document.createElement("article");
  div.className = "card" + (selected ? " selected" : "");
  div.dataset.symbolCard = symbol;
  div.innerHTML =
    '<div class="top">' +
      '<label class="selection"><input type="checkbox" data-select="' + escapeHtml(symbol) + '"' + (selected ? " checked" : "") + '> Заявка при Update</label>' +
      '<button class="remove" data-remove="' + escapeHtml(symbol) + '">×</button>' +
    '</div>' +
    '<div class="symbol">' + escapeHtml(symbol) + ' <span class="company-name">' + escapeHtml(companyName(symbol)) + '</span></div>' +
    '<div class="signal">⚪ Няма заредени данни</div>' +
    '<div class="reason">Избери заявка за Update или скрий акцията от основния списък.</div>' +
    '<button type="button" class="hide-btn" data-hide="' + escapeHtml(symbol) + '">Скрий</button>';

  div.querySelector("[data-select]").onchange = e => setSelected(symbol,e.target.checked);
  div.querySelector("[data-remove]").onclick = () => hideStock(symbol);
  div.querySelector("[data-hide]").onclick = () => hideStock(symbol);
  return div;
}

async function testProvider(provider){
  const result = $("providerTestResult");
  const backend = $("backendUrl").value.trim().replace(/\/$/,"");
  if(!backend) return;
  result.hidden = false;
  result.className = "provider-test-result";
  result.innerHTML = "<b>Тест:</b> " + escapeHtml(providerName(provider)) + " / NVDA…";
  logActivity("provider_test", "Query started", {provider, symbol:"NVDA"});
  try{
    const r = await fetch(backend + "/api/test?provider=" + encodeURIComponent(provider) + "&symbol=NVDA",{cache:"no-store"});
    const data = await r.json();
    updateUsagePanel(data.usage);
    logActivity("provider_test", data.ok ? "Result OK" : "Result/Error", {provider, symbol:"NVDA", status:data.status, message:data.message || data.error || null, result:data.result || null}, data.ok ? "info" : "error");
    const ok = r.ok && data?.ok;
    result.className = "provider-test-result " + (ok ? "health-ok" : "health-error");
    result.innerHTML =
      "<b>" + (ok ? "✅ " : "❌ ") + escapeHtml(providerName(provider)) + " — " + escapeHtml(String(data.status || "error").toUpperCase()) + "</b>" +
      "<p><b>Symbol:</b> NVDA</p>" +
      (data.message ? "<p><b>Причина:</b> " + escapeHtml(data.message) + "</p>" : "") +
      (data.error ? "<p><b>Грешка:</b> " + escapeHtml(data.error) + "</p>" : "") +
      (data.result ? "<p><b>Цена:</b> $" + escapeHtml(num(data.result.price)) + " · <b>Дата:</b> " + escapeHtml(data.result.date) + "</p>" : "") +
      "<p><b>API calls:</b> " + escapeHtml(String(data.usage?.[provider]?.apiCalls ?? "—")) + "</p>";
  }catch(e){
    logActivity("provider_test", "Network/Backend error", {provider, symbol:"NVDA", error:e.message || "Няма връзка."}, "error");
    result.className = "provider-test-result health-error";
    result.innerHTML = "<b>❌ Network/Backend error</b><p>" + escapeHtml(e.message || "Няма връзка.") + "</p>";
  }
}

async function updateSelected(){
  const cards = $("cards");
  const backend = $("backendUrl").value.trim().replace(/\/$/,"");
  const selected = state.selectedSymbols.filter(s => state.symbols.includes(s));

  if (!backend) {
    cards.innerHTML = '<div class="card error"><b>Въведи Backend URL.</b><p>Постави адреса на Cloudflare Worker.</p></div>';
    return;
  }
  if (!selected.length) {
    cards.innerHTML = '<div class="card"><b>Няма избрани акции.</b><p>Постави отметка на поне една акция и натисни Update.</p></div>';
    return;
  }

  save();
  cards.innerHTML = '<div class="card loading">Изпращам заявка само за избраните акции: ' + escapeHtml(selected.join(", ")) + '…</div>';

  const target = Number($("targetPct").value) || 10;
  const levels = $("levels").value.split(",").map(Number).filter(x=>x>0);

  try{
    const providers = enabledProviders();
    if (!providers.length) throw new Error("Няма включен data provider.");
    const url = backend + "/api/scan?symbols=" + encodeURIComponent(selected.join(",")) + "&providers=" + encodeURIComponent(providers.join(","));
    logActivity("query", "Update query started", {url, symbols:selected, providers});
    const r = await fetch(url, {cache:"no-store"});
    let data = null;
    try { data = await r.json(); } catch {}

    if (data?.rateLimited) {
      cards.innerHTML = "";
      const notice = document.createElement("div");
      notice.className = "card error";
      notice.innerHTML = '<b>⚠️ Достигнат е лимитът на Alpha Vantage</b><p>Днешният API лимит е достигнат. Новите заявки са спрени.</p><p>Изпратени заявки към Worker/Alpha Vantage в тази операция: <b>' + escapeHtml(String(data.apiCalls ?? "—")) + '</b></p>';
      cards.appendChild(notice);
      if (Array.isArray(data.results)) {
        state.lastResults = mergeResults(state.lastResults,data.results);
        save();
      }
      renderCards();
      return;
    }

    if(!r.ok){
      let message = data?.error || ("HTTP " + r.status);
      if(r.status === 403) message = "Достъпът до Backend-а е отказан (HTTP 403). Провери Cloudflare Worker / Access настройките.";
      else if(r.status === 429) message = "Backend-ът е ограничил заявките (HTTP 429). Изчакай и опитай отново по-късно.";
      throw new Error(message);
    }

    if(!data || !Array.isArray(data.results)) throw new Error("Невалиден отговор от backend.");
    updateUsagePanel(data.usage);
    logActivity("result", "Update result received", {httpStatus:r.status, symbols:selected, providers, results:data.results, usage:data.usage}, "info");

    state.lastResults = mergeResults(state.lastResults,data.results);
    save();
    renderCards();
  }catch(e){
    logActivity("error", "Update failed", {error:e.message || "Неизвестна грешка", selected}, "error");
    await showBackendDiagnostic(cards, backend, e);
  }
}

function mergeResults(oldResults,newResults){
  const map = new Map(oldResults.map(x=>[x.symbol,x]));
  newResults.forEach(x=>map.set(x.symbol,x));
  return [...map.values()].filter(x=>state.symbols.includes(x.symbol));
}

async function checkHealth(){
  const result = $("healthResult");
  const backend = $("backendUrl").value.trim().replace(/\/$/,"");

  if(!backend){
    result.hidden = false;
    result.className = "health-result health-error";
    result.innerHTML = "<b>❌ Няма Backend URL.</b>";
    return;
  }

  const healthUrl = backend + "/api/health";
  result.hidden = false;
  logActivity("health", "Health query started", {url:healthUrl});
  result.className = "health-result";
  result.innerHTML = "<b>Проверявам Health…</b><p>URL: " + escapeHtml(healthUrl) + "</p>";

  try{
    const r = await fetch(healthUrl,{cache:"no-store"});
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    result.className = "health-result " + (r.ok && data?.ok ? "health-ok" : "health-error");
    result.innerHTML =
      "<b>" + (r.ok && data?.ok ? "✅ Backend Health OK" : "❌ Backend Health ERROR") + "</b>" +
      "<p><b>URL:</b> " + escapeHtml(healthUrl) + "</p>" +
      "<p><b>HTTP:</b> " + escapeHtml(String(r.status)) + "</p>" +
      "<p><b>Резултат:</b> " + escapeHtml(data ? JSON.stringify(data) : (text || "Няма четим отговор.")) + "</p>" +
      '<div id="providerHealth"></div>'; 
    if (data?.providers) renderHealthProviders(data.providers);
    logActivity("health", "Health result received", {httpStatus:r.status, ok:!!(r.ok && data?.ok), providers:data?.providers || null}, r.ok && data?.ok ? "info" : "error");
  }catch(e){
    logActivity("error", "Health request failed", {url:healthUrl, error:e.message || "Няма връзка."}, "error");
    result.className = "health-result health-error";
    result.innerHTML =
      "<b>❌ Health заявката не може да бъде изпълнена</b>" +
      "<p><b>URL:</b> " + escapeHtml(healthUrl) + "</p>" +
      "<p><b>Грешка:</b> " + escapeHtml(e.message || "Няма връзка.") + "</p>";
  }
}

async function showBackendDiagnostic(cards, backend, scanError){
  logActivity("error", "Backend diagnostic started", {backend, scanError:scanError.message || "Неизвестна грешка"}, "error");
  cards.innerHTML = '<div class="card loading">Проверявам състоянието на Backend-а…</div>';
  const healthUrl = backend.replace(/\/$/,"") + "/api/health";

  try {
    const r = await fetch(healthUrl,{cache:"no-store"});
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    cards.innerHTML =
      '<div class="card error">' +
        '<b>' + (r.ok && data?.ok ? '⚠️ Backend-ът работи, но Update не е успешен' : '❌ Backend health check не премина') + '</b>' +
        '<p><b>Health URL:</b> ' + escapeHtml(healthUrl) + '</p>' +
        '<p><b>Health HTTP:</b> ' + escapeHtml(String(r.status)) + '</p>' +
        '<p><b>Health резултат:</b> ' + escapeHtml(data ? JSON.stringify(data) : (text || "Няма четим отговор.")) + '</p>' +
        '<p><b>Първоначална грешка:</b> ' + escapeHtml(scanError.message || "Неизвестна грешка") + '</p>' +
      '</div>';
  } catch (healthError) {
    cards.innerHTML =
      '<div class="card error">' +
        '<b>❌ Backend-ът не може да бъде достигнат</b>' +
        '<p><b>Health URL:</b> ' + escapeHtml(healthUrl) + '</p>' +
        '<p><b>Health check:</b> ' + escapeHtml(healthError.message || "Няма връзка.") + '</p>' +
        '<p><b>Първоначална грешка:</b> ' + escapeHtml(scanError.message || "Неизвестна грешка") + '</p>' +
      '</div>';
  }
}

function card(x,target,levels){
  const entries = positionEntries(x.symbol);
  if (x.status && x.status !== "ok") return statusCard(x);

  const selected = state.selectedSymbols.includes(x.symbol);
  let cls="wait", signal="⚪ WAIT", reason="", plan="";
  const dd=x.drawdownPct;
  const sortedLevels=levels.slice().sort((a,b)=>a-b);
  const reached=sortedLevels.filter(l => dd <= -l).pop();
  const next=sortedLevels.find(l => dd > -l);

  if(entries.length){
    const avgEntry=entries.reduce((sum,v)=>sum+v,0)/entries.length;
    const pnl=(x.price/avgEntry-1)*100;
    if(pnl >= target){
      cls="exit"; signal="🔵 EXIT ZONE";
      reason="Позицията е на " + pnl.toFixed(2) + "% спрямо средния вход. Целта +" + target + "% е достигната.";
    } else {
      cls="watch"; signal="🟡 HOLD / WATCH";
      reason="Позицията е на " + pnl.toFixed(2) + "% спрямо средния вход. Целта е +" + target + "%.";
    }
  } else if(reached){
    cls="entry"; signal="🟢 ENTRY ZONE";
    reason="Цената е " + Math.abs(dd).toFixed(2) + "% под 60-дневния връх. Достигнато ниво: -" + reached + "%.";
  } else {
    cls="wait"; signal="⚪ WAIT";
    reason=next ? "Следващо наблюдавано ниво: -" + next + "%." : "Няма активен входен сигнал.";
  }

  if(!entries.length && sortedLevels.length){
    const planLevel = reached || next || sortedLevels[sortedLevels.length-1];
    const planPrice = x.high60 * (1 - planLevel / 100);
    plan = '<div class="position">Предполагаем вход: <b>$' + num(planPrice) + '</b> · ниво -' + planLevel + '%</div>';
  }

  const div=document.createElement("article");
  div.className="card " + cls + (selected ? " selected" : "");
  div.dataset.symbolCard = x.symbol;
  div.innerHTML =
    '<div class="top">' +
      '<label class="selection"><input type="checkbox" data-select="' + escapeHtml(x.symbol) + '"' + (selected ? " checked" : "") + '> Заявка при Update</label>' +
      '<button class="remove" data-remove="' + escapeHtml(x.symbol) + '">×</button>' +
    '</div>' +
    '<div class="symbol">' + escapeHtml(x.symbol) + ' <span class="company-name">' + escapeHtml(companyName(x.symbol)) + '</span></div>' +
    '<div class="price">$' + num(x.price) + '</div>' +
    '<div class="signal">' + signal + '</div>' +
    '<div class="metrics">' +
      '<div class="metric">60d high<b>$' + num(x.high60) + '</b></div>' +
      '<div class="metric">От връха<b>' + dd.toFixed(2) + '%</b></div>' +
      '<div class="metric">Ден<b>' + (x.changePct>=0?"+":"") + x.changePct.toFixed(2) + '%</b></div>' +
      '<div class="metric">Обновено<b>' + escapeHtml(x.date || "—") + '</b></div>' +
    '</div>' +
    (entries.length ? '<div class="position">Входове: <b>' + entries.length + '</b> · Среден вход: <b>$' + num(entries.reduce((sum,v)=>sum+v,0)/entries.length) + '</b> · P/L: <b>' + ((x.price/(entries.reduce((sum,v)=>sum+v,0)/entries.length)-1)*100).toFixed(2) + '%</b></div>' : plan) +
    '<div class="reason">' + escapeHtml(reason) + '</div>' +
    '<div class="data-source">Data: ' + escapeHtml(providerName(x.source)) + '</div>' +
    '<button type="button" class="hide-btn" data-hide="' + escapeHtml(x.symbol) + '">Скрий</button>';

  div.querySelector("[data-select]").onchange = e => setSelected(x.symbol,e.target.checked);
  div.querySelector("[data-remove]").onclick=()=>hideStock(x.symbol);
  div.querySelector("[data-hide]").onclick=()=>hideStock(x.symbol);
  return div;
}

function positionEntries(symbol){
  const raw=state.positions[symbol];
  if(Array.isArray(raw)) return raw.map(Number).filter(v=>Number.isFinite(v) && v>0);
  if(typeof raw==="number" && Number.isFinite(raw) && raw>0) return [raw];
  return [];
}
function statusCard(x){
  const selected = state.selectedSymbols.includes(x.symbol);
  const labels = {
    rate_limited: "⚠️ API LIMIT",
    no_data: "⚠️ NO DATA",
    invalid_symbol: "❌ INVALID SYMBOL",
    insufficient_history: "⚠️ INSUFFICIENT HISTORY",
    error: "⚠️ DATA ERROR",
    provider_unavailable: "⚠️ PROVIDER UNAVAILABLE"
  };
  const div=document.createElement("article");
  div.className="card error" + (selected ? " selected" : "");
  div.dataset.symbolCard = x.symbol;
  div.innerHTML =
    '<div class="top">' +
      '<label class="selection"><input type="checkbox" data-select="' + escapeHtml(x.symbol) + '"' + (selected ? " checked" : "") + '> Заявка при Update</label>' +
      '<button class="remove" data-remove="' + escapeHtml(x.symbol) + '">×</button>' +
    '</div>' +
    '<div class="symbol">' + escapeHtml(x.symbol) + ' <span class="company-name">' + escapeHtml(companyName(x.symbol)) + '</span></div>' +
    '<div class="signal">' + (labels[x.status] || "⚠️ DATA ERROR") + '</div>' +
    '<div class="reason">' + escapeHtml(x.error || "Няма данни.") + '</div>' +
    (Array.isArray(x.attempts) ? '<div class="provider-attempts">' + x.attempts.map(a => '<div><b>' + escapeHtml(providerName(a.provider)) + ':</b> ' + escapeHtml(a.status) + (a.message ? ' — ' + escapeHtml(a.message) : '') + '</div>').join('') + '</div>' : '') +
    '<div class="data-source">Data: ' + escapeHtml(providerName(x.source)) + '</div>' +
    '<button type="button" class="hide-btn" data-hide="' + escapeHtml(x.symbol) + '">Скрий</button>';
  div.querySelector("[data-select]").onchange = e => setSelected(x.symbol,e.target.checked);
  div.querySelector("[data-remove]").onclick=()=>hideStock(x.symbol);
  div.querySelector("[data-hide]").onclick=()=>hideStock(x.symbol);
  return div;
}

const num=x=>Number(x).toFixed(2);
function companyName(symbol){ return DEFAULTS.companyNames[symbol] || symbol; }
function providerName(source){
  return ({alphavantage:"Alpha Vantage",twelvedata:"Twelve Data",finnhub:"Finnhub",cache:"Cache"})[source] || source || "—";
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

renderCards();
