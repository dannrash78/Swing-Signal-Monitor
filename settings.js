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


const BACKUP_DIR_DB = "swingSignalMonitorBackup";
const BACKUP_DIR_STORE = "handles";
const BACKUP_DIR_KEY = "backupDirectory";
const BACKUP_PREFIX = "swing-signal-monitor-backup-";
let backupDirectoryHandle = null;

function backupMessage(message, isError=false){
  const el=$("backupMessage");
  if(!el)return;
  el.hidden=false;
  el.textContent=(isError ? "⚠ " : "✓ ")+message;
  el.classList.toggle("error",isError);
}

function openBackupDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(BACKUP_DIR_DB,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(BACKUP_DIR_STORE);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

async function storeBackupDirectory(handle){
  const db=await openBackupDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(BACKUP_DIR_STORE,"readwrite");
    tx.objectStore(BACKUP_DIR_STORE).put(handle,BACKUP_DIR_KEY);
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onerror=()=>{db.close();reject(tx.error);};
  });
}

async function readBackupDirectory(){
  const db=await openBackupDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(BACKUP_DIR_STORE,"readonly");
    const request=tx.objectStore(BACKUP_DIR_STORE).get(BACKUP_DIR_KEY);
    request.onsuccess=()=>{const value=request.result||null;db.close();resolve(value);};
    request.onerror=()=>{db.close();reject(request.error);};
  });
}

async function ensureDirectoryPermission(handle, request=false){
  if(!handle) return false;
  if(!handle.queryPermission) return true;
  let permission=await handle.queryPermission({mode:"readwrite"});
  if(permission!=="granted" && request && handle.requestPermission){
    permission=await handle.requestPermission({mode:"readwrite"});
  }
  return permission==="granted";
}

function showBackupDirectory(handle){
  backupDirectoryHandle=handle||null;
  $("backupFolderPath").value=handle ? handle.name : "";
  $("backupFolderPath").title=handle ? "Избрана папка: "+handle.name : "";
}

async function chooseBackupDirectory(){
  try{
    if(!window.showDirectoryPicker){
      backupMessage("Този браузър не поддържа избор на папка. При запис ще се изтегли JSON файл, а зареждането става чрез избор на файл.",true);
      return;
    }
    const handle=await window.showDirectoryPicker({id:"swing-signal-monitor-backups",mode:"readwrite"});
    showBackupDirectory(handle);
    try{await storeBackupDirectory(handle);}catch(e){}
    const granted=await ensureDirectoryPermission(handle,true);
    backupMessage(granted ? "Папката е избрана: "+handle.name : "Папката е избрана. При запис браузърът ще поиска разрешение.");
  }catch(err){
    if(err?.name!=="AbortError") backupMessage(err.message||"Неуспешен избор на папка.",true);
  }
}

function persistVisibleSettingsForBackup(){
  const state=readState();
  const backend=($("backendUrl").value||"").trim().replace(/\/$/,"");
  const target=Number($("targetPct").value);
  const levels=$("levels").value.split(",").map(Number).filter(x=>Number.isFinite(x)&&x>0);
  const portfolio=Number($("portfolioCapital").value);
  const riskPct=Number($("riskPerTradePct").value);
  const stopPct=Number($("stopLossPct").value);
  state.target=Number.isFinite(target)&&target>0?target:10;
  state.levels=levels.length?levels:[5,8,10];
  state.risk={
    portfolioCapital:Number.isFinite(portfolio)&&portfolio>=0?portfolio:0,
    riskPerTradePct:Number.isFinite(riskPct)&&riskPct>=0.1?Math.min(10,riskPct):1,
    stopLossPct:Number.isFinite(stopPct)&&stopPct>=0.5?Math.min(50,stopPct):7
  };
  state.providers=state.providers||{};
  state.secretNames=state.secretNames||{};
  for(const p of Object.keys(DEFAULT_PROVIDERS)){
    const requested=($("provider-"+p+"-secret").value||"").trim().toUpperCase();
    if(!validSecretName(requested)){
      alert("Невалидно име на secret за "+DEFAULT_PROVIDERS[p].name+". Използвай A-Z, 0-9 и _, като името започва с буква.");
      $("provider-"+p+"-secret").focus();
      return false;
    }
    state.providers[p]={...DEFAULT_PROVIDERS[p],...(state.providers[p]||{}),
      enabled:$("provider-"+p+"-enabled").checked,
      priority:Number($("provider-"+p+"-priority").value)||DEFAULT_PROVIDERS[p].priority,
      secretName:requested
    };
    state.secretNames[p]=requested;
  }
  localStorage.setItem("swingBackend",backend);
  localStorage.setItem("swingState",JSON.stringify(state));
  return true;
}

function makeCompleteBackup(){
  const storage={};
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(key && key.startsWith("swing")) storage[key]=localStorage.getItem(key);
  }
  let state={};
  try{state=JSON.parse(localStorage.getItem("swingState")||"{}")||{};}catch{}
  return {
    format:"Swing Signal Monitor complete local backup",
    version:"1.25.6",
    exportedAt:new Date().toISOString(),
    backendUrl:localStorage.getItem("swingBackend")||"",
    state,
    storage
  };
}

