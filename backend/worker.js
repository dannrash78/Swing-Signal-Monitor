const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const CACHE_TTL_SECONDS = 6 * 60 * 60;
const MAX_SYMBOLS = 10;
const PROVIDERS = ["alphavantage", "twelvedata", "finnhub"];
const DEFAULT_SECRET_NAMES = {
  alphavantage: "ALPHA_VANTAGE_KEY",
  twelvedata: "TWELVE_DATA_API_KEY",
  finnhub: "FINNHUB_API_KEY"
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "swing-signal-backend",
        version: "1.25.3",
        providers: await providerHealth(env)
      });
    }

    if (url.pathname === "/api/test") {
      return testProviderRequest(url, env);
    }

    if (url.pathname === "/api/market") {
      return marketRequest(url, env);
    }

    if (url.pathname !== "/api/scan") return json({ error: "Not found" }, 404);

    const symbols = [...new Set(
      (url.searchParams.get("symbols") || "")
        .split(",").map(x => x.trim().toUpperCase())
        .filter(x => /^[A-Z.]{1,8}$/.test(x))
    )].slice(0, MAX_SYMBOLS);

    const configured = url.searchParams.get("providers");
    const providers = (configured
      ? configured.split(",").map(x => x.trim().toLowerCase()).filter(x => PROVIDERS.includes(x))
      : PROVIDERS
    ).filter((p, i, a) => a.indexOf(p) === i);
    
    if (!symbols.length) return json({ error: "No symbols" }, 400);
    if (!providers.length) return json({ error: "No enabled providers" }, 400);

    const results = [];
    const usage = {
      alphavantage: { configured: !!getSecret(env, "alphavantage"), apiCalls: 0, remaining: null },
      twelvedata: { configured: !!getSecret(env, "twelvedata"), apiCalls: 0, minuteCreditsLeft: null, dailyLimit: 800 },
      finnhub: { configured: !!getSecret(env, "finnhub"), apiCalls: 0, remaining: null }
    };

    const completeSmaProviderAvailable = providers.some(p => (p === "twelvedata" || p === "finnhub") && isConfigured(p, env));

    for (const symbol of symbols) {
      const cached = await getCachedSymbol(symbol, completeSmaProviderAvailable);

      // Always try a fresh quote first. Historical/SMA data may come from cache.
      let live = null;
      const liveAttempts = [];
      for (const provider of providers) {
        if (!isConfigured(provider, env)) {
          liveAttempts.push({ provider, status: "not_configured" });
          continue;
        }
        try {
          const data = await fetchCurrentPrice(provider, symbol, env, usage);
          liveAttempts.push({
            provider,
            status: data.result ? "ok" : (data.rateLimited ? "rate_limited" : (data.permanentError ? "error" : "no_valid_data")),
            message: data.message || null
          });
          if (data.rateLimited) continue;
          if (data.result) {
            live = { ...data.result, source: provider };
            break;
          }
        } catch (e) {
          liveAttempts.push({ provider, status: "network_error", message: e?.message || "Network error" });
        }
      }

      let historical = cached;
      const historyAttempts = [];

      // Only fetch the expensive daily history when the cache is missing.
      if (!historical) {
        for (const provider of providers) {
          if (!isConfigured(provider, env)) {
            historyAttempts.push({ provider, status: "not_configured" });
            continue;
          }
          try {
            const data = await fetchProvider(provider, symbol, env, usage);
            historyAttempts.push({
              provider,
              status: data.result ? (data.result.sma200 == null ? "ok_partial" : "ok") : (data.rateLimited ? "rate_limited" : (data.permanentError ? "error" : "no_valid_data")),
              message: data.message || null
            });
            if (data.rateLimited) continue;
            if (data.result) {
              const hasSma200 = Number.isFinite(Number(data.result.sma200));
              const hasAnotherProvider = providers.indexOf(provider) < providers.length - 1;
              if (!hasSma200 && hasAnotherProvider) continue;
              historical = { ...data.result, source: provider };
              break;
            }
          } catch (e) {
            historyAttempts.push({ provider, status: "network_error", message: e?.message || "Network error" });
          }
        }
      }

      if (live && historical) {
        const price = Number(live.price);
        const high60 = Number(historical.high60);
        const resolved = {
          ...historical,
          price,
          changePct: Number.isFinite(Number(live.changePct)) ? Number(live.changePct) : historical.changePct,
          source: historical.source || live.source,
          priceSource: live.source,
          priceStatus: "live",
          priceUpdatedAt: live.updatedAt || new Date().toISOString(),
          liveQuote: true
        };
        if (Number.isFinite(price) && Number.isFinite(high60) && high60 > 0) {
          resolved.drawdownPct = (price / high60 - 1) * 100;
        }
        results.push(resolved);
        if (!cached) await putCachedSymbol(symbol, historical, ctx);
        continue;
      }

      // If live update fails, use the cached historical snapshot as the fallback.
      if (!live && cached) {
        results.push({
          ...cached,
          source: "cache",
          priceSource: "cache",
          priceStatus: "cached_fallback",
          liveQuote: false,
          liveQuoteAttempts: liveAttempts
        });
        continue;
      }

      // First load: if there is no cache and live quote failed, use fresh history if available.
      if (!live && historical) {
        results.push({
          ...historical,
          priceSource: "history",
          priceStatus: "historical_fallback",
          liveQuote: false,
          liveQuoteAttempts: liveAttempts
        });
        if (!cached) await putCachedSymbol(symbol, historical, ctx);
        continue;
      }

      results.push({
        symbol,
        status: "provider_unavailable",
        error: "No enabled data provider returned a live quote or valid historical data.",
        attempts: [...liveAttempts, ...historyAttempts]
      });
    }

    return json({
      generatedAt: new Date().toISOString(),
      cacheTtlHours: CACHE_TTL_SECONDS / 3600,
      providers,
      results,
      usage
    });
  }
};

