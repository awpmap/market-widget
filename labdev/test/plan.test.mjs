import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const E = createRequire(import.meta.url)("../../lab/engine.js");
// plan.js engine tests (6.3): the calendar of events and the key-level math. Tickers and prices are made up.
const at = (date, h, m = 0) => E.etMs(date, h * 60 + m);

test("the official-date table: valid dates, sorted, on trading days, in the future window, no duplicates", () => {
  for (const [k, rows] of Object.entries(E.PLAN_DATES)) {
    assert.ok(E.PLAN_KINDS[k], k + " has a kind");
    const dates = rows.map(r => r[0]);
    assert.deepEqual([...dates].sort(), dates, k + " sorted");
    assert.equal(new Set(dates).size, dates.length, k + " has no duplicate dates");
    for (const d of dates) {
      assert.match(d, /^\d{4}-\d{2}-\d{2}$/, d);
      assert.equal(E.addDays(d, 0), d, d + " is a real calendar date");
      assert.ok(d >= E.PLAN_CHECKED, `${k} ${d} is not before the day the pages were read (${E.PLAN_CHECKED})`);
      assert.ok(E.isTradingDay(d), `${k} ${d} is a trading day (weekday, no market holiday)`);
    }
  }
});
test("weekday rules: the FOMC decides on a Wednesday after a Tuesday start, the data comes out on set weekdays", () => {
  for (const [d] of E.PLAN_DATES.fomc) assert.equal(E.weekday(d), 3, d + " is a Wednesday");
  for (const [d] of E.PLAN_DATES.fomcs) assert.equal(E.weekday(d), 2, d + " (the strategy meeting's first day) is a Tuesday");
  for (const k of ["cpi", "ppi", "jobs", "gdp", "pce", "retail"]) for (const [d] of E.PLAN_DATES[k]) assert.ok(E.weekday(d) >= 1 && E.weekday(d) <= 5, k + " " + d);
  for (const [d] of E.PLAN_DATES.jobs) assert.ok(E.weekday(d) === 5 || E.isTradingDay(d), "jobs " + d);
  assert.equal(E.PLAN_DATES.gdp.length, E.PLAN_DATES.pce.length);
  assert.deepEqual(E.PLAN_DATES.gdp.map(r => r[0]), E.PLAN_DATES.pce.map(r => r[0]), "GDP and PCE come out the same days");
});
test("the table covers what the official pages cover (and the Dec 2026 meeting is in it)", () => {
  assert.deepEqual(E.PLAN_DATES.fomc[0].slice(0, 2), ["2026-12-09", "Dec 8-9 meeting"]);
  assert.ok(E.PLAN_DATES.fomc[0][2].includes("s"), "Dec 2026 meeting has new projections");
  assert.equal(E.PLAN_DATES.cpi.length, 13); assert.equal(E.PLAN_DATES.jobs.length, 13); assert.equal(E.PLAN_DATES.ppi.length, 13);
  assert.equal(E.PLAN_DATES.retail.length, 13); assert.equal(E.PLAN_DATES.gdp.length, 14);
  // the Fed's revised 2027 list: no December meeting, a strategy meeting in October (no decision) and a decision on Nov 17
  const f27 = E.PLAN_DATES.fomc.map(r => r[0]).filter(d => d.startsWith("2027"));
  assert.deepEqual(f27, ["2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-11-17"]);
  assert.deepEqual(E.PLAN_DATES.fomcs.map(r => r[0]), ["2027-10-26"]);
});
test("event times: 8:30 AM for data, 2:00 PM for the Fed, shown as instants (daylight saving handled)", () => {
  const ev = E.PLAN_EVENTS;
  const cpi = ev.find(e => e.k === "cpi" && e.d === "2026-12-10"), fomc = ev.find(e => e.k === "fomc" && e.d === "2026-12-09"), cpiJul = ev.find(e => e.k === "cpi" && e.d === "2027-07-14");
  assert.equal(new Date(cpi.t).toISOString(), "2026-12-10T13:30:00.000Z");
  assert.equal(new Date(fomc.t).toISOString(), "2026-12-09T19:00:00.000Z");
  assert.equal(new Date(cpiJul.t).toISOString(), "2027-07-14T12:30:00.000Z");
  assert.ok(ev.some(e => e.k === "fomc1" && e.d === "2026-12-08"), "day 1 of the December meeting is an event too");
});
test("third Friday and options expiration, with holiday adjustment", () => {
  assert.equal(E.thirdFriday(2026, 12), "2026-12-18");
  assert.equal(E.thirdFriday(2026, 11), "2026-11-20");
  assert.equal(E.thirdFriday(2027, 1), "2027-01-15");
  assert.equal(E.thirdFriday(2027, 2), "2027-02-19");
  assert.equal(E.thirdFriday(2026, 5), "2026-05-15");
  assert.equal(E.thirdFriday(2027, 10), "2027-10-15");
  for (let y = 2026; y <= 2028; y++) for (let m = 1; m <= 12; m++) { const d = E.thirdFriday(y, m); assert.equal(E.weekday(d), 5, d); assert.ok(+d.slice(8) >= 15 && +d.slice(8) <= 21, d); }
  // Juneteenth is the third Friday of June in 2026 and 2027: options expire the Thursday before
  assert.equal(E.thirdFriday(2026, 6), "2026-06-19"); assert.equal(E.optionsExpiry(2026, 6), "2026-06-18");
  assert.equal(E.thirdFriday(2027, 6), "2027-06-18"); assert.equal(E.optionsExpiry(2027, 6), "2027-06-17");
  // Good Friday is the third Friday of nothing here, but it must be handled when it falls there: 2026-04-03 is the first Friday
  assert.equal(E.optionsExpiry(2026, 4), "2026-04-17");
  for (let y = 2026; y <= 2028; y++) for (let m = 1; m <= 12; m++) assert.ok(E.isTradingDay(E.optionsExpiry(y, m)), `${y}-${m}`);
  assert.ok(E.isQuadMonth(3) && E.isQuadMonth(6) && E.isQuadMonth(9) && E.isQuadMonth(12) && !E.isQuadMonth(11));
});
test("planEvents: window, sort order, quad witching in December, holidays and early closes", () => {
  const now = at("2026-11-24", 10);
  const L = E.planEvents(now, {days: 30});
  for (let i = 1; i < L.length; i++) assert.ok(L[i - 1].t <= L[i].t, "sorted by time");
  const names = L.map(e => e.k + ":" + e.d);
  for (const want of ["gdp:2026-11-25", "pce:2026-11-25", "holiday:2026-11-26", "early:2026-11-27", "jobs:2026-12-04", "night:2026-12-06", "fomc1:2026-12-08", "fomc:2026-12-09", "cpi:2026-12-10", "ppi:2026-12-15", "retail:2026-12-16", "quad:2026-12-18"])
    assert.ok(names.includes(want), want + " in " + names.join(" "));
  assert.ok(!names.includes("opex:2026-11-20"), "an expiration already past is not listed");
  assert.ok(L.every(e => e.d >= "2026-11-24" && e.d <= "2026-12-24"), "everything is inside the window");
  assert.ok(!E.planEvents(now, {days: 21}).some(e => e.d > "2026-12-15"), "21 days from 11-24 ends 12-15");
  const g = L.find(e => e.k === "gdp");
  assert.equal(g.ref, "Q3, second estimate"); assert.equal(g.timed, true);
  const th = L.find(e => e.k === "holiday"); assert.equal(th.ref, "Thanksgiving"); assert.equal(th.big, 0);
  // today flags
  const today = E.planEvents(at("2026-12-09", 15), {days: 1});
  const f = today.find(e => e.k === "fomc"); assert.ok(f.today && f.past, "the 2 PM decision is out by 3 PM");
  assert.ok(E.planEvents(at("2026-12-09", 9), {days: 1}).find(e => e.k === "fomc").left > 0);
  // November's monthly expiration shows up on its day
  assert.ok(E.planEvents(at("2026-11-16", 9), {days: 7}).some(e => e.k === "opex" && e.d === "2026-11-20"));
  assert.ok(E.planEvents(at("2026-06-10", 9), {days: 14}).some(e => e.k === "quad" && e.d === "2026-06-18"), "June 2026 witching moves to Thursday");
});
test("earnings are grouped by day and timing, your tickers first, and only inside the window", () => {
  const now = at("2026-11-24", 10);
  const earn = [{sym:"CCC", d:"2026-11-25", hour:"amc", mine:false}, {sym:"AAA", d:"2026-11-25", hour:"amc", mine:true}, {sym:"BBB", d:"2026-11-25", hour:"bmo", mine:false},
    {sym:"DDD", d:"2026-11-26", hour:"", mine:false}, {sym:"EEE", d:"2027-01-05", hour:"amc", mine:true}, {sym:"AAA", d:"2026-11-25", hour:"amc", mine:true}];
  const L = E.planEvents(now, {days: 14, earn}).filter(e => e.k === "earn");
  assert.equal(L.length, 3);
  const amc = L.find(e => e.hour === "amc"); assert.deepEqual(amc.syms.map(s => s.sym), ["AAA", "CCC"]); assert.equal(amc.mine, true); assert.equal(amc.big, 2);
  const bmo = L.find(e => e.hour === "bmo"); assert.equal(bmo.ref, "before the open"); assert.equal(bmo.big, 1);
  assert.ok(bmo.t < amc.t, "before-open sorts ahead of after-close on the same day");
  assert.equal(L.find(e => e.hour === "").ref, "time not given");
});
test("next-up cards: big events only, soonest first, a just-released one stays for 90 minutes", () => {
  const now = at("2026-11-24", 10), L = E.planEvents(now, {days: 30});
  const n = E.planNextUp(L, now, 4);
  assert.equal(n.length, 4); assert.ok(n.every(e => e.big >= 2 && !e.past));
  assert.equal(n[0].k === "gdp" || n[0].k === "pce", true);
  const later = at("2026-12-10", 9, 15), L2 = E.planEvents(later, {days: 7}), n2 = E.planNextUp(L2, later, 3);
  assert.equal(n2[0].k, "cpi", "CPI came out 45 minutes ago and is still the first card");
  const much = at("2026-12-10", 11), n3 = E.planNextUp(E.planEvents(much, {days: 7}), much, 3);
  assert.notEqual(n3[0].k, "cpi");
});
test("countdown text", () => {
  assert.equal(E.planLeft(0), "now"); assert.equal(E.planLeft(-5), "now");
  assert.equal(E.planLeft(30e3), "1 min"); assert.equal(E.planLeft(45 * 60e3), "45 min");
  assert.equal(E.planLeft(2 * 3600e3 + 5 * 60e3), "2 h 05 min");
  assert.equal(E.planLeft(27 * 3600e3), "1 d 3 h"); assert.equal(E.planLeft(14 * 86400e3 + 8 * 3600e3), "14 d 8 h");
  assert.equal(E.planDayWord("2026-12-09", "2026-12-09"), "today"); assert.equal(E.planDayWord("2026-12-10", "2026-12-09"), "tomorrow"); assert.equal(E.planDayWord("2026-12-14", "2026-12-09"), "in 5 days");
});
test("coverage: a schedule that ends inside the window is reported, and FOMC minutes are not invented", () => {
  const c = E.planCoverage(at("2026-11-24", 10), 14);
  assert.deepEqual(c.map(x => x.k), ["fomcmin"]);
  assert.equal(c[0].through, null);
  const far = E.planCoverage(at("2027-12-01", 10), 14).map(x => x.k);
  assert.deepEqual(far.sort(), ["cpi", "fomcmin", "jobs"], "jobs (last Dec 3) and CPI (last Dec 10) end before Dec 15; PPI (Dec 15) and the rest reach it");
});

