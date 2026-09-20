const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const CACHE_TTL_SECONDS = 6 * 60 * 60;
const MAX_SYMBOLS = 10;
const PROVIDERS = ["alphavantage", "twelvedata", "finnhub"];

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "swing-signal-backend",
        version: "1.9.2",
        providers: await providerHealth(env)
      });
    }

    if (url.pathname === "/api/test") {
      return testProviderRequest(url, env);
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
      alphavantage: { configured: !!env.ALPHA_VANTAGE_KEY, apiCalls: 0, remaining: null },
      twelvedata: { configured: !!env.TWELVE_DATA_API_KEY, apiCalls: 0, minuteCreditsLeft: null, dailyLimit: 800 },
      finnhub: { configured: !!env.FINNHUB_API_KEY, apiCalls: 0, remaining: null }
    };

    for (const symbol of symbols) {
      const cached = await getCachedSymbol(symbol);
      if (cached) {
        results.push({ ...cached, source: "cache" });
        continue;
      }

      let resolved = null;
      const attempts = [];
      for (const provider of providers) {
        if (!isConfigured(provider, env)) {
          attempts.push({ provider, status: "not_configured" });
          continue;
        }
        try {
          const data = await fetchProvider(provider, symbol, env, usage);
          attempts.push({ provider, status: data.result ? "ok" : (data.rateLimited ? "rate_limited" : (data.permanentError ? "error" : "no_valid_data")), message: data.message || null });
          if (data.rateLimited) continue;
          if (data.result) {
            resolved = { ...data.result, source: provider };
            break;
          }
          if (data.permanentError) continue;
        } catch (e) {
          attempts.push({ provider, status: "network_error", message: e?.message || "Network error" });
          // Try the next enabled provider.
        }
      }

      if (resolved) {
        results.push(resolved);
        await putCachedSymbol(symbol, resolved, ctx);
      } else {
        results.push({
          symbol,
          status: "provider_unavailable",
          error: "No enabled data provider returned valid data.",
          attempts
        });
      }
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
    const response = await fetch(url, { method: "GET", headers: { "User-Agent": "Swing-Signal-Monitor-Health/1.9.2" } });
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
    alphavantage: { configured: !!env.ALPHA_VANTAGE_KEY, apiCalls: 0 },
    twelvedata: { configured: !!env.TWELVE_DATA_API_KEY, apiCalls: 0, minuteCreditsLeft: null, dailyLimit: 800 },
    finnhub: { configured: !!env.FINNHUB_API_KEY, apiCalls: 0 }
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
    alphavantage: { configured: !!env.ALPHA_VANTAGE_KEY, network: checks[0] },
    twelvedata: { configured: !!env.TWELVE_DATA_API_KEY, network: checks[1] },
    finnhub: { configured: !!env.FINNHUB_API_KEY, network: checks[2] }
  };
}


function isConfigured(provider, env) {
  return provider === "alphavantage" ? !!env.ALPHA_VANTAGE_KEY
    : provider === "twelvedata" ? !!env.TWELVE_DATA_API_KEY
    : !!env.FINNHUB_API_KEY;
}

async function fetchProvider(provider, symbol, env, usage) {
  if (provider === "alphavantage") return fetchAlphaVantage(symbol, env.ALPHA_VANTAGE_KEY, usage);
  if (provider === "twelvedata") return fetchTwelveData(symbol, env.TWELVE_DATA_API_KEY, usage);
  return fetchFinnhub(symbol, env.FINNHUB_API_KEY, usage);
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
  api.searchParams.set("outputsize", "61");
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
  const from = to - 90 * 24 * 60 * 60;
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

  rows.sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 61) return null;

  const latest = rows.at(-1);
  const previous = rows.at(-2);
  const window = rows.slice(-61, -1);
  const high60 = Math.max(...window.map(x => x.close));

  return {
    symbol,
    status: "ok",
    date: latest.date,
    price: latest.close,
    high60,
    drawdownPct: (latest.close / high60 - 1) * 100,
    changePct: (latest.close / previous.close - 1) * 100
  };
}

function cacheKey(symbol) {
  return new Request("https://cache.swing-signal-backend.local/v1/daily/" + encodeURIComponent(symbol));
}

async function getCachedSymbol(symbol) {
  const response = await caches.default.match(cacheKey(symbol));
  if (!response) return null;
  try { return await response.json(); } catch { return null; }
}

async function putCachedSymbol(symbol, result, ctx) {
  const response = new Response(JSON.stringify(result), {
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
