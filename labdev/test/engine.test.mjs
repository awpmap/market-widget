// MW Lab engine tests. Run: cd labdev && npm test
import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../../lab/engine.js");

const at = (date, hhmm) => E.etMs(date, +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5));   // New York wall clock -> ms
const Q = (o) => Object.assign({c:100, pc:100, dp:0, h:100, l:100, o:100}, o);

/* ---------------- calendar ---------------- */
test("2028 calendar matches the NYSE release", () => {
  for (const d of ["2028-01-17","2028-02-21","2028-04-14","2028-05-29","2028-06-19","2028-07-04","2028-09-04","2028-11-23","2028-12-25"]) assert.ok(E.HOLIDAYS.has(d), d);
  assert.equal(E.isTradingDay("2028-01-03"), true, "Jan 3 2028 trades (New Year's not observed)");
  assert.equal(E.HOLIDAYS.has("2027-12-31"), false, "Dec 31 2027 is not a holiday");
  assert.equal(E.closeMins("2028-07-03"), 780);
  assert.equal(E.closeMins("2028-11-24"), 780);
  assert.equal(E.closeMins("2028-12-22"), 960);
});
test("holidays are all weekdays and inside the valid range", () => {
  for (const d of E.HOLIDAYS) { const wd = E.weekday(d); assert.ok(wd >= 1 && wd <= 5, d); assert.ok(E.calendarValid(d), d); }
  for (const d of Object.keys(E.EARLY_CLOSE)) assert.ok(E.isTradingDay(d), "early close on a trading day: " + d);
});
test("market clock: open, closed, holiday, early close, weekend", () => {
  assert.equal(E.marketClock(at("2026-11-05", "10:00")).ph, "open");
  assert.equal(E.marketClock(at("2026-11-05", "09:29")).ph, "pre");
  assert.equal(E.marketClock(at("2026-11-05", "16:00")).ph, "after");
  assert.equal(E.marketClock(at("2026-11-05", "20:30")).ph, "closed");
  assert.equal(E.marketClock(at("2028-07-04", "11:00")).label, "Holiday");
  assert.equal(E.marketClock(at("2028-07-03", "13:30")).ph, "after", "1 pm early close on 7/3/2028");
  assert.equal(E.marketClock(at("2026-11-07", "11:00")).label, "Weekend");
  const mc = E.marketClock(at("2026-11-25", "17:00"));
  assert.equal(mc.nextOpenDay, "2026-11-27", "after Thanksgiving eve the next open skips the holiday");
});
test("calendar fails closed after its last day", () => {
  const now = at("2029-01-02", "11:00");
  assert.equal(E.marketClock(now).ph, "unknown");
  const s = E.session(now, null);
  assert.equal(s.s, "unknown");
  assert.equal(E.alertable(Q({t:now/1000, at:now}), now, s), false);
});
test("New York time survives daylight-saving changes", () => {
  // 2026-03-08 and 2026-11-01 are the DST switch days
  for (const d of ["2026-03-06","2026-03-09","2026-10-30","2026-11-02","2027-03-15","2028-11-06"]) {
    const ms = E.etMs(d, 570), p = E.etParts(ms);
    assert.equal(p.date, d); assert.equal(p.mins, 570);
  }
});
test("overnight session stays off unless switched on", () => {
  const n = at("2026-12-09", "23:00");
  assert.equal(E.marketClock(n).ph, "closed");
  assert.equal(E.marketClock(n, {overnight:true}).ph, "overnight");
});
test("live exchange status overrides the table on a surprise closure", () => {
  const now = at("2026-11-05", "11:00");
  assert.equal(E.session(now, {at:now - 60e3, date:"2026-11-05", isOpen:false, holiday:"National day of mourning"}).s, "closed");
  assert.equal(E.session(now, {at:now - 3600e3, date:"2026-11-05", isOpen:false, holiday:"x"}).s, "open", "an old status is ignored");
});

/* ---------------- freshness and bad prints ---------------- */
test("freshness uses the trade time, not the fetch time", () => {
  const now = at("2026-11-05", "11:00"), ses = E.session(now, null);
  assert.equal(E.freshness(Q({t:(now - 5*60e3)/1000, at:now}), now, ses).ok, true);
  const old = E.freshness(Q({t:(now - 45*60e3)/1000, at:now}), now, ses);
  assert.equal(old.ok, false); assert.match(old.why, /45 min old/);
  assert.equal(E.freshness(Q({t:(now - 24*3600e3)/1000, at:now}), now, ses).ok, false, "yesterday's trade");
  assert.equal(E.freshness(Q({at:now}), now, ses).ok, false, "no trade time");
  assert.equal(E.freshness(Q({t:now/1000, at:now - 20*60e3}), now, ses).ok, false, "fetched too long ago");
  const closed = E.session(at("2026-11-05", "17:00"), null);
  assert.equal(E.freshness(Q({t:now/1000, at:now}), now, closed).ok, false);
});
test("screenQuote: ordinary moves pass, scaled to volatility", () => {
  fc.assert(fc.property(fc.double({min:1, max:5000, noNaN:true}), fc.double({min:-0.03, max:0.03, noNaN:true}), (p, r) => {
    const c = p * (1 + r), q = {c, pc:p, dp:(c/p - 1)*100};
    return E.screenQuote(q, {c:p}, 2, false).action === "accept";
  }));
});
test("screenQuote: a big jump is held once, then accepted when confirmed", () => {
  const prev = {c:100}, q = {c:70, pc:100, dp:-30};
  const a = E.screenQuote(q, prev, 2, false);
  assert.equal(a.action, "hold");
  assert.equal(E.screenQuote({c:70.5, pc:100, dp:-29.5}, prev, 2, false, a.hold).action, "accept");
  assert.equal(E.screenQuote({c:99, pc:100, dp:-1}, prev, 2, false, a.hold).action, "accept", "back to normal is accepted too");
});
test("screenQuote: broad ETFs use a tighter limit than single stocks", () => {
  assert.equal(E.screenQuote({c:94, pc:100, dp:-6}, {c:100}, 1, true).action, "hold");
  assert.equal(E.screenQuote({c:94, pc:100, dp:-6}, {c:100}, 2, false).action, "accept");
});
test("screenQuote: inconsistent quotes are rejected", () => {
  assert.equal(E.screenQuote({c:90, pc:100, dp:-2}, null, 2, false).action, "reject");
  assert.equal(E.screenQuote({c:0, pc:100, dp:-100}, null, 2, false).action, "reject");
  assert.equal(E.screenQuote({c:100, pc:100, dp:0, h:90, l:95}, null, 2, false).action, "reject");
});
test("levelSanity flags levels that look like a missed split", () => {
  assert.deepEqual(E.levelSanity([600, 140, 20], 150), [600, 20]);
  assert.deepEqual(E.levelSanity([140, 130], 150), []);
});

