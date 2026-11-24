/* MW Lab engine: the pure, tested core.
   Everything in this file is a plain function of its inputs: no DOM, no storage, no network, no clock
   (the time is always passed in). The page (app.js) feeds it data and shows what it returns; the tests in
   labdev/test run the same file under Node. See METHODS.md for what each number means.
   Public build: no personal data lives in this file. */
(function (root) {
"use strict";
const E = {};
E.VERSION = "6.3.1";

/* ====================================================================================
   1. Calendar (NYSE). Source: NYSE Group release of 2025-12-23, "2026, 2027 and 2028 Holiday
   and Early Closings Calendar". Checked in CI against the exchange_calendars XNYS calendar.
   Past CAL_VALID_TO the clock says "calendar expired" and no alert can fire (fail closed).
   ==================================================================================== */
E.HOLIDAYS = new Set([
  "2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25",
  "2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31","2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24",
  // 2028: New Year's Day falls on a Saturday and is not observed
  "2028-01-17","2028-02-21","2028-04-14","2028-05-29","2028-06-19","2028-07-04","2028-09-04","2028-11-23","2028-12-25"]);
E.EARLY_CLOSE = {"2026-11-27":780, "2026-12-24":780, "2027-11-26":780, "2028-07-03":780, "2028-11-24":780};
E.CAL_VALID_FROM = "2026-01-01";
E.CAL_VALID_TO = "2028-12-31";
E.calendarValid = date => date >= E.CAL_VALID_FROM && date <= E.CAL_VALID_TO;

const ET_TZ = "America/New_York";
E.ET_TZ = ET_TZ;
const etFmt = new Intl.DateTimeFormat("en-US", {timeZone:ET_TZ, hour12:false, weekday:"short", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit"});
/* New York wall clock for an instant: {day:"Mon", date:"2026-11-05", mins: minutes after midnight, secs} */
E.etParts = function (ms) {
  const o = {}; etFmt.formatToParts(new Date(ms)).forEach(x => o[x.type] = x.value);
  const h = (+o.hour) % 24;
  return {day:o.weekday, date:`${o.year}-${o.month}-${o.day}`, mins:h*60 + (+o.minute), secs:h*3600 + (+o.minute)*60 + (+o.second)};
};
E.etDateOf = ms => E.etParts(ms).date;
/* New York wall-clock time on a date -> epoch ms (handles daylight saving) */
E.etMs = function (date, mins) {
  const [y, mo, d] = date.split("-").map(Number), want = Date.UTC(y, mo-1, d, Math.floor(mins/60), mins%60);
  let g = want + 5*3600e3;
  for (let i = 0; i < 3; i++) {
    const p = E.etParts(g), [py, pm, pd] = p.date.split("-").map(Number);
    const wall = Date.UTC(py, pm-1, pd, Math.floor(p.mins/60), p.mins%60);
    if (wall === want) break; g += want - wall;
  }
  return g;
};
E.addDays = (date, n) => { const [y, mo, d] = date.split("-").map(Number); return new Date(Date.UTC(y, mo-1, d + n, 12)).toISOString().slice(0, 10); };
E.weekday = date => new Date(date + "T12:00:00Z").getUTCDay();
E.isTradingDay = date => { const wd = E.weekday(date); return wd !== 0 && wd !== 6 && !E.HOLIDAYS.has(date); };
E.closeMins = date => E.EARLY_CLOSE[date] || 960;
E.nextTradingDay = date => { let d = E.addDays(date, 1); for (let i = 0; i < 15 && !E.isTradingDay(d); i++) d = E.addDays(d, 1); return d; };
E.prevTradingDay = date => { let d = E.addDays(date, -1); for (let i = 0; i < 15 && !E.isTradingDay(d); i++) d = E.addDays(d, -1); return d; };
/* Nasdaq overnight trading (planned from 2026-12-06 9 pm ET, subject to SEC approval). Off unless the
   setting is on: free price feeds carry no overnight prices, so it only changes the clock text. */
E.OVERNIGHT_FROM = Date.UTC(2026, 11, 7, 2);

/* Where the US market is in its day, and what's next. All times are instants (ms). */
E.marketClock = function (now, opts) {
  opts = opts || {};
  const t = E.etParts(now), d = t.date, m = t.mins;
  if (!E.calendarValid(d)) return {ph:"unknown", label:"Calendar expired", until:null, untilWhat:"", nextOpen:null, nextOpenDay:null, early:false, closeTime:null, expired:true};
  const trading = E.isTradingDay(d);
  const openAt = date => E.etMs(date, 570), closeAt = date => E.etMs(date, E.closeMins(date));
  const nextOpenDay = (trading && m < 570) ? d : E.nextTradingDay(d);
  const nextOpen = openAt(nextOpenDay);
  const after = date => E.closeMins(date) === 960 ? 1200 : E.closeMins(date) + 240;
  const base = {nextOpen, nextOpenDay, early: trading && E.closeMins(d) < 960, closeTime: trading ? closeAt(d) : null, nextBeyond: !E.calendarValid(nextOpenDay)};
  if (trading && m >= 570 && m < E.closeMins(d)) return Object.assign({}, base, {ph:"open", label:"Market open", until: closeAt(d), untilWhat:"close"});
  if (trading && m >= 240 && m < 570) return Object.assign({}, base, {ph:"pre", label:"Pre-market", until: nextOpen, untilWhat:"open"});
  if (trading && m >= E.closeMins(d) && m < after(d)) return Object.assign({}, base, {ph:"after", label:"After hours", until: nextOpen, untilWhat:"open", extEnds: E.etMs(d, after(d))});
  if (opts.overnight && now >= E.OVERNIGHT_FROM) {
    const nt = trading && m < 240 ? d : E.nextTradingDay(d), eveDay = E.addDays(nt, -1);
    const start = E.etMs(eveDay, 1260), end = E.etMs(nt, 240);
    if (now >= start && now < end) return Object.assign({}, base, {ph:"overnight", label:"Overnight", until: nextOpen, untilWhat:"open", extEnds: end});
    if (trading && m >= 1200 && m < 1260 && E.nextTradingDay(d) === E.addDays(d, 1)) return Object.assign({}, base, {ph:"pause", label:"Nightly pause", until: nextOpen, untilWhat:"open", extStarts: start});
  }
  const wd = E.weekday(d);
  return Object.assign({}, base, {ph:"closed", label: E.HOLIDAYS.has(d) ? "Holiday" : (wd === 0 || wd === 6) ? "Weekend" : "Closed", until: nextOpen, untilWhat:"open"});
};
/* the trading session as alerts see it: s = open | ext | closed | unknown. mstat = Finnhub market status
   ({at, date, isOpen, holiday}); a live "closed for a holiday" overrides the table (surprise closures). */
E.session = function (now, mstat, opts) {
  const mc = E.marketClock(now, opts), t = E.etParts(now);
  if (mc.ph === "unknown") return {s:"unknown", label:"Calendar expired", why:"MW's market calendar ends " + E.CAL_VALID_TO + ". Alerts are off until it is updated."};
  if (mc.ph === "open") {
    const live = mstat && now - mstat.at < 20*60e3 && mstat.date === t.date ? mstat : null;
    if (live && live.isOpen === false && live.holiday) return {s:"closed", label:"Holiday", why:live.holiday};
    return {s:"open", label:"Market open", early: mc.early};
  }
  if (mc.ph === "pre" || mc.ph === "after" || mc.ph === "overnight") return {s:"ext", label:mc.label};
  return {s:"closed", label: mc.ph === "pause" ? "Nightly pause" : mc.label};
};

/* ====================================================================================
   2. Formatting (shared by alert messages and the page)
   ==================================================================================== */
E.fmt$ = (n, d = 2) => (n == null || !isFinite(n)) ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d});
/* a price: to the cent, or to four decimals under $1. ref: the price that decides, when n is a per-share difference */
E.fmtPx = (n, ref) => { const p = ref == null ? n : ref; return E.fmt$(n, p > 0 && p < 1 ? 4 : 2); };
/* the sign of a figure shown to d decimals: one that rounds to zero is neither up nor down, so it gets none */
E.sgn = (n, d = 2) => +Math.abs(n).toFixed(d) === 0 ? "" : n > 0 ? "+" : "−";
E.fmtS$ = (n, d = 0) => (n == null || !isFinite(n)) ? "—" : E.sgn(n, d) + "$" + Math.abs(n).toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d});
E.fmtPct = (n, d = 2) => (n == null || !isFinite(n)) ? "—" : E.sgn(n, d) + Math.abs(n).toFixed(d) + "%";
E.fmtL = L => E.fmt$(L, L < 100 ? 2 : 0);
E.mdLabel = d => (+d.slice(5,7)) + "/" + (+d.slice(8,10));
E.roundLevel = p => p < 100 ? +p.toFixed(2) : Math.round(p);

/* ====================================================================================
   3. Data quality
   ==================================================================================== */
E.FRESH_MS = 20*60e3;          // a trade older than this can't raise an alert
E.BROAD = new Set(["SPY","QQQ","DIA","IWM","VTI","VOO","IVV","RSP","VEA","VWO","EFA","EEM","AGG","BND","TLT","IEF","HYG","LQD","GLD","XLK","XLC","XLY","XLF","XLV","XLI","XLE","XLB","XLU","XLP","XLRE","SMH","SOXX","VIXY","UUP"]);
/* Can this quote raise an alert? Only while the market is open, and only if the last trade (q.t, seconds)
   is from today's session and recent, and the fetch itself (q.at, ms) is recent. Returns {ok, why}. */
E.freshness = function (q, now, ses) {
  if (!q || !(q.c > 0)) return {ok:false, why:"no price"};
  if (!ses || ses.s !== "open") return {ok:false, why:"market not open"};
  if (!q.at || now - q.at > 15*60e3) return {ok:false, why:"not fetched in the last 15 min"};
  if (!q.t) return {ok:false, why:"quote has no trade time"};
  const tms = q.t * 1000;
  if (E.etDateOf(tms) !== E.etDateOf(now)) return {ok:false, why:"last trade is from an earlier day"};
  if (now - tms > E.FRESH_MS) return {ok:false, why:"last trade is " + Math.round((now - tms)/60e3) + " min old"};
  return {ok:true, why:""};
};
E.alertable = (q, now, ses) => E.freshness(q, now, ses).ok;
/* jump allowed before a print is held for confirmation: 6 normal days' moves, at least 8% (stocks) or 4% (broad ETFs) */
E.jumpLimit = (volPct, broad) => Math.max(6 * (volPct || (broad ? 1 : 2.5)), broad ? 4 : 8);
/* Screen a new quote. prev = this symbol's earlier quote from the same session (or null), volPct = its normal
   daily move (σ, %), pending = a held price waiting for confirmation (or undefined).
   Returns {action: "accept" | "hold" | "reject", why, hold?}. A held price is accepted when the next one agrees within 2%. */
E.screenQuote = function (q, prev, volPct, broad, pending) {
  if (!q || !(q.c > 0) || !isFinite(q.c)) return {action:"reject", why:"zero or missing price"};
  if (q.pc > 0 && q.dp != null && isFinite(q.dp) && Math.abs((q.c/q.pc - 1)*100 - q.dp) > 0.5) return {action:"reject", why:"price and % change disagree"};
  if (q.h > 0 && q.l > 0 && q.h < q.l) return {action:"reject", why:"day high below day low"};
  const lim = E.jumpLimit(volPct, broad) / 100;
  let jump = false, why = "";
  if (prev && prev.c > 0) { if (Math.abs(q.c/prev.c - 1) > lim) { jump = true; why = "jumped " + E.fmtPct((q.c/prev.c - 1)*100, 0) + " since the last refresh"; } }
  else if (q.pc > 0 && Math.abs(q.c/q.pc - 1) > lim * 1.5) { jump = true; why = "first price of the day is " + E.fmtPct((q.c/q.pc - 1)*100, 0) + " from yesterday's close"; }
  if (!jump) return {action:"accept", why:""};
  if (pending > 0 && Math.abs(q.c/pending - 1) < 0.02) return {action:"accept", why:"confirmed by a second refresh"};
  return {action:"hold", why, hold:q.c};
};
/* Levels that look wrong for the price (a split, or a typo): more than 3x above or under a third of it */
E.levelSanity = function (levels, px) {
  if (!(px > 0)) return [];
  return (levels || []).filter(L => L > px * 3 || L < px / 3);
};

/* ====================================================================================
   4. Statistics on daily closes. Arrays of bars/closes are NEWEST FIRST, like the APIs return them.
   ==================================================================================== */
/* simple daily returns, oldest first, from closes newest first */
E.returns = function (closesNewest) {
  const c = closesNewest.slice().reverse(), r = [];
  for (let i = 1; i < c.length; i++) if (c[i-1] > 0 && c[i] > 0) r.push(c[i]/c[i-1] - 1);
  return r;
};
E.mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
E.sd = a => { if (a.length < 2) return NaN; const m = E.mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m)**2, 0) / (a.length - 1)); };
E.quantile = function (a, p) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
E.median = a => E.quantile(a, 0.5);
/* exponentially weighted volatility (RiskMetrics, lambda 0.94), seeded with the first 20 days' variance */
E.ewmaVol = function (retsOldest, lambda = 0.94) {
  if (retsOldest.length < 20) return NaN;
  let v = retsOldest.slice(0, 20).reduce((x, y) => x + y*y, 0) / 20;
  for (let i = 20; i < retsOldest.length; i++) v = lambda * v + (1 - lambda) * retsOldest[i]**2;
  return Math.sqrt(v);
};
/* robust volatility: 1.4826 x median absolute deviation (ignores a few huge days) */
E.madVol = function (rets) {
  if (rets.length < 20) return NaN;
  const m = E.median(rets), dev = rets.map(r => Math.abs(r - m));
  return 1.4826 * E.median(dev);
};
/* every volatility read MW uses, in % per day. sigma = the one alerts use (EWMA). */
E.volEstimate = function (closesNewest) {
  const r = E.returns(closesNewest), last60 = r.slice(-60), last250 = r.slice(-250);
  const ewma = E.ewmaVol(r.slice(-250)), mad = E.madVol(last250), sd60 = E.sd(last60);
  const pct = x => isFinite(x) ? x * 100 : null;
  return {sigma: pct(isFinite(ewma) ? ewma : sd60), ewma: pct(ewma), mad: pct(mad), sd60: pct(sd60),
    q02: last250.length >= 100 ? pct(E.quantile(last250, 0.02)) : null, q05: last250.length >= 100 ? pct(E.quantile(last250, 0.05)) : null, n: r.length};
};
/* Wilder's average true range over n days. bars newest first: [date, open, high, low, close, volume] */
E.atrWilder = function (bars, n = 14) {
  if (!bars || bars.length < n + 1) return NaN;
  const b = bars.slice().reverse(), tr = [];
  for (let i = 1; i < b.length; i++) tr.push(Math.max(b[i][2] - b[i][3], Math.abs(b[i][2] - b[i-1][4]), Math.abs(b[i][3] - b[i-1][4])));
  let atr = tr.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (let i = n; i < tr.length; i++) atr = (atr * (n - 1) + tr[i]) / n;
  return atr;
};
E.sma = (closesNewest, n) => closesNewest.length >= n ? E.mean(closesNewest.slice(0, n)) : null;

/* Daily numbers for auto levels and the anchored VWAP, from completed sessions only (set before the open). */
E.dailyStats = function (bars) {
  if (!bars || bars.length < 16) return null;
  const b = bars, c = b[0][4], atr = E.atrWilder(b.slice(0, Math.min(b.length, 120)), 14);
  if (!(atr > 0)) return null;
  const nv = Math.min(50, b.length), avgV = b.slice(0, nv).reduce((a, x) => a + x[5], 0) / nv;
  let anc = -1, best = 0;
  for (let i = 0; i < Math.min(40, b.length - 1); i++) {
    const gap = Math.abs(b[i][1] / b[i+1][4] - 1), sc = gap * Math.min(avgV ? b[i][5] / avgV : 1, 4);
    if (gap >= 0.03 && sc > best) { best = sc; anc = i; }
  }
  let ancWhy = "gap";
  if (anc < 0) { ancWhy = "high"; anc = 0; for (let i = 1; i < Math.min(20, b.length); i++) if (b[i][2] > b[anc][2]) anc = i; }
  let pv = 0, vv = 0; for (let i = anc; i >= 0; i--) { pv += (b[i][2] + b[i][3] + b[i][4]) / 3 * b[i][5]; vv += b[i][5]; }
  const sup = [];
  for (let i = 2; i < Math.min(b.length, 70) - 2; i++) { const l = b[i][3]; if (l <= b[i-1][3] && l <= b[i-2][3] && l <= b[i+1][3] && l <= b[i+2][3]) sup.push({p:l, label:"swing low of " + E.mdLabel(b[i][0])}); }
  const lowOf = n => { let j = 0; for (let i = 1; i < Math.min(n, b.length); i++) if (b[i][3] < b[j][3]) j = i; return j; };
  const l20 = lowOf(20), l60 = lowOf(60);
  sup.push({p:b[l20][3], label:"20-day low (" + E.mdLabel(b[l20][0]) + ")"});
  if (b.length >= 40 && l60 !== l20) sup.push({p:b[l60][3], label:"60-day low (" + E.mdLabel(b[l60][0]) + ")"});
  return {date:b[0][0], c, atr, atrPct: atr / c * 100, anchor:{d:b[anc][0], why:ancWhy, pv, v:vv, vw: vv ? pv / vv : null}, sup: sup.filter(x => x.p < c * 0.985)};
};
/* Three auto levels: 1, 2 and 3 ATRs under the last close, snapped to nearby support. Explicit floors:
   the first at least firstPct% under the close, each next one at least stepPct% under the one before. */
E.autoLevels = function (s, opts) {
  if (!s) return null;
  opts = Object.assign({firstPct:3, stepPct:5, n:3}, opts || {});
  const out = []; let ref = s.c;
  for (let k = 1; k <= opts.n; k++) {
    let p = s.c - k * s.atr, why = k === 1 ? "1 average day's range under the close" : k + " average days' ranges under the close";
    const near = s.sup.filter(x => Math.abs(x.p - p) <= 0.4 * s.atr && x.p < ref).sort((a, b) => Math.abs(a.p - p) - Math.abs(b.p - p))[0];
    if (near) { p = near.p; why = "near the " + near.label; }
    const cap = ref * (1 - (k === 1 ? opts.firstPct : opts.stepPct) / 100);
    if (p > cap) { p = cap; why = k === 1 ? opts.firstPct + "% under the close (closest allowed)" : opts.stepPct + "% under the level above (your spacing rule)"; }
    if (!(p > 0)) break;
    p = E.roundLevel(p);
    out.push({p, why}); ref = p;
  }
  return out;
};

/* ====================================================================================
   5. Rule registry. Each rule turns one ticker's live context into alerts. evaluate() never mutates:
   it returns the alerts and the ticker's next rule state.
   ctx: {sym, q, now, today, vol (σ %), hi52, benchSym, benchDp, er (earnings info), ticks [[t, px]...],
         vwap ({vw} or null), levels [{L, name}] (deepest last), alertOk (freshness verdict)}
   state: {fast:{n, armed, low}, off: bool, vw: "above"|"below"}
   ==================================================================================== */
const on = (w, k, numKey) => w[k] === true || (w[k] !== false && (numKey ? !!w[numKey] : true));
E.RULES = [
  {id:"level", name:"Price alert", short:"price alert", rank:0, daily:true, intraday:true, desc:"Price at or under one of your price alerts."},
  {id:"fast", name:"Fast drop", short:"fast drop", rank:1, daily:false, intraday:true, desc:"Down N% from the high of the last M minutes."},
  {id:"red", name:"Red day", short:"red day", rank:1, daily:true, intraday:true, desc:"Down at least N% on the day."},
  {id:"sig", name:"Unusual drop", short:"unusual drop", rank:1, daily:true, intraday:true, desc:"Down at least N normal days' moves (σ, EWMA)."},
  {id:"vwap", name:"VWAP reclaim", short:"VWAP reclaim", rank:1, daily:false, intraday:true, desc:"Flushed well under today's VWAP, then climbed back over it."},
  {id:"hd", name:"Off today's high", short:"off today's high", rank:2, daily:true, intraday:true, desc:"N% under today's high."},
  {id:"off", name:"Off 52-week high", short:"off 52w high", rank:3, daily:true, intraday:true, desc:"Just crossed N% under the 52-week high."},
  {id:"near", name:"Near a price alert", short:"near a price alert", rank:5, daily:false, intraday:true, desc:"Within N% above the next price alert (heads-up only)."}
];
E.RULE = {}; E.RULES.forEach(r => E.RULE[r.id] = r);
E.RANK = {}; E.RULES.forEach(r => E.RANK[r.id] = r.rank); E.RANK.test = 6; E.RANK.health = -1;

