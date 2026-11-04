# Market Widget

A small desktop market app: portfolio summary, sector heatmap, watchlist with buy levels, and intraday dip alerts. One HTML file plus an app manifest, so Edge or Chrome can install it as a standalone app.

- Data: the free Finnhub API with your own key (60 calls a minute).
- Privacy: your key, holdings and alert rules are stored only in your browser. Nothing personal is in this repository.
- Information only. It never places trades.

## Windows app

`app/` holds a small Windows tray app (Tauri) around the hosted widget: it starts with Windows, closing the window keeps it in the tray so alerts keep running, Ctrl+Alt+M shows or hides it, and alerts arrive as Windows notifications. The widget inside is the same hosted page, so it updates on its own.

Installers are built by GitHub Actions and published on the Releases page when a tag like `app-v1.0.0` is pushed. The app isn't code-signed, so Windows SmartScreen asks once: More info → Run anyway.
