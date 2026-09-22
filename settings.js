const DEFAULT_PROVIDERS = {
  alphavantage: { enabled:true, priority:1, name:"Alpha Vantage" },
  twelvedata: { enabled:true, priority:2, name:"Twelve Data" },
  finnhub: { enabled:false, priority:3, name:"Finnhub" }
};

function $(id){ return document.getElementById(id); }

function loadSettings(){
  const state = JSON.parse(localStorage.getItem("swingState") || "null") || {};
  state.providers = state.providers || {};
  Object.keys(DEFAULT_PROVIDERS).forEach(p=>{
    state.providers[p] = {...DEFAULT_PROVIDERS[p], ...(state.providers[p] || {})};
  });

  $("backendUrl").value = localStorage.getItem("swingBackend") || "";
  Object.keys(DEFAULT_PROVIDERS).forEach(p=>{
    $("provider-"+p+"-enabled").checked = !!state.providers[p].enabled;
    $("provider-"+p+"-priority").value = String(state.providers[p].priority);
  });
}

function saveSettings(){
  const state = JSON.parse(localStorage.getItem("swingState") || "null") || {};
  state.providers = state.providers || {};

  Object.keys(DEFAULT_PROVIDERS).forEach(p=>{
    state.providers[p] = {
      ...DEFAULT_PROVIDERS[p],
      ...(state.providers[p] || {}),
      enabled: $("provider-"+p+"-enabled").checked,
      priority: Number($("provider-"+p+"-priority").value) || DEFAULT_PROVIDERS[p].priority
    };
  });

  const backend = $("backendUrl").value.trim().replace(/\/$/,"");
  localStorage.setItem("swingBackend", backend);
  localStorage.setItem("swingState", JSON.stringify(state));

  $("saveMessage").hidden = false;
  $("saveMessage").textContent = "✓ Настройките са запазени в този браузър.";
}

$("settingsForm").addEventListener("submit",e=>{
  e.preventDefault();
  saveSettings();
});

$("backBtn").onclick=()=>{ window.location.href="index.html"; };

loadSettings();
