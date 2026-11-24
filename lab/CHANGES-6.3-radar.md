# MW 6.3: the in-play radar

A new section, **In-play radar**: which stocks are in play right now. It scans your watchlist and holdings plus
about 150 liquid US stocks and funds and ranks them by **relative volume**: today's volume so far against what is
normal for that ticker by this time of day. MW's own backtests found that most day-trading setups stop working once
real costs are counted, and that high relative volume was the one filter that held up for choosing what to look at.
The radar is built around that and says so on the screen: it shows where the attention is, not which way to trade.

The section starts closed the first time (its header says "Open to scan"). Opening it is what starts the scan;
after that it stays the way you leave it.

## What it shows
- **In play**: the ten busiest tickers by relative volume (Show the top 25 for more). A slim line says so when
  the tape is quiet and nothing is at even 1.5 times its usual volume.
- **Leaders / laggards**: today's move against SPY's, five leading and five lagging (ten each on request), each
  with the gap to SPY in percentage points.
- **Mine**: only your watchlist and holdings.
- **Each row**: ticker (a dot marks your own), a volume bar with the multiple (the notch is 1×, a full bar is 5×;
  blue from 2×, amber from 5×), the price, and the day's change in dollars for one share and in percent, the same
  pill as everywhere else in MW. Hover the change for where it opened and how it has done since the open.
  Click a row for its chart; **+** adds the ticker to your watchlist. Rows work from the keyboard (↑ ↓, Enter).
- **Tags**, each with a one-sentence explanation on hover:
  Volume surge · Earnings today / Earnings after close / Just reported · News · Unusual volume (2× and up) /
  Extreme volume (5× and up) · Gap up or down holding / fading / filled · New 52-wk or 20-day high or low ·
  Range N× ATR (1.5 and up) · Above / Below VWAP · After hours ±N% · No trade yet today.
- **Filters** (the funnel): a lowest price, and a lowest dollar volume traded on IEX this session.
- **Sessions are labelled.** Market open: live. Pre-market: volume has not started counting, so the list is ranked
  by the move since the last close, the columns are relabelled, gappers are tagged Gapping up / down and a ticker
  that traded heavily the day before says so. After hours: the day's final ranking, with after-hours moves tagged.
  Closed: "Last session · Fri, 11/13", read once and then left alone.

## The scope (the new idea)
A small chart above the list plots every ticker once. Sideways is today's change (losers left, winners right; the
dashed line is SPY, so a dot to its right is beating the market). Upward is volume against usual, on a log scale;
the shaded band above the 2× line is "in play". Your own tickers wear a ring, the busiest ones and yours are named,
and hovering a row lights its dot. One glance answers "is anything moving on real volume, and in which direction".

**Volume surges**: when a ticker's latest minute trades five times its usual pace for that minute (and at least
$50,000 on IEX), its dot pulses, its row gets a Volume surge tag for five minutes, and it is listed under the scope
for fifteen. This is a highlight on the screen only: nothing is sent to the phone or the desktop, and nothing
is added to Today's alerts.

## Calm rows
Prices follow every read (30 s). The order is redone once a minute, never while the pointer is moving over the list
or a button is held, and a ticker only passes its neighbour when it beats it by more than 10%, so near-ties don't
keep swapping. A row that does change place slides there. Changing the view, a filter or your tickers ranks at once.

## How relative volume is measured (and what is approximate)
Relative volume = today's volume so far ÷ (the ticker's 20-day average full-day volume × the share of a day's
volume that has normally traded by this minute).

The exact figure would compare against the 20-day average volume **at the same minute**, which needs 20 days of
minute bars for every ticker: far past the free limits. MW uses one fixed curve for "the share traded by this
minute" (`E.RADAR_CURVE`: 13% in the first half hour, 52% by 1:00 PM, 16% in the last half hour; a half day uses
the same shape, squeezed). So the number is **exact at the close and an estimate before it**; a ticker whose day
is shaped unlike the typical one reads a little high or low in the morning. In the first five minutes the expected
volume is floored at the five-minute figure, so early readings run low rather than wild.

Both volumes are **IEX's** (one exchange, a few percent of all US trading), compared like for like. A ticker with a
20-day average under 20,000 IEX shares a day, or under 10 sessions of history, is not measured (the cell shows —).

Other rules: a gap counts when the open is at least half the ticker's average daily range (14-day ATR) from the
previous close, never under 0.5% (2% when the range is unknown); holding = a third of the gap or less given back,
fading = more, filled = back to the previous close. Range = today's high to low, stretched to the previous close
when there was a gap, over the ATR. New highs and lows compare today's high and low with the 20 and 252 sessions
before today (a 52-week tag needs at least 200 sessions of history).

## Data and call budget (free plans only; nothing is fetched unless the section is open and on screen)
| What | Source | How often |
|---|---|---|
| Prices, volume, VWAP, last minute | Alpaca snapshots, IEX feed, your key; 100 tickers a call | 2 calls every 30 s in market hours, pre-market and after hours (4 a minute; the free limit is 200). Closed: one read after after-hours trading has ended, then none |
| 20-day volume, ATR, 20-day and 52-week highs and lows | Alpaca daily bars (about 380 days) | about 5 calls once a day, plus 1 when you add a ticker |
| Earnings today and yesterday | Finnhub earnings calendar | 1 call a day, in MW's background lane |
| News tag | the headlines MW already has (live tape and Finnhub) | no calls |

Kept on this PC: `radarQ` (the last read), `radarBase` (the daily figures, with their date), `radarEarn`, and your
view and filters in settings.

**Without an Alpaca key** the radar makes no calls. It lists your own tickers by today's move from the prices MW
already has, with gap, range, new-high and earnings tags where the data allows, and says what the key would add.
Finnhub's free quotes carry no volume, so the volume column stays blank and the scope is hidden.

## Limits
- Relative volume during the day is an estimate (see above); IEX is one exchange, so thin tickers are noisy or unmeasured.
- Pre-market and after-hours prices are IEX trades: a guide, not the whole market. Pre-market volume is not ranked.
- The fixed list (`E.RADAR_UNIVERSE`, 149 public tickers) is a judgment call and will age; a ticker Alpaca no longer
  knows is simply skipped. Anything on your watchlist or in your holdings is always scanned.
- Earnings tags outside your own tickers need the Finnhub key; the News tag only knows the headlines MW has loaded.
- Volume surges are noticed only while the section is open, from the one-minute bar in each 30-second read.
- Information only: no orders, sizes or trade calls.

## Files
`lab/radar.js` (the section; its CSS is injected from there), the RADAR region of `lab/engine.js` (pure math),
`labdev/test/radar.test.mjs` (21 tests), the RADAR HARNESS region of `labdev/harness/browser.mjs` (53 checks).
No changes to `app.js` or `index.html`.
