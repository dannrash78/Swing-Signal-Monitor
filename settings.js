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
    const backups=[];
    for await (const entry of handle.values()){
      if(entry.kind!=="file" || !entry.name.startsWith(BACKUP_PREFIX) || !entry.name.toLowerCase().endsWith(".json"))continue;
      const file=await entry.getFile();
      backups.push({file,name:entry.name,time:file.lastModified||0});
    }
    backups.sort((a,b)=>b.time-a.time);
    if(!backups.length){
      backupMessage("В папката няма резервно копие на Swing Signal Monitor.",true);
      return;
    }
    let selected=backups[0];
    if(backups.length>1){
      const options=backups.map((item,index)=>{
        const date=item.time ? new Date(item.time).toLocaleString() : "неизвестна дата";
        return (index+1)+". "+item.name+" — "+date;
      }).join("\\n");
      const answer=window.prompt("Намерени са "+backups.length+" резервни копия. Въведи номера на копието, което искаш да възстановиш:\\n\\n"+options+"\\n\\nНай-новото е № 1.", "1");
      if(answer===null)return;
      const choice=Number(answer.trim());
      if(!Number.isInteger(choice)||choice<1||choice>backups.length){
        backupMessage("Невалиден избор. Не е възстановено резервно копие.",true);
        return;
      }
      selected=backups[choice-1];
    }
    await applyCompleteBackup(selected.file);
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


/* Google Drive backup: least-privilege OAuth scope; access token stays in memory only. */
const DRIVE_BACKUP_FOLDER_NAME = "Swing Signal Monitor Backups";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
let googleDriveAccessToken = "";
let googleDriveTokenExpiresAt = 0;
let googleDriveTokenClient = null;
let googleDriveLibraryPromise = null;
let googleDriveFolderId = localStorage.getItem("swingDriveFolderId") || "";

function driveMessage(text,isError=false){
  const el=$("googleDriveMessage");
  if(!el)return;
  el.hidden=false;
  el.textContent=(isError?"⚠ ":"✓ ")+text;
  el.classList.toggle("error",isError);
}
function driveStatus(text){const el=$("googleDriveStatus");if(el)el.textContent=text;}

function loadGoogleIdentityLibrary(){
  if(window.google?.accounts?.oauth2)return Promise.resolve();
  if(googleDriveLibraryPromise)return googleDriveLibraryPromise;
  googleDriveLibraryPromise=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://accounts.google.com/gsi/client";
    script.async=true;
    script.defer=true;
    script.onload=()=>window.google?.accounts?.oauth2?resolve():reject(new Error("Google Identity Services не се зареди."));
    script.onerror=()=>reject(new Error("Неуспешно зареждане на Google Identity Services."));
    document.head.appendChild(script);
  });
  return googleDriveLibraryPromise;
}

function getGoogleDriveClientId(){
  const input=$("googleDriveClientId");
  const value=(input?.value||localStorage.getItem("swingDriveClientId")||"").trim();
  if(!value || !value.endsWith(".apps.googleusercontent.com")){
    throw new Error("Въведи валиден Google OAuth Web Client ID.");
  }
  localStorage.setItem("swingDriveClientId",value);
  return value;
}

async function requestGoogleDriveToken(){
  if(googleDriveAccessToken && Date.now() < googleDriveTokenExpiresAt-60000)return googleDriveAccessToken;
  await loadGoogleIdentityLibrary();
  const clientId=getGoogleDriveClientId();
  return await new Promise((resolve,reject)=>{
    googleDriveTokenClient=window.google.accounts.oauth2.initTokenClient({
      client_id:clientId,
      scope:DRIVE_FILE_SCOPE,
      callback:response=>{
        if(response?.error){
          googleDriveAccessToken="";
          googleDriveTokenExpiresAt=0;
          reject(new Error("Google не предостави достъп: "+response.error));
          return;
        }
        if(!response?.access_token){
          reject(new Error("Не е получен access token от Google."));
          return;
        }
        googleDriveAccessToken=response.access_token;
        googleDriveTokenExpiresAt=Date.now()+(Number(response.expires_in)||3600)*1000;
        resolve(googleDriveAccessToken);
      },
      error_callback:error=>reject(new Error(error?.message||"Google OAuth прозорецът не може да се отвори."))
    });
    googleDriveTokenClient.requestAccessToken({prompt:""});
  });
}