async function checkProviderNetwork(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, { method: "GET", headers: { "User-Agent": "Swing-Signal-Monitor-Health/1.25.0" } });
    return { reachable: true, httpStatus: response.status, latencyMs: Date.now() - started };
  } catch (e) {
    return { reachable: false, httpStatus: null, latencyMs: Date.now() - started, error: e?.message || "Network error" };
  }
}

async function testProviderRequest(url, env) {
  const provider = (url.searchParams.get("provider") || "").toLowerCase();
    const symbol = (url.searchParams.get("symbol") || "NVDA").trim().toUpperCase();
  if (!PROVIDERS.includes(provider)) return json({ ok: false, error: "Unknown provider" }, 400);
  if (!isConfigured(provider, env)) return json({ ok: false, provider, symbol, status: "not_configured", error: "Provider API key is not configured." }, 200);

  const usage = {
    alphavantage: { configured: !!getSecret(env, "alphavantage"), apiCalls: 0 },
    twelvedata: { configured: !!getSecret(env, "twelvedata"), apiCalls: 0, minuteCreditsLeft: null, dailyLimit: 800 },
    finnhub: { configured: !!getSecret(env, "finnhub"), apiCalls: 0 }
  };
  try {
    const data = await fetchProvider(provider, symbol, env, usage);
    return json({
      ok: !!data.result,
      provider,
      symbol,
      status: data.result ? "ok" : (data.rateLimited ? "rate_limited" : "error"),
      message: data.message || null,
      result: data.result || null,
      usage
    });
  } catch (e) {
    return json({ ok: false, provider, symbol, status: "network_error", error: e?.message || "Network error", usage });
  }
}

async function providerHealth(env) {
    const checks = await Promise.all([
    checkProviderNetwork("https://www.alphavantage.co/"),
    checkProviderNetwork("https://api.twelvedata.com/"),
    checkProviderNetwork("https://finnhub.io/")
  ]);
  return {
    alphavantage: { configured: !!getSecret(env, "alphavantage"), network: checks[0] },
    twelvedata: { configured: !!getSecret(env, "twelvedata"), network: checks[1] },
    finnhub: { configured: !!getSecret(env, "finnhub"), network: checks[2] }
  };
}


