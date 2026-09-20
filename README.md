# Swing Signal Monitor

Version 1.9.2

GitHub Pages frontend + Cloudflare Worker backend for informational swing monitoring.

## Core functionality

- Persistent watchlist with 10 default US stocks.
- Company name shown next to ticker.
- Visible stocks grouped by region and alphabetically sorted.
- Each stock has a persistent Update checkbox.
- Hidden list: X / Скрий hides a stock; Покажи restores it without deleting data.
- No automatic market-data scan on page load.
- Manual Update only requests selected stocks.
- Check Health uses /api/health, checks backend connectivity to all three provider hosts, and does not call market-data endpoints or consume provider data quota.
- Each provider has a Test NVDA action that performs one real provider data request and bypasses the market-data cache; the result shows OK, rate limit, error, returned price/date, and API-call count.
- Failed scans show the provider-by-provider attempts and their actual status/reason when no provider returns valid data.
- Last successful results are kept locally.
- Signals use the 60-trading-day high, configurable drawdown levels and optional position target.

## Data providers

The frontend can enable/disable and prioritize:

1. Alpha Vantage
2. Twelve Data
3. Finnhub

The Worker tries enabled providers in priority order and falls back when a provider is rate-limited or fails. Successful results are cached for 6 hours. Each result displays its actual source.

## Cloudflare Worker secrets

Configure these as Worker secrets, never in frontend files:

- `ALPHA_VANTAGE_KEY`
- `TWELVE_DATA_API_KEY`
- `FINNHUB_API_KEY` (optional)

Wrangler example:

```bash
npx wrangler secret put ALPHA_VANTAGE_KEY
npx wrangler secret put TWELVE_DATA_API_KEY
npx wrangler secret put FINNHUB_API_KEY
npx wrangler deploy
```

## Quota display

Twelve Data usage is shown in the frontend:
- local estimate of remaining daily credits, based on requests made through this browser;
- current-minute remaining credits when returned by the provider.

The daily browser value is an estimate, not an account-wide authoritative counter. Alpha Vantage and Finnhub remaining quotas are not presented as exact values unless the provider supplies reliable information.

## Important

API keys remain server-side in Cloudflare Worker. The frontend sends only provider names/priorities, never secrets.
