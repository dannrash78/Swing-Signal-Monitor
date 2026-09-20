const DEFAULTS = {
  symbols: ["NVDA","AMD","MU","AVGO","TSLA","AAPL","AMZN","META","MSFT","GOOGL"],
  target: 10,
  levels: [5,8,10],
  backend: "https://swing-signal-backend.danniel-rashev.workers.dev"
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

const $ = id => document.getElementById(id);
$("backendUrl").value = localStorage.getItem("swingBackend") || DEFAULTS.backend;
$("targetPct").value = DEFAULTS.target;
$("levels").value = DEFAULTS.levels.join(",");

$("saveSettings").onclick = () => {
  const backend = $("backendUrl").value.trim().replace(/\/$/,"");
  localStorage.setItem("swingBackend", backend);
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
  state.hiddenSymbols.forEach(symbol => {
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

  state.symbols.filter(symbol => !state.hiddenSymbols.includes(symbol)).forEach(symbol => {
    const result = results.get(symbol);
    cards.appendChild(result ? card(result,target,levels) : placeholderCard(symbol));
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
    '<div class="symbol">' + escapeHtml(symbol) + '</div>' +
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
    const url = backend + "/api/scan?symbols=" + encodeURIComponent(selected.join(","));
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
      "<p><b>Резултат:</b> " + escapeHtml(data ? JSON.stringify(data) : (text || "Няма четим отговор.")) + "</p>";
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
    '<div class="symbol">' + escapeHtml(x.symbol) + '</div>' +
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
    error: "⚠️ DATA ERROR"
  };
  const div=document.createElement("article");
  div.className="card error" + (selected ? " selected" : "");
  div.dataset.symbolCard = x.symbol;
  div.innerHTML =
    '<div class="top">' +
      '<label class="selection"><input type="checkbox" data-select="' + escapeHtml(x.symbol) + '"' + (selected ? " checked" : "") + '> Заявка при Update</label>' +
      '<button class="remove" data-remove="' + escapeHtml(x.symbol) + '">×</button>' +
    '</div>' +
    '<div class="symbol">' + escapeHtml(x.symbol) + '</div>' +
    '<div class="signal">' + (labels[x.status] || "⚠️ DATA ERROR") + '</div>' +
    '<div class="reason">' + escapeHtml(x.error || "Няма данни.") + '</div>' +
    '<button type="button" class="hide-btn" data-hide="' + escapeHtml(x.symbol) + '">Скрий</button>';
  div.querySelector("[data-select]").onchange = e => setSelected(x.symbol,e.target.checked);
  div.querySelector("[data-remove]").onclick=()=>hideStock(x.symbol);
  div.querySelector("[data-hide]").onclick=()=>hideStock(x.symbol);
  return div;
}

const num=x=>Number(x).toFixed(2);
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

renderCards();
