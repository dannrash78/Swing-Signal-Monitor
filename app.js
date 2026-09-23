const STRATEGY_PROFILE = {
  debtToEquityMax: 1.0,
  roeMin: 10,
  epsQoqMin: 10,
  salesQoqMin: 10,
  epsTtmMin: 10,
  salesTtmMin: 10,
  requireAboveSma200: true
};

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
  backend: "",
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
  viewMode: "cards",
  fundamentals: {},
  marketRegime: null,
  risk: { portfolioCapital: 0, riskPerTradePct: 1, stopLossPct: 7 }
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
state.sortOrder = ["alpha","signal","priceDesc","priceAsc"].includes(state.sortOrder) ? state.sortOrder : "alpha";
state.viewMode = state.viewMode === "table" ? "table" : "cards";
state.fundamentals = state.fundamentals && typeof state.fundamentals === "object" ? state.fundamentals : {};
state.marketRegime = state.marketRegime && typeof state.marketRegime === "object" ? state.marketRegime : null;
state.risk = state.risk && typeof state.risk === "object" ? state.risk : {};
state.risk.portfolioCapital = Number.isFinite(Number(state.risk.portfolioCapital)) ? Math.max(0,Number(state.risk.portfolioCapital)) : 0;
state.risk.riskPerTradePct = Number.isFinite(Number(state.risk.riskPerTradePct)) ? Math.min(10,Math.max(0.1,Number(state.risk.riskPerTradePct))) : 1;
state.risk.stopLossPct = Number.isFinite(Number(state.risk.stopLossPct)) ? Math.min(50,Math.max(0.5,Number(state.risk.stopLossPct))) : 7;
state.providers = state.providers || {};
state.groupSettings = state.groupSettings && typeof state.groupSettings === "object" ? state.groupSettings : {};
const legacySort = ["alpha","signal","priceDesc","priceAsc"].includes(state.sortOrder) ? state.sortOrder : "alpha";
const legacyView = state.viewMode === "table" ? "table" : "cards";
state.groupSettings.owned = { sortOrder:["alpha","signal","priceDesc","priceAsc"].includes(state.groupSettings.owned?.sortOrder)?state.groupSettings.owned.sortOrder:legacySort, viewMode:state.groupSettings.owned?.viewMode==="table"?"table":legacyView };
state.groupSettings.other = { sortOrder:["alpha","signal","priceDesc","priceAsc"].includes(state.groupSettings.other?.sortOrder)?state.groupSettings.other.sortOrder:legacySort, viewMode:state.groupSettings.other?.viewMode==="table"?"table":legacyView };
state.target = Number.isFinite(Number(state.target)) ? Number(state.target) : DEFAULTS.target;
state.levels = Array.isArray(state.levels) ? state.levels.map(Number).filter(x=>Number.isFinite(x)&&x>0) : DEFAULTS.levels.slice();
if (!state.levels.length) state.levels = DEFAULTS.levels.slice();
Object.keys(state.positions).forEach(s => {
  if (Array.isArray(state.positions[s])) state.positions[s]=state.positions[s].map(v=>{
    if(typeof v==="number"&&Number.isFinite(v)&&v>0)return {price:v,quantity:1};
    const price=Number(v?.price), quantity=Number(v?.quantity);
    return Number.isFinite(price)&&price>0&&Number.isFinite(quantity)&&quantity>0?{price,quantity}:null;
  }).filter(Boolean);
});
Object.keys(DEFAULTS.providers).forEach(p => {
  state.providers[p] = { ...DEFAULTS.providers[p], ...(state.providers[p] || {}) };
});
state.secretNames = state.secretNames && typeof state.secretNames === "object" ? state.secretNames : {};
Object.keys(DEFAULTS.providers).forEach(p => {
  state.secretNames[p] = state.secretNames[p] || state.providers[p].secretName || DEFAULTS.providers[p].secretName;
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
function parseCsv(text){
  const rows=[];
  let row=[], field="", quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch === '"'){
      if(quoted && text[i+1] === '"'){ field+='"'; i++; }
      else quoted=!quoted;
    }else if(ch === "," && !quoted){
      row.push(field); field="";
    }else if((ch === "\n" || ch === "\r") && !quoted){
      if(ch === "\r" && text[i+1] === "\n") i++;
      row.push(field); field="";
      if(row.some(v=>v.trim()!=="")) rows.push(row);
      row=[];
    }else{
      field+=ch;
    }
  }
  if(field!=="" || row.length){
    row.push(field);
    if(row.some(v=>v.trim()!=="")) rows.push(row);
  }
  return rows;
}
function csvKey(value){
  return String(value||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"");
}
function parsePercent(value){
  const s=String(value??"").trim().replace("%","");
  if(!s || s==="-" || s==="—" || s==="N/A") return null;
  const n=Number(s);
  return Number.isFinite(n) ? n : null;
}
function parseNumber(value){
  const s=String(value??"").trim().replace(/,/g,"");
  if(!s || s==="-" || s==="—" || s==="N/A") return null;
  const n=Number(s);
  return Number.isFinite(n) ? n : null;
}
function normalizeFinvizRow(headers,row){
  const data={};
  headers.forEach((h,i)=>data[csvKey(h)] = String(row[i]??"").trim());
  const ticker=data.ticker || data.symbol;
  if(!ticker) return null;
  return {
    ticker:ticker.toUpperCase(),
    debtToEquity:parseNumber(data.debteq || data.debttoequity),
    roe:parsePercent(data.roe),
    epsQoq:parsePercent(data.epsqoq),
    salesQoq:parsePercent(data.salesqoq),
    epsTtm:parsePercent(data.epsyytm || data.epsyyttm || data.epsttm),
    salesTtm:parsePercent(data.salesyoy || data.salesyy || data.salesyyttm || data.salesttm),
    price:parseNumber(data.price),
    sma200:parseNumber(data.sma200)
  };
}
function importFinvizData(text){
  const rows=parseCsv(text);
  if(rows.length<2) throw new Error("Finviz CSV няма достатъчно редове.");
  const headers=rows[0];
  const imported={};
  rows.slice(1).forEach(row=>{
    const item=normalizeFinvizRow(headers,row);
    if(item) imported[item.ticker]=item;
  });
  if(!Object.keys(imported).length) throw new Error("Не открих валидни ticker редове във Finviz CSV.");
  state.fundamentals={...state.fundamentals,...imported};
  save();
  renderCards();
  logActivity("settings","Finviz CSV imported",{rows:Object.keys(imported).length});
}
function finvizAssessment(symbol){
  const f=state.fundamentals[symbol];
  if(!f) return {status:"missing",known:0,total:7,passes:0,failures:0};
  const checks=[
    ["D/E", f.debtToEquity, v=>v<=STRATEGY_PROFILE.debtToEquityMax],
    ["ROE", f.roe, v=>v>=STRATEGY_PROFILE.roeMin],
    ["EPS Q/Q", f.epsQoq, v=>v>=STRATEGY_PROFILE.epsQoqMin],
    ["Sales Q/Q", f.salesQoq, v=>v>=STRATEGY_PROFILE.salesQoqMin],
    ["EPS TTM", f.epsTtm, v=>v>=STRATEGY_PROFILE.epsTtmMin],
    ["Sales TTM", f.salesTtm, v=>v>=STRATEGY_PROFILE.salesTtmMin],
    ["Price>SMA200", (Number.isFinite(f.price)&&Number.isFinite(f.sma200)) ? f.price-f.sma200 : null, v=>v>0]
  ];
  let known=0,passes=0,failures=0;
  checks.forEach(([,value,test])=>{
    if(value===null || !Number.isFinite(value)) return;
    known++;
    if(test(value)) passes++; else failures++;
  });
  return {status:failures ? "fail" : (known===checks.length ? "pass" : "incomplete"),known,total:checks.length,passes,failures};
}
function finvizSummary(symbol){
  const a=finvizAssessment(symbol);
  if(a.status==="missing") return "Finviz: няма импортирани данни";
  if(a.status==="pass") return "Finviz профил: PASS 7/7";
  if(a.status==="fail") return "Finviz профил: REVIEW " + a.passes + "/" + a.total;
  return "Finviz профил: INCOMPLETE " + a.known + "/" + a.total;
}
$("importFinvizBtn").onclick=()=>$("finvizFile").click();
$("finvizFile").onchange=async e=>{
  const file=e.target.files?.[0];
  if(!file) return;
  try{ importFinvizData(await file.text()); }
  catch(err){
    alert(err.message || "Неуспешен Finviz import.");
    logActivity("error","Finviz CSV import failed",{error:err.message || "Unknown error"},"error");
  }finally{
    e.target.value="";
  }
};

