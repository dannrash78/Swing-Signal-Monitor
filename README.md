# Swing Signal Monitor

Version 1.3

GitHub Pages frontend + Cloudflare Worker backend.

## Purpose

Informational swing-monitoring tool for a configurable watchlist.

Current rules:

- 60-trading-day high
- drawdown from that high
- observation levels: -5%, -8%, -10%
- position target: +10%
- optional entry prices stored locally in the browser

The interface presents monitoring states, not automatic orders or financial advice.

## API quota protection

The backend uses Alpha Vantage daily data and keeps the API key server-side as a Cloudflare Worker secret.

To reduce free-plan API usage:

- successful symbol results are cached at the Worker for 6 hours;
- duplicate symbols are removed;
- scans are limited to 10 symbols;
- when Alpha Vantage reports a rate limit, the Worker stops making additional upstream requests for the remaining symbols;
- rate-limit and data errors are reported per symbol;
- the frontend sends requests only for stocks selected with the Update checkbox;
- opening or refreshing the page does not call the scan API.

## Frontend

- Each watchlist stock has a checkbox controlling whether it is included in the next Update.
- The selected stock list is saved in browser local storage and restored when the page is reopened.
- Update requests only the selected symbols.
- Check Health calls <Backend URL>/api/health and displays the HTTP status and returned result. It does not call Alpha Vantage.
- Last received symbol results are kept locally so reopening the page does not require a new API request.

## Backend

The Worker is configured in backend/wrangler.toml.

Required runtime secret:

ALPHA_VANTAGE_KEY

Do not put the Alpha Vantage key in frontend files or commit it to GitHub.

## Important

The free Alpha Vantage plan has request limits. The cache reduces repeated requests but does not increase the provider's daily allowance.

## Version 1.3

- Selective API requests per stock.
- Persistent stock-selection checkboxes.
- No automatic scan on page load.
- Manual Update button.
- Manual Check Health button.
- Health result shows URL, HTTP status and response.
- Last received results are stored locally.
