"""Check MW Lab's NYSE calendar (lab/engine.js) against exchange_calendars' XNYS for every day it covers.
Run: pip install exchange_calendars && node labdev/dump_calendar.mjs | python labdev/check_calendar.py"""
import json, sys
import exchange_calendars as xc
import pandas as pd

cal = json.load(sys.stdin)
x = xc.get_calendar("XNYS", start="2025-01-01", end="2029-12-31")
start, end = pd.Timestamp(cal["from"]), pd.Timestamp(cal["to"])
sessions = set(d.strftime("%Y-%m-%d") for d in x.sessions_in_range(start, end))
early = {}
for d in x.early_closes:
    if start <= d <= end:
        c = x.session_close(d).tz_convert("America/New_York")
        early[d.strftime("%Y-%m-%d")] = c.hour * 60 + c.minute
bad = []
day = start
while day <= end:
    s = day.strftime("%Y-%m-%d")
    mine = s in cal["trading"]
    if mine != (s in sessions):
        bad.append(f"{s}: MW says {'open' if mine else 'closed'}, XNYS says {'open' if s in sessions else 'closed'}")
    day += pd.Timedelta(days=1)
for s, m in early.items():
    if cal["early"].get(s) != m:
        bad.append(f"{s}: XNYS closes early at {m // 60}:{m % 60:02d}, MW has {cal['early'].get(s)}")
for s, m in cal["early"].items():
    if s not in early:
        bad.append(f"{s}: MW closes early, XNYS doesn't")
if bad:
    print("Calendar mismatch:\n" + "\n".join(bad)); sys.exit(1)
print(f"Calendar OK: {len(sessions)} sessions and {len(early)} early closes from {cal['from']} to {cal['to']} match XNYS.")