/* ---------------- statistics ---------------- */
const randWalk = (n, sigma, seed = 7, start = 100) => {   // closes newest first
  let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const out = [start];
  for (let i = 1; i < n; i++) { const z = Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); out.push(out[i-1] * (1 + sigma * z)); }
  return out.reverse();
};
test("volatility estimates recover a known σ", () => {
  const v = E.volEstimate(randWalk(600, 0.02));
  assert.ok(Math.abs(v.sd60 - 2) < 0.6, "sd60 " + v.sd60);
  assert.ok(Math.abs(v.ewma - 2) < 0.6, "ewma " + v.ewma);
  assert.ok(Math.abs(v.mad - 2) < 0.4, "mad " + v.mad);
  assert.ok(v.q02 < -3, "2% tail " + v.q02);
});
test("Wilder ATR on a flat series equals the range", () => {
  const bars = Array.from({length:30}, (_, i) => ["2026-01-" + String(30 - i).padStart(2, "0"), 100, 101, 99, 100, 1e6]);
  assert.ok(Math.abs(E.atrWilder(bars) - 2) < 1e-9);
});
const mkBars = (closes, startDate = "2021-01-04") => {   // closes newest first -> bars newest first with dates
  const n = closes.length, dates = []; let d = startDate;
  for (let i = 0; i < n; i++) { dates.push(d); d = E.nextTradingDay(d); }
  dates.reverse();
  return closes.map((c, i) => { const p = closes[i+1] || c; return [dates[i], p, Math.max(p, c) * 1.006, Math.min(p, c) * 0.994, c, 1e6]; });
};
test("auto levels keep their floors: 3% under the close, 5% between levels", () => {
  fc.assert(fc.property(fc.integer({min:1, max:9999}), fc.double({min:0.005, max:0.06, noNaN:true}), (seed, sig) => {
    const st = E.dailyStats(mkBars(randWalk(120, sig, seed)));
    if (!st) return true;
    const al = E.autoLevels(st);
    let ref = st.c;
    for (let k = 0; k < al.length; k++) {
      const cap = ref * (1 - (k === 0 ? 0.03 : 0.05));
      if (al[k].p > cap + (cap < 100 ? 0.006 : 0.6)) return false;
      ref = al[k].p;
    }
    return al.length === 3;
  }), {numRuns:200});
});

