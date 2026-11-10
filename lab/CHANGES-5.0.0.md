# MW 5.0.0: funds, dollars and a real News section

## Mutual funds

1. **Why they looked frozen.** A mutual fund gets one price a day, after the close, and the free feed
   posts it overnight. MW only counted a fund's change when the price was dated today, and asked for
   it every 3 hours, so funds almost never joined the day's change and the row looked stuck.
2. **The official change now counts.** When a fund's newest price is for the session on screen, its
   change is in a solid box and in the portfolio total, like a stock. *Where:* Portfolio.
3. **Every fund says which day its price is from.** "priced Mon 1/5" when up to date, "as of 1/2"
   while a newer price is due, with the reason on hover. *Where:* Portfolio → Mutual funds.
4. **MW keeps asking until the new price is in.** Every 45 to 60 minutes once a price is due, then it
   rests. A second source is asked once a day. "↻ Check price" in a fund's details asks right away.
5. **Estimates between official prices.** Each fund is matched to the index ETF it has moved with
   (6 months of daily changes). Until the official price is posted, the fund shows that ETF's move,
   scaled, in a dashed box, with "Funds est." under the day's change. Estimates are never added to
   the total. Turn them off in Settings → Holdings.
6. **Fund details.** Click a fund: price, the day it is from and its source, official change,
   estimate, 1M/3M/YTD/1Y, the ETF it moves most like, a chart, and when the next price is due.
7. **Funds typed into the Holdings table** (five letters ending in X) are priced as funds instead of
   showing "no price" on every refresh.

## Dollars

8. **Every holding shows the day's change in dollars** under its percent. *Where:* Portfolio rows.
9. **Account headers show dollars and percent.**
10. **Sort by "Today $".**
11. **Biggest and smallest dollar move of the day** in one line under the summary boxes.
12. **Gain vs your cost in dollars** in the third summary box.
13. **The collapsed Portfolio header shows the day's dollars** next to the percent.

## News

14. **News is its own section**, first on the screen, and can be moved, collapsed or hidden like the
    others (Settings → Layout). Collapsed, it shows the newest headline and how many are new.
15. **Tabs:** All, Holdings, Watchlist, Market. Each shows its count of new headlines.
16. **Ticker chips** filter to one ticker; a dot marks tickers with something new.
17. **Readable rows:** two-line headlines, the ticker with its change for the day, source and age.
18. **Click a headline to read its summary in place**, with Open article, Copy link and Chart.
    The ↗ at the right opens the article straight away.
19. **New and read.** Unopened headlines from the last 24 hours are bold with a dot. "✓ Read" marks
    them all.
20. **Market-wide news** is included, not only your tickers.
21. **The same story on several tickers is one line.**
22. **Day separators and "Show all N headlines".**
23. **Headlines inside an open row** match the list (new ones bold) and link to "All ABCD news".

## Smaller things

24. Keys: **N** news, **O** open the focused headline, **1–5** sections, **G** chart a headline's ticker.
25. Ctrl+K: "News on ABCD", "News: mark all as read", "News: check for new headlines",
    "Check mutual fund prices now"; mutual funds can be found by ticker.
26. Status pop-up: lines for fund prices (which day, when checked) and news.
27. "Copy market brief" adds the three newest headlines.
28. "Test my keys" says when a fund's newest price isn't posted yet.
29. Open Portfolio rows are tinted, and only one is open at a time.