/* ---------- levels ---------- */
const bar = (d, o, h, l, c) => [d, o, h, l, c, 1e6];
function series(n, endDate, base = 100) {   // newest first, a slow made-up drift with a known high and low
  const out = []; let d = endDate;
  for (let i = 0; i < n; i++) { const c = base + Math.sin(i / 7) * 5 - i * 0.01; out.push(bar(d, c, c + 1, c - 1, c)); d = E.prevTradingDay(d); }
  return out;
}
test("prior day: yesterday until 15 minutes after the close, today's own after that", () => {
  assert.equal(E.planPriorDay(at("2026-11-24", 10)), "2026-11-23");
  assert.equal(E.planPriorDay(at("2026-11-24", 16, 10)), "2026-11-23");
  assert.equal(E.planPriorDay(at("2026-11-24", 16, 15)), "2026-11-24");
  assert.equal(E.planPriorDay(at("2026-11-28", 12)), "2026-11-27", "Saturday: Friday's early-close session");
  assert.equal(E.planPriorDay(at("2026-11-27", 13, 20)), "2026-11-27", "after the early close");
  assert.equal(E.planPriorDay(at("2026-11-27", 13, 5)), "2026-11-25", "Thanksgiving week: skips the holiday");
  assert.equal(E.planPriorDay(at("2026-11-30", 5)), "2026-11-27");
  assert.equal(E.planSessionDay(at("2026-11-24", 3)), null); assert.equal(E.planSessionDay(at("2026-11-24", 4)), "2026-11-24");
  assert.equal(E.planSessionDay(at("2026-11-26", 10)), null, "holiday"); assert.equal(E.planSessionDay(at("2026-11-28", 10)), null, "weekend");
});
test("daily levels: prior-day high/low/close, 20-day and 52-week from bars; stale bars never pose as prior-day", () => {
  const bars = series(300, "2026-11-23");
  const o = E.planDaily(bars, "2026-11-23");
  assert.equal(o.fresh, true); assert.equal(o.pdh, bars[0][2]); assert.equal(o.pdl, bars[0][3]); assert.equal(o.pdc, bars[0][4]);
  assert.equal(o.hi20, Math.max(...bars.slice(0, 20).map(b => b[2]))); assert.equal(o.lo20, Math.min(...bars.slice(0, 20).map(b => b[3])));
  assert.ok(o.hi52 >= o.hi20 && o.lo52 <= o.lo20);
  const stale = E.planDaily(bars.slice(1), "2026-11-23");
  assert.equal(stale.fresh, false); assert.equal(stale.pdh, undefined); assert.ok(stale.hi20 > 0);
  const short = E.planDaily(series(30, "2026-11-23"), "2026-11-23"); assert.equal(short.hi52, undefined, "too little history for a 52-week range"); assert.equal(short.hi20 > 0, true);
  assert.equal(E.planDaily([], "2026-11-23"), null); assert.equal(E.planDaily(null, "2026-11-23"), null);
  assert.equal(E.planDaily(series(5, "2026-11-10"), "2026-11-09").asOf, "2026-11-09", "uses the latest bar at or before the prior day");
  const gap = E.planDaily(bars, "2026-11-25"); assert.equal(gap.fresh, false);
});
test("pre-market and opening-range levels: each only when complete, from 5-minute bars, in New York time", () => {
  const D = "2026-11-24", b = (h, m, hi, lo) => ({t: at(D, h, m), h: hi, l: lo});
  const bars = [b(4, 0, 100.4, 99.9), b(7, 30, 101.2, 100.6), b(9, 25, 101.0, 100.5), b(9, 30, 101.8, 100.9), b(9, 35, 102.4, 101.5), b(9, 40, 102.1, 101.2), b(9, 45, 103.0, 102.0), b(3, 0, 120, 80)];
  const pm = E.planIntraday(bars, D, at(D, 9, 31));
  assert.equal(pm.pmh, 101.2); assert.equal(pm.pml, 99.9); assert.equal(pm.pmDone, true); assert.equal(pm.or5Done, false); assert.equal(pm.or5h, undefined);
  const o5 = E.planIntraday(bars, D, at(D, 9, 36)); assert.equal(o5.or5h, 101.8); assert.equal(o5.or5l, 100.9); assert.equal(o5.or15h, undefined);
  const o15 = E.planIntraday(bars, D, at(D, 9, 46)); assert.equal(o15.or15h, 102.4); assert.equal(o15.or15l, 100.9); assert.equal(o15.or15Done, true);
  const live = E.planIntraday(bars, D, at(D, 8, 0)); assert.equal(live.pmDone, false); assert.equal(live.pmh, 101.2);
  assert.equal(E.planIntraday([], D, at(D, 10)).pmh, undefined);
  assert.equal(E.planIntraday(bars, D, at("2026-11-25", 9)).or15h, 102.4, "a later day still reads that day's bars");
});
test("phases and when to fetch: once per phase, the pre-market every 5 minutes, nothing off-hours", () => {
  assert.equal(E.planFetchDue(null, at("2026-11-24", 3)), null);
  assert.equal(E.planFetchDue(null, at("2026-11-28", 10)), null);
  assert.equal(E.planFetchDue(null, at("2026-11-24", 5)), "pre");
  assert.equal(E.planFetchDue({date:"2026-11-24", ph:"pre", at:at("2026-11-24", 5)}, at("2026-11-24", 5, 3)), null);
  assert.equal(E.planFetchDue({date:"2026-11-24", ph:"pre", at:at("2026-11-24", 5)}, at("2026-11-24", 5, 5)), "pre");
  assert.equal(E.planFetchDue({date:"2026-11-24", ph:"pre", at:at("2026-11-24", 9, 28)}, at("2026-11-24", 9, 30)), null, "9:30 is still the pre-market phase");
  assert.equal(E.planFetchDue({date:"2026-11-24", ph:"pre", at:at("2026-11-24", 9, 20)}, at("2026-11-24", 9, 31)), "pm");
  assert.equal(E.planFetchDue({date:"2026-11-24", ph:"pm", at:at("2026-11-24", 9, 31)}, at("2026-11-24", 9, 35)), null);
  assert.equal(E.planFetchDue({date:"2026-11-24", ph:"pm", at:at("2026-11-24", 9, 31)}, at("2026-11-24", 9, 36)), "or5");
  assert.equal(E.planFetchDue({date:"2026-11-24", ph:"or5", at:at("2026-11-24", 9, 36)}, at("2026-11-24", 9, 46)), "or15");
  assert.equal(E.planFetchDue({date:"2026-11-24", ph:"or15", at:at("2026-11-24", 9, 46)}, at("2026-11-24", 15)), null);
  assert.equal(E.planFetchDue(null, at("2026-11-24", 11)), "or15", "opening the page late takes one call that has everything");
  assert.equal(E.planFetchDue({date:"2026-11-23", ph:"or15", at:at("2026-11-23", 10)}, at("2026-11-24", 5)), "pre");
});
test("levels for one ticker: what is complete is shown, the quote's close fills in for a missing prior day", () => {
  const daily = {pdh:105, pdl:99, pdc:102, hi20:110, lo20:95, hi52:130, lo52:80};
  const L = E.planLevels({daily, intra:{pmh:104, pml:101, or5Done:true, or5h:103.5, or5l:102.5, or15Done:false, or15h:104.2, or15l:102}, vwap:102.7, m52:{hi:131, lo:79}});
  assert.equal(L.pdh, 105); assert.equal(L.hi52, 131, "Finnhub's 52-week range wins when it is loaded"); assert.equal(L.or5h, 103.5); assert.equal(L.or15h, undefined); assert.equal(L.vwap, 102.7);
  const L2 = E.planLevels({daily:{hi20:110}, pc:50});
  assert.deepEqual(Object.keys(L2).sort(), ["hi20", "pdc"]); assert.equal(L2.pdc, 50);
  assert.deepEqual(E.planLevels({}), {});
  assert.deepEqual(E.planLevels({daily:{pdh:NaN, pdl:-1, pdc:0}}), {});
});
test("nearest level above and below, distance in dollars and percent, equal levels share a tick", () => {
  const L = {pdh:105, pdl:99, pdc:102, hi20:110, lo20:95, vwap:102.4, or5h:105.0};
  const l = E.planLadder(L, 102.3);
  assert.equal(l.up.v, 102.4); assert.deepEqual(l.up.ks, ["vwap"]); assert.equal(l.dn.v, 102);
  assert.ok(Math.abs(l.up.usd - 0.1) < 1e-9); assert.ok(Math.abs(l.up.pct - (102.4 / 102.3 - 1) * 100) < 1e-9);
  assert.equal(l.ticks.length, 6, "PDH and OR5 high are one tick");
  assert.deepEqual(l.ticks.find(t => t.v === 105).ks, ["pdh", "or5h"]);
  assert.deepEqual(l.near.map(t => t.v), [102.4, 102], "both within 0.5%, nearest first");
  const above = E.planLadder(L, 120); assert.equal(above.up, null); assert.equal(above.dn.v, 110);
  const below = E.planLadder(L, 90); assert.equal(below.dn, null); assert.equal(below.up.v, 95);
  const on = E.planLadder({pdh:100}, 100); assert.equal(on.up, null); assert.equal(on.dn, null);
  assert.equal(E.planLadder({}, 50).ticks.length, 0);
  assert.equal(E.planLadder({pdh:105}, 100, 6).near.length, 1); assert.equal(E.planLadder({pdh:105}, 100, 0.5).near.length, 0);
});
test("break detection: above or below a level, flips only between close-together looks", () => {
  const L = {pdh:105, pdl:99, vwap:102.4};
  assert.deepEqual(E.planSides(L, 106), {pdh:1, pdl:1, vwap:1}); assert.deepEqual(E.planSides(L, 101), {pdh:-1, pdl:1, vwap:-1}); assert.equal(E.planSides({pdh:100}, 100).pdh, 0);
  const t0 = at("2026-11-24", 10), prev = {sides:E.planSides(L, 104.9), at:t0};
  assert.deepEqual(E.planFlips(prev, E.planSides(L, 105.2), t0 + 5000), [{k:"pdh", dir:1, t:t0 + 5000}]);
  assert.deepEqual(E.planFlips(prev, E.planSides(L, 104.95), t0 + 5000), []);
  assert.deepEqual(E.planFlips(prev, E.planSides(L, 98), t0 + 5000).map(f => f.k + f.dir).sort(), ["pdh-1", "pdl-1", "vwap-1"].filter(x => x !== "pdh-1"));
  assert.equal(E.planFlips(prev, E.planSides(L, 105.2), t0 + 20 * 60e3).length, 0, "a look 20 minutes later proves nothing about a crossing");
  assert.equal(E.planFlips(null, E.planSides(L, 105.2), t0).length, 0);
  assert.equal(E.planFlips({sides:{pdh:0}, at:t0}, {pdh:1}, t0 + 1).length, 0, "starting exactly on a level is not a crossing");
  assert.equal(E.planFlipText("pdh", 1), "Broke PDH"); assert.equal(E.planFlipText("pdh", -1), "Back under PDH");
  assert.equal(E.planFlipText("pdl", -1), "Broke PDL"); assert.equal(E.planFlipText("pdl", 1), "Back over PDL");
  assert.equal(E.planFlipText("vwap", -1), "Lost VWAP"); assert.equal(E.planFlipText("vwap", 1), "Reclaimed VWAP");
  assert.equal(E.planFlipText("pdc", -1), "Lost PDC"); assert.equal(E.planFlipText("nope", 1), "");
});
test("row labels: broke PDH, lost VWAP, inside the opening range, near a level, highest-priority first", () => {
  const L = {pdh:105, pdl:99, pdc:102, vwap:104, or15h:106, or15l:103, hi20:110, lo20:95, hi52:130, lo52:80};
  const ctx = {open:true, or5Done:true, or15Done:true, pmDone:true, now:at("2026-11-24", 11), near:0.5};
  const ids = (px, c) => E.planChips(L, px, Object.assign({}, ctx, c)).map(x => x.text);
  assert.ok(ids(105.3).includes("Broke PDH") && ids(105.3).includes("Inside opening range") && ids(105.3).includes("Above VWAP"));
  assert.ok(ids(98).includes("Broke PDL") && ids(98).includes("Broke OR low") && ids(98).includes("Below VWAP"));
  assert.ok(!ids(104.5).includes("Broke PDH") && ids(104.5).includes("Inside opening range"));
  assert.ok(ids(104.8).includes("Near PDH"), "within 0.5% of PDH");
  assert.ok(!ids(100.8).some(t => /^Near/.test(t)), "100.8 is more than 0.5% from every level");
  assert.ok(ids(107).includes("Broke OR high"));
  assert.ok(ids(131).includes("At 52-week high") && !ids(131).includes("Over 20-day high"));
  assert.ok(ids(79).includes("At 52-week low"));
  const flipped = E.planChips(L, 103.9, Object.assign({}, ctx, {flips:[{k:"vwap", dir:-1, t:ctx.now - 2 * 60e3}]}));
  assert.equal(flipped[0].text, "Lost VWAP"); assert.equal(flipped[0].fresh, true); assert.match(flipped[0].tip, /2 min ago/);
  assert.equal(flipped.filter(c => /VWAP/.test(c.text)).length, 1, "a fresh crossing replaces the plain 'Below VWAP'");
  // before the open: no VWAP, no opening range
  const pre = E.planChips({pdh:105, pdl:99, pmh:104, pml:101, vwap:104}, 104.5, {open:false, pmDone:false, now:ctx.now});
  assert.ok(!pre.some(c => /(Above|Below) VWAP|opening/.test(c.text)));
  // all are one sentence with a tip
  for (const c of E.planChips(L, 105.3, ctx)) { assert.ok(c.tip.length > 20 && /\.$/.test(c.tip), c.text); assert.ok(["up", "down", "warn", ""].includes(c.tone)); }
  assert.deepEqual(E.planChips({}, 100, ctx), []); assert.deepEqual(E.planChips(L, 0, ctx), []);
});
test("every level has a short name, a long name and a one-sentence tip", () => {
  for (const k of E.PLAN_LV_ORDER) { const v = E.PLAN_LV[k]; assert.ok(v && v.s && v.n && v.tip && ["hi", "lo", "mid"].includes(v.side), k); assert.ok(/\.$/.test(v.tip) && !/[.?!] [A-Z]/.test(v.tip), k + " is one sentence"); }
  assert.equal(Object.keys(E.PLAN_LV).length, E.PLAN_LV_ORDER.length);
});
test("the trading-day bar: segments are contiguous, and an early close moves power hour", () => {
  const t = E.planTimeline("2026-11-24"); assert.equal(t.close, 960); assert.equal(t.end, 1200);
  assert.deepEqual(t.segs.map(s => s.k), ["pre", "open", "morn", "lunch", "aft", "power", "after"]);
  for (let i = 1; i < t.segs.length; i++) assert.equal(t.segs[i - 1].to, t.segs[i].from);
  assert.equal(t.segs[0].from, 240); assert.equal(t.segs.at(-1).to, 1200); assert.equal(t.segs.find(s => s.k === "power").from, 900);
  const e = E.planTimeline("2026-11-27"); assert.equal(e.close, 780); assert.equal(e.end, 1020);
  for (let i = 1; i < e.segs.length; i++) { assert.equal(e.segs[i - 1].to, e.segs[i].from); assert.ok(e.segs[i].to > e.segs[i].from, e.segs[i].k); }
  assert.equal(e.segs.find(s => s.k === "power").from, 720);
});
test("holiday names", () => {
  assert.equal(E.holidayName("2026-11-26"), "Thanksgiving"); assert.equal(E.holidayName("2026-12-25"), "Christmas"); assert.equal(E.holidayName("2027-12-24"), "Christmas");
  assert.equal(E.holidayName("2026-04-03"), "Good Friday"); assert.equal(E.holidayName("2027-03-26"), "Good Friday"); assert.equal(E.holidayName("2026-06-19"), "Juneteenth");
  assert.equal(E.holidayName("2027-07-05"), "Independence Day"); assert.equal(E.holidayName("2026-01-01"), "New Year's Day"); assert.equal(E.holidayName("2026-01-19"), "Martin Luther King Jr. Day");
  assert.equal(E.holidayName("2026-02-16"), "Presidents Day"); assert.equal(E.holidayName("2026-05-25"), "Memorial Day"); assert.equal(E.holidayName("2026-09-07"), "Labor Day");
});
