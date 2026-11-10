# How MW Beta makes its numbers

MW Beta is the beta version of Market Widget: turn it on in MW under Settings → General → Beta, and switch back from the same place in the beta. This page says, for every number it shows, where the data comes from and how it is worked out. All code is in `lab/engine.js` (pure functions, tested in `labdev/test/`). MW Beta is information only: it never trades and never connects to a brokerage.

## Data sources

| What | Source | Notes |
|---|---|---|
| Live prices | Finnhub `/quote` (free key) | Price, day change, high, low, previous close, last trade time. |
| Fast and extended-hours prices (optional) | Alpaca `/v2/stocks/snapshots`, free IEX feed (needs a free paper-account key in Settings → General) | Every ticker in one call: every 5 seconds in market hours, and in pre-market (from 4 AM ET) and after hours (to 8 PM ET) while MW is on screen; every 10 minutes when the market is closed. |
| Backup prices | Twelve Data `/quote` (free key) | Only for holdings and watchlist tickers, only when Finnhub has failed. Rows show "backup" in their tooltip. |
| Daily history | Twelve Data `/time_series`, up to about 5 years | Loaded once a day before the open; failed loads retry after 5, 15 and 45 minutes. Kept in the browser (IndexedDB), never uploaded. |
| Earnings dates | Finnhub calendar | |
| Mutual fund prices | Twelve Data `/quote` (free key); Finnhub is asked once a day in case it has the fund | One price a day (the NAV). The free feed posts it overnight, so the latest price is often one session behind. See "Mutual funds" below. |
| Headlines | Finnhub `/company-news` for your tickers (up to 24) and `/news?category=general` | Every 15 minutes, low priority. Kept on this PC. See "News" below. |
| Fund holdings (look-through) | Pasted by you from the fund issuer's site | Twelve Data's fund composition is a paid feature, so MW Beta doesn't fetch it. |

Every price row has a tooltip naming its source and how old the last trade is.

**The price shown is the latest known trade.** In market hours that is the regular price. Before and after them, with an Alpaca key, it is the latest pre-market or after-hours trade, marked "Pre" or "AH". Friday's last after-hours trade stays the price over the weekend, and the first pre-market trade replaces it. IEX is one exchange, so these prices are a close guide with thin trading. The day's % change, alerts and the portfolio's value stay on the regular session; the "Pre"/"AH" chip and the portfolio's after-hours line show the move against the close.

## When a price may raise an alert

A price can trigger an alert only when **all** of these hold:

- the market is open, by MW Beta's NYSE calendar (holidays and 1 pm early closes through 2028, checked against the `exchange_calendars` XNYS calendar in CI);
- the quote was fetched in the last 15 minutes;
- the last trade is from today and at most 20 minutes old (trade time, not fetch time);
- the quote passes the bad-print screen below.

After 2028 the calendar reports "unknown" and alerts stop, instead of guessing.