const FINVIZ_PRESETS = {
  growthTrend: "https://finviz.com/screener.ashx?v=111&f=fa_epsqoq_o10,fa_salesqoq_o10,ta_sma200_pa",
  growthQuality: "https://finviz.com/screener.ashx?v=111&f=fa_epsqoq_o10,fa_salesqoq_o10,fa_roe_o10,fa_debteq_u1",
  full: "https://finviz.com/screener.ashx?v=111&f=fa_epsqoq_o10,fa_salesqoq_o10,fa_roe_o10,fa_debteq_u1,ta_sma200_pa"
};
$("openFinvizPresetBtn").onclick=()=>{
  const key=$("finvizPreset").value;
  const url=FINVIZ_PRESETS[key];
  if(!url){ alert("Избери Finviz preset."); return; }
  window.open(url,"_blank","noopener");
  logActivity("settings","Finviz preset opened",{preset:key,url});
};
renderProviderSettings();
renderActivityLog();
scheduleUsageReset();
$("updateBtn").onclick = updateSelected;
$("healthBtn").onclick = checkHealth;
$("updateMarketBtn").onclick = updateMarket;
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


$("addStockBtn").onclick = () => {
  const dialog=$("addStockDialog");
  const input=$("newStockSymbol");
  if(!dialog || !input) return;
  input.value="";
  dialog.showModal();
  setTimeout(()=>input.focus(),0);
};
$("cancelAddStock").onclick = () => $("addStockDialog").close();
$("addStockForm").onsubmit = e => {
  e.preventDefault();
  const symbol=$("newStockSymbol").value.trim().toUpperCase();
  if(!/^[A-Z.]{1,8}$/.test(symbol)){
    alert("Въведи валиден ticker (A-Z и при нужда .), например ACAD.");
    return;
  }
  if(state.symbols.includes(symbol)){
    if(state.hiddenSymbols.includes(symbol)){
      state.hiddenSymbols=state.hiddenSymbols.filter(s=>s!==symbol);
      if(!state.selectedSymbols.includes(symbol)) state.selectedSymbols.push(symbol);
      save();
      $("addStockDialog").close();
      renderCards();
      logActivity("settings","Hidden stock restored",{symbol});
      return;
    }
    alert(symbol+" вече е в Watchlist.");
    return;
  }
  state.symbols.push(symbol);
  state.selectedSymbols.push(symbol);
  save();
  $("addStockDialog").close();
  renderCards();
  logActivity("settings","Stock added to watchlist",{symbol});
};

$("addBtn").onclick = () => {
  const visible = populatePositionSymbols();
  if (!visible.length) {
    alert("Няма видими акции, за които да се въведе позиция.");
    return;
  }
  $("symbol").value = visible[0];
  $("holding").checked = false;
  $("entryPrice").value = "";
  $("entryQuantity").value = "1";
  $("entryPrice").disabled = true;
  $("entryQuantity").disabled = true;
  $("stockDialog").showModal();
};
$("holding").onchange = e => {
  $("entryPrice").disabled = !e.target.checked;
  $("entryQuantity").disabled = !e.target.checked;
};
$("cancelStock").onclick = () => $("stockDialog").close();

$("stockForm").onsubmit = e => {
  e.preventDefault();
  const s = $("symbol").value.trim().toUpperCase();
  const visibleSymbols = state.symbols.filter(x => !state.hiddenSymbols.includes(x));
  if (!visibleSymbols.includes(s)) return alert("Избери акция от видимия списък.");
  const price=Number($("entryPrice").value);
  const quantity=Number($("entryQuantity").value);
  if ($("holding").checked && price > 0 && quantity > 0) {
    const entries = positionEntries(s);
    entries.push({price,quantity});
    state.positions[s] = entries;
  } else if ($("holding").checked) {
    return alert("Въведи валидни цена и количество.");
  } else {
    delete state.positions[s];
  }
  save();
  $("stockDialog").close();
  logActivity("settings", $("holding").checked ? "Position added/updated" : "Position cleared / sold", {symbol:s, holding:$("holding").checked});
  renderCards();
};

function save(){ localStorage.setItem("swingState", JSON.stringify(state)); }
function providerSecretNames(){
  const names = {};
  Object.keys(DEFAULTS.providers).forEach(p => {
    const value = String(state.secretNames?.[p] || state.providers?.[p]?.secretName || DEFAULTS.providers[p].secretName).trim().toUpperCase();
    names[p] = /^[A-Z][A-Z0-9_]{0,62}$/.test(value) ? value : DEFAULTS.providers[p].secretName;
  });
  return names;
}

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

