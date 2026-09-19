# Swing Signal Monitor

Version 1.0

GitHub Pages frontend + Cloudflare Worker backend.

## Purpose

Displays current price data for a watchlist and applies configurable swing-monitoring rules:

- 60-trading-day high
- drawdown from that high
- entry observation levels: -5%, -8%, -10%
- position target: +10%
- local storage for optional entry prices

The interface presents signals as informational monitoring states, not automatic orders.

## Frontend

Upload the project files to a GitHub repository and enable GitHub Pages.

Set the deployed Cloudflare Worker URL in the `Backend URL` field.

## Backend

The backend uses Alpha Vantage for daily market data. The API key stays server-side as a Cloudflare Worker secret.

See `backend/SETUP.md`.

## Security

Never put the Alpha Vantage key in `app.js`, `index.html`, or any GitHub Pages file.
