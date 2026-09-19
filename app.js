const DEFAULTS = {
  symbols: ["NVDA","AMD","MU","AVGO","TSLA","AAPL","AMZN","META","MSFT","GOOGL"],
  target: 10,
  levels: [5,8,10],
  backend: localStorage.getItem("swingBackend") || ""
};

let state = JSON.parse(localStorage.getItem("swingState") || "null") || {
  symbols: DEFAULTS.symbols,
  positions: {}
};

const $ = id => document.getElementById(id);
$("backendUrl").value = DEFAULTS.backend;
$("targetPct").value = DEFAULTS.target;
$("levels").value = DEFAULTS.levels.join(",");

$("saveSettings").onclick = () => {
  localStorage.setItem("swingBackend", $("backendUrl").value.trim().replace(/\/$/,""));
  render();
};
$("refreshBtn").onclick = render;

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
  if ($("holding").checked && Number($("entryPrice").value) > 0) state.positions[s] = Number($("entryPrice").value);
  else delete state.positions[s];
  save();
  $("stockDialog").close();
  render();
};

function save(){ localStorage.setItem("swingState", JSON.stringify(state)); }

function removeStock(s){
  state.symbols = state.symbols.filter(x=>x!==s);
  delete state.positions[s];
  save();
  render();
}

async function render(){
  const cards = $("cards");
  cards.innerHTML = '<div class="card loading">Зареждам данните…</div>';

  const backend = $("backendUrl").value.trim().replace(/\/$/,"");
  if(!backend){
    cards.innerHTML = '<div class="card"><b>Въведи Backend URL.</b><p>Постави адреса на Cloudflare Worker.</p></div>';
    return;
  }

  const target = Number($("targetPct").value) || 10;
  const levels = $("levels").value.split(",").map(Number).filter(x=>x>0);

  try{
    const url = backend + "/api/scan?symbols=" + encodeURIComponent(state.symbols.join(","));
    const r = await fetch(url, {cache:"no-store"});
    let data = null;
    try { data = await r.json(); } catch {}

    if(!r.ok) throw new Error(data?.error || ("HTTP " + r.status));
    if(!data || !Array.isArray(data.results)) throw new Error("Невалиден отговор от backend.");

    cards.innerHTML = "";

    if (data.rateLimited) {
      const notice = document.createElement("div");
      notice.className = "card error";
      notice.innerHTML = '<b>⚠️ Alpha Vantage API лимит</b><p>Останалите заявки са спрени, за да не изчерпваме допълнително дневния лимит.</p><p>Кешираните данни продължават да се използват.</p>';
      cards.appendChild(notice);
    }

    data.results.forEach(x => cards.appendChild(card(x, target, levels)));
  }catch(e){
    cards.innerHTML = '<div class="card error"><b>Backend error</b><p>' + escapeHtml(e.message) + '</p><p>Провери Backend URL и Cloudflare Worker.</p></div>';
  }
}

function card(x,target,levels){
  const entry = state.positions[x.symbol];
  if (x.status && x.status !== "ok") return statusCard(x);

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
  div.className="card " + cls;
  div.innerHTML =
    '<div class="top"><span class="symbol">' + escapeHtml(x.symbol) + '</span><button class="remove" data-remove="' + escapeHtml(x.symbol) + '">×</button></div>' +
    '<div class="price">$' + num(x.price) + '</div>' +
    '<div class="signal">' + signal + '</div>' +
    '<div class="metrics">' +
      '<div class="metric">60d high<b>$' + num(x.high60) + '</b></div>' +
      '<div class="metric">От връха<b>' + dd.toFixed(2) + '%</b></div>' +
      '<div class="metric">Ден<b>' + (x.changePct>=0?"+":"") + x.changePct.toFixed(2) + '%</b></div>' +
      '<div class="metric">Обновено<b>' + escapeHtml(x.date || "—") + '</b></div>' +
    '</div>' +
    (entry ? '<div class="position">Вход: <b>$' + num(entry) + '</b> · P/L: <b>' + ((x.price/entry-1)*100).toFixed(2) + '%</b></div>' : '') +
    '<div class="reason">' + escapeHtml(reason) + '</div>';

  div.querySelector("[data-remove]").onclick=()=>removeStock(x.symbol);
  return div;
}

function statusCard(x){
  const labels = {
    rate_limited: "⚠️ API LIMIT",
    no_data: "⚠️ NO DATA",
    invalid_symbol: "❌ INVALID SYMBOL",
    insufficient_history: "⚠️ INSUFFICIENT HISTORY",
    error: "⚠️ DATA ERROR"
  };
  const div=document.createElement("article");
  div.className="card error";
  div.innerHTML =
    '<div class="top"><span class="symbol">' + escapeHtml(x.symbol) + '</span><button class="remove" data-remove="' + escapeHtml(x.symbol) + '">×</button></div>' +
    '<div class="signal">' + (labels[x.status] || "⚠️ DATA ERROR") + '</div>' +
    '<div class="reason">' + escapeHtml(x.error || "Няма данни.") + '</div>';
  div.querySelector("[data-remove]").onclick=()=>removeStock(x.symbol);
  return div;
}

const num=x=>Number(x).toFixed(2);
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}
render();