/* ---------------- rules ---------------- */
const baseCtx = (q, extra) => Object.assign({sym:"ABC", q, now:at("2026-11-05", "11:00"), vol:2, hi52:null, benchSym:"SMH", benchDp:0, er:null, ticks:[], vwap:null, levels:[], alertOk:true}, extra || {});
test("red day, unusual drop and off-today's-high rules", () => {
  const w = {sym:"ABC", dayDrop:3, sigDrop:2, hiDrop:4};
  const r = E.evaluate(w, baseCtx(Q({c:95, pc:100, dp:-5, h:100})), {});
  const kinds = r.alerts.map(a => a.kind).sort();
  assert.deepEqual(kinds, ["hd", "red", "sig"]);
  assert.equal(E.evaluate(w, baseCtx(Q({c:99, pc:100, dp:-1, h:100})), {}).alerts.length, 0);
});
test("rules are silent when the quote can't alert", () => {
  const w = {sym:"ABC", dayDrop:3};
  assert.equal(E.evaluate(w, baseCtx(Q({c:90, dp:-10}), {alertOk:false}), {}).alerts.length, 0);
  assert.equal(E.evaluate(Object.assign({on:false}, w), baseCtx(Q({c:90, dp:-10})), {}).alerts.length, 0);
});
test("buy levels: one alert names the deepest level reached", () => {
  const w = {sym:"ABC"}, levels = [{L:150, name:"$150"}, {L:140, name:"$140"}, {L:130, name:"$130"}];
  const r = E.evaluate(w, baseCtx(Q({c:138, pc:150, dp:-8}), {levels}), {});
  const lv = r.alerts.filter(a => a.kind === "level");
  assert.equal(lv.length, 1); assert.equal(lv[0].level, 140); assert.deepEqual(lv[0].also, ["ABC-L150", "ABC-L140"]);
});
test("near-level heads-up", () => {
  const w = {sym:"ABC", near:1.5}, levels = [{L:140, name:"$140"}];
  assert.equal(E.evaluate(w, baseCtx(Q({c:141.5}), {levels}), {}).alerts[0].kind, "near");
  assert.equal(E.evaluate(w, baseCtx(Q({c:145}), {levels}), {}).alerts.length, 0);
});
test("fast drop fires once, re-arms after a half bounce", () => {
  const w = {sym:"ABC", fastDrop:2, fastMins:15}, t0 = at("2026-11-05", "11:00");
  const ticks = [[t0 - 14*60e3, 100], [t0 - 10*60e3, 100.2], [t0 - 5*60e3, 99.5]];
  let r = E.evaluate(w, baseCtx(Q({c:97.9}), {now:t0, ticks}), {});
  assert.equal(r.alerts.filter(a => a.kind === "fast").length, 1);
  const st1 = r.state;
  r = E.evaluate(w, baseCtx(Q({c:97.8}), {now:t0 + 60e3, ticks}), st1);
  assert.equal(r.alerts.filter(a => a.kind === "fast").length, 1, "lower low keeps the same alert id");
  assert.equal(r.alerts[0].id, "ABC-fast-1");
  r = E.evaluate(w, baseCtx(Q({c:98.9}), {now:t0 + 2*60e3, ticks}), r.state);
  assert.equal(r.state.fast.armed, true, "re-armed after bouncing half the drop");
  assert.equal(st1.fast.n, 1, "evaluate never mutates the state it was given");
});
test("off 52-week high fires on the crossing only", () => {
  const w = {sym:"ABC", offHigh:10};
  let r = E.evaluate(w, baseCtx(Q({c:95}), {hi52:100}), {});
  assert.equal(r.alerts.length, 0); assert.equal(r.state.off, false);
  r = E.evaluate(w, baseCtx(Q({c:89}), {hi52:100}), r.state);
  assert.equal(r.alerts[0].kind, "off");
  r = E.evaluate(w, baseCtx(Q({c:88}), {hi52:100}), r.state);
  assert.equal(r.alerts.length, 0, "already in the zone");
});
test("lag filter holds dip rules back when the whole sector is down", () => {
  const w = {sym:"ABC", dayDrop:3, lagOn:true, lagBy:2};
  assert.equal(E.evaluate(w, baseCtx(Q({c:95, dp:-5}), {benchDp:-4}), {}).alerts.length, 0);
  assert.equal(E.evaluate(w, baseCtx(Q({c:95, dp:-5}), {benchDp:-1}), {}).alerts.length, 1);
});
test("VWAP reclaim is opt-in", () => {
  const w = {sym:"ABC"}, ctx = baseCtx(Q({c:101, l:96}), {vwap:{vw:100}});
  assert.equal(E.evaluate(w, ctx, {vw:"below"}).alerts.length, 0);
  assert.equal(E.evaluate(Object.assign({vwapOn:true}, w), ctx, {vw:"below"}).alerts[0].kind, "vwap");
});
test("every rule in the registry has a unique id and a rank", () => {
  const ids = E.RULES.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
  E.RULES.forEach(r => assert.equal(typeof r.rank, "number"));
});

