# Swing Signal Monitor

Version 1.1

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
- repeated refreshes normally use cached data and do not call Alpha Vantage again;
- duplicate symbols are removed;
- scans are limited to 10 symbols;
- when Alpha Vantage reports a rate limit, the Worker stops making additional upstream requests for the remaining symbols;
- rate-limit and data errors are reported per symbol instead of being mislabeled as missing daily data.

Because Alpha Vantage data is daily, a multi-hour cache is intentional. It is not an intraday market-data feed.

## Frontend

Deploy the repository with GitHub Pages and set the Cloudflare Worker URL in the Backend URL field.

## Backend

The Worker is configured in `backend/wrangler.toml`.

Required runtime secret:

`ALPHA_VANTAGE_KEY`

Do not put the Alpha Vantage key in frontend files or commit it to GitHub.

## Important

The free Alpha Vantage plan has request limits. The cache reduces repeated requests but does not increase the provider's daily allowance.