E.evaluate = function (w, ctx, state) {
  state = state || {};
  const next = {fast: Object.assign({n:0, armed:true, low:null}, state.fast || {}), off: state.off, vw: state.vw};
  const out = [];
  if (!ctx.alertOk || w.on === false) return {alerts:[], state:next};
  const sym = ctx.sym, q = ctx.q, px = q.c, $ = E.fmtPx, er = ctx.er;
  // every message says the move in dollars a share as well as in percent (the page does the same)
  const shd = px > 0 && px < 1 ? 4 : 2, sh = v => E.fmt$(Math.abs(v), shd) + " a share";
  const chg = q.pc > 0 ? px - q.pc : (q.d != null && isFinite(q.d) ? +q.d : null);
  const erTxt = er && er.days <= 7 ? ` · earnings ${er.days === 0 ? "today" : er.days === 1 ? "tomorrow" : er.label.slice(3)}` : "";
  const lag = ctx.benchDp != null && q.dp != null ? q.dp - ctx.benchDp : null;
  const lagOk = !(w.lagOn && w.lagBy) || sym === ctx.benchSym || (lag != null && lag <= -w.lagBy);
  const lagTxt = w.lagOn && w.lagBy && lag != null && sym !== ctx.benchSym ? ` · ${E.fmtPct(lag,1)} vs ${ctx.benchSym}` : "";
  const dip = [];
  // fast drop: re-arms only after the price bounces half the drop off its low
  if (on(w, "fastOn", "fastDrop") && w.fastDrop) {
    const mins = w.fastMins || 15, since = ctx.now - mins*60e3, a = ctx.ticks || [];
    const recent = a.filter(x => x[0] >= since), top = recent.length ? Math.max(...recent.map(x => x[1])) : null;
    const fs = next.fast;
    if (!fs.armed) { fs.low = Math.min(fs.low == null ? px : fs.low, px); if (px >= fs.low * (1 + w.fastDrop/200)) fs.armed = true; }
    // needs the window to be (mostly) covered by ticks: the oldest recent tick within the first half
    if (fs.armed && top && recent[0][0] <= since + mins*30e3 && px <= top * (1 - w.fastDrop/100)) { fs.armed = false; fs.low = px; fs.n++; fs.top = top; }
    if (!fs.armed && fs.low === px && fs.n) dip.push({id:`${sym}-fast-${fs.n}`, kind:"fast", sym, msg:(t => `${sym} dropped ${sh(t - px)} (${((1 - px/t)*100).toFixed(1)}%) in the last ${mins} min (from ${$(t)} to ${$(px)})`)(fs.top || top || px)});
  }
  if (on(w, "redOn", "dayDrop") && w.dayDrop && q.dp != null && q.dp <= -w.dayDrop) dip.push({id:`${sym}-red`, kind:"red", sym, msg:`${sym} is down ${chg != null && chg < 0 ? `${sh(chg)} (${Math.abs(q.dp).toFixed(1)}%)` : Math.abs(q.dp).toFixed(1) + "%"} today at ${$(px)}${erTxt}`});
  if (on(w, "sigOn", "sigDrop") && w.sigDrop && ctx.vol && q.dp != null && q.dp / ctx.vol <= -w.sigDrop) dip.push({id:`${sym}-sig`, kind:"sig", sym, msg:`${sym} is down ${Math.abs(q.dp/ctx.vol).toFixed(1)}σ today (${chg != null && chg < 0 ? "−" + sh(chg) + ", " : ""}${E.fmtPct(q.dp,1)}; a normal day is ±${ctx.vol.toFixed(1)}%)${erTxt}`});
  if (on(w, "hiOn", "hiDrop") && w.hiDrop && q.h && px <= q.h * (1 - w.hiDrop/100)) dip.push({id:`${sym}-hd`, kind:"hd", sym, msg:`${sym} is ${sh(q.h - px)} (${((1 - px/q.h)*100).toFixed(1)}%) below today's high of ${$(q.h)}, now ${$(px)}${erTxt}`});
  if (lagOk) dip.forEach(a => { a.msg += lagTxt; out.push(a); });
  if (ctx.hi52 && w.offHigh && w.offOn !== false) {
    const off = (1 - px/ctx.hi52)*100, inZone = off >= w.offHigh;
    if (inZone && next.off === false) out.push({id:`${sym}-off`, kind:"off", sym, msg:`${sym} just fell ${off.toFixed(1)}% (${sh(ctx.hi52 - px)}) below its 52-week high of ${$(ctx.hi52)}, now ${$(px)}${erTxt}`});
    next.off = inZone;
  }
  // VWAP reclaim (opt-in in the lab)
  if (w.vwapOn === true && ctx.vwap && ctx.vwap.vw && q.l) {
    const vs = ctx.vwap, side = px >= vs.vw ? "above" : "below", prev = next.vw;
    const flushPct = Math.max(2, ctx.vol || 0), flushed = q.l <= vs.vw * (1 - flushPct/100);
    next.vw = side;
    if (flushed && prev === "below" && side === "above") out.push({id:`${sym}-vwap`, kind:"vwap", sym, msg:`${sym} climbed back above today's VWAP (${$(vs.vw)}) after dropping ${((1 - q.l/vs.vw)*100).toFixed(1)}% under it (now ${$(px)})${erTxt}`});
  }
  if (w.levelsOn !== false && ctx.levels && ctx.levels.length) {
    const lv = ctx.levels.map(x => x.L), hit = ctx.levels.filter(x => px <= x.L);
    if (hit.length) { const deep = hit[hit.length - 1]; out.push({id:`${sym}-L${deep.L}${deep.tag || ""}`, also:hit.map(x => `${sym}-L${x.L}${x.tag || ""}`), kind:"level", sym, level:deep.L, msg:`${sym} reached your ${deep.name} price alert (now ${$(px)}${chg != null && chg < 0 ? `, down ${sh(chg)} today` : ""})${hit.length > 1 ? ` · through ${hit.length} alerts` : ""}${erTxt}`}); }
    const nx = ctx.levels.find(x => x.L < px);
    if (nx && on(w, "nearOn", "near") && w.near && px <= nx.L * (1 + w.near/100)) out.push({id:`${sym}-N${nx.L}`, kind:"near", sym, level:nx.L, msg:`${sym} is ${sh(px - nx.L)} (${((px/nx.L - 1)*100).toFixed(1)}%) above your ${nx.name} price alert`});
    void lv;
  }
  return {alerts:out, state:next};
};

/* Bundling: at most one loud alert per ticker per 15 min unless a new level breaks or it drops another leg.
   Pure version of the live checkAlerts. Inputs:
   items: [{w, ctx, alerts}] (alerts = evaluate(...).alerts), fired: today's record {day, ids, log, lastBy, unseenSyms},
   now, paused, snoozed(sym) -> bool, allOff, timeStr(ms) -> "10:42 AM".
   Returns {fired (new object), fresh: [main alerts to announce]} */
E.BUNDLE_MS = 15*60e3;
E.bundle = function (items, fired, now, opts) {
  opts = opts || {};
  const f = JSON.parse(JSON.stringify(fired || {}));
  f.ids = f.ids || {}; f.log = f.log || []; f.lastBy = f.lastBy || {}; f.unseenSyms = f.unseenSyms || [];
  const fresh = [], logged = [];
  if (opts.paused || opts.allOff) return {fired:f, fresh, logged};
  items.forEach(it => {
    const w = it.w, sym = it.ctx.sym; if (opts.snoozed && opts.snoozed(sym)) return;
    const news = (it.alerts || []).filter(a => !f.ids[a.id]);
    const lq = it.ctx.q, lb = f.lastBy[sym], legPct = (w.fastDrop || 2) * 2 ** ((lb && lb.legs) || 0);
    if (!news.length && lb && lb.px && (lb.legs || 0) < 3 && now - lb.t >= E.BUNDLE_MS && it.ctx.alertOk && w.on !== false && lq && lq.c <= lb.px * (1 - legPct/100)) {
      const n = (lb.legs || 0) + 1;
      news.push({id:`${sym}-leg-${n}`, kind:"fast", sym, leg:true, msg:`${sym} is down another ${((1 - lq.c/lb.px)*100).toFixed(1)}% since the ${opts.timeStr ? opts.timeStr(lb.t) : "last"} alert (${E.fmtPx(lb.px)} → ${E.fmtPx(lq.c)})`});
      lb.legs = n;
    }
    if (!news.length) return;
    news.forEach(a => { f.ids[a.id] = 1; (a.also || []).forEach(id => f.ids[id] = 1); });
    news.sort((a, b) => (E.RANK[a.kind] ?? 4) - (E.RANK[b.kind] ?? 4));
    const main = Object.assign({}, news[0]), others = news.slice(1).filter(a => a.kind !== "near").map(a => (E.RULE[a.kind] || {}).short || a.kind);
    if (others.length) main.msg += " · also " + [...new Set(others)].join(", ");
    main.all = news.map(a => ({id:a.id, kind:a.kind, level:a.level}));
    const px = lq && lq.c, last = f.lastBy[sym], leg = (w.fastDrop || 2) / 100;
    const loud = main.kind === "level" || !last || now - last.t > E.BUNDLE_MS || !!(px && last.px && px <= last.px * (1 - leg));
    f.log.unshift({t:now, msg:main.msg, kind:main.kind, sym, quiet:!loud});
    if (f.log.length > 200) f.log.length = 200;
    logged.push(Object.assign({quiet:!loud}, main));
    if (!loud) return;
    if (main.kind !== "near") { f.lastBy[sym] = {t:now, px, legs:(last && last.legs) || 0}; if (!f.unseenSyms.includes(sym)) f.unseenSyms.push(sym); }
    fresh.push(main);
  });
  f.unseen = f.unseenSyms.length;
  return {fired:f, fresh, logged};
};

/* ====================================================================================
   6. Cross-asset tone (a heuristic, not a signal). Each input is z-scored by its own normal daily move,
   so a 3% VIXY day and a 0.3% dollar day count on the same scale. Value hysteresis stops flip-flopping:
   it takes a score past ±1.5 to switch on, and back inside ±0.75 to switch off.
   inputs: {SPY:{dp, vol, r5}, QQQ:..., VIXY, HYG, IEF, UUP, SMH, RSP}; prev = last label key
   ==================================================================================== */
E.tone = function (inp, prev) {
  const z = (k, field) => { const x = inp[k]; if (!x || x[field || "dp"] == null || !x.vol) return null; const v = x[field || "dp"], s = field === "r5" ? x.vol * Math.sqrt(5) : x.vol; return Math.max(-3, Math.min(3, v / s)); };
  const eq = [z("SPY"), z("QQQ")].filter(v => v != null);
  if (!eq.length) return null;
  const parts = [];
  const add = (name, v, wt, txt) => { if (v != null) parts.push({name, v: v * wt, txt}); };
  const eqz = E.mean(eq);
  add("Stocks today", eqz, 1.0, "stocks");
  add("Stocks, 5 days", [z("SPY","r5"), z("QQQ","r5")].filter(v => v != null).length ? E.mean([z("SPY","r5"), z("QQQ","r5")].filter(v => v != null)) : null, 0.5, "stocks over 5 days");
  add("Volatility", z("VIXY") != null ? -z("VIXY") : null, 0.7, "volatility");
  const cr = inp.HYG && inp.IEF && inp.HYG.dp != null && inp.IEF.dp != null && inp.HYG.vol ? Math.max(-3, Math.min(3, (inp.HYG.dp - inp.IEF.dp) / inp.HYG.vol)) : null;
  add("Credit vs Treasuries", cr, 0.7, "credit");
  add("Dollar", z("UUP") != null ? -z("UUP") : null, 0.3, "dollar");
  const ch = inp.SMH && inp.SPY && inp.SMH.dp != null && inp.SPY.dp != null && inp.SMH.vol ? Math.max(-3, Math.min(3, (inp.SMH.dp - inp.SPY.dp) / inp.SMH.vol)) : null;
  add("Chips vs S&P", ch, 0.4, "chips");
  const br = inp.RSP && inp.SPY && inp.RSP.dp != null && inp.SPY.dp != null && inp.RSP.vol ? Math.max(-3, Math.min(3, (inp.RSP.dp - inp.SPY.dp) / inp.RSP.vol)) : null;
  add("Breadth (equal-weight)", br, 0.3, "breadth");
  const wsum = parts.reduce((a, p) => a + Math.abs(p.v), 0), score = parts.reduce((a, p) => a + p.v, 0);
  let k = prev === "on" || prev === "off" ? prev : "mix";
  if (k === "mix") { if (score >= 1.5) k = "on"; else if (score <= -1.5) k = "off"; }
  else if (k === "on") { if (score <= -1.5) k = "off"; else if (score < 0.75) k = "mix"; }
  else if (k === "off") { if (score >= 1.5) k = "on"; else if (score > -0.75) k = "mix"; }
  const why = parts.filter(p => Math.abs(p.v) >= 0.5).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).map(p => `${p.txt} ${p.v > 0 ? "supportive" : "cautious"}`);
  return {k, score, label: k === "on" ? "Risk-on tone" : k === "off" ? "Risk-off tone" : "Mixed tone", parts, why, weight:wsum};
};

/* ====================================================================================
   7. Portfolio risk from price history. positions: [{sym, value}] (stocks/ETFs priced live);
   series: {sym: bars or [{d, c}] newest first}. Aligns on common dates.
   Returns dollar figures for one day, using up to 252 days for the covariance and the whole common
   history for the drawdown of TODAY's mix (a "what if I had held this mix" figure, not your actual past).
   ==================================================================================== */
E.alignCloses = function (series, syms, maxDays) {
  const maps = syms.map(s => { const m = new Map(); (series[s] || []).forEach(x => { const d = Array.isArray(x) ? x[0] : x.d, c = Array.isArray(x) ? x[4] : x.c; if (c > 0) m.set(d, c); }); return m; });
  if (!maps.length || maps.some(m => !m.size)) return {dates:[], closes:[]};
  let dates = [...maps[0].keys()].filter(d => maps.every(m => m.has(d))).sort();
  if (maxDays && dates.length > maxDays) dates = dates.slice(-maxDays);
  return {dates, closes: maps.map(m => dates.map(d => m.get(d)))};
};
E.portfolioRisk = function (positions, series, opts) {
  opts = Object.assign({covDays:252, maxDays:1300, bench:["SPY","SMH"]}, opts || {});
  const pos = positions.filter(p => p.value > 0 && series[p.sym] && series[p.sym].length > 60);
  const total = pos.reduce((a, p) => a + p.value, 0);
  const missing = positions.filter(p => p.value > 0 && !pos.includes(p)).map(p => p.sym);
  if (!pos.length || !(total > 0)) return {ok:false, why:"not enough price history yet", missing};
  const syms = pos.map(p => p.sym), w = pos.map(p => p.value / total);
  const al = E.alignCloses(series, syms, opts.maxDays);
  if (al.dates.length < 61) return {ok:false, why:"the holdings share too little common history", missing};
  const R = al.closes.map(c => { const r = []; for (let i = 1; i < c.length; i++) r.push(c[i]/c[i-1] - 1); return r; });
  const T = R[0].length, start = Math.max(0, T - opts.covDays);
  const Rc = R.map(r => r.slice(start)), n = Rc[0].length, mu = Rc.map(E.mean);
  const cov = Rc.map((ri, i) => Rc.map((rj, j) => { let s = 0; for (let t = 0; t < n; t++) s += (ri[t] - mu[i]) * (rj[t] - mu[j]); return s / (n - 1); }));
  const Sw = cov.map(row => row.reduce((a, c, j) => a + c * w[j], 0));
  const varP = w.reduce((a, wi, i) => a + wi * Sw[i], 0), sdP = Math.sqrt(Math.max(varP, 0));
  const rc = syms.map((s, i) => ({sym:s, weight:w[i], pct: varP > 0 ? w[i] * Sw[i] / varP * 100 : 0}));
  const effBets = 1 / rc.reduce((a, x) => a + (x.pct/100)**2, 0);
  // the current mix replayed over history
  const pr = []; for (let t = 0; t < T; t++) pr.push(w.reduce((a, wi, i) => a + wi * R[i][t], 0));
  const prc = pr.slice(start);
  const q05 = E.quantile(prc, 0.05), worst = prc.filter(x => x <= q05), es = worst.length ? E.mean(worst) : q05;
  let peak = 1, v = 1, mdd = 0, mddAt = null;
  pr.forEach((r, t) => { v *= 1 + r; if (v > peak) peak = v; const dd = v / peak - 1; if (dd < mdd) { mdd = dd; mddAt = al.dates[t + 1]; } });
  const betas = {};
  opts.bench.forEach(b => {
    if (!series[b] || !series[b].length) return;
    const bm = new Map(); series[b].forEach(x => { const d = Array.isArray(x) ? x[0] : x.d, c = Array.isArray(x) ? x[4] : x.c; if (c > 0) bm.set(d, c); });
    const xs = [], ys = [];
    for (let t = Math.max(1, start + 1); t < al.dates.length; t++) { const d0 = al.dates[t-1], d1 = al.dates[t]; if (bm.has(d0) && bm.has(d1)) { xs.push(bm.get(d1)/bm.get(d0) - 1); ys.push(pr[t-1]); } }
    if (xs.length > 60) { const mx = E.mean(xs), my = E.mean(ys); let sxy = 0, sxx = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i]-mx)*(ys[i]-my); sxx += (xs[i]-mx)**2; } betas[b] = sxx ? sxy / sxx : null; }
  });
  return {ok:true, total, days:n, histDays:T, from:al.dates[0], sd1d: sdP * total, sd1dPct: sdP * 100,
    var95: -q05 * total, var95Pct: -q05 * 100, es95: -es * total, es95Pct: -es * 100, mdd: mdd * 100, mddAt, mdd$: mdd * total,
    rc: rc.sort((a, b) => b.pct - a.pct), effBets, betas, missing};
};

/* ====================================================================================
   8. ETF look-through. direct: [{sym, value}]; etf: {ETF: [{sym, w}] with w in % of the fund}.
   Returns exposure per underlying company in $, where it comes from, and how much of each fund is unlisted.
   ==================================================================================== */
