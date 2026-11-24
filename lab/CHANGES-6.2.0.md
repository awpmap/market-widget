# MW 6.2.0: live news (desktop app 1.3.0)

The News section gets a **Live** tab: one tape of company news as it is released, newest first.

## Where the news comes from
| Source | What | How often | Where it works |
|---|---|---|---|
| GlobeNewswire | press releases from public companies, ticker-tagged by the wire | every 15 s | desktop app 1.3 |
| PR Newswire | all press releases | every 15 s | desktop app 1.3 |
| Business Wire | all press releases | every 15 s | desktop app 1.3 |
| Newsfile | the latest 25 releases | every 30 s | desktop app 1.3 |
| SEC EDGAR, 8-K | every new 8-K, with its items in plain words ("results", "exec/board change") | every 20 s | desktop app 1.3 |
| SEC EDGAR, your tickers | every filing for one of your tickers (insider trades, 10-Q, 13D/G, offerings), in turn | one ticker every 10 s | desktop app 1.3 |
| Federal Reserve, BLS, SEC press | statements, data releases, enforcement | 1-2 min | desktop app 1.3 |
| Alpaca news | every ticker, symbol-tagged (posts in batches about every 30 min) | every 60 s | anywhere, with Alpaca keys |
| Finnhub market news | general market headlines | every 2 min | anywhere, with the Finnhub key |

The press wires, SEC and the Fed send no CORS headers, so a web page can't read them. The desktop app's new
`shell_fetch` command reads them instead: GET only, https only, a fixed list of public news hosts, conditional
requests (ETag / If-Modified-Since), 12 s timeout, 4 MB cap, Windows' own TLS. Nothing personal is sent; the SEC
contact (Settings → News, optional) goes only to sec.gov in the User-Agent, because the SEC asks automated readers
to name themselves.

## The tape
- One line per story: the same link or the same headline from several sources is merged (the earliest time and
  every ticker are kept; the tooltip on the badge lists the other sources).
- Each line: time, a source badge (blue = wire, amber = filing, violet = Fed & data), the headline, ticker tags with
  the day's move, and **+14s**: how long after its own publish time MW had it. GlobeNewswire stamps the minute only.
- Filters: Everything, Your tickers, Wires, Filings, Fed & data. Show all lists up to 150 lines.
- A health strip under the tape: a green, amber or red dot per source; Settings → News has the details.
- Your other News tabs (All, Holdings, Watchlist, Market) now also include wire lines and filings about your
  tickers, and the Fed/BLS lines under Market.

## Breaking-news pop-ups
A wire line or filing tagged with a ticker you hold or watch, under 15 minutes old: one Windows pop-up per ticker
per 5 minutes (and a soft beep when sound is on). It is marked at the top of the tape. The first read of each source
after MW starts is backlog and never pops up. Snoozed tickers and paused alerts stay quiet. Settings → News:
Holdings and watchlist / Holdings only / Off.

## Honest limits
- Bloomberg Terminal, paid audio squawks and headline accounts that only post on X or Telegram have no free feed,
  so they are not here.
- Alpaca's free news now posts in batches about every 30 minutes: broad, but slow. The wires and SEC are the fast
  part, and they need the desktop app 1.3.
- In a browser, Live shows Alpaca and Finnhub only, and says so.
