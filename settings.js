const DEFAULT_PROVIDERS = {
  alphavantage: { enabled:true, priority:1, name:"Alpha Vantage", secretName:"ALPHA_VANTAGE_KEY" },
  twelvedata: { enabled:true, priority:2, name:"Twelve Data", secretName:"TWELVE_DATA_API_KEY" },
  finnhub: { enabled:false, priority:3, name:"Finnhub", secretName:"FINNHUB_API_KEY" }
};

function $(id){ return document.getElementById(id); }
function readState(){ return JSON.parse(localStorage.getItem("swingState") || "null") || {}; }

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
  state.secretNames=state.secretNames||{};

  Object.keys(DEFAULT_PROVIDERS).forEach(p=>{
    state.providers[p]={...DEFAULT_PROVIDERS[p],...(state.providers[p]||{})};
    const secretName=state.secretNames[p] || state.providers[p].secretName || DEFAULT_PROVIDERS[p].secretName;
    $("provider-"+p+"-enabled").checked=!!state.providers[p].enabled;
    $("provider-"+p+"-priority").value=String(state.providers[p].priority);
    $("provider-"+p+"-secret").value=secretName;
  });

  $("backendUrl").value=localStorage.getItem("swingBackend")||"";
  $("targetPct").value=String(Number.isFinite(Number(state.target))?state.target:10);
  $("levels").value=Array.isArray(state.levels)&&state.levels.length?state.levels.join(","):"5,8,10";
  const risk=state.risk||{};
  $("portfolioCapital").value=String(Number.isFinite(Number(risk.portfolioCapital))?risk.portfolioCapital:0);
  $("riskPerTradePct").value=String(Number.isFinite(Number(risk.riskPerTradePct))?risk.riskPerTradePct:1);
  $("stopLossPct").value=String(Number.isFinite(Number(risk.stopLossPct))?risk.stopLossPct:7);
}

function validSecretName(name){
  return /^[A-Z][A-Z0-9_]{0,62}$/.test(name);
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

function saveRisk(){
  const state=readState();
  const portfolio=Number($("portfolioCapital").value);
  const riskPct=Number($("riskPerTradePct").value);
  const stopPct=Number($("stopLossPct").value);
  state.risk={
    portfolioCapital:Number.isFinite(portfolio)&&portfolio>=0?portfolio:0,
    riskPerTradePct:Number.isFinite(riskPct)&&riskPct>=0.1?Math.min(10,riskPct):1,
    stopLossPct:Number.isFinite(stopPct)&&stopPct>=0.5?Math.min(50,stopPct):7
  };
  localStorage.setItem("swingState",JSON.stringify(state));
  showMessage("riskMessage","Risk настройките са запазени.");
}

function saveProviders(){
  const state=readState();
  state.providers=state.providers||{};
  state.secretNames=state.secretNames||{};

  for(const p of Object.keys(DEFAULT_PROVIDERS)){
    const e=$("provider-"+p+"-enabled");
    const q=$("provider-"+p+"-priority");
    const input=$("provider-"+p+"-secret");
    const requested=(input?.value||"").trim().toUpperCase();

    if(!validSecretName(requested)){
      alert("Невалидно име на secret за "+DEFAULT_PROVIDERS[p].name+". Използвай само A-Z, 0-9 и _, като името започва с буква.");
      input?.focus();
      return;
    }

    state.providers[p]={...DEFAULT_PROVIDERS[p],...(state.providers[p]||{}),
      enabled:!!e?.checked,
      priority:Number(q?.value)||DEFAULT_PROVIDERS[p].priority,
      secretName:requested
    };
    state.secretNames[p]=requested;
  }

  localStorage.setItem("swingState",JSON.stringify(state));
  showMessage("providersMessage","Data Sources са запазени.");
}

$("saveBackend").onclick=saveBackend;
$("saveStrategy").onclick=saveStrategy;
$("saveRisk").onclick=saveRisk;
$("saveProviders").onclick=saveProviders;
$("backBtn").onclick=()=>{window.location.href="index.html";};

document.querySelectorAll(".copy-secret").forEach(btn=>{
  btn.onclick=async()=>{
    const input=$(btn.dataset.secretInput);
    if(!input)return;
    try{
      await navigator.clipboard.writeText(input.value);
      const old=btn.textContent;
      btn.textContent="Копирано";
      setTimeout(()=>btn.textContent=old,1200);
    }catch(e){}
  };
});

loadSettings();
