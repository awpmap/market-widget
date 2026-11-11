# MW 6.0.0: dollars for one share, and a screen that is easier to read

## Dollars for one share

1. **Every day's percent now comes with its dollars for one share.** The two sit together in one
   box, dollars first: `+$5.27 +2.59%`. It is the price now minus the previous close. A falling
   price shows a minus and a red box, and a price that hasn't moved shows a grey one.
2. **Where it shows:** Portfolio rows, Watchlist rows, the index cells and sector tiles in Markets,
   mutual funds, the compact view, the ticker tags on headlines, Ctrl+K, the chart, tooltips,
   "Copy market brief", the "since you looked" line and the tray icon's tooltip.
3. **Markets follow the time frame you pick.** On 5D, 1M, 3M and the rest, a tile shows the percent
   for that time frame and, under it, the dollars one share moved over it.
4. **Mutual funds** show their official change for one share in a solid box. An estimate stays in a
   dashed box marked "est." and an older day's change stays faded, as in 5.0. Estimates are still
   never added to the total.
5. **Alerts say it too.** "ABCD is down $6.20 a share (3.2%) today at $187.42." The fast drop, red
   day, unusual drop, off today's high, off the 52-week high, price alert and near-an-alert messages
   all give dollars for one share next to the percent.
6. **Prices under $1** show four decimals, and so does their change, so a move of a fraction of a
   cent isn't rounded to nothing. Alert messages do the same.

## Portfolio

7. **Two columns that line up.** "Per share" is the price over its change. "Position" is what your
   shares are worth over the dollars they made or lost today. The second is the first times your
   shares.
8. **Where the day's dollars came from.** A bar under the summary boxes has one piece for each
   holding: gains from the left, losses from the right, with the totals above and the three biggest
   named below. Click a piece or a name to go to that holding.
9. **Your day as a line.** Next to the total, a small line draws the portfolio's change through the
   session, one point a minute. Point at it for the figure at that time. It needs MW open during
   the day and is kept on this PC.
10. **Hide amounts.** The eye next to the total, the **H** key, the menu or Ctrl+K masks your total,
    position values and their dollar changes, share counts, cost, gain in dollars, cash and the risk
    figures in dollars. Prices, per-share changes, percents and weights stay, so MW can sit on a
    shared screen. The tray tooltip, the window title and "Copy market brief" follow it.
11. **A holding opens the same tabs as a watchlist ticker**, behind a Position tab: Position, Today,
    Trend, Company, News. Position shows the day as one share's change times your shares
    (`+$4.50 × 10`), your cost, your gain and your gain for one share. The tab you pick stays for the
    next holding you open.
12. **Buttons in an open holding:** Chart, Refresh, "+ Watchlist" (or "Open in Watchlist" when it's
    already there) and Close.
13. **A fund's details use the same layout:** price, the day it is from, the official change for one
    share and on your shares, the estimate, 1M/3M/YTD/1Y, and the ETF it moves most like.
14. **The Risk block folds away.** Click its header. Folded, it keeps one line: the 1-in-20 bad day
    and your largest holding.
15. **Cash rows are plain rows.** They no longer look clickable.

## Watchlist

16. **Two tidy lines per ticker.** First line: ticker, alert bell, earnings date, today's line, price
    and the change box. Second line: where the price stands against your alerts on the left; the
    move against your benchmark and the distance from the 52-week high on the right.
17. **Notes are never cut short.** In a narrow window your note gets lines of its own. In a wide one
    a short note follows the alert status and a long one keeps its own lines. A long alert status
    wraps instead of ending in "…".
18. **A closed row is information only.** Refresh, Remove, "Edit alerts" and Chart moved inside the
    open row, so nothing is clicked by accident. Delete on a focused row still removes it, with Undo.
    The drag handle sits in the row's left margin, level with the price.
19. **Edit alerts** opens Settings → Watchlist at that ticker.
20. **Before and after hours** the pre-market or after-hours move takes the place of "vs benchmark",
    which is a regular-session figure.

## Markets

21. **Click a tile or an index for more.** A details bar opens under the row: price, the day's change
    for one share, 5D/1M/3M/YTD/1Y, Chart, and "+ Watchlist". Click the tile again, ✕ or Esc to close.

## Open rows (holdings and watchlist)

22. **Each fact is a small name over its value**, in two columns, so a number never breaks across
    two lines. One column in a very narrow window.
23. **Today:** the change for one share, previous close, open, distance from the day's high, the day
    measured in normal days (σ), the move against your benchmark, today's VWAP and the day's range.
24. **Trend:** 5D/1M/3M/YTD/1Y, the 50-day and 200-day averages, VWAP since the last gap or high,
    the normal daily range, distance from the 52-week high in dollars and percent, beta and the
    52-week range.
25. **Company:** the next earnings date with how far off it is, market cap, P/E, sales growth and
    gross margin.

## Chart

26. **A readout line under the header.** It gives the candle under the pointer: date, close, change
    in dollars and percent, open, high and low. With the pointer away it gives the latest candle.
27. **The header carries today's pair** next to the price.

## The whole screen

28. **Section headers stay in view.** While you scroll through a section its header stays at the top.
    Portfolio's header shows your total and the day's change once the big total has scrolled away.
29. **One "what's new" card after this update**, with a link to this list. It shows once.
30. **Earnings dates are never cut.** Rows show "ER 2/14"; the watchlist adds am or pm. If there
    isn't room next to the ticker, the chip moves under it. In the compact view a row with no room
    shows "ER" alone; point at it for the date.
31. **News tabs always fit.** The count of new headlines on "All" moved to the section header, where
    it already was, and in a narrow window "✓ Read" becomes "✓".
32. **Narrow windows:** under 385 px the holdings' small chart and "vs benchmark" step aside, under
    361 px the watchlist's small chart does too. An account header's count ("12 holdings") steps
    aside when there is no room for all of it, and the compact view drops the alert price before it
    would wrap a line. Nothing is cut off at the smallest window size.
33. **Zero is grey, with no sign.** A change of exactly zero no longer shows in green, and a figure
    that rounds to zero reads `$0.00 0.00%`, never `+0.00%` or `−0.0%`.
34. **Ctrl+K** shows each ticker's price and, in color, its change. "Hide amounts" is a command.
35. **Settings and data are unchanged.** No new keys, no new data sources, and your saved setup
    carries over as it is.

## The beta

36. **Joining the beta starts from your setup as it is now.** "Try the beta" used to copy your setup
    only the first time, so a later visit opened with the beta's old copy. Now, each time you join,
    your current holdings, watchlist, keys and preferences come over. That includes the fast-price
    keys and the color setting, which the copy used to leave out. The beta's earlier setup stays
    under Settings → Backup → History, and the regular MW is never changed.
