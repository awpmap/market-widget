# Market Widget

A small desktop market app: portfolio summary, sector heatmap, watchlist with price alerts, and intraday dip alerts. A static web page (index.html, app.js, engine.js) plus an app manifest, so Edge or Chrome can install it as a standalone app.

- Data: the free Finnhub API with your own key (60 calls a minute), plus an optional free Twelve Data key for history, fund prices and backup prices.
- Source: the beta lives in `lab/` (branch `lab`, served at /lab/). `labdev/promote.mjs` on that branch turns it into the regular version at the site root; edit `lab/`, not the root files.
- Privacy: your key, holdings and alert rules are stored only in your browser. Nothing personal is in this repository.
- Information only. It never places trades.

## Windows app

`app/` holds a small Windows tray app (Tauri) around the hosted widget: it starts with Windows, closing the window keeps it in the tray so alerts keep running, Ctrl+Alt+M shows or hides it, and alerts arrive as Windows notifications. The widget inside is the same hosted page, so it updates on its own.

Installers are built by GitHub Actions and published on the Releases page whenever the app version in `app/src-tauri/tauri.conf.json` changes. The app isn't code-signed, so Windows SmartScreen asks once: More info → Run anyway.
