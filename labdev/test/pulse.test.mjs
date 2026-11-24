import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const E = createRequire(import.meta.url)("../../lab/engine.js");
// pulse.js engine tests (6.3): the section board (where each section sits) and the Market pulse scoring.
// Section keys are MW's own; fund tickers are public ETFs; every price here is made up.

const ORDER = ["news", "portfolio", "markets", "watch", "log", "pulse"];

test("board: nothing saved deals the visible sections across the columns (the 4.7 rule)", () => {
  assert.deepEqual(E.boardCols(null, ORDER, 2, {}), [["news", "markets", "log"], ["portfolio", "watch", "pulse"]]);
  assert.deepEqual(E.boardCols(null, ORDER, 3, {}), [["news", "watch"], ["portfolio", "log"], ["markets", "pulse"]]);
});

test("board: a hidden section rides behind the visible one before it, and takes no turn", () => {
  const B = E.boardCols(null, ORDER, 2, {portfolio:true});
  assert.deepEqual(B, [["news", "portfolio", "watch", "pulse"], ["markets", "log"]]);
  assert.deepEqual(E.boardRead(B, {portfolio:true}), ["news", "markets", "watch", "log", "pulse"]);
  assert.deepEqual(E.boardCols(null, ORDER, 2, {news:true})[0][0], "news");   // nothing before it: top of the first column
});

test("board: a saved board is kept, unknown keys dropped, duplicates removed, new sections join the shortest column", () => {
  const saved = {3: [["pulse", "news", "ghost"], ["portfolio", "news"], ["markets"]]};
  assert.deepEqual(E.boardCols(saved, ORDER, 3, {}), [["pulse", "news"], ["portfolio", "watch"], ["markets", "log"]]);
  // malformed boards fall back to dealing
  assert.deepEqual(E.boardCols({3: [["news"]]}, ORDER, 3, {}), E.boardCols(null, ORDER, 3, {}));
  assert.deepEqual(E.boardCols({3: "x"}, ORDER, 3, {}), E.boardCols(null, ORDER, 3, {}));
});

test("board: 3 columns arranged, 2 shown: the third goes under the second; 2 arranged, 3 shown: deals the reading order", () => {
  const s3 = {3: [["pulse"], ["news", "portfolio"], ["markets", "watch", "log"]]};
  assert.deepEqual(E.boardCols(s3, ORDER, 2, {}), [["pulse"], ["news", "portfolio", "markets", "watch", "log"]]);
  const s2 = {2: [["pulse", "news", "log"], ["markets", "portfolio", "watch"]]};
  assert.deepEqual(E.boardCols(s2, ORDER, 3, {}), [["pulse", "portfolio"], ["markets", "log"], ["news", "watch"]]);
  // a board for this column count always wins over the other one
  const both = Object.assign({}, s3, {2: [["news"], ["portfolio", "markets", "watch", "log", "pulse"]]});
  assert.deepEqual(E.boardCols(both, ORDER, 2, {}), both[2]);
});

