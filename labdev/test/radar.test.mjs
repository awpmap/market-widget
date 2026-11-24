import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fc from "fast-check";
const E = createRequire(import.meta.url)("../../lab/engine.js");
// radar.js engine tests (6.3). Every ticker (AAA, BBB, ...) and every price here is made up.

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);
const T = s => Date.parse(s);
const OPEN = T("2026-11-10T15:45:00Z");    // 10:45 New York, a Tuesday: 75 minutes into the session
const PRE = T("2026-11-10T13:30:00Z");     // 8:30 New York the same day
const AFTER = T("2026-11-10T21:30:00Z");   // 4:30 PM
const SAT = T("2026-11-14T15:00:00Z");     // a Saturday
const DAY = "2026-11-10", PREV = "2026-11-09";
const bar = d => d + "T05:00:00Z";
/* 260 flat sessions before `end`: close 100, high 101, low 99, 1,000,000 shares a day */
function flatBars(end, o = {}) {
  const out = []; let d = end;
  for (let i = 0; i < (o.n || 260); i++) { d = E.prevTradingDay(d); out.push({d, h: o.h || 101, l: o.l || 99, c: o.c || 100, v: o.v == null ? 1e6 : o.v}); }
  return out;
}
const basesFor = (bars, today) => { const a = E.radarBase(bars, today), p = a ? E.radarBase(bars, a.asOf) : null; return [a, p].filter(Boolean); };
const snapOpen = (o = {}) => ({
  dailyBar: {t: bar(DAY), o: o.o ?? 100, h: o.h ?? 101, l: o.l ?? 99.5, c: o.c ?? 100.5, v: o.v ?? 257500, vw: o.vw ?? 100.2},
  prevDailyBar: {t: bar(PREV), o: 100, h: 101, l: 99, c: o.pc ?? 100, v: 1e6, vw: 100},
  latestTrade: {t: new Date(OPEN - 2000).toISOString(), p: o.c ?? 100.5},
  minuteBar: o.mb || {t: new Date(OPEN - 60e3).toISOString(), o: 100, h: 100, l: 100, c: 100, v: 2500}});

test("the universe: about 150 public tickers, no repeats, your own first, no mutual funds", () => {
  const U = E.RADAR_UNIVERSE;
  assert.ok(U.length >= 120 && U.length <= 150, "size " + U.length);
  assert.equal(new Set(U).size, U.length);
  assert.ok(U.every(s => /^[A-Z][A-Z.]{0,6}$/.test(s) && !E.isFundSym(s)));
  assert.ok(["SPY", "QQQ", "IWM", "XLK", "NVDA", "AAPL"].every(s => U.includes(s)));
  const u = E.radarUniverse(["bbb", "AAA", "SPY", "ABCDX", "bad symbol", "", null]);
  assert.deepEqual(u.slice(0, 3), ["BBB", "AAA", "SPY"]);
  assert.equal(u.length, U.length + 2);                    // SPY is not listed twice; the fund and the junk are left out
  assert.ok(u.length <= 200, "your tickers and the list fit in two calls of 100");
});

test("the time-of-day curve rises from 0 to 1 and is busiest at the open and the close", () => {
  assert.equal(E.radarDayFrac(0), 0); assert.equal(E.radarDayFrac(390), 1); assert.equal(E.radarDayFrac(999), 1); assert.equal(E.radarDayFrac(-5), 0);
  let last = 0; for (let m = 1; m <= 390; m++) { const f = E.radarDayFrac(m); assert.ok(f > last, "rises at minute " + m); last = f; }
  near(E.radarDayFrac(75), 0.2575);
  const first = E.radarDayFrac(30), mid = E.radarDayFrac(210) - E.radarDayFrac(180), end = 1 - E.radarDayFrac(360);
  assert.ok(first > 2 * mid && end > 2 * mid, "a U shape");
  near(E.radarDayFrac(105, 210), E.radarDayFrac(195));     // a half day (9:30 to 1:00): the same shape, squeezed
  assert.equal(E.radarDayFrac(210, 210), 1);
});