/* ---------------- bundling ---------------- */
test("bundle: one loud alert per ticker, quiet repeats within 15 minutes, levels always loud", () => {
  const t0 = at("2026-11-05", "11:00"), w = {sym:"ABC", dayDrop:3, hiDrop:4, fastDrop:2};
  const item = (alerts, c) => ({w, ctx:baseCtx(Q({c}), {now:t0}), alerts});
  let r = E.bundle([item([{id:"ABC-red", kind:"red", sym:"ABC", msg:"red"}, {id:"ABC-hd", kind:"hd", sym:"ABC", msg:"hd"}], 95)], {day:"2026-11-05"}, t0, {});
  assert.equal(r.fresh.length, 1); assert.match(r.fresh[0].msg, /also off today's high/);
  r = E.bundle([item([{id:"ABC-sig", kind:"sig", sym:"ABC", msg:"sig"}], 94.9)], r.fired, t0 + 60e3, {});
  assert.equal(r.fresh.length, 0, "within 15 min and no new leg: logged quietly");
  assert.equal(r.fired.log[0].quiet, true);
  r = E.bundle([item([{id:"ABC-L90", kind:"level", sym:"ABC", msg:"lvl"}], 90)], r.fired, t0 + 2*60e3, {});
  assert.equal(r.fresh.length, 1, "a level always gets through");
});
test("bundle: further legs down need twice the last leg, at most 3", () => {
  const t0 = at("2026-11-05", "11:00"), w = {sym:"ABC", fastDrop:2};
  const it = c => ({w, ctx:baseCtx(Q({c}), {now:t0}), alerts:[]});
  let f = {day:"2026-11-05", lastBy:{ABC:{t:t0 - 16*60e3, px:100, legs:0}}};
  let r = E.bundle([it(97.9)], f, t0, {});
  assert.equal(r.fresh.length, 1); assert.equal(r.fresh[0].id, "ABC-leg-1");
  r = E.bundle([it(97)], r.fired, t0 + 16*60e3, {});
  assert.equal(r.fresh.length, 0, "the second leg needs 4%");
});
test("bundle: pause, snooze and all-off suppress everything", () => {
  const t0 = at("2026-11-05", "11:00"), w = {sym:"ABC"}, items = [{w, ctx:baseCtx(Q({c:90}), {now:t0}), alerts:[{id:"ABC-L95", kind:"level", sym:"ABC", msg:"x"}]}];
  assert.equal(E.bundle(items, {}, t0, {paused:true}).fresh.length, 0);
  assert.equal(E.bundle(items, {}, t0, {allOff:true}).fresh.length, 0);
  assert.equal(E.bundle(items, {}, t0, {snoozed:s => s === "ABC"}).fresh.length, 0);
});

/* ---------------- tone ---------------- */
test("tone needs a clear score to switch and holds until it fades", () => {
  const calm = {SPY:{dp:0.1, vol:1}, QQQ:{dp:0.1, vol:1.3}};
  const down = {SPY:{dp:-2.5, vol:1}, QQQ:{dp:-3, vol:1.3}, VIXY:{dp:12, vol:4}};
  assert.equal(E.tone(calm, "mix").k, "mix");
  assert.equal(E.tone(down, "mix").k, "off");
  const mild = {SPY:{dp:-0.9, vol:1}, QQQ:{dp:-1.1, vol:1.3}};
  assert.equal(E.tone(mild, "off").k, "off", "hysteresis keeps the label on a mild follow-through");
  assert.equal(E.tone(mild, "mix").k, "mix");
  assert.equal(E.tone({}, "mix"), null);
});

/* ---------------- portfolio risk ---------------- */
test("portfolio risk: one holding's daily σ is its own", () => {
  const c = randWalk(400, 0.015, 3), bars = mkBars(c);
  const r = E.portfolioRisk([{sym:"AAA", value:10000}], {AAA:bars});
  assert.ok(r.ok);
  assert.ok(Math.abs(r.sd1dPct - 1.5) < 0.4, "sd " + r.sd1dPct);
  assert.ok(Math.abs(r.rc[0].pct - 100) < 1e-6);
  assert.ok(Math.abs(r.effBets - 1) < 1e-6);
  assert.ok(r.es95 >= r.var95, "the average of the worst 5% is at least the 1-in-20 day");
  assert.ok(r.mdd <= 0);
});
test("portfolio risk: two identical holdings are one bet", () => {
  const bars = mkBars(randWalk(400, 0.02, 11));
  const r = E.portfolioRisk([{sym:"AAA", value:5000}, {sym:"BBB", value:5000}], {AAA:bars, BBB:bars, SPY:bars});
  assert.ok(Math.abs(r.effBets - 2) < 1e-6, "equal risk shares give 2 by the formula; " + r.effBets);
  assert.ok(Math.abs(r.betas.SPY - 1) < 1e-6, "beta to itself is 1");
});
test("portfolio risk: independent holdings diversify", () => {
  const a = mkBars(randWalk(400, 0.02, 5)), b = mkBars(randWalk(400, 0.02, 99));
  const one = E.portfolioRisk([{sym:"AAA", value:10000}], {AAA:a});
  const two = E.portfolioRisk([{sym:"AAA", value:5000}, {sym:"BBB", value:5000}], {AAA:a, BBB:b});
  assert.ok(two.sd1d < one.sd1d * 0.85, `${two.sd1d} vs ${one.sd1d}`);
});
test("portfolio risk reports holdings it couldn't measure", () => {
  const r = E.portfolioRisk([{sym:"AAA", value:1000}, {sym:"NEW", value:500}], {AAA:mkBars(randWalk(300, 0.01))});
  assert.deepEqual(r.missing, ["NEW"]);
});

/* ---------------- look-through, sizing ---------------- */
test("look-through adds fund and direct exposure and keeps the total", () => {
  const r = E.lookThrough([{sym:"FUND", value:1000}, {sym:"AAA", value:500}], {FUND:[{sym:"AAA", w:20}, {sym:"BBB", w:10}]});
  const aaa = r.rows.find(x => x.sym === "AAA");
  assert.equal(aaa.value, 700); assert.equal(aaa.sources, 2);
  assert.equal(r.unlisted.FUND, 700);
  assert.equal(r.rows.reduce((a, x) => a + x.value, 0) + r.unlisted.FUND, 1500);
});
test("parseHoldings reads common pasted formats", () => {
  const t = "Ticker,Name,Weight\nAAA,Alpha Inc,20.5%\nBBB Beta Corp 10.25\n\"CCC\",\"Gamma\",\"5.1\"\nCASH,,1.0";
  assert.deepEqual(E.parseHoldings(t), [{sym:"AAA", w:20.5}, {sym:"BBB", w:10.25}, {sym:"CCC", w:5.1}]);
});
test("volatility sizing stays within 0.5x to 2x", () => {
  fc.assert(fc.property(fc.double({min:0.1, max:20, noNaN:true}), v => { const s = E.sizeFor(500, v, 2); return s >= 250 && s <= 1000; }));
  assert.equal(E.sizeFor(500, null, 2), 500);
});

/* ---------------- rule lab ---------------- */
test("rule lab replays daily rules and reports the baseline", () => {
  const bars = mkBars(randWalk(900, 0.02, 21));
  const r = E.ruleLab(bars, {dayDrop:3, sigDrop:2, offHigh:10, auto:true});
  assert.ok(r.ok);
  assert.ok(r.rules.red && r.rules.red.n > 5, "red days found");
  assert.ok(r.baseline.n > 500);
  assert.ok(r.monthly.n > 20 && r.monthly.n < 40);
  for (const k of Object.keys(r.rules)) for (const h of r.horizons) { const x = r.rules[k].h[h]; if (x.n) assert.ok(isFinite(x.mean)); }
  assert.equal(E.ruleLab(mkBars(randWalk(100, 0.02)), {dayDrop:3}).ok, false);
});

/* ---------------- journal ---------------- */
test("journal outcomes are measured from later closes only", () => {
  const rec = {day:"2026-11-05", px:100};
  const closes = [];
  let d = "2026-11-05"; for (let i = 0; i < 25; i++) { d = E.nextTradingDay(d); closes.push({d, c:100 + i}); }
  closes.reverse(); closes.push({d:"2026-11-05", c:999}, {d:"2026-11-04", c:1});
  const o = E.outcomes(rec, closes);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " vs " + b);
  near(o.r1, 0); near(o.r5, 4); near(o.r20, 19); assert.equal(o.mae20, 0); assert.equal(o.done, true);
});
test("scorecard groups by rule and counts actions", () => {
  const rows = E.scorecard([
    {kind:"red", kinds:["red","hd"], action:"bought", outcomes:{r5:2, r20:5, mae20:-3}},
    {kind:"red", kinds:["red"], action:"skipped", outcomes:{r5:-1, r20:-2, mae20:-6}},
    {kind:"level", kinds:["level"], action:null, outcomes:null}]);
  const red = rows.find(r => r.kind === "red");
  assert.equal(red.n, 2); assert.equal(red.bought, 1); assert.equal(red.skipped, 1); assert.equal(red.r20, 1.5); assert.equal(red.hit20, 50);
  assert.equal(rows[0].kind, "level", "sorted by rule rank");
});

