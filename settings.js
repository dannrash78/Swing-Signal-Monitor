const DEFAULT_PROVIDERS = {
  alphavantage: { enabled:true, priority:1, name:"Alpha Vantage" },
  twelvedata: { enabled:true, priority:2, name:"Twelve Data" },
  finnhub: { enabled:false, priority:3, name:"Finnhub" }
};

function $(id){ return document.getElementById(id); }

function readState(){
  return JSON.parse(localStorage.getItem("swingState") || "null") || {};
}

function showMessage(id,text){
  const el=$(id);
  if(!el)return;
  el.hidden=false;
  el.textContent="✓ "+text;
  setTimeout(()=>{el.hidden=true;},2500);
}

function loadSettings(){
  const state=readState();
  state.providers=state.providers||{};
  Object.keys(DEFAULT_PROVIDERS).forEach(p=>{
    state.providers[p]={...DEFAULT_PROVIDERS[p],...(state.providers[p]||{})};
    $("provider-"+p+"-enabled").checked=!!state.providers[p].enabled;
    $("provider-"+p+"-priority").value=String(state.providers[p].priority);
  });
  $("backendUrl").value=localStorage.getItem("swingBackend")||"";
  $("targetPct").value=String(Number.isFinite(Number(state.target))?state.target:10);
  $("levels").value=Array.isArray(state.levels)&&state.levels.length?state.levels.join(","):"5,8,10";
}

function saveBackend(){
  const backend=$("backendUrl").value.trim().replace(/\/$/,"");
  localStorage.setItem("swingBackend",backend);
  showMessage("backendMessage","Backend URL е запазен.");
}

function saveStrategy(){
  const state=readState();
  const target=Number($("targetPct").value);
  const levels=$("levels").value.split(",").map(Number).filter(x=>Number.isFinite(x)&&x>0);
  state.target=Number.isFinite(target)&&target>0?target:10;
  state.levels=levels.length?levels:[5,8,10];
  localStorage.setItem("swingState",JSON.stringify(state));
  showMessage("strategyMessage","Стратегията е запазена.");
}

function saveProviders(){
  const state=readState();
  state.providers=state.providers||{};
  Object.keys(DEFAULT_PROVIDERS).forEach(p=>{
    state.providers[p]={...DEFAULT_PROVIDERS[p],...(state.providers[p]||{}),
      enabled:$("provider-"+p+"-enabled").checked,
      priority:Number($("provider-"+p+"-priority").value)||DEFAULT_PROVIDERS[p].priority};
  });
  localStorage.setItem("swingState",JSON.stringify(state));
  showMessage("providersMessage","Data Sources са запазени.");
}

$("saveBackend").onclick=saveBackend;
$("saveStrategy").onclick=saveStrategy;
$("saveProviders").onclick=saveProviders;
$("backBtn").onclick=()=>{window.location.href="index.html";};

document.querySelectorAll(".copy-secret").forEach(btn=>{
  btn.onclick=async()=>{
    try{
      await navigator.clipboard.writeText(btn.dataset.copy);
      const old=btn.textContent;
      btn.textContent="Копирано";
      setTimeout(()=>btn.textContent=old,1200);
    }catch(e){}
  };
});

loadSettings();
