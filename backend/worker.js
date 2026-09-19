const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, {headers:cors});

    const url = new URL(request.url);

    if (url.pathname === "/api/health")
      return json({ok:true, service:"swing-signal-backend"});

    if (url.pathname !== "/api/scan")
      return json({error:"Not found"}, 404);

    const symbols = (url.searchParams.get("symbols") || "")
      .split(",").map(x=>x.trim().toUpperCase())
      .filter(x=>/^[A-Z.]{1,8}$/.test(x));

    if (!symbols.length) return json({error:"No symbols"},400);
    if (!env.ALPHA_VANTAGE_KEY)
      return json({error:"ALPHA_VANTAGE_KEY is not configured"},500);

    const results = [];
    for (const symbol of symbols.slice(0,20)) {
      try {
        const api = new URL("https://www.alphavantage.co/query");
        api.searchParams.set("function","TIME_SERIES_DAILY");
        api.searchParams.set("symbol",symbol);
        api.searchParams.set("outputsize","compact");
        api.searchParams.set("apikey",env.ALPHA_VANTAGE_KEY);

        const r = await fetch(api);
        const data = await r.json();

        if (data["Note"]) throw new Error("API rate limit reached");
        if (data["Error Message"]) throw new Error("Symbol not found");

        const series = data["Time Series (Daily)"];
        if (!series) throw new Error("No daily data");

        const rows = Object.entries(series)
          .sort((a,b)=>a[0].localeCompare(b[0]))
          .map(([date,v])=>({
            date,
            close:Number(v["4. close"])
          }))
          .filter(x=>Number.isFinite(x.close));

        if (rows.length < 61) throw new Error("Not enough daily history");

        const latest = rows.at(-1);
        const previous = rows.at(-2);
        const window = rows.slice(-61,-1);
        const high60 = Math.max(...window.map(x=>x.close));
        const drawdownPct = (latest.close/high60-1)*100;
        const changePct = (latest.close/previous.close-1)*100;

        results.push({
          symbol,
          date: latest.date,
          price: latest.close,
          high60,
          drawdownPct,
          changePct
        });
      } catch (e) {
        results.push({symbol,error:e.message});
      }
    }

    return json({generatedAt:new Date().toISOString(),results});
  }
};

function json(obj,status=200){
  return new Response(JSON.stringify(obj),{
    status,
    headers:{"Content-Type":"application/json; charset=utf-8",...cors}
  });
}