test("board: reading order goes across the top row first", () => {
  assert.deepEqual(E.boardRead([["a", "d"], ["b"], ["c", "e", "f"]], {}), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(E.boardRead([["a", "d"], ["b"], ["c", "e"]], {b:true}), ["a", "c", "d", "e"]);
});

test("board: moving a section, and the keyboard steps", () => {
  const B = [["news", "watch"], ["portfolio", "log"], ["markets", "pulse"]];
  assert.deepEqual(E.boardMove(B, "pulse", 0, "news"), [["pulse", "news", "watch"], ["portfolio", "log"], ["markets"]]);
  assert.deepEqual(E.boardMove(B, "news", 2, null), [["watch"], ["portfolio", "log"], ["markets", "pulse", "news"]]);
  assert.equal(E.boardStep(B, "news", "up", {}), null);
  assert.deepEqual(E.boardStep(B, "news", "down", {}), [["watch", "news"], ["portfolio", "log"], ["markets", "pulse"]]);
  assert.equal(E.boardStep(B, "watch", "down", {}), null);
  assert.deepEqual(E.boardStep(B, "watch", "right", {}), [["news"], ["portfolio", "watch", "log"], ["markets", "pulse"]]);
  assert.deepEqual(E.boardStep(B, "pulse", "left", {}), [["news", "watch"], ["portfolio", "pulse", "log"], ["markets"]]);
  assert.equal(E.boardStep(B, "markets", "right", {}), null);
  assert.equal(E.boardStep(B, "news", "left", {}), null);
  // hidden sections are stepped over
  assert.deepEqual(E.boardStep([["a", "h", "b"]], "a", "down", {h:true}), [["h", "b", "a"]]);
  assert.deepEqual(E.boardStep([["a", "h", "b"]], "b", "up", {h:true}), [["b", "a", "h"]]);
  // one column (a narrow window)
  assert.deepEqual(E.boardStep([ORDER], "log", "up", {})[0], ["news", "portfolio", "markets", "log", "watch", "pulse"]);
});

test("minMoves: only the sections out of place are moved", () => {
  assert.deepEqual(E.minMoves(["a", "b", "c", "d"], ["a", "b", "c", "d"]), []);
  assert.deepEqual(E.minMoves(["a", "b", "c", "d"], ["d", "a", "b", "c"]), ["d"]);
  assert.deepEqual(E.minMoves(["a", "b", "c", "d"], ["b", "c", "d", "a"]), ["a"]);
  assert.deepEqual(E.minMoves(["a", "b"], ["x", "a", "b"]), ["x"]);   // not there yet: always moved
  assert.equal(E.minMoves(["a", "b", "c", "d"], ["d", "c", "b", "a"]).length, 3);
});

test("pulse: the funds it reads", () => {
  const s = E.pulseSyms();
  ["SMH", "SPY", "QQQ", "IWM", "SPHB", "SPLV", "XLY", "XLP", "HYG", "IEF", "VIXY", "UUP", "TLT", "GLD", "USO", "XLK", "XLRE"].forEach(x => assert.ok(s.includes(x), x));
  assert.ok(!s.includes("BTC/USD"));
  assert.equal(new Set(s).size, s.length);
  assert.ok(s.length <= 100, "one snapshot call");
});

test("pulse: relative strength and trends", () => {
  assert.equal(E.pulseRel(2, 0.5).toFixed(4), ((1.02 / 1.005 - 1) * 100).toFixed(4));
  assert.equal(E.pulseRel(null, 1), null);
  const days = n => Array.from({length:n}, (_, i) => E.addDays("2026-10-01", i));
  const a = days(25).map((d, i) => [d, 100 + i]), b = days(25).map(d => [d, 50]);
  const t = E.pulseTrend(a, b, 130, 50);
  // ratio now 2.6; five sessions back (today counts as one): closes[len-5] = 120/50 = 2.4
  assert.equal(t.r5.toFixed(4), ((2.6 / 2.4 - 1) * 100).toFixed(4));
  assert.equal(t.r20.toFixed(4), ((2.6 / (105 / 50) - 1) * 100).toFixed(4));
  assert.equal(t.line.length, 21);
  // only dates both funds have count; too little history gives no 20-day figure
  const t2 = E.pulseTrend(a.slice(0, 10), b, 0, 0);
  assert.equal(t2.r20, null); assert.ok(t2.r5 != null);
  assert.deepEqual(E.pulseTrend(null, b, 1, 1), {r5:null, r20:null, line:[]});
});

test("pulse: breadth counts up, down and above the 20-day average", () => {
  const c = v => Array.from({length:20}, (_, i) => ["2026-10-" + String(i + 1).padStart(2, "0"), v]);
  const b = E.pulseBreadth([{dp:1, px:110, closes:c(100)}, {dp:-0.5, px:90, closes:c(100)}, {dp:0.001, px:100, closes:c(100)}, {dp:null, px:null, closes:c(100)}, {dp:2}]);
  assert.deepEqual(b, {up:2, down:1, n:4, above:1, n20:4});   // a change that rounds to 0.00% is neither; no price: the last close (100) is not above 100
});

test("pulse: verdict phrases share their verb", () => {
  assert.equal(E.pulsePhrase([["high beta", "leading"], ["small caps", "leading"], ["credit", "leading"]]), "high beta, small caps and credit leading");
  assert.equal(E.pulsePhrase([["chips", "lagging"], ["volatility", "rising"]]), "chips lagging, volatility rising");
});

const allPairs = (today, r5, r20) => Object.fromEntries(E.PULSE.pairs.map(p => [p.k, {today, r5, r20}]));
test("pulse: a risk-on day scores high and says why", () => {
  const s = E.pulseScore({pairs: allPairs(1, 2, 4), cross:{vol:{dp:-5}, dollar:{dp:-0.4}, btc:{dp:3}}, breadth:{up:10, down:1, n:11, above:9, n20:11}});
  assert.ok(s.score >= 70 && s.score <= 100, String(s.score));
  assert.equal(s.label, "Strong risk-on");
  assert.match(s.verdict, /^Strong risk-on: .*(high beta|credit).* leading/);
  assert.equal(s.cover, 1);
});

test("pulse: a risk-off day scores low", () => {
  const s = E.pulseScore({pairs: allPairs(-0.6, -1, -2), cross:{vol:{dp:6}, dollar:{dp:0.3}, btc:{dp:-2}}, breadth:{up:2, down:9, n:11, above:3, n20:11}});
  assert.ok(s.score <= -40, String(s.score));
  assert.equal(s.label, "Strong risk-off");
  assert.match(s.verdict, /lagging|rising/);
});

test("pulse: scale, clamping and labels", () => {
  // a huge move counts no more than the scale
  const a = E.pulseScore({pairs:{chips:{today:50}}, cross:{vol:{dp:-1}, dollar:{dp:0}, btc:{dp:0}}, breadth:{up:6, down:5, n:11}});
  assert.ok(a.parts.every(p => p.c >= -1 && p.c <= 1));
  // mixed: names one on each side
  const m = E.pulseScore({pairs:{chips:{today:1.2, r5:3, r20:6}, credit:{today:-0.3, r5:-0.8, r20:-1.5}, small:{today:0}}, cross:{vol:{dp:0}, dollar:{dp:0}, btc:{dp:0}}, breadth:{up:5, down:5, n:10, above:5, n20:10}});
  assert.equal(m.label, "Mixed");
  assert.match(m.verdict, /^Mixed: chips leading, but credit lagging$/);
  // flat: no sign on zero
  const z = E.pulseScore({pairs: allPairs(0, 0, 0), cross:{vol:{dp:0}, dollar:{dp:0}, btc:{dp:0}}, breadth:{up:0, down:0, n:11, above:5, n20:10}});
  assert.equal(z.score, 0); assert.ok(!Object.is(z.score, -0));
  assert.equal(z.verdict, "Mixed: no clear lead either way");
});

test("pulse: too little data gives no reading; context lines never count", () => {
  const s = E.pulseScore({pairs:{chips:{today:1}}, cross:{gold:{dp:5}, oil:{dp:-5}, rates:{dp:3}}});
  assert.equal(s.score, null); assert.equal(s.label, "Not enough data");
  assert.ok(s.parts.every(p => !["gold", "oil", "rates"].includes(p.k)));
  assert.deepEqual(E.pulseScore(null).score, null);
  // a pair with today only counts in full; with 5D only, for less
  const t = E.pulseScore({pairs:{chips:{r5:3}}}), w = t.parts.find(p => p.k === "chips").w;
  assert.ok(w < 1 && w > 0);
});