E.lookThrough = function (direct, etf) {
  const by = {}, unk = {};
  const add = (s, v, src) => { const o = by[s] || (by[s] = {sym:s, value:0, from:{}}); o.value += v; o.from[src] = (o.from[src] || 0) + v; };
  let total = 0;
  direct.forEach(p => {
    if (!(p.value > 0)) return; total += p.value;
    const h = etf[p.sym];
    if (h && h.length) {
      let covered = 0;
      h.forEach(x => { if (x.w > 0) { add(x.sym, p.value * x.w / 100, p.sym); covered += x.w; } });
      if (covered < 100) unk[p.sym] = p.value * (100 - Math.min(100, covered)) / 100;
    } else add(p.sym, p.value, "direct");
  });
  const rows = Object.values(by).map(o => Object.assign(o, {pct: total ? o.value / total * 100 : 0, sources:Object.keys(o.from).length})).sort((a, b) => b.value - a.value);
  return {total, rows, unlisted:unk, overlap: rows.filter(r => r.sources > 1)};
};
/* parse pasted fund holdings: lines like "NVDA, 20.1%" or "NVIDIA Corp NVDA 20.1" (ticker + a percent) */
E.parseHoldings = function (text) {
  const out = [], seen = new Set();
  String(text || "").split(/\r?\n/).forEach(line => {
    const t = line.replace(/"/g, " ");
    const m = t.match(/\b([A-Z]{1,5}(?:[.\-][A-Z])?)\b[^0-9%\n]*?(\d{1,3}(?:\.\d+)?)\s*%?\s*(?:[,;\t]|$)/);
    if (!m) return; const sym = m[1], w = +m[2];
    if (!(w > 0 && w <= 100) || seen.has(sym) || /^(USD|CASH|ETF|INC|CORP|LTD|CO|THE|CLASS|SHARES|NAME|TICKER|WEIGHT)$/.test(sym)) return;
    seen.add(sym); out.push({sym, w});
  });
  return out;
};

/* ====================================================================================
   9. Opt-in volatility sizing: steadier names get more per level, jumpier names less, within 0.5x to 2x.
   ==================================================================================== */
E.sizeFor = function (base, volPct, refVolPct, lo, hi) {
  if (!(base > 0)) return 0;
  if (!(volPct > 0)) return base;
  const k = Math.max(lo || 0.5, Math.min(hi || 2, (refVolPct || 2) / volPct));
  return Math.round(base * k / 5) * 5;
};
E.concentration = function (curValue, add, total, capPct) {
  const after = total + add > 0 ? (curValue + add) / (total + add) * 100 : 0;
  return {after, over: after > (capPct || 25)};
};

/* ====================================================================================
   10. Rule lab: replay the daily-bar rules over history. bars newest first. For every day a rule would have
   fired, take the fill price (the rule's trigger price, or the open if the day gapped through it) and measure
   the return to the close h sessions later. Compared with buying at every close (baseline) and with buying
   on the first trading day of each month (plain monthly investing).
   ==================================================================================== */
E.ruleLab = function (bars, w, opts) {
  opts = Object.assign({horizons:[5, 20, 60], lookbackStats:70}, opts || {});
  const b = (bars || []).slice().reverse();   // oldest first
  const N = b.length, H = opts.horizons, maxH = Math.max(...H);
  if (N < 300) return {ok:false, why:"needs about 300 trading days of history (has " + N + ")"};
  const closes = b.map(x => x[4]);
  const fwd = (i, px) => H.map(h => i + h < N ? (closes[i + h] / px - 1) * 100 : null);
  const res = {};
  const push = (k, i, px) => { (res[k] = res[k] || []).push({d:b[i][0], px, f:fwd(i, px)}); };
  const lastFired = {};
  for (let i = 260; i < N; i++) {
    const pc = closes[i-1], o = b[i][1], h = b[i][2], l = b[i][3];
    const hist = closes.slice(Math.max(0, i - 251), i).reverse();
    const ve = E.volEstimate(hist), sig = ve.sigma;
    // red day
    if (w.dayDrop) { const trig = pc * (1 - w.dayDrop/100); if (l <= trig) push("red", i, Math.min(o, trig)); }
    if (w.sigDrop && sig) { const trig = pc * (1 - w.sigDrop * sig / 100); if (l <= trig) push("sig", i, Math.min(o, trig)); }
    if (w.hiDrop) { if (l <= h * (1 - w.hiDrop/100)) push("hd", i, h * (1 - w.hiDrop/100)); }
    if (w.offHigh) {
      let hi = 0; for (let j = Math.max(0, i - 252); j < i; j++) hi = Math.max(hi, b[j][2]);
      const trig = hi * (1 - w.offHigh/100), wasIn = pc <= trig;
      if (!wasIn && l <= trig) push("off", i, Math.min(o, trig));
    }
    // auto levels as they would have been set before that open; one fill per level per 20 sessions
    if (w.auto || opts.auto) {
      const past = b.slice(Math.max(0, i - opts.lookbackStats), i).reverse();
      const st = E.dailyStats(past), al = st && E.autoLevels(st);
      (al || []).forEach((x, k) => { const key = "L" + (k+1); if (l <= x.p && (!(key in lastFired) || i - lastFired[key] >= 20)) { lastFired[key] = i; push("auto" + (k+1), i, Math.min(o, x.p)); } });
    }
  }
  const summarize = list => {
    const out = {n:list.length, h:{}};
    H.forEach((hz, j) => { const xs = list.map(x => x.f[j]).filter(v => v != null); out.h[hz] = {n:xs.length, mean:xs.length ? E.mean(xs) : null, median:xs.length ? E.median(xs) : null, hit:xs.length ? xs.filter(v => v > 0).length / xs.length * 100 : null}; });
    out.last = list.length ? list[list.length - 1].d : null;
    return out;
  };
  const base = []; for (let i = 260; i < N; i++) base.push({d:b[i][0], px:closes[i], f:fwd(i, closes[i])});
  const monthly = []; let lastM = "";
  for (let i = 260; i < N; i++) { const m = b[i][0].slice(0, 7); if (m !== lastM) { lastM = m; monthly.push({d:b[i][0], px:b[i][1], f:fwd(i, b[i][1])}); } }
  const rules = {}; Object.keys(res).forEach(k => rules[k] = summarize(res[k]));
  return {ok:true, from:b[260][0], to:b[N-1][0], days:N - 260, rules, baseline:summarize(base), monthly:summarize(monthly), horizons:H, maxH};
};

/* ====================================================================================
   11. Alert journal. One record per announced alert; outcomes are filled from later daily closes.
   ==================================================================================== */
E.journalRecord = function (alert, ctx, w, now, day) {
  const q = ctx.q || {};
  return {id: alert.id + "@" + day, alertId: alert.id, day, t: now, sym: alert.sym, kind: alert.kind,
    kinds: (alert.all || [{kind:alert.kind}]).map(x => x.kind).filter(k => k !== "near"), level: alert.level ?? null, px: q.c, dp: q.dp ?? null,
    src: q.src || "finnhub", tradeT: q.t || null, msg: alert.msg, vol: ctx.vol ?? null,
    params: {dayDrop:w.dayDrop ?? null, sigDrop:w.sigDrop ?? null, hiDrop:w.hiDrop ?? null, offHigh:w.offHigh ?? null, fastDrop:w.fastDrop ?? null, fastMins:w.fastMins ?? null, auto:!!w.auto},
    action: null, outcomes: null};
};
/* closes: [{d, c}] newest first for the alert's symbol. Returns {r1, r5, r20, mae20 (worst close within 20), done} */
E.outcomes = function (rec, closes) {
  const after = closes.filter(x => x.d > rec.day).slice().reverse();   // oldest first
  const at = n => after.length >= n ? (after[n-1].c / rec.px - 1) * 100 : null;
  const win = after.slice(0, 20);
  return {r1:at(1), r5:at(5), r20:at(20), mae20: win.length ? (Math.min(...win.map(x => x.c)) / rec.px - 1) * 100 : null, n:after.length, done: after.length >= 20};
};
/* per-rule scorecard from journal records (with outcomes) and, for context, the same symbols' unconditional returns */
E.scorecard = function (records) {
  const by = {};
  records.forEach(r => { (r.kinds || [r.kind]).forEach(k => { (by[k] = by[k] || []).push(r); }); });
  const rows = Object.keys(by).map(k => {
    const rs = by[k], col = f => rs.map(r => r.outcomes && r.outcomes[f]).filter(v => v != null);
    const r5 = col("r5"), r20 = col("r20"), mae = col("mae20");
    return {kind:k, name:(E.RULE[k] || {}).name || k, n:rs.length, bought:rs.filter(r => r.action === "bought").length, skipped:rs.filter(r => r.action === "skipped").length,
      r5:r5.length ? E.mean(r5) : null, r20:r20.length ? E.mean(r20) : null, hit20:r20.length ? r20.filter(v => v > 0).length / r20.length * 100 : null, n20:r20.length, mae:mae.length ? E.mean(mae) : null};
  });
  return rows.sort((a, b) => (E.RANK[a.kind] ?? 9) - (E.RANK[b.kind] ?? 9));
};

/* ====================================================================================
   12. Data budget (Twelve Data free plan: 800 credits a day, 8 a minute) and a Finnhub circuit breaker.
   ledger: {date, n, by:{cat:n}}. Each category has a share of the day; a call outside its share is refused
   so one feature can't starve the others. Credits are charged when a call succeeds or is answered.
   ==================================================================================== */
E.TD_DAILY = 800;
E.TD_CAPS = {hist:280, vwap:160, backup:120, nav:80, intraday:60, chart:40, xcheck:40, other:20};
E.budgetFresh = (ledger, day) => (ledger && ledger.date === day) ? ledger : {date:day, n:0, by:{}};
E.budgetAllow = function (ledger, cat, cost, caps) {
  caps = caps || E.TD_CAPS; cost = cost || 1;
  const used = ledger.by[cat] || 0, cap = caps[cat] ?? caps.other;
  if (ledger.n + cost > E.TD_DAILY - 10) return {ok:false, why:"daily limit almost used (" + ledger.n + " of " + E.TD_DAILY + ")"};
  if (used + cost > cap) return {ok:false, why:cat + " share used (" + used + " of " + cap + ")"};
  return {ok:true, why:""};
};
E.budgetCharge = function (ledger, cat, cost) {
  const l = {date:ledger.date, n:ledger.n + (cost || 1), by:Object.assign({}, ledger.by)};
  l.by[cat] = (l.by[cat] || 0) + (cost || 1); return l;
};
/* rough end-of-day projection: history loads once in the morning, so only the other features are extrapolated
   from the pace of the session so far */
E.budgetProjection = function (ledger, sessFrac) {
  const once = ledger.by.hist || 0, rest = ledger.n - once;
  if (!(sessFrac > 0.05)) return ledger.n;
  return Math.round(once + rest / Math.min(1, sessFrac));
};
/* after 3 failures in a row the breaker opens for 1, 2, 4 ... up to 15 minutes; one success closes it */
E.breaker = function (st, ok, now) {
  st = Object.assign({fails:0, openUntil:0, trips:0}, st || {});
  if (ok) return {fails:0, openUntil:0, trips:0};
  st.fails++;
  if (st.fails >= 3) { st.trips++; st.openUntil = now + Math.min(15, 2 ** (st.trips - 1)) * 60e3; st.fails = 0; }
  return st;
};
E.breakerOpen = (st, now) => !!(st && st.openUntil > now);

/* coverage: of the watchlist symbols that matter right now, how many have a price that can alert */
E.coverage = function (syms, verdicts) {
  const ok = syms.filter(s => verdicts[s] && verdicts[s].ok);
  return {ok:ok.length, total:syms.length, pct: syms.length ? ok.length / syms.length * 100 : 100, blind: syms.filter(s => !(verdicts[s] && verdicts[s].ok))};
};
/* MW watching state machine: "watching" -> "blind" after blindMins with coverage under 50% during market hours,
   and back to "watching" when coverage recovers. Returns {state, changed, since}. */
E.watchState = function (prev, cov, now, ses, blindMins) {
  prev = prev || {state:"watching", since:now, lowSince:null};
  blindMins = blindMins || 10;
  if (ses.s !== "open") return {state:"watching", since: prev.state === "watching" ? prev.since : now, lowSince:null, changed: prev.state !== "watching" && prev.state !== "off", quiet:true};
  const low = cov.total > 0 && cov.pct < 50;
  const lowSince = low ? (prev.lowSince || now) : null;
  if (prev.state === "watching" && low && now - lowSince >= blindMins * 60e3) return {state:"blind", since:now, lowSince, changed:true};
  if (prev.state === "blind" && !low) return {state:"watching", since:now, lowSince:null, changed:true};
  return {state:prev.state, since:prev.since, lowSince, changed:false};
};

/* ====================================================================================
   13. Config versions. v2 = the lab's format. migrate() never drops a field it doesn't know.
   ==================================================================================== */
E.CFG_V = 2;
E.migrate = function (c) {
  c = JSON.parse(JSON.stringify(c || {}));
  c.holdings = Array.isArray(c.holdings) ? c.holdings : [];
  c.fixed = Array.isArray(c.fixed) ? c.fixed : [];
  c.watch = Array.isArray(c.watch) ? c.watch : [];
  c.hiddenMk = Array.isArray(c.hiddenMk) ? c.hiddenMk : [];
  c.myMk = Array.isArray(c.myMk) ? c.myMk : [];
  c.etf = c.etf && typeof c.etf === "object" ? c.etf : {};
  if (!c.v || c.v < 2) {
    // v1 (live MW): VWAP was on unless turned off; in the lab it is opt-in
    c.watch.forEach(w => { if (w.vwapOn !== true) w.vwapOn = false; });
    c.v = 2;
  }
  c.watch.forEach(w => { if (w.sym) w.sym = String(w.sym).toUpperCase(); if (!Array.isArray(w.levels)) w.levels = []; });
  c.holdings.forEach(h => { if (h.sym) h.sym = String(h.sym).toUpperCase(); });
  return c;
};
E.validCfg = c => !!(c && Array.isArray(c.holdings) && Array.isArray(c.watch));
/* what a restore or setup link would change, in words */
E.cfgDiff = function (a, b) {
  const n = c => ({h:(c.holdings || []).length, f:(c.fixed || []).length, w:(c.watch || []).length});
  const x = n(a || {}), y = n(b || {});
  return `holdings ${x.h} → ${y.h}, funds and cash ${x.f} → ${y.f}, watchlist ${x.w} → ${y.w}`;
};

/* phone alert text: minimal by default (no tickers, prices or levels leave the PC) */
E.ntfyBody = function (list, full, app) {
  if (full) return list.map(a => a.msg).join("\n");
  const n = list.length, nm = app || "MW";
  return n === 1 ? nm + " has a new alert. Open " + nm + " for details." : nm + " has " + n + " new alerts. Open " + nm + " for details.";
};


/* ====================================================================================
   10. Macro calendar (4.4). Official schedules, read 2026-11-06:
   FOMC: federalreserve.gov/monetarypolicy/fomccalendars.htm (decision at 2:00 PM ET on the last meeting day;
         2027 dates are tentative until confirmed at the meeting before).
   CPI, jobs report, PPI: bls.gov/schedule/news_release/cpi.htm, empsit.htm, ppi.htm (8:30 AM ET).
   GDP and PCE (Personal Income and Outlays): bea.gov/news/schedule and /next-year (8:30 AM ET, same day).
   Past MACRO_VALID_TO MW says "check the schedule" instead of guessing (CI test fails a month before).
   ==================================================================================== */
E.MACRO_VALID_TO = "2027-12-31";
E.MACRO_KINDS = {
  fomc: {mins:840, name:"FOMC decision", tip:"The Fed's interest-rate decision: statement at 2:00 PM ET, press conference at 2:30."},
  cpi:  {mins:510, name:"CPI", tip:"Consumer prices (inflation) for last month, 8:30 AM ET."},
  jobs: {mins:510, name:"Jobs report", tip:"Payrolls and the unemployment rate, 8:30 AM ET."},
  ppi:  {mins:510, name:"PPI", tip:"Producer (wholesale) prices for last month, 8:30 AM ET."},
  gdp:  {mins:510, name:"GDP + PCE", tip:"GDP and the PCE inflation gauge the Fed watches most, 8:30 AM ET."}
};
E.MACRO_DATES = {
  fomc: ["2026-12-09","2027-01-27","2027-03-17","2027-04-28","2027-06-09","2027-07-28","2027-09-15","2027-11-17","2028-01-26"],   // 2027 revised by the Fed on 2026-11-12: Oct 26-27 is strategy-only (no decision), last decision Nov 17
  cpi:  ["2026-11-10","2026-12-10","2027-01-13","2027-02-11","2027-03-10","2027-04-13","2027-05-12","2027-06-10","2027-07-14","2027-08-11","2027-09-14","2027-10-14","2027-11-10","2027-12-10"],
  jobs: ["2026-11-06","2026-12-04","2027-01-08","2027-02-05","2027-03-05","2027-04-02","2027-05-07","2027-06-04","2027-07-02","2027-08-06","2027-09-03","2027-10-08","2027-11-05","2027-12-03"],
  ppi:  ["2026-11-13","2026-12-15","2027-01-14","2027-02-12","2027-03-12","2027-04-14","2027-05-13","2027-06-11","2027-07-15","2027-08-10","2027-09-10","2027-10-15","2027-11-12","2027-12-15"],
  gdp:  ["2026-11-25","2026-12-23","2027-01-28","2027-02-25","2027-03-31","2027-04-29","2027-05-27","2027-06-25","2027-07-29","2027-08-25","2027-09-30","2027-10-28","2027-11-24","2027-12-22"]
};
E.MACRO = [];
Object.keys(E.MACRO_DATES).forEach(k => E.MACRO_DATES[k].forEach(d => E.MACRO.push({k, d, mins:E.MACRO_KINDS[k].mins, name:E.MACRO_KINDS[k].name, tip:E.MACRO_KINDS[k].tip, t:E.etMs(d, E.MACRO_KINDS[k].mins)})));
E.MACRO.sort((a, b) => a.t - b.t || a.name.localeCompare(b.name));
/* upcoming events: anything not yet released, plus today's for an hour after release ("just out").
   {list:[{...ev, past}], expired} where expired = we are past the end of the table */
E.nextMacro = function (now, n) {
  const today = E.etDateOf(now), expired = today > E.MACRO_VALID_TO;
  const list = E.MACRO.filter(ev => ev.t >= now - 60*60e3).slice(0, n || 3).map(ev => Object.assign({}, ev, {past: ev.t <= now, today: ev.d === today}));
  return {list, expired};
};

/* ====================================================================================
   11. Two price feeds (4.4). Finnhub (consolidated, about every 60 s) and Alpaca's free IEX feed
   (one exchange, every few seconds). The newer trade sets the price; Finnhub's previous close, open,
   high and low win when it has them (IEX alone sees only part of the day's trading).
   ==================================================================================== */
E.mergeQuote = function (prev, inc, sameDay) {
  if (!inc || !(inc.c > 0)) return prev;
  if (!prev || !sameDay || !(prev.c > 0)) { const o = Object.assign({}, inc); if (o.pc > 0) { o.d = o.c - o.pc; o.dp = (o.c / o.pc - 1) * 100; } return o; }
  const out = Object.assign({}, prev);
  if (!(prev.t > 0) || (inc.t || 0) >= prev.t) { out.c = inc.c; out.t = inc.t; out.src = inc.src; }
  if (inc.src !== "alpaca") ["pc", "o", "h", "l"].forEach(k => { if (inc[k] > 0) out[k] = inc[k]; });
  else { if (!(out.pc > 0) && inc.pc > 0) out.pc = inc.pc; if (!(out.o > 0) && inc.o > 0) out.o = inc.o; }
  out.h = Math.max(out.h > 0 ? out.h : out.c, out.c);
  out.l = Math.min(out.l > 0 ? out.l : out.c, out.c);
  if (out.pc > 0) { out.d = out.c - out.pc; out.dp = (out.c / out.pc - 1) * 100; }
  return out;
};
/* one Alpaca snapshot -> {reg: a quote for the regular session (or null), ext: {p, t (ms), ph:"pre"|"after"} (or null)} */
E.fromSnapshot = function (snap, now) {
  const lt = snap && snap.latestTrade; if (!lt || !(lt.p > 0)) return {reg:null, ext:null};
  const tms = Date.parse(lt.t), today = E.etDateOf(now); if (!isFinite(tms)) return {reg:null, ext:null};
  const tp = E.etParts(tms), close = E.closeMins(tp.date), db = snap.dailyBar, pdb = snap.prevDailyBar;
  const dbToday = db && E.etDateOf(Date.parse(db.t)) === today;
  if (tp.date === today && E.isTradingDay(today) && tp.mins >= 570 && tp.mins < close)
    return {reg:{c:+lt.p, t:Math.floor(tms / 1000), pc: dbToday && pdb ? +pdb.c : db ? +db.c : null, o: dbToday ? +db.o : null, h: dbToday ? +db.h : null, l: dbToday ? +db.l : null, src:"alpaca"}, ext:null};
  // a pre-market or after-hours trade, today's or (over a night, weekend or holiday) the last one there was
  if (tp.date <= today && (tp.mins < 570 || tp.mins >= close) && tp.mins >= 240 && tp.mins < 1200)
    return {reg:null, ext:{p:+lt.p, t:tms, ph: tp.mins < 570 ? "pre" : "after"}};
  return {reg:null, ext:null};
};
/* the regular session a quote belongs to: the date of its last trade, or the trading day before when that trade
   is stamped before the open or on a closed day (some feeds stamp the close with the time it was fetched) */
E.quoteDay = function (tms) {
  if (!(tms > 0)) return null;
  const p = E.etParts(tms); let d = p.date;
  if (!E.isTradingDay(d) || p.mins < 570) { d = E.addDays(d, -1); for (let i = 0; i < 10 && !E.isTradingDay(d); i++) d = E.addDays(d, -1); }
  return d;
};
/* 4.8: is this pre-market or after-hours trade newer than the regular close in q, so it is the latest known price?
   An after-hours trade counts on the day of that close, a pre-market trade on a later day. It stays the latest
   price over the night, the weekend or a holiday, until the next session's trades replace it. Never during the
   regular session, when the regular price is the latest. */
E.extLive = function (e, q, sessionS) {
  if (!e || !(e.p > 0) || !q || !(q.c > 0) || sessionS === "open") return false;
  const qd = E.quoteDay(q.t ? q.t * 1000 : q.at), ed = E.etDateOf(e.t);
  if (!qd) return false;
  return e.ph === "after" ? ed === qd : e.ph === "pre" ? ed > qd : false;
};

/* price alert repeat and expiry (4.5). Per ticker: w.lvRepeat = "day" (default: each alert once a day), "once" (fires
   once, then MW removes it) or "cross" (every time the price comes back down through it, at least 30 minutes after the
   last time, and only after it climbed 0.3% back above). w.lvUntil = "YYYY-MM-DD": the last day price alerts are on. */
E.LV_REARM_MS = 30*60e3; E.LV_REARM_PCT = 0.3;
E.levelsLive = function (w, today) { return !(w && w.lvUntil && today > w.lvUntil); };
/* one level's crossing memory {n, below, t} -> the next one, given the price now; the alert id carries "#n" */
E.levelCross = function (st, L, px, now) {
  const s = Object.assign({n:0, below:false, t:0}, st || {});
  if (!(px > 0)) return s;
  if (px <= L) { if (!s.below) { s.below = true; s.t = now; } }
  else if (s.below && px > L * (1 + E.LV_REARM_PCT / 100) && now - s.t >= E.LV_REARM_MS) { s.below = false; s.n++; }
  return s;
};

/* earnings-day moves (4.5), estimated from daily bars: for each reported quarter (its period end date), the report day
   is taken as the biggest opening gap 14 to 75 days after the quarter ended (US companies report 3 to 8 weeks
   after). bars: [[date, o, h, l, c, v], ...] newest first. Returns [{period, d, move (close-to-close %)}] */
E.erMoves = function (bars, periods) {
  const asc = (bars || []).slice().reverse(), out = [];
  (periods || []).forEach(p => {
    const a = E.addDays(p, 14), b = E.addDays(p, 75); let best = null;
    for (let i = 1; i < asc.length; i++) {
      const d = asc[i][0]; if (d < a) continue; if (d > b) break;
      const pc = asc[i - 1][4]; if (!(pc > 0)) continue;
      const gap = Math.abs(asc[i][1] / pc - 1);
      if (!best || gap > best.gap) best = {d, gap, move:(asc[i][4] / pc - 1) * 100};
    }
    // a quarter counts once the bars cover its whole window, or show a clear 3%+ gap with a few days after it
    const last = asc.length ? asc[asc.length - 1][0] : "";
    if (best && (last > b || (best.gap >= 0.03 && last > E.addDays(best.d, 5)))) out.push({period:p, d:best.d, move:best.move});
  });
  return out;
};

/* a pasted list of tickers (4.4): commas, spaces, semicolons or new lines; "NASDAQ:MU" and "$MU" become MU.
   Returns {ok:[unique tickers in order], bad:[tokens that don't look like a ticker]} */
E.parseTickers = function (text) {
  const ok = [], bad = [];
  String(text || "").split(/[\s,;]+/).forEach(tok => {
    if (!tok) return;
    const t = tok.toUpperCase().replace(/^[A-Z]+:/, "").replace(/^\$/, "");
    if (/^[A-Z][A-Z0-9]{0,5}([.\-][A-Z0-9]{1,2})?$/.test(t)) { if (!ok.includes(t)) ok.push(t); }
    else if (!bad.includes(tok)) bad.push(tok);
  });
  return {ok, bad};
};

/* ====================================================================================
   17. Mutual funds (5.0). A fund has one price a day (its NAV), struck at the close and posted that evening or,
   on some feeds, the next morning. MW asks every source it has and keeps the newest answer; between official
   prices it can show an ESTIMATE from the ETF the fund has tracked most closely, always labelled as one.
   ==================================================================================== */
/* US mutual fund tickers are five letters ending in X (money-market funds end in XX) */
E.isFundSym = s => /^[A-Z]{4}X$/.test(String(s || ""));
/* the session a "today" change belongs to: today once the open has passed, otherwise the last trading day */
E.lastSessionDate = function (now) {
  const t = E.etParts(now);
  return E.isTradingDay(t.date) && t.mins >= 570 ? t.date : E.prevTradingDay(t.date);
};
/* the newest date a fund price can exist for: today once the close has passed, otherwise the last trading day */
E.navDueDate = function (now) {
  const t = E.etParts(now);
  return E.isTradingDay(t.date) && t.mins >= E.closeMins(t.date) ? t.date : E.prevTradingDay(t.date);
};
/* choose between sources. cands: [{src, nav, prev, date:"YYYY-MM-DD"}] in order of preference; the newest date wins,
   an equal date keeps the earlier (preferred) source. old = the price MW already holds, used for the day before
   when the winner doesn't say. Returns null when nothing usable came back. */
E.pickNav = function (cands, old) {
  const ok = (cands || []).filter(c => c && c.nav > 0 && /^\d{4}-\d\d-\d\d$/.test(c.date || ""));
  if (!ok.length) return null;
  let best = ok[0]; ok.forEach(c => { if (c.date > best.date) best = c; });
  let prev = best.prev > 0 ? best.prev : null, prevDate = null;
  if (!prev) {   // the day before, from another source's (older) answer or from what MW had
    const older = ok.filter(c => c.date < best.date).concat(old && old.nav > 0 && old.date < best.date ? [old] : []).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (older) { prev = older.nav; prevDate = older.date; }
  }
  const same = ok.filter(c => c !== best && c.date === best.date), off = same.find(c => Math.abs(c.nav / best.nav - 1) > 0.02);
  return {nav:best.nav, prev, prevDate, date:best.date, src:best.src, tried:ok.map(c => c.src + " " + c.date), disagree: off ? `${off.src} says ${off.nav} for ${off.date}` : ""};
};
/* how long to wait before asking again (ms). due = E.navDueDate(now). Behind in the evening (4:30 pm to midnight
   New York) or the next morning: ask often; otherwise rarely. fast = a source with no daily limit is available. */
E.navWait = function (date, now, fast) {
  const due = E.navDueDate(now), t = E.etParts(now);
  if (date && date >= due) return 6 * 3600e3;                         // up to date: nothing new can exist yet
  const evening = E.isTradingDay(t.date) && t.mins >= E.closeMins(t.date) + 30;
  if (evening) return (fast ? 10 : 45) * 60e3;                          // today's price is being posted about now
  return (fast ? 20 : 60) * 60e3;                                       // still behind the morning after: keep trying
};
/* which ETF has this fund moved with? Single-factor least squares on daily returns over the last `days` sessions
   both have. fundBars and pool[sym]: bars newest first ([date,o,h,l,c,v]) or [{d,c}]. Returns the best fit
   {sym, beta, r2, n} or null when there isn't enough shared history. */
E.proxyFit = function (fundBars, pool, opts) {
  opts = Object.assign({days:120, min:40}, opts || {});
  let best = null;
  Object.keys(pool || {}).forEach(sym => {
    const A = E.alignCloses({f:fundBars, p:pool[sym]}, ["f", "p"], opts.days + 1);
    if (A.dates.length < opts.min + 1) return;
    const rf = [], rp = [];
    for (let i = 1; i < A.dates.length; i++) { rf.push(A.closes[0][i] / A.closes[0][i-1] - 1); rp.push(A.closes[1][i] / A.closes[1][i-1] - 1); }
    const mf = E.mean(rf), mp = E.mean(rp); let cov = 0, vf = 0, vp = 0;
    for (let i = 0; i < rf.length; i++) { cov += (rf[i] - mf) * (rp[i] - mp); vf += (rf[i] - mf) ** 2; vp += (rp[i] - mp) ** 2; }
    if (!(vf > 0) || !(vp > 0)) return;
    const beta = cov / vp, r2 = cov * cov / (vf * vp);
    if (beta > 0 && (!best || r2 > best.r2)) best = {sym, beta:+beta.toFixed(3), r2:+r2.toFixed(3), n:rf.length};
  });
  return best;
};
/* the fund's estimated move since its last official price: beta x the ETF's move since that same day's close.
   proxyBars newest first; proxyNow = the ETF's latest regular price. Returns {pct, nav, from} or null. */
E.navEstimate = function (nav, navDate, fit, proxyBars, proxyNow, prev) {
  if (!(nav > 0) || !fit || !(proxyNow > 0)) return null;
  let c = null;
  // the ETF's close on the day of the fund's price: yesterday's close from its live quote when that is the day, else its daily bars
  if (prev && prev.d === navDate && prev.c > 0) c = prev.c;
  else if (proxyBars) { const bar = proxyBars.find(b => (Array.isArray(b) ? b[0] : b.d) <= navDate);
    if (bar && (Array.isArray(bar) ? bar[0] : bar.d) === navDate) c = Array.isArray(bar) ? bar[4] : bar.c; }
  if (!(c > 0)) return null;   // no ETF close for that exact day: don't guess
  const pct = fit.beta * (proxyNow / c - 1) * 100;
  if (!isFinite(pct) || Math.abs(pct) > 25) return null;
  return {pct, nav: nav * (1 + pct / 100), from: c};
};

/* ====================================================================================
   18. News (5.0). One list from many per-ticker answers: the same story reported for several of your tickers
   becomes one line that lists them; newest first; old lines dropped.
   items: [{id, sym, h, sum, src, url, t (ms), cat}]. Returns [{id, syms:[...], h, sum, src, url, t, cat}].
   ==================================================================================== */
E.newsKey = h => String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);
E.newsMerge = function (items, now, opts) {
  opts = Object.assign({max:80, maxAgeMs:4 * 864e5}, opts || {});
  const by = new Map();
  (items || []).forEach(n => {
    if (!n || !n.h || !/^https?:\/\//.test(n.url || "") || !(n.t > 0) || (now && now - n.t > opts.maxAgeMs)) return;
    const k = E.newsKey(n.h); if (!k) return;
    const cur = by.get(k);
    if (!cur) { by.set(k, {id:String(n.id || k), syms:n.sym ? [n.sym] : [], h:String(n.h).trim().slice(0, 240), sum:String(n.sum || "").trim().slice(0, 600), src:String(n.src || "").slice(0, 40), url:n.url, t:n.t, cat:n.cat || (n.sym ? "company" : "market")}); return; }
    if (n.sym && !cur.syms.includes(n.sym)) cur.syms.push(n.sym);
    if (n.sym) cur.cat = "company";
    if (!cur.sum && n.sum) cur.sum = String(n.sum).trim().slice(0, 600);
    if (n.t < cur.t) cur.t = n.t;   // the first time the story appeared
  });
  return [...by.values()].sort((a, b) => b.t - a.t).slice(0, opts.max);
};
/* "12m", "3h", "2d" */
E.agoShort = function (t, now) { const m = Math.max(0, Math.round((now - t) / 60e3)); return m < 1 ? "now" : m < 60 ? m + "m" : m < 1440 ? Math.round(m / 60) + "h" : Math.round(m / 1440) + "d"; };

/* ====================================================================================
   19. Market map (6.1). About 200 funds in eleven panels, each split into groups, drawn as nested treemaps.
   Universe line format: "SYM size Name", where size is the fund's rough size in billions of dollars (rounded,
   approximate, mid-2026; used ONLY for tile area, never shown as a figure) and an optional leverage tag in the
   name ("3x", "-1x"). Spot coins (BTC/USD...) are sized against each other, scaled to sit beside the funds.
   ==================================================================================== */
E.MAP_SRC = [
  ["us", "US", 2, [
    ["Index", "VOO 750 Vanguard S&P 500|SPY 700 SPDR S&P 500|IVV 700 iShares Core S&P 500|VTI 550 Total US market|QQQ 400 Nasdaq 100|RSP 80 Equal-weight S&P 500|SCHX 60 Schwab US large cap|IWB 45 Russell 1000|DIA 38 Dow 30|OEF 25 S&P 100|IWV 18 Russell 3000"],
    ["Inverse", "SQQQ 3 Nasdaq 100 -3x|SH 1.2 S&P 500 -1x|SPXS 0.6 S&P 500 -3x|PSQ 0.6 Nasdaq 100 -1x|SPXU 0.5 S&P 500 -3x|SDS 0.5 S&P 500 -2x|QID 0.3 Nasdaq 100 -2x|DOG 0.15 Dow -1x"],
    ["Leverage", "TQQQ 28 Nasdaq 100 3x|QLD 9 Nasdaq 100 2x|SSO 7 S&P 500 2x|SPXL 6 S&P 500 3x|UPRO 4.5 S&P 500 3x|UDOW 0.8 Dow 3x"],
    ["Dividend", "VIG 95 Dividend growth|SCHD 72 Schwab US dividend|VYM 65 High dividend yield|DGRO 34 iShares dividend growth|DVY 20 Select dividend|SDY 20 Dividend aristocrats (S&P 1500)|NOBL 12 Dividend aristocrats|HDV 12 High dividend"]]],
  ["sector", "US sectors", 2, [
    ["Technology", "VGT 110 Vanguard info tech|XLK 85 Technology|IGV 10 Software|TECL 4 Technology 3x"],
    ["Financials", "XLF 52 Financials|VFH 13 Vanguard financials|KRE 4 Regional banks|KBE 2 Banks"],
    ["Health care", "XLV 37 Health care|VHT 17 Vanguard health care|XBI 7 Biotech|IBB 6 Biotech (large)"],
    ["Energy", "XLE 27 Energy|VDE 7 Vanguard energy|XOP 2 Oil & gas producers|OIH 1.3 Oil services"],
    ["Communication", "XLC 25 Communication|VOX 5.5 Vanguard communication"],
    ["Consumer cyclical", "XLY 23 Consumer discretionary|VCR 6.5 Vanguard discretionary|ITB 2.5 Home construction|XHB 2 Homebuilders|XRT 0.4 Retail"],
    ["Industrials", "XLI 23 Industrials|ITA 9 Aerospace & defense|VIS 6.5 Vanguard industrials|JETS 1 Airlines"],
    ["Utilities", "XLU 20 Utilities|VPU 8 Vanguard utilities"],
    ["Staples", "XLP 16 Consumer staples|VDC 7.5 Vanguard staples"],
    ["Real estate", "VNQ 34 Real estate|XLRE 7.5 Real estate (S&P)|IYR 3.7 iShares real estate"],
    ["Materials", "XLB 5 Materials|VAW 3 Vanguard materials|XME 2.5 Metals & mining"]]],
  ["intl", "International", 2, [
    ["Developed", "VEA 160 Developed markets|IEFA 145 Core developed|EFA 63 EAFE|EFV 26 Developed value|EFG 13 Developed growth|SCZ 10 Developed small caps"],
    ["Emerging", "IEMG 100 Core emerging|VWO 95 Emerging markets|EEM 20 iShares emerging"],
    ["Global ex-US", "VXUS 95 Total international|VEU 65 All-world ex-US|IXUS 48 Core total international"],
    ["Asia-Pacific", "EWJ 15 Japan|INDA 10 India|EWT 6.5 Taiwan|EWY 5.5 South Korea|EWA 1.5 Australia"],
    ["Europe", "VGK 26 Europe|EZU 8 Eurozone|EWU 3 United Kingdom|EWG 2 Germany"],
    ["China", "FXI 7 China large caps|MCHI 7 MSCI China|KWEB 7 China internet"],
    ["Americas", "EWZ 5 Brazil|EWC 3 Canada|EWW 1.5 Mexico"]]],
  ["large", "US large cap", 1, [
    ["Growth", "VUG 190 Vanguard growth|IWF 120 Russell 1000 growth|IVW 63 S&P 500 growth|SCHG 48 Schwab large growth|SPYG 42 SPDR S&P 500 growth|MGK 30 Mega-cap growth"],
    ["Value", "VTV 145 Vanguard value|IWD 64 Russell 1000 value|IVE 41 S&P 500 value|SPYV 29 SPDR S&P 500 value|SCHV 13 Schwab large value|VOOV 6 Vanguard S&P 500 value"]]],
  ["small", "US small cap", 1, [
    ["Blend", "IJR 86 S&P 600|IWM 72 Russell 2000|VB 67 Vanguard small cap|SCHA 19 Schwab small cap|VTWO 13 Vanguard Russell 2000"],
    ["Value", "VBR 32 Small value|AVUV 18 Avantis small value|IWN 12 Russell 2000 value"],
    ["Growth", "VBK 21 Small growth|IWO 13 Russell 2000 growth"],
    ["Leverage", "TNA 2.2 Small caps 3x|UWM 0.4 Russell 2000 2x"],
    ["Inverse", "TZA 0.4 Small caps -3x|RWM 0.15 Russell 2000 -1x|TWM 0.05 Russell 2000 -2x"]]],
  ["mid", "US mid cap", 1, [
    ["Blend", "IJH 100 S&P 400|VO 90 Vanguard mid cap|IWR 45 Russell mid cap|MDY 24 SPDR S&P 400|SCHM 12 Schwab mid cap"],
    ["Growth", "IWP 21 Mid growth (Russell)|VOT 18 Vanguard mid growth|IJK 9 S&P 400 growth"],
    ["Value", "VOE 19 Vanguard mid value|IWS 14 Mid value (Russell)|IJJ 8 S&P 400 value"]]],
  ["global", "Global themes", 2, [
    ["Semiconductors", "SMH 33 Semiconductors (VanEck)|SOXX 15 Semiconductors (iShares)|SOXL 13 Semiconductors 3x|SOXS 1 Semiconductors -3x"],
    ["Tech & AI", "CIBR 10 Cybersecurity|ARKK 6 ARK Innovation|AIQ 4 AI & big data|BOTZ 3 Robotics & AI"],
    ["Gold & silver miners", "GDX 20 Gold miners|GDXJ 7 Junior gold miners|SIL 2 Silver miners"],
    ["Power & resources", "GRID 4 Power grid|URA 4 Uranium|COPX 3 Copper miners|ICLN 1.5 Clean energy|TAN 1 Solar"],
    ["World index", "VT 55 Total world|ACWI 24 All-country world"]]],
  ["bonds", "Fixed income", 2, [
    ["Cash & short", "SGOV 55 0-3 month T-bills|BIL 42 1-3 month T-bills|VGSH 27 Short Treasury (Vanguard)|SHY 24 1-3 year Treasury|SHV 21 Short Treasury"],
    ["Treasuries", "VGIT 37 Intermediate Treasury|TLT 55 20+ year Treasury|IEF 35 7-10 year Treasury|GOVT 32 All Treasuries|IEI 16 3-7 year Treasury|TLH 12 10-20 year Treasury"],
    ["Corporate", "VCIT 57 Intermediate corporate|VCSH 46 Short corporate|LQD 32 Investment-grade corporate|HYG 17 High yield|USIG 15 Broad corporate|VCLT 11 Long corporate|JNK 8 High yield (SPDR)"],
    ["Broad", "BND 135 Total bond market|AGG 130 Core US bond|BNDX 70 International bond"],
    ["Inflation-linked", "VTIP 16 Short TIPS|TIP 14 TIPS|SCHP 14 Schwab TIPS"],
    ["Mortgages", "MBB 40 Mortgage-backed"],
    ["Muni & sovereign", "VTEB 42 Tax-exempt munis|MUB 41 National munis|EMB 15 Emerging market bonds"]]],
  ["cmdty", "Commodities", 1, [
    ["Gold", "GLD 130 Gold (SPDR)|IAU 55 Gold (iShares)|GLDM 18 Gold mini"],
    ["Silver", "SLV 20 Silver|SIVR 2.5 Silver (abrdn)"],
    ["Energy", "USO 1.2 Crude oil|UNG 0.8 Natural gas|BNO 0.25 Brent crude"],
    ["Broad", "PDBC 4.5 Diversified commodities|DBC 1.4 Commodity index|DBA 0.8 Agriculture|CPER 0.3 Copper"],
    ["Leverage", "AGQ 1 Silver 2x|UCO 0.6 Crude oil 2x|UGL 0.5 Gold 2x|SCO 0.1 Crude oil -2x"]]],
  ["crypto", "Crypto", 1, [
    ["Bitcoin funds", "IBIT 85 iShares Bitcoin|FBTC 22 Fidelity Bitcoin|GBTC 17 Grayscale Bitcoin|ARKB 4.5 ARK Bitcoin|BITB 4.5 Bitwise Bitcoin|BITO 2.3 Bitcoin futures"],
    ["Ether funds", "ETHA 12 iShares Ethereum|ETHE 3 Grayscale Ethereum|FETH 2.5 Fidelity Ethereum"],
    ["Spot, 24/7", "BTC/USD 60 Bitcoin|ETH/USD 12 Ether|SOL/USD 4 Solana"]]],
  ["strategy", "Strategy", 1, [
    ["Factor", "QUAL 55 Quality|USMV 24 Minimum volatility|MTUM 18 Momentum|VLUE 7 Value factor"],
    ["Income", "JEPI 41 Equity premium income|JEPQ 30 Nasdaq premium income|QYLD 8 Nasdaq covered calls|DIVO 5 Dividend + covered calls"],
    ["Equal weight", "QQQE 1.3 Nasdaq 100 equal weight"]]]
];
/* -> [{k, title, big, groups:[{name, items:[{sym, aum, name, lev, crypto}]}]}] */
E.mapUniverse = function (src) {
  return (src || E.MAP_SRC).map(([k, title, big, groups]) => ({k, title, big: big === 2, groups: groups.map(([name, s]) => ({name, items: s.split("|").map(t => {
    const m = /^(\S+) ([\d.]+) (.+)$/.exec(t.trim()); if (!m) throw new Error("bad map line: " + t);
    const lv = /(-?\d)x$/.exec(m[3]);
    return {sym: m[1], aum: +m[2], name: m[3], lev: lv ? +lv[1] : 1, crypto: m[1].includes("/")};
  })}))}));
};

/* squarified treemap (Bruls, Huizing, van Wijk). items: [{w > 0, ...}] -> the same items with x, y, w0 (width), h0
   (height), in the rectangle (x, y, W, H). Order is biggest first; equal weights keep their given order. */
E.squarify = function (items, x, y, W, H) {
  const list = items.filter(i => i.w > 0).map((it, i) => ({it, i})).sort((a, b) => b.it.w - a.it.w || a.i - b.i).map(o => o.it);
  const total = list.reduce((s, i) => s + i.w, 0), out = [];
  if (!(total > 0) || !(W > 0) || !(H > 0)) return out;
  const scale = W * H / total;
  let rx = x, ry = y, rw = W, rh = H, row = [], i = 0;
  const worst = (r, side) => { if (!r.length) return Infinity; let s = 0, mx = 0, mn = Infinity; r.forEach(o => { const a = o.w * scale; s += a; mx = Math.max(mx, a); mn = Math.min(mn, a); }); return Math.max(side * side * mx / (s * s), s * s / (side * side * mn)); };
  const place = r => {
    const s = r.reduce((a, o) => a + o.w * scale, 0);
    if (rw >= rh) { const cw = s / rh; let cy = ry; r.forEach(o => { const h = o.w * scale / cw; out.push(Object.assign(o, {x: rx, y: cy, w0: cw, h0: h})); cy += h; }); rx += cw; rw -= cw; }
    else { const ch = s / rw; let cx = rx; r.forEach(o => { const w = o.w * scale / ch; out.push(Object.assign(o, {x: cx, y: ry, w0: w, h0: ch})); cx += w; }); ry += ch; rh -= ch; }
  };
  while (i < list.length) {
    const side = Math.min(rw, rh), it = list[i];
    if (!row.length || worst(row.concat(it), side) <= worst(row, side)) { row.push(it); i++; }
    else { place(row); row = []; }
  }
  if (row.length) place(row);
  return out;
};

/* tile weights for a size mode: "aum" (fund size), "vol" (today's dollar volume), "eq" (equal). Square roots keep a
   giant fund from flattening its neighbours; a floor keeps the smallest tile in a group visible. */
E.mapWeight = function (item, mode, dv) {
  if (mode === "eq") return 1;
  if (mode === "vol") return dv > 0 ? Math.sqrt(dv / 1e6) : 0;
  return Math.sqrt(item.aum);
};
E.mapGroupWeights = function (ws, mode) {
  const mx = Math.max(0, ...ws), fl = ws.map(w => Math.max(w > 0 ? w : 0, mx * 0.04 || 1));
  const sum = fl.reduce((a, b) => a + b, 0);
  return {tiles: fl, group: mode === "eq" ? Math.pow(fl.length, 0.8) : Math.pow(sum, 0.55)};
};

/* the most recent regular session that has started: today from 9:30 ET on a trading day, else the one before */
E.lastSessionDate = function (now) {
  const p = E.etParts(now);
  if (E.isTradingDay(p.date) && p.mins >= 570) return p.date;
  let d = E.addDays(p.date, -1); for (let i = 0; i < 10 && !E.isTradingDay(d); i++) d = E.addDays(d, -1);
  return d;
};
/* one Alpaca stock snapshot -> a map quote: c (the regular price: live in market hours, else the regular close),
   pc (the close before it), dp, o/h/l, dv (the day's dollar volume on IEX), t (ms of the trade behind c),
   ext {p, pct against c, ph:"pre"|"after", t} for a later pre-market or after-hours trade, quiet (no IEX trade yet in
   today's session: the price is still yesterday's close, so the day's change is 0, not yesterday's move). */
E.mapSnap = function (snap, now) {
  const db = snap && snap.dailyBar, pdb = snap && snap.prevDailyBar, lt = snap && snap.latestTrade;
  if (!db || !(db.c > 0)) return null;
  const dbDate = E.etDateOf(Date.parse(db.t)), last = E.lastSessionDate(now);
  const out = {c: +db.c, pc: pdb && pdb.c > 0 ? +pdb.c : null, o: +db.o || null, h: +db.h || null, l: +db.l || null, dv: (+db.v || 0) * (+db.vw || +db.c), t: 0, day: dbDate, ext: null, quiet: false, src: "alpaca"};
  if (dbDate < last) { out.pc = out.c; out.o = out.h = out.l = null; out.dv = 0; out.quiet = true; out.day = last; }
  if (lt && lt.p > 0) {
    const tms = Date.parse(lt.t), tp = E.etParts(tms), close = E.closeMins(tp.date);
    if (tp.date === out.day && tp.mins >= 570 && tp.mins < close && !out.quiet) { out.c = +lt.p; out.t = tms; }
    else if (tp.mins >= 240 && tp.mins < 1200 && (tp.date > out.day || (tp.date === out.day && tp.mins >= close))) out.ext = {p: +lt.p, pct: (lt.p / out.c - 1) * 100, ph: tp.date > out.day ? "pre" : "after", t: tms};
  }
  out.dp = out.pc > 0 ? (out.c / out.pc - 1) * 100 : null;
  return out;
};
/* one Alpaca crypto snapshot: the change since the day began (00:00 UTC) */
E.mapCryptoSnap = function (snap, now) {
  const db = snap && snap.dailyBar, pdb = snap && snap.prevDailyBar, lt = snap && snap.latestTrade;
  const c = lt && lt.p > 0 ? +lt.p : db && db.c > 0 ? +db.c : 0; if (!c) return null;
  const today = new Date(now).toISOString().slice(0, 10), dbToday = db && String(db.t).slice(0, 10) === today;
  const pc = dbToday ? (pdb && pdb.c > 0 ? +pdb.c : +db.o) : db && db.c > 0 ? +db.c : null;
  return {c, pc, dp: pc > 0 ? (c / pc - 1) * 100 : null, h: dbToday ? +db.h : null, l: dbToday ? +db.l : null, o: dbToday ? +db.o : null, dv: dbToday ? (+db.v || 0) * (+db.vw || c) : 0, t: lt ? Date.parse(lt.t) : 0, day: today, ext: null, quiet: false, src: "alpaca", crypto: true};
};
/* reference closes for the longer time frames, from daily bars [[date "YYYY-MM-DD", close], ...] oldest first.
   Same rules as the Markets panel: 5D = the close 5 sessions back (today counts as one); 1M/3M/1Y = the last close
   on or before that many months ago; YTD = the last close of last year. Only completed days before `today` count. */
E.mapRefs = function (bars, today) {
  const done = (bars || []).filter(b => b[0] < today && b[1] > 0), n = done.length, out = {};
  if (!n) return out;
  const back = m => { const d = new Date(today + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString().slice(0, 10); };
  if (n >= 5) out["5D"] = done[n - 5];
  [["1M", 1], ["3M", 3], ["1Y", 12]].forEach(([k, m]) => { const t = back(m); if (done[0][0] <= t) { for (let i = n - 1; i >= 0; i--) if (done[i][0] <= t) { out[k] = done[i]; break; } } });
  const jan = today.slice(0, 4) + "-01-01";
  if (done[0][0] < jan) for (let i = n - 1; i >= 0; i--) if (done[i][0] < jan) { out.YTD = done[i]; break; }
  return out;
};
/* a panel's or the whole map's read: average of the 1x funds (leveraged and inverse funds would distort it),
   weighted like the tiles; ups and downs; best and worst 1x fund */
E.mapStats = function (rows) {
  let sw = 0, s = 0, up = 0, down = 0, flat = 0, best = null, worst = null;
  (rows || []).forEach(r => {
    if (r.pct == null || !isFinite(r.pct)) return;
    if (Math.abs(r.pct) < 0.005) flat++; else if (r.pct > 0) up++; else down++;
    if (r.lev !== 1) return;
    const w = r.w > 0 ? r.w : 1; sw += w; s += w * r.pct;
    if (!best || r.pct > best.pct) best = r; if (!worst || r.pct < worst.pct) worst = r;
  });
  return {avg: sw ? s / sw : null, up, down, flat, best, worst};
};

/* ====================================================================================
   20. Live wire (6.2). Press-wire RSS, SEC EDGAR Atom and agency feeds, read by the desktop app (browsers can't:
   those sites send no CORS headers). A small regex reader, not a DOM: feeds are flat, and this also runs in tests.
   E.feedParse(xml) -> [{h, url, t (ms), sum, cats:[...], who}] newest first.
   ==================================================================================== */
const XENT = {amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" ", rsquo:"’", lsquo:"‘", rdquo:"”", ldquo:"“", ndash:"–", mdash:"—", hellip:"…", reg:"®", trade:"™", copy:"©"};
E.xmlText = function (s) {
  s = String(s == null ? "" : s).trim();
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  for (let i = 0; i < 2; i++) s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === "#" ? (()=>{ const c = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; })() : (XENT[e.toLowerCase()] != null ? XENT[e.toLowerCase()] : m));
  return s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
};
function xTag(block, names) {
  for (const n of names) {
    const re = new RegExp("<" + n + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + n + ">", "i"), m = block.match(re);
    if (m && m[1].trim()) return m[1];
  }
  return "";
}
function xAll(block, name) {
  const re = new RegExp("<" + name + "(\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "gi"), out = []; let m;
  while ((m = re.exec(block))) out.push({attrs: m[1] || "", text: m[2]});
  return out;
}
E.feedTime = function (s) {
  s = E.xmlText(s); if (!s) return 0;
  let t = Date.parse(s);
  if (!isFinite(t)) t = Date.parse(s.replace(/\b(EST|EDT|CST|CDT|PST|PDT|ET)\b/, m => ({EST:"-0500", EDT:"-0400", CST:"-0600", CDT:"-0500", PST:"-0800", PDT:"-0700", ET:"-0500"})[m]));
  return isFinite(t) ? t : 0;
};
E.feedParse = function (xml) {
  xml = String(xml || "");
  const atom = !/<item[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blocks = xml.match(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  const out = [];
  blocks.forEach(b => {
    const h = E.xmlText(xTag(b, ["title"]));
    let url = "";
    if (atom) { const l = b.match(/<link\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>/i); url = l ? l[1] : ""; }
    else url = E.xmlText(xTag(b, ["link"])) || E.xmlText(xTag(b, ["guid"]));
    url = url.replace(/&amp;/g, "&").trim();
    const t = E.feedTime(xTag(b, atom ? ["published", "updated"] : ["pubDate", "dc:date", "published", "updated"]));
    const sum = E.xmlText(xTag(b, atom ? ["summary", "content"] : ["description", "summary", "content:encoded"])).slice(0, 700);
    const cats = xAll(b, "category").map(c => E.xmlText(c.text)).concat(atom ? (b.match(/<category\b[^>]*term\s*=\s*["']([^"']+)["']/gi) || []).map(x => x.replace(/.*term\s*=\s*["']([^"']+)["'].*/i, "$1")) : []).filter(Boolean);
    const who = E.xmlText(xTag(b, ["dc:creator", "dc:contributor", "author", "dc:publisher"])).replace(/\s+name\s*$/i, "").slice(0, 80);
    if (h && /^https?:\/\//.test(url)) out.push({h: h.slice(0, 300), url, t, sum, cats, who});
  });
  return out.sort((a, b) => b.t - a.t);
};
/* tickers a press release names: "(NASDAQ: ABCD)", "(NYSE:XYZ, TSX:XYZ)", "Nasdaq:ABCD" categories. US listings only by
   default; "TSX: ABC" style Canadian/other venues are skipped so they don't collide with US symbols. */
const VENUE = "NASDAQ|Nasdaq|NasdaqGS|NasdaqGM|NasdaqCM|NYSE|NYSE American|NYSE MKT|NYSE Arca|NYSEArca|AMEX|Cboe BZX|CBOE|OTCQX|OTCQB|OTC Pink|OTC|OTCMKTS";
const TK_RE = new RegExp("\\b(?:" + VENUE + ")\\s*(?:Global Select Market|Global Market|Capital Market)?\\s*:\\s*([A-Z][A-Z0-9]{0,5}(?:[.\\-][A-Z])?)\\b", "g");
E.wireTickers = function (...texts) {
  const out = [];
  texts.flat().forEach(s => { s = String(s || ""); let m; TK_RE.lastIndex = 0; while ((m = TK_RE.exec(s))) { const x = m[1].replace("-", "."); if (!out.includes(x) && out.length < 6) out.push(x); } });
  return out;
};
/* SEC "getcurrent" Atom titles: "8-K - NVIDIA CORP (0001045810) (Filer)" */
E.secTitle = function (h) {
  const m = String(h || "").match(/^\s*([^\s].*?)\s+-\s+(.*?)\s+\((\d{4,10})\)\s*\(([^)]*)\)/);
  return m ? {form: m[1], name: m[2], cik: String(+m[3]), role: m[4]} : null;
};
/* SEC 8-K items -> plain words (from the summary "Item 2.02: Results of Operations..." when the feed carries it) */
E.SEC_ITEMS = {"1.01":"material deal", "1.02":"deal ended", "1.03":"bankruptcy", "2.01":"acquisition done", "2.02":"results", "2.03":"new debt", "2.05":"layoffs/exit costs", "2.06":"impairment", "3.01":"delisting notice", "3.02":"unregistered share sale", "4.01":"auditor change", "4.02":"restatement", "5.01":"control change", "5.02":"exec/board change", "5.03":"bylaws change", "5.07":"shareholder vote", "7.01":"Reg FD release", "8.01":"other event", "9.01":"exhibits"};
/* "GAMMA TEST CORP /DE/" -> "Gamma Test Corp": SEC names are in capitals; short words (IBM, AMD) stay as they are */
E.secName = n => String(n || "").replace(/\s*\/[A-Z]{2,3}\/?\s*$/, "").split(/\s+/).map(w => w.length > 3 && /^[A-Z&.\-']+$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w).join(" ").trim();
E.SEC_FORMS = {"4":"insider trade", "3":"new insider", "144":"planned insider sale", "8-K":"current report", "10-Q":"quarterly report", "10-K":"annual report", "SC 13D":"activist stake", "SC 13G":"5%+ stake", "SCHEDULE 13D":"activist stake", "SCHEDULE 13G":"5%+ stake", "S-3":"shelf registration (could sell shares)", "S-3ASR":"shelf registration (could sell shares)", "424B5":"share or note offering", "424B2":"note offering", "DEF 14A":"proxy statement", "6-K":"foreign issuer report", "SD":"conflict minerals report"};
E.secItems = function (sum) {
  const out = []; String(sum || "").replace(/Item\s+(\d\.\d\d)/gi, (m, k) => { if (E.SEC_ITEMS[k] && k !== "9.01" && !out.includes(E.SEC_ITEMS[k])) out.push(E.SEC_ITEMS[k]); return m; });
  return out;
};
E.urlKey = function (u) {
  try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase(); } catch (e) { return String(u || "").toLowerCase(); }
};
/* merge new wire lines into the list: one line per story (same link or same headline), the earliest publish time and
   the first time MW saw it are kept, sources and tickers are unioned. Newest first, capped by count and age. */
E.wireMerge = function (list, incoming, now, opts) {
  opts = Object.assign({max: 300, maxAgeMs: 2 * 864e5}, opts || {});
  const out = (list || []).filter(n => n && n.h && now - (n.t || 0) <= opts.maxAgeMs).map(n => Object.assign({}, n));
  const byU = new Map(), byH = new Map(), added = [];
  out.forEach(n => { byU.set(E.urlKey(n.url), n); byH.set(E.newsKey(n.h), n); });
  (incoming || []).forEach(n => {
    if (!n || !n.h || !/^https?:\/\//.test(n.url || "")) return;
    const t = n.t > 0 ? Math.min(n.t, now + 60e3) : now;
    if (now - t > opts.maxAgeMs) return;
    const uk = E.urlKey(n.url), hk = E.newsKey(n.h), cur = byU.get(uk) || byH.get(hk);
    if (cur) {
      (n.syms || []).forEach(x => { if (!cur.syms.includes(x)) cur.syms.push(x); });
      if (n.src && !(cur.also || []).includes(n.src) && n.src !== cur.src) cur.also = (cur.also || []).concat(n.src).slice(0, 4);
      if (!cur.sum && n.sum) cur.sum = n.sum;
      if (t < cur.t) cur.t = t;
      return;
    }
    const x = {id: n.id || (n.src || "w") + ":" + hk.slice(0, 60), h: String(n.h).slice(0, 300), url: n.url, t, seen: n.seen || now, src: n.src || "", sum: String(n.sum || "").slice(0, 700), syms: (n.syms || []).slice(0, 6), kind: n.kind || "wire", form: n.form || "", w: n.w || "", cat: n.cat || "", old: n.old ? 1 : 0};
    out.push(x); byU.set(uk, x); byH.set(hk, x); added.push(x);
  });
  out.sort((a, b) => b.t - a.t);
  return {list: out.slice(0, opts.max), added};
};
/* how late a source is: the median of (first seen - published) over its recent lines, in seconds; null without data */
E.wireLag = function (lags) {
  const L = (lags || []).filter(x => isFinite(x) && x >= 0).sort((a, b) => a - b);
  return L.length ? L[Math.floor((L.length - 1) / 2)] : null;
};
/* "14s", "3m", "2h" */
E.lagShort = function (sec) { return sec == null ? "" : sec < 60 ? Math.round(sec) + "s" : sec < 3600 ? Math.round(sec / 60) + "m" : Math.round(sec / 3600) + "h"; };

/* =====================================================================
   ===== PULSE BEGIN: Market pulse (pulse.js). Only this builder edits between BEGIN and END. =====
   ===================================================================== */

/* ---------- 6.3 board layout: where each section sits on the main screen ----------
   order: every section key, in the one-column (narrow window) order. A wide window shows n columns (2 or 3); the
   arrangement for each column count is kept on its own (settings.board = {"2":[[keys],[keys]], "3":[...]}) once you
   move a section there. Until then, and for a column count you never arranged, it is worked out:
   - nothing saved: the visible sections take turns across the columns in the one-column order (the 4.7 rule);
   - another column count was arranged: 3 -> 2 puts the third column under the second; 2 -> 3 deals the reading order;
   - a section that is in no column yet (new in a later version) goes at the end of the shortest column.
   A hidden section keeps its place in its column, so turning it back on puts it where it was. */
const boardOk = (c, n) => Array.isArray(c) && c.length === n && c.every(Array.isArray);
E.boardDeal = function (order, n, hidden) {
  hidden = hidden || {}; const cols = Array.from({length: n}, () => []), where = {};
  order.filter(k => !hidden[k]).forEach((k, i) => { cols[i % n].push(k); where[k] = i % n; });
  // a hidden section rides right after the visible one before it in the order (top of the first column if none)
  order.forEach((k, i) => { if (!hidden[k]) return; let p = i - 1; while (p >= 0 && hidden[order[p]]) p--;
    if (p < 0) { cols[0].unshift(k); where[k] = 0; return; }
    const c = cols[where[order[p]]]; c.splice(c.indexOf(order[p]) + 1, 0, k); where[k] = where[order[p]]; });
  return cols;
};
/* reading order of a board: across the top row first, then the next (the order keys 1 to 9 follow) */
E.boardRead = function (cols, hidden) {
  hidden = hidden || {}; const v = cols.map(c => c.filter(k => !hidden[k])), out = [];
  for (let r = 0, m = Math.max(0, ...v.map(c => c.length)); r < m; r++) v.forEach(c => { if (c[r]) out.push(c[r]); });
  return out;
};
E.boardCols = function (saved, order, n, hidden) {
  hidden = hidden || {}; const known = new Set(order);
  let src = saved && saved[n];
  if (!boardOk(src, n)) {
    const other = saved && typeof saved === "object" ? Object.keys(saved).map(Number).filter(m => m !== n && m >= 1 && m <= 4 && boardOk(saved[m], m)).sort((a, b) => Math.abs(a - n) - Math.abs(b - n))[0] : null;
    if (other > n) { const S = saved[other]; src = S.slice(0, n).map((c, i) => i === n - 1 ? [].concat(...S.slice(n - 1)) : c.slice()); }
    else if (other) src = E.boardDeal([...new Set(E.boardRead(saved[other], {}).concat(order))], n, hidden);
    else src = E.boardDeal(order, n, hidden);
  }
  const seen = new Set();
  const cols = src.map(c => c.filter(k => known.has(k) && !seen.has(k) && (seen.add(k), true)));
  const visN = c => c.filter(x => !hidden[x]).length;
  order.filter(k => !seen.has(k)).forEach(k => {
    let best = 0; cols.forEach((c, i) => { if (visN(c) < visN(cols[best])) best = i; });
    cols[best].push(k); seen.add(k);
  });
  return cols;
};
/* move key into column `to`, in front of `before` (null: the end of that column) */
E.boardMove = function (cols, key, to, before) {
  const out = cols.map(c => c.filter(k => k !== key)); if (!out[to]) return out;
  const i = before ? out[to].indexOf(before) : -1;
  if (i < 0) out[to].push(key); else out[to].splice(i, 0, key);
  return out;
};
/* one step with the keyboard: "up", "down" (within the column), "left", "right" (the next column, same height).
   Hidden sections are stepped over. Returns the new columns, or null when the section can't go that way. */
E.boardStep = function (cols, key, dir, hidden) {
  hidden = hidden || {}; const ci = cols.findIndex(c => c.includes(key)); if (ci < 0) return null;
  const v = cols[ci].filter(k => k === key || !hidden[k]), vi = v.indexOf(key);
  if (dir === "up") return vi > 0 ? E.boardMove(cols, key, ci, v[vi - 1]) : null;
  if (dir === "down") return vi < v.length - 1 ? E.boardMove(cols, key, ci, v[vi + 2] || null) : null;
  const tc = ci + (dir === "left" ? -1 : dir === "right" ? 1 : 0); if (tc === ci || tc < 0 || tc >= cols.length) return null;
  const tv = cols[tc].filter(k => !hidden[k]);
  return E.boardMove(cols, key, tc, tv[Math.min(vi, tv.length)] || null);
};
/* the keys of `want` to move so a list in the order `have` ends up as `want`: all but the longest run that is already
   in order. Moving a section takes the focus out of it, so only these are moved. */
E.minMoves = function (have, want) {
  const pos = new Map(have.map((k, i) => [k, i])), seq = want.map(k => pos.has(k) ? pos.get(k) : -1);
  const len = seq.map(() => 1), prev = seq.map(() => -1);
  for (let i = 0; i < seq.length; i++) for (let j = 0; j < i; j++) if (seq[i] >= 0 && seq[j] >= 0 && seq[i] > seq[j] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
  let best = -1; seq.forEach((s, i) => { if (s >= 0 && (best < 0 || len[i] > len[best])) best = i; });
  const keep = new Set(); for (let i = best; i >= 0; i = prev[i]) keep.add(want[i]);
  return want.filter(k => !keep.has(k));
};

/* ---------- 6.3 Market pulse: risk appetite from relative strength, breadth and cross-asset moves ----------
   An indicator, not advice. Every figure is a public ETF (or bitcoin); no personal data here.
   Pairs: how fund A did against fund B, as the change in the ratio A/B: today, over 5 sessions (today counts as one,
   the 5D rule used everywhere in MW) and over 20 sessions. s: the move (in percent) that counts as a full reading for
   today, 5D and 20D; anything bigger counts the same as the scale. See CHANGES-6.3-pulse.md for the method. */
E.PULSE = {
  pairs: [
    {k:"chips",    a:"SMH",  b:"SPY",  w:1,    s:[1.2, 3, 6],     subj:"chips"},
    {k:"growth",   a:"QQQ",  b:"SPY",  w:0.75, s:[0.5, 1.5, 3],   subj:"the Nasdaq"},
    {k:"small",    a:"IWM",  b:"SPY",  w:1,    s:[0.8, 2, 4],     subj:"small caps"},
    {k:"beta",     a:"SPHB", b:"SPLV", w:1.25, s:[1.2, 3, 6],     subj:"high beta"},
    {k:"consumer", a:"XLY",  b:"XLP",  w:1,    s:[0.8, 2, 4],     subj:"discretionary"},
    {k:"credit",   a:"HYG",  b:"IEF",  w:1.25, s:[0.3, 0.8, 1.5], subj:"credit"}
  ],
  // dir: +1 when a rise means more appetite for risk, -1 when it means less, 0: shown for context, not scored
  cross: [
    {k:"vol",    sym:"VIXY",    w:1,   dir:-1, s:4,   subj:"volatility", up:"rising", dn:"easing"},
    {k:"dollar", sym:"UUP",     w:0.5, dir:-1, s:0.4, subj:"the dollar", up:"firmer", dn:"softer"},
    {k:"btc",    sym:"BTC/USD", w:0.5, dir:1,  s:3,   subj:"bitcoin",    up:"rising", dn:"falling"},
    {k:"rates",  sym:"TLT",     w:0,   dir:0},
    {k:"gold",   sym:"GLD",     w:0,   dir:0},
    {k:"oil",    sym:"USO",     w:0,   dir:0}
  ],
  sectors: ["XLK","XLC","XLY","XLF","XLV","XLI","XLE","XLB","XLU","XLP","XLRE"],
  wBreadth: 1, wTrend: 1,
  parts: [0.5, 0.3, 0.2],   // how today, 5D and 20D mix inside one pair
  minCover: 0.4             // below this share of the total weight there is no reading
};
/* every stock ticker the pulse needs (bitcoin comes from the crypto feed) */
E.pulseSyms = function () {
  const P = E.PULSE, s = new Set();
  P.pairs.forEach(p => { s.add(p.a); s.add(p.b); }); P.cross.forEach(c => { if (!c.sym.includes("/")) s.add(c.sym); }); P.sectors.forEach(x => s.add(x));
  return [...s];
};
const pClamp = x => Math.max(-1, Math.min(1, x));
const pNum = x => x != null && isFinite(x);
/* how A did against B, in percent, from their two percent changes */
E.pulseRel = (pa, pb) => pNum(pa) && pNum(pb) ? ((1 + pa / 100) / (1 + pb / 100) - 1) * 100 : null;
/* closes: [[date, close], ...] oldest first, completed sessions only. The change over n sessions with today counting
   as one: the price now (px, or the last close) against closes[len - n]. */
E.pulseBack = function (closes, px, n) {
  if (!Array.isArray(closes) || closes.length < n) return null;
  const ref = closes[closes.length - n][1], now = px > 0 ? px : closes[closes.length - 1][1];
  return ref > 0 && now > 0 ? (now / ref - 1) * 100 : null;
};
/* the ratio A/B on the dates both have, then the ratio now: its 5D and 20D change, and up to 21 points to draw */
E.pulseTrend = function (ca, cb, pxA, pxB) {
  if (!Array.isArray(ca) || !Array.isArray(cb)) return {r5:null, r20:null, line:[]};
  const mb = new Map(cb.map(x => [x[0], x[1]]));
  const R = ca.filter(x => x[1] > 0 && mb.get(x[0]) > 0).map(x => [x[0], x[1] / mb.get(x[0])]);
  const now = pxA > 0 && pxB > 0 ? pxA / pxB : null;
  const line = R.slice(-20).map(x => x[1]); if (now && R.length) line.push(now);
  return {r5: E.pulseBack(R, now, 5), r20: E.pulseBack(R, now, 20), line};
};
/* sectors: [{dp, px, closes}] -> how many are up and down today, and how many trade above their 20-day average
   (the mean of the last 20 completed closes) */
E.pulseBreadth = function (rows) {
  let up = 0, down = 0, n = 0, above = 0, n20 = 0;
  (rows || []).forEach(r => {
    if (r && pNum(r.dp)) { n++; if (+r.dp.toFixed(2) > 0) up++; else if (+r.dp.toFixed(2) < 0) down++; }
    const c = r && r.closes;
    if (Array.isArray(c) && c.length >= 20) { const px = r.px > 0 ? r.px : c[c.length - 1][1], avg = c.slice(-20).reduce((a, x) => a + x[1], 0) / 20; if (px > 0 && avg > 0) { n20++; if (px > avg) above++; } }
  });
  return {up, down, n, above, n20};
};
const pJoin = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
/* phrases that share a verb go together: [["chips","leading"],["small caps","leading"],["credit","leading"]] -> "chips, small caps and credit leading" */
E.pulsePhrase = function (ph) {
  const g = []; ph.forEach(([s, v]) => { const x = g.find(y => y.v === v); if (x) x.s.push(s); else g.push({v, s:[s]}); });
  return g.map(x => pJoin(x.s) + " " + x.v).join(", ");
};
/* in: {pairs:{k:{today, r5, r20}}, cross:{k:{dp}}, breadth:{up, down, n, above, n20}}
   out: {score -100..+100 (null when too little is known), label, verdict, cover 0..1, parts:[{k, c -1..1, w, ph}]} */
E.pulseScore = function (inp) {
  const P = E.PULSE, parts = []; inp = inp || {};
  let wAll = 0;
  P.pairs.forEach(p => {
    wAll += p.w; const x = (inp.pairs || {})[p.k]; if (!x) return;
    let s = 0, ww = 0;
    [x.today, x.r5, x.r20].forEach((y, i) => { if (pNum(y)) { s += P.parts[i] * pClamp(y / p.s[i]); ww += P.parts[i]; } });
    // a pair with only part of its readings (no history yet) counts for less
    if (ww > 0) { const c = s / ww; parts.push({k:p.k, c, w:p.w * Math.min(1, ww / 0.5), ph:[p.subj, c >= 0 ? "leading" : "lagging"]}); }
  });
  P.cross.forEach(x => {
    if (!x.w) return; wAll += x.w; const y = (inp.cross || {})[x.k];
    if (y && pNum(y.dp)) parts.push({k:x.k, c:pClamp(x.dir * y.dp / x.s), w:x.w, ph:[x.subj, y.dp >= 0 ? x.up : x.dn]});
  });
  const b = inp.breadth || {}; wAll += P.wBreadth + P.wTrend;
  if (b.n >= 6) { const c = (b.up - b.down) / b.n; parts.push({k:"breadth", c, w:P.wBreadth, ph:["most sectors", c >= 0 ? "up" : "down"]}); }
  if (b.n20 >= 6) { const c = (2 * b.above - b.n20) / b.n20; parts.push({k:"trend", c, w:P.wTrend, ph:["most sectors", c >= 0 ? "above their 20-day average" : "below their 20-day average"]}); }
  const wHave = parts.reduce((a, x) => a + x.w, 0), cover = wAll ? wHave / wAll : 0;
  if (!parts.length || cover < P.minCover) return {score:null, label:"Not enough data", verdict:"", cover, parts};
  const score = Math.round(100 * parts.reduce((a, x) => a + x.w * x.c, 0) / wHave) || 0;   // || 0: never "-0"
  const label = score >= 40 ? "Strong risk-on" : score >= 15 ? "Risk-on" : score > -15 ? "Mixed" : score > -40 ? "Risk-off" : "Strong risk-off";
  const pick = sign => { const seen = new Set(); return parts.filter(x => Math.sign(x.c) === sign && Math.abs(x.c) >= 0.15).sort((a, b) => Math.abs(b.w * b.c) - Math.abs(a.w * a.c))
    .filter(x => !seen.has(x.ph[0]) && (seen.add(x.ph[0]), true)); };
  let why;
  if (label === "Mixed") { const a = pick(1)[0], d = pick(-1)[0]; why = a && d ? E.pulsePhrase([a.ph]) + ", but " + E.pulsePhrase([d.ph]) : a || d ? E.pulsePhrase([(a || d).ph]) : "no clear lead either way"; }
  else { const top = pick(Math.sign(score)).slice(0, 3); why = top.length ? E.pulsePhrase(top.map(x => x.ph)) : "a broad, mild tilt"; }
  return {score, label, verdict: label + ": " + why, cover, parts};
};

/* ===== PULSE END ===== */

/* (spacer so the three regions merge cleanly) */

/* =====================================================================
   ===== RADAR BEGIN: In-play radar (radar.js). Only this builder edits between BEGIN and END. =====
   ===================================================================== */
/* What is "in play" today, measured the one way that held up in MW's own backtests: relative volume. Everything
   here is a plain function: the page (radar.js) feeds it Alpaca snapshots and daily bars and draws what comes back.

   RELATIVE VOLUME, and what is approximate about it. The exact figure is today's volume so far over the 20-day
   average volume by the same minute; that needs 20 days of minute bars for every ticker, far past the free limits.
   MW uses today's volume so far over (the 20-day average FULL-day volume x the share of a day's volume that has
   normally traded by this minute). That share is one fixed curve, E.RADAR_CURVE, the usual U shape of US trading
   (busy open, quiet lunch, busy close). So the number is exact at the close and an estimate before it, and a ticker
   whose day is shaped unlike the typical one reads a little high or low in the morning. Both volumes are IEX's
   (one exchange, a few percent of all US trading), so the ratio is like for like. */

/* the fixed part of the universe: liquid US stocks and funds (public tickers only; nothing personal) */
E.RADAR_UNIVERSE = (
  // the market, sectors, bonds, metals, oil, and the funds day traders lean on
  "SPY QQQ IWM DIA SMH XLK XLF XLE XLV XLI XLY XLP XLU XLB XLC XLRE TLT HYG GLD SLV USO ARKK XBI KRE IBIT TQQQ SQQQ SOXL " +
  // the largest companies
  "AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO BRK.B JPM LLY V MA UNH XOM COST HD PG JNJ WMT NFLX BAC ORCL CRM ABBV CVX KO PEP MRK " +
  "ADBE CSCO MCD WFC DIS QCOM TXN IBM GE CAT GS MS AXP NOW UBER BKNG PFE AMGN BA NKE SBUX C T VZ CMCSA RTX LMT DE UPS " +
  // chips, AI and software
  "AMD MU INTC TSM ASML AMAT LRCX KLAC MRVL ARM SMCI ON DELL ANET VRT CRWV PLTR SNOW DDOG NET CRWD PANW ZS MDB SHOP APP " +
  // names that move: crypto-linked, fintech, consumer, EVs, power, travel, energy, miners, China
  "COIN MSTR HOOD SOFI RBLX ROKU SNAP PINS DKNG AFRM RIVN NIO F GM CVNA ABNB DASH PYPL XYZ MARA RIOT IONQ OKLO CEG VST GEV " +
  "RDDT HIMS ENPH FSLR CCL DAL UAL OXY SLB FCX BABA"
).split(" ");
E.RADAR_MIN_AV = 20000;      // a 20-day average under this many IEX shares a day is too thin to measure against
E.RADAR_SHOCK_X = 5;         // a "volume surge": one minute at 5 times its usual pace or more,
E.RADAR_SHOCK_USD = 50000;   // and at least this many dollars on IEX in that minute
/* your tickers first (so they are always in the first call), then the fixed list; mutual funds and odd symbols are left out */
E.radarUniverse = function (mine) {
  const seen = new Set(), out = [];
  [...(mine || []).map(s => String(s || "").toUpperCase()), ...E.RADAR_UNIVERSE].forEach(s => {
    if (/^[A-Z][A-Z.]{0,6}$/.test(s) && !E.isFundSym(s) && !seen.has(s)) { seen.add(s); out.push(s); } });
  return out;
};
/* the share of a regular session's volume that has normally traded `mins` minutes after the open (0 to 1).
   [minutes after 9:30, share so far]; straight lines in between. A half day uses the same shape, squeezed. */
E.RADAR_CURVE = [[0, 0], [5, 0.035], [15, 0.078], [30, 0.13], [60, 0.22], [90, 0.295], [120, 0.36], [150, 0.418], [180, 0.471],
  [210, 0.521], [240, 0.571], [270, 0.624], [300, 0.684], [330, 0.754], [360, 0.844], [390, 1]];
E.radarDayFrac = function (mins, len) {
  const C = E.RADAR_CURVE, m = Math.max(0, Math.min(390, mins * 390 / (len > 0 ? len : 390)));
  for (let i = 1; i < C.length; i++) if (m <= C[i][0]) { const a = C[i - 1], b = C[i]; return a[1] + (b[1] - a[1]) * (m - a[0]) / (b[0] - a[0]); }
  return 1;
};
/* where the market is, for the radar: ph "open" | "pre" | "after" | "closed"; date and mins (New York now);
   sess, the regular session the list is about (today from 9:30 on a trading day, else the one before);
   settled, the moment that session's after-hours trading ended (ms) */
E.radarPhase = function (now, opts) {
  const mc = E.marketClock(now, opts), p = E.etParts(now), sess = E.lastSessionDate(now), close = E.closeMins(sess);
  return {ph: mc.ph === "open" || mc.ph === "pre" || mc.ph === "after" ? mc.ph : "closed", date: p.date, mins: p.mins, sess,
    settled: E.etMs(sess, close === 960 ? 1200 : close + 240)};
};
/* what a ticker's own history says is normal, from daily bars [{d:"YYYY-MM-DD", h, l, c, v}] (any order), using only
   sessions BEFORE `before`: av (average volume of the last 20), n (how many of them there were), atr (Wilder, 14 days),
   c (the last close), h20/l20 and h52/l52 (the highest high and lowest low of the last 20 and 252 sessions), n52 */
E.radarBase = function (bars, before) {
  const b = (bars || []).filter(x => x && x.d < before && x.c > 0 && x.h > 0 && x.l > 0).sort((x, y) => x.d < y.d ? -1 : x.d > y.d ? 1 : 0), n = b.length;
  if (!n) return null;
  const m20 = b.slice(-20), yr = b.slice(-252), r4 = v => v == null || !isFinite(v) ? null : +v.toFixed(4);
  const atr = E.atrWilder(b.slice(-120).reverse().map(x => [x.d, 0, x.h, x.l, x.c]), 14);
  return {asOf: b[n - 1].d, n: m20.length, av: Math.round(E.mean(m20.map(x => +x.v || 0))), atr: r4(atr), c: +b[n - 1].c,
    h20: Math.max(...m20.map(x => x.h)), l20: Math.min(...m20.map(x => x.l)), h52: Math.max(...yr.map(x => x.h)), l52: Math.min(...yr.map(x => x.l)), n52: yr.length};
};
/* one Alpaca stock snapshot, tidied: day (the last regular session there is a daily bar for), c (its price: the
   latest regular trade while it is open, else its close), pc (the close before), o/h/l, v (shares) and vw (VWAP) on
   IEX, t (ms of the trade behind c), ext {p, t, ph:"pre"|"after"} for a later trade outside regular hours,
   mv/mt/mc (the latest one-minute bar: shares, start in ms, close), pv (pre-market shares, when the feed counts them).
   Before the open some feeds already start today's bar from pre-market trades; the last full session is then the
   previous bar, and today's early bar becomes the pre-market trade. */
E.radarSnap = function (snap, now) {
  const db = snap && snap.dailyBar, pdb = snap && snap.prevDailyBar, lt = snap && snap.latestTrade, mb = snap && snap.minuteBar;
  if (!db || !(db.c > 0) || !db.t) return null;
  const pos = v => isFinite(+v) && +v > 0 ? +v : null, dOf = b => E.etDateOf(Date.parse(b.t)), p = E.etParts(now);
  let cur = db, prev = pdb && pdb.c > 0 ? pdb : null, early = null;
  if (dOf(db) === p.date && p.mins < 570 && prev) { early = db; cur = prev; prev = null; }
  const day = dOf(cur);
  const out = {day, c: +cur.c, pc: prev ? +prev.c : null, o: pos(cur.o), h: pos(cur.h), l: pos(cur.l), v: +cur.v || 0, vw: pos(cur.vw), t: 0, ext: null, mv: 0, mt: 0, mc: null, pv: early ? +early.v || 0 : null};
  if (lt && lt.p > 0 && lt.t) {
    const tms = Date.parse(lt.t), tp = E.etParts(tms), close = E.closeMins(tp.date), reg = E.isTradingDay(tp.date) && tp.mins >= 570 && tp.mins < close;
    if (reg && tp.date === day) { out.c = +lt.p; out.t = tms; }
    else if (!reg && tp.mins >= 240 && tp.mins < 1200 && (tp.date > day || (tp.date === day && tp.mins >= close))) out.ext = {p: +lt.p, t: tms, ph: tp.mins < 570 ? "pre" : "after"};
  }
  if (!out.ext && early) out.ext = {p: +early.c, t: Date.parse(early.t), ph: "pre"};
  if (mb && mb.v > 0 && mb.t) { out.mv = +mb.v; out.mt = Date.parse(mb.t); out.mc = pos(mb.c); }
  return out;
};
/* how big an opening gap has to be to count, in percent: half the ticker's average daily range (ATR), never under
   0.5%; 2% when the range is not known */
E.radarGapMin = (pc, atr) => atr > 0 && pc > 0 ? Math.max(0.5, 50 * atr / pc) : 2;
/* an opening gap and what became of it. o: the open, pc: the close before, c: the price now.
   fill: the share of the gap given back (0 at the open, 1 back at the previous close, under 0 when it has extended).
   state: "holding" (a third or less given back), "fading", "filled". null when the gap is too small to count. */
E.radarGap = function (o, pc, c, atr) {
  if (!(o > 0 && pc > 0 && c > 0)) return null;
  const pct = (o / pc - 1) * 100;
  if (Math.abs(pct) < E.radarGapMin(pc, atr)) return null;
  const fill = (o - c) / (o - pc);
  return {dir: pct > 0 ? 1 : -1, pct, fill, state: fill >= 1 ? "filled" : fill > 1 / 3 ? "fading" : "holding"};
};
/* every figure the radar shows for one ticker. q: E.radarSnap's answer; bases: E.radarBase answers (the newest one
   that ends before q.day is used); ctx: {now, spy (SPY's move in percent, or null)}.
   live: its session is trading now. stale: no trade in the session the list is about (the price is an older close).
   rvol: volume against what is normal by this time (null when it can't be measured). move/moveUsd: what the row
   leads with, which is the day's change, or in pre-market the latest trade against the last close. rs: move - SPY's. */
E.radarRow = function (sym, q, bases, ctx) {
  if (!q || !(q.c > 0)) return null;
  const ph = E.radarPhase(ctx.now, ctx.clock), b = (bases || []).find(x => x && x.asOf < q.day) || null;
  const live = ph.ph === "open" && q.day === ph.date, stale = q.day < ph.sess;
  const pc = q.pc > 0 ? q.pc : b ? b.c : null, close = E.closeMins(ph.date);
  const frac = live ? Math.max(E.radarDayFrac(ph.mins - 570, close - 570), E.radarDayFrac(5)) : 1;
  const r = {sym, day: q.day, live, stale, px: q.c, pc, chg: pc ? q.c - pc : null, pct: pc ? (q.c / pc - 1) * 100 : null,
    o: q.o, h: q.h, l: q.l, v: q.v, vw: q.vw, dv: q.v * (q.vw || q.c), t: q.t, av: b ? b.av : null, atr: b ? b.atr : null,
    rvol: !stale && b && b.n >= 10 && b.av >= E.RADAR_MIN_AV ? q.v / (b.av * frac) : null,
    thin: !!b && !(b.n >= 10 && b.av >= E.RADAR_MIN_AV),
    gapPct: q.o > 0 && pc ? (q.o / pc - 1) * 100 : null, sinceOpen: q.o > 0 ? (q.c / q.o - 1) * 100 : null, vwap: q.vw > 0 ? (q.c / q.vw - 1) * 100 : null,
    rng: b && b.atr > 0 && q.h > 0 && q.l > 0 ? (Math.max(q.h, pc || q.h) - Math.min(q.l, pc || q.l)) / b.atr : null,
    gap: stale ? null : E.radarGap(q.o, pc, q.c, b && b.atr), ext: null};
  r.hi52 = !stale && !!b && b.n52 >= 200 && q.h >= b.h52; r.lo52 = !stale && !!b && b.n52 >= 200 && q.l > 0 && q.l <= b.l52;
  r.hi20 = !stale && !!b && b.n >= 20 && q.h >= b.h20; r.lo20 = !stale && !!b && b.n >= 20 && q.l > 0 && q.l <= b.l20;
  r.ref = b ? {h52: b.h52, l52: b.l52, h20: b.h20, l20: b.l20} : null;
  const x = q.ext;
  if (x && x.p > 0 && (ph.ph === "pre" ? x.ph === "pre" && E.etDateOf(x.t) === ph.date : ph.ph !== "open" && x.ph === "after" && E.etDateOf(x.t) === q.day))
    r.ext = {p: x.p, t: x.t, ph: x.ph, chg: x.p - q.c, pct: (x.p / q.c - 1) * 100, big: Math.abs(x.p / q.c - 1) * 100 >= E.radarGapMin(q.c, b && b.atr)};
  if (ph.ph === "pre") { r.move = r.ext ? r.ext.pct : null; r.moveUsd = r.ext ? r.ext.chg : null; r.last = r.ext ? r.ext.p : r.px; }
  else { r.move = stale ? null : r.pct; r.moveUsd = stale ? null : r.chg; r.last = r.px; }
  r.rs = r.move != null && ctx.spy != null && isFinite(ctx.spy) ? r.move - ctx.spy : null;
  return r;
};
/* all rows at once: {rows: {SYM: row}, spy: SPY's move (percent) or null, ph} */
E.radarRows = function (qs, bases, ctx) {
  const s = qs.SPY ? E.radarRow("SPY", qs.SPY, bases.SPY, Object.assign({}, ctx, {spy: null})) : null, spy = s && s.move != null ? s.move : null, rows = {};
  Object.keys(qs).forEach(k => { const r = E.radarRow(k, qs[k], bases[k], Object.assign({}, ctx, {spy})); if (r) rows[k] = r; });
  return {rows, spy, ph: E.radarPhase(ctx.now, ctx.clock)};
};
/* what a row is ranked by. "inplay": relative volume (in pre-market, when volume has not started counting, the
   size of the move against the last close). "rs": its move minus SPY's. null: can't be ranked. */
E.radarScore = function (r, view, ph) {
  if (!r) return null;
  if (view === "rs") return r.rs;
  if (ph === "pre") return r.ext ? Math.abs(r.ext.pct) : null;
  return r.stale ? null : r.rvol;
};
/* the filters: a price floor and a floor on the session's dollar volume (IEX) */
E.radarPass = (r, f) => !!r && (!(f && f.minPx > 0) || r.last >= f.minPx) && (!(f && f.minDv > 0) || r.dv >= f.minDv);
/* a calm ranking. scored: [{sym, score}] (higher first); prev: the order shown until now. A ticker already listed
   only moves above its neighbour when it beats it by more than `h` (10%), so two names with nearly the same score
   don't keep swapping places; a newcomer is placed by its score as it is. With no previous order: a plain sort. */
E.radarRank = function (prev, scored, h) {
  h = h == null ? 0.1 : h;
  const sc = new Map(); (scored || []).forEach(x => { if (x && x.score != null && isFinite(x.score)) sc.set(x.sym, x.score); });
  const plain = (a, b) => sc.get(b) - sc.get(a) || (a < b ? -1 : a > b ? 1 : 0);
  const kept = (prev || []).filter(s => sc.has(s)), was = new Set(kept);
  if (!kept.length) return [...sc.keys()].sort(plain);
  const beats = (a, b, tol) => sc.get(a) - sc.get(b) > tol * Math.max(Math.abs(sc.get(b)), 1e-9);
  const list = [];
  [...kept, ...[...sc.keys()].filter(s => !was.has(s)).sort(plain)].forEach(s => {
    let i = list.length; const tol = was.has(s) ? h : 0;
    while (i > 0 && beats(s, list[i - 1], was.has(list[i - 1]) ? tol : 0)) i--;
    list.splice(i, 0, s);
  });
  return list;
};
/* a volume surge: the latest one-minute bar against the pace normal for that minute (the 20-day average day x the
   slope of the curve there). Only inside the regular session, after its first five minutes (the open is always a
   burst), for a bar no more than three minutes old. -> {x, t, v} or null */
E.radarShock = function (q, base, now) {
  if (!q || !base || !(q.mv > 0) || !(q.mt > 0) || !(base.av >= E.RADAR_MIN_AV) || now < q.mt || now - q.mt > 180e3) return null;
  const tp = E.etParts(q.mt), len = E.closeMins(tp.date) - 570, m = tp.mins - 570;
  if (!E.isTradingDay(tp.date) || m < 5 || m >= len) return null;
  const usual = base.av * (E.radarDayFrac(m + 1, len) - E.radarDayFrac(m, len)), x = usual > 0 ? q.mv / usual : 0;
  return x >= E.RADAR_SHOCK_X && q.mv * (q.mc || q.c) >= E.RADAR_SHOCK_USD ? {x, t: q.mt, v: q.mv} : null;
};
/* the tags on a row, most telling first: [{k, t (the words), tone, tip (one sentence)}].
   ctx: {ph, today, er {d, hour, prev (true: the session before today)}, news {h, mins}, ping {x, t}, time (ms -> "10:31 AM")} */
E.radarTags = function (r, ctx) {
  ctx = ctx || {};
  const T = [], ph = ctx.ph || "open", add = (k, t, tone, tip) => T.push({k, t, tone, tip});
  const xs = v => (v >= 9.95 ? String(Math.round(v)) : v.toFixed(1)) + "×", p1 = v => Math.abs(v).toFixed(1) + "%";
  const time = ms => ctx.time ? ctx.time(ms) : "", cur = r.day === ctx.today, day = cur ? "today" : "in the last session", Day = cur ? "Today's" : "The last session's";
  if (ctx.ping && ph === "open") add("surge", "Volume surge", "hot", `A sudden burst of trading${time(ctx.ping.t) ? " at " + time(ctx.ping.t) : ""}: about ${Math.round(ctx.ping.x)} times its usual volume for one minute at that time of day.`);
  const er = ctx.er;
  if (er && er.d === ctx.today) add("er", er.hour === "amc" ? "Earnings after close" : "Earnings today", "warn",
    er.hour === "amc" ? "Reports earnings after the close today, so the results are not in this price yet." : er.hour === "bmo" ? "Reported earnings before the open today: this is the first session to trade on the results." : "Reports earnings today (the time of day is not listed).");
  else if (er && er.prev && er.hour === "amc") add("er", "Just reported", "warn", `Reported earnings after the close on ${E.mdLabel(er.d)}: the session after that is the first to trade on the results.`);
  if (ctx.news && ctx.news.h) add("news", "News", "info", `“${String(ctx.news.h).slice(0, 150)}” (${ctx.news.mins < 1 ? "just now" : Math.round(ctx.news.mins) + " min ago"})`);
  if (r.ext && ph !== "pre" && Math.abs(r.ext.pct) >= 1) add("ext", "After hours " + E.fmtPct(r.ext.pct, 1), r.ext.pct > 0 ? "xup" : "xdown",
    `The latest after-hours trade${time(r.ext.t) ? " (" + time(r.ext.t) + ", IEX)" : " (IEX)"} was ${E.fmtPx(r.ext.p)}, ${p1(r.ext.pct)} ${r.ext.pct > 0 ? "above" : "below"} the close.`);
  if (r.stale) { add("quiet", "No trade yet today", "mute", "No trade on IEX in today's session yet, so the price shown is still the last close."); return T; }
  if (r.rvol != null && r.rvol >= 2) {
    if (ph === "pre") add("vol", "Heavy volume last session", "vol", `Traded ${xs(r.rvol)} its 20-day average volume in the last session (${E.mdLabel(r.day)}).`);
    else add("vol", r.rvol >= 5 ? "Extreme volume" : "Unusual volume", r.rvol >= 5 ? "vol2" : "vol",
      r.live ? `Trading ${xs(r.rvol)} its usual volume for this time of day (today's volume so far against its 20-day average, IEX).` : `Traded ${xs(r.rvol)} its 20-day average volume ${day} (IEX).`);
  }
  if (ph === "pre") { if (r.ext && r.ext.big) add("gap", r.ext.pct > 0 ? "Gapping up" : "Gapping down", r.ext.pct > 0 ? "up" : "down",
    `Trading ${p1(r.ext.pct)} ${r.ext.pct > 0 ? "above" : "below"} the last close in the pre-market (IEX). It is only a gap if it holds to the open.`); }
  else if (r.gap) { const g = r.gap, up = g.dir > 0, open = `Opened ${p1(g.pct)} ${up ? "above" : "below"} the previous close`;
    add("gap", `Gap ${up ? "up" : "down"} ${g.state}`, g.state === "holding" ? (up ? "up" : "down") : g.state === "fading" ? "fade" : "mute",
      g.state === "holding" ? `${open} and has kept the gap: the price is still ${g.fill <= 0 ? (up ? "at or above" : "at or below") : "close to"} the open.`
      : g.state === "fading" ? `${open} and has given back about ${Math.round(g.fill * 100)}% of the gap.`
      : `${open} and has come all the way back to it: the gap is filled.`); }
  if (ph !== "pre") {
    if (r.hi52) add("hi", "New 52-wk high", "up2", `${Day} high of ${E.fmtPx(r.h)} passed its highest price of the past 52 weeks (${E.fmtPx(r.ref.h52)}).`);
    else if (r.hi20) add("hi", "New 20-day high", "up", `${Day} high of ${E.fmtPx(r.h)} passed its highest price of the past 20 sessions (${E.fmtPx(r.ref.h20)}).`);
    if (r.lo52) add("lo", "New 52-wk low", "down2", `${Day} low of ${E.fmtPx(r.l)} fell under its lowest price of the past 52 weeks (${E.fmtPx(r.ref.l52)}).`);
    else if (r.lo20) add("lo", "New 20-day low", "down", `${Day} low of ${E.fmtPx(r.l)} fell under its lowest price of the past 20 sessions (${E.fmtPx(r.ref.l20)}).`);
    if (r.rng != null && r.rng >= 1.5) add("rng", "Range " + xs(r.rng) + " ATR", "mute", `${Day} range, counting any gap, is ${xs(r.rng)} its average daily range (14-day ATR of ${E.fmtPx(r.atr)}): a much bigger day than usual.`);
    if (r.vwap != null && Math.abs(r.vwap) >= 0.15) add("vwap", r.vwap > 0 ? "Above VWAP" : "Below VWAP", r.vwap > 0 ? "sup" : "sdown",
      `${r.live ? "The price is" : "It closed"} ${p1(r.vwap)} ${r.vwap > 0 ? "above" : "below"} ${cur ? "today's" : "that session's"} volume-weighted average price of ${E.fmtPx(r.vw)} (IEX trades), so the average share traded ${cur ? "today" : "that day"} sits at a ${r.vwap > 0 ? "gain" : "loss"}.`);
  }
  return T;
};
/* the scope's scales. radarCap: how far the sideways axis reaches (percent), a round step past 90% of the moves
   and past every move in `fit` (the in-play tickers, which must never be pushed to the edge).
   radarTop: the top of the volume axis, a power of two from 4. radarXY: where a dot goes, x and y from 0 to 1
   (0.5 is no change; the volume axis is logarithmic from 0.25 times usual), pinned to the edge when off the scale. */
E.radarCap = function (moves, fit) {
  const abs = l => (l || []).filter(v => v != null && isFinite(v)).map(Math.abs), a = abs(moves).sort((x, y) => x - y);
  if (!a.length) return 3;
  const q = Math.max(a[Math.min(a.length - 1, Math.floor(a.length * 0.9))], ...abs(fit));
  return [2, 3, 4, 6, 8, 12, 16, 24, 40].find(s => s >= q * 1.04) || 40;
};
E.radarTop = function (rvols) { const m = Math.max(0, ...(rvols || []).filter(v => v != null && isFinite(v))); return [4, 8, 16, 32].find(s => s >= m) || 32; };
E.radarXY = function (move, rvol, cap, top) {
  if (move == null || !isFinite(move) || rvol == null || !isFinite(rvol)) return null;
  const x = 0.5 + move / cap / 2, y = Math.log(Math.max(rvol, 1e-9) / 0.25) / Math.log(top / 0.25);
  return {x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), off: x < 0 || x > 1 || y > 1};
};
/* ===== RADAR END ===== */

/* (spacer so the three regions merge cleanly) */

/* =====================================================================
   ===== PLAN BEGIN: Game plan (plan.js). Only this builder edits between BEGIN and END. =====
   ===================================================================== */

/* ---- 1. The official calendar of what moves the market (read from the publishers' own pages, see PLAN_SOURCES).
   Only dates found on those pages are listed. A schedule that is not published yet stays empty and the page says
   so (E.planCoverage); nothing here is a guess. Times are New York time. ---- */
E.PLAN_CHECKED = "2026-11-24";   // the day the pages below were read; dates before it are left out
E.PLAN_SOURCES = {
  fomc:   {name:"Federal Reserve", url:"https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", note:"2026 meetings; 2027 and Jan 2028 as revised in the Fed's press release of 2026-11-12 (https://www.federalreserve.gov/newsevents/pressreleases/monetary20261112a.htm); 2027 dates stay tentative until the meeting before confirms them"},
  cpi:    {name:"Bureau of Labor Statistics", url:"https://www.bls.gov/schedule/news_release/cpi.htm"},
  ppi:    {name:"Bureau of Labor Statistics", url:"https://www.bls.gov/schedule/news_release/ppi.htm"},
  jobs:   {name:"Bureau of Labor Statistics", url:"https://www.bls.gov/schedule/news_release/empsit.htm"},
  gdp:    {name:"Bureau of Economic Analysis", url:"https://www.bea.gov/news/schedule/full", note:"2027: https://www.bea.gov/news/schedule/next-year"},
  pce:    {name:"Bureau of Economic Analysis", url:"https://www.bea.gov/news/schedule/full", note:"Personal Income and Outlays; 2027: https://www.bea.gov/news/schedule/next-year"},
  retail: {name:"Census Bureau", url:"https://www.census.gov/economic-indicators/calendar-listview-2026.html", note:"2027: https://census.gov/retail/release_schedule.html"},
  opex:   {name:"computed", url:"", note:"third Friday of the month, the Thursday before when that Friday is an NYSE holiday (E.HOLIDAYS, NYSE Group calendar)"}
};
E.PLAN_KINDS = {
  fomc:   {name:"FOMC decision", mins:840, big:3, tip:"The Fed's interest-rate decision and statement at 2:00 PM ET, followed by the chair's press conference. It moves rate-sensitive stocks, bonds and the dollar."},
  fomc1:  {name:"FOMC meeting, day 1", mins:null, big:1, tip:"First day of the Fed's two-day meeting. No decision today: the statement comes tomorrow at 2:00 PM ET."},
  fomcs:  {name:"FOMC strategy meeting", mins:null, big:1, tip:"A meeting set aside for the Fed's broad strategy. The Fed says no policy decision is announced after it."},
  fomcmin:{name:"FOMC minutes", mins:840, big:2, tip:"The record of what the Fed's last meeting discussed, released 2:00 PM ET. It can shift rate expectations."},
  cpi:    {name:"CPI", mins:510, big:3, tip:"Consumer prices (inflation) for last month, 8:30 AM ET. A surprise moves rate expectations and the whole market."},
  ppi:    {name:"PPI", mins:510, big:1, tip:"Producer (wholesale) prices for last month, 8:30 AM ET."},
  jobs:   {name:"Jobs report", mins:510, big:3, tip:"Payrolls and the unemployment rate for last month, 8:30 AM ET. One of the biggest scheduled movers."},
  pce:    {name:"PCE inflation", mins:510, big:2, tip:"Personal Income and Outlays, with the PCE price index the Fed watches most, 8:30 AM ET."},
  gdp:    {name:"GDP", mins:510, big:2, tip:"Growth in the economy for the quarter, 8:30 AM ET. The first (advance) estimate moves markets most."},
  retail: {name:"Retail sales", mins:510, big:2, tip:"What shoppers spent last month, 8:30 AM ET. A read on consumer demand."},
  opex:   {name:"Options expiration", mins:null, big:2, tip:"Monthly stock options expire at the close. Heavy open interest can pin prices near big strikes and lift volume."},
  quad:   {name:"Quad witching", mins:null, big:3, tip:"Quarterly expiration: stock options, index options and index futures all expire at the close. Volume is often the heaviest of the quarter."},
  holiday:{name:"Market closed", mins:null, big:0, tip:"The NYSE and Nasdaq are closed all day."},
  early:  {name:"Early close", mins:null, big:1, tip:"Stocks stop trading early (1:00 PM ET), and volume is usually thin."},
  night:  {name:"Overnight trading starts", mins:1260, big:1, tip:"Nasdaq's planned overnight session (Sunday to Friday, about 23 hours a day). Free price feeds carry no overnight prices."},
  earn:   {name:"Earnings", mins:null, big:1, tip:"Companies report results; prices can gap at the open (before-open reports) or the next morning (after-close reports)."}
};
/* [date, what it covers, flags]. flags: "s" meeting with new projections, "t" tentative until the meeting before confirms it */
E.PLAN_DATES = {
  fomc:   [["2026-12-09", "Dec 8-9 meeting", "s"], ["2027-01-27", "Jan 26-27 meeting", "t"], ["2027-03-17", "Mar 16-17 meeting", "t"], ["2027-04-28", "Apr 27-28 meeting", "t"],
           ["2027-06-09", "Jun 8-9 meeting", "t"], ["2027-07-28", "Jul 27-28 meeting", "t"], ["2027-09-15", "Sep 14-15 meeting", "t"], ["2027-11-17", "Nov 16-17 meeting", "t"], ["2028-01-26", "Jan 25-26 meeting", "t"]],
  fomcs:  [["2027-10-26", "Oct 26-27 meeting", "t"]],
  fomcmin:[],   // the Fed has not posted the minutes date for the Dec 8-9 meeting yet
  cpi:    [["2026-12-10", "November"], ["2027-01-13", "December"], ["2027-02-11", "January"], ["2027-03-10", "February"], ["2027-04-13", "March"], ["2027-05-12", "April"], ["2027-06-10", "May"],
           ["2027-07-14", "June"], ["2027-08-11", "July"], ["2027-09-14", "August"], ["2027-10-14", "September"], ["2027-11-10", "October"], ["2027-12-10", "November"]],
  ppi:    [["2026-12-15", "November"], ["2027-01-14", "December"], ["2027-02-12", "January"], ["2027-03-12", "February"], ["2027-04-14", "March"], ["2027-05-13", "April"], ["2027-06-11", "May"],
           ["2027-07-15", "June"], ["2027-08-10", "July"], ["2027-09-10", "August"], ["2027-10-15", "September"], ["2027-11-12", "October"], ["2027-12-15", "November"]],
  jobs:   [["2026-12-04", "November"], ["2027-01-08", "December"], ["2027-02-05", "January"], ["2027-03-05", "February"], ["2027-04-02", "March"], ["2027-05-07", "April"], ["2027-06-04", "May"],
           ["2027-07-02", "June"], ["2027-08-06", "July"], ["2027-09-03", "August"], ["2027-10-08", "September"], ["2027-11-05", "October"], ["2027-12-03", "November"]],
  gdp:    [["2026-11-25", "Q3, second estimate"], ["2026-12-23", "Q3, third estimate"], ["2027-01-28", "Q4, first estimate"], ["2027-02-25", "Q4, second estimate"], ["2027-03-31", "Q4, third estimate"],
           ["2027-04-29", "Q1, first estimate"], ["2027-05-27", "Q1, second estimate"], ["2027-06-25", "Q1, third estimate"], ["2027-07-29", "Q2, first estimate"], ["2027-08-25", "Q2, second estimate"],
           ["2027-09-30", "Q2, third estimate"], ["2027-10-28", "Q3, first estimate"], ["2027-11-24", "Q3, second estimate"], ["2027-12-22", "Q3, third estimate"]],
  pce:    [["2026-11-25", "October"], ["2026-12-23", "November"], ["2027-01-28", "December"], ["2027-02-25", "January"], ["2027-03-31", "February"], ["2027-04-29", "March"], ["2027-05-27", "April"],
           ["2027-06-25", "May"], ["2027-07-29", "June"], ["2027-08-25", "July"], ["2027-09-30", "August"], ["2027-10-28", "September"], ["2027-11-24", "October"], ["2027-12-22", "November"]],
  retail: [["2026-12-16", "November"], ["2027-01-15", "December"], ["2027-02-17", "January"], ["2027-03-16", "February"], ["2027-04-16", "March"], ["2027-05-14", "April"], ["2027-06-16", "May"],
           ["2027-07-16", "June"], ["2027-08-16", "July"], ["2027-09-16", "August"], ["2027-10-15", "September"], ["2027-11-16", "October"], ["2027-12-15", "November"]]
};
/* schedules that end before the window does: the page says "not published yet" for these instead of guessing */
E.planCoverage = function (now, days) {
  const end = E.addDays(E.etDateOf(now), days), out = [];
  Object.keys(E.PLAN_DATES).forEach(k => {
    if (k === "fomcs") return;
    const L = E.PLAN_DATES[k], last = L.length ? L[L.length - 1][0] : null;
    if (!last || last < end) out.push({k, name:E.PLAN_KINDS[k].name, through:last});
  });
  return out;
};
E.thirdFriday = function (y, m) {
  const p = n => String(n).padStart(2, "0"), first = E.weekday(`${y}-${p(m)}-01`), fri = 1 + ((5 - first + 7) % 7) + 14;
  return `${y}-${p(m)}-${p(fri)}`;
};
/* monthly options expire on the third Friday; when that is a market holiday, the day before (Juneteenth 2026 and 2027) */
E.optionsExpiry = function (y, m) { const d = E.thirdFriday(y, m); return E.isTradingDay(d) ? d : E.prevTradingDay(d); };
E.isQuadMonth = m => m % 3 === 0;
E.holidayName = function (d) {
  const m = +d.slice(5, 7), day = +d.slice(8, 10);
  if (m === 1) return day <= 2 ? "New Year's Day" : "Martin Luther King Jr. Day";
  if (m === 2) return "Presidents Day";
  if (m === 3 || m === 4) return "Good Friday";
  if (m === 5) return "Memorial Day";
  if (m === 6) return "Juneteenth";
  if (m === 7) return "Independence Day";
  if (m === 9) return "Labor Day";
  if (m === 11) return "Thanksgiving";
  if (m === 12) return day >= 20 ? "Christmas" : "New Year's Day";
  return "Market holiday";
};
/* a published date as an event; t is the moment it happens (all-day items get a nominal moment that orders them) */
E.planEvent = function (k, d, extra) {
  const K = E.PLAN_KINDS[k], mins = K.mins;
  return Object.assign({k, d, name:K.name, big:K.big, tip:K.tip, mins, timed:mins != null, t:E.etMs(d, mins != null ? mins : 0)}, extra || {});
};
E.PLAN_EVENTS = (function () {
  const out = [];
  Object.keys(E.PLAN_DATES).forEach(k => E.PLAN_DATES[k].forEach(r => {
    const flags = r[2] || "", ex = {ref:r[1], tentative:flags.includes("t"), sep:flags.includes("s")};
    if (k === "fomc") {
      out.push(E.planEvent("fomc", r[0], Object.assign({}, ex, {tip:E.PLAN_KINDS.fomc.tip + (ex.sep ? " This meeting also brings new projections (the dot plot)." : "") + (ex.tentative ? " The date is tentative until the meeting before it confirms it." : "")})));
      out.push(E.planEvent("fomc1", E.addDays(r[0], -1), {ref:r[1], tentative:ex.tentative, t:E.etMs(E.addDays(r[0], -1), 960)}));
    } else if (k === "fomcs") {
      out.push(E.planEvent("fomcs", r[0], Object.assign({}, ex, {t:E.etMs(r[0], 960)})));
    } else out.push(E.planEvent(k, r[0], ex));
  }));
  return out;
})();
/* what is coming from today until `days` days out: published releases, computed options expirations, market
   holidays and early closes, the overnight start, and grouped earnings. o.earn: [{sym, d, hour ("bmo"|"amc"|""), mine}] */
E.planEvents = function (now, o) {
  o = o || {};
  const p = E.etParts(now), today = p.date, end = E.addDays(today, o.days || 14), out = [];
  E.PLAN_EVENTS.forEach(ev => { if (ev.d >= today && ev.d <= end) out.push(Object.assign({}, ev)); });
  for (let y = +today.slice(0, 4), m = +today.slice(5, 7), i = 0; i < 4; i++, m++) {
    if (m > 12) { m = 1; y++; }
    const d = E.optionsExpiry(y, m);
    if (d >= today && d <= end && E.calendarValid(d)) out.push(E.planEvent(E.isQuadMonth(m) ? "quad" : "opex", d, {t:E.etMs(d, E.closeMins(d)), ref:E.isQuadMonth(m) ? "Index and stock options and futures expire at the close" : "Monthly options expire at the close", early:E.closeMins(d) < 960}));
  }
  for (let d = today; d <= end && E.calendarValid(d); d = E.addDays(d, 1)) {
    if (E.HOLIDAYS.has(d) && E.weekday(d) !== 0 && E.weekday(d) !== 6) out.push(E.planEvent("holiday", d, {ref:E.holidayName(d), t:E.etMs(d, 570)}));
    else if (E.EARLY_CLOSE[d]) out.push(E.planEvent("early", d, {ref:"Stocks stop at 1:00 PM ET", t:E.etMs(d, E.EARLY_CLOSE[d])}));
  }
  { const nd = E.etDateOf(E.OVERNIGHT_FROM); if (nd >= today && nd <= end) out.push(E.planEvent("night", nd, {t:E.OVERNIGHT_FROM, ref:"planned start, subject to SEC approval"})); }
  const g = {};
  (o.earn || []).forEach(e => { if (!e || !e.d || e.d < today || e.d > end) return;
    const h = e.hour === "bmo" || e.hour === "amc" ? e.hour : "", key = e.d + "|" + h, G = g[key] || (g[key] = {d:e.d, hour:h, syms:[]});
    if (!G.syms.some(s => s.sym === e.sym)) G.syms.push({sym:e.sym, mine:!!e.mine}); });
  Object.keys(g).forEach(key => { const G = g[key], mine = G.syms.some(s => s.mine);
    G.syms.sort((a, b) => (b.mine - a.mine) || a.sym.localeCompare(b.sym));
    out.push(E.planEvent("earn", G.d, {hour:G.hour, syms:G.syms, mine, big: mine ? 2 : 1, ref:G.hour === "bmo" ? "before the open" : G.hour === "amc" ? "after the close" : "time not given", t:E.etMs(G.d, G.hour === "bmo" ? 420 : G.hour === "amc" ? 970 : 720)})); });
  out.forEach(ev => { ev.today = ev.d === today; ev.past = ev.t <= now; ev.left = ev.t - now; });
  return out.sort((a, b) => a.t - b.t || b.big - a.big || a.name.localeCompare(b.name));
};
/* the events worth a card at the top: not out yet (or released in the last 90 minutes), big enough to matter */
E.planNextUp = function (events, now, n) {
  return events.filter(ev => ev.big >= 2 && (!ev.past || (ev.timed && now - ev.t < 90 * 60e3))).slice(0, n || 4);
};
/* "1 d 3 h", "2 h 05 min", "45 min" */
E.planLeft = function (ms) {
  if (!(ms > 0)) return "now";
  const mins = Math.ceil(ms / 60e3);
  if (mins < 60) return mins + " min";
  const h = Math.floor(mins / 60);
  if (h < 24) return h + " h " + String(mins % 60).padStart(2, "0") + " min";
  return Math.floor(h / 24) + " d " + (h % 24) + " h";
};
/* "today", "tomorrow", "in 5 days" for two ET dates */
E.planDayWord = function (d, today) {
  const n = Math.round((Date.parse(d + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 864e5);
  return n <= 0 ? "today" : n === 1 ? "tomorrow" : "in " + n + " days";
};

/* ---- 2. Key levels ---- */
E.PLAN_LV = {
  pdh:  {s:"PDH",       n:"prior-day high",       side:"hi", g:"pd",  tip:"Yesterday's highest price: above it buyers have beaten yesterday's ceiling, and stalling under it shows it still caps price."},
  pdl:  {s:"PDL",       n:"prior-day low",        side:"lo", g:"pd",  tip:"Yesterday's lowest price: below it sellers have broken yesterday's floor, and holding above it shows it still supports price."},
  pdc:  {s:"PDC",       n:"prior-day close",      side:"mid",g:"pd",  tip:"Yesterday's closing price, the line the day's change is measured from."},
  pmh:  {s:"PM high",   n:"pre-market high",      side:"hi", g:"pm",  tip:"The highest price before the open (4:00 to 9:30 AM ET, IEX trades): a move over it means the open is stronger than the pre-market."},
  pml:  {s:"PM low",    n:"pre-market low",       side:"lo", g:"pm",  tip:"The lowest price before the open (4:00 to 9:30 AM ET, IEX trades): a move under it means the open is weaker than the pre-market."},
  or5h: {s:"OR5 high",  n:"5-minute range high",  side:"hi", g:"or",  tip:"The highest price in the first 5 minutes after the 9:30 open, the first line many day traders watch."},
  or5l: {s:"OR5 low",   n:"5-minute range low",   side:"lo", g:"or",  tip:"The lowest price in the first 5 minutes after the 9:30 open."},
  or15h:{s:"OR15 high", n:"15-minute range high", side:"hi", g:"or",  tip:"The highest price in the first 15 minutes after the open: a break above it often sets the tone for the morning."},
  or15l:{s:"OR15 low",  n:"15-minute range low",  side:"lo", g:"or",  tip:"The lowest price in the first 15 minutes after the open: a break below it often sets the tone for the morning."},
  vwap: {s:"VWAP",      n:"today's VWAP",         side:"mid",g:"vw",  tip:"The day's average price weighted by volume (from IEX trades): above it buyers are ahead of the day's average, below it sellers are."},
  hi20: {s:"20d high",  n:"20-day high",          side:"hi", g:"lng", tip:"The highest price in the last 20 trading days, through yesterday."},
  lo20: {s:"20d low",   n:"20-day low",           side:"lo", g:"lng", tip:"The lowest price in the last 20 trading days, through yesterday."},
  hi52: {s:"52w high",  n:"52-week high",         side:"hi", g:"lng", tip:"The highest price in the last 52 weeks."},
  lo52: {s:"52w low",   n:"52-week low",          side:"lo", g:"lng", tip:"The lowest price in the last 52 weeks."}
};
E.PLAN_LV_ORDER = ["pdh", "pdl", "pdc", "vwap", "pmh", "pml", "or5h", "or5l", "or15h", "or15l", "hi20", "lo20", "hi52", "lo52"];
/* the session a prior-day level belongs to: yesterday until 15 minutes after the close, then today's own */
E.planPriorDay = function (now) {
  const p = E.etParts(now);
  return E.isTradingDay(p.date) && p.mins >= E.closeMins(p.date) + 15 ? p.date : E.prevTradingDay(p.date);
};
/* the day whose pre-market and opening range still matter: a trading day from 4:00 AM ET to 15 minutes after the close */
E.planSessionDay = function (now) {
  const p = E.etParts(now);
  return E.isTradingDay(p.date) && p.mins >= 240 && p.mins < E.closeMins(p.date) + 15 ? p.date : null;
};
/* daily bars (newest first: [date, open, high, low, close, volume]) -> prior-day, 20-day and 52-week levels.
   fresh: the newest bar at or before `prior` IS `prior` (otherwise the prior-day levels are left out, not guessed) */
E.planDaily = function (bars, prior) {
  if (!Array.isArray(bars) || !bars.length) return null;
  let i = 0; while (i < bars.length && bars[i][0] > prior) i++;
  if (i >= bars.length) return null;
  const b = bars[i], ok = x => isFinite(x) && x > 0, o = {asOf:b[0], fresh:b[0] === prior};
  if (o.fresh && ok(+b[2]) && ok(+b[3]) && ok(+b[4])) { o.pdh = +b[2]; o.pdl = +b[3]; o.pdc = +b[4]; }
  const hl = list => { const hs = list.map(x => +x[2]).filter(ok), ls = list.map(x => +x[3]).filter(ok); return hs.length && ls.length ? {h:Math.max(...hs), l:Math.min(...ls), n:hs.length} : null; };
  const w20 = hl(bars.slice(i, i + 20)); if (w20 && w20.n >= 15) { o.hi20 = w20.h; o.lo20 = w20.l; }
  const cut = E.addDays(b[0], -365), w52 = []; for (let j = i; j < bars.length && bars[j][0] > cut; j++) w52.push(bars[j]);
  const y = hl(w52); if (y && y.n >= 200) { o.hi52 = y.h; o.lo52 = y.l; }
  return o;
};
/* 5-minute bars ([{t: ms, h, l}], any order) for one date -> pre-market and opening-range levels, each only once it is complete */
E.planIntraday = function (bars, date, now) {
  const p = E.etParts(now), mins = p.date === date ? p.mins : p.date > date ? 1440 : 0, o = {pmDone:mins >= 570, or5Done:mins >= 575, or15Done:mins >= 585};
  const grab = (a, b) => { let h = null, l = null; (bars || []).forEach(x => { const q = E.etParts(x.t); if (q.date !== date || q.mins < a || q.mins >= b || !(x.h > 0) || !(x.l > 0)) return; h = h == null ? +x.h : Math.max(h, +x.h); l = l == null ? +x.l : Math.min(l, +x.l); }); return h == null ? null : {h, l}; };
  const pm = grab(240, 570), r5 = o.or5Done ? grab(570, 575) : null, r15 = o.or15Done ? grab(570, 585) : null;
  if (pm) { o.pmh = pm.h; o.pml = pm.l; }
  if (r5) { o.or5h = r5.h; o.or5l = r5.l; }
  if (r15) { o.or15h = r15.h; o.or15l = r15.l; }
  return o;
};
/* which fetch the opening phases call for: "pre" (developing pre-market, again every 5 min), "pm" (pre-market done, 9:31), "or5" (9:36), "or15" (9:46) */
E.PLAN_PH_RANK = {none:0, pre:1, pm:2, or5:3, or15:4};
E.planPhase = function (now) {
  const d = E.planSessionDay(now); if (!d) return {date:null, ph:"none"};
  const m = E.etParts(now).mins;
  return {date:d, ph: m >= 586 ? "or15" : m >= 576 ? "or5" : m >= 571 ? "pm" : "pre"};
};
E.planFetchDue = function (st, now) {
  const P = E.planPhase(now); if (!P.date) return null;
  if (!st || st.date !== P.date) return P.ph;
  if (E.PLAN_PH_RANK[P.ph] > E.PLAN_PH_RANK[st.ph || "none"]) return P.ph;
  if (P.ph === "pre" && now - (st.at || 0) >= 5 * 60e3) return "pre";
  return null;
};
/* every level we have for one ticker: s = {daily, intra, vwap, m52:{hi, lo}, pc} (pc, the quote's previous close, is used only when the daily levels have none) */
E.planLevels = function (s) {
  const L = {}, put = (k, v) => { if (v != null && isFinite(+v) && +v > 0) L[k] = +v; }, d = s.daily || {}, it = s.intra || {};
  put("pdh", d.pdh); put("pdl", d.pdl); put("pdc", d.pdc != null ? d.pdc : s.pc); put("hi20", d.hi20); put("lo20", d.lo20);
  const m = s.m52 || {}; put("hi52", m.hi > 0 ? m.hi : d.hi52); put("lo52", m.lo > 0 ? m.lo : d.lo52);
  put("pmh", it.pmh); put("pml", it.pml);
  if (it.or5Done) { put("or5h", it.or5h); put("or5l", it.or5l); }
  if (it.or15Done) { put("or15h", it.or15h); put("or15l", it.or15l); }
  put("vwap", s.vwap);
  return L;
};
/* the levels around a price: equal levels (within 0.01%) share one tick; up/dn are the nearest above and below; near are within `near` percent */
E.planLadder = function (L, px, near) {
  near = near == null ? 0.5 : near;
  const ks = Object.keys(L).filter(k => E.PLAN_LV[k] && L[k] > 0).sort((a, b) => L[a] - L[b] || E.PLAN_LV_ORDER.indexOf(a) - E.PLAN_LV_ORDER.indexOf(b)), ticks = [];
  ks.forEach(k => { const t = ticks[ticks.length - 1]; if (t && Math.abs(L[k] / t.v - 1) < 1e-4) t.ks.push(k); else ticks.push({v:L[k], ks:[k]}); });
  ticks.forEach(t => { t.usd = t.v - px; t.pct = px > 0 ? (t.v / px - 1) * 100 : null; t.ks.sort((a, b) => E.PLAN_LV_ORDER.indexOf(a) - E.PLAN_LV_ORDER.indexOf(b)); });
  let up = null, dn = null;
  ticks.forEach(t => { if (t.v > px && !up) up = t; if (t.v < px) dn = t; });
  const nr = ticks.filter(t => t.pct != null && Math.abs(t.pct) <= near).sort((a, b) => Math.abs(a.pct) - Math.abs(b.pct));
  return {ticks, up, dn, near:nr};
};
/* which side of each level the price is on: 1 above, -1 below (0: exactly on it) */
E.planSides = function (L, px) { const s = {}; Object.keys(L).forEach(k => { s[k] = px > L[k] ? 1 : px < L[k] ? -1 : 0; }); return s; };
/* levels the price crossed between two looks (only when the looks are close together in time) */
E.planFlips = function (prev, sides, now, maxGapMs) {
  if (!prev || !prev.sides || now - prev.at > (maxGapMs || 10 * 60e3)) return [];
  const out = []; Object.keys(sides).forEach(k => { const a = prev.sides[k], b = sides[k]; if (a && b && a !== b) out.push({k, dir:b, t:now}); });
  return out;
};
E.planFlipText = function (k, dir) {
  const lv = E.PLAN_LV[k]; if (!lv) return "";
  if (k === "vwap") return dir > 0 ? "Reclaimed VWAP" : "Lost VWAP";
  if (lv.side === "hi") return dir > 0 ? "Broke " + lv.s : "Back under " + lv.s;
  if (lv.side === "lo") return dir < 0 ? "Broke " + lv.s : "Back over " + lv.s;
  return dir > 0 ? "Reclaimed " + lv.s : "Lost " + lv.s;
};
/* the little labels on a row, most important first: {id, text, tone ("up"|"down"|"warn"|""), tip, rank, fresh}.
   ctx: {open (regular session now), or5Done, or15Done, pmDone, flips:[{k, dir, t}], now, near (percent)} */
E.planChips = function (L, px, ctx) {
  ctx = ctx || {}; const out = [], used = {}, $ = (v, r) => E.fmt$(v, r > 0 && r < 1 ? 4 : 2), now = ctx.now || 0;
  if (!(px > 0)) return out;
  const add = (id, text, tone, tip, rank, key, fresh) => { if (used[id]) return; used[id] = 1; if (key) used["k:" + key] = 1; out.push({id, text, tone, tip, rank, fresh:!!fresh}); };
  (ctx.flips || []).slice().sort((a, b) => E.PLAN_LV_ORDER.indexOf(a.k) - E.PLAN_LV_ORDER.indexOf(b.k)).slice(0, 2).forEach(f => { const lv = E.PLAN_LV[f.k]; if (!lv || !(L[f.k] > 0)) return;
    const ago = Math.max(0, Math.round((now - f.t) / 60e3));
    add("f:" + f.k, E.planFlipText(f.k, f.dir), f.dir > 0 ? "up" : "down", `Price just crossed the ${lv.n} (${$(L[f.k], px)}) ${f.dir > 0 ? "upward" : "downward"}${ago < 1 ? " a moment ago" : ", " + ago + " min ago"}.`, 0, f.k, true); });
  const brk = (k, text, tone, tip, rank) => { if (!used["k:" + k]) add("b:" + k, text, tone, tip, rank, k); };
  if (L.hi52 && px >= L.hi52) brk("hi52", "At 52-week high", "up", `Price is at or above the 52-week high (${$(L.hi52, px)}): there is no older price overhead.`, 1);
  else if (L.lo52 && px <= L.lo52) brk("lo52", "At 52-week low", "down", `Price is at or below the 52-week low (${$(L.lo52, px)}): there is no older price below.`, 1);
  if (L.pdh && px > L.pdh) brk("pdh", "Broke PDH", "up", `Price is above yesterday's high (${$(L.pdh, px)}), so it has pushed through yesterday's ceiling.`, 2);
  else if (L.pdl && px < L.pdl) brk("pdl", "Broke PDL", "down", `Price is below yesterday's low (${$(L.pdl, px)}), so it has broken yesterday's floor.`, 2);
  const orK = ctx.or15Done && L.or15h ? "or15" : ctx.or5Done && L.or5h ? "or5" : null;
  if (orK) { const h = L[orK + "h"], l = L[orK + "l"], mins = orK === "or15" ? 15 : 5;
    if (px > h) brk(orK + "h", "Broke OR high", "up", `Price is above the first ${mins} minutes' high (${$(h, px)}).`, 4);
    else if (px < l) brk(orK + "l", "Broke OR low", "down", `Price is below the first ${mins} minutes' low (${$(l, px)}).`, 4);
    else if (ctx.open) add("or:in", "Inside opening range", "", `Price is between the first ${mins} minutes' low (${$(l, px)}) and high (${$(h, px)}): no break either way yet.`, 4); }
  if (ctx.pmDone && L.pmh && px > L.pmh) brk("pmh", "Over PM high", "up", `Price is above the pre-market high (${$(L.pmh, px)}).`, 5);
  else if (ctx.pmDone && L.pml && px < L.pml) brk("pml", "Under PM low", "down", `Price is below the pre-market low (${$(L.pml, px)}).`, 5);
  if (!orK && L.hi20 && px > L.hi20 && !(L.hi52 && px >= L.hi52)) brk("hi20", "Over 20-day high", "up", `Price is above the 20-day high (${$(L.hi20, px)}).`, 6);
  else if (!orK && L.lo20 && px < L.lo20 && !(L.lo52 && px <= L.lo52)) brk("lo20", "Under 20-day low", "down", `Price is below the 20-day low (${$(L.lo20, px)}).`, 6);
  if (ctx.open && L.vwap) {
    if (px > L.vwap) brk("vwap", "Above VWAP", "up", `Price is above today's VWAP (${$(L.vwap, px)}): buyers are ahead of the day's average price.`, 3);
    else if (px < L.vwap) brk("vwap", "Below VWAP", "down", `Price is below today's VWAP (${$(L.vwap, px)}): sellers are ahead of the day's average price.`, 3); }
  const lad = E.planLadder(L, px, ctx.near);
  lad.near.slice(0, 1).forEach(t => { if (t.ks.every(k => used["k:" + k])) return; const lv = E.PLAN_LV[t.ks[0]], a = Math.abs(t.pct);
    add("n:" + t.ks[0], "Near " + lv.s, "warn", `Price is within ${a.toFixed(2)}% of the ${t.ks.map(k => E.PLAN_LV[k].n).join(" and ")} (${$(t.v, px)}), ${t.v > px ? "just under" : "just over"} it.`, 1); });
  return out.sort((a, b) => a.rank - b.rank);
};
/* ---- 3. The trading day as a bar: pre-market, open, morning, lunch, afternoon, power hour, after hours ---- */
E.planTimeline = function (date) {
  const close = E.closeMins(date), end = close === 960 ? 1200 : close + 240;
  const mid = [[570, "open", "Open", "The first hour: the widest ranges and the heaviest volume."], [630, "morn", "Morning", "Prices usually settle into a trend or a range."],
    [690, "lunch", "Lunch", "Often the quietest stretch (11:30 AM to 1:30 PM ET)."], [810, "aft", "Afternoon", "Volume builds again toward the close."]].filter(x => x[0] < close - 60);
  const segs = [{k:"pre", name:"Pre-market", from:240, to:570, tip:"4:00 to 9:30 AM ET: thin trading, where news and earnings first move prices."}];
  mid.forEach((x, i) => segs.push({k:x[1], name:x[2], from:x[0], to: i + 1 < mid.length ? mid[i + 1][0] : close - 60, tip:x[3]}));
  segs.push({k:"power", name:"Power hour", from:close - 60, to:close, tip:"The last hour before the close: heavier volume as funds trade, and the day's closing move."});
  segs.push({k:"after", name:"After hours", from:close, to:end, tip:"Trading after the close, until " + (end === 1200 ? "8:00 PM" : "5:00 PM") + " ET: thin, and earnings reports often land here."});
  return {close, start:240, end, segs};
};

/* ===== PLAN END ===== */

/* (spacer so the three regions merge cleanly) */

if (typeof module !== "undefined" && module.exports) module.exports = E;
else root.MWE = E;
})(typeof self !== "undefined" ? self : this);
