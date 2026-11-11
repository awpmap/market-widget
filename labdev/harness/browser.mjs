// MW Lab browser harness (R1, R17): runs the real page in Chromium against SYNTHETIC market data and a fake clock,
// then checks the things that matter: it renders, an alert fires and is logged, a feed outage is announced
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
const px = {}, pcFix = {}, pcOf = s => pcFix[s] ?? 50 + hash(s) % 200;   // pcFix: a previous close set by hand (a price under $1, a four-digit one)
const priceOf = s => px[s] ?? pcOf(s);
let finnhubDown = false, tdDown = false, finnhubBadKey = false;
const sent = {ntfy:[], hc:0}, quoteCalls = {};
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
    if (p === "quote") quoteCalls[sym] = (quoteCalls[sym] || 0) + 1;
    if (p === "quote") return finnhubDown ? route.fulfill({status:502, body:"bad gateway"}) : route.fulfill({json: quote(sym)});
    if (p === "stock/metric") return route.fulfill({json: {metric: {"52WeekHigh": pcOf(sym) * 1.08, "52WeekLow": pcOf(sym) * 0.7, beta: 1.2}}});
    if (p === "stock/market-status") return route.fulfill({json: {isOpen: true, holiday: null}});
    if (p === "calendar/earnings") return route.fulfill({json: {earningsCalendar: []}});
    if (p === "company-news" || p === "news") return route.fulfill({json: []});
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
  localStorage.setItem("mwlab_seenVer", JSON.stringify("99.0.0"));   // the "what's new" card has its own check further down
  localStorage.setItem("mwlab_cfg", JSON.stringify({holdings:[{sym:"AAA", shares:10, acct:"Taxable"}, {sym:"BBB", shares:20, acct:"Roth"}, {sym:"QQQ", shares:2, acct:"Roth"}],
    fixed:[{name:"Cash (Taxable)", value:1000}, {name:"Cash (Roth)", value:500}],
    watch:[{sym:"AAA", note:"test", dayDrop:3, offHigh:10, levels:[90, 80], near:1.5, hiDrop:4, sigDrop:2, fastDrop:2, fastMins:15, buyAmt:200},
           {sym:"BBB", dayDrop:3, levels:[], near:1.5, buyAmt:100}]}));
}, [liveCfg]);
await page.clock.install({time: simNow});
const advance = async (ms, step = 5000) => { for (let t = 0; t < ms; t += step) { simNow += step; await page.clock.runFor(step); await page.waitForTimeout(40); } };
const shot = async name => { if (!SHOTS) return;
  // grow the window to the page's full height for the picture, then put it back
  const h = await page.evaluate(() => Math.max(...[document.documentElement, ...document.querySelectorAll("main, #app, .scroll, body")].map(e => e.scrollHeight)));
  await page.setViewportSize({width:420, height:Math.min(Math.max(900, h + 40), 4000)}); await page.waitForTimeout(150);
  await page.screenshot({path: path.join(SHOTS, name + ".png")});
  await page.setViewportSize({width:420, height:900}); };

console.log("MW Beta browser harness");
await page.goto(BASE);
await advance(20000, 1000);
await advance(120000);
check(await page.locator("#pf-body .hero .val").innerText().then(t => /\$/.test(t)), "portfolio total renders");
check(await page.locator("#mk-body .tile").count() >= 10, "market tiles render");
check(await page.locator("#wl-body .wrow").count() === 2, "watchlist renders 2 rows");
check(/MW Beta/.test(await page.title()), "title says MW Beta");
check(await page.locator(".riskx .rk-h").count() === 1 && /measured from price history/.test(await page.locator(".riskx").innerText()), "risk block measured from price history");
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

// a monitoring tool: no scorecard, rule lab or buy planner anywhere
check(await page.evaluate(() => !document.querySelector('[data-open=journal],[data-open=lab],[data-tab=journal],[data-tab=lab],.lad')), "no Scorecard, Rule lab or buy ladder");
check(!/planned buy|next buy|buy level|scorecard|auto level/i.test(await page.locator("main").innerText()), "no buy-planning text on the main screen");
check(!/planned buy|buy per level|auto levels|size buys/i.test(await page.evaluate(() => { openSheet("alerts"); const t = document.getElementById("shBody").innerText; closeSheet(); return t; })), "no buy-planning options in Settings → Watchlist");
// markets: indexes, other markets and your list share one grid; the sector heatmap has its own refresh
check(await page.locator("#mk-body .idx .c").count() === 8 && !/Other markets|My list/.test(await page.locator("#mk-body").innerText()), "markets combined into one grid (indexes and other markets)");
const xleBefore = quoteCalls.XLE || 0;
await page.locator("#mk-body [data-act=secref]").click(); await advance(70000, 2000);   // waits its turn under the free 60-a-minute limit
check((quoteCalls.XLE || 0) > xleBefore && await page.evaluate(() => logBuf.some(l => /Sectors refreshed: 14 of 14/.test(l))), "the sector ↻ refreshes all 14 sector tiles");
// portfolio: every change figure in a red or green box
check(await page.locator("#pf-body .hero .chg .cbox").count() === 1 && await page.locator("#pf-body .grp-h .cbox").count() >= 2, "portfolio totals use the same red/green boxes as the rows");
// watchlist: add and remove from the main screen, with undo
await page.locator("#wAddSym").fill("ccc"); await page.keyboard.press("Enter"); await advance(3000, 500);
check(await page.locator("#wl-body .wrow").count() === 3 && await page.evaluate(() => cfg.watch.some(w => w.sym === "CCC")), "a ticker added from the main screen joins the watchlist");
check(await page.evaluate(() => { renderAll(); renderAll(); return document.activeElement && document.activeElement.id === "wAddSym" && !document.activeElement.value; }), "the add box stays ready for the next ticker, even through a refresh");
await page.locator("#wAddSym").fill("AAA"); await page.keyboard.press("Enter"); await advance(1000, 500);
check(await page.locator("#wl-body .wrow").count() === 3, "adding a ticker that's already there changes nothing");
const openW = async sym => { if (!(await page.locator(`#wl-body [data-wrm="${sym}"]`).count())) { await page.locator(`#wl-body [data-row="w:${sym}"] .s`).click(); await advance(500, 250); } };
check(await page.locator("#wl-body .wrow [data-wrm], #wl-body .wrow [data-ref]").count() === 0, "a closed watchlist row carries no buttons, only information");
await openW("CCC");
await page.locator('#wl-body [data-wrm="CCC"]').click(); await advance(1000, 500);
check(await page.locator("#wl-body .wrow").count() === 2 && await page.locator("#wl-body .wundo").count() === 1, "Remove (in the open row) takes a ticker off and offers Undo");
await page.locator("#wl-body [data-wundo]").click(); await advance(1000, 500);
check(await page.locator("#wl-body .wrow").count() === 3, "Undo puts it back");
await openW("CCC");
await page.locator('#wl-body [data-wrm="CCC"]').click(); await advance(14000, 1000);
check(await page.locator("#wl-body .wundo").count() === 0 && await page.locator("#wl-body .wrow").count() === 2, "the Undo note goes away by itself");
await page.locator("#wAddSym").blur(); await page.keyboard.press("/"); await advance(500, 250);
check(await page.evaluate(() => document.activeElement && document.activeElement.id === "wAddSym"), "/ jumps to the add box");
await page.locator("#wAddSym").blur();
await shot("5-monitor");