async function driveApi(path,options={}){
  const token=await requestGoogleDriveToken();
  const response=await fetch("https://www.googleapis.com/drive/v3/"+path,{
    ...options,
    headers:{Authorization:"Bearer "+token,...(options.headers||{})}
  });
  if(response.status===401){
    googleDriveAccessToken="";
    googleDriveTokenExpiresAt=0;
    throw new Error("Google достъпът е изтекъл. Натисни „Свържи Google Drive“ и опитай отново.");
  }
  const body=await response.text();
  let data={};
  try{data=body?JSON.parse(body):{};}catch{}
  if(!response.ok)throw new Error(data.error?.message||("Google Drive API върна HTTP "+response.status+"."));
  return data;
}

async function findOrCreateGoogleDriveFolder(){
  if(googleDriveFolderId)return googleDriveFolderId;
  const q="name = '"+DRIVE_BACKUP_FOLDER_NAME+"' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const query=new URLSearchParams({q,spaces:"drive",pageSize:"100",fields:"files(id,name,mimeType,modifiedTime)"});
  const found=await driveApi("files?"+query.toString());
  const folder=(found.files||[]).find(item=>item.name===DRIVE_BACKUP_FOLDER_NAME && item.mimeType==="application/vnd.google-apps.folder");
  if(folder){
    googleDriveFolderId=folder.id;
    localStorage.setItem("swingDriveFolderId",googleDriveFolderId);
    return googleDriveFolderId;
  }
  const created=await driveApi("files?fields=id,name",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({name:DRIVE_BACKUP_FOLDER_NAME,mimeType:"application/vnd.google-apps.folder"})
  });
  if(!created.id)throw new Error("Google Drive не върна ID на папката.");
  googleDriveFolderId=created.id;
  localStorage.setItem("swingDriveFolderId",googleDriveFolderId);
  return googleDriveFolderId;
}

async function connectGoogleDrive(){
  try{
    getGoogleDriveClientId();
    await requestGoogleDriveToken();
    const folderId=await findOrCreateGoogleDriveFolder();
    driveStatus("Свързан с Google Drive · папка готова");
    driveMessage("Google Drive е свързан. Папката „"+DRIVE_BACKUP_FOLDER_NAME+"“ е готова.");
    await listGoogleDriveBackups(false);
  }catch(err){
    driveStatus("Не е свързан");
    driveMessage(err.message||"Неуспешно свързване с Google Drive.",true);
  }
}

async function disconnectGoogleDrive(){
  const token=googleDriveAccessToken;
  googleDriveAccessToken="";
  googleDriveTokenExpiresAt=0;
  googleDriveTokenClient=null;
  localStorage.removeItem("swingDriveFolderId");
  googleDriveFolderId="";
  driveStatus("Не е свързан");
  const select=$("googleDriveBackupList");
  if(select)select.innerHTML='<option value="">Свържи Google Drive, за да видиш архивите</option>';
  if(token && window.google?.accounts?.oauth2){
    window.google.accounts.oauth2.revoke(token,()=>driveMessage("Локалният достъп е изчистен и Google е помолен да отмени разрешението."));
  }else{
    driveMessage("Локалният access token и запомнената папка са изчистени. За пълно отнемане на разрешението провери Google Account → Security → Third-party connections.");
  }
}

async function saveGoogleDriveBackup(){
  try{
    if(!persistVisibleSettingsForBackup())return;
    const folderId=await findOrCreateGoogleDriveFolder();
    const payload=makeCompleteBackup();
    payload.version="1.26.0";
    payload.backupTarget="google-drive";
    payload.driveFolder=DRIVE_BACKUP_FOLDER_NAME;
    const fileName=backupFileName();
    const metadata={name:fileName,mimeType:"application/json",parents:[folderId]};
    const boundary="swing_signal_monitor_"+Math.random().toString(36).slice(2);
    const body=new Blob([
      "--"+boundary+"\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n",
      JSON.stringify(metadata),
      "\\r\\n--"+boundary+"\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n",
      JSON.stringify(payload,null,2),
      "\\r\\n--"+boundary+"--"
    ],{type:"multipart/related; boundary="+boundary});
    const result=await driveApi("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime",{
      method:"POST",
      headers:{"Content-Type":"multipart/related; boundary="+boundary},
      body
    });
    if(!result.id)throw new Error("Google Drive не потвърди създаването на архива.");
    driveStatus("Свързан с Google Drive");
    driveMessage("Архивът „"+result.name+"“ е записан в частната папка.");
    await listGoogleDriveBackups(false);
  }catch(err){
    driveMessage(err.message||"Неуспешен запис в Google Drive.",true);
  }
}

