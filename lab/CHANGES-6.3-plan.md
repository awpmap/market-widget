# MW 6.3: Game plan (lab/plan.js)

The trader's prep sheet for today: what levels and events matter, so no move is a surprise. Information only: no buy or sell calls.

## What it shows
- **Next up**: cards for the next big events (FOMC decision, CPI, jobs report, PCE, GDP, retail sales, monthly options expiration, quad witching, earnings of your tickers) with a live countdown ("CPI in 1 d 3 h"), a TODAY badge on event days, and a Fed colour so FOMC days stand out (day 1 of the meeting, the 2:00 PM ET decision, "projections" when the meeting brings new dot-plot numbers). The closed section's header carries the same countdown.
- **Session bar**: pre-market, open, morning, lunch, afternoon, power hour, after hours (early closes handled), a now marker and today's timed events as pins. Nasdaq's planned overnight session (from Sun 2026-12-06, 9 PM ET, subject to SEC approval) shows as a note and in the calendar.
- **Key levels** (Mine / Index / All; SPY and QQQ are the index set): prior-day high, low, close; pre-market high and low; opening range (first 5 and 15 minutes, once complete); today's VWAP; 20-day and 52-week high and low. Each row has a compact ladder (ticks and a price marker), the nearest level above and below with dollars then percent, and up to four labels: "Broke PDH", "Broke OR high", "Inside opening range", "Above VWAP", "Near PM high" (within 0.5%), "At 52-week high", and live crossings ("Lost VWAP", "Reclaimed VWAP", "Back under PDH", shown for 30 minutes, remembered in this window only). Every label and level has a one-sentence tooltip. Click a row for every level in order. "Needs a look" keeps only rows near a level or that just crossed one. Rows stay in a stable order and are updated in place.
- **Calendar**: next 14 or 30 days, grouped by day, in your time zone (Settings → time zone). Earnings are grouped by day and before-open / after-close, your tickers bold, chip bellwethers muted. Market holidays and early closes from MW's NYSE calendar.

## Official sources (dates read 2026-11-24, stored with their source in `E.PLAN_SOURCES`)
| Event | Source |
|---|---|
| FOMC decisions, 2026 | federalreserve.gov/monetarypolicy/fomccalendars.htm |
| FOMC 2027 and Jan 2028 (tentative) | same page, and the Fed press release of 2026-11-12 (federalreserve.gov/newsevents/pressreleases/monetary20261112a.htm). Oct 26-27, 2027 is a strategy meeting with no decision; the 2027 decision is Nov 17 |
| FOMC minutes | not posted yet for the Dec 8-9 meeting; the page says so |
| CPI, PPI, jobs report | bls.gov/schedule/news_release/cpi.htm, ppi.htm, empsit.htm (8:30 AM ET) |
| GDP, PCE | bea.gov/news/schedule/full (2026), bea.gov/news/schedule/next-year (2027), 8:30 AM ET |
| Retail sales | census.gov/economic-indicators/calendar-listview-2026.html (2026), census.gov/retail/release_schedule.html (2027), 8:30 AM ET |
| Options expiration, quad witching | computed: third Friday, the Thursday before when it is an NYSE holiday (Juneteenth in 2026 and 2027) |

A schedule that ends inside the window (or is not published) is listed under "Not published yet, so not listed". When the table runs out, refresh it from these pages.

## Data and call budget (free only; nothing runs while the section is closed or hidden: `secLive("plan")`)
- Alpaca daily bars (IEX): one call per 25 tickers (about 250 bars each), once per session day (and once after the close, when yesterday becomes today), only for tickers MW's Twelve Data history cannot answer.
- Alpaca 5-minute bars: one call per phase: pre-market so far (every 5 min before 9:30), pre-market done (9:31), 5 minutes done (9:36), 15 minutes done (9:46). Opening late takes one call that has everything.
- Alpaca snapshot (VWAP): one call per 100 tickers every 30 s while the market is open.
- Earnings, 52-week ranges, prices: what MW already loaded (`earn`, `erInfo`, `metrics`, `lastPx`); nothing fetched twice.
- No Alpaca key: prior-day, 20-day and 52-week levels from MW's own history and a friendly note; no Alpaca calls at all. No Finnhub key: earnings rows say so.
- The section starts closed the first time (one-time flag `settings.planInit`), so existing fetch-count checks stay valid.

## Limits
- Alpaca levels come from IEX (one exchange), so highs and lows can differ from the full market by a few cents; Twelve Data levels are all-exchange and win when loaded.
- IEX may have no trade in a thin ticker's first minutes: that opening-range level is then left out, not guessed.
- Crossing labels need the window open (they compare consecutive looks); they are lost on reload.
- Up to 40 tickers are shown.
- Engine: `E.PLAN_*`, `E.plan*` in lab/engine.js (PLAN region), tests in labdev/test/plan.test.mjs. Browser: PLAN HARNESS region. Debug hook: `window.mwPlanCalls()` counts this section's Alpaca calls.
- Found while checking: the older macro table `E.MACRO_DATES.fomc` still lists 2027-10-27 and 2027-12-08; the Fed's revised list has no December 2027 meeting (Nov 16-17) and Oct 26-27 is a no-decision strategy meeting. That table is outside this lane and is not changed here.
