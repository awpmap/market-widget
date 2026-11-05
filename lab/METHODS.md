# How MW Lab makes its numbers

MW Lab is a test copy of Market Widget. This page says, for every number it shows, where the data comes from and how it is worked out. All code is in `lab/engine.js` (pure functions, tested in `labdev/test/`). MW Lab is information only: it never trades and never connects to a brokerage.

## Data sources

| What | Source | Notes |
|---|---|---|
| Live prices | Finnhub `/quote` (free key) | Price, day change, high, low, previous close, last trade time. |
| Backup prices | Twelve Data `/quote` (free key) | Only for holdings and watchlist tickers, only when Finnhub has failed. Rows show "backup" in their tooltip. |
| Daily history | Twelve Data `/time_series`, up to about 5 years | Loaded once a day before the open; failed loads retry after 5, 15 and 45 minutes. Kept in the browser (IndexedDB), never uploaded. |
| Earnings dates | Finnhub calendar | |
| Fund holdings (look-through) | Pasted by you from the fund issuer's site | Twelve Data's fund composition is a paid feature, so MW Lab doesn't fetch it. |

Every price row has a tooltip naming its source and how old the last trade is.

## When a price may raise an alert

A price can trigger an alert only when **all** of these hold:

- the market is open, by MW Lab's NYSE calendar (holidays and 1 pm early closes through 2028, checked against the `exchange_calendars` XNYS calendar in CI);
- the quote was fetched in the last 15 minutes;
- the last trade is from today and at most 20 minutes old (trade time, not fetch time);
- the quote passes the bad-print screen below.

After 2028 the calendar reports "unknown" and alerts stop, instead of guessing.

