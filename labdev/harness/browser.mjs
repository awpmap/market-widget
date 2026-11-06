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
const px = {}, pcOf = s => 50 + hash(s) % 200;
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
await page.locator('#wl-body [data-wrm="CCC"]').click(); await advance(1000, 500);
check(await page.locator("#wl-body .wrow").count() === 2 && await page.locator("#wl-body .wundo").count() === 1, "✕ removes a ticker and offers Undo");
await page.locator("#wl-body [data-wundo]").click(); await advance(1000, 500);
check(await page.locator("#wl-body .wrow").count() === 3, "Undo puts it back");
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
  let t3 = Date.parse("2026-11-05T15:30:00Z"), alpDeny = false; const alpPx = {}, alpCalls = [];
  await p3.route(/https:\/\/data\.alpaca\.markets\/.*/, route => {
    const r = route.request(), u = new URL(r.url()), h = r.headers();
    alpCalls.push({t:t3, id:h["apca-api-key-id"], sec:h["apca-api-secret-key"], feed:u.searchParams.get("feed")});
    if (alpDeny) return route.fulfill({status:403, json:{message:"forbidden"}});
    const day = new Date(t3).toISOString().slice(0, 10), out = {};
    (u.searchParams.get("symbols") || "").split(",").forEach(s => { const c = alpPx[s] ?? +(priceOf(s) * 1.002).toFixed(2), pc = pcOf(s);
      out[s] = {latestTrade:{t:new Date(t3 - 1500).toISOString(), p:c, s:100}, dailyBar:{t:day + "T04:00:00Z", o:pc, h:Math.max(pc, c), l:Math.min(pc, c), c, v:1e5}, prevDailyBar:{t:"2026-11-04T04:00:00Z", o:pc, h:pc, l:pc, c:pc, v:1e5}}; });
    return route.fulfill({json:out});
  });
  await p3.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1"); localStorage.clear();
    localStorage.setItem("mwlab_settings", JSON.stringify({key:"test", alpKey:"test-key-id", alpSec:"test-secret", refresh:60}));
    localStorage.setItem("mwlab_cfg", JSON.stringify({holdings:[{sym:"AAA", shares:10, acct:"Taxable"}], fixed:[], watch:[{sym:"AAA", levels:[90, 80], dayDrop:3, near:1.5}, {sym:"BBB", levels:[], dayDrop:3}, {sym:"CCC", levels:[], dayDrop:3}]}));
  });
  await p3.clock.install({time:t3});
  const adv = async (ms, step = 1000) => { for (let t = 0; t < ms; t += step) { t3 += step; simNow = t3; await p3.clock.runFor(step); await p3.waitForTimeout(25); } };
  simNow = t3; Object.keys(px).forEach(k => delete px[k]);   // a clean synthetic market for this part
  await p3.goto(BASE); await adv(20000);
  check(await p3.evaluate(() => quotes.AAA && quotes.AAA.src === "alpaca"), "fast prices: Alpaca's price is used during the session");
  check(alpCalls.length > 0 && alpCalls.every(c => c.id === "test-key-id" && c.sec === "test-secret" && c.feed === "iex"), "the keys go in Alpaca's headers, on the free IEX feed");
  const n0 = alpCalls.length; await adv(30000);
  check(alpCalls.length - n0 >= 5 && alpCalls.length - n0 <= 7, `about one Alpaca call every 5 seconds while open (${alpCalls.length - n0} in 30 s)`);
  alpPx.BBB = +(priceOf("BBB") * 0.99).toFixed(2); await adv(6000, 500);
  check(await p3.evaluate(px => { const el = document.querySelector('#wl-body [data-row="w:BBB"] [data-fx]'); return !!el && el.textContent.includes(px.toFixed(2)) && el.classList.contains("fx-dn"); }, alpPx.BBB), "a new price shows within 5 seconds and flashes red when it fell");
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
  // after hours: the latest trade shows beside the close, every 15 seconds
  t3 = Date.parse("2026-11-05T21:40:00Z"); simNow = t3; await p3.clock.fastForward(Date.parse("2026-11-05T21:40:00Z") - (await p3.evaluate(() => Date.now())));
  alpPx.AAA = +(priceOf("AAA") * 1.03).toFixed(2); const n1 = alpCalls.length; await adv(46000);
  check(alpCalls.length - n1 >= 2 && alpCalls.length - n1 <= 4, `after hours, about one call every 15 seconds (${alpCalls.length - n1} in 46 s)`);
  check(/AH .*\+/.test(await p3.locator('#wl-body [data-row="w:AAA"] .chip.ext').innerText().catch(() => "")), "an after-hours price shows on the row as AH");
  if (SHOTS) await p3.screenshot({path:path.join(SHOTS, "6-after-hours.png"), fullPage:true});
  check(/After hours/.test(await p3.locator("#pf-body .hero small.ah").innerText().catch(() => "")), "the portfolio total shows its after-hours move");
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
    localStorage.setItem("mwlab_settings", JSON.stringify({key:"test", tdKey:"test", refresh:60}));
    localStorage.setItem("mwlab_cfg", JSON.stringify({holdings:[], fixed:[], watch:[{sym:"AAA", levels:[], dayDrop:30, near:0}, {sym:"BBB", levels:[], dayDrop:30, near:0}, {sym:"CCC", levels:[], dayDrop:30, near:0}]}));
  });
  await p4.clock.install({time:t4});
  const adv = async (ms, step = 1000) => { for (let t = 0; t < ms; t += step) { t4 += step; simNow = t4; await p4.clock.runFor(step); await p4.waitForTimeout(25); } };
  simNow = t4; Object.keys(px).forEach(k => delete px[k]);
  await p4.goto(BASE); await adv(30000); await adv(150000, 5000);
  const er = await p4.locator("#mk-body .erp").innerText().catch(() => "");
  check(/AAA/.test(er) && /Tue 11\/10 · after the close/.test(er) && /EPS est \$1\.23/.test(er) && /beat by 8\.3%/.test(er), "the earnings panel lists the report with its estimates and last surprise");
  check(/±\d/.test(await p4.locator('#mk-body .erw:has-text("AAA") .mv').innerText().catch(() => "")), "and the typical report-day move from price history");
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

await browser.close(); server.close();
console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nAll browser checks passed");
process.exit(fail.length ? 1 : 0);