function configuredSecretName(env, provider) {
  const configBinding = provider === "alphavantage" ? "ALPHA_VANTAGE_SECRET_NAME"
    : provider === "twelvedata" ? "TWELVE_DATA_SECRET_NAME"
    : "FINNHUB_SECRET_NAME";
  const candidate = String(env[configBinding] || "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,62}$/.test(candidate) ? candidate : DEFAULT_SECRET_NAMES[provider];
}

function getSecret(env, provider) {
  const preferred = configuredSecretName(env, provider);
  return env[preferred] || env[DEFAULT_SECRET_NAMES[provider]] || "";
}

function isConfigured(provider, env) {
  return !!getSecret(env, provider);
}

async function fetchProvider(provider, symbol, env, usage) {
  const key = getSecret(env, provider);
  if (provider === "alphavantage") return fetchAlphaVantage(symbol, key, usage);
  if (provider === "twelvedata") return fetchTwelveData(symbol, key, usage);
  return fetchFinnhub(symbol, key, usage);
}

async function fetchCurrentPrice(provider, symbol, env, usage) {
  const key = getSecret(env, provider);
  if (provider === "alphavantage") return fetchAlphaVantageQuote(symbol, key, usage);
  if (provider === "twelvedata") return fetchTwelveDataQuote(symbol, key, usage);
  return fetchFinnhubQuote(symbol, key, usage);
}

async function fetchAlphaVantageQuote(symbol, key, usage) {
  const api = new URL("https://www.alphavantage.co/query");
  api.searchParams.set("function", "GLOBAL_QUOTE");
  api.searchParams.set("symbol", symbol);
  api.searchParams.set("apikey", key);
  const response = await fetch(api);
  const data = await response.json();
  usage.alphavantage.apiCalls++;
  if (data["Note"] || data["Information"]) return { rateLimited: true, message: data["Note"] || data["Information"] };
  if (data["Error Message"]) return { permanentError: true, message: data["Error Message"] };
  const q = data["Global Quote"] || {};
  const price = Number(q["05. price"]);
  if (!Number.isFinite(price) || price <= 0) return { permanentError: true, message: "No valid live quote returned." };
  return {
    result: {
      price,
      changePct: Number(q["10. change percent"]?.replace("%","")),
      updatedAt: new Date().toISOString()
    }
  };
}

async function fetchTwelveDataQuote(symbol, key, usage) {
  const api = new URL("https://api.twelvedata.com/quote");
  api.searchParams.set("symbol", symbol);
  api.searchParams.set("apikey", key);
  const response = await fetch(api);
  const data = await response.json();
  usage.twelvedata.apiCalls++;
  const left = Number(response.headers.get("api-credits-left"));
  if (Number.isFinite(left)) usage.twelvedata.minuteCreditsLeft = left;
  if (data.status === "error" || data.code === 429 || /limit|credit|quota/i.test(data.message || "")) {
    return { rateLimited: true, message: data.message || "Rate limit / credit limit" };
  }
  const price = Number(data.close);
  if (!Number.isFinite(price) || price <= 0) return { permanentError: true, message: data.message || "No valid live quote returned." };
  const quoteTs = Number(data.last_quote_at || data.timestamp);
  return {
    result: {
      price,
      changePct: Number(data.percent_change),
      updatedAt: Number.isFinite(quoteTs) && quoteTs > 0 ? new Date(quoteTs * 1000).toISOString() : new Date().toISOString()
    }
  };
}

async function fetchFinnhubQuote(symbol, key, usage) {
  const api = new URL("https://finnhub.io/api/v1/quote");
  api.searchParams.set("symbol", symbol);
  api.searchParams.set("token", key);
  const response = await fetch(api);
  const data = await response.json();
  usage.finnhub.apiCalls++;
  if (response.status === 429) return { rateLimited: true, message: "HTTP 429 rate limit" };
  if (!response.ok) return { permanentError: true, message: data.error || ("HTTP " + response.status) };
  const price = Number(data.c);
  if (!Number.isFinite(price) || price <= 0) return { permanentError: true, message: "No valid live quote returned." };
  return {
    result: {
      price,
      changePct: Number(data.dp),
      updatedAt: Number.isFinite(Number(data.t)) && Number(data.t) > 0 ? new Date(Number(data.t) * 1000).toISOString() : new Date().toISOString()
    }
  };
}

async function fetchAlphaVantage(symbol, key, usage) {
  const api = new URL("https://www.alphavantage.co/query");
  api.searchParams.set("function", "TIME_SERIES_DAILY");
  api.searchParams.set("symbol", symbol);
  api.searchParams.set("outputsize", "compact");
  api.searchParams.set("apikey", key);
  const response = await fetch(api);
  const data = await response.json();
  usage.alphavantage.apiCalls++;
  if (data["Note"] || data["Information"]) return { rateLimited: true, message: data["Note"] || data["Information"] };
  if (data["Error Message"]) return { permanentError: true, message: data["Error Message"] };
  const series = data["Time Series (Daily)"];
  const result = normalizeDaily(symbol, series, "alphavantage");
  return result ? { result } : { permanentError: true, message: "No valid daily history returned." };
}

async function fetchTwelveData(symbol, key, usage) {
  const api = new URL("https://api.twelvedata.com/time_series");
  api.searchParams.set("symbol", symbol);
  api.searchParams.set("interval", "1day");
  api.searchParams.set("outputsize", "220");
  api.searchParams.set("apikey", key);
  const response = await fetch(api);
  const data = await response.json();
  usage.twelvedata.apiCalls++;
  const used = Number(response.headers.get("api-credits-used"));
  const left = Number(response.headers.get("api-credits-left"));
  if (Number.isFinite(left)) usage.twelvedata.minuteCreditsLeft = left;
  if (data.status === "error" || data.code === 429 || /limit|credit|quota/i.test(data.message || "")) {
    return { rateLimited: true, message: data.message || "Rate limit / credit limit" };
  }
  const values = Array.isArray(data.values) ? data.values : null;
  const result = normalizeDaily(symbol, values, "twelvedata");
  return result ? { result } : { permanentError: true, message: data.message || "No valid daily history returned." };
}

async function fetchFinnhub(symbol, key, usage) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 450 * 24 * 60 * 60;
  const api = new URL("https://finnhub.io/api/v1/stock/candle");
  api.searchParams.set("symbol", symbol);
  api.searchParams.set("resolution", "D");
  api.searchParams.set("from", String(from));
  api.searchParams.set("to", String(to));
  api.searchParams.set("token", key);
  const response = await fetch(api);
  const data = await response.json();
  usage.finnhub.apiCalls++;
  if (response.status === 429) return { rateLimited: true, message: "HTTP 429 rate limit" };
  if (!response.ok || data.s === "no_data") return { permanentError: true, message: data.error || data.s || "No data" };
  if (data.s !== "ok" || !Array.isArray(data.c) || !Array.isArray(data.t)) return { permanentError: true, message: data.error || "Invalid candle response" };
  const values = data.t.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    close: Number(data.c[i])
  }));
  const result = normalizeDaily(symbol, values, "finnhub");
  return result ? { result } : { permanentError: true, message: "No valid daily history returned." };
}

