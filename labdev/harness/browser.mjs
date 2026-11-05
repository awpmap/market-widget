// MW Lab browser harness (R1, R17): runs the real page in Chromium against SYNTHETIC market data and a fake clock,
// then checks the things that matter: it renders, an alert fires and is journaled, a feed outage is announced
// loudly and its recovery too, phone alerts carry no tickers or prices, and the live MW's storage is never touched.
// Run: node labdev/harness/browser.mjs [--shots dir]   (needs Playwright with Chromium)
// All tickers here (AAA, BBB, CCC) and all prices are made up.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const E = require("../../lab/engine.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shotsAt = process.argv.indexOf("--shots"), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, {recursive:true});
const fail = [], note = m => console.log("  " + m);
const check = (ok, what) => { console.log((ok ? "  ✓ " : "  ✗ ") + what); if (!ok) fail.push(what); };

/* ---------- a tiny static server: the repo root served at /market-widget/, like GitHub Pages ---------- */
const TYPES = {".html":"text/html", ".js":"text/javascript", ".json":"application/json", ".webmanifest":"application/manifest+json", ".png":"image/png", ".css":"text/css"};
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!u.startsWith("/market-widget/")) { res.writeHead(404); return res.end(); }
  let f = path.join(ROOT, u.slice("/market-widget/".length));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, {"content-type": TYPES[path.extname(f)] || "application/octet-stream"}); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/market-widget/lab/`;

/* ---------- synthetic market ---------- */
let simNow = Date.parse("2026-11-05T15:30:00Z");   // 10:30 New York time, a Thursday
const hash = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const px = {}, pcOf = s => 50 + hash(s) % 200;
const priceOf = s => px[s] ?? pcOf(s);
let finnhubDown = false, tdDown = false, finnhubBadKey = false;
const sent = {ntfy:[], hc:0};
function dailyBars(sym, today) {
  let seed = hash(sym) || 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = []; let d = E.prevTradingDay(today), c = pcOf(sym);
  for (let i = 0; i < 1300; i++) {
    const r = 0.018 * Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const o = c / (1 + r * 0.3);
    out.push({datetime:d, open:o.toFixed(2), high:(Math.max(o, c) * 1.008).toFixed(2), low:(Math.min(o, c) * 0.992).toFixed(2), close:c.toFixed(2), volume:String(1e6 + (hash(sym + d) % 5e5))});
    c = c / (1 + r); d = E.prevTradingDay(d);
  }
  return out;   // newest first, like Twelve Data
}
const quote = s => { const c = priceOf(s), pc = pcOf(s); return {c, pc, d:c - pc, dp:(c / pc - 1) * 100, h:Math.max(pc, c), l:Math.min(pc, c), o:pc, t:Math.floor(simNow / 1000)}; };

async function mock(page) {
  await page.route(/https:\/\/finnhub\.io\/.*/, route => {
    const u = new URL(route.request().url()), p = u.pathname.replace("/api/v1/", ""), sym = u.searchParams.get("symbol");
    if (finnhubBadKey) return route.fulfill({status:401, json:{error:"Invalid API key"}});
    if (p === "quote") return finnhubDown ? route.fulfill({status:502, body:"bad gateway"}) : route.fulfill({json: quote(sym)});
    if (p === "stock/metric") return route.fulfill({json: {metric: {"52WeekHigh": pcOf(sym) * 1.08, "52WeekLow": pcOf(sym) * 0.7, beta: 1.2}}});
    if (p === "stock/market-status") return route.fulfill({json: {isOpen: true, holiday: null}});
    if (p === "calendar/earnings") return route.fulfill({json: {earningsCalendar: []}});
    if (p === "company-news") return route.fulfill({json: []});
    return route.fulfill({json: {}});
  });
  await page.route(/https:\/\/api\.twelvedata\.com\/.*/, route => {
    const u = new URL(route.request().url()), sym = u.searchParams.get("symbol"), today = E.etDateOf(simNow);
    if (u.pathname === "/time_series" && u.searchParams.get("interval") === "1day") return route.fulfill({json: {values: dailyBars(sym, today)}});
    if (u.pathname === "/time_series") return route.fulfill({json: {values: []}});
    if (u.pathname === "/quote" && tdDown) return route.fulfill({status:502, body:"bad gateway"});
    if (u.pathname === "/quote") { const q = quote(sym); return route.fulfill({json: {close:String(q.c), previous_close:String(q.pc), change:String(q.d), percent_change:String(q.dp), high:String(q.h), low:String(q.l), open:String(q.o), timestamp:q.t, datetime:today}}); }
    return route.fulfill({json: {status:"error", message:"not mocked"}});
  });
  await page.route(/https:\/\/ntfy\.sh\/.*/, route => { sent.ntfy.push(route.request().postData() || ""); route.fulfill({json: {}}); });
  await page.route(/https:\/\/hc-ping\.com\/.*/, route => { sent.hc++; route.fulfill({body: "OK"}); });
  await page.route(/https:\/\/api\.github\.com\/.*/, route => route.fulfill({json: []}));
  await page.route(/https:\/\/browser\.sentry-cdn\.com\/.*/, route => route.abort());
}

/* ---------- the run ---------- */
const browser = await chromium.launch();
const ctx = await browser.newContext({viewport:{width:420, height:900}, timezoneId:"America/Chicago", deviceScaleFactor: 1});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|sentry/i.test(m.text())) errors.push("console: " + m.text()); });
await mock(page);
const liveCfg = {holdings:[{sym:"CCC", shares:3, acct:"Taxable"}], fixed:[], watch:[{sym:"CCC", levels:[10]}]};
await page.addInitScript(([live]) => {
  if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1");
  localStorage.clear();
  localStorage.setItem("mw_cfg", JSON.stringify(live));
  localStorage.setItem("mw_settings", JSON.stringify({key:"live-key-not-used"}));
  localStorage.setItem("mwlab_settings", JSON.stringify({key:"test", tdKey:"test", ntfy:"mwlab-harness", hcUrl:"https://hc-ping.com/00000000-0000-0000-0000-000000000000", refresh:30}));
  localStorage.setItem("mwlab_cfg", JSON.stringify({holdings:[{sym:"AAA", shares:10, acct:"Taxable"}, {sym:"BBB", shares:20, acct:"Roth"}, {sym:"QQQ", shares:2, acct:"Roth"}],
    fixed:[{name:"Cash (Taxable)", value:1000}, {name:"Cash (Roth)", value:500}],
    watch:[{sym:"AAA", note:"test", dayDrop:3, offHigh:10, levels:[90, 80], near:1.5, hiDrop:4, sigDrop:2, fastDrop:2, fastMins:15, buyAmt:200},
           {sym:"BBB", dayDrop:3, levels:[], near:1.5, buyAmt:100}]}));
}, [liveCfg]);
await page.clock.install({time: simNow});
const advance = async (ms, step = 5000) => { for (let t = 0; t < ms; t += step) { simNow += step; await page.clock.runFor(step); await page.waitForTimeout(40); } };
const shot = async name => { if (SHOTS) await page.screenshot({path: path.join(SHOTS, name + ".png")}); };

console.log("MW Beta browser harness");
await page.goto(BASE);
await advance(20000, 1000);
await advance(120000);
check(await page.locator("#pf-body .hero .val").innerText().then(t => /\$/.test(t)), "portfolio total renders");
check(await page.locator("#mk-body .tile").count() >= 10, "market tiles render");
check(await page.locator("#wl-body .wrow").count() === 2, "watchlist renders 2 rows");
check(/MW Beta/.test(await page.title()), "title says MW Beta");
check(await page.locator(".riskx h5").count() === 1, "risk block measured from price history");
await shot("1-start");
const cashNames = await page.locator("#pf-body .grp-h[data-grp=__cash] + .grp-rows .hrow .s").evaluateAll(els => els.map(e => e.firstChild.textContent.trim()));
check(cashNames.join("|") === "Cash (Taxable)|Cash (Roth)", "cash rows keep their names from Settings (" + cashNames.join(", ") + ")");
check(await page.locator("#pf-body .hrow .tk").count() >= 3, "holding rows show the ticker in its own cell");
// compact view keeps the watchlist in your order, with the columns lined up
await page.keyboard.press("c"); await advance(1000, 250);
check(JSON.stringify(await page.locator("#strip .srow .tk").allInnerTexts()) === JSON.stringify(["AAA","BBB"]), "the compact strip follows the watchlist order");
check(await page.evaluate(() => { const r = [...document.querySelectorAll("#strip .srow")].map(row => Math.round(row.children[1].getBoundingClientRect().right)); return r.length === 2 && r[0] === r[1]; }), "the compact strip's price column lines up across rows");
await page.keyboard.press("c"); await advance(1000, 250);
// Esc in a Settings text box leaves the box first; the next Esc closes Settings
await page.evaluate(() => { openSheet("general"); document.getElementById("sKey").focus(); });
await page.keyboard.press("Escape");
const stillOpen = await page.evaluate(() => !document.getElementById("sheet").classList.contains("hide"));
await page.keyboard.press("Escape");
check(stillOpen && await page.evaluate(() => document.getElementById("sheet").classList.contains("hide")), "Esc leaves a text box, then closes Settings");

// a sharp drop in AAA: red day, unusual drop, off today's high, near the $90 level
const pc = pcOf("AAA"); px.AAA = +(pc * 0.91).toFixed(2);
note(`AAA drops from ${pc} to ${px.AAA}`);
await page.evaluate(lv => { const c = JSON.parse(localStorage.getItem("mwlab_cfg")); c.watch[0].levels = lv; localStorage.setItem("mwlab_cfg", JSON.stringify(c)); }, [Math.round(pc * 0.905), Math.round(pc * 0.8)]);
await page.reload(); await advance(15000, 1000); await advance(60000);
const log = await page.locator("#log-body").innerText();
check(/AAA/.test(log), "the drop is in today's alerts");
check(sent.ntfy.length > 0, "a phone alert went out");
check(sent.ntfy.every(b => !/AAA|BBB|\$|\d{2,}/.test(b)), "phone alerts carry no tickers or prices");
const jn = await page.evaluate(() => new Promise(res => { const r = indexedDB.open("mwlab"); r.onsuccess = () => { const tx = r.result.transaction("journal"); const g = tx.objectStore("journal").getAll(); g.onsuccess = () => res(g.result); }; r.onerror = () => res([]); }));
check(jn.length >= 1 && jn.some(j => j.sym === "AAA"), "the alert is in the journal (" + jn.length + " record)");
await shot("2-alert");

// first only Finnhub goes down: the Twelve Data backup keeps the watchlist covered, so no alarm
finnhubDown = true;
await advance(4 * 60e3, 10000);
check(await page.locator("#blind.show").count() === 0, "with Finnhub down, the backup keeps MW watching");
// then both feeds are down for 12 minutes: MW must say it can't see prices
tdDown = true; const before = sent.ntfy.length;
await advance(13 * 60e3, 10000);
check(await page.locator("#blind.show").count() === 1, "a feed outage shows the not-watching banner");
check(sent.ntfy.slice(before).some(b => /can't see prices/.test(b)), "the outage was announced loudly (phone)");
await shot("3-outage");
finnhubDown = false; tdDown = false; const before2 = sent.ntfy.length;
await advance(4 * 60e3, 10000);
check(await page.locator("#blind.show").count() === 0, "the banner clears when prices return");
check(sent.ntfy.slice(before2).some(b => /watching again/.test(b)), "the recovery was announced");
check(sent.hc > 0, "Healthchecks was pinged");

// a rejected Finnhub key is shown at the top, with a way to fix it, and clears once the key works
finnhubBadKey = true; await page.evaluate(() => { fhBreaker = {fails:0, openUntil:0, trips:0}; schedule(true); });   // the outage above left Finnhub paused; start clean
await advance(150000, 2000);   // a refresh with Finnhub refusing waits on the slower backup feed
check(await page.locator("#keyBad:not(.hide)").count() === 1, "a rejected key shows the fix-your-key notice");
finnhubBadKey = false; await page.evaluate(() => schedule(true)); await advance(150000, 2000);
check(await page.locator("#keyBad.hide").count() === 1, "the notice clears when the key works again");
// every settings tab opens without an error
for (const tab of ["general","holdings","alerts","journal","lab","funds","markets","layout","backup","diag"]) {
  await page.evaluate(t => { document.querySelector('[data-open="journal"]') && 0; openSheet(t); }, tab);
  await advance(2000, 500);
  if (tab === "lab" || tab === "journal" || tab === "backup") await shot("tab-" + tab);
}
check(/Copy from MW/.test(await page.evaluate(() => { openSheet("backup"); return document.getElementById("shBody").innerText; })), "Backup offers to copy the live MW setup");
await page.evaluate(() => closeSheet());
await page.keyboard.press(","); await advance(500, 250);
check(await page.evaluate(() => document.querySelector("#tabs button.on").dataset.tab) === "backup", "Settings reopens on the tab used last");
await page.evaluate(() => { openSheet("general"); document.getElementById("sTheme").value = "light"; document.getElementById("sTheme").dispatchEvent(new Event("change")); });
const previewTheme = await page.evaluate(() => document.documentElement.dataset.theme);
await page.evaluate(() => closeSheet());
check(previewTheme === "light" && await page.evaluate(() => document.documentElement.dataset.theme) !== "light", "a theme previews right away and closing without Save puts it back");
await page.locator("#mkt").click(); await advance(1000, 500);
check(/credits/.test(await page.locator("#statusPop").innerText()), "status shows the Twelve Data budget");
await shot("4-status");

// the live MW's storage is untouched
const live = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("mw_")).map(k => [k, localStorage.getItem(k)]));
check(live.length === 2 && JSON.stringify(JSON.parse(live.find(x => x[0] === "mw_cfg")[1])) === JSON.stringify(liveCfg), "the live MW's storage was not changed");
check(errors.length === 0, "no page errors" + (errors.length ? ":\n    " + errors.slice(0, 8).join("\n    ") : ""));

/* ---------- beta channel: opt in from the regular MW, come back, and fall back when the beta won't start ---------- */
console.log("Beta switch");
const LIVE = BASE.replace(/lab\/$/, "");
const ctx2 = await browser.newContext({viewport:{width:420, height:900}, timezoneId:"America/Chicago"});
const p2 = await ctx2.newPage(); await mock(p2);
const errs2 = []; p2.on("pageerror", e => errs2.push(e.message));
await p2.addInitScript(([live]) => {
  if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1");
  localStorage.clear(); localStorage.setItem("mw_cfg", JSON.stringify(live)); localStorage.setItem("mw_settings", JSON.stringify({key:"test", tdKey:"test"}));
}, [liveCfg]);
const ls = k => p2.evaluate(k => localStorage.getItem(k), k);
await p2.goto(LIVE); await p2.waitForTimeout(800);
check(!/\/lab\//.test(p2.url()), "regular MW opens normally before opting in");
const liveBefore = await ls("mw_cfg");   // as the regular MW saved it
await p2.evaluate(() => openSheet("general"));
check(/Try the beta/.test(await p2.locator("#sBeta").innerText()), "regular MW offers Try the beta");
await p2.locator("#sBeta").click(); await p2.waitForURL(/\/lab\//); await p2.waitForTimeout(1500);
check(/MW Beta/.test(await p2.title()), "Try the beta opens MW Beta");
const bcfg = JSON.parse(await ls("mwlab_cfg") || "{}");
check((bcfg.holdings || []).some(h => h.sym === "CCC"), "the beta starts with a copy of the regular setup");
check(+(await ls("mw_betaOk")) > 0 && await ls("mw_channel") === "beta", "the beta reports that it started");
await p2.goto(LIVE); await p2.waitForURL(/\/lab\//); await p2.waitForTimeout(800);
check(/\/lab\//.test(p2.url()), "after opting in, opening MW opens the beta");
await p2.evaluate(() => openSheet("general"));
check(/Switch back to regular MW/.test(await p2.locator("#sChannel").innerText()), "the beta offers Switch back");
p2.once("dialog", d => d.accept());
await p2.locator("#sChannel").click(); await p2.waitForURL(u => !/\/lab\//.test(String(u))); await p2.waitForTimeout(800);
check(!/\/lab\//.test(p2.url()) && await ls("mw_channel") === "stable", "Switch back returns to regular MW and stays there");
check(await ls("mw_cfg") === liveBefore, "the regular setup is unchanged after the round trip");
// a beta that never confirms it started: MW must fall back to the regular version
await p2.evaluate(() => { localStorage.setItem("mw_channel", "beta"); localStorage.setItem("mw_betaTry", String(Date.now())); localStorage.setItem("mw_betaOk", "0"); });
await p2.goto(LIVE); await p2.waitForTimeout(800);
check(!/\/lab\//.test(p2.url()), "if the beta didn't start last time, MW opens the regular version");
await p2.evaluate(() => openSheet("general"));
check(/Try the beta again/.test(await p2.locator("#sBeta").innerText()), "and offers to try the beta again");
await p2.goto(LIVE + "?stable"); await p2.waitForTimeout(500);
check(await ls("mw_channel") === "stable", "?stable turns the beta off");
check(errs2.length === 0, "no page errors in the beta switch" + (errs2.length ? ": " + errs2.slice(0, 4).join(" | ") : ""));

await browser.close(); server.close();
console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nAll browser checks passed");
process.exit(fail.length ? 1 : 0);
