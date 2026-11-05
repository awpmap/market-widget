# MW Beta 4.2.0: quality-of-life pass

Twenty-two small fixes, most found by using the beta through a live trading afternoon (main screen, every
Settings tab, menus, shortcuts, 380 to 520 px windows, light and dark, compact view, empty states,
a failed quote, a rejected key and the 4:00 PM close). No alert rule, threshold, VWAP, auto level,
overnight, splash or beta-switch behaviour changed.

1. **Cash rows keep their names.** The Cash group used to strip anything in parentheses, so
   "Cash (Taxable)" and "Cash (Roth)" both showed as "Cash". Each row now shows the name exactly as
   typed in Settings → Holdings (long names shorten with "…" and show in full on hover).
   *Where:* Portfolio → Cash.
2. **Tickers are never cut off by the earnings chip.** In a narrow window "ABCD" + "ER 1/23 pm"
   became "ABC…". The ticker now always shows in full and the earnings chip shortens instead.
   *Where:* Portfolio rows, Watchlist rows, compact strip.
3. **Earnings chip and heads-up banner readable in light theme.** Dark text on dark amber is now
   dark text on light amber, in both themes. *Where:* "ER" chips within 5 days; heads-up banner.
4. **Mutual fund change says which day it is from.** Before tonight's price is out, a fund's %
   is yesterday's, but it looked like today's (a green badge on a red day). It now shows without
   the badge, with the date under it and an explanation on hover. *Where:* Portfolio → Mutual funds.
5. **Holdings with no price are named.** A failed quote silently lowered the total and left a row
   of dashes. The total now says "Leaves out XYZ (no price)", the row says "no price", and the note
   names the ticker. *Where:* Portfolio.
6. **A rejected Finnhub key is shown at the top.** It used to appear only as a line under the last
   section. A notice now sits at the top with an "Open settings" button, says whether the backup
   feed is covering, and goes away once the key works. *Where:* main screen.
7. **Status after the close reads correctly.** The pop-up said "Data is live" and "0 of 5 watchlist
   tickers can alert" after 4:00 PM. It now says "Up to date · showing the last close" and that
   alerts start again at the open. *Where:* status pill pop-up.
8. **Refresh interval in plain units.** "every 300s" is now "every 5 min" (and "every 60 s").
   *Where:* status pop-up and the pill's hover text.
9. **Twelve Data key label says what it powers.** It said "optional, for mutual funds", but it
   also drives price history, risk figures, auto buy levels, the Rule lab and backup prices.
   *Where:* Settings → General.
10. **Theme previews right away.** Picking Light or Dark shows it at once; Save keeps it, closing
    without saving puts it back. *Where:* Settings → General → Theme.
11. **Settings tabs fit in two rows** at narrow window widths (Diagnostics no longer wraps onto a
    third row by itself). *Where:* Settings tab bar.
12. **Full watchlist note on hover** when it's cut off. *Where:* Watchlist rows.
13. **Menu shows the "/" shortcut** next to Watchlist, like C, P and "," already were.
    *Where:* ⋯ menu.
14. **Scorecard dates match the rest of MW** ("1/23" instead of "01-23"). *Where:* Settings →
    Scorecard → Recent alerts.
15. **Auto-level alerts read cleanly.** "hit your auto $X (5% under the level above (your spacing
    rule)) buy level" is now "hit your auto $X buy level". The reason for the level is still on
    the row's hover text. *Where:* alert banner, pop-ups, Today's alerts.
16. **"52w high" says what it is on watchlist rows.** "−12.3% hi" is now "52w high −12.3%", the
    same words as the holding details, with the 52-week high price on hover. *Where:* Watchlist rows.
17. **Settings reopens on the tab you used last** (menu → Settings, or ","). Buttons that open a
    specific tab still go straight there. *Where:* Settings.
18. **"+ Add holding" and "+ Add fund or cash" put the cursor in the new row.** *Where:*
    Settings → Holdings.
19. **Adding a ticker tells you what happened.** Adding one already on the list used to do nothing;
    now it says so. A new ticker is confirmed and the box stays ready for the next one. Same for
    My list tiles. *Where:* Settings → Watchlist and Settings → Markets.
20. **Diagnostics log says its clock.** The log's timestamps are UTC; the help text now says so.
    *Where:* Settings → Diagnostics.
21. **Compact view keeps your watchlist in order.** The compact strip re-sorted tickers by distance
    to the next buy level on every refresh, so rows jumped around, and tickers still waiting for a
    price disappeared. It now follows your Watchlist order (the drag order), shares one grid so
    prices and % line up across rows, and shows a ticker without a price as "— · waiting".
    (Same fix as regular MW 3.11.2.) *Where:* compact view.
22. **Esc works from inside a Settings text box.** Esc used to do nothing while the cursor was in a
    field. Now the first Esc leaves the field (nothing typed is lost) and the next closes Settings;
    keyboard shortcuts work right after Settings closes. *Where:* Settings.

Version files moved together: engine version 4.2.0, `version.json` 4.2.0, offline cache `mwlab-shell-v4`.
Browser harness checks added for 1, 2, 6, 10, 17, 21 and 22.
