# Swing Signal Monitor

Version 1.19.4

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
- Data-source enablement and priority are controlled from **Settings**. Check Health remains available from the main page.
- Failed scans show the provider-by-provider attempts and their actual status/reason when no provider returns valid data.
- Last successful results are kept locally.
- Signals use the 60-trading-day high, configurable drawdown levels and optional position target.
- Multiple entries for the same symbol are stored and evaluated by average entry price.
- Without a holding, the card also shows the model's next/active entry level based on the configured drawdown thresholds.
- Position entry uses a dropdown containing only currently visible watchlist stocks.
- Clearing the holding checkbox for an existing stock clears its open entries without removing the stock from the watchlist.
- Each watchlist group has its own persistent sorting and view choice: alphabetical, signal, price ascending/descending, Cards or Table.
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

## Important

API keys remain server-side in Cloudflare Worker. The frontend sends only provider names/priorities, never secrets.

## v1.19.4 Settings

- Settings remains compact and aligned with the existing site design.
- Provider names are direct links to their official account portals; separate "Създай акаунт" buttons were removed.
- Cloudflare Worker information is grouped into a compact block showing the Worker name, secret names and Dashboard link.
- The displayed secret names are the bindings expected by the current Worker code. They are not the secret values and are not editable from the public frontend.
- The Backend URL remains user-specific and is stored locally in the browser.

## v1.19.0

- The two watchlist groups have independent **Update selection, sorting, and view** controls.
- **Мои позиции** and **Други наблюдавани** can independently use Cards or Table view and independent sort order.
- Owned-position cards show profit/loss against the **weighted average entry price** based on purchase price and quantity.
- Existing legacy numeric entry prices are migrated as quantity 1.
- Every ticker is a clickable link to its Finviz daily stock chart.
- Strategy settings (exit target and drawdown levels) are moved to **Settings** together with Backend URL and Data Sources.
- Settings button text is explicitly white for readability on the dark header.