function backupFileName(date=new Date()){
  const pad=n=>String(n).padStart(2,"0");
  return BACKUP_PREFIX+date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate())+"-"+pad(date.getHours())+"-"+pad(date.getMinutes())+"-"+pad(date.getSeconds())+".json";
}

async function saveBackupToDirectory(){
  try{
    if(!persistVisibleSettingsForBackup())return;
    let handle=backupDirectoryHandle;
    if(!handle){
      try{handle=await readBackupDirectory();}catch{}
      if(handle)showBackupDirectory(handle);
    }
    if(!handle && !window.showDirectoryPicker){
      const fileName=backupFileName();
      const blob=new Blob([JSON.stringify(makeCompleteBackup(),null,2)],{type:"application/json;charset=utf-8"});
      const link=document.createElement("a");
      link.href=URL.createObjectURL(blob);
      link.download=fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(()=>URL.revokeObjectURL(link.href),1000);
      backupMessage("Браузърът не поддържа избор на папка — резервното копие е изтеглено като "+fileName+".");
      return;
    }
    if(!handle){
      await chooseBackupDirectory();
      handle=backupDirectoryHandle;
      if(!handle)return;
    }
    if(!await ensureDirectoryPermission(handle,true)){
      backupMessage("Няма разрешение за запис в избраната папка.",true);
      return;
    }
    const fileName=backupFileName();
    const fileHandle=await handle.getFileHandle(fileName,{create:true});
    const writable=await fileHandle.createWritable();
    await writable.write(JSON.stringify(makeCompleteBackup(),null,2));
    await writable.close();
    backupMessage("Копието е записано в „"+handle.name+"“ като "+fileName+".");
  }catch(err){
    if(err?.name!=="AbortError") backupMessage(err.message||"Неуспешен запис на резервното копие.",true);
  }
}

async function applyCompleteBackup(file){
  const raw=await file.text();
  let payload;
  try{payload=JSON.parse(raw);}catch{throw new Error("Файлът не е валиден JSON.");}
  if(!payload || !payload.format || !String(payload.format).includes("Swing Signal Monitor") || (!payload.storage && !payload.state)){
    throw new Error("Файлът не изглежда като резервно копие на Swing Signal Monitor.");
  }
  if(!confirm("Зареждането ще замени текущите настройки, Watchlist, последните данни и позициите. Продължаваме ли?"))return;
  const saved=payload.storage&&typeof payload.storage==="object" ? payload.storage : {};
  const keysToReplace=[];
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(key&&key.startsWith("swing"))keysToReplace.push(key);
  }
  keysToReplace.forEach(key=>localStorage.removeItem(key));
  Object.entries(saved).forEach(([key,value])=>{
    if(key.startsWith("swing") && typeof value==="string")localStorage.setItem(key,value);
  });
  if(payload.state && !localStorage.getItem("swingState"))localStorage.setItem("swingState",JSON.stringify(payload.state));
  if(Object.prototype.hasOwnProperty.call(payload,"backendUrl")){
    if(payload.backendUrl)localStorage.setItem("swingBackend",String(payload.backendUrl));
    else localStorage.removeItem("swingBackend");
  }
  backupMessage("Копието е заредено. Страницата ще се презареди с възстановените данни.");
  setTimeout(()=>window.location.reload(),500);
}

async function loadLatestBackupFromDirectory(){
  try{
    let handle=backupDirectoryHandle;
    if(!handle){
      try{handle=await readBackupDirectory();}catch{}
      if(handle)showBackupDirectory(handle);
    }
    if(!handle){
      if(window.showDirectoryPicker){
        await chooseBackupDirectory();
        handle=backupDirectoryHandle;
        if(!handle)return;
      }else{
        $("backupFallbackFile").click();
        return;
      }
    }
    if(!await ensureDirectoryPermission(handle,true)){
      backupMessage("Няма разрешение за четене на избраната папка.",true);
      return;
    }
    let latest=null,latestTime=-1;
    for await (const entry of handle.values()){
      if(entry.kind!=="file" || !entry.name.startsWith(BACKUP_PREFIX) || !entry.name.toLowerCase().endsWith(".json"))continue;
      const file=await entry.getFile();
      const time=file.lastModified||0;
      if(time>latestTime){latestTime=time;latest=file;}
    }
    if(!latest){
      backupMessage("В папката няма резервно копие на Swing Signal Monitor.",true);
      return;
    }
    await applyCompleteBackup(latest);
  }catch(err){
    if(err?.name!=="AbortError")backupMessage(err.message||"Неуспешно зареждане на резервното копие.",true);
  }
}

async function loadBackupDirectoryOnStart(){
  if(!window.indexedDB)return;
  try{
    const handle=await readBackupDirectory();
    if(handle)showBackupDirectory(handle);
  }catch{}
}


$("chooseBackupFolder").onclick=chooseBackupDirectory;
$("saveFolderBackup").onclick=saveBackupToDirectory;
$("loadFolderBackup").onclick=loadLatestBackupFromDirectory;
$("backupFallbackFile").onchange=async event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  try{await applyCompleteBackup(file);}catch(err){backupMessage(err.message||"Неуспешно зареждане на файла.",true);}
  event.target.value="";
};
loadSettings();
loadBackupDirectoryOnStart();
