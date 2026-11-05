// Builds fixtures/synthetic-day.json: one made-up session for made-up tickers AAA and BBB, with a 4% flush in AAA
// at 11:00 New York time and a slow slide in BBB. Deterministic, so its alerts can be checked against a golden file.
import fs from "node:fs";
import { createRequire } from "node:module";
const E = createRequire(import.meta.url)("../../lab/engine.js");
const day = "2026-11-05", open = E.etMs(day, 570), rows = [];
const pc = {AAA:100, BBB:50, SMH:300};
for (let i = 0; i <= 390; i++) {
  const t = open + i * 60e3;
  const m = i;   // minutes since the open
  const AAA = m < 90 ? 100 + Math.sin(m / 7) * 0.3 : m < 95 ? 100 - (m - 89) * 0.85 : m < 200 ? 95.75 + Math.sin(m / 5) * 0.2 : 96.5;
  const BBB = 50 * (1 - 0.0002 * m);
  const SMH = 300 * (1 - 0.00002 * m);
  for (const [sym, c] of Object.entries({AAA, BBB, SMH})) {
    const p = pc[sym];
    rows.push({t, src:"finnhub", what:`quote?symbol=${sym}`, data:{c:+c.toFixed(2), pc:p, d:+(c - p).toFixed(2), dp:+((c / p - 1) * 100).toFixed(3), h:Math.max(p, 100.3, c), l:Math.min(p, c), o:p, t:Math.floor(t / 1000)}});
  }
}
// the day's high for AAA/BBB/SMH from the series itself
const hi = {}; rows.forEach(r => { const s = r.what.split("=")[1]; hi[s] = Math.max(hi[s] || 0, r.data.c, pc[s]); r.data.h = +hi[s].toFixed(2); });
const cfg = {holdings:[], fixed:[], watch:[
  {sym:"AAA", dayDrop:3, hiDrop:4, sigDrop:2, fastDrop:2, fastMins:15, levels:[96, 90], near:1.5},
  {sym:"BBB", dayDrop:3, hiDrop:4, fastDrop:2, fastMins:15, levels:[48], near:1.5}]};
fs.writeFileSync(new URL("../fixtures/synthetic-day.json", import.meta.url), JSON.stringify({v:1, app:"synthetic", note:"Made-up tickers and prices for tests.", vol:{AAA:1.8, BBB:1.2}, cfg, rows}));
console.log(rows.length + " rows written");