test("the phase follows the market clock", () => {
  assert.deepEqual([E.radarPhase(OPEN).ph, E.radarPhase(OPEN).sess], ["open", DAY]);
  assert.deepEqual([E.radarPhase(PRE).ph, E.radarPhase(PRE).sess], ["pre", PREV]);
  assert.deepEqual([E.radarPhase(AFTER).ph, E.radarPhase(AFTER).sess], ["after", DAY]);
  const sat = E.radarPhase(SAT);
  assert.deepEqual([sat.ph, sat.sess], ["closed", "2026-11-13"]);
  assert.equal(sat.settled, E.etMs("2026-11-13", 1200));   // Friday 8:00 PM New York
  assert.equal(E.radarPhase(T("2026-11-27T19:00:00Z")).ph, "after");   // the half day after Thanksgiving: closed at 1:00 PM
  assert.equal(E.radarPhase(T("2026-11-26T16:00:00Z")).ph, "closed");  // Thanksgiving
});

test("the baseline uses only sessions before the cut-off", () => {
  const bars = flatBars(DAY);
  bars[0].v = 5e6; bars[0].h = 130;                        // the newest session (the 9th) was a wild one
  bars.push({d: DAY, h: 500, l: 1, c: 50, v: 9e9});        // today's unfinished bar must never count
  const a = E.radarBase(bars, DAY), p = E.radarBase(bars, a.asOf);
  assert.equal(a.asOf, PREV); assert.equal(a.n, 20); assert.equal(a.av, (19 * 1e6 + 5e6) / 20); assert.equal(a.h20, 130); assert.equal(a.h52, 130); assert.equal(a.c, 100);
  assert.equal(p.asOf, E.prevTradingDay(PREV)); assert.equal(p.av, 1e6); assert.equal(p.h20, 101); assert.equal(p.h52, 101); assert.equal(p.l52, 99);
  assert.equal(a.n52, 252);
  assert.ok(p.atr > 1.9 && p.atr < 2.1, "ATR of a flat 99 to 101 range is 2: " + p.atr);
  assert.equal(E.radarBase([], DAY), null); assert.equal(E.radarBase(null, DAY), null);
  assert.equal(E.radarBase(flatBars(DAY, {n: 5}), DAY).n, 5);
});

test("a snapshot in market hours: the live trade is the price, with volume, VWAP and the last minute", () => {
  const q = E.radarSnap(snapOpen({c: 106, o: 104, h: 106.4, l: 103.8, v: 1081500, vw: 105}), OPEN);
  assert.equal(q.day, DAY); assert.equal(q.c, 106); assert.equal(q.pc, 100); assert.equal(q.o, 104); assert.equal(q.v, 1081500); assert.equal(q.vw, 105);
  assert.equal(q.t, OPEN - 2000); assert.equal(q.ext, null); assert.equal(q.mv, 2500); assert.equal(q.mt, OPEN - 60e3);
  assert.equal(E.radarSnap(null, OPEN), null); assert.equal(E.radarSnap({}, OPEN), null); assert.equal(E.radarSnap({dailyBar: {t: bar(DAY), c: 0}}, OPEN), null);
});