function averageClose(rows,count){
  if(!Array.isArray(rows)||rows.length<count)return null;
  const part=rows.slice(-count);
  const avg=part.reduce((sum,x)=>sum+Number(x.close),0)/count;
  return Number.isFinite(avg)?avg:null;
}

function normalizeDaily(symbol, raw, source) {
  if (!raw) return null;
  let rows;
  if (Array.isArray(raw)) {
    rows = raw.map(v => ({
      date: v.date || v.datetime,
      close: Number(v.close)
    })).filter(x => x.date && Number.isFinite(x.close));
  } else {
    rows = Object.entries(raw).map(([date, v]) => ({
      date,
      close: Number(v["4. close"])
    })).filter(x => Number.isFinite(x.close));
  }

  rows.sort((a,b)=>a.date.localeCompare(b.date));
  if(rows.length<61)return null;

  const latest=rows.at(-1),previous=rows.at(-2),prior20=rows.at(-21),prior60=rows.at(-61);
  const window=rows.slice(-61,-1);
  const high60=Math.max(...window.map(x=>x.close));

  return {
    symbol,status:"ok",cacheSchema:"sma-v1",date:latest.date,price:latest.close,
    historyCount:rows.length,
    smaStatus:Number.isFinite(Number(averageClose(rows,200)))?"complete":"partial",
    sma20:averageClose(rows,20),
    sma50:averageClose(rows,50),
    sma200:averageClose(rows,200),
    return20:prior20?(latest.close/prior20.close-1)*100:null,
    return60:prior60?(latest.close/prior60.close-1)*100:null,
    high60,
    drawdownPct:(latest.close/high60-1)*100,
    changePct:previous?(latest.close/previous.close-1)*100:null
  };
}