**Bad-print screen.** A quote is rejected if the price is missing or zero, if its % change disagrees with price ÷ previous close by more than 0.5 points, or if the day high is below the day low. A jump bigger than the *jump limit* since the last refresh (or 1.5× that limit from yesterday's close for the first price of the day) is held, not used, until the next refresh agrees within 2%. Jump limit = the larger of 6 normal days' moves and 8% for a stock (4% for a broad ETF).

**Price-alert check.** A price alert more than 3× above the price, or under a third of it, gets a "check alerts" chip (a split or a typo).

## Volatility ("a normal day")

From daily closes, simple returns:

- **σ (the one alerts use):** exponentially weighted (RiskMetrics, λ = 0.94) over the last 250 days, seeded with the first 20 days. Falls back to the plain 60-day standard deviation when there is too little history.
- **Robust check:** 1.4826 × median absolute deviation over 250 days (ignores a few huge days).
- **Tail quantiles:** the 2nd and 5th percentile daily return over 250 days (shown when there are at least 100 days).
- **ATR:** Wilder's 14-day average true range, shown as "Daily range" in a watchlist row's details.

## Alert rules

One registry (`E.RULES`) defines every rule.

| Rule | Fires when |
|---|---|
| Price alert | Price at or under one of your price alerts. The deepest one reached is named. |
| Fast drop | Down N% from the highest price of the last M minutes. Re-arms after the price bounces half the drop off its low. Needs the window mostly covered by refreshes. |
| Red day | Down at least N% on the day. |
| Unusual drop | Day change ÷ σ is at or under −N. |
| Off today's high | N% under today's high. |
| Off 52-week high | Just crossed N% under the 52-week high (once per crossing). |
| VWAP reclaim | Off unless you turn it on. Flushed at least max(2%, σ) under the anchored VWAP, then climbed back over it. |
| Near a price alert | Heads-up only: within N% above the next price alert. Never loud. |

**Bundling.** At most one loud alert per ticker per 15 minutes, unless a new price alert is reached or the price drops another leg (the fast-drop % doubled each leg, three legs at most). Other rules that fired at the same moment are listed as "also …".


## Phone alerts (ntfy)

By default a phone alert says only "MW Beta has a new alert. Open MW Beta for details." under the title "MW Beta alert". Tickers and prices are sent only if you switch on "Full details on the phone", because ntfy topics are public to anyone who guesses the name.

## Health

- **Coverage:** of the watchlist tickers that are switched on, how many got a new price within max(3 minutes, 2.5 refreshes).
- **Blind:** coverage under 50% for 5 minutes in market hours. MW Beta shows a red banner, beeps, and sends a phone notice; it says so again when prices come back.
- **Outside check (optional):** with a free Healthchecks.io URL, MW Beta pings it every 4.5 minutes while open and pings `/fail` while blind. Suggested schedule `*/10 10-15 * * 1-5`, America/New_York, 20-minute grace, so you hear about it when MW Beta isn't running at all.
- **Finnhub breaker:** after 3 failures in a row, Finnhub calls pause for 1, 2, 4 … up to 15 minutes; one success resets it.

## Twelve Data budget

The free plan allows 800 credits a day. MW Beta gives each feature its own share so one can't starve the others: history 280, VWAP 160, backup prices 120, fund prices 80, intraday 60, chart window 40, cross-checks 40, other 20. A call is refused once its share is used or the day is within 10 of 800. The status panel shows today's use and an end-of-day projection (history counted once, the rest scaled by how much of the session has passed). Credits are counted per app: if MW and MW Beta both run with the same key, they share the same 800.

## Mutual funds

A mutual fund has one price a day, the NAV, set after the 4 PM ET close. Twelve Data's free plan posts it overnight, so during the day and through the evening the newest official price is the session before. MW Beta handles that in four ways:

- **Which day.** Every fund row and the group header say which day the price is from ("priced Mon 1/5", or "as of 1/2" while a newer one is due). The official change is shown in a solid box only when it belongs to the session the rest of the screen is about; an older day's change is shown faded.
- **In the total.** A fund's official change is added to the portfolio's day change when its price is for that same session (`E.lastSessionDate`). Before 9:30 AM ET the screen shows the last session, so last night's fund prices count there.
- **Catching up.** Once a new price is due (`E.navDueDate`), MW Beta asks again every 45 to 60 minutes until it has it, and rests for 6 hours once it is up to date (`E.navWait`). When two sources answer, the newest date wins (`E.pickNav`); a second source more than 15% away from the first is ignored as a different security.
- **Estimate between prices.** Each fund's daily changes over the last 120 sessions are regressed on each index ETF MW Beta tracks (the market tiles plus IWF, IWD, EFV, EFG, MDY, AGG and VXUS). The ETF with the highest R² is the fund's stand-in (`E.proxyFit`). The estimate is beta × the ETF's move since its close on the day of the fund's last official price (`E.navEstimate`). It is shown only when R² is at least 0.60, always in a dashed box marked "est.", and it is **never added to the total**. It disappears when the official price arrives. Example: fund ABCDX has beta 0.90 to its ETF with R² 0.88; the ETF is up 2.0% since the fund's last price, so the estimate is +1.8%. Turn it off in Settings → Holdings.

A five-letter ticker ending in X in the Holdings table is treated as a mutual fund and priced the same way.

## News

One list for every headline: Finnhub company news for your holdings and watchlist (the last 3 days, up to 8 per ticker) plus general market news (the newest 20). The same story reported under several of your tickers is one line listing them (`E.newsMerge`, matched on the headline's words); the list holds up to 80 headlines from the last 4 days, newest first. A headline is "new" until you open it, for 24 hours. Read marks are kept on this PC. The ticker tags on a headline show that ticker's change for the day.

## Portfolio risk

For holdings with at least 60 days of history, aligned on common dates:

- **Normal day:** σ of the current mix's daily return over the last 252 days × your total, in $.
- **Bad day (VaR 95%):** the 5th percentile of the current mix's daily return over 252 days, in $. **Average bad day (ES 95%):** the mean of the days at or below it.
- **Worst drawdown:** the largest peak-to-trough fall of *today's mix* replayed over all common history (a "what if I had held this mix", not your actual past).
- **Share of risk:** each holding's weight × its covariance with the mix ÷ the mix's variance. **Effective bets:** 1 ÷ the sum of squared risk shares.
- **Beta** to SPY and SMH: regression of the mix's daily return on each.

## Fund look-through

Each fund's dollars are split into its holdings using the weights you pasted; direct holdings add on top. The table shows each company's total, how many places it comes from, and how much of each fund was not listed.




## Cross-asset tone

A heuristic, not a signal. Each input is scaled by its own normal daily move (capped at ±3) and weighted: stocks today (SPY, QQQ) 1.0, stocks over 5 days 0.5, volatility (VIXY, inverted) 0.7, credit vs Treasuries (HYG − IEF) 0.7, chips vs S&P (SMH − SPY) 0.4, dollar (UUP, inverted) 0.3, breadth (RSP − SPY) 0.3. The label switches to risk-on or risk-off past ±1.5 and back to mixed inside ±0.75, so it doesn't flip back and forth.

## Settings history

Every saved change keeps a copy (the last 30; edits of the same kind within 10 minutes replace the newest copy). Restore any of them from Settings → Backup. A setup link always shows what it would change and asks first.