test("a snapshot before the open: the last session stays the session, the early trade is pre-market", () => {
  // the usual shape: the daily bar is still yesterday's
  const s1 = {dailyBar: {t: bar(PREV), o: 99, h: 101, l: 98, c: 100, v: 1.2e6, vw: 99.8}, prevDailyBar: {t: bar("2026-11-06"), c: 97}, latestTrade: {t: new Date(PRE - 5000).toISOString(), p: 104}};
  const a = E.radarSnap(s1, PRE);
  assert.equal(a.day, PREV); assert.equal(a.c, 100); assert.equal(a.pc, 97); assert.deepEqual(a.ext, {p: 104, t: PRE - 5000, ph: "pre"});
  // the other shape: the feed has already started today's bar from pre-market trades
  const s2 = {dailyBar: {t: bar(DAY), o: 103, h: 104.5, l: 102.5, c: 104, v: 3000, vw: 103.6}, prevDailyBar: {t: bar(PREV), o: 99, h: 101, l: 98, c: 100, v: 1.2e6, vw: 99.8}, latestTrade: {t: new Date(PRE - 5000).toISOString(), p: 104.2}};
  const b = E.radarSnap(s2, PRE);
  assert.equal(b.day, PREV); assert.equal(b.c, 100); assert.equal(b.v, 1.2e6); assert.equal(b.pc, null); assert.equal(b.pv, 3000);
  assert.deepEqual(b.ext, {p: 104.2, t: PRE - 5000, ph: "pre"});
  // and the row fills the missing previous close from the daily bars
  const r = E.radarRow("AAA", b, basesFor(flatBars(DAY, {c: 100}), DAY), {now: PRE});
  assert.equal(r.pc, 100); near(r.move, 4.2, 1e-9); near(r.moveUsd, 4.2, 1e-9); assert.equal(r.last, 104.2); assert.equal(r.stale, false); assert.equal(r.live, false);
});

test("a snapshot after the close keeps the close and carries the after-hours trade", () => {
  const s = {dailyBar: {t: bar(DAY), o: 100, h: 103, l: 99, c: 102, v: 2e6, vw: 101}, prevDailyBar: {t: bar(PREV), c: 100}, latestTrade: {t: new Date(AFTER - 60e3).toISOString(), p: 105.06}};
  const q = E.radarSnap(s, AFTER);
  assert.equal(q.c, 102); assert.equal(q.ext.ph, "after"); assert.equal(q.ext.p, 105.06);
  const r = E.radarRow("AAA", q, basesFor(flatBars(DAY), DAY), {now: AFTER});
  near(r.pct, 2); near(r.rvol, 2); near(r.ext.pct, 3, 1e-9); assert.equal(r.live, false);
  const tags = E.radarTags(r, {ph: "after", today: DAY});
  assert.equal(tags.find(t => t.k === "ext").t, "After hours +3.0%");
  assert.match(tags.find(t => t.k === "vol").tip, /Traded 2\.0× its 20-day average volume today/);
});

test("relative volume: today's volume against what is normal by this minute", () => {
  const bases = basesFor(flatBars(DAY), DAY);
  const row = (v, now = OPEN) => E.radarRow("AAA", E.radarSnap(snapOpen({v}), now), bases, {now});
  near(row(257500).rvol, 1);                               // 25.75% of a normal day has normally traded by 10:45
  near(row(1081500).rvol, 4.2);
  near(row(128750).rvol, 0.5);
  // the first minutes never read wild: before 9:35 the expected volume is floored at the five-minute figure
  const early = T("2026-11-10T14:31:00Z"), s = snapOpen({v: 35000}); s.latestTrade.t = new Date(early - 1000).toISOString();
  near(E.radarRow("AAA", E.radarSnap(s, early), bases, {now: early}).rvol, 1);
  // too thin to measure: the average is under 20,000 shares, or there are under 10 sessions of history
  const thin = E.radarRow("AAA", E.radarSnap(snapOpen({v: 9000}), OPEN), basesFor(flatBars(DAY, {v: 15000}), DAY), {now: OPEN});
  assert.equal(thin.rvol, null); assert.equal(thin.thin, true);
  assert.equal(E.radarRow("AAA", E.radarSnap(snapOpen(), OPEN), basesFor(flatBars(DAY, {n: 6}), DAY), {now: OPEN}).rvol, null);
  assert.equal(E.radarRow("AAA", E.radarSnap(snapOpen(), OPEN), [], {now: OPEN}).rvol, null);
});

