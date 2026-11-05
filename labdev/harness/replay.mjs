// Replay a recorded (or synthetic) market day through the MW Lab engine and print every alert it would raise (R17).
// Usage: node harness/replay.mjs <recording.json> [setup.json]
//   recording: Diagnostics → "Download recording" from MW Lab, or fixtures/synthetic-day.json
//   setup: a Backup file (holdings/watchlist); the synthetic fixture carries its own.
// The engine runs exactly as in the page: freshness, rules, bundling. No network, no clock.
import fs from "node:fs";
import { createRequire } from "node:module";
const E = createRequire(import.meta.url)("../../lab/engine.js");

export function replay(rec, cfg, opts = {}) {
  cfg = E.migrate(cfg);
  const vol = opts.vol || rec.vol || {}, out = [], quotes = {}, ticks = {}, states = {}, off = {};
  let fired = {};
  const rows = (rec.rows || []).filter(r => r.src === "finnhub" && /^quote\?symbol=/.test(r.what) && r.data && r.data.c > 0).sort((a, b) => a.t - b.t);
  let lastT = 0;
  const step = now => {
    const day = E.etDateOf(now); if (fired.day !== day) fired = {day};
    const ses = E.session(now, null);
    const items = cfg.watch.filter(w => w.sym && quotes[w.sym]).map(w => {
      const q = quotes[w.sym], ctx = {sym:w.sym, q, now, today:day, vol:vol[w.sym] || null, hi52:(rec.hi52 || {})[w.sym] || null, benchSym:"SMH", benchDp:quotes.SMH ? quotes.SMH.dp : null,
        er:null, ticks:(ticks[w.sym] || []).filter(x => now - x[0] <= 125*60e3), vwap:null, levels:(w.levels || []).slice().sort((a, b) => b - a).map(L => ({L, name:E.fmt$(L)})), alertOk:E.alertable(q, now, ses)};
      const r = E.evaluate(w, ctx, Object.assign({}, states[w.sym] || {}, {off:off[w.sym]}));
      states[w.sym] = {fast:r.state.fast, vw:r.state.vw}; if (r.state.off !== undefined) off[w.sym] = r.state.off;
      return {w, ctx, alerts:r.alerts};
    });
    const b = E.bundle(items, fired, now, {timeStr: t => new Date(t).toISOString().slice(11, 16) + "Z"});
    fired = b.fired;
    b.logged.forEach(a => out.push({t:new Date(now).toISOString(), sym:a.sym, kind:a.kind, quiet:a.quiet, id:a.id}));
  };
  for (const r of rows) {
    const sym = decodeURIComponent(r.what.split("=")[1]).toUpperCase(), q = Object.assign({}, r.data, {at:r.t});
    quotes[sym] = q;
    const a = ticks[sym] || (ticks[sym] = []); if (!a.length || r.t - a[a.length - 1][0] > 20e3) a.push([r.t, q.c]); else a[a.length - 1] = [r.t, q.c];
    if (r.t !== lastT) { step(r.t); lastT = r.t; }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const cfg = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], "utf8")) : rec.cfg;
  if (!cfg) { console.error("Give a setup file (Settings → Backup) as the second argument."); process.exit(2); }
  const alerts = replay(rec, cfg);
  alerts.forEach(a => console.log(`${a.t}  ${a.sym.padEnd(6)} ${a.kind.padEnd(6)} ${a.quiet ? "(quiet)" : ""}`));
  console.log(`${alerts.length} alert(s) from ${(rec.rows || []).length} recorded responses.`);
}