/* ---------------- budget, breaker, watching ---------------- */
test("budget: each feature has a share and the day has a hard stop", () => {
  let l = E.budgetFresh(null, "2026-11-05");
  for (let i = 0; i < E.TD_CAPS.nav; i++) { assert.ok(E.budgetAllow(l, "nav").ok); l = E.budgetCharge(l, "nav"); }
  assert.equal(E.budgetAllow(l, "nav").ok, false);
  assert.ok(E.budgetAllow(l, "hist").ok, "other features keep their share");
  const full = {date:"2026-11-05", n:795, by:{}};
  assert.equal(E.budgetAllow(full, "hist").ok, false);
  assert.equal(E.budgetFresh(l, "2026-11-06").n, 0, "resets each day");
});
test("breaker opens after 3 failures and backs off", () => {
  let s = null; const t = 1e12;
  s = E.breaker(s, false, t); s = E.breaker(s, false, t); assert.equal(E.breakerOpen(s, t), false);
  s = E.breaker(s, false, t); assert.equal(E.breakerOpen(s, t + 30e3), true); assert.equal(E.breakerOpen(s, t + 61e3), false);
  s = E.breaker(s, true, t); assert.equal(s.fails, 0);
});
test("watching state goes blind after 10 minutes of poor coverage and recovers", () => {
  const t0 = at("2026-11-05", "11:00"), ses = {s:"open"}, low = {ok:1, total:5, pct:20}, good = {ok:5, total:5, pct:100};
  let st = E.watchState(null, low, t0, ses);
  assert.equal(st.state, "watching");
  st = E.watchState(st, low, t0 + 9*60e3, ses); assert.equal(st.state, "watching");
  st = E.watchState(st, low, t0 + 10*60e3, ses); assert.equal(st.state, "blind"); assert.equal(st.changed, true);
  st = E.watchState(st, good, t0 + 11*60e3, ses); assert.equal(st.state, "watching"); assert.equal(st.changed, true);
});

/* ---------------- config, privacy ---------------- */
test("migrate makes VWAP opt-in, keeps unknown fields and is idempotent", () => {
  const v1 = {holdings:[{sym:"abc", shares:1}], watch:[{sym:"abc", levels:[10]}, {sym:"DEF", vwapOn:true}], extra:{keep:1}};
  const m = E.migrate(v1);
  assert.equal(m.v, 2); assert.equal(m.watch[0].vwapOn, false); assert.equal(m.watch[1].vwapOn, true);
  assert.equal(m.watch[0].sym, "ABC"); assert.deepEqual(m.extra, {keep:1});
  assert.deepEqual(E.migrate(m), m);
  assert.equal(v1.watch[0].vwapOn, undefined, "the input is not changed");
});
test("phone alerts carry no tickers or prices unless you ask for them", () => {
  const list = [{sym:"ABC", msg:"ABC hit your $140 buy level (now $139.50)"}];
  const body = E.ntfyBody(list, false);
  assert.doesNotMatch(body, /ABC|\$|\d{2,}/);
  assert.match(E.ntfyBody(list, true), /ABC/);
  assert.equal(E.ntfyBody(list, false, "MW Lab"), "MW Lab has a new alert. Open MW Lab for details.");
});
test("the engine file holds no personal data", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../../lab/engine.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /finnhub\.io\/api\/v1\/[^"]*token=[a-z0-9]{10}/i);
  assert.doesNotMatch(src, /apikey=[a-f0-9]{20}/i);
});
test("budget projection doesn't extrapolate the morning history load", () => {
  const l = {date:"2026-11-05", n:130, by:{hist:100, backup:30}};
  assert.equal(E.budgetProjection(l, 0.25), 220);
  assert.equal(E.budgetProjection(l, 0.01), 130);
});
test("journal records leave heads-ups out of the rule list", () => {
  const r = E.journalRecord({id:"ABC-red", sym:"ABC", kind:"red", msg:"x", all:[{kind:"red"}, {kind:"near"}]}, {q:{c:10, dp:-3}}, {dayDrop:3}, 1, "2026-11-05");
  assert.deepEqual(r.kinds, ["red"]); assert.equal(r.id, "ABC-red@2026-11-05");
});