test("at and after the close relative volume is exact: the day's volume over the 20-day average", () => {
  const s = {dailyBar: {t: bar(DAY), o: 100, h: 101, l: 99.5, c: 100.5, v: 3.1e6, vw: 100.2}, prevDailyBar: {t: bar(PREV), c: 100}};
  near(E.radarRow("AAA", E.radarSnap(s, AFTER), basesFor(flatBars(DAY), DAY), {now: AFTER}).rvol, 3.1);
  // on the weekend the list is Friday's, measured against the 20 sessions before Friday
  const fri = "2026-11-13", bars = flatBars("2026-11-14"); bars[0].v = 4e6;   // Friday itself traded 4M
  const q = E.radarSnap({dailyBar: {t: bar(fri), o: 100, h: 101, l: 99.5, c: 100.5, v: 4e6, vw: 100.2}, prevDailyBar: {t: bar("2026-11-12"), c: 100}}, SAT);
  const r = E.radarRow("AAA", q, basesFor(bars, "2026-11-14"), {now: SAT});
  near(r.rvol, 4); assert.equal(r.stale, false);
});

test("a ticker with no trade yet today is marked, not ranked", () => {
  const s = {dailyBar: {t: bar(PREV), o: 99, h: 101, l: 98, c: 100, v: 1.2e6, vw: 99.8}, prevDailyBar: {t: bar("2026-11-06"), c: 97}};
  const r = E.radarRow("AAA", E.radarSnap(s, OPEN), basesFor(flatBars(DAY), DAY), {now: OPEN});
  assert.equal(r.stale, true); assert.equal(r.rvol, null); assert.equal(r.move, null); assert.equal(E.radarScore(r, "inplay", "open"), null);
  assert.deepEqual(E.radarTags(r, {ph: "open", today: DAY}).map(t => t.k), ["quiet"]);
});

test("the state of a gap: holding, fading, filled, in both directions", () => {
  assert.equal(E.radarGap(104, 100, 106, 2).state, "holding");   // extended
  assert.equal(E.radarGap(104, 100, 103, 2).state, "holding");   // a quarter given back
  assert.equal(E.radarGap(104, 100, 102, 2).state, "fading");
  assert.equal(E.radarGap(104, 100, 100, 2).state, "filled");
  assert.equal(E.radarGap(104, 100, 98, 2).state, "filled");
  const d = E.radarGap(96, 100, 95, 2); assert.equal(d.dir, -1); assert.equal(d.state, "holding");
  assert.equal(E.radarGap(96, 100, 98, 2).state, "fading"); assert.equal(E.radarGap(96, 100, 100.5, 2).state, "filled");
  near(E.radarGap(104, 100, 102, 2).fill, 0.5);
  // how big a gap must be: half the average daily range, never under 0.5%, 2% when the range is unknown
  assert.equal(E.radarGap(100.8, 100, 101, 2), null);            // 0.8% against a 1% bar
  assert.ok(E.radarGap(101.1, 100, 101, 2));
  assert.equal(E.radarGap(102.5, 100, 103, 6), null);            // a wild ticker needs 3%
  assert.ok(E.radarGap(100.6, 100, 100.7, 0.4));                 // a calm one counts from 0.5%
  assert.equal(E.radarGap(100.4, 100, 100.7, 0.4), null);
  assert.equal(E.radarGap(101.5, 100, 102, null), null); assert.ok(E.radarGap(102.5, 100, 102, null));
  assert.equal(E.radarGap(0, 100, 102, 2), null); assert.equal(E.radarGap(104, null, 102, 2), null);
});