// a sharp drop in AAA: red day, unusual drop, off today's high, near the $90 level
const pc = pcOf("AAA"); px.AAA = +(pc * 0.91).toFixed(2);
note(`AAA drops from ${pc} to ${px.AAA}`);
await page.evaluate(lv => { const c = JSON.parse(localStorage.getItem("mwlab_cfg")); c.watch[0].levels = lv; localStorage.setItem("mwlab_cfg", JSON.stringify(c)); }, [Math.round(pc * 0.905), Math.round(pc * 0.8)]);
await page.reload(); await advance(15000, 1000); await advance(60000);
const log = await page.locator("#log-body").innerText();
check(/AAA/.test(log), "the drop is in today's alerts");
check(sent.ntfy.length > 0, "a phone alert went out");
check(sent.ntfy.every(b => !/AAA|BBB|\$|\d{2,}/.test(b)), "phone alerts carry no tickers or prices");
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
for (const tab of ["general","holdings","alerts","funds","markets","layout","backup","diag"]) {
  await page.evaluate(t => openSheet(t), tab);
  await advance(2000, 500);
  if (tab === "alerts" || tab === "backup") await shot("tab-" + tab);
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
check(await p2.locator("#bLeave").evaluate(b => !b.hidden && getComputedStyle(b).display !== "none"), "the beta's ⋯ menu has Switch back to regular MW too");
await p2.evaluate(() => { cfg.watch.push({sym:"YYY", levels:[], dayDrop:3, near:0}); saveCfg(); });   // a change made in the beta only
p2.once("dialog", d => d.accept());
await p2.locator("#sChannel").click(); await p2.waitForURL(u => !/\/lab\//.test(String(u))); await p2.waitForTimeout(800);
check(!/\/lab\//.test(p2.url()) && await ls("mw_channel") === "stable", "Switch back returns to regular MW and stays there");
check(await ls("mw_cfg") === liveBefore, "the regular setup is unchanged after the round trip");
// joining again: by now the beta has an older setup of its own, and the regular MW's is the one in use, so that one comes over,
// with the keys the first copy never knew about. The beta's earlier setup stays in its history.
await p2.evaluate(() => { cfg.watch.push({sym:"ZZZ", levels:[], dayDrop:3, near:0}); saveCfg();
  Object.assign(settings, {alpKey:"test-key-id", alpSec:"test-secret", cvd:true, tdKey:""}); saveSettings(); });
const liveNow = await ls("mw_cfg");
await p2.evaluate(() => openSheet("general"));
await p2.locator("#sBeta").click(); await p2.waitForURL(/\/lab\//); await p2.waitForTimeout(1500);
const again = await p2.evaluate(() => { const g = k => JSON.parse(localStorage.getItem("mwlab_" + k) || "null"), c = g("cfg"), s = g("settings"), has = (x, sym) => x.watch.some(w => w.sym === sym);
  return {zzz: has(c, "ZZZ"), yyy: has(c, "YYY"), alp: s.alpKey === "test-key-id" && s.alpSec === "test-secret", td: s.tdKey, cvd: s.cvd === true && document.documentElement.dataset.cvd === "1",
    hist: (g("cfgHist") || []).map(x => x.why + (has(JSON.parse(x.cfg), "YYY") ? " (YYY)" : "")), toast: document.getElementById("toast").textContent, card: document.getElementById("whatsnew").classList.contains("show")}; });
check(again.zzz && !again.yyy && liveNow !== liveBefore, "joining the beta again brings over the regular setup as it is now");
check(again.alp && again.cvd, "with the fast-price keys and the color setting");
check(again.td === "test", "an empty key box in MW does not wipe a key the beta has");
check(again.hist[0] === "copied from MW" && again.hist.slice(1).some(x => / \(YYY\)$/.test(x)), "the beta's earlier setup, with the change made there, is kept in its history (" + again.hist.join(" < ") + ")");
check(again.toast === "Copied your current setup from MW" && again.card, "it says so, and shows what is new (" + again.toast + ")");
check(await ls("mw_cfg") === liveNow, "and the regular setup is still untouched");
// a beta that never confirms it started: MW must fall back to the regular version
await p2.evaluate(() => { localStorage.setItem("mw_channel", "beta"); localStorage.setItem("mw_betaTry", String(Date.now())); localStorage.setItem("mw_betaOk", "0"); });
await p2.goto(LIVE); await p2.waitForTimeout(800);
check(!/\/lab\//.test(p2.url()), "if the beta didn't start last time, MW opens the regular version");
await p2.evaluate(() => openSheet("general"));
check(/Try the beta again/.test(await p2.locator("#sBeta").innerText()), "and offers to try the beta again");
await p2.goto(LIVE + "?stable"); await p2.waitForTimeout(500);
check(await ls("mw_channel") === "stable", "?stable turns the beta off");
check(errs2.length === 0, "no page errors in the beta switch" + (errs2.length ? ": " + errs2.slice(0, 4).join(" | ") : ""));

/* ---------- MW 4: someone who was using the beta lands on the regular MW with the beta's setup ---------- */
console.log("Beta becomes the regular MW");
const ctx3 = await browser.newContext({viewport:{width:420, height:900}, timezoneId:"America/Chicago"});
const p3 = await ctx3.newPage(); await mock(p3);
const errs3 = []; p3.on("pageerror", e => errs3.push(e.message));
const betaCfg = JSON.parse(JSON.stringify(liveCfg)); betaCfg.watch = (betaCfg.watch || []).concat([{sym:"ZZB", levels:[], dayDrop:3, offHigh:10}]);
await p3.addInitScript(([live, beta]) => {
  if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1");
  localStorage.clear(); localStorage.setItem("mw_cfg", JSON.stringify(live)); localStorage.setItem("mw_settings", JSON.stringify({key:"old", tdKey:"old"}));
  localStorage.setItem("mwlab_cfg", JSON.stringify(beta)); localStorage.setItem("mwlab_settings", JSON.stringify({key:"test", tdKey:"test", compact:false}));
  localStorage.setItem("mw_channel", "beta"); localStorage.setItem("mw_betaOk", String(Date.now()));
}, [liveCfg, betaCfg]);
await p3.goto(LIVE + "lab/"); await p3.waitForURL(u => !/\/lab\//.test(String(u))); await p3.waitForTimeout(1500);
const ls3 = k => p3.evaluate(k => localStorage.getItem(k), k);
check(!/\/lab\//.test(p3.url()), "an open beta page goes back to MW once so the setup can move");
check(await ls3("mw_channel") === "stable" && await ls3("mw_v4") === "1", "MW stops opening the beta after the move");
check(JSON.parse(await ls3("mw_cfg")).watch.some(w => w.sym === "ZZB"), "MW now has the beta's setup");
check(JSON.parse(await ls3("mw_settings")).key === "test", "and the beta's keys and settings");
check(JSON.parse(await ls3("mw_pre4_cfg") || "{}").watch !== undefined, "the old regular setup is kept as a backup");
check(await p3.title() === "MW" || /MW/.test(await p3.title()), "the page is called MW");
check(!(await p3.locator("#titlebar .labtag").count()), "no BETA tag in the title bar");
await p3.evaluate(() => openSheet("general"));
check(/Try the beta/.test(await p3.locator("#sBeta").innerText()) && !(await p3.locator("#sChannel").count()), "Settings offers Try the beta, not Switch back");
check(await p3.locator("#bLeave").evaluate(b => getComputedStyle(b).display === "none"), "the regular MW's menu has no Switch back");
await p3.goto(LIVE); await p3.waitForTimeout(800);
check(!/\/lab\//.test(p3.url()), "and MW keeps opening itself after that");
check(errs3.length === 0, "no page errors in the move" + (errs3.length ? ": " + errs3.slice(0, 4).join(" | ") : ""));

/* ---------- 4.4: fast prices from Alpaca (made-up keys and prices), Ctrl+K, keyboard rows, pasted lists ---------- */
console.log("Fast prices and quality of life (4.4)");
{
  const ctx3 = await browser.newContext({viewport:{width:420, height:900}, timezoneId:"America/Chicago"});
  const p3 = await ctx3.newPage(); await mock(p3);
  const errs3 = []; p3.on("pageerror", e => errs3.push(e.message));
  p3.on("console", m => { if (m.type() === "error" && !/Failed to load resource|sentry/i.test(m.text())) errs3.push("console: " + m.text()); });
  let t3 = Date.parse("2026-11-05T15:30:00Z"), alpDeny = false, alpTradeAt = null; const alpPx = {}, alpCalls = [];
  await p3.route(/https:\/\/data\.alpaca\.markets\/.*/, route => {
    const r = route.request(), u = new URL(r.url()), h = r.headers();
    alpCalls.push({t:t3, id:h["apca-api-key-id"], sec:h["apca-api-secret-key"], feed:u.searchParams.get("feed")});
    if (alpDeny) return route.fulfill({status:403, json:{message:"forbidden"}});
    const day = new Date(t3).toISOString().slice(0, 10), out = {};
    (u.searchParams.get("symbols") || "").split(",").forEach(s => { const c = alpPx[s] ?? +(priceOf(s) * 1.002).toFixed(2), pc = pcOf(s);
      out[s] = {latestTrade:{t:new Date(alpTradeAt || t3 - 1500).toISOString(), p:c, s:100}, dailyBar:{t:day + "T04:00:00Z", o:pc, h:Math.max(pc, c), l:Math.min(pc, c), c, v:1e5}, prevDailyBar:{t:"2026-11-04T04:00:00Z", o:pc, h:pc, l:pc, c:pc, v:1e5}}; });
    return route.fulfill({json:out});
  });
  await p3.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1"); localStorage.clear();
    localStorage.setItem("mwlab_settings", JSON.stringify({key:"test", alpKey:"test-key-id", alpSec:"test-secret", refresh:60})); localStorage.setItem("mwlab_seenVer", JSON.stringify("99.0.0"));
    localStorage.setItem("mwlab_cfg", JSON.stringify({holdings:[{sym:"AAA", shares:10, acct:"Taxable"}], fixed:[], watch:[{sym:"AAA", levels:[90, 80], dayDrop:3, near:1.5}, {sym:"BBB", levels:[], dayDrop:3}, {sym:"CCC", levels:[], dayDrop:3}]}));
  });
  await p3.clock.install({time:t3});
  const adv = async (ms, step = 1000) => { for (let t = 0; t < ms; t += step) { t3 += step; simNow = t3; await p3.clock.runFor(step); await p3.waitForTimeout(25); } };
  simNow = t3; Object.keys(px).forEach(k => delete px[k]);   // a clean synthetic market for this part
  await p3.goto(BASE); await adv(20000);
  check(await p3.evaluate(() => quotes.AAA && quotes.AAA.src === "alpaca"), "fast prices: Alpaca's price is used during the session");
  check(alpCalls.length > 0 && alpCalls.every(c => c.id === "test-key-id" && c.sec === "test-secret" && c.feed === "iex"), "the keys go in Alpaca's headers, on the free IEX feed");
  const n0 = alpCalls.length; await adv(30000);
  check(alpCalls.length - n0 >= 4 && alpCalls.length - n0 <= 7, `about one Alpaca call every 5 seconds while open (${alpCalls.length - n0} in 30 s)`);
  alpPx.BBB = +(priceOf("BBB") * 0.99).toFixed(2);
  const flashed = async () => p3.evaluate(px => { const el = document.querySelector('#wl-body [data-row="w:BBB"] [data-fx]'); return !!el && el.textContent.includes(px.toFixed(2)) && el.classList.contains("fx-dn"); }, alpPx.BBB);
  let fl = false, waited = 0; while (!fl && waited < 8000) { await adv(500, 500); waited += 500; fl = await flashed(); }
  check(fl && waited <= 6000, `a new price shows within about 5 seconds and flashes red when it fell (${waited / 1000} s)`);
  check(await p3.locator('#wl-body [data-row="w:AAA"] .bell').innerText().then(t => t.trim() === "3").catch(() => false), "the bell on a row counts its armed alerts (2 price alerts + red day)");
  check(await p3.locator("#mk-body .macro").count() === 1 && /Jobs|CPI|Fed|PPI|GDP/i.test(await p3.locator("#mk-body .macro").innerText()), "the next Fed or inflation date shows under Markets");
  // Ctrl+K: find a ticker and open its row
  await p3.keyboard.press("Control+k"); await adv(300, 100);
  check(await p3.locator("#pal:not(.hide)").count() === 1, "Ctrl+K opens the finder");
  await p3.keyboard.type("bb"); await adv(200, 100);
  check(/^BBB/.test(await p3.locator("#palList .pi.on").innerText()), "typing finds the ticker first");
  if (SHOTS) await p3.screenshot({path:path.join(SHOTS, "7-finder.png")});
  await p3.keyboard.press("Enter"); await adv(1500, 250);
  check(await p3.evaluate(() => document.getElementById("pal").classList.contains("hide") && openRows.has("w:BBB") && document.activeElement && document.activeElement.dataset.row === "w:BBB"), "Enter opens that ticker's row and focuses it");
  await p3.keyboard.press("Control+k"); await p3.keyboard.type("zzzq"); await adv(200, 100);
  check(/Add ZZZQ to the watchlist/.test(await p3.locator("#palList").innerText()), "an unknown ticker offers Add to the watchlist");
  await p3.keyboard.press("Escape"); await adv(200, 100);
  check(await p3.locator("#pal.hide").count() === 1, "Esc closes the finder");
  // keyboard rows
  await p3.evaluate(() => document.querySelector('[data-row="w:AAA"]').focus());
  await p3.keyboard.press("ArrowDown"); await adv(100, 100);
  check(await p3.evaluate(() => document.activeElement.dataset.row === "w:BBB"), "↓ moves to the next row");
  await p3.keyboard.press("Alt+ArrowUp"); await adv(300, 100);
  check(await p3.evaluate(() => cfg.watch[0].sym === "BBB" && document.activeElement.dataset.row === "w:BBB"), "Alt+↑ moves the watchlist row up and keeps the focus");
  await p3.keyboard.press("Delete"); await adv(300, 100);
  check(await p3.evaluate(() => !cfg.watch.some(w => w.sym === "BBB") && document.querySelectorAll("#wl-body .wundo").length === 1), "Delete takes the row off, with Undo");
  await p3.locator("#wl-body [data-wundo]").click(); await adv(500, 100);
  check(await p3.evaluate(() => cfg.watch.some(w => w.sym === "BBB")), "Undo brings it back");
  // pasting a list
  await p3.evaluate(() => openSheet("alerts"));
  await p3.locator("#aBulk").fill("NASDAQ:ABCD, aaa zz9! $EFG"); await adv(200, 100);
  check(/Adds 2:.*ABCD, EFG/.test(await p3.locator("#aBulkRes").innerText()) && /already on it: AAA/.test(await p3.locator("#aBulkRes").innerText()) && /zz9!/.test(await p3.locator("#aBulkRes").innerText()), "a pasted list previews what it adds, what's already there and what it skips");
  await p3.locator("#aBulkAdd").click(); await adv(1500, 250);
  check(await p3.evaluate(() => ["ABCD","EFG"].every(s => cfg.watch.some(w => w.sym === s && w.dayDrop === 3))), "Add puts the new tickers on with the default rules");
  await p3.evaluate(() => closeSheet());
  // colour-blind friendly colors
  const up0 = await p3.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--up").trim());
  await p3.evaluate(() => { settings.cvd = true; applyCvd(); });
  const up1 = await p3.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--up").trim());
  check(up0 !== up1 && /4da3ff|0b62c4/i.test(up1), "the color-blind option turns up blue");
  await p3.evaluate(() => { settings.cvd = false; applyCvd(); });
  // market brief: no holdings unless asked
  const brief = await p3.evaluate(() => [briefText(false), briefText(true)]);
  check(/Watchlist: /.test(brief[0]) && !/Portfolio/.test(brief[0]) && /Portfolio: \$/.test(brief[1]), "the market brief leaves holdings out unless asked");
  await p3.locator("#mkt").click(); await adv(500, 100);
  check(/Fast prices\s*Alpaca IEX/.test(await p3.locator("#statusPop").innerText()), "the status pop-up shows fast prices working");
  await p3.locator("#mkt").click();
  // after hours: the latest trade is the price shown, every 5 seconds while on screen (4.8)
  t3 = Date.parse("2026-11-05T21:40:00Z"); simNow = t3; await p3.clock.fastForward(Date.parse("2026-11-05T21:40:00Z") - (await p3.evaluate(() => Date.now())));
  alpPx.AAA = +(priceOf("AAA") * 1.03).toFixed(2); const n1 = alpCalls.length; await adv(46000);
  check(alpCalls.length - n1 >= 7 && alpCalls.length - n1 <= 11, `after hours, about one call every 5 seconds (${alpCalls.length - n1} in 46 s)`);
  check(/AH .*\+/.test(await p3.locator('#wl-body [data-row="w:AAA"] .chip.ext').innerText().catch(() => "")), "an after-hours price shows on the row as AH");
  const rowPx = async () => p3.locator('#wl-body [data-row="w:AAA"] [data-fx="AAA"]').first().innerText().catch(() => "");
  check((await rowPx()).includes(alpPx.AAA.toFixed(2)), `the row's price is the after-hours trade (${await rowPx()})`);
  check((await p3.locator('#mk-body [data-tile="AAA"] em, #pf-body [data-fx="AAA"]').allInnerTexts()).some(t => t.includes(alpPx.AAA.toFixed(2))), "the portfolio row shows the after-hours price too");
  if (SHOTS) await p3.screenshot({path:path.join(SHOTS, "6-after-hours.png"), fullPage:true});
  check(/After hours/.test(await p3.locator("#pf-body .hero small.ah").innerText().catch(() => "")), "the portfolio total shows its after-hours move");
  // the weekend: Friday's last after-hours trade stays the price; Monday's pre-market takes over at 4 AM
  const friAH = Date.parse("2026-11-07T00:59:00Z");   // Friday 7:59 PM New York
  alpTradeAt = friAH; alpPx.AAA = +(priceOf("AAA") * 1.007).toFixed(2);
  await p3.evaluate(() => { Object.keys(quotes).forEach(s => { quotes[s].t = Math.floor(Date.parse("2026-11-06T21:00:00Z") / 1000); }); extq = {}; });
  const nW = alpCalls.length;
  t3 = Date.parse("2026-11-08T19:10:00Z"); simNow = t3; await p3.clock.fastForward(t3 - (await p3.evaluate(() => Date.now())));
  await adv(75000, 2500);
  check(alpCalls.length - nW >= 1 && alpCalls.length - nW <= 2, `on Sunday, one check (not every 5 seconds) brings Friday's last trade (${alpCalls.length - nW} in 75 s)`);
  check((await rowPx()).includes(alpPx.AAA.toFixed(2)) && /AH/.test(await p3.locator('#wl-body [data-row="w:AAA"] .chip.ext').innerText().catch(() => "")), `on Sunday the row shows Friday's after-hours price, marked AH (${await rowPx()})`);
  check(/Fri/.test(await p3.locator('#wl-body [data-row="w:AAA"] .chip.ext').getAttribute("title").catch(() => "")), "its tooltip says it's Friday's trade");
  await p3.reload(); await adv(8000, 500);
  check((await rowPx()).includes(alpPx.AAA.toFixed(2)), "and still after MW restarts");
  t3 = Date.parse("2026-11-09T09:00:30Z"); simNow = t3; await p3.clock.fastForward(t3 - (await p3.evaluate(() => Date.now())));
  alpTradeAt = Date.parse("2026-11-09T09:00:20Z"); alpPx.AAA = +(priceOf("AAA") * 1.012).toFixed(2); const nP = alpCalls.length; await adv(20000);
  check(alpCalls.length - nP >= 3 && /Pre/.test(await p3.locator('#wl-body [data-row="w:AAA"] .chip.ext').innerText().catch(() => "")) && (await rowPx()).includes(alpPx.AAA.toFixed(2)), `at 4 AM Monday the pre-market price takes over, every 5 seconds (${await rowPx()}, ${alpCalls.length - nP} calls in 20 s)`);
  if (SHOTS) await p3.screenshot({path:path.join(SHOTS, "6b-pre-market.png"), fullPage:true});
  alpTradeAt = null;
  // rejected keys: pause, say so, no errors
  alpDeny = true; await p3.evaluate(() => { alpSt.pauseUntil = 0; }); await adv(20000);
  check(await p3.evaluate(() => /didn't accept/.test(alpSt.err) && alpSt.pauseUntil > Date.now() + 5*60e3), "rejected Alpaca keys pause fast prices and say why");
  check(errs3.length === 0, "no page errors with fast prices" + (errs3.length ? ":\n    " + errs3.slice(0, 6).join("\n    ") : ""));
  await ctx3.close();
}

/* ---------- 4.5: earnings panel, chart window, price alert repeat and expiry (made-up tickers, dates and numbers) ---------- */
console.log("Earnings, charts and alert repeat (4.5)");
{
  const ctx4 = await browser.newContext({viewport:{width:420, height:900}, timezoneId:"America/Chicago"});
  const p4 = await ctx4.newPage(); await mock(p4);
  const errs4 = []; p4.on("pageerror", e => errs4.push(e.message));
  p4.on("console", m => { if (m.type() === "error" && !/Failed to load resource|sentry/i.test(m.text())) errs4.push("console: " + m.text()); });
  let t4 = Date.parse("2026-11-05T15:30:00Z");
  await p4.route(/https:\/\/finnhub\.io\/api\/v1\/(calendar\/earnings|stock\/earnings).*/, route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("calendar/earnings")) return route.fulfill({json:{earningsCalendar:[{symbol:"AAA", date:"2026-11-10", hour:"amc", epsEstimate:1.23, revenueEstimate:4.5e9}, {symbol:"BBB", date:"2026-11-12", hour:"bmo", epsEstimate:0.5, revenueEstimate:9e8}]}});
    return route.fulfill({json:[{period:"2026-09-30", actual:1.3, estimate:1.2, surprisePercent:8.3}, {period:"2026-06-30", actual:1.1, estimate:1.15, surprisePercent:-4.3}, {period:"2026-03-31", actual:1, estimate:0.9, surprisePercent:11.1}, {period:"2025-12-31", actual:0.9, estimate:0.85, surprisePercent:5.9}]});
  });
  await p4.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1"); localStorage.clear();
    localStorage.setItem("mwlab_settings", JSON.stringify({key:"test", tdKey:"test", refresh:60})); localStorage.setItem("mwlab_seenVer", JSON.stringify("99.0.0"));
    localStorage.setItem("mwlab_cfg", JSON.stringify({holdings:[], fixed:[], watch:[{sym:"AAA", levels:[], dayDrop:30, near:0}, {sym:"BBB", levels:[], dayDrop:30, near:0}, {sym:"CCC", levels:[], dayDrop:30, near:0}]}));
  });
  await p4.clock.install({time:t4});
  const adv = async (ms, step = 1000) => { for (let t = 0; t < ms; t += step) { t4 += step; simNow = t4; await p4.clock.runFor(step); await p4.waitForTimeout(25); } };
  simNow = t4; Object.keys(px).forEach(k => delete px[k]);
  await p4.goto(BASE); await adv(30000); await adv(150000, 5000);
  const er = await p4.locator("#mk-body .erp").innerText().catch(() => "");
  check(/AAA/.test(er) && /Tue 11\/10 · after the close/.test(er) && /EPS est \$1\.23/.test(er) && /beat by 8\.3%/.test(er), "the earnings panel lists the report with its estimates and last surprise");
  check(/±\d/.test(await p4.locator('#mk-body .erw:has-text("AAA") .mv').innerText().catch(() => "")), "and the typical report-day move from price history");
  // open rows: one at a time, tabs, a Close button and Esc
  await p4.locator('#wl-body [data-row="w:BBB"]').click(); await adv(500, 250);
  await p4.locator('#wl-body [data-row="w:CCC"] .s').click(); await adv(500, 250);
  check(await p4.evaluate(() => [...openRows].filter(k => k.startsWith("w:")).join() === "w:CCC" && document.querySelectorAll("#wl-body .wdet").length === 1), "opening a row closes the one that was open");
  await p4.locator('#wl-body [data-wtab="trend"]').click(); await adv(300, 100);
  check(/50-day average/.test(await p4.locator("#wl-body .wpane").innerText()) && await p4.evaluate(() => settings.wdTab === "trend"), "detail tabs switch, and the choice sticks");
  if (SHOTS) await p4.screenshot({path:path.join(SHOTS, "10-row-open.png")});
  await p4.locator('#wl-body [data-wclose="CCC"]').click(); await adv(300, 100);
  check(await p4.evaluate(() => !openRows.has("w:CCC") && document.activeElement && document.activeElement.dataset.row === "w:CCC"), "Close shuts the details and keeps your place");
  await p4.keyboard.press("Enter"); await adv(300, 100); await p4.keyboard.press("Escape"); await adv(300, 100);
  check(await p4.evaluate(() => !openRows.has("w:CCC")), "Esc closes an open row");
  await p4.evaluate(() => { settings.wdTab = "today"; });
  // chart window from a row's details
  await p4.locator('#wl-body [data-row="w:AAA"]').click(); await adv(1000, 250);
  await p4.locator('#wl-body [data-chart="AAA"]').click(); await adv(3000, 250);
  check(await p4.locator("#chart:not(.hide) #chBox canvas").count() > 0, "Chart opens a candle chart");
  check(await p4.evaluate(() => chSeries && chSeries.data().length >= 120 && chSeries.data().length <= 128), "6M shows about six months of daily candles");
  check(await p4.locator("#chLeg [data-ov=ma50].on").count() === 1 && /50-day avg/.test(await p4.locator("#chLeg").innerText()), "the legend lists the overlays");
  if (SHOTS) await p4.screenshot({path:path.join(SHOTS, "8-chart.png")});
  await p4.locator('#chRange [data-r="1Y"]').click(); await adv(500, 250);
  check(await p4.evaluate(() => chSeries.data().length >= 240), "1Y shows a year of candles");
  await p4.locator('#chRange [data-r="1D"]').click(); await adv(2000, 250);
  check(/5-minute|Loading|Couldn't/.test(await p4.locator("#chNote").innerText()), "1D asks for today's 5-minute bars");
  await p4.evaluate(() => setChartRange("6M"));
  await p4.keyboard.press("Escape"); await adv(300, 100);
  check(await p4.locator("#chart.hide").count() === 1, "Esc closes the chart");
  // price alert: once, then remove
  const pcA = pcOf("AAA");
  await p4.evaluate(L => { const w = cfg.watch.find(x => x.sym === "AAA"); w.levels = [L]; w.lvRepeat = "once"; saveCfg(); }, Math.round(pcA * 0.95));
  px.AAA = +(pcA * 0.94).toFixed(2); await adv(75000, 5000);
  check(await p4.evaluate(() => /AAA reached/.test(firedToday().log.map(l => l.msg).join("|")) && cfg.watch.find(x => x.sym === "AAA").levels.length === 0), "a once-only price alert fires, then comes off the list");
  // expired price alerts stay quiet and say so
  await p4.evaluate(L => { const w = cfg.watch.find(x => x.sym === "BBB"); w.levels = [L]; w.lvUntil = "2026-11-04"; saveCfg(); renderAll(); }, Math.round(pcOf("BBB") * 1.05));
  await adv(65000, 5000);
  check(await p4.evaluate(() => !/BBB reached/.test(firedToday().log.map(l => l.msg).join("|"))) && /alerts ended/.test(await p4.locator('#wl-body [data-row="w:BBB"]').innerText()), "price alerts past their end date stay quiet and the row says so");
  // the Settings rule card has the repeat and end-date fields
  await p4.evaluate(() => openSheet("alerts"));
  check(await p4.locator('#aList [data-s="lvRepeat"]').count() === 3 && await p4.locator('#aList [data-s="lvUntil"]').count() === 3, "Settings → Watchlist has repeat and end-date fields");
  await p4.locator('#aList .rule[data-i="2"] [data-s="lvRepeat"]').selectOption("cross"); await adv(300, 100);
  check(await p4.evaluate(() => cfg.watch[2].lvRepeat === "cross"), "choosing every cross saves it");
  await p4.evaluate(() => closeSheet());
  check(errs4.length === 0, "no page errors in 4.5 features" + (errs4.length ? ":\n    " + errs4.slice(0, 6).join("\n    ") : ""));
  await ctx4.close();
}

/* ---------- 4.7: Monitor layout, watchlist sections and sort, headlines (made-up tickers and headlines) ---------- */
console.log("Monitor layout, sections, headlines (4.7)");
{
  const ctx5 = await browser.newContext({viewport:{width:1400, height:900}, timezoneId:"America/Chicago"});
  const p5 = await ctx5.newPage(); await mock(p5);
  const errs5 = []; p5.on("pageerror", e => errs5.push(e.message));
  let t5 = Date.parse("2026-11-05T15:30:00Z");
  await p5.route(/https:\/\/finnhub\.io\/api\/v1\/company-news.*/, route => { const sym = new URL(route.request().url()).searchParams.get("symbol");
    return route.fulfill({json:[{headline:`${sym} test headline one`, source:"Testwire", url:`https://example.com/${sym}/1`, datetime:Math.floor(t5 / 1000) - 600}, {headline:`${sym} test headline two`, source:"Testwire", url:`https://example.com/${sym}/2`, datetime:Math.floor(t5 / 1000) - 7200}]}); });
  await p5.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1"); localStorage.clear();
    localStorage.setItem("mwlab_settings", JSON.stringify({key:"test", refresh:60})); localStorage.setItem("mwlab_seenVer", JSON.stringify("99.0.0"));
    localStorage.setItem("mwlab_cfg", JSON.stringify({holdings:[{sym:"AAA", shares:1, acct:"Taxable"}], fixed:[], watch:[{sym:"AAA", grp:"Alpha"}, {sym:"BBB"}, {sym:"CCC", grp:"Alpha"}, {sym:"DDD"}]}));
  });
  await p5.clock.install({time:t5});
  const adv = async (ms, step = 1000) => { for (let t = 0; t < ms; t += step) { t5 += step; simNow = t5; await p5.clock.runFor(step); await p5.waitForTimeout(25); } };
  simNow = t5; Object.keys(px).forEach(k => delete px[k]); px.BBB = +(pcOf("BBB") * 0.95).toFixed(2); px.DDD = +(pcOf("DDD") * 0.98).toFixed(2);
  await p5.goto(BASE); await adv(30000); await adv(60000, 5000);
  check(await p5.evaluate(() => { const L = [...document.querySelectorAll("#cols .sec:not(.hide)")].map(s => Math.round(s.getBoundingClientRect().left)); return document.body.classList.contains("wide") && new Set(L).size >= 2; }), "a wide window lays the sections out side by side");
  check(JSON.stringify(await p5.locator("#wl-body .wgrp").allInnerTexts().then(a => a.map(t => t.replace(/\s+/g, " ").trim()))) === JSON.stringify(["ALPHA 2", "OTHER 2"]) || JSON.stringify(await p5.locator("#wl-body .wgrp").allInnerTexts()).includes("Alpha"), "watchlist sections group the tickers");
  check(JSON.stringify(await p5.locator("#wl-body .wrow .tk").allInnerTexts()) === JSON.stringify(["AAA","CCC","BBB","DDD"]), "rows sit under their section, in your order");
  await p5.locator('#wl-body [data-wsort="day"]').click(); await adv(300, 100);
  check(JSON.stringify(await p5.locator("#wl-body .wrow .tk").allInnerTexts()) === JSON.stringify(["AAA","CCC","BBB","DDD"].length ? await p5.evaluate(() => { const by = s => quotes[s].dp; const a = ["AAA","CCC"].sort((x, y) => by(x) - by(y)), b = ["BBB","DDD"].sort((x, y) => by(x) - by(y)); return [...a, ...b]; }) : []), "Biggest drop sorts within each section");
  check(await p5.evaluate(() => cfg.watch.map(w => w.sym).join() === "AAA,BBB,CCC,DDD"), "the sort doesn't change your saved order");
  await p5.locator('#wl-body [data-wsort="mine"]').click();
  for (let i = 0; i < 24 && !(await p5.evaluate(() => newsItems().length)); i++) await adv(5000, 1000);   // headlines are low-priority calls
  check(/8 new/.test(await p5.locator("#nw-sum .nw-new").innerText().catch(() => "")) && /test headline one/.test(await p5.locator("#nw-body").innerText()), "the News section shows the newest headlines with an N new count");
  check(await p5.locator("#nw-body .nw").count() === 3 && /Show all 8 headlines/.test(await p5.locator("#nw-body .nw-foot").innerText()), "three headlines to start, with a button for the rest");
  if (SHOTS) await p5.screenshot({path:path.join(SHOTS, "9-monitor.png")});
  await p5.setViewportSize({width:420, height:900}); await adv(1000, 250);
  check(await p5.evaluate(() => !document.body.classList.contains("wide") && !document.getElementById("cols")), "a narrow window goes back to one column");
  check(errs5.length === 0, "no page errors in the Monitor layout" + (errs5.length ? ": " + errs5.slice(0, 4).join(" | ") : ""));
  await ctx5.close();
}

/* ---------- 5.0: dollars per holding, mutual funds, the News section (made-up tickers, funds and headlines) ---------- */
console.log("Dollars, mutual funds, News (5.0)");
{
  const ctx6 = await browser.newContext({viewport:{width:440, height:900}, timezoneId:"America/Chicago"});
  const p6 = await ctx6.newPage(); await mock(p6);
  const errs6 = []; p6.on("pageerror", e => errs6.push(e.message)); p6.on("console", m => { if (m.type() === "error" && !/Failed to load resource|sentry/i.test(m.text())) errs6.push(m.text()); });
  let t6 = Date.parse("2026-11-09T17:05:00Z");   // 12:05 New York time, a Monday
  // two made-up funds: FNDAX moves 0.9x with SPY, FNDBX 1.1x with QQQ. Their prices post a day late, like the free feed.
  const FUNDS = {FNDAX:{like:"SPY", b:0.9, px:20}, FNDBX:{like:"QQQ", b:1.1, px:10}};
  let navDay = "2026-11-06"; const navAsk = {};
  const fundBars = (sym, today) => { const F = FUNDS[sym], pb = dailyBars(F.like, today); let seed = hash(sym), c = F.px; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
    return pb.map((b, i) => { const row = {datetime:b.datetime, open:c.toFixed(4), high:c.toFixed(4), low:c.toFixed(4), close:c.toFixed(4)}; const nx = pb[i + 1]; if (nx) c = c / (1 + F.b * (+b.close / +nx.close - 1) + rnd() * 0.002); return row; }); };
  await p6.route(/https:\/\/api\.twelvedata\.com\/.*/, route => {
    const u = new URL(route.request().url()), sym = u.searchParams.get("symbol"), F = FUNDS[sym];
    if (!F) return route.fallback();
    if (u.pathname === "/time_series") return route.fulfill({json: {values: fundBars(sym, E.etDateOf(simNow))}});
    navAsk[sym] = (navAsk[sym] || 0) + 1;
    const fri = fundBars(sym, "2026-11-09"), late = navDay === "2026-11-09", c = late ? +(F.px * 1.015).toFixed(4) : F.px, pc = late ? F.px : +fri[1].close;
    return route.fulfill({json: {symbol:sym, close:String(c), previous_close:String(pc), datetime:navDay}});
  });
  await p6.route(/https:\/\/finnhub\.io\/api\/v1\/(company-news|news|quote).*/, route => { const u = new URL(route.request().url()), sym = u.searchParams.get("symbol"), now = Math.floor(t6 / 1000);
    if (u.pathname.endsWith("/quote")) return FUNDS[sym] ? (quoteCalls[sym] = (quoteCalls[sym] || 0) + 1, route.fulfill({json:{c:0, d:null, dp:null, h:0, l:0, o:0, pc:0, t:0}})) : route.fallback();
    if (u.pathname.endsWith("/news")) return route.fulfill({json:[{id:900, headline:"Market test headline", summary:"Market summary text.", source:"Testwire", url:"https://example.com/m/1", datetime:now - 300}]});
    return route.fulfill({json:[{id:hash(sym) % 1000, headline:`${sym} test headline one`, summary:`${sym} summary text.`, source:"Testwire", url:`https://example.com/${sym}/1`, datetime:now - 600 - hash(sym) % 600},
      {id:777, headline:"A story about both tickers", summary:"", source:"Testwire", url:"https://example.com/both", datetime:now - 3600},
      {id:hash(sym) % 1000 + 1000, headline:`${sym} older headline`, summary:"", source:"Testwire", url:`https://example.com/${sym}/2`, datetime:now - 30 * 3600}]}); });
  await p6.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1"); localStorage.clear();
    localStorage.setItem("mwlab_settings", JSON.stringify({key:"test", tdKey:"test", refresh:60})); localStorage.setItem("mwlab_seenVer", JSON.stringify("99.0.0"));
    localStorage.setItem("mwlab_cfg", JSON.stringify({holdings:[{sym:"AAA", shares:10, acct:"Taxable"}, {sym:"BBB", shares:4, acct:"Taxable"}, {sym:"CCC", shares:2, acct:"Roth"}, {sym:"FNDBX", shares:50, avg:9, acct:"Roth"}],
      fixed:[{name:"Test fund", sym:"FNDAX", shares:100}, {name:"Cash", value:500}], watch:[{sym:"AAA"}, {sym:"DDD"}]}));
  });
  await p6.clock.install({time:t6});
  const adv = async (ms, step = 1000) => { for (let t = 0; t < ms; t += step) { t6 += step; simNow = t6; await p6.clock.runFor(step); await p6.waitForTimeout(25); } };
  simNow = t6; Object.keys(px).forEach(k => delete px[k]);
  px.AAA = +(pcOf("AAA") * 1.03).toFixed(2); px.BBB = +(pcOf("BBB") * 0.98).toFixed(2); px.CCC = +(pcOf("CCC") * 1.01).toFixed(2); px.SPY = +(pcOf("SPY") * 1.02).toFixed(2); px.QQQ = +(pcOf("QQQ") * 1.03).toFixed(2);
  await p6.goto(BASE); await adv(30000); await adv(9 * 60e3, 5000);   // price history loads at 8 a minute
  // dollars
  const aUsd = (px.AAA - pcOf("AAA")) * 10;
  const rowUsd = await p6.locator('[data-row="h:AAA:Taxable"] .v small').innerText();
  check(rowUsd === "+$" + (Math.abs(aUsd) < 100 ? aUsd.toFixed(2) : Math.round(aUsd).toLocaleString("en-US")), "a holding shows the day's change on the position in dollars, under its value (" + rowUsd + ")");
  check(/^−\$/.test(await p6.locator('[data-row="h:BBB:Taxable"] .v small').innerText()) && await p6.locator('[data-row="h:BBB:Taxable"] .v small.down').count() === 1, "a falling holding shows its dollars in the red");
  check(/\$/.test(await p6.locator('.grp-h[data-grp="Taxable"] .cbox i').innerText()), "account headers show the day in dollars too");
  check(await p6.locator('#pf-body .flow-l [data-jump="h:AAA:Taxable"]').count() === 1 && await p6.locator('#pf-body .flow-l [data-jump="h:BBB:Taxable"]').count() === 1 && /gains\s*\+\$/.test(await p6.locator("#pf-body .flow-h").innerText()) && /losses\s*−\$/.test(await p6.locator("#pf-body .flow-h").innerText()), "the day's-dollars bar names the biggest dollar gain and loss, with the totals");
  await p6.locator('#sortSeg [data-sort="usd"]').click(); await adv(300, 100);
  check(JSON.stringify(await p6.locator('.grp-h[data-grp="Taxable"] + .grp-rows .hrow .tk').allInnerTexts()) === JSON.stringify(["AAA", "BBB"]), "Today $ sorts by dollars");
  await p6.locator('#sortSeg [data-sort="value"]').click();
  // mutual funds between official prices
  const fit = await p6.evaluate(() => fundFit);
  check(fit.FNDAX && fit.FNDAX.sym === "SPY" && Math.abs(fit.FNDAX.beta - 0.9) < 0.08 && fit.FNDBX && fit.FNDBX.sym === "QQQ", "each fund is matched to the ETF it moves with (" + JSON.stringify(fit.FNDAX) + ")");
  const fA = '[data-row="f:FNDAX:"]', fB = '[data-row="f:FNDBX:Roth"]';
  const pill = async sel => (await p6.locator(sel + " .ps .dchg").evaluate(e => [...e.children].map(c => c.textContent).join(" ")).catch(() => ""));
  check(await p6.locator(fA + " .dchg.est").count() === 1 && /^\+\$0\.3\d \+1\.[6-9]\d%$/.test(await pill(fA)) && /^est\. \+\$3\d\.\d\d$/.test(await p6.locator(fA + " .v small.est").innerText()), "a fund without today's price shows an estimate in a dashed box, per share and on the position (" + await pill(fA) + ")");
  check(/est\. since\s*Fri 11\/6/.test(await p6.locator(fA + " .navd").innerText()), "the row says the estimate runs from Friday's price");
  check(/as of 11\/6/.test(await p6.locator('.grp-h[data-grp="__funds"]').innerText()) && await p6.locator('.grp-h[data-grp="__funds"] .cbox.est').count() === 1, "the Mutual funds header says which day the prices are from");
  check(await p6.evaluate(() => { const P = portfolioCalc(), stocks = P.rows.filter(r => !r.fund).reduce((a, r) => a + r.dayUsd, 0); return P.est && P.est.n === 2 && Math.abs(P.dayUsd - stocks) < 0.005; }) && /Funds est\./.test(await p6.locator("#pf-body .hero .chg").innerText()), "estimates are shown apart and never added to the day's total");
  check(await p6.locator(fB).count() === 1 && /\$500/.test(await p6.locator(fB + " .v").innerText()) && (quoteCalls.FNDBX || 0) <= 2, "a fund typed into Holdings is priced as a fund, not asked for a live quote every refresh (" + (quoteCalls.FNDBX || 0) + " asks)");
  await p6.locator(fA + " .s").click(); await adv(500, 100);
  const fdet = await p6.locator(fA + " .wdet").innerText();
  check(/Price \(NAV\)\s*\$20\.00/.test(fdet) && /Priced\s*Fri 11\/6/.test(fdet) && /Moves most like\s*SPY/.test(fdet) && /Est\. since then/.test(fdet), "a fund's details give its price, the day it is from, the estimate and the ETF it follows");
  const asks = navAsk.FNDAX; await p6.locator(fA + " [data-navref]").click(); await adv(3000, 500);
  check(navAsk.FNDAX === asks + 1, "Check price asks for the fund's price right away");
  await p6.locator(fA + " [data-rclose]").click(); await adv(300, 100);
  check(await p6.locator(fA + " .wdet").count() === 0, "Close shuts a fund's details");
  await p6.evaluate(() => { settings.fundEst = false; saveSettings(); renderAll(); });
  check(await p6.locator("#pf-body .dchg.est").count() === 0 && await p6.locator(fA + " .dchg.old").count() === 1, "with estimates off, the last official change shows faded with its day");
  await p6.evaluate(() => { settings.fundEst = true; saveSettings(); renderAll(); });
  if (SHOTS) await p6.screenshot({path:path.join(SHOTS, "10-funds-estimate.png"), fullPage:true});
  // news
  for (let i = 0; i < 12 && (await p6.evaluate(() => newsItems().length)) < 8; i++) await adv(5000, 1000);
  const nws = await p6.evaluate(() => newsItems().map(n => ({h:n.h, syms:n.syms})));
  check(nws.filter(n => n.h === "A story about both tickers").length === 1 && nws.find(n => n.h === "A story about both tickers").syms.length >= 2, "the same story on several tickers is one headline");
  check(JSON.stringify(await p6.locator("#nw-body [data-nwtab]").evaluateAll(els => els.map(e => e.dataset.nwtab))) === JSON.stringify(["all", "mine", "watch", "market"]), "News has tabs for All, Holdings, Watchlist and Market");
  check(await p6.locator("#nw-body .nw").count() === 3 && /Market test headline/.test(await p6.locator("#nw-body .nw").first().innerText()), "the newest three headlines show first, market news included");
  await p6.locator('#nw-body [data-nw="more"]').click(); await adv(300, 100);
  const allN = await p6.locator("#nw-body .nw").count();
  check(allN === nws.length && await p6.locator("#nw-body .nw-day").count() >= 2, "Show all lists every headline under day headings (" + allN + ")");
  const newBefore = await p6.locator("#nw-body .nw.new").count();
  const row = p6.locator("#nw-body .nw", {hasText:"AAA test headline one"});
  await row.locator(".nw-h").click(); await adv(300, 100);
  check(/AAA summary text\./.test(await p6.locator("#nw-body .nw.open .nw-x").innerText()) && await p6.locator('#nw-body .nw.open .nw-x a[href="https://example.com/AAA/1"]').count() === 1, "clicking a headline opens its summary with a link to the article");
  check(await p6.locator("#nw-body .nw.new").count() === newBefore - 1 && newBefore > 0, "an opened headline is no longer new");
  check(await p6.locator('#nw-body .nw.open .nw-go[target="_blank"][rel="noopener"]').count() === 1, "the article link opens in the browser");
  await p6.keyboard.press("Escape"); await adv(300, 100);
  check(await p6.locator("#nw-body .nw.open").count() === 0, "Esc closes the summary");
  await p6.locator('#nw-body .nw-chips [data-nwsym="AAA"]').click(); await adv(300, 100);
  check(await p6.locator("#nw-body .nw").evaluateAll(els => els.length >= 2 && els.every(e => [...e.querySelectorAll(".nw-tk")].some(t => t.textContent.startsWith("AAA")))), "a ticker chip filters the list to that ticker");
  await p6.locator('#nw-body .nw-foot [data-nwsym]').click(); await adv(300, 100);
  await p6.locator('#nw-body [data-nwtab="market"]').click(); await adv(300, 100);
  check(await p6.locator("#nw-body .nw").count() === 1 && /Market/.test(await p6.locator("#nw-body .nw .nw-tk").innerText()), "the Market tab shows only general market news");
  await p6.locator('#nw-body [data-nwtab="all"]').click(); await adv(300, 100);
  await p6.locator('#nw-body [data-nw="read"]').click(); await adv(300, 100);
  check(await p6.locator("#nw-body .nw.new").count() === 0 && await p6.locator("#nw-sum .nw-new").count() === 0 && await p6.locator('#nw-body [data-nw="read"]').isDisabled(), "✓ Read marks everything read");
  await p6.locator('[data-toggle="news"]').click(); await adv(300, 100);
  check(/Market test headline/.test(await p6.locator("#nw-sum .nw-latest").innerText()), "collapsed, the News header shows the newest headline");
  await p6.locator("#wl-sec .sec-h").focus(); await p6.keyboard.press("n"); await adv(500, 100);
  check(await p6.evaluate(() => !document.getElementById("nw-sec").classList.contains("collapsed") && !!document.activeElement.closest("#nw-sec .nw")), "N opens News and puts the keyboard on the first headline");
  await p6.locator('[data-row="h:AAA:Taxable"] .s').click(); await adv(1000, 250);
  await p6.locator('[data-row="h:AAA:Taxable"] [data-htab="news"]').click(); await adv(1500, 250);
  check(await p6.locator('[data-row="h:AAA:Taxable"] .news a').count() >= 2 && await p6.locator('[data-row="h:AAA:Taxable"] .news [data-nwjump="AAA"]').count() === 1, "an open holding's News tab lists its own headlines with a link to all of them");
  await p6.locator('[data-row="h:AAA:Taxable"] [data-htab="position"]').click(); await adv(300, 100);
  await p6.locator('[data-row="h:AAA:Taxable"] .s').click(); await adv(300, 100);
  if (SHOTS) await p6.screenshot({path:path.join(SHOTS, "11-news.png"), fullPage:true});
  // the next morning: Monday's prices have been posted
  navDay = "2026-11-09"; await p6.clock.fastForward(20 * 3600e3); t6 += 20 * 3600e3; simNow = t6;   // 8:05 New York time, Tuesday
  for (let i = 0; i < 40 && (await p6.evaluate(() => (navs.FNDAX || {}).date)) !== "2026-11-09"; i++) await adv(60000, 5000);
  await adv(5000, 1000);
  check(await p6.locator(fA + " .dchg.est").count() === 0 && await p6.locator(fA + " .dchg.old").count() === 0 && await pill(fA) === "+$0.30 +1.50%" && await p6.locator(fA + " .v small").innerText() === "+$30.00", "once the official price is posted it replaces the estimate (" + await pill(fA) + ", " + await p6.locator(fA + " .v small").innerText() + " on the position)");
  check(/priced Mon 11\/9/.test(await p6.locator('.grp-h[data-grp="__funds"]').innerText()), "the header says the funds are priced for Monday");
  check(await p6.evaluate(() => { const P = portfolioCalc(), stocks = P.rows.filter(r => !r.fund).reduce((a, r) => a + r.dayUsd, 0); return !P.est && Math.abs(P.dayUsd - (stocks + 30 + 50 * 10 * 0.015)) < 0.01; }), "official fund changes count in the day's total");
  check(/Gain/.test(await p6.evaluate(() => { openRows.add("f:FNDBX:Roth"); renderPortfolio(); return document.querySelector('[data-row="f:FNDBX:Roth"] .wdet').innerText; })), "a fund in Holdings shows its gain against your cost");
  if (SHOTS) await p6.screenshot({path:path.join(SHOTS, "12-funds-official.png"), fullPage:true});
  check(errs6.length === 0, "no page errors in the 5.0 checks" + (errs6.length ? ": " + [...new Set(errs6)].slice(0, 4).join(" | ") : ""));
  await ctx6.close();
}

/* ---------- 6.0: dollars for one share next to every day's percent, hide amounts, shared tabs, tile details, sticky headers (made-up tickers) ---------- */
console.log("Per-share dollars and the 6.0 screen (6.0)");
{
  const ctx7 = await browser.newContext({viewport:{width:400, height:760}, timezoneId:"America/Chicago"});   // the desktop app's default window
  const p7 = await ctx7.newPage(); await mock(p7);
  const errs7 = []; p7.on("pageerror", e => errs7.push(e.message)); p7.on("console", m => { if (m.type() === "error" && !/Failed to load resource|sentry/i.test(m.text())) errs7.push(m.text()); });
  let t7 = Date.parse("2026-11-09T17:05:00Z");   // 12:05 New York time, a Monday
  await p7.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1"); localStorage.clear();
    // a setup saved by 5.0: it has never seen a "what's new" card, so the 6.0 one is due
    localStorage.setItem("mwlab_settings", JSON.stringify({key:"test", tdKey:"test", refresh:60}));
    localStorage.setItem("mwlab_cfg", JSON.stringify({holdings:[{sym:"AAA", shares:10, avg:100, acct:"Taxable"}, {sym:"BBB", shares:4, acct:"Taxable"}, {sym:"CCC", shares:2, acct:"Roth"}],
      fixed:[{name:"Cash", value:500}], watch:[{sym:"AAA", levels:[], dayDrop:3, near:0}, {sym:"DDD", levels:[], dayDrop:30, near:0}]}));
  });
  await p7.clock.install({time:t7});
  const adv = async (ms, step = 1000) => { for (let t = 0; t < ms; t += step) { t7 += step; simNow = t7; await p7.clock.runFor(step); await p7.waitForTimeout(25); } };
  simNow = t7; Object.keys(px).forEach(k => delete px[k]);
  px.AAA = +(pcOf("AAA") * 1.03).toFixed(2); px.BBB = +(pcOf("BBB") * 0.98).toFixed(2); px.CCC = +(pcOf("CCC") * 1.01).toFixed(2);
  px.SPY = +(pcOf("SPY") * 1.02).toFixed(2); px.QQQ = +(pcOf("QQQ") * 0.99).toFixed(2); px.XLK = +(pcOf("XLK") * 1.012).toFixed(2);
  // how MW writes a change: "+$4.50" and "+3.00%", with a real minus sign
  const sgn = v => v >= 0 ? "+" : "−", usd = v => sgn(v) + "$" + Math.abs(v).toFixed(2), pctS = (v, d = 2) => sgn(v) + Math.abs(v).toFixed(d) + "%";
  const dOf = s => px[s] - pcOf(s), pOf = s => (px[s] / pcOf(s) - 1) * 100, pair = s => usd(dOf(s)) + " " + pctS(pOf(s));
  const pill = async sel => (await p7.locator(sel + " .dchg").first().evaluate(e => [...e.children].map(c => c.textContent).join(" ")).catch(() => ""));
  const hA = '[data-row="h:AAA:Taxable"]', hB = '[data-row="h:BBB:Taxable"]';
  await p7.goto(BASE); await adv(30000);
  // what's new: once, after the update
  const wn = await p7.locator("#whatsnew").innerText();
  check(await p7.locator("#whatsnew.show").count() === 1 && /New in MW Beta 6\.0/.test(wn) && /Dollars for one share/.test(wn), "after the update, one card says what is new in 6.0");
  await p7.locator('#whatsnew .btn[data-wn="ok"]').click(); await adv(300, 100);
  check(await p7.locator("#whatsnew.show").count() === 0 && await p7.evaluate(() => { renderWhatsNew(); return JSON.parse(localStorage.getItem("mwlab_seenVer")) === "6.0.0" && !document.getElementById("whatsnew").classList.contains("show"); }), "Got it puts the card away for good");
  await adv(9 * 60e3, 5000);   // price history loads at 8 a minute
  // dollars for one share, next to the percent
  check(await pill(hA + " .ps") === pair("AAA") && await p7.locator(hA + " .ps .dchg.up").count() === 1, "a holding shows the day's change for one share in dollars, then in percent (" + await pill(hA + " .ps") + ")");
  const posA = await p7.locator(hA + " .v small").innerText();
  check(posA === usd(dOf("AAA") * 10), "and the change on the position is that figure times the shares (" + usd(dOf("AAA")) + " × 10 = " + posA + ")");
  check(await pill(hB + " .ps") === pair("BBB") && await p7.locator(hB + " .ps .dchg.down").count() === 1, "a falling holding shows a minus and a red box (" + await pill(hB + " .ps") + ")");
  check(await pill('[data-row="w:AAA"] .c') === pair("AAA"), "a watchlist row shows the same pair");
  check(await p7.locator('[data-row="w:DDD"] .c .dchg.flat').count() === 1 && await pill('[data-row="w:DDD"] .c') === "$0.00 0.00%", "a price that hasn't moved gets a grey box, not a green one, and no plus sign (" + await pill('[data-row="w:DDD"] .c') + ")");
  check(await p7.locator('#mk-body .idx .c[data-tile="SPY"] u').innerText() === usd(dOf("SPY")), "an index cell shows the dollars for one share under its percent (" + usd(dOf("SPY")) + ")");
  check(await p7.locator('#mk-body .tile[data-tile="XLK"] .d .u').innerText() === usd(dOf("XLK")), "and so does a sector tile");
  await p7.keyboard.press("c"); await adv(1000, 250);
  const cells = await p7.locator("#strip .srow").first().evaluate(r => [...r.children].map(c => c.textContent.trim()));
  check(cells[0].startsWith("AAA") && cells[1] === "$" + px.AAA.toFixed(2) && cells[2] === usd(dOf("AAA")) && cells[3] === pctS(pOf("AAA"), 1), "the compact strip shows the price, the dollars for one share and the percent (" + cells.slice(0, 4).join(" | ") + ")");
  const flatRow = await p7.locator("#strip .srow").evaluateAll(rs => { const r = rs.find(x => x.textContent.trim().startsWith("DDD")); return r ? [...r.children].map(c => c.textContent.trim() + "|" + c.className) : []; });
  check(flatRow[2] === "$0.00|" && flatRow[3] === "0.0%|", "an unchanged ticker has no sign and no color there (" + flatRow.slice(2, 4).join(" ") + ")");
  await p7.keyboard.press("c"); await adv(1000, 250);
  // where the day's dollars came from
  check(await p7.locator("#pf-body .flow-bar button.g").count() === 2 && await p7.locator("#pf-body .flow-bar button.l").count() === 1, "the day's-dollars bar has one piece for each holding that moved");
  await p7.locator('#pf-body .flow-bar [data-jump="h:BBB:Taxable"]').click(); await adv(600, 100);
  check(await p7.evaluate(() => { const a = document.activeElement; return !!a && a.dataset.row === "h:BBB:Taxable" && a.classList.contains("hl"); }), "clicking a piece goes to that holding and marks it");
  // an open holding: the same tabs as a watchlist row, behind a Position tab
  await p7.locator(hA + " .s").click(); await adv(800, 200);
  const tabs = await p7.locator(hA + " [data-htab]").evaluateAll(els => els.map(e => e.dataset.htab));
  const posTxt = (await p7.locator(hA + " .wpane").innerText()).replace(/\s+/g, " ");
  check(tabs[0] === "position" && ["today", "trend", "news"].every(k => tabs.includes(k)), "an open holding has Position, Today, Trend and News tabs (" + tabs.join(", ") + ")");
  check(posTxt.includes("Today " + usd(dOf("AAA") * 10) + " " + usd(dOf("AAA")) + " × 10") && /Gain a share \+\$/.test(posTxt), "Position shows the day's dollars as one share's change times your shares, and your gain for one share");
  await p7.locator(hA + ' [data-htab="today"]').click(); await adv(300, 100);
  const tdTxt = (await p7.locator(hA + " .wpane").innerText()).replace(/\s+/g, " ");
  check(tdTxt.includes(usd(dOf("AAA")) + " a share") && tdTxt.includes("Previous close $" + pcOf("AAA").toFixed(2)), "Today gives the change for one share and the previous close");
  await p7.locator(hB + " .s").click(); await adv(600, 100);
  check(await p7.locator(hB + ' [data-htab="today"].on').count() === 1 && await p7.evaluate(() => settings.hdTab === "today"), "the tab you chose stays for the next holding");
  await p7.locator(hB + ' [data-htab="position"]').click(); await adv(300, 100);
  await p7.locator(hB + " [data-rclose]").click(); await adv(300, 100);
  check(await p7.locator("#pf-body .wdet").count() === 0, "Close shuts the holding's details");
  // hide amounts: what you own is masked, what the market did stays
  await p7.keyboard.press("h"); await adv(500, 100);
  const scan = () => p7.evaluate(() => { const sec = document.getElementById("pf-sec"), bad = [];
    const w = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) if (/\$\d/.test(n.textContent) && !n.parentElement.closest(".ps, .wpane")) bad.push(n.textContent.trim().slice(0, 50));
    sec.querySelectorAll("[title]").forEach(e => { if (/\$\d/.test(e.title) && !e.closest(".ps, .wpane")) bad.push("tooltip: " + e.title.slice(0, 70)); });
    return {bad, total: sec.querySelector(".hero .val span").textContent.trim(), vals: [...sec.querySelectorAll(".hrow .v")].map(e => e.textContent.trim()),
      sh: [...sec.querySelectorAll(".hrow:not(.cash) .s small")].map(e => e.textContent.trim()), ps: [...sec.querySelectorAll(".hrow:not(.cash) .ps")].map(e => e.textContent.trim()), eye: !!sec.querySelector(".eye.on")}; });
  const hd = await scan();
  check(hd.total === "•••" && hd.eye && hd.vals.length === 4 && hd.vals.every(t => !/\d/.test(t)) && hd.sh.every(t => t.startsWith("••• sh")), "H hides the total, every value, share count and cash (" + hd.vals.join(" | ") + ")");
  check(hd.bad.length === 0, "and no dollar amount of yours is left on screen or in a tooltip" + (hd.bad.length ? ": " + hd.bad.slice(0, 4).join(" | ") : ""));
  check(hd.ps.length === 3 && hd.ps.every(t => /^\$\d/.test(t) && /%/.test(t)), "prices, per-share changes and percents stay (" + hd.ps[0] + ")");
  await p7.locator(hA + " .s").click(); await adv(600, 100);
  const hidPos = (await p7.locator(hA + " .wpane").innerText()).replace(/\s+/g, " ");
  check(!/\d/.test(hidPos.replace(/[+−]?\d+(\.\d+)?%/g, "")) && /Shares •••/.test(hidPos), "an open holding's Position tab is masked too (" + hidPos.slice(0, 90) + ")");
  await p7.locator(hA + " [data-rclose]").click(); await adv(300, 100);
  await p7.locator("#pf-body .eye").click(); await adv(500, 100);
  const sh = await scan();
  check(/^\$[\d,]+/.test(sh.total) && !sh.eye && sh.vals.every(t => /\$\d/.test(t)), "the eye next to the total shows them again (" + sh.total + ")");
  // the Risk block folds away
  await p7.locator('#pf-body [data-act="risk"]').click(); await adv(300, 100);
  check(await p7.locator("#pf-body .riskx.shut").count() === 1 && /1-in-20 bad day/.test(await p7.locator("#pf-body .riskx").innerText()) && await p7.evaluate(() => settings.riskHide === true), "the Risk block folds to one line");
  await p7.locator('#pf-body [data-act="risk"]').click(); await adv(300, 100);
  check(await p7.locator("#pf-body .riskx.shut").count() === 0 && await p7.locator("#pf-body .riskx .rk").count() >= 1, "and opens again");
  // section headers stay in view
  await p7.evaluate(() => { const m = document.getElementById("main"), s = document.getElementById("pf-sec"); m.scrollTop += s.getBoundingClientRect().top - m.getBoundingClientRect().top + 140; }); await adv(400, 100);
  const st = await p7.evaluate(() => { const m = document.getElementById("main"), s = document.getElementById("pf-sec"), h = s.querySelector(".sec-h"); return {stuck: s.classList.contains("stuck"), gap: Math.round(h.getBoundingClientRect().top - m.getBoundingClientRect().top)}; });
  check(st.stuck && Math.abs(st.gap) <= 1, "a section's header stays at the top while you scroll through the section (" + JSON.stringify(st) + ")");
  await p7.evaluate(() => { document.getElementById("main").scrollTop = 0; }); await adv(400, 100);
  check(await p7.evaluate(() => !document.getElementById("pf-sec").classList.contains("stuck")), "and lets go when you are back at the top");
  // a market tile opens a details bar
  await p7.locator('#mk-body .idx .c[data-tile="QQQ"]').click(); await adv(1500, 250);
  check(await p7.locator('#mk-body .mkf[data-mkf="QQQ"]').count() === 1 && await pill("#mk-body .mkf") === pair("QQQ"), "clicking an index opens its details bar with the change for one share (" + await pill("#mk-body .mkf") + ")");
  check(await p7.locator('#mk-body .mkf [data-chart="QQQ"]').count() === 1 && await p7.locator('#mk-body .mkf [data-wadd="QQQ"]').count() === 1, "the bar offers its chart and + Watchlist");
  await p7.locator('#mk-body .mkf [data-wadd="QQQ"]').click(); await adv(1500, 250);
  check(await p7.evaluate(() => cfg.watch.some(w => w.sym === "QQQ")) && await p7.locator('#wl-body [data-row="w:QQQ"]').count() === 1 && await p7.locator('#mk-body .mkf [data-wgo="QQQ"]').count() === 1, "+ Watchlist adds the ticker, and the button becomes Open in Watchlist");
  await p7.locator('#mk-body .mkf [data-act="mkclose"]').click(); await adv(300, 100);
  check(await p7.locator("#mk-body .mkf").count() === 0 && await p7.evaluate(() => settings.focus === ""), "✕ closes the bar");
  // the chart's readout
  await p7.locator(hA + " .s").click(); await adv(600, 100);
  await p7.locator(hA + ' [data-chart="AAA"]').click(); await adv(3000, 250);
  const ro = (await p7.locator("#chHover").innerText()).replace(/\s+/g, " ");
  check(/Close [\d.]+ [+−]\$[\d.]+ [+−][\d.]+%/.test(ro) && /Open [\d.]+ High [\d.]+ Low [\d.]+/.test(ro), "the chart's readout gives the candle under the pointer: close, change in dollars and percent, open, high and low (" + ro + ")");
  await p7.mouse.move(399, 2); await adv(500, 100);
  const ro2 = (await p7.locator("#chHover").innerText()).replace(/\s+/g, " ");
  check(ro2.startsWith("Mon, 11/9 Close " + px.AAA.toFixed(2) + " " + pair("AAA")), "with the pointer away it gives today's candle (" + ro2 + ")");
  check((await p7.locator("#chPx").innerText()).replace(/\s+/g, " ").includes(pair("AAA")), "and the chart's header carries today's pair");
  await p7.keyboard.press("Escape"); await adv(300, 100);
  await p7.locator(hA + " [data-rclose]").click(); await adv(300, 100);
  // an alert says the drop in dollars for one share
  px.AAA = +(pcOf("AAA") * 0.96).toFixed(2); await adv(75000, 5000);
  const msgs = await p7.evaluate(() => firedToday().log.map(l => l.msg));
  check(msgs.some(m => m.includes("AAA is down $" + (-dOf("AAA")).toFixed(2) + " a share (" + (-pOf("AAA")).toFixed(1) + "%) today")), "an alert gives the drop in dollars for one share, then percent (" + (msgs.find(m => /AAA/.test(m)) || "no AAA alert") + ")");
  check(await pill(hA + " .ps") === pair("AAA") && await p7.locator(hA + " .v small.down").count() === 1, "and the row turns red with the new figures (" + await pill(hA + " .ps") + ")");
  // nothing is cut short: a price under $1, a four-digit price, a long note, and a window narrower than the app allows
  pcFix.PNY = 0.4821; px.PNY = 0.4659; pcFix.BIG = 7843.2; px.BIG = 7973.12;
  await p7.evaluate(() => { cfg.watch.push({sym:"PNY", levels:[], dayDrop:30, near:0}, {sym:"BIG", levels:[7500], dayDrop:30, near:0});
    cfg.watch.find(w => w.sym === "DDD").note = "A made-up note that is long enough to need a second line in a narrow window, and then a few words more"; saveCfg(); renderAll(); });
  await adv(75000, 5000);
  const pny = '[data-row="w:PNY"]', pnyPx = (await p7.locator(pny + " .v").innerText()).trim();
  check(pnyPx === "$0.4659" && await pill(pny + " .c") === "−$0.0162 −3.36%", "a price under $1 shows four decimals, and so does its change (" + pnyPx + " " + await pill(pny + " .c") + ")");
  check(await pill('[data-row="w:BIG"] .c') === pair("BIG") && (await p7.locator('[data-row="w:BIG"] .v').innerText()).trim() === "$7,973.12", "a four-digit price keeps its cents and its pair (" + await pill('[data-row="w:BIG"] .c') + ")");
  check(await p7.evaluate(() => { const r = document.querySelector('[data-row="w:DDD"]'), n = r.querySelector(".wnote"); return r.classList.contains("nl") && n.scrollWidth <= n.clientWidth + 1 && n.getBoundingClientRect().height > 24 && n.textContent.endsWith("a few words more"); }), "a long note wraps onto more lines and is never cut");
  const cutIn = sel => p7.evaluate(s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0, 24)), sel);
  const FULL = "#pf-body .grp-h > .muted, #pf-body .hrow .s, #wl-body .wrow > .s, #wl-body .wl, #wl-body .wnote, #nw-body .nw-bar .seg";
  const stripState = () => p7.evaluate(() => { const st = document.getElementById("strip"); return {cls: st.className,
    cut: st.scrollWidth > st.clientWidth + 1 || [...st.querySelectorAll(".s, .er")].some(c => c.scrollWidth > c.clientWidth + 1), wrapped: [...st.querySelectorAll(".srow")].some(r => r.getBoundingClientRect().height > 30),
    big: [...st.querySelectorAll(".srow")].find(r => r.textContent.includes("BIG")).querySelector(".d").innerText.trim()}; });
  for (const w of [400, 360]) {
    await p7.setViewportSize({width:w, height:760}); await adv(800, 200);
    const cut = await cutIn(FULL);
    check(cut.length === 0, `at ${w} px no ticker, account label, alert status, note or news tab is cut` + (cut.length ? ": " + cut.join(" | ") : ""));
    await p7.keyboard.press("c"); await adv(1200, 200);
    const s = await stripState();
    check(!s.cut && !s.wrapped, `at ${w} px the compact view cuts and wraps nothing` + (s.cls ? " (" + s.cls + ")" : ""));
    await p7.keyboard.press("c"); await adv(800, 200);
  }
  // narrower than the app's own minimum, the compact view sheds detail in steps instead of cutting. The window is squeezed
  // while the compact view is open, until the alert price goes; where that happens depends on the font, so the width is found, not fixed
  await p7.keyboard.press("c"); await adv(1200, 200);
  let sq = await stripState(), sqW = 360, sqClean = !sq.cut && !sq.wrapped;
  while (!/\btighter\b/.test(sq.cls) && sqW > 240) {
    sqW -= 20; await p7.setViewportSize({width:sqW, height:760}); await adv(1200, 200);
    sq = await stripState(); sqClean = sqClean && !sq.cut && !sq.wrapped;
  }
  check(sqClean && /\btighter\b/.test(sq.cls) && /^[\d.]+%$/.test(sq.big), `squeezed to ${sqW} px it drops the alert price and keeps the distance (${sq.big}), cutting nothing on the way`);
  await p7.keyboard.press("c"); await p7.setViewportSize({width:400, height:760}); await adv(800, 200);
  check(await p7.evaluate(() => !document.getElementById("strip").className), "and back in the full view the strip is reset");
  if (SHOTS) await p7.screenshot({path:path.join(SHOTS, "13-per-share.png"), fullPage:true});
  check(errs7.length === 0, "no page errors in the 6.0 checks" + (errs7.length ? ": " + [...new Set(errs7)].slice(0, 4).join(" | ") : ""));
  await ctx7.close();
}

await browser.close(); server.close();
console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nAll browser checks passed");
process.exit(fail.length ? 1 : 0);
