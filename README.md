# DropTrend GitHub Actions Unlimited Fetcher

This setup does not need a 24/7 backend server.
GitHub Actions fetches CJdropshipping products every 6 hours and writes `products.json`.
Your Netlify frontend can read `products.json` 24/7.

## What makes products not limited?

- The script uses pagination.
- Default `PAGE_SIZE` is 200.
- Default `MAX_PAGES` is 50.
- That means it can fetch up to 10,000 products per run if CJ API allows it.

You can increase/decrease limits in GitHub:
Repo → Settings → Secrets and variables → Actions → Variables

Add optional variables:

```env
MAX_PAGES=50
PAGE_SIZE=200
```

## Required GitHub Secrets

Repo → Settings → Secrets and variables → Actions → Secrets

```env
CJ_EMAIL=your_cj_email
CJ_API_KEY=your_new_cj_api_key
```

## Run manually

GitHub repo → Actions → Fetch CJ Products → Run workflow

After success, these files appear:

- `products.json`
- `products-meta.json`

## Frontend URL

Use this in your Netlify site API/products box:

```text
https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/products.json
```

## Important

Do not put CJ API keys in frontend HTML or JavaScript.
Only use GitHub Secrets.