async function listGoogleDriveBackups(showResult=true){
  try{
    const folderId=await findOrCreateGoogleDriveFolder();
    const q="'"+folderId+"' in parents and trashed = false";
    const query=new URLSearchParams({q,spaces:"drive",pageSize:"100",orderBy:"modifiedTime desc",fields:"files(id,name,mimeType,modifiedTime,size)"});
    const data=await driveApi("files?"+query.toString());
    const files=(data.files||[]).filter(file=>file.mimeType!=="application/vnd.google-apps.folder" && file.name?.startsWith(BACKUP_PREFIX) && file.name.toLowerCase().endsWith(".json"));
    const select=$("googleDriveBackupList");
    select.innerHTML="";
    if(!files.length){
      select.add(new Option("Няма архиви в Google Drive папката",""));
      if(showResult)driveMessage("В папката все още няма архиви.");
      return files;
    }
    files.sort((a,b)=>String(b.modifiedTime||"").localeCompare(String(a.modifiedTime||"")));
    files.forEach(file=>{
      const date=file.modifiedTime?new Date(file.modifiedTime).toLocaleString():"дата неизвестна";
      select.add(new Option(file.name+" — "+date,file.id));
    });
    if(showResult)driveMessage("Намерени са "+files.length+" архив(а). Избери кой да възстановиш.");
    return files;
  }catch(err){
    if(showResult)driveMessage(err.message||"Неуспешно зареждане на списъка с архиви.",true);
    else throw err;
  }
}

async function restoreSelectedGoogleDriveBackup(){
  try{
    const id=$("googleDriveBackupList").value;
    if(!id){
      driveMessage("Първо избери архив от списъка.",true);
      return;
    }
    const metadata=await driveApi("files/"+encodeURIComponent(id)+"?fields=id,name,mimeType");
    if(metadata.mimeType!=="application/json" || !metadata.name?.startsWith(BACKUP_PREFIX)){
      throw new Error("Избраният файл не изглежда като архив на Swing Signal Monitor.");
    }
    const token=await requestGoogleDriveToken();
    const response=await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(id)+"?alt=media",{headers:{Authorization:"Bearer "+token}});
    if(!response.ok){
      const text=await response.text();
      throw new Error("Неуспешно изтегляне на архива (HTTP "+response.status+"). "+text.slice(0,200));
    }
    const blob=await response.blob();
    const file=new File([blob],metadata.name,{type:"application/json"});
    await applyCompleteBackup(file);
  }catch(err){
    driveMessage(err.message||"Неуспешно възстановяване на архива.",true);
  }
}

function loadGoogleDriveSettings(){
  const clientId=localStorage.getItem("swingDriveClientId")||"";
  const input=$("googleDriveClientId");
  if(input)input.value=clientId;
  driveStatus("Не е свързан — достъпът се предоставя при поискване");
}


$("connectGoogleDrive").onclick=connectGoogleDrive;
$("disconnectGoogleDrive").onclick=disconnectGoogleDrive;
$("saveGoogleDriveBackup").onclick=saveGoogleDriveBackup;
$("refreshGoogleDriveBackups").onclick=()=>listGoogleDriveBackups(true);
$("restoreGoogleDriveBackup").onclick=restoreSelectedGoogleDriveBackup;
$("googleDriveClientId").addEventListener("change",()=>{
  const value=$("googleDriveClientId").value.trim();
  if(value)localStorage.setItem("swingDriveClientId",value);
  else localStorage.removeItem("swingDriveClientId");
});
loadGoogleDriveSettings();
