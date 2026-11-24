# MW Beta 6.3: arrange your sections, and Market pulse

Two parts: you place the sections yourself, right on the main screen, and a new section, **Market pulse**, reads
risk-on or risk-off from the market's internals.

## 1. Arrange the sections on the main screen

- **Drag a section by its header.** With a mouse or pen, press anywhere on a header and move; on a touch screen,
  hold the ⠿ grip that sits at the header's left edge (it shows when you point at or focus the header). A slim copy
  of the header follows the pointer and a blue line shows where it will land ("Above Watchlist", "Bottom of the
  right column"). The page doesn't shift under you while you drag; it scrolls when you near the top or bottom edge.
  Esc cancels. A plain click on a header still opens or closes the section; a drag never does.
- **Real columns in a wide window.** At 900 px and up MW shows 2 columns (3 from 1320 px). Until 6.2 the sections
  took turns across the columns. Now a section stays in the column you put it in, at the height you put it.
- **Keyboard.** Focus a section header (Tab) and press Alt + ↑ or ↓ to move it, and Alt + ← or → to move it to the
  next column. Each move is announced to screen readers and shown in a short message.
- **Arrange mode.** ⋯ menu → Arrange sections (or Ctrl+K → "Arrange"). Every section shrinks to its header so the
  whole board fits on screen, with a bar: drag hints, presets, hidden sections (click one to show it again) and
  Done (or Esc). Nothing is fetched while you arrange.
- **Presets.** *Trading day*: In-play radar, Market pulse, Watchlist and News first, Portfolio further down.
  *Long-term*: Portfolio, Markets, Market pulse and News first. *Default*: the original order, every section shown.
  Undo puts back what you had. Also in Ctrl+K ("Layout: …") and Settings → Layout.
- **Settings → Layout** shows the arrangement the window is using: the columns side by side in a wide window (drag
  rows between them, or use ↑ ↓ ← →), the single list in a narrow one. Each row shows the number key (1 to 9) that
  jumps to it. *Reset to default* resets both the narrow order and the columns.
- Keys 1 to 9 follow what you see: across the top row of the columns first, then the next row.
- Compact view, the sticky headers, collapse, hide and the "Try the beta" copy all keep working.

### How the arrangement is stored

- `settings.layout`: the one-column (narrow window) order, as before.
- `settings.board`: `{"2": [[keys], [keys]], "3": [[keys], [keys], [keys]]}`, one arrangement per column count, saved
  the first time you move a section in a window of that width. Both are copied by "Try the beta" and kept in backups
  that include settings.
- Rules (`E.boardCols`, tested):
  - Never arranged: the visible sections take turns across the columns in the one-column order (the 4.7 rule).
  - Arranged for 3 columns but the window shows 2: the third column goes under the second. Arranged for 2 but the
    window shows 3: the 2-column board is dealt across 3 in its reading order. A board for the current column count
    always wins.
  - A section that is in no column yet (a new section in a later version) goes at the end of the shortest column.
  - A hidden section keeps its slot, so showing it again puts it back where it was. A column with nothing showing
    gives its room to the others, and comes back as a drop zone while you drag or arrange.
- Only the sections that are out of place are moved in the page (`E.minMoves`, the longest run already in order
  stays put), so a box you are typing in never loses the focus because another section moved.

## 2. Market pulse

A pro's risk-on / risk-off dashboard in one glance. Markets already has the indexes, the sector heatmap and the
tiles; the pulse reads what sits underneath them. **An indicator, not advice.**

| Line | What it compares | Why it matters |
|---|---|---|
| Chips vs S&P 500 | SMH / SPY | Chips leading means the AI-hardware trade is in charge. |
| Nasdaq vs S&P 500 | QQQ / SPY | Big growth and tech names leading the market. |
| Small caps vs S&P 500 | IWM / SPY | Small caps lead when investors reach for risk. |
| High beta vs low vol | SPHB / SPLV | The S&P 500's most volatile stocks against its calmest: the plainest risk read. |
| Discretionary vs staples | XLY / XLP | Shopping, travel and cars against food and household goods: consumer risk appetite. |
| Junk bonds vs Treasuries | HYG / IEF | High-yield beating Treasuries means credit markets are at ease with risk. |
| Volatility | VIXY | VIX futures: rising means traders pay up for protection. |
| US dollar | UUP | A firmer dollar tightens money worldwide. |
| Bitcoin | BTC/USD | Speculative appetite, around the clock (change since 00:00 UTC). |
| Long bonds, Gold, Oil | TLT, GLD, USO | Context only, not scored. |
| Breadth | the 11 S&P sector funds | How many are up today; how many trade above their 20-day average. |

Each pair shows how the first fund did against the second: **1D** (today, or the last session while the market is
closed), **5D** (5 sessions, today counting as one, the rule MW uses everywhere) and **20D**, plus the 20-session
line of the ratio in windows wide enough for it. These are relative moves, so they are percents only. The
cross-asset tiles are prices, so they show the price, then the change in dollars for one share, then the percent.
Click a pair (or a tile) for the chart of its first fund. Every line explains itself on hover or focus.

### Method: the Risk appetite reading (`E.pulseScore`)

1. Each line becomes a reading from −1 to +1: its move divided by a typical move for that line, capped at ±1.
   - Pairs: the typical moves are, for today / 5 days / 20 days: chips and high beta 1.2% / 3% / 6%, Nasdaq
     0.5% / 1.5% / 3%, small caps and discretionary 0.8% / 2% / 4%, credit 0.3% / 0.8% / 1.5%. A pair's reading is
     50% today, 30% 5 days, 20% 20 days (re-weighted over the parts that are known; a pair with only part of them
     counts for less).
   - Volatility: −(today's % change) / 4%. Dollar: −(today's %) / 0.4%. Bitcoin: (today's %) / 3%.
   - Sectors up today: (up − down) / 11. Above the 20-day average: (2 × above − 11) / 11.
2. Weights: high beta and credit 1.25, chips, small caps, discretionary, volatility, sectors up and sectors above
   average 1 each, Nasdaq 0.75, dollar and bitcoin 0.5. Gold, oil and long bonds don't count.
3. Risk appetite = 100 × the weighted average of the readings that are known, rounded: −100 (risk-off) to +100
   (risk-on). With less than 40% of the total weight known there is no reading ("Not enough data").
4. Labels: +40 and up *Strong risk-on*, +15 *Risk-on*, between −15 and +15 *Mixed*, −15 and below *Risk-off*, −40
   *Strong risk-off*.
5. The one-line verdict names the (up to) three lines pushing hardest in the reading's direction, worded together
   where they share a verb ("Risk-on: high beta, small caps and credit leading"; "Risk-off: chips lagging,
   volatility rising"). A Mixed reading names the strongest line on each side ("chips leading, but credit
   lagging").

### Data and call budget

Nothing is fetched while the section is closed, hidden, in compact view, in Arrange mode or while the window is
hidden. Closed, its header still shows a reading worked out from the prices MW already has for Markets (at no cost).

| Source | When | Calls |
|---|---|---|
| Alpaca snapshots (free IEX feed, your key) | every fund (24) in one call: every 20 s in market hours, pre-market and after hours; every 10 min while closed | at most 3 a minute (Alpaca's free limit is about 200) |
| Alpaca daily bars | 24 funds, about 45 days, once a day (kept in this browser) | 1 a day |
| Alpaca crypto snapshots (no key needed) | bitcoin, every 30 s (every 2 min while stocks are closed) | 2 a minute at most |
| Without Alpaca: Finnhub `/quote` | one fund every 3 s, only funds MW isn't already pricing fresh, through MW's shared limit (background lane) | about 20 a minute at most, usually far fewer |
| Without Alpaca: Twelve Data daily history | MW already loads it for most of these funds; the pulse asks once a day for the few it doesn't | about 3 credits a day |

On errors the snapshot calls back off (30 s, doubling, up to 10 minutes; 10 minutes when the keys are refused). The
footer says where the prices come from, and its tooltip counts the calls in the last minute.

Without any key the section says so: "Add your free Alpaca key for the pulse", with a button to Settings. A
Finnhub key alone works too (slower, and the 5- and 20-day figures need Alpaca or Twelve Data).

The section starts closed the first time (so a first look costs no calls); open it once and it stays open.

### Limits

- IEX is one exchange, so Alpaca's prices are a close guide to the whole market, not the consolidated tape.
- VIXY tracks VIX futures, not the VIX itself (the index isn't free).
- Before the open the 1D figures are the last session's, and they say so.
- Weights and typical moves are judgment calls, chosen so an ordinary day lands between −40 and +40; they are in
  `E.PULSE` in `lab/engine.js`.

## Files

- `lab/app.js`: the layout code (`applyLayout`, `boardDrag`, `secMoveTo`, `secKeyMove`, Arrange mode, presets,
  Settings → Layout); `board` added to the settings "Try the beta" copies and to backups.
- `lab/index.html`: section, drag and Arrange-mode CSS.
- `lab/pulse.js`: the Market pulse section (its CSS is injected from there, prefix `pulse-`).
- `lab/engine.js` (PULSE region): `E.boardCols`, `E.boardRead`, `E.boardMove`, `E.boardStep`, `E.boardDeal`,
  `E.minMoves`, `E.PULSE`, `E.pulseSyms`, `E.pulseRel`, `E.pulseBack`, `E.pulseTrend`, `E.pulseBreadth`,
  `E.pulsePhrase`, `E.pulseScore`.
- Tests: `labdev/test/pulse.test.mjs` (15); browser checks in the PULSE HARNESS region of `labdev/harness/browser.mjs`.