/* ---------------- 4.4: macro calendar ---------------- */
test("macro calendar: dates are valid, sorted, and the table runs to its end date", () => {
  for (const ev of E.MACRO) { assert.match(ev.d, /^\d{4}-\d{2}-\d{2}$/); assert.ok(E.weekday(ev.d) >= 1 && E.weekday(ev.d) <= 5, ev.name + " " + ev.d + " is a weekday"); }
  for (let i = 1; i < E.MACRO.length; i++) assert.ok(E.MACRO[i].t >= E.MACRO[i-1].t, "sorted");
  for (const k of Object.keys(E.MACRO_DATES)) assert.ok(E.MACRO_DATES[k].at(-1) >= "2027-11-01", k + " runs into Nov 2027");
  assert.equal(E.etParts(E.MACRO.find(e => e.k === "fomc").t).mins, 840, "FOMC at 2:00 PM ET");
  assert.equal(E.etParts(E.MACRO.find(e => e.k === "cpi").t).mins, 510, "CPI at 8:30 AM ET");
});
test("macro calendar: next events, the hour after a release, and fail-closed past the table", () => {
  const n = E.nextMacro(at("2026-11-09", "12:00"));
  assert.equal(n.list[0].name, "CPI"); assert.equal(n.list[0].d, "2026-11-10"); assert.equal(n.expired, false);
  const just = E.nextMacro(at("2026-11-10", "09:00")).list[0];
  assert.equal(just.name, "CPI"); assert.equal(just.past, true, "still listed 30 min after release");
  assert.notEqual(E.nextMacro(at("2026-11-10", "10:00")).list[0].name, "CPI", "gone after an hour");
  assert.equal(E.nextMacro(at("2028-01-03", "10:00")).expired, true);
  assert.ok(E.MACRO_VALID_TO >= "2027-12-31", "update the macro table before it runs out");
});
/* ---------------- 4.4: two feeds ---------------- */
test("mergeQuote: newer trade sets the price; Finnhub's prev close, open, high and low win", () => {
  const fh = {c:100, t:1000, pc:95, o:96, h:101, l:94, src:"finnhub"};
  const al = {c:102, t:1005, pc:94.9, o:96.2, h:101.5, l:95, src:"alpaca"};
  const m = E.mergeQuote(fh, al, true);
  assert.equal(m.c, 102); assert.equal(m.src, "alpaca"); assert.equal(m.pc, 95, "keeps the consolidated prev close");
  assert.equal(m.h, 102, "high includes the price shown"); assert.equal(m.l, 94);
  assert.ok(Math.abs(m.dp - (102/95 - 1)*100) < 1e-9);
  const back = E.mergeQuote(m, {c:99.5, t:1001, pc:95, o:96, h:101, l:94, src:"finnhub"}, true);
  assert.equal(back.c, 102, "an older Finnhub trade doesn't roll the price back");
  assert.equal(back.h, 102); assert.equal(back.pc, 95);
  const fresh = E.mergeQuote(m, {c:103, t:1010, pc:95, o:96, h:103.2, l:94, src:"finnhub"}, true);
  assert.equal(fresh.c, 103); assert.equal(fresh.h, 103.2);
  const nd = E.mergeQuote(fh, al, false);
  assert.equal(nd.c, 102); assert.equal(nd.pc, 94.9, "a new day starts from the new quote");
});
test("fromSnapshot: regular, pre-market and after-hours trades", () => {
  const snap = (iso, p) => ({latestTrade:{p, t:iso}, dailyBar:{t:"2026-11-05T05:00:00Z", o:100, h:105, l:99, c:104}, prevDailyBar:{t:"2026-11-04T05:00:00Z", c:98}});
  const now = at("2026-11-05", "11:00");
  const r = E.fromSnapshot(snap(new Date(at("2026-11-05", "10:59")).toISOString(), 103), now);
  assert.equal(r.reg.c, 103); assert.equal(r.reg.pc, 98); assert.equal(r.ext, null);
  const pre = E.fromSnapshot(snap(new Date(at("2026-11-05", "08:15")).toISOString(), 101), at("2026-11-05", "08:20"));
  assert.equal(pre.reg, null); assert.equal(pre.ext.ph, "pre"); assert.equal(pre.ext.p, 101);
  const aft = E.fromSnapshot(snap(new Date(at("2026-11-05", "17:30")).toISOString(), 102), at("2026-11-05", "17:31"));
  assert.equal(aft.ext.ph, "after");
  const old = E.fromSnapshot(snap(new Date(at("2026-11-04", "17:30")).toISOString(), 102), at("2026-11-05", "08:00"));
  assert.equal(old.reg, null); assert.equal(old.ext.ph, "after", "yesterday's after-hours trade stays an after-hours trade, not today's pre-market");
  const sun = E.fromSnapshot(snap(new Date(at("2026-11-06", "19:59")).toISOString(), 104.5), at("2026-11-08", "14:10"));
  assert.equal(sun.ext.ph, "after"); assert.equal(sun.ext.p, 104.5, "on Sunday, Friday's last after-hours trade is still the latest");
  const oldReg = E.fromSnapshot(snap(new Date(at("2026-11-06", "15:59")).toISOString(), 104), at("2026-11-08", "14:10"));
  assert.deepEqual(oldReg, {reg:null, ext:null}, "an old regular-hours trade adds nothing to Finnhub's close");
  assert.deepEqual(E.fromSnapshot({}, now), {reg:null, ext:null});
});

test("extLive: the latest known price over nights, weekends and the next pre-market", () => {
  const fri = {c:100, t:Math.floor(at("2026-11-06", "16:00") / 1000)};
  const ah = {p:101.5, t:at("2026-11-06", "19:59"), ph:"after"};
  assert.equal(E.extLive(ah, fri, "closed"), true, "Sunday: Friday's after-hours trade is the price");
  assert.equal(E.extLive(ah, fri, "ext"), true, "Monday before the first pre-market trade, it still is");
  assert.equal(E.extLive(ah, fri, "open"), false, "never during the regular session");
  const fetchStamped = {c:100, t:Math.floor(at("2026-11-07", "12:00") / 1000)};
  assert.equal(E.extLive(ah, fetchStamped, "closed"), true, "a close stamped with Saturday's fetch time still counts as Friday's");
  const mon = {c:103, t:Math.floor(at("2026-11-09", "16:00") / 1000)};
  assert.equal(E.extLive(ah, mon, "ext"), false, "after Monday's close, Friday's after hours is old");
  const pre = {p:102, t:at("2026-11-09", "04:01"), ph:"pre"};
  assert.equal(E.extLive(pre, fri, "ext"), true, "Monday's pre-market trade is newer than Friday's close");
  assert.equal(E.extLive(pre, mon, "ext"), false, "but not after Monday's own close");
  assert.equal(E.quoteDay(at("2026-11-09", "08:00")), "2026-11-06", "a quote stamped before the open belongs to the last session");
  assert.equal(E.extLive(null, fri, "closed"), false); assert.equal(E.extLive(ah, null, "closed"), false);
});