**Bad-print screen.** A quote is rejected if the price is missing or zero, if its % change disagrees with price ÷ previous close by more than 0.5 points, or if the day high is below the day low. A jump bigger than the *jump limit* since the last refresh (or 1.5× that limit from yesterday's close for the first price of the day) is held, not used, until the next refresh agrees within 2%. Jump limit = the larger of 6 normal days' moves and 8% for a stock (4% for a broad ETF).

**Level check.** A buy level more than 3× above the price, or under a third of it, gets a "check levels" chip (a split or a typo).

## Volatility ("a normal day")

From daily closes, simple returns:

- **σ (the one alerts use):** exponentially weighted (RiskMetrics, λ = 0.94) over the last 250 days, seeded with the first 20 days. Falls back to the plain 60-day standard deviation when there is too little history.
- **Robust check:** 1.4826 × median absolute deviation over 250 days (ignores a few huge days).
- **Tail quantiles:** the 2nd and 5th percentile daily return over 250 days (shown when there are at least 100 days).
- **ATR:** Wilder's 14-day average true range, used for auto levels.

## Alert rules

One registry (`E.RULES`) defines every rule; the live check, the rule lab and the scorecard all read it.

| Rule | Fires when |
|---|---|
| Buy level | Price at or under one of your levels (or auto levels). The deepest level hit is named. |
| Fast drop | Down N% from the highest price of the last M minutes. Re-arms after the price bounces half the drop off its low. Needs the window mostly covered by refreshes. |
| Red day | Down at least N% on the day. |
| Unusual drop | Day change ÷ σ is at or under −N. |
| Off today's high | N% under today's high. |
| Off 52-week high | Just crossed N% under the 52-week high (once per crossing). |
| VWAP reclaim | Off unless you turn it on. Flushed at least max(2%, σ) under the anchored VWAP, then climbed back over it. |
| Near a level | Heads-up only: within N% above the next level. Never loud, never journaled. |

**Bundling.** At most one loud alert per ticker per 15 minutes, unless a new level breaks or the price drops another leg (the fast-drop % doubled each leg, three legs at most). Other rules that fired at the same moment are listed as "also …".

**Auto levels.** Three levels at 1, 2 and 3 ATRs under the last close, each snapped to a nearby swing low or 20/60-day low when one is within 0.4 ATR. The first is at least 3% under the close, each next one at least 5% under the one before.

## Phone alerts (ntfy)

By default a phone alert says only "MW Lab has a new alert. Open MW Lab for details." under the title "MW Lab alert". Tickers and prices are sent only if you switch on "Full details on the phone", because ntfy topics are public to anyone who guesses the name.

## Health

- **Coverage:** of the watchlist tickers that are switched on, how many got a new price within max(3 minutes, 2.5 refreshes).
- **Blind:** coverage under 50% for 5 minutes in market hours. MW Lab shows a red banner, beeps, and sends a phone notice; it says so again when prices come back.
- **Outside check (optional):** with a free Healthchecks.io URL, MW Lab pings it every 4.5 minutes while open and pings `/fail` while blind. Suggested schedule `*/10 10-15 * * 1-5`, America/New_York, 20-minute grace, so you hear about it when MW Lab isn't running at all.
- **Finnhub breaker:** after 3 failures in a row, Finnhub calls pause for 1, 2, 4 … up to 15 minutes; one success resets it.

## Twelve Data budget

The free plan allows 800 credits a day. MW Lab gives each feature its own share so one can't starve the others: history 300, VWAP 220, backup prices 120, intraday 60, fund NAVs 40, cross-checks 40, other 20. A call is refused once its share is used or the day is within 10 of 800. The status panel shows today's use and an end-of-day projection (history counted once, the rest scaled by how much of the session has passed). Credits are counted per app: if MW and MW Lab both run with the same key, they share the same 800.

## Portfolio risk

For holdings with at least 60 days of history, aligned on common dates:

- **Normal day:** σ of the current mix's daily return over the last 252 days × your total, in $.
- **Bad day (VaR 95%):** the 5th percentile of the current mix's daily return over 252 days, in $. **Average bad day (ES 95%):** the mean of the days at or below it.
- **Worst drawdown:** the largest peak-to-trough fall of *today's mix* replayed over all common history (a "what if I had held this mix", not your actual past).
- **Share of risk:** each holding's weight × its covariance with the mix ÷ the mix's variance. **Effective bets:** 1 ÷ the sum of squared risk shares.
- **Beta** to SPY and SMH: regression of the mix's daily return on each.

## Fund look-through

Each fund's dollars are split into its holdings using the weights you pasted; direct holdings add on top. The table shows each company's total, how many places it comes from, and how much of each fund was not listed.

## Buy sizing (optional)

Amount per level = your base amount × (reference σ ÷ the ticker's σ), kept between 0.5× and 2× and rounded to $5. A warning shows when the buy would take the position over your concentration cap (25% by default).

## Rule lab

Replays the daily rules (red day, unusual drop, off today's high, off 52-week high, auto levels) over the stored history, starting after the first 260 days. A fill is the rule's trigger price, or the open if the day gapped through it. Each rule's average and median return and hit rate are shown 5, 20 and 60 sessions later, next to buying at every close and buying at the open on the first trading day of each month. Each auto level fills at most once per 20 sessions. Intraday rules can't be replayed from daily bars. Price returns only; past results don't predict the next alert.

## Journal and scorecard

Every loud alert is recorded (time, price, source, trade time, rule settings). Mark it Bought or Skipped. After 1, 5 and 20 sessions the outcome is filled from daily closes, plus the worst close within 20 sessions. The scorecard groups by rule. Kept in the browser only.

## Cross-asset tone

A heuristic, not a signal. Each input is scaled by its own normal daily move (capped at ±3) and weighted: stocks today (SPY, QQQ) 1.0, stocks over 5 days 0.5, volatility (VIXY, inverted) 0.7, credit vs Treasuries (HYG − IEF) 0.7, chips vs S&P (SMH − SPY) 0.4, dollar (UUP, inverted) 0.3, breadth (RSP − SPY) 0.3. The label switches to risk-on or risk-off past ±1.5 and back to mixed inside ±0.75, so it doesn't flip back and forth.

## Settings history

Every saved change keeps a copy (the last 30; edits of the same kind within 10 minutes replace the newest copy). Restore any of them from Settings → Backup. A setup link always shows what it would change and asks first.
