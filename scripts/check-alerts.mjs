// Background alert checker for Market Widget.
// Runs on GitHub Actions. Everything personal (watchlist, levels, keys, push address) comes from the
// ALERT_SETUP secret. This file and its logs contain nothing personal: logs print counts only.
import webpush from "web-push";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

// Never let an error object reach the log: some carry the push address.
process.on("uncaughtException", () => { console.log("Stopped on an unexpected error (details hidden to keep logs private)."); process.exit(1); });
process.on("unhandledRejection", () => { console.log("Stopped on an unexpected error (details hidden to keep logs private)."); process.exit(1); });

const STATE_DIR = ".alert-state", STATE = `${STATE_DIR}/state.json`;
const TEST = process.env.TEST_PUSH === "true";
const raw = process.env.ALERT_SETUP || "";
if (!raw) { console.log("No ALERT_SETUP secret yet; nothing to do."); process.exit(0); }

let setup;
try { setup = JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8")); }
catch { console.log("ALERT_SETUP could not be read. Copy it again from the app."); process.exit(1); }

const h = s => createHash("sha256").update(String(s)).digest("hex").slice(0, 16); // state never stores readable tickers or levels
const et = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {timeZone: "America/New_York", hour12: false, weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"}).formatToParts(new Date()).map(x => [x.type, x.value]));
  return {day: p.weekday, date: `${p.year}-${p.month}-${p.day}`, mins: (+p.hour % 24) * 60 + (+p.minute)};
};
const money = n => "$" + n.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});

try { webpush.setVapidDetails("https://awpmap.github.io/market-widget/", setup.vapid.pub, setup.vapid.priv); }
catch { console.log("The setup code is incomplete. Reconnect in the app and copy it again."); process.exit(1); }
async function push(title, body, tag, sticky = true) {
  await webpush.sendNotification(setup.sub, JSON.stringify({title, body, tag, sticky}), {TTL: 3600, urgency: "high"});
}

if (TEST) {
  try {
    await push("Market Widget", "Background alerts are working. You'll get pop-ups like this even with the window closed.", "test@" + Date.now(), false);
    console.log("Test notification sent.");
  } catch (e) { console.log(`Test notification failed (status ${e.statusCode || "unknown"}). Reconnect in the app and update the secret.`); process.exit(1); }
  process.exit(0);
}

// NYSE holidays and 1 pm early closes (same table as the app)
const HOLIDAYS = new Set(["2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25",
  "2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31","2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24"]);
const EARLY_CLOSE = {"2026-11-27": 780, "2026-12-24": 780, "2027-11-26": 780};
const now = et();
const close = EARLY_CLOSE[now.date] || 960;
const open = process.env.MW_FORCE_OPEN === "1" || (!["Sat", "Sun"].includes(now.day) && !HOLIDAYS.has(now.date) && now.mins >= 570 && now.mins < close);
if (!open) { console.log("Market closed; skipping."); process.exit(0); }
if (setup.allOff) { console.log("Alerts paused in the app."); process.exit(0); }

let state = {};
try { if (existsSync(STATE)) state = JSON.parse(readFileSync(STATE, "utf8")); } catch {}
if (state.date !== now.date) state = {date: now.date, fired: {}, off: state.off || {}, hi: state.hi || {}};

const fh = async path => {
  const r = await fetch(`https://finnhub.io/api/v1/${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(setup.fk)}`);
  if (!r.ok) throw new Error("data " + r.status);
  return r.json();
};

let checked = 0, sent = 0, failed = 0;
for (const w of (setup.watch || [])) {
  if (!w.sym || w.on === false) continue;
  const sym = String(w.sym).toUpperCase();
  try {
    const q = await fh(`quote?symbol=${encodeURIComponent(sym)}`);
    if (!q || !q.c) { failed++; continue; }
    // only act on a price from today's session (never on yesterday's close)
    if (process.env.MW_FORCE_OPEN !== "1" && q.t && new Intl.DateTimeFormat("en-CA", {timeZone: "America/New_York"}).format(new Date(q.t * 1000)) !== now.date) continue;
    checked++;
    const px = q.c, alerts = [];
    if (w.redOn !== false && w.dayDrop && q.dp <= -w.dayDrop) alerts.push({id: `${sym}-red`, kind: "red", msg: `${sym} is down ${Math.abs(q.dp).toFixed(1)}% today at ${money(px)}`});
    if (w.offHigh && w.offOn !== false) {
      const hk = h(sym);
      if (!state.hi[hk] || state.hi[hk].d !== now.date) {
        try { const m = (await fh(`stock/metric?metric=all&symbol=${encodeURIComponent(sym)}`)).metric || {}; if (m["52WeekHigh"]) state.hi[hk] = {v: +m["52WeekHigh"], d: now.date}; } catch {}
      }
      const hi = state.hi[hk] && state.hi[hk].v;
      if (hi) {
        const off = (1 - px / hi) * 100, inZone = off >= w.offHigh;
        if (inZone && state.off[hk] === false) alerts.push({id: `${sym}-off`, kind: "off", msg: `${sym} just fell ${off.toFixed(1)}% below its 52-week high (${money(hi)})`});
        state.off[hk] = inZone;
      }
    }
    if (w.levelsOn !== false) {
      let lv = (w.levels || []).slice();
      if (w.split && now.date >= w.split.date) lv = lv.map(x => +(x / w.split.ratio).toFixed(2));
      lv.sort((a, b) => b - a);
      const hit = lv.filter(L => px <= L), next = lv.find(L => L < px);
      // one alert names the deepest level reached; the ones above it count as done
      if (hit.length) { const deep = hit[hit.length - 1]; alerts.push({id: `${sym}-L${deep}`, also: hit.map(L => `${sym}-L${L}`), kind: "level", msg: `${sym} hit your ${money(deep)} buy level (now ${money(px)})${hit.length > 1 ? ` · through ${hit.length} levels` : ""}`}); }
      if (next && w.nearOn !== false && w.near && px <= next * (1 + w.near / 100)) alerts.push({id: `${sym}-N${next}`, kind: "near", msg: `${sym} is ${((px / next - 1) * 100).toFixed(1)}% above your ${money(next)} level`});
    }
    for (const a of alerts) {
      const key = h(a.id);
      if (state.fired[key]) continue;
      try { await push("Market alert", a.msg, `${a.id}@${now.date}`, a.kind !== "near"); state.fired[key] = 1; (a.also || []).forEach(id => state.fired[h(id)] = 1); sent++; }
      catch (e) { failed++; if (e.statusCode === 404 || e.statusCode === 410) { console.log("This PC's push connection expired. Reconnect in the app (Settings → Background) and update the secret."); break; } }
    }
  } catch { failed++; }
}

mkdirSync(STATE_DIR, {recursive: true});
writeFileSync(STATE, JSON.stringify(state));
console.log(`Checked ${checked} symbol(s); sent ${sent} new alert(s); ${failed} problem(s).`);