test("the tags a trader reads: volume, gap, highs and lows, range, VWAP, earnings, news, surge", () => {
  const bases = basesFor(flatBars(DAY), DAY);   // 52-week and 20-day high 101, low 99, ATR 2
  const r = E.radarRow("AAA", E.radarSnap(snapOpen({o: 104, c: 106, h: 106.5, l: 103.8, v: 1081500, vw: 105}), OPEN), bases, {now: OPEN, spy: 0.4});
  const ctx = {ph: "open", today: DAY, time: () => "10:44 AM"};
  const tags = E.radarTags(r, Object.assign({ping: {x: 12.2, t: OPEN - 60e3}, er: {d: DAY, hour: "bmo"}, news: {h: "A made-up headline", mins: 12}}, ctx));
  assert.deepEqual(tags.map(t => t.t), ["Volume surge", "Earnings today", "News", "Unusual volume", "Gap up holding", "New 52-wk high", "Range 3.3× ATR", "Above VWAP"]);
  tags.forEach(t => assert.ok(t.tip && t.tip.length > 20 && t.tone && t.k, "every tag explains itself: " + t.t));
  const tip = k => tags.find(t => t.k === k).tip;
  assert.match(tip("vol"), /Trading 4\.2× its usual volume for this time of day/);
  assert.match(tip("gap"), /Opened 4\.0% above the previous close and has kept the gap/);
  assert.match(tip("hi"), /\$106\.50 passed its highest price of the past 52 weeks \(\$101\.00\)/);
  assert.match(tip("vwap"), /1\.0% above today's volume-weighted average price of \$105\.00/);
  assert.match(tip("surge"), /at 10:44 AM: about 12 times its usual volume for one minute/);
  assert.match(tip("news"), /A made-up headline.*12 min ago/);
  near(r.rs, 5.6, 1e-9); near(r.rng, (106.5 - 100) / r.atr);
  // extreme volume from 5 times; a fading gap; a new low; below VWAP
  const f = E.radarRow("BBB", E.radarSnap(snapOpen({o: 105, c: 102, h: 105.3, l: 98.5, v: 6 * 257500, vw: 103.5}), OPEN), bases, {now: OPEN});
  const ft = E.radarTags(f, ctx).map(t => t.t);
  assert.deepEqual(ft, ["Extreme volume", "Gap up fading", "New 52-wk high", "New 52-wk low", "Range 3.4× ATR", "Below VWAP"]);
  assert.match(E.radarTags(f, ctx).find(t => t.k === "gap").tip, /given back about 60% of the gap/);
  // a short history can show a 20-day high but never claims a 52-week one
  const young = E.radarRow("CCC", E.radarSnap(snapOpen({h: 101.5}), OPEN), basesFor(flatBars(DAY, {n: 60}), DAY), {now: OPEN});
  assert.equal(young.hi52, false); assert.equal(young.hi20, true);
  assert.ok(E.radarTags(young, ctx).some(t => t.t === "New 20-day high"));
  // a normal, quiet ticker carries no badge worth a second look
  const q = E.radarRow("DDD", E.radarSnap(snapOpen({c: 100.1, vw: 100.05, h: 100.6, l: 99.6}), OPEN), bases, {now: OPEN});
  assert.deepEqual(E.radarTags(q, ctx), []);
  // earnings: tonight, and the morning after
  assert.equal(E.radarTags(q, Object.assign({er: {d: DAY, hour: "amc"}}, ctx))[0].t, "Earnings after close");
  const jr = E.radarTags(q, Object.assign({er: {d: PREV, hour: "amc", prev: true}}, ctx))[0];
  assert.equal(jr.t, "Just reported"); assert.match(jr.tip, /after the close on 11\/9/);
  assert.deepEqual(E.radarTags(q, Object.assign({er: {d: PREV, hour: "bmo", prev: true}}, ctx)), []);
});

test("pre-market: ranked by the move since the last close, tagged as gapping, with yesterday's volume as context", () => {
  const bars = flatBars(DAY); bars[0].v = 3e6;             // yesterday traded three times its average
  const mk = p => ({dailyBar: {t: bar(PREV), o: 100, h: 101, l: 99, c: 100, v: 3e6, vw: 100}, prevDailyBar: {t: bar("2026-11-06"), c: 100}, latestTrade: p ? {t: new Date(PRE - 5000).toISOString(), p} : null});
  const qs = {AAA: E.radarSnap(mk(104), PRE), BBB: E.radarSnap(mk(97), PRE), CCC: E.radarSnap(mk(null), PRE), SPY: E.radarSnap(mk(100.5), PRE)};
  const b = basesFor(bars, DAY), R = E.radarRows(qs, {AAA: b, BBB: b, CCC: b, SPY: b}, {now: PRE});
  assert.equal(R.ph.ph, "pre"); near(R.spy, 0.5);
  near(R.rows.AAA.move, 4); near(R.rows.AAA.rs, 3.5); near(R.rows.AAA.rvol, 3); assert.equal(R.rows.CCC.move, null);
  const sc = Object.values(R.rows).map(r => ({sym: r.sym, score: E.radarScore(r, "inplay", "pre")}));
  assert.deepEqual(E.radarRank(null, sc), ["AAA", "BBB", "SPY"]);   // CCC has no pre-market trade, so it is not ranked
  const t = E.radarTags(R.rows.AAA, {ph: "pre", today: DAY}).map(x => x.t);
  assert.deepEqual(t, ["Heavy volume last session", "Gapping up"]);
  assert.deepEqual(E.radarTags(R.rows.BBB, {ph: "pre", today: DAY}).map(x => x.t), ["Heavy volume last session", "Gapping down"]);
  assert.ok(!E.radarTags(R.rows.SPY, {ph: "pre", today: DAY}).some(x => x.k === "gap"), "half a percent is under this ticker's bar for a gap");
  // yesterday's pre-market trade is not today's
  const old = mk(104); old.latestTrade.t = new Date(PRE - 864e5).toISOString();
  assert.equal(E.radarRow("AAA", E.radarSnap(old, PRE), b, {now: PRE}).ext, null);
});

test("leaders and laggards are measured against SPY", () => {
  const b = basesFor(flatBars(DAY), DAY), qs = {SPY: E.radarSnap(snapOpen({c: 100.4}), OPEN), AAA: E.radarSnap(snapOpen({c: 103}), OPEN), BBB: E.radarSnap(snapOpen({c: 98}), OPEN)};
  const R = E.radarRows(qs, {SPY: b, AAA: b, BBB: b}, {now: OPEN});
  near(R.spy, 0.4); near(R.rows.AAA.rs, 2.6); near(R.rows.BBB.rs, -2.4); near(R.rows.SPY.rs, 0);
  assert.equal(E.radarScore(R.rows.BBB, "rs", "open"), R.rows.BBB.rs);
  assert.equal(E.radarRows({AAA: qs.AAA}, {AAA: b}, {now: OPEN}).rows.AAA.rs, null);   // no SPY, nothing to compare against
});

test("the filters: a price floor and a dollar-volume floor", () => {
  const r = {last: 12, dv: 3e6};
  assert.equal(E.radarPass(r, {}), true); assert.equal(E.radarPass(r, null), true);
  assert.equal(E.radarPass(r, {minPx: 10}), true); assert.equal(E.radarPass(r, {minPx: 20}), false);
  assert.equal(E.radarPass(r, {minDv: 1e6}), true); assert.equal(E.radarPass(r, {minDv: 5e6}), false);
  assert.equal(E.radarPass(null, {}), false);
});

test("the ranking is calm: near-ties keep their places, real changes move, newcomers slot in", () => {
  const S = o => Object.entries(o).map(([sym, score]) => ({sym, score}));
  assert.deepEqual(E.radarRank(null, S({B: 2, A: 4.2, C: 2.6})), ["A", "C", "B"]);
  assert.deepEqual(E.radarRank([], S({B: 2, A: 2, C: 2})), ["A", "B", "C"]);            // ties: alphabetical, always the same
  const prev = ["A", "C", "B"];
  assert.deepEqual(E.radarRank(prev, S({A: 4.2, C: 2.6, B: 2.7})), prev);                 // B is ahead by under 10%: no swap
  assert.deepEqual(E.radarRank(prev, S({A: 4.2, C: 2.6, B: 2.86})), prev);                // exactly 10%: still no swap
  assert.deepEqual(E.radarRank(prev, S({A: 4.2, C: 2.6, B: 3.5})), ["A", "B", "C"]);      // a real change moves it
  assert.deepEqual(E.radarRank(prev, S({A: 4.2, C: 2.6, B: 9})), ["B", "A", "C"]);
  assert.deepEqual(E.radarRank(prev, S({A: 4.2, C: 2.6, B: 2, D: 3})), ["A", "D", "C", "B"]);   // a newcomer goes where its score puts it
  assert.deepEqual(E.radarRank(prev, S({A: 4.2, B: 2})), ["A", "B"]);                     // one that dropped out is gone
  assert.deepEqual(E.radarRank(prev, S({A: 4.2, C: null, B: 2, D: NaN})), ["A", "B"]);    // no score, no rank
  assert.deepEqual(E.radarRank(["A", "B"], S({A: -2, B: -1.9}), 0.1), ["A", "B"]);        // negative scores (laggards) work too
  assert.deepEqual(E.radarRank(["A", "B"], S({A: -2, B: -1})), ["B", "A"]);
});

test("ranking properties: same tickers out as in, no previous order means a plain sort, and it settles", () => {
  const arb = fc.uniqueArray(fc.record({sym: fc.stringMatching(/^[A-Z]{1,4}$/), score: fc.double({min: 0, max: 50, noNaN: true})}), {selector: x => x.sym, maxLength: 30});
  fc.assert(fc.property(arb, arb, (a, b) => {
    const first = E.radarRank(null, a);
    assert.deepEqual(first, a.slice().sort((x, y) => y.score - x.score || (x.sym < y.sym ? -1 : 1)).map(x => x.sym));
    const next = E.radarRank(first, b);
    assert.deepEqual(next.slice().sort(), b.map(x => x.sym).sort());
    assert.deepEqual(E.radarRank(next, b), E.radarRank(E.radarRank(next, b), b));   // the same scores again change nothing more
  }));
});

test("the order never puts a ticker under one it beats by a wide margin", () => {
  const arb = fc.uniqueArray(fc.record({sym: fc.stringMatching(/^[A-Z]{1,3}$/), score: fc.double({min: 0.1, max: 20, noNaN: true})}), {selector: x => x.sym, minLength: 2, maxLength: 25});
  fc.assert(fc.property(arb, fc.array(fc.double({min: 0.5, max: 2, noNaN: true}), {minLength: 25, maxLength: 25}), (a, k) => {
    const prev = E.radarRank(null, a), b = a.map((x, i) => ({sym: x.sym, score: x.score * k[i]})), sc = Object.fromEntries(b.map(x => [x.sym, x.score]));
    const out = E.radarRank(prev, b);
    for (let i = 1; i < out.length; i++) assert.ok(sc[out[i]] <= sc[out[i - 1]] * 1.1 + 1e-9, "a neighbour is never beaten by more than 10%");
  }));
});

test("a volume surge: one minute far above its usual pace, in session, recent, and big enough to matter", () => {
  const base = basesFor(flatBars(DAY), DAY)[0];             // 1,000,000 shares on a normal day: about 2,500 a minute at 10:44
  const q = (v, o = {}) => E.radarSnap(snapOpen({mb: {t: new Date(o.t ?? OPEN - 60e3).toISOString(), o: 100, h: 100, l: 100, c: o.c ?? 100, v}}), OPEN);
  near(E.radarShock(q(30000), base, OPEN).x, 12, 1e-6);
  assert.equal(E.radarShock(q(12000), base, OPEN), null);                       // 4.8 times: under the bar
  assert.ok(E.radarShock(q(12600), base, OPEN));                                // 5.04 times
  assert.equal(E.radarShock(q(30000, {t: OPEN - 4 * 60e3}), base, OPEN), null); // an old bar
  assert.equal(E.radarShock(q(30000, {t: T("2026-11-10T14:32:00Z")}), base, T("2026-11-10T14:33:00Z")), null);   // the first five minutes are always a burst
  assert.equal(E.radarShock(q(30000, {t: T("2026-11-10T21:05:00Z")}), base, T("2026-11-10T21:06:00Z")), null);   // after the close
  assert.equal(E.radarShock(q(30000, {c: 1}), base, OPEN), null);               // $30,000 in the minute: too small to matter
  assert.equal(E.radarShock(q(30000), Object.assign({}, base, {av: 15000}), OPEN), null);   // too thin to judge
  assert.equal(E.radarShock(q(0), base, OPEN), null); assert.equal(E.radarShock(null, base, OPEN), null); assert.equal(E.radarShock(q(30000), null, OPEN), null);
});

test("the scope's scales: round steps, a log volume axis, off-scale dots pinned to the edge", () => {
  assert.equal(E.radarCap([]), 3); assert.equal(E.radarCap([0.2, -0.5, 1.1]), 2); assert.equal(E.radarCap([1, -2, 3.5, 0.5, 1, 1, 1, 1, 1, 1]), 4);
  assert.equal(E.radarCap([90, 80, 70]), 40); assert.equal(E.radarCap([null, NaN, 5]), 6);
  assert.equal(E.radarCap([0.2, -0.5, 1.1], [6, -4.5]), 8);   // an in-play ticker is never pushed to the edge
  assert.equal(E.radarCap([0.2, -0.5, 1.1], [null, 1.95]), 3); assert.equal(E.radarCap([0.2, -0.5, 1.1], []), 2);
  assert.equal(E.radarTop([]), 4); assert.equal(E.radarTop([0.8, 4.2]), 8); assert.equal(E.radarTop([20]), 32); assert.equal(E.radarTop([200]), 32);
  near(E.radarXY(0, 1, 4, 8).x, 0.5); near(E.radarXY(2, 1, 4, 8).x, 0.75); near(E.radarXY(-4, 1, 4, 8).x, 0);
  near(E.radarXY(0, 0.25, 4, 8).y, 0); near(E.radarXY(0, 8, 4, 8).y, 1); near(E.radarXY(0, 2, 4, 16).y, 0.5);   // 2 is halfway from 0.25 to 16 on a log axis
  const off = E.radarXY(9, 40, 4, 8); assert.deepEqual([off.x, off.y, off.off], [1, 1, true]);
  assert.equal(E.radarXY(1, 1, 4, 8).off, false); assert.equal(E.radarXY(0, 0, 4, 8).y, 0);
  assert.equal(E.radarXY(null, 1, 4, 8), null); assert.equal(E.radarXY(1, null, 4, 8), null);
});

test("nothing in the radar's words suggests an order or a size", () => {
  const b = basesFor(flatBars(DAY), DAY), all = [];
  [[104, 106], [104, 102], [104, 99], [96, 95], [96, 98], [96, 101]].forEach(([o, c]) => {
    const r = E.radarRow("AAA", E.radarSnap(snapOpen({o, c, h: Math.max(o, c) + 0.5, l: Math.min(o, c) - 3, v: 2e6, vw: 100}), OPEN), b, {now: OPEN});
    E.radarTags(r, {ph: "open", today: DAY, ping: {x: 9, t: OPEN}, er: {d: DAY, hour: ""}, news: {h: "x", mins: 0}}).forEach(t => all.push(t.t + " " + t.tip)); });
  assert.ok(all.length > 20);
  assert.ok(!/\b(buy|sell|short|entry|stop|target|position size|shares to)\b/i.test(all.join(" ")), "information only");
});
