# Capital One Retail Bank Intelligence Platform — POC

A working, static, front-end proof of concept for the 8-tab dashboard framework described in the full platform writeup. All numbers on every tab are computed from a synthetic dataset (75,000 accounts, 300,000 interactions, 200,000 transactions) — not hardcoded placeholders. See `data/summary.json` for the pre-aggregated source.

**Live demo:** _add your GitHub Pages link here after deploying (see below)_

## What's here

| Tab | What it shows |
|---|---|
| Overview | KPI tiles vs. targets, portfolio risk distribution, complaint rate by channel |
| Digital | Digital banking volume, CSAT, and cost by interaction type |
| Branch/Café | Branch volume, duration, and cost by interaction type |
| Contact Center | Complaint/fraud handling highlighted against Ch9's efficiency quadrant |
| Payments | Volume and value by payment type, decline rates |
| SMB & Risk | Two full worked examples: a 5-dimension risk score breakdown and a relationship cheat sheet |
| Growth | Product adoption funnel and state-level market classification |
| Team | Composite analyst ranking — "hidden talent" vs. "volume trap" personas |

## Running locally

This is a static site with no build step. It fetches `data/summary.json` client-side, which means it needs to be served over HTTP (not opened directly as a `file://` URL, since browsers block `fetch()` on local files).

```bash
cd capital-one-intelligence-platform
python3 -m http.server 8000
# then open http://localhost:8000 in a browser
```

Any static server works (`npx serve`, VS Code's Live Server extension, etc.) — the Python one-liner above just needs no setup.

## Deploying to GitHub Pages

1. Create a new repo on GitHub (public, so Pages can serve it on the free tier).
2. From this folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Capital One Retail Bank Intelligence Platform POC"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Source → Deploy from a branch → `main` / `(root)` → Save.**
4. Your live link will be `https://<your-username>.github.io/<repo-name>/` — it can take a minute or two to go live after the first push.

## Data & disclaimer

All account IDs, customer names, financial figures, and personnel names in this project are synthetic and fictional, generated for portfolio demonstration purposes only. No real Capital One data, systems, or personnel are represented.

## Tech

Vanilla HTML/CSS/JS, [Chart.js](https://www.chartjs.org/) via CDN. No build step, no framework, no backend — chosen deliberately so it deploys to GitHub Pages with zero configuration.
