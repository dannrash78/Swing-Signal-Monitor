const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const CACHE_TTL_SECONDS = 6 * 60 * 60;
const MAX_SYMBOLS = 10;

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "swing-signal-backend", version: "1.1" });
    }

    if (url.pathname !== "/api/scan") return json({ error: "Not found" }, 404);

    const symbols = [...new Set(
      (url.searchParams.get("symbols") || "")
        .split(",").map(x => x.trim().toUpperCase())
        .filter(x => /^[A-Z.]{1,8}$/.test(x))
    )].slice(0, MAX_SYMBOLS);

    if (!symbols.length) return json({ error: "No symbols" }, 400);
    if (!env.ALPHA_VANTAGE_KEY) return json({ error: "ALPHA_VANTAGE_KEY is not configured" }, 500);

    const results = [];
    let apiCalls = 0;
    let rateLimited = false;

    for (const symbol of symbols) {
      try {
        const cached = await getCachedSymbol(symbol);
        if (cached) {
          results.push({ ...cached, source: "cache" });
          continue;
        }

        if (rateLimited) {
          results.push({
            symbol,
            status: "rate_limited",
            error: "Alpha Vantage daily API limit reached; request skipped."
          });
          continue;
        }

        const data = await fetchAlphaVantage(symbol, env.ALPHA_VANTAGE_KEY);
        apiCalls++;

        if (data.rateLimited) {
          rateLimited = true;
          results.push({ symbol, status: "rate_limited", error: "Alpha Vantage daily API limit reached." });
          continue;
        }

        if (data.invalidSymbol) {
          results.push({ symbol, status: "invalid_symbol", error: "Symbol not found by Alpha Vantage." });
          continue;
        }

        const series = data.series;
        if (!series) {
          results.push({ symbol, status: "no_data", error: "No daily data returned." });
          continue;
        }

        const rows = Object.entries(series)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, v]) => ({ date, close: Number(v["4. close"]) }))
          .filter(x => Number.isFinite(x.close));

        if (rows.length < 61) {
          results.push({ symbol, status: "insufficient_history", error: "Not enough daily history." });
          continue;
        }

        const latest = rows.at(-1);
        const previous = rows.at(-2);
        const window = rows.slice(-61, -1);
        const high60 = Math.max(...window.map(x => x.close));
        const drawdownPct = (latest.close / high60 - 1) * 100;
        const changePct = (latest.close / previous.close - 1) * 100;

        const result = {
          symbol,
          status: "ok",
          date: latest.date,
          price: latest.close,
          high60,
          drawdownPct,
          changePct
        };

        results.push({ ...result, source: "alphavantage" });
        await putCachedSymbol(symbol, result, ctx);
      } catch (e) {
        results.push({ symbol, status: "error", error: e?.message || "Unexpected backend error." });
      }
    }

    return json({
      generatedAt: new Date().toISOString(),
      cacheTtlHours: CACHE_TTL_SECONDS / 3600,
      apiCalls,
      rateLimited,
      results
    });
  }
};

async function fetchAlphaVantage(symbol, key) {
  const api = new URL("https://www.alphavantage.co/query");
  api.searchParams.set("function", "TIME_SERIES_DAILY");
  api.searchParams.set("symbol", symbol);
  api.searchParams.set("outputsize", "compact");
  api.searchParams.set("apikey", key);

  const response = await fetch(api);
  const data = await response.json();

  if (data["Note"] || data["Information"]) return { rateLimited: true };
  if (data["Error Message"]) return { invalidSymbol: true };
  return { series: data["Time Series (Daily)"] };
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
