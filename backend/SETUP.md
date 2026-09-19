# Backend setup — Cloudflare Worker

## 1. Create an Alpha Vantage API key

Create an API key at Alpha Vantage and keep it private.

The Worker uses the `TIME_SERIES_DAILY` endpoint with `outputsize=compact`, which provides enough recent daily observations for the 60-trading-day calculation.

## 2. Install Wrangler

Install Node.js first, then:

```bash
npm install -g wrangler
```

Log in:

```bash
npx wrangler login
```

## 3. Deploy the Worker

Open a terminal in the `backend` folder:

```bash
cd backend
npx wrangler deploy
```

Wrangler will show the Worker URL, for example:

```text
https://swing-signal-backend.YOUR-SUBDOMAIN.workers.dev
```

## 4. Add the API key as a secret

Do NOT put the key in `wrangler.toml`.

Run:

```bash
npx wrangler secret put ALPHA_VANTAGE_KEY
```

Paste your Alpha Vantage key when prompted.

Then redeploy:

```bash
npx wrangler deploy
```

## 5. Test the backend

Open:

```text
https://YOUR-WORKER.workers.dev/api/health
```

You should receive:

```json
{"ok":true,"service":"swing-signal-backend"}
```

Then test:

```text
https://YOUR-WORKER.workers.dev/api/scan?symbols=NVDA,AMD,MU
```

## 6. Connect GitHub Pages

Open the GitHub Pages version of the frontend.

Paste the Worker URL into:

`Backend URL`

Click:

`Запази настройки`

Then click:

`Обнови`

## Important

GitHub Pages is only the frontend. The API key remains in the Cloudflare Worker secret.

Do not commit `.env`, `.dev.vars`, API keys, or tokens to GitHub.
