/* MW Lab engine: the pure, tested core.
   Everything in this file is a plain function of its inputs: no DOM, no storage, no network, no clock
   (the time is always passed in). The page (app.js) feeds it data and shows what it returns; the tests in
   labdev/test run the same file under Node. See METHODS.md for what each number means.
   Public build: no personal data lives in this file. */
(function (root) {
"use strict";
const E = {};
E.VERSION = "4.7.0";

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
E.fmtS$ = (n, d = 0) => (n == null || !isFinite(n)) ? "—" : (n >= 0 ? "+" : "−") + "$" + Math.abs(n).toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d});
E.fmtPct = (n, d = 2) => (n == null || !isFinite(n)) ? "—" : (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(d) + "%";
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
  const sym = ctx.sym, q = ctx.q, px = q.c, $ = E.fmt$, er = ctx.er;
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
    if (!fs.armed && fs.low === px && fs.n) dip.push({id:`${sym}-fast-${fs.n}`, kind:"fast", sym, msg:`${sym} dropped ${((1 - px/(fs.top || top || px))*100).toFixed(1)}% in the last ${mins} min (from ${$(fs.top || top)} to ${$(px)})`});
  }
  if (on(w, "redOn", "dayDrop") && w.dayDrop && q.dp != null && q.dp <= -w.dayDrop) dip.push({id:`${sym}-red`, kind:"red", sym, msg:`${sym} is down ${Math.abs(q.dp).toFixed(1)}% today at ${$(px)}${erTxt}`});
  if (on(w, "sigOn", "sigDrop") && w.sigDrop && ctx.vol && q.dp != null && q.dp / ctx.vol <= -w.sigDrop) dip.push({id:`${sym}-sig`, kind:"sig", sym, msg:`${sym} is down ${Math.abs(q.dp/ctx.vol).toFixed(1)}σ today (${E.fmtPct(q.dp,1)}; a normal day is ±${ctx.vol.toFixed(1)}%)${erTxt}`});
  if (on(w, "hiOn", "hiDrop") && w.hiDrop && q.h && px <= q.h * (1 - w.hiDrop/100)) dip.push({id:`${sym}-hd`, kind:"hd", sym, msg:`${sym} is ${((1 - px/q.h)*100).toFixed(1)}% below today's high (${$(q.h)}), now ${$(px)}${erTxt}`});
  if (lagOk) dip.forEach(a => { a.msg += lagTxt; out.push(a); });
  if (ctx.hi52 && w.offHigh && w.offOn !== false) {
    const off = (1 - px/ctx.hi52)*100, inZone = off >= w.offHigh;
    if (inZone && next.off === false) out.push({id:`${sym}-off`, kind:"off", sym, msg:`${sym} just fell ${off.toFixed(1)}% below its 52-week high (${$(ctx.hi52)})${erTxt}`});
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
    if (hit.length) { const deep = hit[hit.length - 1]; out.push({id:`${sym}-L${deep.L}${deep.tag || ""}`, also:hit.map(x => `${sym}-L${x.L}${x.tag || ""}`), kind:"level", sym, level:deep.L, msg:`${sym} reached your ${deep.name} price alert (now ${$(px)})${hit.length > 1 ? ` · through ${hit.length} alerts` : ""}${erTxt}`}); }
    const nx = ctx.levels.find(x => x.L < px);
    if (nx && on(w, "nearOn", "near") && w.near && px <= nx.L * (1 + w.near/100)) out.push({id:`${sym}-N${nx.L}`, kind:"near", sym, level:nx.L, msg:`${sym} is ${((px/nx.L - 1)*100).toFixed(1)}% above your ${nx.name} price alert`});
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
      news.push({id:`${sym}-leg-${n}`, kind:"fast", sym, leg:true, msg:`${sym} is down another ${((1 - lq.c/lb.px)*100).toFixed(1)}% since the ${opts.timeStr ? opts.timeStr(lb.t) : "last"} alert (${E.fmt$(lb.px)} → ${E.fmt$(lq.c)})`});
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
E.TD_CAPS = {hist:280, vwap:200, backup:120, nav:40, intraday:60, chart:40, xcheck:40, other:20};
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
  fomc: ["2026-12-09","2027-01-27","2027-03-17","2027-04-28","2027-06-09","2027-07-28","2027-09-15","2027-10-27","2027-12-08"],
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
  if (tp.date === today && (tp.mins < 570 || tp.mins >= close) && tp.mins >= 240 && tp.mins < 1200)
    return {reg:null, ext:{p:+lt.p, t:tms, ph: tp.mins < 570 ? "pre" : "after"}};
  return {reg:null, ext:null};
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

if (typeof module !== "undefined" && module.exports) module.exports = E;
else root.MWE = E;
})(typeof self !== "undefined" ? self : this);