const MARKET_SYMBOLS = ["SPY","QQQ"];
const MARKET_HISTORY_DAYS = 260;

async function marketRequest(url, env) {
  const configured=url.searchParams.get("providers");
  const providers=(configured
    ? configured.split(",").map(x=>x.trim().toLowerCase()).filter(x=>PROVIDERS.includes(x))
    : PROVIDERS
  ).filter((p,i,a)=>a.indexOf(p)===i);
  if(!providers.length) return json({error:"No enabled providers"},400);

  const usage={
    alphavantage:{configured:!!getSecret(env,"alphavantage"),apiCalls:0,remaining:null},
    twelvedata:{configured:!!getSecret(env,"twelvedata"),apiCalls:0,minuteCreditsLeft:null,dailyLimit:800},
    finnhub:{configured:!!getSecret(env,"finnhub"),apiCalls:0,remaining:null}
  };

  const results=[];
  for(const symbol of MARKET_SYMBOLS){
    const cached=await getCachedMarketSymbol(symbol);
    if(cached){ results.push({...cached,source:"cache"}); continue; }

    let resolved=null;
    const attempts=[];
    for(const provider of providers){
      if(!isConfigured(provider,env)){
        attempts.push({provider,status:"not_configured"});
        continue;
      }
      try{
        const data=await fetchMarketProvider(provider,symbol,env,usage);
        attempts.push({provider,status:data.result?"ok":(data.rateLimited?"rate_limited":(data.permanentError?"error":"no_valid_data")),message:data.message||null});
        if(data.rateLimited) continue;
        if(data.result){ resolved={...data.result,source:provider}; break; }
        if(data.permanentError) continue;
      }catch(e){
        attempts.push({provider,status:"network_error",message:e?.message||"Network error"});
      }
    }
    if(resolved){
      results.push(resolved);
      await putCachedMarketSymbol(symbol,resolved);
    }else{
      results.push({symbol,status:"provider_unavailable",error:"No enabled data provider returned valid market data.",attempts});
    }
  }

  return json({generatedAt:new Date().toISOString(),cacheTtlHours:CACHE_TTL_SECONDS/3600,providers,results,usage});
}

async function fetchMarketProvider(provider,symbol,env,usage){
  const key=getSecret(env,provider);
  if(!key) return {permanentError:true,message:"Provider API key is not configured."};
  if(provider==="alphavantage") return fetchAlphaVantageMarket(symbol,key,usage);
  if(provider==="twelvedata") return fetchTwelveDataMarket(symbol,key,usage);
  return fetchFinnhubMarket(symbol,key,usage);
}

async function fetchAlphaVantageMarket(symbol,key,usage){
  const api=new URL("https://www.alphavantage.co/query");
  api.searchParams.set("function","TIME_SERIES_DAILY");
  api.searchParams.set("symbol",symbol);
  api.searchParams.set("outputsize","compact");
  api.searchParams.set("apikey",key);
  const response=await fetch(api);
  const data=await response.json();
  usage.alphavantage.apiCalls++;
  if(data["Note"]||data["Information"]) return {rateLimited:true,message:data["Note"]||data["Information"]};
  if(data["Error Message"]) return {permanentError:true,message:data["Error Message"]};
  const result=normalizeMarketDaily(symbol,data["Time Series (Daily)"],"alphavantage");
  return result?{result}:{permanentError:true,message:"Alpha Vantage did not return valid market history."};
}

async function fetchTwelveDataMarket(symbol,key,usage){
  const api=new URL("https://api.twelvedata.com/time_series");
  api.searchParams.set("symbol",symbol);
  api.searchParams.set("interval","1day");
  api.searchParams.set("outputsize",String(MARKET_HISTORY_DAYS));
  api.searchParams.set("apikey",key);
  const response=await fetch(api);
  const data=await response.json();
  usage.twelvedata.apiCalls++;
  const left=Number(response.headers.get("api-credits-left"));
  if(Number.isFinite(left)) usage.twelvedata.minuteCreditsLeft=left;
  if(data.status==="error"||data.code===429||/limit|credit|quota/i.test(data.message||"")) return {rateLimited:true,message:data.message||"Rate limit / credit limit"};
  const result=normalizeMarketDaily(symbol,Array.isArray(data.values)?data.values:null,"twelvedata");
  return result?{result}:{permanentError:true,message:data.message||"No valid market daily history returned."};
}