test("parseTickers: separators, exchange prefixes, junk", () => {
  const r = E.parseTickers("nvda, AMD  TSM;NASDAQ:MU\n$ABCD brk.b nvda 12x too-long-ticker");
  assert.deepEqual(r.ok, ["NVDA", "AMD", "TSM", "MU", "ABCD", "BRK.B"]);
  assert.deepEqual(r.bad, ["12x", "too-long-ticker"]);
  assert.deepEqual(E.parseTickers("").ok, []);
});

test("price alert repeat: every cross re-arms only after 30 min and a 0.3% climb back", () => {
  const t0 = at("2026-11-05", "10:00"), m = 60e3;
  let s = E.levelCross(null, 100, 101, t0);                       // above: nothing yet
  assert.deepEqual([s.n, s.below], [0, false]);
  s = E.levelCross(s, 100, 99.5, t0 + m);                         // first hit: alert #0
  assert.deepEqual([s.n, s.below, s.t], [0, true, t0 + m]);
  s = E.levelCross(s, 100, 100.5, t0 + 10*m);                     // back above, but too soon
  assert.equal(s.n, 0);
  s = E.levelCross(s, 100, 100.2, t0 + 40*m);                     // late enough, but only 0.2% above
  assert.equal(s.n, 0);
  s = E.levelCross(s, 100, 100.5, t0 + 41*m);                     // re-armed: the next hit is alert #1
  assert.deepEqual([s.n, s.below], [1, false]);
  s = E.levelCross(s, 100, 99.9, t0 + 50*m);
  assert.deepEqual([s.n, s.below], [1, true]);
  // the evaluator puts the tag on the id, so bundling treats each crossing as new
  const w = {sym:"ABC"}, q = {c:99, pc:101, dp:-2, h:101, l:99, o:101, t:Math.floor((t0 + 50*m)/1000)};
  const r = E.evaluate(w, baseCtx(q, {levels:[{L:100, name:"$100", tag:"#1"}]}), {});
  assert.ok(r.alerts.some(a => a.id === "ABC-L100#1"));
});
test("price alert expiry: on through the last day, off after it", () => {
  assert.equal(E.levelsLive({lvUntil:"2026-11-20"}, "2026-11-20"), true);
  assert.equal(E.levelsLive({lvUntil:"2026-11-20"}, "2026-11-21"), false);
  assert.equal(E.levelsLive({}, "2030-01-01"), true);
});

test("earnings-day moves: the biggest gap after each quarter", () => {
  // 120 calm days from 2026-07-01 with one 8% gap up on 2026-08-20 and one 5% gap down on 2026-10-22
  const asc = []; let c = 100, d = "2026-07-01";
  for (let i = 0; i < 120; i++) {
    let o = c * 1.001;
    if (d === "2026-08-20") o = c * 1.08;
    if (d === "2026-10-22") o = c * 0.95;
    const cl = o * 1.002; asc.push([d, o, cl * 1.01, o * 0.99, cl, 1e6]); c = cl; d = E.addDays(d, 1);
  }
  const m = E.erMoves(asc.slice().reverse(), ["2026-06-30", "2026-09-30", "2026-12-31"]);
  assert.equal(m.length, 2, "the Dec quarter hasn't reported yet");
  assert.equal(m[0].d, "2026-08-20");
  assert.ok(Math.abs(m[0].move - 8.2) < 0.1);
  assert.equal(m[1].d, "2026-10-22", "a clear gap counts before the window closes");
  assert.ok(Math.abs(m[1].move + 4.8) < 0.1);
});

