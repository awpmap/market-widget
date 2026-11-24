# MW 6.3.0: arrange your screen, plus three trader sections

Built by three builders in parallel, each in its own file; details in the lane notes:

- **Arrange sections on the main screen** and **Market pulse**: [CHANGES-6.3-pulse.md](CHANGES-6.3-pulse.md) (lab/pulse.js, layout code in lab/app.js)
- **In-play radar**: [CHANGES-6.3-radar.md](CHANGES-6.3-radar.md) (lab/radar.js)
- **Game plan** (key levels and catalyst calendar): [CHANGES-6.3-plan.md](CHANGES-6.3-plan.md) (lab/plan.js)

Shared groundwork: `registerSection()` and `secLive()` in lab/app.js let a section live in its own file, join Settings → Layout and keys 1 to 9, and fetch only while it is open on screen.

Also fixed: the 2027 FOMC dates in the Markets calendar now follow the Fed's revised schedule (press release of 2026-11-12): Oct 26-27 is a strategy-only meeting with no decision, and the last 2027 decision is Nov 17.

Data stays free: Alpaca IEX (your free key), Alpaca crypto (no key), Finnhub and Twelve Data free tiers. The three new sections start folded the first time, so they cost nothing until you open them. Information only: MW never trades.

## 6.3.1
- Fixed an update loop right after a release: "Reload now" could bring back the old version (the browser's 10-minute cache or GitHub's CDN answered first) and ask again. MW now re-downloads every file past the caches before reloading, retries at most three times a minute apart, and otherwise says GitHub is still publishing the update and finishes by itself.

## 6.3.2
- Section headers update their stuck-at-the-top state straight from the scroll, so it can never stay stale on a busy or background window.
