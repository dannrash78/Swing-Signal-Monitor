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
  hiddenSymbols: []
};

state.symbols = Array.isArray(state.symbols) ? state.symbols : DEFAULTS.symbols.slice();
state.positions = state.positions || {};
state.selectedSymbols = Array.isArray(state.selectedSymbols)
  ? state.selectedSymbols.filter(s => state.symbols.includes(s))
  : state.symbols.slice();
state.lastResults = Array.isArray(state.lastResults) ? state.lastResults : [];
state.hiddenSymbols = Array.isArray(state.hiddenSymbols) ? state.hiddenSymbols.filter(s => state.symbols.includes(s)) : [];
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
renderProviderSettings();

$("saveSettings").onclick = () => {
  const backend = $("backendUrl").value.trim().replace(/\/$/,"");
  localStorage.setItem("swingBackend", backend);
  saveProviderSettings();
  renderCards();
};

$("updateBtn").onclick = updateSelected;
$("healthBtn").onclick = checkHealth;
$("hiddenToggleBtn").onclick = () => {
  const section = document.querySelector(".hidden-section");
  const hidden = section.hasAttribute("hidden");
  if (hidden) section.removeAttribute("hidden"); else section.setAttribute("hidden", "");
  updateHiddenToggle();
};

$("addBtn").onclick = () => {
  $("symbol").value = "";
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
  if (!/^[A-Z.]{1,8}$/.test(s)) return alert("Въведи валиден ticker.");
  if (!state.symbols.includes(s)) state.symbols.push(s);
  if (!state.selectedSymbols.includes(s)) state.selectedSymbols.push(s);
  if ($("holding").checked && Number($("entryPrice").value) > 0) state.positions[s] = Number($("entryPrice").value);
  else delete state.positions[s];
  save();
  $("stockDialog").close();
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
function updateUsagePanel(usage){
  const el = $("providerUsage");
  if (!el) return;
  const key = "swingTwelveDailyUsage";
  const today = new Date().toISOString().slice(0,10);
  const stored = JSON.parse(localStorage.getItem(key) || "null") || {date:today,calls:0};
  if (stored.date !== today) { stored.date=today; stored.calls=0; }
  if (usage?.twelvedata?.apiCalls) {
    stored.calls += Number(usage.twelvedata.apiCalls) || 0;
    localStorage.setItem(key, JSON.stringify(stored));
  }
  const remaining = Math.max(0, 800 - stored.calls);
  const minuteLeft = usage?.twelvedata?.minuteCreditsLeft;
  el.innerHTML =
    "<div><b>Twelve Data:</b> ~" + remaining + " дневни кредита оставащи (локална оценка)</div>" +
    "<div><b>Twelve Data:</b> " + (Number.isFinite(minuteLeft) ? minuteLeft : "—") + " кредита за текущата минута</div>" +
    "<div><b>Alpha Vantage:</b> остатъкът не се отчита надеждно от API</div>" +
    "<div><b>Finnhub:</b> остатъкът не се отчита от този backend</div>";
}
function providerName(source){
  return ({alphavantage:"Alpha Vantage",twelvedata:"Twelve Data",finnhub:"Finnhub",cache:"Cache"})[source] || source || "—";
}
function renderHealthProviders(providers){
  const el = $("providerHealth");
  if (!el) return;
  el.innerHTML = Object.entries(providers).map(([p,v]) =>
    '<span class="provider-badge ' + (v.configured ? 'ok' : 'off') + '">' +
    escapeHtml(DEFAULTS.providers[p]?.name || p) + ": " + (v.configured ? "configured" : "not configured") +
    "</span>"
  ).join("");
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

function renderCards(){
  const cards = $("cards");
  const target = Number($("targetPct").value) || 10;
  const levels = $("levels").value.split(",").map(Number).filter(x=>x>0);
  const results = new Map(state.lastResults.map(x=>[x.symbol,x]));

  cards.innerHTML = "";

  if (!state.symbols.length) {
    cards.innerHTML = '<div class="card"><b>Watchlist е празен.</b><p>Добави акция, за да започнеш.</p></div>';
    return;
  }

  const visibleSymbols = state.symbols
    .filter(symbol => !state.hiddenSymbols.includes(symbol))
    .sort((a,b) => {
      const ra = DEFAULTS.regions[a] || "Други";
      const rb = DEFAULTS.regions[b] || "Други";
      return ra.localeCompare(rb, "bg") || a.localeCompare(b, "en");
    });

  const groups = [...new Set(visibleSymbols.map(symbol => DEFAULTS.regions[symbol] || "Други"))];
  groups.forEach(region => {
    const heading = document.createElement("div");
    heading.className = "region-heading";
    heading.textContent = region + " акции";
    cards.appendChild(heading);
    visibleSymbols.filter(symbol => (DEFAULTS.regions[symbol] || "Други") === region).forEach(symbol => {
      const result = results.get(symbol);
      cards.appendChild(result ? card(result,target,levels) : placeholderCard(symbol));
    });
  });
  renderHiddenList();
  updateHiddenToggle();
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

    state.lastResults = mergeResults(state.lastResults,data.results);
    save();
    renderCards();
  }catch(e){
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
  }catch(e){
    result.className = "health-result health-error";
    result.innerHTML =
      "<b>❌ Health заявката не може да бъде изпълнена</b>" +
      "<p><b>URL:</b> " + escapeHtml(healthUrl) + "</p>" +
      "<p><b>Грешка:</b> " + escapeHtml(e.message || "Няма връзка.") + "</p>";
  }
}

async function showBackendDiagnostic(cards, backend, scanError){
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
  const entry = state.positions[x.symbol];
  if (x.status && x.status !== "ok") return statusCard(x);

  const selected = state.selectedSymbols.includes(x.symbol);
  let cls="wait", signal="⚪ WAIT", reason="";
  const dd=x.drawdownPct;
  const reached=levels.find(l => dd <= -l);

  if(entry){
    const pnl=(x.price/entry-1)*100;
    if(pnl >= target){
      cls="exit"; signal="🔵 EXIT ZONE";
      reason="Позицията е на " + pnl.toFixed(2) + "% спрямо входа. Целта +" + target + "% е достигната.";
    } else {
      cls="watch"; signal="🟡 HOLD / WATCH";
      reason="Позицията е на " + pnl.toFixed(2) + "% спрямо входа. Целта е +" + target + "%.";
    }
  } else if(reached){
    cls="entry"; signal="🟢 ENTRY ZONE";
    reason="Цената е " + Math.abs(dd).toFixed(2) + "% под 60-дневния връх. Достигнато ниво: -" + reached + "%.";
  } else {
    const next=levels.slice().sort((a,b)=>a-b).find(l=>dd > -l);
    cls="wait"; signal="⚪ WAIT";
    reason=next ? "Следващо наблюдавано ниво: -" + next + "%." : "Няма активен входен сигнал.";
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
    (entry ? '<div class="position">Вход: <b>$' + num(entry) + '</b> · P/L: <b>' + ((x.price/entry-1)*100).toFixed(2) + '%</b></div>' : '') +
    '<div class="reason">' + escapeHtml(reason) + '</div>' +
    '<div class="data-source">Data: ' + escapeHtml(providerName(x.source)) + '</div>' +
    '<button type="button" class="hide-btn" data-hide="' + escapeHtml(x.symbol) + '">Скрий</button>';

  div.querySelector("[data-select]").onchange = e => setSelected(x.symbol,e.target.checked);
  div.querySelector("[data-remove]").onclick=()=>hideStock(x.symbol);
  div.querySelector("[data-hide]").onclick=()=>hideStock(x.symbol);
  return div;
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
