# Swing Signal Monitor

Version 1.12.0

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
- Data-source enablement and priority are controlled from the sticky header. Check Health exposes a Test NVDA action for each provider.
- Failed scans show the provider-by-provider attempts and their actual status/reason when no provider returns valid data.
- Last successful results are kept locally.
- Signals use the 60-trading-day high, configurable drawdown levels and optional position target.
- Multiple entries for the same symbol are stored and evaluated by average entry price.
- Without a holding, the card also shows the model's next/active entry level based on the configured drawdown thresholds.
- Position entry uses a dropdown containing only currently visible watchlist stocks.
- Clearing the holding checkbox for an existing stock clears its open entries without removing the stock from the watchlist.
- Watchlist can be sorted alphabetically or by unit price (high-to-low / low-to-high), with the choice persisted locally.
- Watchlist can switch between card and table views, with the choice persisted locally.
- ENTRY ZONE tiles/rows are highlighted green; HOLD/WATCH tiles/rows are highlighted yellow.

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


## v1.10.0 diagnostics

- Provider enable/disable and priority controls are always visible in the sticky header.
- Provider usage is shown in the page footer instead of accumulating in the settings area.
- The browser-side request counters reset at local midnight (00:00). They are estimates for requests made through this browser, not authoritative account-wide quotas.
- Twelve Data's Basic plan currently documents 8 API credits/minute and 800/day; its daily Basic quota resets at 00:00 UTC. Provider response headers can report exact minute credit usage. 
- Activity Log records query, result and error events locally and can be exported as JSON.
- The watchlist region headings span the full grid width so they no longer create a blank first tile.

## Configure Twelve Data and Finnhub

Set the API keys as Cloudflare Worker secrets, never in GitHub Pages/frontend files:

```bash
npx wrangler secret put TWELVE_DATA_API_KEY
npx wrangler secret put FINNHUB_API_KEY
npx wrangler deploy
```

After deployment use **Check Health** and then the provider's **Test NVDA** button. Health only checks backend/provider-host reachability; Test NVDA performs one real provider data request.


## v1.11.0 watchlist display
- Removed the regional "Американски акции" heading from the watchlist rendering.
- Added sorting controls below the watchlist: alphabetical, Price descending, and Price ascending.
- Added card/table visualization switch below the watchlist.
- Full cards/table rows use a green highlight for ENTRY ZONE and yellow for HOLD/WATCH.
- Watchlist controls are shown next to the Watchlist title.
- Added master checkbox for selecting/deselecting all visible stocks for Update.
- Added signal sorting with ENTRY ZONE first; price ascending remains available as a separate sort mode.
- Table view uses visible row borders and alternating light/darker backgrounds for readability.


## v1.12.0 watchlist controls
- Sorting and view controls moved next to the Watchlist title.
- Added "Всички за Update" master checkbox for visible stocks.
- Added "Сигнал (ENTRY най-отгоре)" sorting.
- Table rows have borders and alternating background shades; signal highlighting remains green/yellow where applicable.