/* ---------------- mutual funds (5.0) ---------------- */
test("fund tickers are five letters ending in X", () => {
  ["ABCDX", "WXYZX", "ABCXX"].forEach(s => assert.equal(E.isFundSym(s), true, s));
  ["ABC", "ABCD", "ABCDE", "abcdx", "ABCDXX", "AB.DX", "", null].forEach(s => assert.equal(E.isFundSym(s), false, String(s)));
});
test("the session on screen and the newest fund price that can exist", () => {
  // Monday 2026-11-09: before the open the screen is about Friday; after it, about Monday
  assert.equal(E.lastSessionDate(at("2026-11-09", "08:00")), "2026-11-06");
  assert.equal(E.lastSessionDate(at("2026-11-09", "09:30")), "2026-11-09");
  assert.equal(E.lastSessionDate(at("2026-11-08", "12:00")), "2026-11-06", "Sunday");
  // a fund price for Monday can't exist until Monday's close
  assert.equal(E.navDueDate(at("2026-11-09", "15:59")), "2026-11-06");
  assert.equal(E.navDueDate(at("2026-11-09", "16:00")), "2026-11-09");
  assert.equal(E.navDueDate(at("2026-11-10", "07:00")), "2026-11-09");
  assert.equal(E.navDueDate(at("2026-11-27", "13:00")), "2026-11-27", "1 PM early close the day after Thanksgiving");
});
test("pickNav: the newest date wins, a tie keeps the preferred source", () => {
  const td = {src:"Twelve Data", nav:12.3, prev:12.1, date:"2026-11-06"}, fh = {src:"Finnhub", nav:12.5, prev:null, date:"2026-11-09"};
  const p = E.pickNav([td, fh], null);
  assert.equal(p.src, "Finnhub"); assert.equal(p.nav, 12.5); assert.equal(p.prev, 12.3, "the day before comes from the older answer"); assert.equal(p.prevDate, "2026-11-06");
  const tie = E.pickNav([td, Object.assign({}, fh, {date:"2026-11-06", nav:12.31})], null);
  assert.equal(tie.src, "Twelve Data"); assert.equal(tie.prev, 12.1); assert.equal(tie.disagree, "");
  assert.match(E.pickNav([td, {src:"Finnhub", nav:13.5, date:"2026-11-06"}], null).disagree, /Finnhub says 13.5/);
  assert.equal(E.pickNav([{src:"x", nav:0, date:"2026-11-06"}, {src:"y", nav:5, date:"soon"}], null), null);
  assert.equal(E.pickNav([fh], {nav:12.3, date:"2026-11-06"}).prev, 12.3, "falls back to the price already held");
});
test("navWait: often while a price is due, rarely once it is in", () => {
  const eve = at("2026-11-09", "18:00"), morn = at("2026-11-10", "08:00"), mid = at("2026-11-09", "12:00");
  assert.equal(E.navWait("2026-11-09", eve), 6 * 3600e3, "up to date");
  assert.equal(E.navWait("2026-11-06", mid), 6 * 3600e3, "Monday's price can't exist at noon");
  assert.equal(E.navWait("2026-11-06", eve), 45 * 60e3); assert.equal(E.navWait("2026-11-06", eve, true), 10 * 60e3);
  assert.equal(E.navWait("2026-11-06", morn), 60 * 60e3); assert.equal(E.navWait(null, morn, true), 20 * 60e3);
});
/* made-up daily closes: a market series, a fund that moves 0.9x with it plus a little noise, and an unrelated series */
function fundWorld() {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  const mk = [], fund = [], other = []; let d = "2026-11-06", a = 150, b = 20, c = 80;
  for (let i = 0; i < 150; i++) { const r = rnd() * 0.03, r2 = rnd() * 0.03;
    mk.push([d, a, a, a, a, 1]); fund.push({d, c:b}); other.push([d, c, c, c, c, 1]);
    a /= 1 + r; b /= 1 + 0.9 * r + rnd() * 0.002; c /= 1 + r2; d = E.prevTradingDay(d); }
  return {mk, fund, other};
}
test("proxyFit finds the ETF a fund moves with, and how much", () => {
  const W = fundWorld(), f = E.proxyFit(W.fund, {AAA:W.other, BBB:W.mk});
  assert.equal(f.sym, "BBB"); assert.ok(Math.abs(f.beta - 0.9) < 0.05, "beta " + f.beta); assert.ok(f.r2 > 0.9, "r2 " + f.r2); assert.equal(f.n, 120);
  const loose = E.proxyFit(W.fund, {AAA:W.other}); assert.ok(!loose || loose.r2 < 0.3, "an unrelated series fits badly or not at all");
  assert.equal(E.proxyFit(W.fund.slice(0, 20), {BBB:W.mk}), null, "too little shared history");
  assert.equal(E.proxyFit(W.fund, {}), null);
});
test("navEstimate: beta x the ETF's move since the day of the fund's price, or nothing", () => {
  const W = fundWorld(), fit = {sym:"BBB", beta:0.9, r2:0.95};
  const e = E.navEstimate(20, "2026-11-06", fit, W.mk, 153);   // the ETF closed at 150 that day: +2%
  assert.ok(Math.abs(e.pct - 1.8) < 1e-9); assert.ok(Math.abs(e.nav - 20.36) < 1e-9); assert.equal(e.from, 150);
  assert.equal(E.navEstimate(20, "2026-11-07", fit, W.mk, 153), null, "no ETF close for that exact day");
  assert.ok(Math.abs(E.navEstimate(20, "2026-11-09", fit, W.mk, 153, {d:"2026-11-09", c:151.5}).pct - 0.9 * (153 / 151.5 - 1) * 100) < 1e-9, "yesterday's close from the live quote");
  assert.equal(E.navEstimate(20, "2026-11-09", fit, null, 153, {d:"2026-11-06", c:150}), null, "a close from another day is not used");
  assert.equal(E.navEstimate(20, "2026-11-06", fit, W.mk, 300), null, "an absurd move is not shown");
  assert.equal(E.navEstimate(0, "2026-11-06", fit, W.mk, 153), null);
});

/* ---------------- news (5.0) ---------------- */
test("newsMerge: one line per story, newest first, old and broken lines dropped", () => {
  const now = at("2026-11-09", "12:00"), m = 60e3;
  const L = E.newsMerge([
    {id:1, sym:"AAA", h:"Chip makers rally on new orders", sum:"", src:"Wire", url:"https://example.com/1", t:now - 30 * m},
    {id:2, sym:"BBB", h:"Chip makers rally on new orders!", sum:"More detail.", src:"Wire", url:"https://example.com/1b", t:now - 40 * m},
    {id:3, sym:"", h:"Rates steady before the auction", src:"Desk", url:"https://example.com/3", t:now - 5 * m, cat:"market"},
    {id:4, sym:"AAA", h:"An old story", url:"https://example.com/4", t:now - 6 * 864e5},
    {id:5, sym:"AAA", h:"A link that isn't one", url:"javascript:alert(1)", t:now - m},
    {id:6, sym:"AAA", h:"", url:"https://example.com/6", t:now - m}], now);
  assert.deepEqual(L.map(n => n.id), ["3", "1"]);
  assert.deepEqual(L[1].syms, ["AAA", "BBB"]); assert.equal(L[1].sum, "More detail."); assert.equal(L[1].t, now - 40 * m, "the first time it appeared");
  assert.deepEqual(L[0].syms, []); assert.equal(L[0].cat, "market");
  assert.equal(E.newsMerge(Array.from({length:120}, (_, i) => ({id:i + 1, sym:"AAA", h:"Story number " + i, url:"https://example.com/" + i, t:now - i * m})), now).length, 80);
  assert.deepEqual(E.newsMerge(null, now), []);
});
test("agoShort", () => {
  const t = 1e12; assert.equal(E.agoShort(t, t + 20e3), "now"); assert.equal(E.agoShort(t, t + 12 * 60e3), "12m"); assert.equal(E.agoShort(t, t + 3 * 3600e3), "3h"); assert.equal(E.agoShort(t, t + 49 * 3600e3), "2d");
});
