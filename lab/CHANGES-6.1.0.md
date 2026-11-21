# MW 6.1.0: the market map

A new full-window **Market map**: about 200 funds on one screen, in the spirit of an ETF heatmap.
Open it with **Map** in the Markets toolbar, **Market map** in the ⋯ menu, Ctrl+K → "Market map", or press **M**.
Make the window wide for the full picture; in a narrow window the panels stack and scroll.

## What it shows
- **Eleven panels**, each split into groups: US (index, inverse, leverage, dividend), US sectors (11 sectors plus
  biotech, banks, homebuilders, software...), International (developed, emerging, ex-US, Asia-Pacific, Europe, China,
  Americas), US large cap (growth, value), US mid cap, US small cap (blend, value, growth, leverage, inverse),
  Global themes (semiconductors, tech & AI, gold and silver miners, power & resources, world index), Fixed income
  (cash & short, Treasuries, corporate, broad, TIPS, mortgages, munis), Commodities (gold, silver, energy, broad,
  leverage), Crypto (bitcoin and ether funds, plus spot BTC, ETH and SOL around the clock) and Strategy (factor,
  income, equal weight). 218 tiles in all.
- **Tile area** follows the fund's rough size (square-root scaled, so small funds stay readable). Switch to
  **Volume** (today's dollar volume on IEX: the busiest funds are biggest) or **Equal**.
- **Color** follows the change: **1D, 5D, 1M, 3M, YTD, 1Y**, or **Since close** (the latest pre-market or
  after-hours trade against the regular close). In pre-market, Since close is picked for you, since the day's
  change is still yesterday's. The legend shows where the colors top out.
- Big tiles show the ticker, the percent and the change for one share in dollars; on 1D, a tile with an
  after-hours or pre-market trade shows it too (AH +0.5%).
- **Panel headers** give the average move of the regular (1x) funds in that panel, weighted like the tiles.
  Leveraged and inverse funds are left out of every average and of Best/Worst.
- **Summary line**: funds up and down, a breadth bar, the map's average, and the best and worst 1x fund (click to jump).
- **Click a tile** for details: price and the day's change for one share, after hours, 1D to 1Y, the day's range,
  dollar volume on IEX, where the price came from, Chart and + Watchlist (or Open in Watchlist), and every fund in
  its group ranked with bars. Click a fund there to move to it.
- **Find** (or press /) dims everything but the matches; Enter selects the first. **Panels** hides any panel
  (hidden panels are not fetched). Keys: 1 to 6 pick the time frame, R refreshes, Esc closes the details and then the map.

## Data and limits (all free)
- With an Alpaca key: every fund in 3 snapshot calls every 15 s while the map is open in market hours, pre-market
  and after hours; every 10 minutes while the market is closed. 5D to 1Y come from Alpaca daily bars, about 6 calls
  once a day. Well inside Alpaca's 200 calls a minute, next to MW's own fast prices.
- Without one: Finnhub, one fund every 3 s (about 20 a minute, in MW's background lane), biggest first, then the
  oldest; a full pass takes about 11 minutes. 5D to 1Y then cover only the funds MW already has history for.
- Spot coins come from Alpaca's crypto feed, which needs no key, every 30 s; their day starts at 00:00 UTC.
- For tickers MW already tracks, MW's regular prices win when they are newer.
- Nothing is fetched for the map while it is closed.
- Fund sizes are rough, rounded figures (mid-2026) used only for tile area; they are never shown as numbers.
