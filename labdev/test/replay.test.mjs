// Replays a whole synthetic session through the engine and compares every alert with the golden file (R17).
// If a rule change alters these alerts on purpose, regenerate the golden file and review the diff.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { replay } from "../harness/replay.mjs";
const rec = JSON.parse(fs.readFileSync(new URL("../fixtures/synthetic-day.json", import.meta.url)));
const golden = JSON.parse(fs.readFileSync(new URL("../fixtures/synthetic-day.expected.json", import.meta.url)));
test("a recorded day replays to the same alerts", () => {
  assert.deepEqual(replay(rec, rec.cfg), golden);
});
test("the flush in AAA alerts once loudly, bundles the rest, and hits the $96 level", () => {
  const a = replay(rec, rec.cfg).filter(x => x.sym === "AAA");
  assert.equal(a[0].kind, "fast"); assert.equal(a[0].quiet, false);
  assert.ok(a.some(x => x.kind === "level" && !x.quiet));
  assert.ok(a.filter(x => !x.quiet).length <= 2, "no alert storm");
});
test("stale quotes raise nothing", () => {
  const old = JSON.parse(JSON.stringify(rec));
  old.rows.forEach(r => { r.data.t -= 3600; });   // every trade an hour older than its fetch
  assert.deepEqual(replay(old, rec.cfg), []);
});