function hasPosition(symbol){
  return positionEntries(symbol).length > 0;
}
function sellPosition(symbol){
  const entries=positionEntries(symbol);
  if(!entries.length) return;

  const totalQuantity = entries.reduce((sum,e)=>sum+Number(e.quantity||0),0);
  const raw = prompt(
    "Колко акции от " + symbol + " продаваш?\\n\\nИмаш общо: " + totalQuantity + " акции.",
    String(totalQuantity)
  );

  if(raw === null) return;

  const quantity = Number(String(raw).replace(",", "."));
  if(!Number.isFinite(quantity) || quantity <= 0){
    alert("Въведи валидно количество акции.");
    return;
  }
  if(quantity > totalQuantity){
    alert("Не можеш да продадеш " + quantity + " акции. Имаш само " + totalQuantity + ".");
    return;
  }

  const remainingQuantity = totalQuantity - quantity;
  const confirmMessage =
    "Потвърди продажбата на " + quantity + " акции от " + symbol + "?\\n\\n" +
    "Общо преди продажбата: " + totalQuantity + " акции.\\n" +
    "Ще останат: " + remainingQuantity + " акции.";

  if(!confirm(confirmMessage)) return;

  let toSell = quantity;
  const updatedEntries = [];

  for(const entry of entries){
    const entryQuantity = Number(entry.quantity||0);
    if(toSell <= 0){
      updatedEntries.push(entry);
      continue;
    }

    const soldFromEntry = Math.min(entryQuantity, toSell);
    const leftFromEntry = entryQuantity - soldFromEntry;
    toSell -= soldFromEntry;

    if(leftFromEntry > 0){
      updatedEntries.push({...entry, quantity:leftFromEntry});
    }
  }

  if(remainingQuantity <= 0){
    delete state.positions[symbol];
  }else{
    state.positions[symbol] = updatedEntries;
  }

  save();
  logActivity("settings","Position partially/fully sold",{
    symbol,
    soldQuantity:quantity,
    remainingQuantity,
    entriesBefore:entries,
    entriesAfter:remainingQuantity > 0 ? updatedEntries : []
  });
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
  updateSelectAllControl();
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

async function exportLocalData(){
  const payload={
    format:"Swing Signal Monitor local backup",
    version:"1.20.0",
    exportedAt:new Date().toISOString(),
    backendUrl:localStorage.getItem("swingBackend") || "",
    state:JSON.parse(JSON.stringify(state)),
    targetPct:String(state.target),
    levels:state.levels.join(","),
    secretNames:providerSecretNames()
  };
  const json=JSON.stringify(payload,null,2);
  const fileName="swing-signal-monitor-backup-" + localUsageDate() + ".json";

  try{
    if("showSaveFilePicker" in window){
      const handle=await window.showSaveFilePicker({
        suggestedName:fileName,
        types:[{
          description:"Swing Signal Monitor backup",
          accept:{"application/json":[".json"]}
        }]
      });
      const writable=await handle.createWritable();
      await writable.write(json);
      await writable.close();
    }else{
      const blob=new Blob([json],{type:"application/json;charset=utf-8"});
      const a=document.createElement("a");
      a.href=URL.createObjectURL(blob);
      a.download=fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    }
    logActivity("settings","Local data exported",{version:payload.version,fileName});
  }catch(err){
    if(err?.name==="AbortError") return;
    throw err;
  }
}

function normalizeLoadedState(raw){
  if(!raw || typeof raw!=="object") throw new Error("Невалиден backup файл.");
  const next={
    symbols:Array.isArray(raw.symbols) ? raw.symbols.filter(s=>typeof s==="string") : DEFAULTS.symbols.slice(),
    positions:raw.positions && typeof raw.positions==="object" ? raw.positions : {},
    selectedSymbols:Array.isArray(raw.selectedSymbols) ? raw.selectedSymbols.filter(s=>typeof s==="string") : [],
    lastResults:Array.isArray(raw.lastResults) ? raw.lastResults : [],
    hiddenSymbols:Array.isArray(raw.hiddenSymbols) ? raw.hiddenSymbols.filter(s=>typeof s==="string") : [],
    sortOrder:["alpha","signal","priceDesc","priceAsc"].includes(raw.sortOrder) ? raw.sortOrder : "alpha",
    viewMode:raw.viewMode==="table" ? "table" : "cards",
    groupSettings:raw.groupSettings && typeof raw.groupSettings==="object" ? raw.groupSettings : {},
    target:Number.isFinite(Number(raw.target)) ? Number(raw.target) : DEFAULTS.target,
    levels:Array.isArray(raw.levels) ? raw.levels.map(Number).filter(x=>Number.isFinite(x)&&x>0) : DEFAULTS.levels.slice(),
    providers:raw.providers && typeof raw.providers==="object" ? raw.providers : {},
    fundamentals:raw.fundamentals && typeof raw.fundamentals==="object" ? raw.fundamentals : {},
    marketRegime:raw.marketRegime && typeof raw.marketRegime==="object" ? raw.marketRegime : null,
    risk:raw.risk && typeof raw.risk==="object" ? raw.risk : {},
    secretNames:raw.secretNames && typeof raw.secretNames==="object" ? raw.secretNames : {}
  };
  if(!next.symbols.length) next.symbols=DEFAULTS.symbols.slice();
  next.symbols=[...new Set(next.symbols)];
  next.selectedSymbols=[...new Set(next.selectedSymbols.filter(s=>next.symbols.includes(s)))];
  next.hiddenSymbols=[...new Set(next.hiddenSymbols.filter(s=>next.symbols.includes(s)))];
  if(!next.selectedSymbols.length) next.selectedSymbols=next.symbols.slice();
  Object.keys(next.positions).forEach(s=>{
    const v=next.positions[s];
    if(typeof v==="number"&&Number.isFinite(v)&&v>0)next.positions[s]=[{price:v,quantity:1}];
    else if(Array.isArray(v))next.positions[s]=v.map(item=>{
      if(typeof item==="number"&&Number.isFinite(item)&&item>0)return {price:item,quantity:1};
      const price=Number(item?.price),quantity=Number(item?.quantity);
      return Number.isFinite(price)&&price>0&&Number.isFinite(quantity)&&quantity>0?{price,quantity}:null;
    }).filter(Boolean);
    else delete next.positions[s];
  });
  const legacySort=["alpha","signal","priceDesc","priceAsc"].includes(next.sortOrder)?next.sortOrder:"alpha";
  const legacyView=next.viewMode==="table"?"table":"cards";
  next.groupSettings.owned={sortOrder:["alpha","signal","priceDesc","priceAsc"].includes(next.groupSettings?.owned?.sortOrder)?next.groupSettings.owned.sortOrder:legacySort,viewMode:next.groupSettings?.owned?.viewMode==="table"?"table":legacyView};
  next.groupSettings.other={sortOrder:["alpha","signal","priceDesc","priceAsc"].includes(next.groupSettings?.other?.sortOrder)?next.groupSettings.other.sortOrder:legacySort,viewMode:next.groupSettings?.other?.viewMode==="table"?"table":legacyView};
  next.risk={portfolioCapital:Number.isFinite(Number(next.risk?.portfolioCapital))?Math.max(0,Number(next.risk.portfolioCapital)):0,riskPerTradePct:Number.isFinite(Number(next.risk?.riskPerTradePct))?Math.min(10,Math.max(0.1,Number(next.risk.riskPerTradePct))):1,stopLossPct:Number.isFinite(Number(next.risk?.stopLossPct))?Math.min(50,Math.max(0.5,Number(next.risk.stopLossPct))):7};
  if(!next.levels.length)next.levels=DEFAULTS.levels.slice();
  Object.keys(DEFAULTS.providers).forEach(p=>{
    next.providers[p]={...DEFAULTS.providers[p],...(next.providers[p]||{})};
    next.secretNames[p]=String(next.secretNames[p] || next.providers[p].secretName || DEFAULTS.providers[p].secretName).trim().toUpperCase();
    if(!/^[A-Z][A-Z0-9_]{0,62}$/.test(next.secretNames[p])) next.secretNames[p]=DEFAULTS.providers[p].secretName;
    next.providers[p].secretName=next.secretNames[p];
  });
  return next;
}

async function importLocalData(file){
  if(!file) return;
  const text=await file.text();
  let payload;
  try{ payload=JSON.parse(text); }catch{ throw new Error("Файлът не е валиден JSON."); }
  const loadedState=normalizeLoadedState(payload.state || payload);
  if(!confirm("Зареди записаните Watchlist, позиции и настройки? Текущите локални данни ще бъдат заменени.")) return;

  state=loadedState;
  // Backend URL is part of the local backup so the complete configuration can be restored in another browser.
  const backend=String(payload.backendUrl || "").trim().replace(/\/$/,"");
  if(backend) localStorage.setItem("swingBackend",backend); else localStorage.removeItem("swingBackend");
  state.target=Number.isFinite(Number(payload.targetPct)) ? Number(payload.targetPct) : state.target;
  state.levels=String(payload.levels ?? state.levels.join(",")).split(",").map(Number).filter(x=>Number.isFinite(x)&&x>0);
  if(!state.levels.length)state.levels=DEFAULTS.levels.slice();
  state.fundamentals=state.fundamentals||{};
  state.secretNames=state.secretNames||{};
  Object.keys(DEFAULTS.providers).forEach(p=>{
    state.secretNames[p]=String(state.secretNames[p] || state.providers[p]?.secretName || DEFAULTS.providers[p].secretName).trim().toUpperCase();
    if(!/^[A-Z][A-Z0-9_]{0,62}$/.test(state.secretNames[p])) state.secretNames[p]=DEFAULTS.providers[p].secretName;
    state.providers[p].secretName=state.secretNames[p];
  });
  save();
  renderProviderSettings();
  renderCards();
  renderActivityLog();
  logActivity("settings","Local data imported",{sourceVersion:payload.version || "unknown"});
}

async function chooseAndImportLocalData(){
  try{
    if("showOpenFilePicker" in window){
      const handles=await window.showOpenFilePicker({
        multiple:false,
        types:[{
          description:"Swing Signal Monitor backup",
          accept:{"application/json":[".json"]}
        }]
      });
      if(handles?.[0]){
        const file=await handles[0].getFile();
        await importLocalData(file);
      }
    }else{
      $("loadDataFile").click();
    }
  }catch(err){
    if(err?.name==="AbortError") return;
    alert(err.message || "Неуспешно зареждане на backup.");
    logActivity("error","Local data import failed",{error:err.message || "Unknown error"},"error");
  }
}


$("saveDataBtn").onclick=async () => {
  try{ await exportLocalData(); }
  catch(err){
    alert(err.message || "Неуспешно записване на backup.");
    logActivity("error","Local data export failed",{error:err.message || "Unknown error"},"error");
  }
};
$("loadDataBtn").onclick=chooseAndImportLocalData;
$("loadDataFile").onchange=async e=>{
  try{ await importLocalData(e.target.files?.[0]); }
  catch(err){
    alert(err.message || "Неуспешно зареждане на backup.");
    logActivity("error","Local data import failed",{error:err.message || "Unknown error"},"error");
  } finally {
    e.target.value="";
  }
};
function additionalBuyState(x,levels){
  const dd=Number(x?.drawdownPct);
  const sortedLevels=levels.slice().sort((a,b)=>a-b);
  if(!Number.isFinite(dd) || !sortedLevels.length) return {kind:"wait",level:null};
  const reached=sortedLevels.filter(l => dd <= -l).pop();
  if(reached) return {kind:"entry",level:reached};
  const next=sortedLevels.find(l => dd > -l);
  return {kind:"wait",level:next || sortedLevels[sortedLevels.length-1]};
}
function signalRank(x,target,levels){
  if (!x) return 99;
  if (x.status && x.status !== "ok") return 90;
  const buy=additionalBuyState(x,levels);
  if(buy.kind==="entry") return 0;
  const entries=positionEntries(x.symbol);
  if(entries.length){
    const avgEntry=weightedAverageEntry(entries);
    const pnl=(x.price/avgEntry-1)*100;
    return pnl >= target ? 2 : 1;
  }
  return 3;
}

function getVisibleSymbols(results,target,levels){
  const visible = state.symbols.filter(symbol => !state.hiddenSymbols.includes(symbol));

  const compareWithinGroup=(a,b)=>{
    if (state.sortOrder === "signal") {
      const srA=signalRank(results.get(a),target,levels);
      const srB=signalRank(results.get(b),target,levels);
      if(srA !== srB) return srA-srB;
      const pa=Number(results.get(a)?.price), pb=Number(results.get(b)?.price);
      if(Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa-pb;
    }
    if (state.sortOrder === "priceAsc" || state.sortOrder === "priceDesc") {
      const pa=Number(results.get(a)?.price);
      const pb=Number(results.get(b)?.price);
      const av=Number.isFinite(pa), bv=Number.isFinite(pb);
      if(!av && !bv) return a.localeCompare(b,"en");
      if(!av) return 1;
      if(!bv) return -1;
      if(pa !== pb) return state.sortOrder === "priceAsc" ? pa-pb : pb-pa;
    }
    return a.localeCompare(b,"en");
  };

  const owned=[];
  const others=[];
  visible.forEach(symbol => (hasPosition(symbol) ? owned : others).push(symbol));
  owned.sort(compareWithinGroup);
  others.sort(compareWithinGroup);
  return [...owned,...others];
}


function updateSelectAllControl(){
  const control=$("selectAllUpdates");
  if(!control) return;
  const visible=state.symbols.filter(s => !state.hiddenSymbols.includes(s));
  const selectedVisible=visible.filter(s => state.selectedSymbols.includes(s));
  control.checked = visible.length > 0 && selectedVisible.length === visible.length;
  control.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visible.length;
}

function renderWatchlistControls(){
  if ($("sortOrder")) $("sortOrder").value = state.sortOrder;
  if ($("viewMode")) $("viewMode").value = state.viewMode;
  updateSelectAllControl();
}

function groupSortSettings(key){
  return state.groupSettings[key] || {sortOrder:"alpha",viewMode:"cards"};
}
function groupSymbolsFor(key,symbols,results,target,levels){
  const cfg=groupSortSettings(key);
  const compare=(a,b)=>{
    if(cfg.sortOrder==="signal"){
      const sa=signalRank(results.get(a),target,levels),sb=signalRank(results.get(b),target,levels);
      if(sa!==sb)return sa-sb;
      const pa=Number(results.get(a)?.price),pb=Number(results.get(b)?.price);
      if(Number.isFinite(pa)&&Number.isFinite(pb)&&pa!==pb)return pa-pb;
    }
    if(cfg.sortOrder==="priceAsc"||cfg.sortOrder==="priceDesc"){
      const pa=Number(results.get(a)?.price),pb=Number(results.get(b)?.price);
      const av=Number.isFinite(pa),bv=Number.isFinite(pb);
      if(!av&&!bv)return a.localeCompare(b,"en");
      if(!av)return 1;if(!bv)return -1;
      if(pa!==pb)return cfg.sortOrder==="priceAsc"?pa-pb:pb-pa;
    }
    return a.localeCompare(b,"en");
  };
  return symbols.slice().sort(compare);
}
function groupControlsHtml(key,symbols){
  const cfg=groupSortSettings(key),selected=symbols.filter(s=>state.selectedSymbols.includes(s)).length;
  const allChecked=symbols.length>0&&selected===symbols.length,indeterminate=selected>0&&selected<symbols.length;
  return '<div class="group-controls" data-group-controls="'+key+'">'+
    '<label class="master-select"><input type="checkbox" data-group-select="'+key+'"'+(allChecked?" checked":"")+(indeterminate?' data-indeterminate="true"':"")+'> Всички за Update</label>'+
    '<label>Подреди: <select data-group-sort="'+key+'">'+
      '<option value="alpha"'+(cfg.sortOrder==="alpha"?" selected":"")+'>Азбучен ред (A → Z)</option>'+
      '<option value="signal"'+(cfg.sortOrder==="signal"?" selected":"")+'>Сигнал (ENTRY най-отгоре)</option>'+
      '<option value="priceDesc"'+(cfg.sortOrder==="priceDesc"?" selected":"")+'>Price (висока → ниска)</option>'+
      '<option value="priceAsc"'+(cfg.sortOrder==="priceAsc"?" selected":"")+'>Price (ниска → висока)</option>'+
    '</select></label>'+
    '<label>Изглед: <select data-group-view="'+key+'">'+
      '<option value="cards"'+(cfg.viewMode==="cards"?" selected":"")+'>Карти</option>'+
      '<option value="table"'+(cfg.viewMode==="table"?" selected":"")+'>Таблица</option>'+
    '</select></label></div>';
}
function bindGroupControls(section,key,symbols){
  const master=section.querySelector('[data-group-select="'+key+'"]');
  if(master){
    master.indeterminate=master.dataset.indeterminate==="true";
    master.onchange=()=>{
      if(master.checked)state.selectedSymbols=[...new Set([...state.selectedSymbols,...symbols])];
      else state.selectedSymbols=state.selectedSymbols.filter(s=>!symbols.includes(s));
      save();renderCards();
    };
  }
  const sort=section.querySelector('[data-group-sort="'+key+'"]');
  if(sort)sort.onchange=e=>{state.groupSettings[key].sortOrder=e.target.value;save();renderCards();};
  const view=section.querySelector('[data-group-view="'+key+'"]');
  if(view)view.onchange=e=>{state.groupSettings[key].viewMode=e.target.value==="table"?"table":"cards";save();renderCards();};
}
function tickerLink(symbol){
  const safe=escapeHtml(symbol);
  return '<a class="ticker-link" href="https://finviz.com/stock?t='+encodeURIComponent(symbol)+'&ty=c&p=d&b=1" target="_blank" rel="noopener" title="Отвори графиката във Finviz">'+safe+'</a>';
}
function renderCards(){
  const cards=$("cards"),target=state.target,levels=state.levels.slice(),results=new Map(state.lastResults.map(x=>[x.symbol,x]));
  cards.innerHTML="";
  if(!state.symbols.length){cards.innerHTML='<div class="card"><b>Watchlist е празен.</b><p>Добави акция, за да започнеш.</p></div>';renderHiddenList();updateHiddenToggle();return;}
  const visible=state.symbols.filter(s=>!state.hiddenSymbols.includes(s));
  const owned=groupSymbolsFor("owned",visible.filter(hasPosition),results,target,levels);
  const others=groupSymbolsFor("other",visible.filter(s=>!hasPosition(s)),results,target,levels);
  renderGroup("Мои позиции",owned,"owned");
  renderGroup("Други наблюдавани",others,"other");
  renderHiddenList();updateHiddenToggle();
}
function renderGroup(title,symbols,key){
  if(!symbols.length)return;
  const section=document.createElement("section");
  section.className="watchlist-group "+(key==="owned"?"owned-group":"other-group");
  section.innerHTML='<div class="watchlist-group-title"><div class="group-title-main"><span>'+escapeHtml(title)+'</span><span class="watchlist-count">'+symbols.length+'</span></div>'+groupControlsHtml(key,symbols)+'</div>';
  const cfg=groupSortSettings(key);
  if(cfg.viewMode==="table")renderTableGroup(section,symbols,key);
  else{
    const grid=document.createElement("div");grid.className="watchlist-group-grid";
    const results=new Map(state.lastResults.map(x=>[x.symbol,x]));
    symbols.forEach(symbol=>grid.appendChild(results.get(symbol)?card(results.get(symbol),state.target,state.levels):placeholderCard(symbol)));
    section.appendChild(grid);
  }
  bindGroupControls(section,key,symbols);$("cards").appendChild(section);
}
function renderTableGroup(section,groupSymbols,key){
  const results=new Map(state.lastResults.map(x=>[x.symbol,x])),target=state.target,levels=state.levels;
  const wrap=document.createElement("div");wrap.className="table-wrap";
  const table=document.createElement("table");table.className="watchlist-table";
  table.innerHTML='<thead><tr><th>Update</th><th>Акция</th><th>Price</th><th>Позиция</th><th>'+(key==="owned"?"Допокупка / Продажба":"Покупка")+'</th><th>60d high</th><th>От връха</th><th>Ден</th><th>Обновено</th><th>Finviz</th><th>Data</th><th></th></tr></thead>';
  const tbody=document.createElement("tbody");
  groupSymbols.forEach(symbol=>{
    const x=results.get(symbol),ownedNow=hasPosition(symbol);
    if(x&&x.status&&x.status!=="ok"){
      const row=document.createElement("tr");row.className="table-row error";
      row.innerHTML='<td>'+checkboxHtml(symbol)+'</td><td>'+tickerLink(symbol)+'<span class="table-company">'+escapeHtml(companyName(symbol))+'</span></td><td>—</td><td colspan="7"><b>'+escapeHtml(statusLabel(x.status))+'</b> '+escapeHtml(x.error||"Няма данни.")+'</td><td>'+escapeHtml(providerName(x.source))+'</td><td>'+(ownedNow?'<button type="button" class="sell-btn" data-sell="'+escapeHtml(symbol)+'">Продай</button>':'<button type="button" class="hide-btn" data-hide="'+escapeHtml(symbol)+'">Скрий</button>')+'</td>';
      bindTableRow(row,symbol);tbody.appendChild(row);return;
    }
    if(!x){
      const row=document.createElement("tr");row.className="table-row";
      row.innerHTML='<td>'+checkboxHtml(symbol)+'</td><td>'+tickerLink(symbol)+'<span class="table-company">'+escapeHtml(companyName(symbol))+'</span></td><td colspan="8">Няма заредени данни</td><td>—</td><td>'+(ownedNow?'<button type="button" class="sell-btn" data-sell="'+escapeHtml(symbol)+'">Продай</button>':'<button type="button" class="hide-btn" data-hide="'+escapeHtml(symbol)+'">Скрий</button>')+'</td>';
      bindTableRow(row,symbol);tbody.appendChild(row);return;
    }
    const buy=additionalBuyState(x,levels),entries=positionEntries(symbol),avg=weightedAverageEntry(entries),pnl=avg!==null?(x.price/avg-1)*100:null;
    const posText=entries.length?((pnl>=target?"🔵 EXIT ZONE":"🟡 HOLD / WATCH")+" · P/L "+pnl.toFixed(2)+"%"):"—";
    const buyText=buy.kind==="entry"?"🟢 ENTRY ZONE · -"+buy.level+"%":"⚪ WAIT"+(buy.level!==null?" · следващо -"+buy.level+"%":"");
    const row=document.createElement("tr");row.className="table-row "+(buy.kind==="entry"?"entry":"wait")+(ownedNow?" owned-row":"");
    row.innerHTML='<td>'+checkboxHtml(symbol)+'</td><td>'+tickerLink(symbol)+'<span class="table-company">'+escapeHtml(companyName(symbol))+'</span>'+(ownedNow?'<span class="owned-badge">МОЯ ПОЗИЦИЯ</span>':"")+'</td><td><b>$'+num(x.price)+'</b></td><td>'+escapeHtml(posText)+'</td><td>'+escapeHtml(buyText)+'</td><td>$'+num(x.high60)+'</td><td>'+Number(x.drawdownPct).toFixed(2)+'%</td><td>'+(x.changePct>=0?"+":"")+Number(x.changePct).toFixed(2)+'%</td><td>'+escapeHtml(x.date||"—")+'</td><td>'+escapeHtml(finvizSummary(symbol))+'</td><td>'+escapeHtml(providerName(x.source))+'</td><td>'+(ownedNow?'<button type="button" class="sell-btn" data-sell="'+escapeHtml(symbol)+'">Продай</button>':'<button type="button" class="hide-btn" data-hide="'+escapeHtml(symbol)+'">Скрий</button>')+'</td>';
    bindTableRow(row,symbol);tbody.appendChild(row);
  });
  table.appendChild(tbody);wrap.appendChild(table);section.appendChild(wrap);
  section.querySelectorAll("[data-sell]").forEach(btn=>btn.onclick=()=>sellPosition(btn.dataset.sell));
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
  const backend = (localStorage.getItem("swingBackend") || "").trim().replace(/\/$/,"");
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
      (data.result ? "<p><b>Цена:</b> $" + escapeHtml(num(data.result.price)) + " · <b>Дата:</b> " + escapeHtml(data.result.date) + "</p><p><b>SMA20:</b> " + escapeHtml(data.result.sma20 != null ? "$" + num(data.result.sma20) : "—") + " · <b>SMA50:</b> " + escapeHtml(data.result.sma50 != null ? "$" + num(data.result.sma50) : "—") + " · <b>SMA200:</b> " + escapeHtml(data.result.sma200 != null ? "$" + num(data.result.sma200) : "—") + " · <b>History:</b> " + escapeHtml(String(data.result.historyCount ?? "—")) + "</p>" : "") +
      "<p><b>API calls:</b> " + escapeHtml(String(data.usage?.[provider]?.apiCalls ?? "—")) + "</p>";
  }catch(e){
    logActivity("provider_test", "Network/Backend error", {provider, symbol:"NVDA", error:e.message || "Няма връзка."}, "error");
    result.className = "provider-test-result health-error";
    result.innerHTML = "<b>❌ Network/Backend error</b><p>" + escapeHtml(e.message || "Няма връзка.") + "</p>";
  }
}


function marketNumber(value){
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "—";
}
function marketPct(value){
  return Number.isFinite(Number(value)) ? ((Number(value)>=0?"+":"")+Number(value).toFixed(2)+"%") : "—";
}
function marketInstrumentRegime(m){
  if(!m || !Number.isFinite(Number(m.price)) || !Number.isFinite(Number(m.sma50)) || !Number.isFinite(Number(m.return60))){
    return {kind:"unknown",label:"INSUFFICIENT DATA"};
  }
  const bullCore=Number(m.price)>Number(m.sma50) && Number(m.return60)>=0;
  const bearCore=Number(m.price)<Number(m.sma50) && Number(m.return60)<0;
  const has200=Number.isFinite(Number(m.sma200));
  if(has200){
    if(bullCore && Number(m.price)>Number(m.sma200)) return {kind:"bull",label:"BULLISH"};
    if(bearCore && Number(m.price)<Number(m.sma200)) return {kind:"bear",label:"BEARISH"};
  }else{
    if(bullCore) return {kind:"bull",label:"BULLISH"};
    if(bearCore) return {kind:"bear",label:"BEARISH"};
  }
  return {kind:"neutral",label:"TRANSITION"};
}
function calculateMarketRegime(markets){
  const spy=markets?.find(x=>x.symbol==="SPY");
  const qqq=markets?.find(x=>x.symbol==="QQQ");
  if(!spy || !qqq){
    return {kind:"unknown",label:"NO DATA",summary:"Не са налични данни и за SPY, и за QQQ.",quality:"insufficient",markets:markets||[]};
  }
  const sr=marketInstrumentRegime(spy);
  const qr=marketInstrumentRegime(qqq);
  let kind="neutral";
  let label="🟡 NEUTRAL / TRANSITION";
  if(sr.kind==="bull" && qr.kind==="bull"){ kind="risk-on"; label="🟢 RISK-ON"; }
  else if(sr.kind==="bear" && qr.kind==="bear"){ kind="risk-off"; label="🔴 RISK-OFF"; }
  const quality=Number.isFinite(Number(spy.sma200)) && Number.isFinite(Number(qqq.sma200)) ? "complete" : "partial";
  const summary=kind==="risk-on" ? "SPY и QQQ са в еднакъв положителен режим."
    : kind==="risk-off" ? "SPY и QQQ са в еднакъв отрицателен режим."
    : "SPY и QQQ не дават еднакъв режим или са в преход.";
  return {kind,label,summary,quality,markets:[{...spy,regime:sr.kind},{...qqq,regime:qr.kind}],updatedAt:new Date().toISOString()};
}
function marketRegimeClass(kind){
  if(kind==="risk-on") return "market-risk-on";
  if(kind==="risk-off") return "market-risk-off";
  if(kind==="unknown") return "market-unknown";
  return "market-neutral";
}
function renderMarketRegime(){
  const el=$("marketRegime");
  if(!el) return;
  const m=state.marketRegime;
  if(!m || !Array.isArray(m.markets) || !m.markets.length){
    el.innerHTML='<div class="market-empty">Няма заредени пазарни данни. Натисни <b>Update Market</b>.</div>';
    return;
  }
  const cards=m.markets.map(x=>{
    const r=marketInstrumentRegime(x);
    return '<article class="market-card '+(r.kind==="bull"?"market-bull":r.kind==="bear"?"market-bear":"market-neutral-card")+'">'+
      '<div class="market-card-top"><b>'+escapeHtml(x.symbol)+'</b><span>'+escapeHtml(r.label)+'</span></div>'+
      '<div class="market-price">$'+marketNumber(x.price)+'</div>'+
      '<div class="market-metrics">'+
        '<span>20d <b>'+marketPct(x.return20)+'</b></span>'+
        '<span>60d <b>'+marketPct(x.return60)+'</b></span>'+
        '<span>vs SMA20 <b>'+(Number.isFinite(Number(x.sma20))?(Number(x.price)>=Number(x.sma20)?"Above":"Below"):"—")+'</b></span>'+
        '<span>vs SMA50 <b>'+(Number.isFinite(Number(x.sma50))?(Number(x.price)>=Number(x.sma50)?"Above":"Below"):"—")+'</b></span>'+
        '<span>vs SMA200 <b>'+(Number.isFinite(Number(x.sma200))?(Number(x.price)>=Number(x.sma200)?"Above":"Below"):"—")+'</b></span>'+
        '<span>Drawdown <b>'+marketPct(x.drawdownPct)+'</b></span>'+
      '</div>'+
    '</article>';
  }).join("");
  const quality=m.quality==="complete" ? "200d confirmation: available" : "200d confirmation: limited";
  el.innerHTML='<div class="market-regime-summary '+marketRegimeClass(m.kind)+'">'+
    '<div><span class="market-regime-badge">'+escapeHtml(m.label||"—")+'</span><span class="market-quality">'+escapeHtml(quality)+'</span></div>'+
    '<div class="market-summary-text">'+escapeHtml(m.summary||"")+'</div>'+
    '</div>'+
    '<div class="market-grid">'+cards+'</div>'+
    '<div class="market-rule-note"><b>Логика v1:</b> RISK-ON = и SPY, и QQQ са над SMA50, с положителен 60d return и при наличен SMA200 са над него. RISK-OFF = огледното отрицателно условие. Всичко останало е NEUTRAL / TRANSITION. Това не отменя анализа на отделната акция.</div>'+
    '<div class="market-updated">Updated: '+escapeHtml(m.updatedAt ? new Date(m.updatedAt).toLocaleString() : "—")+'</div>';
}
async function updateMarket(){
  const el=$("marketRegime");
  const backend=(localStorage.getItem("swingBackend")||"").trim().replace(/\/$/,"");
  if(!backend){
    if(el) el.innerHTML='<div class="market-empty market-error"><b>Няма Backend URL.</b> Задай го в Settings.</div>';
    return;
  }
  if(el) el.innerHTML='<div class="market-empty loading">Зареждам SPY и QQQ пазарния контекст…</div>';
  try{
    const providers=enabledProviders();
    if(!providers.length) throw new Error("Няма включен data provider.");
    const url=backend+"/api/market?providers="+encodeURIComponent(providers.join(","));
    logActivity("market","Market query started",{url,providers,symbols:["SPY","QQQ"]});
    const response=await fetch(url,{cache:"no-store"});
    const data=await response.json();
    if(!response.ok) throw new Error(data?.error||("HTTP "+response.status));
    if(!Array.isArray(data.results)) throw new Error("Невалиден отговор от market endpoint.");
    updateUsagePanel(data.usage);
    const failed=data.results.filter(x=>x.status&&x.status!=="ok");
    state.marketRegime=failed.length
      ? {kind:"unknown",label:"NO DATA",summary:"Неуспешно зареждане на: "+failed.map(x=>x.symbol).join(", "),quality:"insufficient",markets:data.results,updatedAt:new Date().toISOString()}
      : calculateMarketRegime(data.results);
    save();
    renderMarketRegime();
    logActivity("market","Market result received",{providers,data},"info");
  }catch(e){
    logActivity("error","Market update failed",{error:e.message||"Unknown error"},"error");
    if(el) el.innerHTML='<div class="market-empty market-error"><b>❌ Market update failed</b><p>'+escapeHtml(e.message||"Няма връзка.")+'</p></div>';
  }
}

async function updateSelected(){
  const cards = $("cards");
  const backend = (localStorage.getItem("swingBackend") || "").trim().replace(/\/$/,"");
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

  const target = state.target;
  const levels = state.levels.slice();

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
  const backend = (localStorage.getItem("swingBackend") || "").trim().replace(/\/$/,"");

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

function riskAnalysis(x,target,levels){
  const risk=state.risk||{};
  const capital=Number(risk.portfolioCapital)||0;
  const riskPct=Number(risk.riskPerTradePct)||1;
  const stopPct=Number(risk.stopLossPct)||7;
  const entries=positionEntries(x.symbol);
  const owned=entries.length>0;
  const avg=owned?weightedAverageEntry(entries):null;
  const buy=additionalBuyState(x,levels);
  let entry=null,type="none";
  if(owned){entry=avg;type="position";}
  else if(buy.level!==null&&Number.isFinite(Number(x.high60))){entry=Number(x.high60)*(1-buy.level/100);type="setup";}
  if(!Number.isFinite(entry)||entry<=0)return {available:false,reason:"Няма позиция или активно drawdown ниво за изчисление."};
  const stop=entry*(1-stopPct/100);
  const riskPerShare=entry-stop;
  const targetPrice=entry*(1+target/100);
  const rewardPerShare=targetPrice-entry;
  const rr=riskPerShare>0?rewardPerShare/riskPerShare:null;
  const maxRisk=capital>0?capital*riskPct/100:null;
  const size=maxRisk!==null&&riskPerShare>0?Math.floor((maxRisk/riskPerShare)*10000)/10000:null;
  const positionValue=size!==null?size*entry:null;
  const totalQty=owned?entries.reduce((sum,e)=>sum+Number(e.quantity||0),0):0;
  const currentRiskToStop=owned?Math.max(0,(Number(x.price)-stop)*totalQty):null;
  const budgetUse=owned&&maxRisk&&maxRisk>0?currentRiskToStop/maxRisk*100:null;
  return {available:true,type,entry,stop,riskPerShare,targetPrice,rewardPerShare,rr,maxRisk,size,positionValue,totalQty,currentRiskToStop,budgetUse,stopPct,riskPct,capital};
}

function stockTrend(x){
  const price=Number(x?.price),s20=Number(x?.sma20),s50=Number(x?.sma50),s200=Number(x?.sma200);
  if(!Number.isFinite(price))return {kind:"unknown",label:"UNKNOWN",reason:"Няма текуща цена."};
  if(Number.isFinite(s20)&&Number.isFinite(s50)&&Number.isFinite(s200)){
    if(price>s20&&price>s50&&price>s200&&s50>s200)return {kind:"bull",label:"UPTREND",reason:"Цена над SMA20, SMA50 и SMA200; SMA50 е над SMA200."};
    if(price<s20&&price<s50&&price<s200&&s50<s200)return {kind:"bear",label:"DOWNTREND",reason:"Цена под SMA20, SMA50 и SMA200; SMA50 е под SMA200."};
    return {kind:"neutral",label:"TRANSITION",reason:"Цената и средните са в смесена конфигурация."};
  }
  if(Number.isFinite(s20)&&Number.isFinite(s50)){
    if(price>s20&&price>s50)return {kind:"bull",label:"BULLISH",reason:"Цена над SMA20 и SMA50; SMA200 не е налична от този data source."};
    if(price<s20&&price<s50)return {kind:"bear",label:"BEARISH",reason:"Цена под SMA20 и SMA50; SMA200 не е налична от този data source."};
  }
  return {kind:"neutral",label:"INCOMPLETE",reason:"Недостатъчно SMA данни за пълен trend прочит."};
}
function stockAction(x,target,levels){
  const buy=additionalBuyState(x,levels);
  const trend=stockTrend(x);
  const market=state.marketRegime?.kind||"unknown";
  const entries=positionEntries(x.symbol);
  if(entries.length){
    const avg=weightedAverageEntry(entries),pnl=avg!==null?(Number(x.price)/avg-1)*100:null;
    if(Number.isFinite(pnl)&&pnl>=target)return {kind:"exit",label:"REVIEW EXIT",reason:"Постигната е зададената цел +"+target+"%. Провери trend, market regime и риска."};
    if(market==="risk-off"&&trend.kind==="bear")return {kind:"risk",label:"REVIEW RISK",reason:"Позицията е в Risk-Off пазар и технически слаб trend. Следи риска, не само P/L."};
    return {kind:"hold",label:"HOLD / MANAGE",reason:"Позицията остава под целта. Управлявай според trend, market regime и риска."};
  }
  if(market==="unknown")return {kind:"info",label:"UPDATE MARKET",reason:"Преди действие зареди Market Regime за SPY/QQQ."};
  if(buy.kind==="entry"){
    if(market==="risk-on"&&trend.kind==="bull")return {kind:"entry",label:"ENTRY REVIEW",reason:"Достигнато е drawdown ниво при Risk-On и bullish trend. Това е setup за преглед, не автоматична покупка."};
    if(market==="risk-off")return {kind:"wait",label:"WAIT / REVIEW",reason:"Достигнато е drawdown ниво, но пазарът е Risk-Off. Изчакай потвърждение и прецени риска."};
    return {kind:"watch",label:"WATCH / REVIEW",reason:"Има ENTRY ZONE, но market/trend не са едновременно потвърдени."};
  }
  if(buy.level!==null)return {kind:"watch",label:"WATCH",reason:"Следващото зададено drawdown ниво е -"+buy.level+"%."};
  return {kind:"wait",label:"WAIT",reason:"Няма активно drawdown ниво за допокупка."};
}

function riskAnalysisHtml(risk){
  if(!risk?.available){
    return '<div class="analysis-block risk-analysis"><div class="analysis-label">Риск анализ</div><div class="analysis-text">'+escapeHtml(risk?.reason||"Няма активен setup или позиция за risk analysis.")+'</div></div>';
  }
  const budget=risk.maxRisk!==null?"$"+num(risk.maxRisk):"Задай капитал";
  const current=risk.currentRiskToStop!==null?'<span>Risk to stop <b>$'+num(risk.currentRiskToStop)+'</b></span>':"";
  const size=risk.size!==null?String(risk.size):"—";
  const value=risk.positionValue!==null?"$"+num(risk.positionValue):"—";
  const rr=Number.isFinite(risk.rr)?risk.rr.toFixed(2):"—";
  const note=risk.maxRisk===null
    ? 'Въведи Portfolio Capital в Settings, за да се изчисли размерът на позицията.'
    : 'Stop е '+risk.stopPct+'% под входа; Risk budget е '+risk.riskPct+'% от капитала. Това е аналитичен модел, не автоматичен stop order.';
  return '<div class="analysis-block risk-analysis"><div class="analysis-label">Риск анализ</div><div class="risk-grid">'+
    '<span>Entry <b>$'+num(risk.entry)+'</b></span>'+
    '<span>Stop <b>$'+num(risk.stop)+'</b></span>'+
    '<span>Risk/share <b>$'+num(risk.riskPerShare)+'</b></span>'+
    '<span>Target <b>$'+num(risk.targetPrice)+'</b></span>'+
    '<span>R/R <b>'+rr+'</b></span>'+
    '<span>Risk budget <b>'+budget+'</b></span>'+
    '<span>Position size <b>'+size+'</b></span>'+
    '<span>Position value <b>'+value+'</b></span>'+
    current+
    '</div><div class="analysis-text">'+escapeHtml(note)+'</div></div>';
}

function card(x,target,levels){
  if (x.status && x.status !== "ok") return statusCard(x);
  const entries=positionEntries(x.symbol),selected=state.selectedSymbols.includes(x.symbol);
  const buy=additionalBuyState(x,levels),sortedLevels=levels.slice().sort((a,b)=>a-b);
  let cls="wait";
  if(buy.kind==="entry") cls="entry";
  else if(sortedLevels.length&&buy.level!==null&&Number(x.drawdownPct)>-buy.level&&Number(x.drawdownPct)<=-(buy.level-1)) cls="watch";
  const owned=entries.length>0,avgEntry=owned?weightedAverageEntry(entries):null;
  const totalQuantity=owned?entries.reduce((sum,e)=>sum+Number(e.quantity||0),0):0;
  const pnl=owned?(x.price/avgEntry-1)*100:null,pnlMoney=owned?(x.price-avgEntry)*totalQuantity:null;
  const positionSignal=owned?(pnl>=target?"🔵 EXIT ZONE":"🟡 HOLD / WATCH"):"";
  const positionReason=owned?("Позицията е на "+pnl.toFixed(2)+"% спрямо средната претеглена входна цена. Целта е +"+target+"%."):"";
  const pnlClass=owned?(pnlMoney>0?"profit":pnlMoney<0?"loss":"neutral"):"";
  const pnlIcon=owned?(pnlMoney>0?"↑":pnlMoney<0?"↓":"→"):"";
  const pnlMoneyText=owned?((pnlMoney>=0?"+":"-")+"$"+Math.abs(pnlMoney).toFixed(2)):"";
  let buySignal="⚪ WAIT",buyReason=buy.level!==null?"Следващо/активно ниво за допокупка: -"+buy.level+"%.":"Няма активно ниво за допокупка.";
  if(buy.kind==="entry"){buySignal="🟢 ENTRY ZONE";buyReason="Достигнато ниво за допокупка: -"+buy.level+"% спрямо 60-дневния връх.";}
  const buySectionTitle=owned?"Допокупка / Продажба":"Покупка";
  const finviz=finvizSummary(x.symbol),trend=stockTrend(x),action=stockAction(x,target,levels),risk=riskAnalysis(x,target,levels);
  const div=document.createElement("article");
  div.className="card "+cls+(selected?" selected":"")+(owned?" owned-card":"");
  div.dataset.symbolCard=x.symbol;
  div.innerHTML=
    '<div class="top"><label class="selection"><input type="checkbox" data-select="'+escapeHtml(x.symbol)+'"'+(selected?" checked":"")+'> Заявка при Update</label>'+(owned?'<div class="owned-position-card"><span class="owned-badge">МОЯ ПОЗИЦИЯ</span><span class="owned-pnl '+pnlClass+'"><span class="owned-pnl-icon">'+pnlIcon+'</span> '+pnlMoneyText+'</span></div>':'')+'</div>'+
    '<div class="symbol">'+tickerLink(x.symbol)+' <span class="company-name">'+escapeHtml(companyName(x.symbol))+'</span></div>'+
    '<div class="price">$'+num(x.price)+'</div>'+
    '<div class="analysis-block action-analysis action-'+escapeHtml(action.kind)+'"><div class="analysis-label">Действие</div><b>'+escapeHtml(action.label)+'</b><div class="analysis-text">'+escapeHtml(action.reason)+'</div></div>'+
    (owned?'<div class="analysis-block position-analysis"><div class="analysis-label">Позиция</div><b>'+positionSignal+'</b><div class="analysis-text">'+escapeHtml(positionReason)+'</div></div>':'')+
    '<div class="analysis-block buy-analysis"><div class="analysis-label">'+escapeHtml(buySectionTitle)+'</div><b>'+buySignal+'</b><div class="analysis-text">'+escapeHtml(buyReason)+'</div></div>'+
    riskAnalysisHtml(risk)+
    '<div class="analysis-block technical-analysis"><div class="analysis-label">Технически тренд</div><b>'+escapeHtml(trend.label)+'</b><div class="analysis-text">'+escapeHtml(trend.reason)+'</div></div>'+
    '<div class="metrics">'+
      '<div class="metric">SMA20<b>'+(Number.isFinite(Number(x.sma20))?"$"+num(x.sma20):"—")+'</b></div>'+
      '<div class="metric">SMA50<b>'+(Number.isFinite(Number(x.sma50))?"$"+num(x.sma50):"—")+'</b></div>'+
      '<div class="metric">SMA200<b>'+(Number.isFinite(Number(x.sma200))?"$"+num(x.sma200):"—")+'</b></div>'+
      '<div class="metric">60d high<b>$'+num(x.high60)+'</b></div>'+
      '<div class="metric">От връха<b>'+Number(x.drawdownPct).toFixed(2)+'%</b></div>'+
      '<div class="metric">Ден<b>'+(x.changePct>=0?"+":"")+Number(x.changePct).toFixed(2)+'%</b></div>'+
      '<div class="metric">Обновено<b>'+escapeHtml(x.date||"—")+'</b></div>'+
      '<div class="metric">Market<b>'+escapeHtml(state.marketRegime?.label||"—")+'</b></div>'+
    '</div>'+
    (owned?'<div class="position">Покупки: <b>'+entries.length+'</b> · Общо акции: <b>'+totalQuantity+'</b> · Средна претеглена входна цена: <b>(buy.level!==null&&Number.isFinite(Number(x.high60))?'<div class="position">Предполагаем вход: <b>$'+num(x.high60*(1-buy.level/100))+'</b> · ниво -'+buy.level+'%</div>':''))+
    '<div class="profile-status">'+escapeHtml(finviz)+'</div><div class="data-source">Data: '+escapeHtml(providerName(x.source))+'</div>'+
    (owned?'<button type="button" class="sell-btn" data-sell="'+escapeHtml(x.symbol)+'">Продай позицията</button>':'<button type="button" class="hide-btn" data-hide="'+escapeHtml(x.symbol)+'">Скрий</button>');
  div.querySelector("[data-select]").onchange=e=>setSelected(x.symbol,e.target.checked);
  const sell=div.querySelector("[data-sell]"),hide=div.querySelector("[data-hide]");
  if(sell)sell.onclick=()=>sellPosition(x.symbol);
  if(hide)hide.onclick=()=>hideStock(x.symbol);
  return div;
}

function positionEntries(symbol){
  const raw=state.positions[symbol];
  if(!Array.isArray(raw)) return [];
  return raw.map(v=>{
    if(typeof v==="number"&&Number.isFinite(v)&&v>0)return {price:v,quantity:1};
    const price=Number(v?.price),quantity=Number(v?.quantity);
    return Number.isFinite(price)&&price>0&&Number.isFinite(quantity)&&quantity>0?{price,quantity}:null;
  }).filter(Boolean);
}
function weightedAverageEntry(entries){
  if(!entries?.length)return null;
  const totalQty=entries.reduce((sum,e)=>sum+Number(e.quantity||0),0);
  if(!totalQty)return null;
  return entries.reduce((sum,e)=>sum+Number(e.price)*Number(e.quantity),0)/totalQty;
}
function statusCard(x){
  const selected = state.selectedSymbols.includes(x.symbol);
  const owned = hasPosition(x.symbol);
  const labels = {
    rate_limited: "⚠️ API LIMIT",
    no_data: "⚠️ NO DATA",
    invalid_symbol: "❌ INVALID SYMBOL",
    insufficient_history: "⚠️ INSUFFICIENT HISTORY",
    error: "⚠️ DATA ERROR",
    provider_unavailable: "⚠️ PROVIDER UNAVAILABLE"
  };
  const div=document.createElement("article");
  div.className="card error" + (selected ? " selected" : "") + (owned ? " owned-card" : "");
  div.dataset.symbolCard = x.symbol;
  div.innerHTML =
    '<div class="top">' +
      '<label class="selection"><input type="checkbox" data-select="' + escapeHtml(x.symbol) + '"' + (selected ? " checked" : "") + '> Заявка при Update</label>' +
      '<div class="owned-badge">' + (owned ? "МОЯ ПОЗИЦИЯ" : "") + '</div>' +
    '</div>' +
    '<div class="symbol">' + escapeHtml(x.symbol) + ' <span class="company-name">' + escapeHtml(companyName(x.symbol)) + '</span></div>' +
    '<div class="signal">' + (labels[x.status] || "⚠️ DATA ERROR") + '</div>' +
    '<div class="reason">' + escapeHtml(x.error || "Няма данни.") + '</div>' +
    (Array.isArray(x.attempts) ? '<div class="provider-attempts">' + x.attempts.map(a => '<div><b>' + escapeHtml(providerName(a.provider)) + ':</b> ' + escapeHtml(a.status) + (a.message ? ' — ' + escapeHtml(a.message) : '') + '</div>').join('') + '</div>' : '') +
    '<div class="data-source">Data: ' + escapeHtml(providerName(x.source)) + '</div>' +
    (owned ? '<button type="button" class="sell-btn" data-sell="' + escapeHtml(x.symbol) + '">Продай позицията</button>' :
      '<button type="button" class="hide-btn" data-hide="' + escapeHtml(x.symbol) + '">Скрий</button>');
  div.querySelector("[data-select]").onchange = e => setSelected(x.symbol,e.target.checked);
  const sell=div.querySelector("[data-sell]");
  const hide=div.querySelector("[data-hide]");
  if(sell) sell.onclick=()=>sellPosition(x.symbol);
  if(hide) hide.onclick=()=>hideStock(x.symbol);
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

renderMarketRegime();
renderCards();
+num(avgEntry)+'</b> · Печалба/загуба: <b>'+pnl.toFixed(2)+'%</b></div>':(buy.level!==null&&Number.isFinite(Number(x.high60))?'<div class="position">Предполагаем вход: <b>$'+num(x.high60*(1-buy.level/100))+'</b> · ниво -'+buy.level+'%</div>':''))+
    '<div class="profile-status">'+escapeHtml(finviz)+'</div><div class="data-source">Data: '+escapeHtml(providerName(x.source))+'</div>'+
    (owned?'<button type="button" class="sell-btn" data-sell="'+escapeHtml(x.symbol)+'">Продай позицията</button>':'<button type="button" class="hide-btn" data-hide="'+escapeHtml(x.symbol)+'">Скрий</button>');
  div.querySelector("[data-select]").onchange=e=>setSelected(x.symbol,e.target.checked);
  const sell=div.querySelector("[data-sell]"),hide=div.querySelector("[data-hide]");
  if(sell)sell.onclick=()=>sellPosition(x.symbol);
  if(hide)hide.onclick=()=>hideStock(x.symbol);
  return div;
}

function positionEntries(symbol){
  const raw=state.positions[symbol];
  if(!Array.isArray(raw)) return [];
  return raw.map(v=>{
    if(typeof v==="number"&&Number.isFinite(v)&&v>0)return {price:v,quantity:1};
    const price=Number(v?.price),quantity=Number(v?.quantity);
    return Number.isFinite(price)&&price>0&&Number.isFinite(quantity)&&quantity>0?{price,quantity}:null;
  }).filter(Boolean);
}
function weightedAverageEntry(entries){
  if(!entries?.length)return null;
  const totalQty=entries.reduce((sum,e)=>sum+Number(e.quantity||0),0);
  if(!totalQty)return null;
  return entries.reduce((sum,e)=>sum+Number(e.price)*Number(e.quantity),0)/totalQty;
}
function statusCard(x){
  const selected = state.selectedSymbols.includes(x.symbol);
  const owned = hasPosition(x.symbol);
  const labels = {
    rate_limited: "⚠️ API LIMIT",
    no_data: "⚠️ NO DATA",
    invalid_symbol: "❌ INVALID SYMBOL",
    insufficient_history: "⚠️ INSUFFICIENT HISTORY",
    error: "⚠️ DATA ERROR",
    provider_unavailable: "⚠️ PROVIDER UNAVAILABLE"
  };
  const div=document.createElement("article");
  div.className="card error" + (selected ? " selected" : "") + (owned ? " owned-card" : "");
  div.dataset.symbolCard = x.symbol;
  div.innerHTML =
    '<div class="top">' +
      '<label class="selection"><input type="checkbox" data-select="' + escapeHtml(x.symbol) + '"' + (selected ? " checked" : "") + '> Заявка при Update</label>' +
      '<div class="owned-badge">' + (owned ? "МОЯ ПОЗИЦИЯ" : "") + '</div>' +
    '</div>' +
    '<div class="symbol">' + escapeHtml(x.symbol) + ' <span class="company-name">' + escapeHtml(companyName(x.symbol)) + '</span></div>' +
    '<div class="signal">' + (labels[x.status] || "⚠️ DATA ERROR") + '</div>' +
    '<div class="reason">' + escapeHtml(x.error || "Няма данни.") + '</div>' +
    (Array.isArray(x.attempts) ? '<div class="provider-attempts">' + x.attempts.map(a => '<div><b>' + escapeHtml(providerName(a.provider)) + ':</b> ' + escapeHtml(a.status) + (a.message ? ' — ' + escapeHtml(a.message) : '') + '</div>').join('') + '</div>' : '') +
    '<div class="data-source">Data: ' + escapeHtml(providerName(x.source)) + '</div>' +
    (owned ? '<button type="button" class="sell-btn" data-sell="' + escapeHtml(x.symbol) + '">Продай позицията</button>' :
      '<button type="button" class="hide-btn" data-hide="' + escapeHtml(x.symbol) + '">Скрий</button>');
  div.querySelector("[data-select]").onchange = e => setSelected(x.symbol,e.target.checked);
  const sell=div.querySelector("[data-sell]");
  const hide=div.querySelector("[data-hide]");
  if(sell) sell.onclick=()=>sellPosition(x.symbol);
  if(hide) hide.onclick=()=>hideStock(x.symbol);
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

renderMarketRegime();
renderCards();