async function fetchFinnhubMarket(symbol,key,usage){
  const to=Math.floor(Date.now()/1000);
  const from=to-450*24*60*60;
  const api=new URL("https://finnhub.io/api/v1/stock/candle");
  api.searchParams.set("symbol",symbol);
  api.searchParams.set("resolution","D");
  api.searchParams.set("from",String(from));
  api.searchParams.set("to",String(to));
  api.searchParams.set("token",key);
  const response=await fetch(api);
  const data=await response.json();
  usage.finnhub.apiCalls++;
  if(response.status===429) return {rateLimited:true,message:"HTTP 429 rate limit"};
  if(!response.ok||data.s==="no_data") return {permanentError:true,message:data.error||data.s||"No data"};
  if(data.s!=="ok"||!Array.isArray(data.c)||!Array.isArray(data.t)) return {permanentError:true,message:data.error||"Invalid candle response"};
  const values=data.t.map((ts,i)=>({date:new Date(ts*1000).toISOString().slice(0,10),close:Number(data.c[i])}));
  const result=normalizeMarketDaily(symbol,values,"finnhub");
  return result?{result}:{permanentError:true,message:"Finnhub did not return enough daily history for market context."};
}

function normalizeMarketDaily(symbol,raw,source){
  if(!raw) return null;
  let rows;
  if(Array.isArray(raw)){
    rows=raw.map(v=>({date:v.date||v.datetime,close:Number(v.close)})).filter(x=>x.date&&Number.isFinite(x.close));
  }else{
    rows=Object.entries(raw).map(([date,v])=>({date,close:Number(v["4. close"])})).filter(x=>Number.isFinite(x.close));
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date));
  if(rows.length<61) return null;
  const latest=rows.at(-1);
  const prior20=rows.at(-21);
  const prior60=rows.at(-61);
  const prior60Rows=rows.slice(-61,-1);
  const high60=prior60Rows.length?Math.max(...prior60Rows.map(x=>x.close)):null;
  return {
    symbol,status:"ok",date:latest.date,price:latest.close,
    sma20:averageClose(rows,20),sma50:averageClose(rows,50),sma200:averageClose(rows,200),
    return20:prior20?(latest.close/prior20.close-1)*100:null,
    return60:prior60?(latest.close/prior60.close-1)*100:null,
    high60,drawdownPct:Number.isFinite(Number(high60))?(latest.close/high60-1)*100:null,source
  };
}

function marketCacheKey(symbol){
  return new Request("https://cache.swing-signal-backend.local/v1/market/"+encodeURIComponent(symbol));
}
async function getCachedMarketSymbol(symbol){
  const response=await caches.default.match(marketCacheKey(symbol));
  if(!response) return null;
  try{return await response.json();}catch{return null;}
}
async function putCachedMarketSymbol(symbol,result){
  const response=new Response(JSON.stringify(result),{headers:{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"public, max-age="+CACHE_TTL_SECONDS
  }});
  await caches.default.put(marketCacheKey(symbol),response);
}

function cacheKey(symbol) {
  return new Request("https://cache.swing-signal-backend.local/v1.25/daily/" + encodeURIComponent(symbol));
}

async function getCachedSymbol(symbol, requireCompleteSma = false) {
  const response = await caches.default.match(cacheKey(symbol));
  if (!response) return null;
  try {
    const cached = await response.json();
    if (!cached || cached.cacheSchema !== "sma-v1") return null;
    if (!Number.isFinite(Number(cached.sma20)) || !Number.isFinite(Number(cached.sma50))) return null;
    if (requireCompleteSma && !Number.isFinite(Number(cached.sma200))) return null;
    return cached;
  } catch {
    return null;
  }
}

async function putCachedSymbol(symbol, result, ctx) {
  const cached = { ...result };
  delete cached.priceSource;
  delete cached.priceStatus;
  delete cached.priceUpdatedAt;
  delete cached.liveQuote;
  delete cached.liveQuoteAttempts;
  const response = new Response(JSON.stringify(cached), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=" + CACHE_TTL_SECONDS
    }
  });
  ctx.waitUntil(caches.default.put(cacheKey(symbol), response));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors }
  });
}
