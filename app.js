/* Generated from lab/ by labdev/promote.mjs. Edit lab/ and promote again, not this file. */
"use strict";
/* =====================================================================
   MW: the beta version of Market Widget with the review board's recommendations built in.
   It keeps its own storage (keys start "mwlab_"), never writes to the live MW's storage, and only
   reads it when you click "Copy my setup from MW".
   Public build: NO personal data lives in this file.
   Your key, holdings and alert levels are stored only in this browser.
   The tested logic lives in engine.js (window.MWE); this file is the page around it.
   ===================================================================== */
const E = window.MWE;
const APP_VERSION = E.VERSION;
const APP_NAME = "MW";
const DEFAULT_CFG = { holdings: [], fixed: [], watch: [
  {sym:"QQQ", note:"Market check: big red day", dayDrop:2, offHigh:10, levels:[], near:0}
]};

const MARKETS = {
  indices: [
    {sym:"SPY", name:"S&P 500"}, {sym:"QQQ", name:"Nasdaq 100"},
    {sym:"DIA", name:"Dow"},     {sym:"IWM", name:"Small caps"}
  ],
  sectors: [
    {sym:"SMH", name:"Chips"},            {sym:"XLK", name:"Tech"},
    {sym:"XLC", name:"Comms"},    {sym:"XLY", name:"Consumer"},
    {sym:"XLF", name:"Financials"},       {sym:"XLV", name:"Healthcare"},
    {sym:"XLI", name:"Industrials"},      {sym:"XLE", name:"Energy"},
    {sym:"XLB", name:"Materials"},        {sym:"XLU", name:"Utilities"},
    {sym:"XLP", name:"Staples"},          {sym:"XLRE", name:"Real estate"},
    {sym:"GRID", name:"Power grid"},      {sym:"IGV", name:"Software"}
  ],
  other: [
    {sym:"GLD", name:"Gold"}, {sym:"TLT", name:"Long bonds"},
    {sym:"VEA", name:"International"}, {sym:"VWO", name:"Emerging"}
  ]
};
const PERIODS = [   // TradingView-style ranges
  {k:"1D", label:"1D"},
  {k:"5D", label:"5D", sessions:5, f:"5DayPriceReturnDaily"},
  {k:"1M", label:"1M", months:1},
  {k:"3M", label:"3M", months:3, f:"13WeekPriceReturnDaily"},
  {k:"6M", label:"6M", months:6, f:"26WeekPriceReturnDaily"},
  {k:"YTD", label:"YTD", ytd:true, f:"yearToDatePriceReturnDaily"},
  {k:"1Y", label:"1Y", months:12, f:"52WeekPriceReturnDaily"},
  {k:"3Y", label:"3Y", months:36},
  {k:"5Y", label:"5Y", months:60}
];
/* cross-asset proxies for the market-regime read (ETFs, since index data isn't free) */
const XASSET = [
  {sym:"VIXY", name:"Volatility"}, {sym:"HYG", name:"High-yield credit"}, {sym:"IEF", name:"7-10y Treasuries"},
  {sym:"UUP", name:"US dollar"},  {sym:"RSP", name:"Equal-weight S&P"}
];
const BELLWETHERS = ["NVDA","AVGO","TSM","MU","AMD","ASML"];
/* NYSE holidays and early closes live in engine.js (2026 to 2028, checked in CI; fails closed after that) */
const HOLIDAYS = E.HOLIDAYS, EARLY_CLOSE = E.EARLY_CLOSE;
/* the 11 S&P sector funds: breadth counts only these (chips, power and software overlap them) */
const SPDR11 = ["XLK","XLC","XLY","XLF","XLV","XLI","XLE","XLB","XLU","XLP","XLRE"];
const HEAT_CAP = {"1D":2.5,"5D":5,"1M":8,"3M":12,"6M":18,"YTD":25,"1Y":30,"3Y":60,"5Y":100};
const ACCT_COLORS = ["#5b9dff","#a78bfa","#2dd4bf","#f59e0b","#f472b6","#94a3b8"];

/* ---------- storage (graceful when blocked) ---------- */
const mem = {};
const NS = "mw_";
/* the same code runs as the beta (/lab/, storage "mwlab_") and, after labdev/promote.mjs, as the regular MW
   (storage "mw_"); BETA turns on the parts that only make sense in the beta (switching back, copying from MW) */
const BETA = NS === "mwlab_", BETA_NAME = "MW" + " Beta";   // spelled in two parts so promote.mjs leaves it alone
const store = {
  get(k, d){ try{ const v = localStorage.getItem(NS+k); if (v!=null) return JSON.parse(v); }catch(e){} return (k in mem) ? mem[k] : d; },
  set(k, v){ mem[k] = v; try{ localStorage.setItem(NS+k, JSON.stringify(v)); }catch(e){ if (!store.warned){ store.warned = true; setTimeout(()=>{ try{ mwLog("warn", "browser storage is full or blocked: " + e.message); }catch(_){} }, 0); } } }
};
/* the live MW's storage, read-only: used once, when you copy your setup into the lab */
const liveStore = { get(k){ try{ const v = localStorage.getItem("mw_"+k); return v!=null ? JSON.parse(v) : null; }catch(e){ return null; } } };
/* beta channel: the regular MW opens this page when mw_channel is "beta". These are the only regular-MW keys the
   beta ever writes: mw_channel (your choice) and mw_betaOk (the beta started fine, so MW doesn't fall back). */
const raw = { get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }, set(k, v){ try{ localStorage.setItem(k, v); }catch(e){} } };
const onBeta = () => raw.get("mw_channel") === "beta";
/* ---------- diagnostics log: kept on this PC (last 300 lines) and, in the desktop app, in its log file ----------
   Never logs keys: URLs are scrubbed of token=/apikey= values before they are stored. */
const scrubKeys = t => String(t).replace(/(token|apikey|apiKey|key)=[^&\s"')]*/g, "$1=***").replace(/#setup=\S*/g, "#setup=***").replace(/\b(PK|AK)[A-Z0-9]{14,}\b/g, "$1***");
let logBuf = []; try{ logBuf = JSON.parse(localStorage.getItem(NS+"diag") || "[]"); }catch(e){}
let logSaveT = null;
function mwLog(level, msg){
  const line = new Date().toISOString().slice(5,19).replace("T"," ") + " " + level.toUpperCase() + " " + scrubKeys(msg).slice(0, 600);
  logBuf.push(line); if (logBuf.length > 300) logBuf = logBuf.slice(-300);
  clearTimeout(logSaveT); logSaveT = setTimeout(()=>{ try{ localStorage.setItem(NS+"diag", JSON.stringify(logBuf)); }catch(e){} }, 1000);
  try{ if (window.__TAURI__ && window.__TAURI__.core) window.__TAURI__.core.invoke("shell_log", {level, msg: scrubKeys(msg).slice(0, 600)}).catch(()=>{}); }catch(e){}
  if (level === "error") try{ console.error("[MW]", msg); }catch(e){}
}
let errCount = 0;
window.addEventListener("error", e => { errCount++; mwLog("error", (e.message || "error") + (e.filename ? " @" + String(e.filename).split("/").pop() + ":" + e.lineno + ":" + e.colno : "") + (e.error && e.error.stack ? " | " + String(e.error.stack).split("\n").slice(1,3).join(" ").trim() : "")); });
window.addEventListener("unhandledrejection", e => { const r = e.reason; mwLog("warn", "unhandled: " + (r && r.message ? r.message : String(r)) + (r && r.stack ? " | " + String(r.stack).split("\n").slice(1,2).join(" ").trim() : "")); });
document.addEventListener("visibilitychange", ()=> mwLog("info", "window " + (document.hidden ? "hidden" : "visible")));
document.addEventListener("freeze", ()=> mwLog("warn", "page frozen by the browser"));
document.addEventListener("resume", ()=> mwLog("info", "page resumed"));
/* every network call gives up after 20 s, so one stalled connection can never stall the app */
function fetchT(url, opts, ms){
  const ac = new AbortController(), t = setTimeout(()=> ac.abort(), ms || 20000);
  return fetch(url, Object.assign({}, opts || {}, {signal: ac.signal}))
    .catch(e => { throw (e && e.name === "AbortError") ? new Error("timed out") : e; })
    .finally(()=> clearTimeout(t));
}
/* info boxes: hover (or keyboard focus) on anything with a title shows a styled explanation */
(function(){
  let el = null, t = null;
  const box = () => document.getElementById("tip");
  const hide = () => { clearTimeout(t); t = null; el = null; const b = box(); if (b) b.classList.remove("show"); };
  const place = (target) => {
    const b = box(); if (!b || !target.isConnected) return;
    b.textContent = target.dataset.tip; b.classList.add("show");
    const r = target.getBoundingClientRect(), w = b.offsetWidth, h = b.offsetHeight, vw = innerWidth, vh = innerHeight;
    let x = Math.min(Math.max(8, r.left + r.width/2 - w/2), vw - w - 8), y = r.bottom + 6;
    if (y + h > vh - 8) y = Math.max(8, r.top - h - 6);
    b.style.left = x + "px"; b.style.top = y + "px";
  };
  const over = (e) => {
    const target = e.target.closest && e.target.closest("[title],[data-tip]"); if (target === el) return;
    hide(); if (!target) return;
    if (target.hasAttribute("title")){ const tt = target.getAttribute("title"); target.removeAttribute("title"); if (tt) target.dataset.tip = tt; }
    if (!target.dataset.tip) return;
    el = target; t = setTimeout(() => place(target), e.type === "focusin" ? 600 : 380);
  };
  document.addEventListener("mouseover", over, true);
  document.addEventListener("focusin", e => { if (e.target.matches && e.target.matches(":focus-visible")) over(e); }, true);
  document.addEventListener("mouseout", e => { if (el && !el.contains(e.relatedTarget)) hide(); }, true);
  ["mousedown","keydown","scroll","blur","wheel"].forEach(k => window.addEventListener(k, hide, true));
})();

/* optional crash reports: only when a Sentry DSN is saved in Settings → Diagnostics. Keys are scrubbed; no breadcrumbs (they'd hold URLs).
   The script comes from Sentry's own CDN, pinned to one version, and the browser refuses it unless its bytes match this hash
   (Subresource Integrity; the hash is Sentry's published one, re-checked in CI). */
const SENTRY_SRC = "https://browser.sentry-cdn.com/8.55.2/bundle.min.js";
const SENTRY_SRI = "sha384-lNMClDekFF9oPvouGJqnUSKioEadbe8byR7uGUA0sPP+g9r2x3eiErEJmm/Em+wB";
function initSentry(){
  const dsn = (settings && settings.sentryDsn || "").trim(); if (!dsn || window.Sentry || initSentry.loading) return;
  initSentry.loading = true;
  const sc = document.createElement("script");
  sc.src = SENTRY_SRC; sc.integrity = SENTRY_SRI; sc.crossOrigin = "anonymous"; sc.referrerPolicy = "no-referrer";
  sc.onload = ()=>{ try{ window.Sentry.init({ dsn, release: (BETA ? "mwlab@" : "mw@") + APP_VERSION, environment: (BETA ? "lab-" : "") + (NATIVE ? "desktop" : "browser"), sendDefaultPii: false,
      beforeBreadcrumb: () => null, beforeSend: ev => { try{ return JSON.parse(scrubKeys(JSON.stringify(ev))); }catch(e){ return null; } } });
      window.Sentry.setTag("shell", NATIVE ? "desktop-app" : "browser");
      mwLog("info", "Sentry connected"); const st = document.getElementById("dSentryState"); if (st) st.textContent = "Connected: crash reports are on.";
      forwardShellIncidents(); }catch(e){ mwLog("warn", "Sentry failed to start: " + e.message); } };
  sc.onerror = ()=>{ initSentry.loading = false; mwLog("warn", "Sentry script couldn't load (blocked, offline, or its bytes didn't match the pinned hash)"); const st = document.getElementById("dSentryState"); if (st) st.textContent = "Couldn't load Sentry's script. Check the connection and try again."; };
  document.head.appendChild(sc);
}
/* the desktop app's own problems (watchdog reloads, crashed page) live in its log file; send new ones to Sentry */
function forwardShellIncidents(){
  if (!NATIVE || !window.Sentry) return;
  nat.invoke("shell_logs").then(text => {
    let seen = ""; try{ seen = localStorage.getItem(NS+"sentryShellSeen") || ""; }catch(e){}
    const re = /^\[(\d{4}-\d\d-\d\d)\]\[(\d\d:\d\d:\d\d)\]\[(ERROR|WARN)\]\[[^\]]*\] (.*)$/;
    let last = seen, n = 0;
    String(text || "").split("\n").forEach(line => {
      const m = line.match(re); if (!m || m[4].startsWith("page:")) return;
      const stamp = m[1] + " " + m[2]; if (stamp <= seen || n >= 20) return;
      n++; last = stamp > last ? stamp : last;
      window.Sentry.captureMessage("desktop app: " + m[4].replace(/\d+s\b/g, "Ns").slice(0, 200), {level: m[3] === "ERROR" ? "error" : "warning", tags: {source: "desktop-shell"}, extra: {logLine: scrubKeys(line), at: stamp}});
    });
    try{ if (last) localStorage.setItem(NS+"sentryShellSeen", last); }catch(e){}
    if (n) mwLog("info", "sent " + n + " desktop app incident(s) to Sentry");
  }).catch(()=>{});
}
const report = e => { try{ if (window.Sentry && e) window.Sentry.captureException(e); }catch(_){} };
/* run one piece of the UI; if it throws, log it and keep the rest of the app working */
function safe(name, fn){ try{ return fn(); }catch(e){ errCount++; report(e); mwLog("error", name + ": " + (e && e.message || e) + (e && e.stack ? " | " + String(e.stack).split("\n").slice(1,2).join(" ").trim() : "")); } }

const normCfg = c => E.migrate(c);
const firstRun = store.get("cfg", null) == null;   // nothing saved yet in the beta
let cfg = normCfg(store.get("cfg", null) || DEFAULT_CFG);
/* config history (R16): every saved version of your setup (edits of the same kind within 10 minutes share one
   entry), plus a copy taken just before anything replaces it (a restore, a setup link, copying from MW).
   The last 30 stay on this PC and can be restored from Settings → Backup. */
function snapCfg(why, force){
  const h = store.get("cfgHist", []), last = h[0];
  const txt = JSON.stringify(cfg);
  if (last && last.cfg === txt) return;
  const entry = {t:Date.now(), why, cfg:txt};
  // edits of the same kind within 10 minutes update one entry instead of filling the history
  if (!force && last && Date.now() - last.t < 10*60e3 && last.why === why) h[0] = entry; else h.unshift(entry);
  store.set("cfgHist", h.slice(0, 30));
}
function saveCfg(why){ cfg.v = E.CFG_V; store.set("cfg", cfg); snapCfg(why || "edit"); }

/* one-time private setup link: #setup=<base64 json>. Read locally, never sent anywhere.
   It asks first and keeps a snapshot, because it replaces your holdings and watchlist (R8). */
(function(){
  try{
    const m = location.hash.match(/^#setup=([A-Za-z0-9+/=_-]+)$/);
    if (m){
      const c = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g,"+").replace(/_/g,"/")))));
      if (E.validCfg(c)){
        const nc = normCfg(c), empty = !cfg.holdings.length && cfg.watch.length <= 1;
        if (empty || confirm("This setup link will replace your MW setup:\n" + E.cfgDiff(cfg, nc) + "\n\nYour current setup is kept in Settings → Backup → History. Continue?")){
          snapCfg("before a setup link", true); cfg = nc; saveCfg("setup link"); setTimeout(()=>{ try{ mwLog("info", "setup link applied"); }catch(e){} }, 0);
        }
      }
    }
  }catch(e){}
  if (location.hash) try{ history.replaceState(null, "", location.pathname + location.search); }catch(e){}
})();

let settings = Object.assign({key:"", tdKey:"", ntfy:"", ntfyFull:false, hcUrl:"", sound:"on", theme:"auto", refresh:60, compact:false, collapsed:{}, allOff:false, period:"1D", sort:"value", grpCollapsed:{}, heatOrder:"fixed", focus:"", bench:"SMH", pauseUntil:0, snooze:{}, layout:null, hideSec:{}, sentryDsn:"", tz:"auto", overnight:false, sizing:false, refVol:2, concCap:25, record:false, showZeroCash:false, alpKey:"", alpSec:"", fast:true, cvd:false, fundEst:true, newsTab:"all", newsAll:false, hideAmt:false, hdTab:"position", riskHide:false}, store.get("settings", {}));
const DEFAULT_LAYOUT = ["news","portfolio","markets","watch","log"];
const SEC_NAMES = {news:"News", portfolio:"Portfolio", markets:"Markets", watch:"Watchlist", log:"Today's alerts"};
/* a section this layout was saved without (News, new in 5.0) goes first, where the headline strip used to be */
function layoutOrder(){ const L = (Array.isArray(settings.layout) ? settings.layout : []).filter(k => DEFAULT_LAYOUT.includes(k)); DEFAULT_LAYOUT.forEach(k => { if (!L.includes(k)) k === "news" ? L.unshift(k) : L.push(k); }); return L; }
function applyLayout(){
  const main = $("main"), anchor = $("err"); if (!main || !anchor) return;
  // on a wide window (900 px and up) the sections flow into side-by-side columns (Monitor layout)
  const wide = settings.wide !== false && !settings.compact && document.body.clientWidth >= 900;
  document.body.classList.toggle("wide", wide);
  const want = layoutOrder().filter(k => document.querySelector(`.sec[data-sec="${k}"]`)), sec = k => document.querySelector(`.sec[data-sec="${k}"]`);
  want.forEach(k => sec(k).classList.toggle("hide", !!(settings.hideSec||{})[k]));
  if (wide){
    // visible sections take turns across 2 columns (3 from 1320 px), in your section order
    const n = document.body.clientWidth >= 1320 ? 3 : 2, vis = want.filter(k => !(settings.hideSec||{})[k]), sig = n + ":" + vis.join();
    let cols = $("cols");
    if (cols && cols.dataset.sig === sig) return;   // already laid out this way: leave it (moving a section steals the focus)
    if (!cols){ cols = document.createElement("div"); cols.id = "cols"; main.insertBefore(cols, anchor); }
    const boxes = Array.from({length:n}, () => { const c = document.createElement("div"); c.className = "col"; return c; });
    vis.forEach((k, i) => boxes[i % n].appendChild(sec(k)));
    want.filter(k => !vis.includes(k)).forEach(k => boxes[n - 1].appendChild(sec(k)));
    cols.replaceChildren(...boxes); cols.dataset.sig = sig; cols.style.setProperty("--n", n);
    return;
  }
  // move sections only when the order changed: moving a section takes the focus away from a box inside it
  const have = [...main.querySelectorAll(":scope > .sec[data-sec]")].map(el => el.dataset.sec);
  const moved = want.join() !== have.filter(k => want.includes(k)).join() || want.some(k => sec(k).parentElement !== main);
  if (moved) want.forEach(k => main.insertBefore(sec(k), anchor));
  if ($("cols")) $("cols").remove();
}
if (!PERIODS.some(p=>p.k===settings.period)) settings.period = settings.period==="MTD" ? "1M" : "1D";
/* funds typed as "ABCDX (12.3 sh ...)" get their ticker and shares picked up automatically */
cfg.fixed.forEach(f=>{ if (!f.sym){ const m = String(f.name||"").match(/^([A-Z]{3,5})\s*\(\s*([\d.]+)\s*sh/); if (m){ f.sym = m[1]; f.shares = +m[2]; } } });
cfg.v = E.CFG_V; store.set("cfg", cfg); snapCfg("in use");
document.documentElement.dataset.theme = settings.theme;
const saveSettings = ()=> store.set("settings", settings);

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt$ = (n, d=2) => (n==null||!isFinite(n)) ? "—" : (n<0?"−":"") + "$" + Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtPx = E.fmtPx;   // a price: to the cent, or four decimals under $1 (so it reads like its change)
const sgn = E.sgn;        // "+" or "−"; nothing for a figure that rounds to zero, which is neither up nor down
const fmtS$ = (n, d=0) => (n==null||!isFinite(n)) ? "—" : sgn(n, d) + "$" + Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtPct = (n, d=2) => (n==null||!isFinite(n)) ? "—" : sgn(n, d) + Math.abs(n).toFixed(d) + "%";   // zero has no sign: "0.00%"
const cls = n => (n==null||!isFinite(n)||n===0) ? "" : n>0 ? "up" : "down";   // exactly zero gets no color
const cls0 = n => (n==null||!isFinite(n)||Math.abs(n) < 0.005) ? "" : n>0 ? "up" : "down";   // a dollar change of zero gets no color
/* ---------- the day's change for ONE share (6.0) ----------
   Wherever MW shows a day's percent it also shows what that is in dollars for one share: the price minus the
   previous close. chgOf() is that number; dchg() draws the pair as one pill, dollars first, the same everywhere. */
const chgOf = q => !q || !(q.c > 0) ? null : q.pc > 0 ? q.c - q.pc : (q.d != null && isFinite(q.d) ? +q.d : null);
/* a dollar change for one share: always signed, to the cent (four decimals for a price under $1) */
const fmtSh$ = (v, px) => v == null || !isFinite(v) ? "—" : (d => Math.abs(v) < 0.5 * 10 ** -d ? "$0." + "0".repeat(d) : fmtS$(v, d))(px > 0 && px < 1 ? 4 : 2);
/* o: {k:"est" (a fund estimate, dashed) | "old" (an older day's change, faded), sm (small), tip, d (percent decimals),
   px (the price, for sub-dollar tickers), none (what to show when there is no change to show)} */
function dchg(usd, pct, o){
  o = o || {};
  const okU = usd != null && isFinite(usd), okP = pct != null && isFinite(pct), tip = o.tip ? ` title="${esc(o.tip)}"` : "";
  if (!okU && !okP) return `<span class="dchg num none${o.sm ? " sm" : ""}"${tip}>${o.none || "—"}</span>`;
  const d = o.d == null ? 2 : o.d, flat = (!okP || +Math.abs(pct).toFixed(d) === 0) && (!okU || Math.abs(usd) < 0.005);
  return `<span class="dchg num ${flat ? "flat" : cls(okP ? pct : usd)}${o.k ? " " + o.k : ""}${o.sm ? " sm" : ""}"${tip}>${okU ? `<b>${fmtSh$(usd, o.px)}</b>` : ""}${okP ? `<i>${fmtPct(pct, d)}</i>` : ""}</span>`;
}
/* the same pair as plain text, for tooltips, the tray, the brief and Ctrl+K: "+$5.27 +2.59%" */
const chgTxt = (usd, pct, d = 2, px) => [usd != null && isFinite(usd) ? fmtSh$(usd, px) : "", pct != null && isFinite(pct) ? fmtPct(pct, d) : ""].filter(Boolean).join(" ");
/* ---------- hide amounts (6.0) ----------
   One switch (the eye next to the total, the H key or the menu) masks every figure that says how much you own or
   paid: the total, position values and their dollar changes, share counts, cost, cash and the risk figures in
   dollars. Prices, per-share changes, percents and weights stay, so MW can sit on a shared screen. */
const HID = "•••";
const hid = () => !!settings.hideAmt;
const my$ = (n, d) => hid() ? HID : fmt$(n, d);
const myS$ = (n, d) => !hid() ? fmtS$(n, d) : (n == null || !isFinite(n)) ? "—" : (n >= 0 ? "+" : "−") + HID;   // the sign stays
const myN = (n, o) => hid() ? HID : (+n).toLocaleString("en-US", o || {maximumFractionDigits:3});              // a share count
function toggleHide(){ settings.hideAmt = !settings.hideAmt; saveSettings(); renderAll(); toast(settings.hideAmt ? "Amounts hidden · prices and percents stay" : "Amounts shown"); }
const EYE_ON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>`;
const EYE_OFF = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.4 3.7A6 6 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.7 2.2M10.9 11.7A6 6 0 0 1 8 12.5C4 12.5 1.5 8 1.5 8a11 11 0 0 1 2.6-3M2.5 2.5l11 11"/></svg>`;
/* ---------- time zone: market math always runs on New York time; times are SHOWN in the zone you pick ---------- */
const ET_TZ = "America/New_York";
const TZ_CHOICES = [["auto","This PC's time zone"],["America/New_York","Eastern (market time)"],["America/Chicago","Central"],["America/Denver","Mountain"],["America/Phoenix","Arizona"],["America/Los_Angeles","Pacific"],["America/Anchorage","Alaska"],["Pacific/Honolulu","Hawaii"],["UTC","UTC"],["Europe/London","London"]];
const sysTz = () => { try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || ET_TZ; }catch(e){ return ET_TZ; } };
const tzName = () => { const z = settings && settings.tz; if (!z || z === "auto") return sysTz(); try{ new Intl.DateTimeFormat("en-US", {timeZone:z}); return z; }catch(e){ return sysTz(); } };
const tzAbbr = (t = Date.now(), z = tzName()) => { try{ return new Intl.DateTimeFormat("en-US", {timeZone:z, timeZoneName:"short"}).formatToParts(new Date(t)).find(x=>x.type==="timeZoneName").value; }catch(e){ return ""; } };
const timeStr = t => new Date(t).toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit", timeZone:tzName()});
const timeTz = t => timeStr(t) + " " + tzAbbr(t);
const dayOf = (t, z = tzName()) => new Intl.DateTimeFormat("en-CA", {timeZone:z, year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date(t));
/* ---------- desktop app bridge (Tauri). In a browser all of this stays off. ---------- */
const TAURI = window.__TAURI__ || null;
const NATIVE = !!(TAURI && TAURI.core && TAURI.core.invoke);
const nat = {
  invoke: (cmd, args) => NATIVE ? TAURI.core.invoke(cmd, args || {}) : Promise.reject(new Error("not in the desktop app")),
  win: () => TAURI.window.getCurrentWindow(),
  state: null
};
function toast(msg){ const t=$("toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"), 2200); }

/* ---------- market clock (US Eastern): all of it is in engine.js and tested there ---------- */
const etNow = () => E.etParts(Date.now());
const etDateOf = E.etDateOf, etMs = E.etMs, addDays = E.addDays, isTradingDay = E.isTradingDay, closeMins = E.closeMins, nextTradingDay = E.nextTradingDay;
/* Nasdaq overnight trading: off unless Settings → General turns it on (the free feeds have no overnight prices). */
const OVERNIGHT_FROM = E.OVERNIGHT_FROM;
const clockOpts = () => ({overnight: !!settings.overnight});
function marketClock(now = Date.now()){ return E.marketClock(now, clockOpts()); }
/* "every 30 s", "every 5 min" */
const everyStr = ms => { const sec = Math.round(ms/1000); return sec < 120 ? `every ${sec} s` : `every ${Math.round(sec/60)} min`; };
/* "2h 05m", "45m", "1d 14h" */
function fmtLeft(ms){
  const mins = Math.max(0, Math.ceil(ms / 60e3));
  if (mins < 60) return mins + "m";
  const h = Math.floor(mins / 60), mm = mins % 60;
  if (h < 24) return h + "h " + String(mm).padStart(2, "0") + "m";
  return Math.floor(h / 24) + "d " + (h % 24) + "h";
}
/* "Mon 8:30 AM" in your zone, or just the time when it's today */
const whenStr = t => dayOf(t) === dayOf(Date.now()) ? timeStr(t) : dayOf(t) === dayOf(Date.now() + 864e5) ? "tomorrow " + timeStr(t) : new Date(t).toLocaleDateString("en-US", {weekday:"short", timeZone:tzName()}) + " " + timeStr(t);
let mstat = store.get("mstat", null);   // Finnhub market status: {at, isOpen, holiday}
function session(){ return E.session(Date.now(), mstat, clockOpts()); }
/* Each refresh prices every symbol once; stretch the interval so it stays under ~45 calls a minute. */
function minRefreshSec(){ return Math.ceil(allSyms().length / 45 * 60); }   // leaves room for clicks, news and daily data
function refreshMs(){ if (+settings.refresh === 0) return null; const s = session().s; return s==="open" ? Math.max(30, +settings.refresh||60, minRefreshSec())*1000 : s==="ext" ? 5*60e3 : 30*60e3; }
/* A quote may raise an alert only while the market is open and only if its last TRADE is from today and recent (R5). */
const freshOf = q => E.freshness(q, Date.now(), session());
const alertable = q => freshOf(q).ok;

/* ---------- data: Finnhub free tier, rate-limited (55 calls / rolling minute) ---------- */
const API = "https://finnhub.io/api/v1/";
/* gen: a reset after a stuck refresh starts a new generation, so calls still in flight from the old one
   can't push the in-flight count below zero and let more than 6 run at once (the live MW's bug, R13) */
const RL = {times:[], active:0, hi:[], lo:[], timer:null, gen:0};
// low = background (metrics, calendars); "top" = something you just clicked, which jumps the queue
function limited(fn, low){ return new Promise((res, rej)=>{ const j = {fn,res,rej}; if (low === "top") RL.hi.unshift(j); else (low?RL.lo:RL.hi).push(j); pump(); }); }
function pump(){
  const now = Date.now(); RL.times = RL.times.filter(t => now - t < 60000);
  // background jobs stop at 40 a minute so prices and clicks always have room
  while ((RL.hi.length || (RL.lo.length && RL.times.length < 40)) && RL.active < 6 && RL.times.length < 55){
    const j = RL.hi.length ? RL.hi.shift() : RL.lo.shift(), gen = RL.gen;
    RL.active++; RL.times.push(Date.now());
    Promise.resolve().then(j.fn).then(j.res, j.rej).finally(()=>{ if (gen === RL.gen) RL.active = Math.max(0, RL.active - 1); pump(); });
  }
  if ((RL.hi.length || RL.lo.length) && !RL.timer){
    const wait = (RL.times.length >= 55 || (!RL.hi.length && RL.times.length >= 40)) ? (60000 - (now - RL.times[0]) + 50) : 150;
    RL.timer = setTimeout(()=>{ RL.timer = null; pump(); }, wait);
  }
}
let lastErr = "";
/* circuit breaker (R13): after 3 failed Finnhub calls in a row, pause it for 1, 2, 4 ... up to 15 minutes
   instead of hammering a feed that is down; the Twelve Data backup covers watchlist prices meanwhile */
let fhBreaker = {fails:0, openUntil:0, trips:0};
async function api(path){
  if (E.breakerOpen(fhBreaker, Date.now())) throw new Error("Finnhub paused after repeated failures; trying again at " + timeStr(fhBreaker.openUntil) + ".");
  let r;
  try{ r = await fetchT(API + path + (path.includes("?")?"&":"?") + "token=" + encodeURIComponent(settings.key)); }
  catch(e){ fhBreaker = E.breaker(fhBreaker, false, Date.now()); throw e; }
  if (r.status===401||r.status===403) throw new Error("Finnhub didn't accept the key. Check it in Settings.");
  if (r.status===429){ fhBreaker = E.breaker(fhBreaker, false, Date.now()); throw new Error("Free data limit reached for this minute. Retrying shortly."); }
  if (!r.ok){ if (r.status >= 500) fhBreaker = E.breaker(fhBreaker, false, Date.now()); throw new Error("Data error " + r.status); }
  fhBreaker = E.breaker(fhBreaker, true, Date.now());
  const j = await r.json();
  if (settings.record) tapeAdd("finnhub", path, j);
  return j;
}

let quotes = store.get("lastQuotes", {});   // sym -> quote; kept so the app opens instantly with last known values
let metrics = store.get("metrics", {});     // sym -> {date, hi, lo, r:{5D,MTD,...}}
let spark = store.get("spark", {});         // {date: {sym:[prices]}}
let lastUpdate = store.get("lastUpdate", 0);

/* ---------- fast prices (4.4): Alpaca's free IEX feed, every ticker in one call ----------
   Optional. With an Alpaca key (a free paper-trading account is enough; it can't touch real money) MW asks for all
   its tickers in one call every 5 seconds while the market is open, and also in pre-market and after hours while MW
   is on screen (4.8; 15 seconds before). While the market is closed it checks every 10 minutes, so the last
   after-hours trade stays the price shown overnight and over the weekend. The keys stay in this browser and are sent only to Alpaca. Finnhub keeps
   running as the full-market source for the previous close, open, high and low. IEX is one exchange, so its
   pre-market and after-hours prices are a guide, not the whole market. */
const ALP = "https://data.alpaca.markets/v2/stocks/snapshots";
const alpOn = () => !!(settings.alpKey && settings.alpSec && settings.fast !== false);
const alpSt = {ok:0, fail:0, at:0, err:"", n:0, pauseUntil:0, ms:0};
let extq = store.get("extq", {});   // sym -> {p, t (ms), ph:"pre"|"after"}: the latest pre-market or after-hours trade
let fastTimer = null, fastBusy = false, lastQSave = 0, ptrDown = false, renderOwed = false;
async function alpSnap(syms, kid, sec){
  const r = await fetchT(ALP + "?feed=iex&symbols=" + syms.map(encodeURIComponent).join(","), {headers:{"APCA-API-KEY-ID":kid || settings.alpKey, "APCA-API-SECRET-KEY":sec || settings.alpSec}, cache:"no-store"}, 8000);
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error("Alpaca didn't accept the keys. Check them in Settings."), {auth:true});
  if (r.status === 429) throw new Error("Alpaca's free limit was reached for this minute");
  if (!r.ok) throw new Error("Alpaca answered " + r.status);
  const j = await r.json();
  if (settings.record) tapeAdd("alpaca", "snapshots", j);
  return j;
}
/* redraw now, or right after the mouse button comes up (a redraw under a press would swallow the click) */
function liveRender(){ if (ptrDown || dragSym){ renderOwed = true; return; } renderOwed = false; renderAll(); }
window.addEventListener("pointerdown", ()=>{ ptrDown = true; }, true);
window.addEventListener("pointerup", ()=>{ ptrDown = false; if (renderOwed) setTimeout(liveRender, 60); }, true);
window.addEventListener("pointercancel", ()=>{ ptrDown = false; }, true);
async function fastTick(){
  const ses = session().s;
  if (!alpOn() || fastBusy || Date.now() < alpSt.pauseUntil) return;
  if (ses !== "open" && document.hidden) return;   // pre/after-hours prices only matter while you're looking
  // closed (night, weekend, holiday): one call every 10 minutes keeps the last after-hours trade known
  if (ses !== "open" && ses !== "ext" && alpSt.at && Date.now() - alpSt.at < 10*60e3 && !alpSt.err) return;
  fastBusy = true; const t0 = Date.now();
  try{
    const syms = allSyms().filter(s => /^[A-Z][A-Z.]{0,6}$/.test(s)), out = {};
    for (let i = 0; i < syms.length; i += 100) Object.assign(out, await alpSnap(syms.slice(i, i + 100)));
    const now = Date.now(); let n = 0, changed = false;
    Object.keys(out).forEach(sym => {
      const v = E.fromSnapshot(out[sym], now);
      if (v.reg){
        const prev = quotes[sym], same = !!(prev && prev.at && etDateOf(prev.at) === etNow().date);
        const cand = E.mergeQuote(prev, v.reg, same);
        if (badPrint(sym, cand)) return;
        if (!prev || prev.c !== cand.c) changed = true;
        takeQuote(sym, v.reg, now); n++;
      }
      if (v.ext){ const e0 = extq[sym]; if (!e0 || e0.t !== v.ext.t || e0.p !== v.ext.p) changed = true; extq[sym] = v.ext; }
    });
    Object.assign(alpSt, {ok:alpSt.ok + 1, at:now, err:"", n, got:Object.keys(out).length, fail:0, ms:now - t0});
    if (n) lastUpdate = now;
    if (now - lastQSave > 30e3){ lastQSave = now; store.set("lastQuotes", quotes); store.set("spark", spark); store.set("ticks", ticks); store.set("extq", extq); store.set("lastUpdate", lastUpdate); }
    if (changed){ safe("day line", pfDayAdd); liveRender(); if (ses === "open") checkAlerts(); }
  }catch(e){
    alpSt.fail++; alpSt.err = e.message;
    alpSt.pauseUntil = Date.now() + (e.auth ? 10*60e3 : alpSt.fail >= 3 ? Math.min(15, 2 ** (alpSt.fail - 3)) * 60e3 : 0);
    if (alpSt.fail <= 3 || e.auth) mwLog("warn", "fast prices: " + e.message);
  }finally{ fastBusy = false; }
}
function fastSchedule(spent){
  clearTimeout(fastTimer);
  const s = session().s, ms = !alpOn() ? 30e3 : s === "open" || s === "ext" ? 5e3 : 60e3;
  // the next call is timed from the start of this one, so a slow answer doesn't stretch the 5 seconds
  fastTimer = setTimeout(async ()=>{ const t0 = Date.now(); try{ await fastTick(); }catch(e){} fastSchedule(Date.now() - t0); }, Math.max(250, ms - (spent || 0)));
}
/* the latest pre-market or after-hours trade for a ticker, against the regular close it follows */
function extFor(sym){
  const e = extq[sym], q = quotes[sym]; if (!alpOn() || !E.extLive(e, q, session().s)) return null;
  return {p:e.p, pct:(e.p / q.c - 1) * 100, ph:e.ph, t:e.t, base:q.c};
}
/* the latest known price (4.8): the regular price in market hours; before and after them, the latest pre-market or
   after-hours trade once there is one, kept through the night and the weekend. Changes on the day, alerts and the
   portfolio's value stay on the regular session. */
const lastPx = sym => { const x = extFor(sym), q = quotes[sym]; return x ? x.p : q && q.c > 0 ? q.c : null; };
const extTag = x => x ? `<i class="xt" title="${x.ph === "pre" ? "Pre-market" : "After-hours"} trade at ${esc(dateTime(x.t) + " " + tzAbbr(x.t))} on IEX: the latest known price">${x.ph === "pre" ? "Pre" : "AH"}</i>` : "";

const xaOn = ()=> !cfg.hiddenMk.includes("__xa");
function marketSyms(){ return [...cfg.myMk, ...[...MARKETS.indices, ...MARKETS.sectors, ...MARKETS.other].map(m=>m.sym).filter(s=>!cfg.hiddenMk.includes(s)), ...(xaOn()?XASSET.map(x=>x.sym):[])]; }
function mySyms(){ const s = new Set(); cfg.watch.forEach(w=>w.sym && s.add(w.sym.toUpperCase())); cfg.holdings.forEach(h=>h.sym && !isFund(h.sym) && s.add(h.sym.toUpperCase())); return [...s]; }
const health = {ok:0, total:0, fail:[], backup:[], bad:[], badWhy:{}, err:"", at:0, xdiff:null, ms:0};
/* bad prints (R5): the allowed jump scales with each symbol's own volatility (6 normal days, at least 8% for a
   stock or 4% for a broad ETF); the first price of the day is checked against yesterday's close; a quote whose
   price and % change disagree is dropped. A big move is held for one refresh and shown once the next agrees. */
const pendingPx = {};
function badPrint(sym, q){
  const prev = quotes[sym], same = prev && prev.c > 0 && prev.at && etDateOf(prev.at) === etNow().date ? prev : null;
  const v = E.screenQuote(q, same, volOf(sym), E.BROAD.has(sym), pendingPx[sym]);
  if (v.action === "accept"){ delete pendingPx[sym]; delete health.badWhy[sym]; return false; }
  if (v.action === "hold") pendingPx[sym] = v.hold;
  health.badWhy[sym] = v.why; mwLog("warn", `${sym}: ${v.action === "hold" ? "held" : "dropped"} a quote (${v.why})`);
  return true;
}
/* while a big move waits for its confirming refresh, say so on the row instead of showing the old price silently */
function heldChip(sym){
  const p = pendingPx[sym], prev = quotes[sym];
  if (!p || !prev || !(prev.c > 0)) return "";
  const ch = (p/prev.c - 1)*100;
  return `<span class="chip" style="color:var(--warn);border-color:var(--warn)" title="A ${fmtPct(ch,0)} move came in. MW holds it for one refresh to rule out a bad print, then shows it if the next price agrees.">${fmtPct(ch,0)}? confirming…</span>`;
}
/* timestamped prices for today (for the "fast drop" rule); kept for the day */
let ticks = store.get("ticks", {});
function pushTick(sym, q){
  const day = etNow().date; if (ticks.day !== day) ticks = {day, s:{}};
  if (session().s !== "open") return;
  const a = ticks.s[sym] || (ticks.s[sym] = []); const t = Date.now();
  if (!a.length || t - a[a.length-1][0] > 20e3) a.push([t, q.c]); else a[a.length-1] = [t, q.c];
  while (a.length && t - a[0][0] > 125*60e3) a.shift();
}
/* every new price goes through here (4.4): two feeds are merged so an older trade never rolls the price back,
   the day's sparkline keeps about one point a minute, and the fast-drop rule gets its tick */
const sparkAt = {};
function sparkAdd(sym, c, day, now){
  if (session().s === "closed") return;
  if (!spark[day]) spark = {[day]:{}};
  const a = spark[day][sym] || (spark[day][sym] = []);
  if (a.length && a[a.length-1] === c) return;
  if (a.length && now - (sparkAt[sym] || 0) < 50e3) a[a.length-1] = c;
  else { a.push(c); sparkAt[sym] = now; if (a.length > 480) a.shift(); }
}
function takeQuote(sym, q, now){
  now = now || Date.now();
  const prev = quotes[sym], day = etNow().date, same = !!(prev && prev.at && etDateOf(prev.at) === day);
  const m = E.mergeQuote(prev, q, same); m.at = now; quotes[sym] = m;
  pushTick(sym, m); sparkAdd(sym, m.c, day, now);
  return m;
}
async function refreshOne(sym, quiet){
  if (!settings.key) return;
  if (!quiet) toast("Updating " + sym + "…");
  try{
    let q = null;
    try{ q = await limited(()=>api("quote?symbol=" + encodeURIComponent(sym)), "top"); }catch(e){}
    if (!(q && q.c)) q = await backupQuote(sym).catch(()=>null);
    if (q && q.c){ if (!q.src) q.src = "finnhub"; q = takeQuote(sym, q); store.set("lastQuotes", quotes); store.set("ticks", ticks); store.set("spark", spark);
      renderAll(); checkAlerts(); if (!quiet) toast(sym + " updated · " + fmtPx(q.c));
    } else if (!quiet) toast("No price for " + sym);
  }catch(e){ if (!quiet) toast(e.message); }
}
/* refresh a group of tiles at once (the sector heatmap's ↻), within the same rate limit as everything else */
async function refreshMany(syms, label){
  if (!settings.key){ toast("Add your Finnhub key in Settings first"); return; }
  if (refreshMany.busy) return; refreshMany.busy = true; safe("markets", renderMarkets);
  let ok = 0;
  try{
    await Promise.all(syms.map(async sym => { let q = null;
      try{ q = await limited(()=>api("quote?symbol=" + encodeURIComponent(sym)), "top"); }catch(e){}
      if (q && q.c){ q.src = "finnhub"; takeQuote(sym, q); ok++; } }));
    store.set("lastQuotes", quotes); store.set("ticks", ticks);
  } finally { refreshMany.busy = false; }
  mwLog("info", label + " refreshed: " + ok + " of " + syms.length);
  renderAll(); checkAlerts(); toast(ok ? `${label} updated` + (ok < syms.length ? ` (${ok} of ${syms.length})` : "") : "No prices came back. Try again in a minute.");
}
function allSyms(){
  const s = new Set();
  cfg.holdings.forEach(h=>h.sym && !isFund(h.sym) && s.add(h.sym.toUpperCase()));
  cfg.watch.forEach(w=>w.sym && s.add(w.sym.toUpperCase()));
  marketSyms().forEach(x => s.add(x));
  if (settings.bench) s.add(settings.bench);
  proxySyms().forEach(x => s.add(x));
  return [...s];
}

const num = v => v != null && isFinite(+v) ? +v : null;
async function loadMetrics(syms){
  const today = etNow().date;
  const need = syms.filter(s => !metrics[s] || metrics[s].date !== today || metrics[s].mv !== 2);
  await Promise.all(need.map(sym => limited(async ()=>{
    try{
      const m = (await api("stock/metric?metric=all&symbol=" + encodeURIComponent(sym))).metric || {};
      const r = {}; PERIODS.forEach(p=>{ if (p.f && m[p.f]!=null && isFinite(+m[p.f])) r[p.f] = +m[p.f]; });
      metrics[sym] = {date:today, hi: m["52WeekHigh"]!=null ? +m["52WeekHigh"] : null, lo: m["52WeekLow"]!=null ? +m["52WeekLow"] : null, r, beta: m.beta!=null && isFinite(+m.beta) ? +m.beta : null, mv:2,
        // fundamentals (4.4): already in this answer, so they cost nothing extra
        f: {cap:num(m.marketCapitalization), pe:num(m.peTTM ?? m.peExclExtraTTM), ps:num(m.psTTM), revG:num(m.revenueGrowthTTMYoy), epsG:num(m.epsGrowthTTMYoy), gm:num(m.grossMarginTTM), hiDate:m["52WeekHighDate"] || null}};
    }catch(e){ /* metrics are optional */ }
  }, true)));
  store.set("metrics", metrics);
}

/* ---------- Twelve Data (optional free key): price history, mutual fund NAVs, backup quotes ----------
   Free plan: 8 calls a minute, 800 a day. One ledger (R13) splits the day between features, so VWAP can't
   starve history or backups. A credit is counted when Twelve Data answers (even with an error), not when a
   call is queued. */
const TD = {times:[], q:[], timer:null};
let tdLedger = E.budgetFresh(store.get("tdLedger", null), etNow().date);
function tdBudget(){ const d = etNow().date; if (tdLedger.date !== d) tdLedger = E.budgetFresh(null, d); return tdLedger; }
function tdCall(path, cat){
  cat = cat || "other";
  const ok = E.budgetAllow(tdBudget(), cat, 1);
  if (!ok.ok) return Promise.reject(new Error("Twelve Data budget: " + ok.why));
  return new Promise((res, rej)=>{ const job = {path,res,rej,cat}; path.startsWith("quote") ? TD.q.unshift(job) : TD.q.push(job); tdPump(); });
}
function tdPump(){
  const now = Date.now(); TD.times = TD.times.filter(t => now - t < 61000);
  while (TD.q.length && TD.times.length < 7){
    const j = TD.q.shift(); TD.times.push(Date.now());
    fetchT("https://api.twelvedata.com/" + j.path + "&apikey=" + encodeURIComponent(settings.tdKey))
      .then(r => { tdLedger = E.budgetCharge(tdBudget(), j.cat, 1); store.set("tdLedger", tdLedger); return r.json(); })
      .then(js => { if (settings.record && j.cat !== "hist") tapeAdd("twelvedata", j.path, js); if (js.status === "error") throw new Error(js.message || "Twelve Data error"); j.res(js); })
      .catch(e => j.rej(e));
  }
  if (TD.q.length && !TD.timer) TD.timer = setTimeout(()=>{ TD.timer = null; tdPump(); }, 61000 - (now - TD.times[0]) + 100);
}

/* failover: if Finnhub can't price a symbol, ask Twelve Data instead (the "backup" share of the day's budget) */
async function backupQuote(sym, cat){
  if (!settings.tdKey) return null;
  const j = await tdCall("quote?symbol=" + encodeURIComponent(sym), cat || "backup");
  if (!j.close) return null;
  const t = +j.last_quote_at || +j.timestamp || 0;
  return {c:+j.close, pc:+j.previous_close, d:+j.change, dp:+j.percent_change, h:+j.high, l:+j.low, o:+j.open, t, src:"twelvedata"};
}
let hist = store.get("hist", {});   // sym -> {v, date, last:{d,c}, refs:{5D:{d,c},...}, sma.., vol, ve, r5, bars (70, watchlist only)}
function addMonths(dateStr, n){ const d = new Date(dateStr + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0,10); }
/* a failed history load is retried after 5, 15 and 45 minutes, then left for the day (R5) */
const HIST_RETRY = [5, 15, 45];
async function loadHist(syms){
  if (!settings.tdKey) return;
  const today = etNow().date;
  if (loadHist.day !== today){ loadHist.day = today; loadHist.busy = new Set(); loadHist.fails = {}; }
  const watchSet = new Set(cfg.watch.map(w => (w.sym||"").toUpperCase()));
  const canTry = s => { const f = loadHist.fails[s]; return !f || (f.n <= HIST_RETRY.length && Date.now() >= f.next); };
  const need = [...new Set(syms)].filter(s => (!hist[s] || hist[s].date !== today || hist[s].v !== 5 || (watchSet.has(s) && !hist[s].bars)) && !loadHist.busy.has(s) && canTry(s));
  need.forEach(s => loadHist.busy.add(s));
  const fail = (sym, why) => { const f = loadHist.fails[sym] || {n:0}; f.n++; f.why = why; f.next = Date.now() + (HIST_RETRY[f.n - 1] || 1e9) * 60e3; loadHist.fails[sym] = f; mwLog("warn", `history for ${sym} failed (${why}); ${f.n <= HIST_RETRY.length ? "retrying in " + HIST_RETRY[f.n - 1] + " min" : "giving up for today"}`); };
  for (const sym of need){
    tdCall("time_series?symbol=" + encodeURIComponent(sym) + "&interval=1day&outputsize=1300", "hist").then(js=>{
      const done = (js.values || []).filter(v => v.datetime < today);   // newest first, completed days only
      const vals = done.map(v => ({d:v.datetime.slice(0,10), c:+v.close}));
      if (!vals.length){ fail(sym, "no daily bars returned"); return; }
      delete loadHist.fails[sym];
      const refs = {};
      PERIODS.forEach(p=>{
        let r = null;
        if (p.sessions) r = vals[p.sessions-1] || null;
        else if (p.months){ const t = addMonths(today, p.months); r = vals.find(v => v.d <= t) || null; if (r && vals[vals.length-1].d > t) r = null; }
        else if (p.ytd){ const t = today.slice(0,4) + "-01-01"; r = vals.find(v => v.d < t) || null; }
        if (r) refs[p.k] = r;
      });
      const cl = vals.map(v => v.c), avg = n => E.sma(cl, n);
      // σ (R12): exponentially weighted (reacts to a calmer or wilder market within weeks), with robust and tail reads alongside
      const ve = E.volEstimate(cl.slice(0, 260)), vol = ve.sigma;
      const c4 = cl.length > 4 ? cl[4] : null;   // the close 5 sessions before today: today's 5-day change is price / c4
      const allBars = done.map(v => [v.datetime.slice(0,10), +v.open, +v.high, +v.low, +v.close, +v.volume || 0]);
      // watchlist tickers keep ~3 months of daily bars here for the anchored VWAP and daily range; every symbol's full
      // history (up to ~5 years) goes to this PC's database for the risk figures
      const bars = watchSet.has(sym) ? allBars.slice(0, 70) : null;
      hist[sym] = {v:5, date:today, last:vals[0], refs, sma20:avg(20), sma50:avg(50), sma100:avg(100), sma200:avg(200), vol, ve, c4, bars, n:allBars.length, src:"Twelve Data daily bars"};
      delete statsCache[sym];
      barsMem[sym] = allBars; idbPut("bars", {sym, date:today, bars:allBars}).catch(()=>{});
      if (chSym === sym) safe("chart", drawChart);
      store.set("hist", hist); renderMarkets(); riskDirty = true;
      clearTimeout(fitFunds._t); fitFunds._t = setTimeout(()=> safe("fund fit", fitFunds), 1500);
    }).catch(e => fail(sym, String(e && e.message || e))).finally(()=>loadHist.busy.delete(sym));
  }
}

/* exchange calendar: is the market really open today? (1 call every 10 min on weekdays) */
async function loadMarketStatus(){
  const t = etNow(); if (t.day==="Sat"||t.day==="Sun") return;
  if (mstat && mstat.date === t.date && Date.now() - mstat.at < 10*60e3) return;
  try{ const j = await limited(()=>api("stock/market-status?exchange=US"), true);
    mstat = {at:Date.now(), date:t.date, isOpen: j.isOpen, holiday: j.holiday || null}; store.set("mstat", mstat);
  }catch(e){}
}
/* earnings dates for everything you own or watch, plus chip bellwethers (1 call a day) */
let earn = store.get("earn", {});   // {date, map:{SYM:{d, hour}}}
async function loadEarnings(){
  const today = etNow().date; if (earn.date === today && earn.v === 2) return;
  try{
    const to = new Date(Date.now() + 35*864e5).toISOString().slice(0,10);
    const j = await limited(()=>api(`calendar/earnings?from=${today}&to=${to}`), true);
    const want = new Set([...mySyms(), ...cfg.myMk, ...BELLWETHERS]), map = {};
    (j.earningsCalendar || []).forEach(e => { if (want.has(e.symbol) && e.date >= today && (!map[e.symbol] || e.date < map[e.symbol].d)) map[e.symbol] = {d:e.date, hour:e.hour||"", eps:num(e.epsEstimate), rev:num(e.revenueEstimate)}; });
    earn = {date:today, map, v:2}; store.set("earn", earn);
  }catch(e){}
}
function erInfo(sym){
  const e = earn.map && earn.map[sym]; if (!e) return null;
  const days = Math.round((new Date(e.d+"T12:00:00Z") - new Date(etNow().date+"T12:00:00Z"))/864e5);
  if (days < 0) return null;
  return {d:e.d, hour:e.hour, days, label:`ER ${(+e.d.slice(5,7))}/${(+e.d.slice(8,10))}${e.hour==="amc"?" pm":e.hour==="bmo"?" am":""}`};
}
const fmtBig$ = n => n == null ? "—" : Math.abs(n) >= 1e9 ? "$" + (n/1e9).toFixed(2) + "B" : Math.abs(n) >= 1e6 ? "$" + (n/1e6).toFixed(1) + "M" : fmt$(n, 0);
function erTip(sym){
  const e = erInfo(sym), m = earn.map && earn.map[sym]; if (!e) return "";
  return `Earnings ${e.d}${e.hour==="amc"?" after the close":e.hour==="bmo"?" before the open":""} (${e.days===0?"today":e.days===1?"tomorrow":"in "+e.days+" days"})`
    + (m && (m.eps != null || m.rev != null) ? `\nAnalysts expect${m.eps != null ? " EPS " + fmt$(m.eps) : ""}${m.eps != null && m.rev != null ? " and" : ""}${m.rev != null ? " revenue " + fmtBig$(m.rev) : ""} (Finnhub consensus)` : "");
}
/* ---------- earnings panel (4.5): this week and next, for your tickers, tiles and the chip bellwethers ---------- */
let erHist = store.get("erHist", {});   // sym -> {date, rows:[{period, actual, estimate, sp}]}: the last reported quarters (Finnhub)
async function loadErHist(syms){
  const today = etNow().date; let got = 0;
  for (const sym of syms){
    const h = erHist[sym], e = earn.map && earn.map[sym];
    if (h && h.date > addDays(today, -7) && !(e && h.date <= e.d && today > e.d)) continue;   // weekly, and again after it reports
    try{ const j = await limited(()=>api("stock/earnings?symbol=" + encodeURIComponent(sym)));
      erHist[sym] = {date:today, rows:(Array.isArray(j) ? j : []).slice(0, 8).map(x => ({period:x.period, actual:num(x.actual), estimate:num(x.estimate), sp:num(x.surprisePercent)}))}; got++; }
    catch(e){ mwLog("warn", "earnings history " + sym + ": " + e.message); }
  }
  if (got) store.set("erHist", erHist);
}
/* reports from today to the end of next week (on a weekend, "this week" is the coming one) */
function erUpcoming(){
  const today = etNow().date, wd = E.weekday(today), base = wd === 6 ? addDays(today, 2) : wd === 0 ? addDays(today, 1) : today;
  const endThis = addDays(base, 7 - E.weekday(base)), endNext = addDays(endThis, 7), mine = new Set(mySyms());
  return [...new Set([...mySyms(), ...cfg.myMk, ...BELLWETHERS])].map(sym => ({sym, e:earn.map && earn.map[sym], mine:mine.has(sym)}))
    .filter(x => x.e && x.e.d >= today && x.e.d < endNext)
    .map(x => Object.assign(x, {wk: x.e.d < endThis ? "This week" : "Next week"}))
    .sort((a, b) => a.e.d.localeCompare(b.e.d) || (a.e.hour === "bmo" ? -1 : 1) - (b.e.hour === "bmo" ? -1 : 1));
}
function erMoveOf(sym){
  const h = erHist[sym], bars = barsMem[sym]; if (!h || !h.rows.length || !bars) return null;
  const mv = E.erMoves(bars, h.rows.slice(0, 4).map(r => r.period).filter(Boolean)); if (!mv.length) return null;
  return {avg: mv.reduce((s, m) => s + Math.abs(m.move), 0) / mv.length, list: mv};
}
function erPanelHtml(){
  const up = erUpcoming(); if (!up.length) return "";
  const hdr = `<div class="toolbar"><button class="sec-t" data-act="erpanel" style="flex:1;font-size:11px;text-align:left;display:flex;align-items:center;gap:4px" title="Show or hide upcoming earnings"><svg class="chev" style="width:11px;height:11px;${settings.erHide?"transform:rotate(-90deg)":""}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>Earnings · ${up.length} in the next two weeks</button></div>`;
  if (settings.erHide) return hdr;
  let wk = "";
  return hdr + `<div class="erp">` + up.map(x => {
    const e = x.e, h = erHist[x.sym], last = h && h.rows.find(r => r.actual != null), mv = erMoveOf(x.sym);
    const day = new Date(e.d + "T12:00:00Z").toLocaleDateString("en-US", {weekday:"short", timeZone:"UTC"}) + " " + (+e.d.slice(5, 7)) + "/" + (+e.d.slice(8, 10));
    const when = day + (e.hour === "amc" ? " · after the close" : e.hour === "bmo" ? " · before the open" : "");
    const est = [e.eps != null ? "EPS est " + fmt$(e.eps) : "", e.rev != null ? "sales est " + fmtBig$(e.rev) : ""].filter(Boolean).join(" · ");
    const lastTxt = last && last.sp != null ? `last quarter ${last.sp >= 0 ? "beat" : "missed"} by <b class="${cls(last.sp)}">${Math.abs(last.sp).toFixed(1)}%</b>` : "";
    const mvTip = mv ? `Average move on its last ${mv.list.length} report day${mv.list.length > 1 ? "s" : ""}, close to close: ${mv.list.map(m => m.d.slice(5).replace("-", "/") + " " + fmtPct(m.move, 1)).join(", ")}. Report days are estimated from daily prices (the biggest opening gap after each quarter).` : "Typical report-day move: needs this ticker's price history (Twelve Data key) and its past results.";
    const head = x.wk !== wk ? `<div class="erwk">${(wk = x.wk)}</div>` : "";
    return head + `<div class="erw"><span class="s"><b>${esc(x.sym)}</b>${x.mine ? "" : `<small title="Not on your lists: a chip bellwether that moves the group">bellwether</small>`}</span><span class="when">${esc(when)}</span><span class="mv num" title="${esc(mvTip)}">${mv ? "±" + mv.avg.toFixed(1) + "%" : "—"}</span>${est || lastTxt ? `<span class="sub"><span class="in">${[...est.split(" · ").filter(Boolean).map(t => `<span>${esc(t)}</span>`), lastTxt ? `<span>${lastTxt}</span>` : ""].filter(Boolean).join("")}</span></span>` : ""}</div>`;
  }).join("") + `<div class="note" style="margin-top:4px">± is the typical report-day move. Estimates are Finnhub's analyst consensus.</div></div>`;
}
/* the earnings chip: "ER 2/14" on tight rows; the watchlist adds am/pm ("ER 2/14 pm"). The tooltip says the rest.
   The date is a span of its own: the compact strip drops it ("ER") when a row has no room, so a chip is never cut. */
const erChip = (sym, full) => { const e = erInfo(sym); return e ? `<span class="er ${e.days<=5?"soon":""}" title="${esc(erTip(sym))}">ER<span class="dt">${(full ? e.label : e.label.replace(/ [ap]m$/, "")).slice(2)}</span></span>` : ""; };
/* ---------- daily range (ATR) + VWAP ----------
   Daily numbers come from completed sessions only, so they are set before the open and hold all day. */
const statsCache = {};
const mdLabel = E.mdLabel;
/* daily numbers (Wilder ATR, anchored VWAP, support) come from engine.js; cached per symbol per day */
function dailyStats(sym){
  const h = hist[sym]; if (!h || !h.bars || h.bars.length < 16) return null;
  const hit = statsCache[sym]; if (hit && hit.date === h.date) return hit.st;
  const st = E.dailyStats(h.bars);
  statsCache[sym] = {date:h.date, st}; return st;
}
/* today's VWAP from 5-minute bars (Twelve Data, about every 10 min per watchlist ticker while the market is open) */
let vwap = store.get("vwap", {});
function sessVwap(sym, maxAgeMin = 25){
  const d = vwap.day === etNow().date && vwap.s && vwap.s[sym];
  return d && d.vw && Date.now() - d.at < maxAgeMin * 60e3 ? d : null;
}
function anchorVwap(sym){
  const s = dailyStats(sym); if (!s || !s.anchor.vw) return null;
  const t = sessVwap(sym, 60);   // fold today's trading in when we have it
  return {vw: t ? (s.anchor.pv + t.pv) / (s.anchor.v + t.v) : s.anchor.vw, d:s.anchor.d, why:s.anchor.why};
}
async function loadVwap(){
  if (!settings.tdKey || session().s !== "open") return;
  const day = etNow().date; if (vwap.day !== day) vwap = {day, s:{}};
  if (etNow().mins < 575) return;   // wait for the first few 5-minute bars
  // VWAP is opt-in per ticker in the lab (R21b); its share of the day's Twelve Data budget caps it
  const syms = cfg.watch.filter(w => w.on !== false && w.vwapOn === true).map(w => (w.sym||"").toUpperCase()).filter(Boolean).slice(0, 8);
  for (const sym of syms){
    const cur = vwap.s[sym];
    if (cur && (Date.now() - cur.at < 10*60e3 || (cur.busyAt && Date.now() - cur.busyAt < 90e3))) continue;
    vwap.s[sym] = Object.assign({}, cur, {busyAt: Date.now()});
    tdCall("time_series?symbol=" + encodeURIComponent(sym) + "&interval=5min&outputsize=80", "vwap").then(js => {
      let pv = 0, v = 0, n = 0;
      (js.values || []).forEach(b => { if (b.datetime.slice(0,10) !== day) return; const vol = +b.volume || 0; pv += (+b.high + +b.low + +b.close) / 3 * vol; v += vol; n++; });
      vwap.s[sym] = v ? {pv, v, vw: pv / v, n, at: Date.now()} : {at: Date.now(), none: true};
      store.set("vwap", vwap); safe("watchlist", renderWatch);
    }).catch(e => { vwap.s[sym] = {at: Date.now(), err: String(e && e.message || e)}; });
  }
}

/* fill today's sparklines from 9:30 when the app opens mid-day (Twelve Data, 1 credit per symbol, once a day) */
async function loadIntraday(){
  if (!settings.tdKey || session().s === "closed") return;
  const day = etNow().date, done = store.get("intraDone", {}); if (done.date !== day){ done.date = day; done.syms = []; }
  if (etNow().mins < 580) return;
  for (const sym of mySyms().slice(0, 16)){
    if (done.syms.includes(sym)) continue;
    done.syms.push(sym); store.set("intraDone", done);
    tdCall("time_series?symbol=" + encodeURIComponent(sym) + "&interval=5min&outputsize=80", "intraday").then(js=>{
      const pts = (js.values || []).filter(v => v.datetime.slice(0,10) === day).map(v => +v.close).reverse();
      if (pts.length < 3) return;
      if (!spark[day]) spark = {[day]:{}};
      const cur = spark[day][sym] || [];
      if (cur.length < pts.length){ spark[day][sym] = pts.concat(cur.slice(-1)); store.set("spark", spark); renderAll(); }
    }).catch(()=>{});
  }
}
/* headlines for a row you open (1 call, cached 15 min), merged with what the News section already has */
const newsCache = {};
const nwNorm = (n, sym) => ({id:n.id, sym, h:n.headline, sum:n.summary, src:n.source, url:n.url, t:+n.datetime * 1000});
async function loadNews(sym){
  const c = newsCache[sym]; if (c && (c.loading || Date.now() - c.at < 15*60e3)) return;
  newsCache[sym] = {loading:true, at:Date.now(), items:c ? c.items : null};
  const to = etNow().date, from = addDays(to, -3);
  try{ const j = await limited(()=>api(`company-news?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}`), "top");
    newsCache[sym] = {at:Date.now(), items:E.newsMerge((Array.isArray(j)?j:[]).map(n => nwNorm(n, sym)), Date.now(), {max:8})};
  }catch(e){ newsCache[sym] = {at:Date.now(), items:[], err:e.message}; }
  renderPortfolio(); renderWatch();
}
function rowNews(sym){
  const c = newsCache[sym], seen = new Set(), out = [];
  [...((c && c.items) || []), ...newsItems().filter(n => n.syms.includes(sym))].sort((a, b) => b.t - a.t).forEach(n => { const k = E.newsKey(n.h); if (!seen.has(k)){ seen.add(k); out.push(n); } });
  return out;
}
function newsHtml(sym){
  const c = newsCache[sym], L = rowNews(sym);
  if (!L.length && (!c || c.loading)) return `<div class="news muted">Loading headlines…</div>`;
  if (!L.length) return `<div class="news muted">No headlines for ${esc(sym)} in the last 3 days${c && c.err ? " (" + esc(c.err) + ")" : ""}.</div>`;
  return `<div class="news">${L.slice(0, 4).map(n => `<a href="${esc(n.url)}" target="_blank" rel="noopener" data-nwgo="${esc(n.id)}" class="${nwIsNew(n) ? "new" : ""}"${n.sum && E.newsKey(n.sum) !== E.newsKey(n.h) ? ` title="${esc(n.sum)}"` : ""}><span>${esc(n.h)}</span><small>${esc(n.src)}${n.src ? " · " : ""}${E.agoShort(n.t, Date.now())} ago</small></a>`).join("")}${L.length > 4 || newsItems().some(n => n.syms.includes(sym)) ? `<button class="rbtn" data-nwjump="${esc(sym)}" title="Open the News section showing only ${esc(sym)}">All ${esc(sym)} news${L.length > 4 ? " (" + L.length + ")" : ""}</button>` : ""}</div>`;
}
/* ---------- mutual funds (5.0) ----------
   A fund has one price a day (its NAV). Twelve Data's free plan posts it the next morning, so MW asks again often
   once a price is due, takes it the moment any source has it, and says which day every figure is from. In between,
   a fund can show an ESTIMATE: the move of the ETF it has tracked most closely, scaled by how it has moved with it.
   Estimates are always marked "est." and never go into the portfolio total. Funds typed into the Holdings table
   (five letters ending in X) are priced the same way, not asked for a live quote every refresh. */
let navs = store.get("navs", {});   // sym -> {nav, prev, date, src, at, tdAt, fhAt, fhNone, err}
let fundFit = store.get("fundFit", {});   // sym -> {date, sym, beta, r2, n}: the ETF each fund has tracked
const isFund = s => E.isFundSym(String(s || "").toUpperCase());
/* ETFs a fund is compared with (besides the market tiles): growth, value, international, mid caps, bonds */
const PROXY_EXTRA = ["IWF","IWD","EFV","EFG","MDY","AGG","VXUS"];
function fundSyms(){ return [...new Set([...cfg.fixed.filter(f => f.sym && +f.shares > 0).map(f => f.sym.toUpperCase()), ...cfg.holdings.filter(h => h.sym && isFund(h.sym) && +h.shares > 0).map(h => h.sym.toUpperCase())])]; }
const estOn = () => settings.fundEst !== false && !!settings.tdKey && fundSyms().length > 0;
const proxyPool = () => [...new Set([...MARKETS.indices, ...MARKETS.other].map(m => m.sym).concat(PROXY_EXTRA))];
/* the ETFs in use as stand-ins get a live price with every refresh */
function proxySyms(){ return estOn() ? [...new Set(fundSyms().map(s => fundFit[s] && fundFit[s].r2 >= FIT_MIN ? fundFit[s].sym : null).filter(Boolean))] : []; }
const FIT_MIN = 0.6;   // an estimate is shown only when the ETF explains at least 60% of the fund's daily moves
function fitFunds(){
  if (!estOn()) return;
  const today = etNow().date, pool = {}; proxyPool().forEach(s => { if (barsMem[s] && barsMem[s].length > 60) pool[s] = barsMem[s]; });
  let changed = false;
  fundSyms().forEach(sym => {
    const bars = barsMem[sym], cur = fundFit[sym]; if (!bars || bars.length < 60) return;
    if (cur && cur.date === today && cur.pool === Object.keys(pool).length) return;
    const f = E.proxyFit(bars, pool);
    fundFit[sym] = f ? Object.assign(f, {date:today, pool:Object.keys(pool).length}) : {date:today, pool:Object.keys(pool).length, sym:"", beta:0, r2:0, n:0};
    changed = true;
    if (!cur || cur.sym !== fundFit[sym].sym) mwLog("info", `fund estimate: ${sym} ` + (f ? `tracks ${f.sym} (fit ${Math.round(f.r2*100)}%, moves ${f.beta.toFixed(2)}x)` : "has no close match"));
  });
  if (changed){ store.set("fundFit", fundFit); safe("portfolio", renderPortfolio); }
}
function fundEst(sym){
  if (!estOn()) return null;
  const n = navs[sym], f = fundFit[sym]; if (!n || !(n.nav > 0) || !f || !f.sym || f.r2 < FIT_MIN) return null;
  const q = quotes[f.sym]; if (!q || !(q.c > 0)) return null;
  const qd = E.quoteDay(q.t ? q.t * 1000 : q.at); if (!qd || qd <= n.date) return null;   // the ETF hasn't traded since that price
  const e = E.navEstimate(n.nav, n.date, f, barsMem[f.sym], q.c, q.pc > 0 ? {d:E.prevTradingDay(qd), c:q.pc} : null); if (!e) return null;
  return Object.assign(e, {sym:f.sym, r2:f.r2, beta:f.beta, day:qd});
}
async function loadNav(sym, force){
  const now = Date.now(), today = etNow().date, old = navs[sym] || {}, st = Object.assign({}, old, {err:null});
  const due = (at, fast) => force || !at || now - at >= (old.err && !old.nav ? 30*60e3 : E.navWait(old.date, now, fast));
  const cands = [], errs = [], jobs = [];
  if (settings.tdKey && due(old.tdAt, false)){ st.tdAt = now;
    jobs.push(tdCall("quote?symbol=" + encodeURIComponent(sym), "nav").then(j => { if (+j.close > 0) cands.unshift({src:"Twelve Data", nav:+j.close, prev:+j.previous_close || null, date:String(j.datetime || "").slice(0, 10)}); else errs.push("Twelve Data sent no price"); })
      .catch(e => errs.push(String(e && e.message || e).slice(0, 120)))); }
  // Finnhub's free feed usually has no mutual funds (it answers 0); asked once a day in case it has this one
  if (settings.key && (force || old.fhNone !== today) && due(old.fhAt, true)){ st.fhAt = now;
    jobs.push(limited(()=>api("quote?symbol=" + encodeURIComponent(sym)), force ? "top" : true).then(q => {
      if (q && q.c > 0 && q.t > 0) cands.push({src:"Finnhub", nav:+q.c, prev:+q.pc || null, date: q.t % 86400 === 0 ? new Date(q.t * 1000).toISOString().slice(0, 10) : etDateOf(q.t * 1000)});
      else st.fhNone = today; }).catch(()=>{})); }
  if (!jobs.length) return false;
  await Promise.all(jobs);
  // a second source only counts when it agrees roughly with the price MW knows (same ticker, different thing otherwise)
  const ref = (cands.find(c => c.src === "Twelve Data") || old).nav;
  const ok = cands.filter(c => !(ref > 0) || Math.abs(c.nav / ref - 1) < 0.15);
  if (old.nav > 0) ok.push({src:old.src || "Twelve Data", nav:old.nav, prev:old.prev, date:old.date});
  const pick = cands.length ? E.pickNav(ok, null) : null;
  if (pick){
    if (pick.prevDate && pick.prevDate !== E.prevTradingDay(pick.date)) pick.prev = null;   // not the day before: no one-day change
    if (!old.date || pick.date > old.date) mwLog("info", `fund price: ${sym} ${fmt$(pick.nav)} for ${pick.date} from ${pick.src}` + (old.date ? ` (had ${old.date})` : ""));
    Object.assign(st, {nav:pick.nav, prev:pick.prev, date:pick.date, src:pick.src});
  } else if (errs.length){ st.err = errs[0]; if (!old.err) mwLog("warn", `fund price: ${sym} didn't update (${errs[0]})`); }
  st.at = now;
  navs[sym] = st; store.set("navs", navs); safe("portfolio", renderPortfolio);
  return true;
}
async function loadNavs(force){
  const syms = fundSyms(); if (!syms.length || !(settings.tdKey || settings.key)) return;
  Object.keys(navs).forEach(s => { if (!syms.includes(s)) delete navs[s]; });
  await Promise.all(syms.map(s => loadNav(s, force)));
  // price history for the funds and the ETFs they are compared with (once a day each), then the fit
  if (estOn()) loadHist([...syms, ...proxyPool()]);
}
/* everything MW knows about one fund position */
function fundInfo(sym, sh){
  const n = navs[sym]; if (!(n && n.nav > 0 && sh > 0)) return {live:false, err: n && n.err, value:0};
  const sess = E.lastSessionDate(Date.now()), cur = n.date >= sess;   // cur: this IS the price for the session the day's change is about
  const chgPct = n.prev ? (n.nav / n.prev - 1) * 100 : null, chgUsd = n.prev ? (n.nav - n.prev) * sh : null;
  const e = cur ? null : fundEst(sym);
  return {live:true, nav:n.nav, prev:n.prev, date:n.date, src:n.src || "Twelve Data", at:n.at, value:n.nav * sh, chgPct, chgUsd, cur, dayUsd: cur && chgUsd != null ? chgUsd : 0, err:n.err,
    est: e ? {pct:e.pct, usd:n.nav * sh * e.pct / 100, nav:e.nav, sym:e.sym, r2:e.r2, beta:e.beta, day:e.day} : null};
}
function fixedInfo(f){
  const sym = (f.sym||"").toUpperCase(), sh = +f.shares;
  if (sym && sh > 0){ const x = fundInfo(sym, sh); if (x.live) return x; return {value: +f.value||0, live:false, err:x.err}; }
  return {value: +f.value||0, live:false};
}
/* "Fri 11/6" for a price's day; "today" and "yesterday" when they apply */
function navDayLabel(d){
  if (!d) return ""; const today = etNow().date;
  if (d === today) return "today";
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {weekday:"short", timeZone:"UTC"}) + " " + (+d.slice(5,7)) + "/" + (+d.slice(8,10));
}
/* when the next official price is expected, in plain words */
function navNextText(x){
  if (!x || !x.live) return "";
  const due = E.navDueDate(Date.now()), t = etNow();
  if (x.date >= due) return isTradingDay(t.date) && t.mins < closeMins(t.date) ? "Today's price is set after the 4 PM ET close and is posted overnight." : "This is the latest price there is.";
  return `The ${navDayLabel(due)} price isn't posted yet: the free feed posts fund prices overnight. MW keeps checking and shows it as soon as it's there.`;
}

let busy = false;
let busyAt = 0;
/* a refresh gets 90 seconds; whatever came back by then is used and the rest is reported (R13) */
const REFRESH_DEADLINE = 90e3;
async function tick(){
  // a refresh that has run for 2+ minutes is stuck (should be impossible with the deadline); start a new generation
  if (busy && Date.now() - busyAt > 120e3){ mwLog("warn", "refresh was stuck; restarting it"); busy = false; RL.gen++; RL.active = 0; }
  if (busy) return; busy = true; busyAt = Date.now();
  $("bRefresh").classList.add("spin"); lastErr = "";
  try{
    if (!settings.key){ $("needKey").classList.remove("hide"); return; }
    $("needKey").classList.add("hide");
    const syms = allSyms(), day = etNow().date, ses = session().s, t0 = Date.now();
    // the Twelve Data backup is spent only on what you own or watch, never on market tiles
    const mine = new Set([...mySyms(), settings.bench]);
    if (!spark[day]) spark = {[day]:{}};
    let ok = 0; const fail = [], backup = [], bad = [], done = new Set();
    const all = Promise.all(syms.map(sym => limited(async ()=>{
      try{
        let q = null;
        try{ q = await api("quote?symbol=" + encodeURIComponent(sym)); if (q) q.src = "finnhub"; }catch(e){ lastErr = e.message; }
        if (!(q && q.c) && mine.has(sym)){ try{ q = await backupQuote(sym); if (q && q.c) backup.push(sym); }catch(e){} }
        if (q && q.c && badPrint(sym, q)){ bad.push(sym); q = null; }
        if (!(q && q.c)) fail.push(sym);
        if (q && q.c){ takeQuote(sym, q); ok++; }
      }catch(e){ lastErr = e.message; }
      finally{ done.add(sym); }
    })));
    let late = false;
    await Promise.race([all, new Promise(r => setTimeout(()=>{ late = true; r(); }, REFRESH_DEADLINE))]);
    if (late){ const miss = syms.filter(s => !done.has(s)); fail.push(...miss); lastErr = lastErr || `The refresh ran out of time; ${miss.length} symbol(s) didn't answer.`; mwLog("warn", "refresh hit its 90 s deadline with " + miss.length + " symbols outstanding"); }
    Object.assign(health, {ok, total:syms.length, fail, backup, bad, err:lastErr, at:Date.now(), ms:Date.now() - t0});
    if (ok){ lastUpdate = Date.now(); store.set("lastUpdate", lastUpdate); store.set("lastQuotes", quotes); store.set("spark", spark); store.set("ticks", ticks); }
    if (settings.record) tapeAdd("refresh", "summary", {ok, total:syms.length, fail, bad, ms:health.ms});
    safe("day line", pfDayAdd);
    renderAll(); checkAlerts(); watchHealth();
    crossCheck();
    loadMarketStatus().then(renderFrame);
    loadNavs(false);
    loadHist([...cfg.watch.map(w=>(w.sym||"").toUpperCase()), ...marketSyms(), ...mySyms(), "SPY", "SMH"].filter(Boolean));
    loadIntraday(); loadVwap(); loadHeadlines();
    loadEarnings().then(()=>{ renderAll(); const up = erUpcoming().map(x => x.sym); if (settings.tdKey) loadHist(up); return loadErHist(up); }).then(()=>safe("markets", renderMarkets));
    loadMetrics(syms).then(()=>{ renderAll(); checkAlerts(); });
  } finally {
    busy = false; $("bRefresh").classList.remove("spin");
    $("err").textContent = lastErr ? lastErr + (health.backup.length ? ` Using the Twelve Data backup for ${health.backup.length} symbol(s).` : "") : ""; renderAll();
    // a rejected key is shown up top (not just in the line at the bottom), with a way to fix it
    const keyBad = /didn't accept the key/.test(lastErr || "");
    $("keyBad").classList.toggle("hide", !keyBad);
    if (keyBad) $("keyBadBk").textContent = health.backup.length ? ` Meanwhile the Twelve Data backup is pricing ${health.backup.length} of your symbols.` : "";
  }
}

/* ---------- is MW actually watching? (R3) ----------
   Coverage = watchlist tickers with a fresh price that can alert. Under 50% for 5 minutes while the
   market is open is "blind": a loud pop-up (and phone alert, if set) says so, and another says when it's back.
   A Healthchecks.io ping URL, if you add one, gets a ping every 5 minutes while all is well, so you hear about it
   by email even when the PC is off or MW has crashed. */
let watchSt = store.get("watchSt", null);
function watchHealth(){
  const ses = session(), syms = settings.allOff ? [] : [...new Set(cfg.watch.filter(w => w.on !== false && w.sym).map(w => w.sym.toUpperCase()))];
  // stricter than the alert check: a ticker counts as watched only if a new price arrived in the last 3 minutes
  // (or 2.5 refreshes), so an outage is noticed in about 8 minutes, not after prices have aged out
  const lim = Math.max(3*60e3, 2.5*(refreshMs() || 60e3)), now = Date.now();
  const verdicts = {}; syms.forEach(s => { const q = quotes[s], f = freshOf(q); verdicts[s] = !f.ok ? f : now - q.at > lim ? {ok:false, why:"no new price for " + Math.round((now - q.at)/60e3) + " min"} : f; });
  const cov = E.coverage(syms, verdicts);
  health.cov = cov; health.verdicts = verdicts;
  const st = E.watchState(watchSt, cov, now, ses, 5);
  if (st.changed && !st.quiet) loudHealth(st.state === "blind", cov, verdicts);
  watchSt = {state:st.state, since:st.since, lowSince:st.lowSince}; store.set("watchSt", watchSt);
  renderBlind(ses);
  pingHealthcheck(ses, cov);
}
function blindWhy(cov, verdicts){
  const reasons = {}; cov.blind.forEach(s => { const w = (verdicts[s] || {}).why || "no price"; (reasons[w] = reasons[w] || []).push(s); });
  return Object.entries(reasons).map(([w, ss]) => `${ss.join(", ")}: ${w}`).join("; ");
}
function loudHealth(blind, cov, verdicts){
  const msg = blind ? `MW is NOT watching: only ${cov.ok} of ${cov.total} watchlist tickers have a fresh price. Dip alerts can't fire until prices come back.`
                    : `MW is watching again: ${cov.ok} of ${cov.total} watchlist tickers have fresh prices.`;
  mwLog(blind ? "warn" : "info", msg + (blind ? " (" + blindWhy(cov, verdicts) + ")" : ""));
  showToast(blind ? "MW can't see prices" : "MW is watching again", msg, "health@" + Date.now(), blind);
  if (blind && settings.sound === "on") beep(2);
  if (settings.ntfy) sendNtfy(blind ? "MW can't see prices. Alerts are off until data returns." : "MW is watching again.", blind ? "MW problem" : "MW OK", blind ? "high" : "default");
}
function renderBlind(ses = session()){
  const el = $("blind"); if (!el) return;
  let html = "";
  if (ses.s === "unknown") html = `<b>Alerts are off: MW's market calendar ends ${E.CAL_VALID_TO}.</b>MW won't guess whether the market is open on dates it hasn't been told about. Update to a newer version to turn alerts back on.`;
  else if (watchSt && watchSt.state === "blind" && health.cov) html = `<b>MW is NOT watching since ${esc(timeTz(watchSt.since))}</b>Only ${health.cov.ok} of ${health.cov.total} watchlist tickers have a fresh price, so a dip would go unnoticed. ${esc(blindWhy(health.cov, health.verdicts || {}))}.`;
  el.innerHTML = html; el.classList.toggle("show", !!html);
}
let hcLast = 0;
function pingHealthcheck(ses, cov){
  const u = (settings.hcUrl || "").trim(); if (!/^https:\/\/hc-ping\.com\/[A-Za-z0-9_\-\/]+$/.test(u)) return;
  if (ses.s !== "open" || Date.now() - hcLast < 4.5*60e3) return;
  hcLast = Date.now();
  const bad = !!(watchSt && watchSt.state === "blind");
  // no-cors: Healthchecks only needs the request to arrive; nothing about you is sent, just the hit itself
  fetchT(u + (bad ? "/fail" : ""), {method:"GET", mode:"no-cors", cache:"no-store", referrerPolicy:"no-referrer"}, 10000)
    .then(()=>{ health.hc = {at:Date.now(), fail:bad}; }).catch(e => { health.hc = {at:Date.now(), err:e.message}; });
}
/* rotating cross-check (R5): every 10 minutes one watchlist price is compared with Twelve Data's */
let xcheckAt = 0, xcheckI = 0;
function crossCheck(){
  if (!settings.tdKey || session().s !== "open" || Date.now() - xcheckAt < 10*60e3) return;
  const syms = cfg.watch.filter(w => w.on !== false && w.sym).map(w => w.sym.toUpperCase()).filter(s => quotes[s] && quotes[s].src === "finnhub");
  if (!syms.length) return;
  xcheckAt = Date.now(); const sym = syms[xcheckI++ % syms.length], fh = quotes[sym].c;
  backupQuote(sym, "xcheck").then(q => {
    if (!q || !q.c) return;
    const d = (fh / q.c - 1) * 100, lim = Math.max(1, (volOf(sym) || 2) / 2);
    health.xdiff = {sym, fh, td:q.c, d, at:Date.now(), ok: Math.abs(d) <= lim};
    if (!health.xdiff.ok) mwLog("warn", `cross-check: ${sym} ${fmt$(fh)} at Finnhub vs ${fmt$(q.c)} at Twelve Data (${fmtPct(d,1)})`);
  }).catch(()=>{});
}

/* ---------- alerts: the rules themselves are in engine.js (R1, R18); this builds their inputs ---------- */
/* levels: numbers, plus "50d" / "200d" moving averages (from daily history) */
function effLevels(w){
  let lv = (w.levels||[]).slice(); if (w.split && etNow().date >= w.split.date) lv = lv.map(x => +(x / w.split.ratio).toFixed(2));
  const h = hist[(w.sym||"").toUpperCase()];
  (w.ma||[]).forEach(n => { const v = h && h["sma"+n]; if (v) lv.push(+v.toFixed(2)); });
  return lv.sort((a,b)=>b-a);
}
// how a price alert is named in alert text: "$150", or "50-day average ($142.10)"
const lvName = (w, L) => { const h = hist[(w.sym||"").toUpperCase()]; const m = (w.ma||[]).find(n => h && h["sma"+n] && +h["sma"+n].toFixed(2) === L); return m ? `${m}-day average (${fmt$(L)})` : fmt$(L); };
const volOf = sym => { const h = hist[sym]; return h && h.vol ? h.vol : null; };
function snoozed(sym){ const t = settings.snooze[sym]; return t && t > Date.now(); }
function pausedNow(){ return settings.pauseUntil && settings.pauseUntil > Date.now(); }
function ctxFor(w){
  const sym = (w.sym||"").toUpperCase(), q = quotes[sym], now = Date.now(), fr = freshOf(q), bq = quotes[settings.bench];
  const lvMem = lvSt[sym] || {}, levels = !E.levelsLive(w, etNow().date) ? [] : effLevels(w).map(L => ({L, name:lvName(w, L), tag: w.lvRepeat === "cross" ? "#" + ((lvMem[L] || {}).n || 0) : ""}));
  return {sym, q, now, today:etNow().date, vol:volOf(sym), hi52: metrics[sym] && metrics[sym].hi, benchSym:settings.bench, benchDp: bq && bq.dp != null ? bq.dp : null,
    er:erInfo(sym), ticks:(ticks.day === etNow().date && ticks.s[sym]) || [], vwap: sessVwap(sym), levels, alertOk: fr.ok && !settings.allOff, fresh:fr};
}
let lvSt = store.get("lvSt", {});        // "every cross" price alerts: per ticker, per level {n, below, t} (4.5)
let ruleSt = store.get("ruleSt", {});    // today's rule memory per ticker: fast-drop arming, VWAP side
let offSt = store.get("offState", {});   // inside the 52-week-high zone or not (kept across days)
function evaluate(w){
  const ctx = ctxFor(w); if (!ctx.q) return [];
  return E.evaluate(w, ctx, Object.assign({}, (ruleSt.s || {})[ctx.sym] || {}, {off: offSt[ctx.sym]})).alerts;
}
function firedToday(){ const day = etNow().date; let f = store.get("fired", {}); if (f.day !== day) f = {day, ids:{}, log:[], unseen:0}; return f; }
const SHORT = {}; E.RULES.forEach(r => SHORT[r.id] = r.short);
const BUNDLE_MS = E.BUNDLE_MS;
/* "every cross": move each level's crossing memory on with a fresh price (a stale one could fake a crossing) */
function stepCross(w){
  const sym = (w.sym||"").toUpperCase(), q = quotes[sym]; if (!q || !(q.c > 0) || !freshOf(q).ok) return;
  const m = lvSt[sym] || (lvSt[sym] = {}), now = Date.now(), keep = {};
  effLevels(w).forEach(L => { keep[L] = E.levelCross(m[L], L, q.c, now); });
  lvSt[sym] = keep; store.set("lvSt", lvSt);
}
/* "once, then remove": a price alert that fired comes off the list (moving-average alerts stay) */
function doneOnce(logged){
  logged.forEach(a => {
    if (!(a.all || [a]).some(x => x.kind === "level")) return;
    const w = cfg.watch.find(x => (x.sym||"").toUpperCase() === a.sym); if (!w || w.lvRepeat !== "once") return;
    const q = quotes[a.sym], gone = (w.levels || []).filter(L => q && q.c <= L); if (!gone.length) return;
    w.levels = w.levels.filter(L => !gone.includes(L)); saveCfg("watchlist");
    mwLog("info", `${a.sym}: price alert ${gone.join(", ")} fired and was removed (set to once)`);
    toast(`${a.sym} ${gone.map(fmtL).join(", ")} alert done and removed`);
  });
}
function checkAlerts(){
  const day = etNow().date; if (ruleSt.day !== day) ruleSt = {day, s:{}};
  const items = [];
  cfg.watch.forEach(w => {
    if (w.lvRepeat === "cross") stepCross(w);
    const ctx = ctxFor(w); if (!ctx.q) return;
    const r = E.evaluate(w, ctx, Object.assign({}, ruleSt.s[ctx.sym] || {}, {off: offSt[ctx.sym]}));
    ruleSt.s[ctx.sym] = {fast:r.state.fast, vw:r.state.vw};
    if (r.state.off !== undefined) offSt[ctx.sym] = r.state.off;
    items.push({w, ctx, alerts:r.alerts});
  });
  store.set("ruleSt", ruleSt); store.set("offState", offSt);
  const alertT = Date.now();
  const r = E.bundle(items, firedToday(), alertT, {paused:pausedNow(), allOff:settings.allOff, snoozed, timeStr});
  store.set("fired", r.fired); renderLog(); updateBadge();
  (r.logged || []).forEach(a => { if (a.sym) firedAt[a.sym] = Date.now(); });
  doneOnce(r.logged || []);
  if ((r.logged || []).length) safe("watchlist", renderWatch);
  if (r.fresh.length) notify(r.fresh, alertT);
}
function updateBadge(){
  const n = firedToday().unseen || 0, b = $("badge");
  b.textContent = n > 9 ? "9+" : n; b.classList.toggle("hide", !n);
  try{ if (navigator.setAppBadge){ n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } }catch(e){}
  updateTray();
}
function markSeen(){ const f = firedToday(); f.unseen = 0; f.unseenSyms = []; store.set("fired", f); updateBadge(); }
let bannerSyms = [], bannerDay = "", lastLoud = 0, lastToast = 0, lastAlertAt = 0, heldToasts = [];   // held: {sym, msg}
const QUIET_MS = 5*60e3;   // in a flush: at most one sound and one pop-up every 5 minutes (new levels always get through)
function notify(list, T){
  const rank = {level:0, vwap:1, fast:1, red:1, sig:1, hd:2, off:3, near:5, test:6};
  list = list.slice().sort((a,b)=>(rank[a.kind]??4)-(rank[b.kind]??4));
  const main = list[0], urgent = list.filter(a => a.kind !== "near");
  const syms = list.map(a=>a.sym).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i);
  const b = $("banner"); bannerSyms = syms; bannerDay = etNow().date;
  b.className = "k-" + (main.kind==="near" ? "near" : main.kind==="test" ? "test" : "hit");
  const who = syms.length === 1 ? syms[0] : syms.length > 1 ? "these " + syms.length : "";
  const rest = list.slice(1).map(a => (a.sym||"") + (a.kind==="level" ? " (price alert)" : ""));
  b.innerHTML = esc(main.msg) + (rest.length ? `<small>+${rest.length} more: ${esc([...new Set(rest)].join(", "))}</small>` : "") +
    `<div class="acts">${who?`<button data-snz="30">Snooze ${esc(who)} 30m</button><button data-snz="day">Mute ${esc(who)} today</button>`:""}<button data-snz="ok">OK</button></div>`;
  b.classList.remove("show"); void b.offsetWidth; b.classList.add("show");
  const now = Date.now(), hasLevel = list.some(a => a.kind === "level"), isTest = main.kind === "test";
  lastAlertAt = Date.now();
  // sound: levels always; other alerts at most once per QUIET_MS
  if (!urgent.length) return;   // heads-ups stay in the window: banner only, no sound or pop-up
  if (settings.sound === "on" && (hasLevel || isTest || now - lastLoud > QUIET_MS)){ beep(main.kind === "near" ? 1 : 3); lastLoud = now; }
  // one Windows pop-up per batch; heads-ups never ride along with urgent alerts
  const body = urgent.map(a => a.msg);
  if (hasLevel || isTest || now - lastToast > QUIET_MS){
    // newest (and most important) line leads; anything held earlier rides along as "+N more"
    const lines = [...body, ...takeHeld().map(h => h.msg)]; lastToast = now;
    showToast("Market alert", lines[0] + (lines.length > 1 ? `\n+${lines.length-1} more in MW` : ""), (main.id||"x") + "@" + bannerDay, true);
  } else { heldToasts.push(...urgent.map(a => ({sym:a.sym, msg:a.msg}))); setTimeout(flushToasts, QUIET_MS - (now - lastToast) + 500); }
  // phone: by default only "MW has a new alert" goes to the public ntfy server; tickers and prices stay on this PC (R8)
  if (settings.ntfy) sendNtfy(E.ntfyBody(isTest ? [{msg:main.msg}] : urgent, settings.ntfyFull, APP_NAME), isTest ? "MW test" : "MW alert", "high").then(ok => {
    if (!ok && isTest) toast("The phone alert didn't go through. Check the ntfy topic");
    if (ok || !T) return;
    // the alert showed here but never reached the phone: say so on its line in the alert log
    const f = firedToday(); let hit = false; f.log.forEach(l => { if (l.t === T){ l.nd = true; hit = true; } });
    if (hit){ store.set("fired", f); safe("alert log", renderLog); } });
}
function sendNtfy(body, title, prio){
  if (!settings.ntfy) return Promise.resolve(true);
  return fetchT("https://ntfy.sh/" + encodeURIComponent(settings.ntfy), {method:"POST", body, headers:{"Title":title || "MW alert", "Priority":prio || "high", "Tags":"chart_with_downwards_trend"}})
    .then(r => { if (!r.ok){ mwLog("warn", "phone alert failed: ntfy answered " + r.status); return false; } return true; })
    .catch(e => { mwLog("warn", "phone alert failed: " + e.message); return false; });
}
// held lines skip tickers you have since snoozed or muted, and everything while alerts are paused
function takeHeld(){ const h = heldToasts.splice(0); return pausedNow() ? [] : h.filter(x => !x.sym || !snoozed(x.sym)); }
function flushToasts(){
  if (!heldToasts.length || Date.now() - lastToast < QUIET_MS) return;
  const lines = takeHeld().map(h => h.msg); if (!lines.length) return; lastToast = Date.now();
  showToast("Market alert", lines[0] + (lines.length > 1 ? `\n+${lines.length-1} more in MW` : ""), "held@" + lastToast, true);
}
function minsToMidnightET(){ return 1440 - etNow().mins; }
function snooze(syms, how){
  syms = [].concat(syms); const until = how === "30" ? Date.now() + 30*60e3 : Date.now() + minsToMidnightET()*60e3;
  syms.forEach(sym => settings.snooze[sym] = until);
  Object.keys(settings.snooze).forEach(k => { if (settings.snooze[k] < Date.now()) delete settings.snooze[k]; });
  const name = syms.length === 1 ? syms[0] : syms.join(", ");
  saveSettings(); toast(how === "30" ? `${name} snoozed for 30 min` : `${name} muted for the rest of today`); renderAll();
}
function togglePause(){
  settings.pauseUntil = pausedNow() ? 0 : Date.now() + minsToMidnightET()*60e3;
  saveSettings(); toast(settings.pauseUntil ? "Alerts paused until tomorrow" : "Alerts back on"); renderAll(); updateTray();
}
async function showToast(title, body, tag, sticky){
  if (NATIVE){ nat.invoke("shell_notify", {title, body}).catch(e => { lastErr = "Windows pop-up failed: " + e + ". Check Windows Settings → Notifications for Market Widget."; $("err").textContent = lastErr; }); return; }
  try{
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const opts = {body, icon:"icons/icon-192.png", badge:"icons/icon-192.png", tag, requireInteraction: !!sticky};
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  }catch(e){}
}
function beep(times){
  try{
    const ac = beep.ac || (beep.ac = new (window.AudioContext||window.webkitAudioContext)());
    if (ac.state === "suspended") ac.resume();
    for (let i=0;i<times;i++){
      const o = ac.createOscillator(), g = ac.createGain(); o.type = "sine"; o.frequency.value = 880 - i*120;
      o.connect(g); g.connect(ac.destination); const t = ac.currentTime + i*0.28;
      g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.22,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+0.22);
      o.start(t); o.stop(t+0.25);
    }
  }catch(e){}
}

/* ---------- live-feel helpers (4.4) ---------- */
/* a price that changed since it was last drawn flashes green or red once (off with Windows' reduce-motion setting) */
const shownPx = {};
function flashPass(root, scope){
  if (!root) return;
  root.querySelectorAll("[data-fx]").forEach(el => {
    const s = el.dataset.fx, v = lastPx(s); if (!(v > 0)) return;   // the latest known price, after hours included
    const k = scope + "|" + s + "|" + (el.dataset.fxk || ""), p = shownPx[k];
    if (p != null && p !== v) el.classList.add(v > p ? "fx-up" : "fx-dn");
    shownPx[k] = v;
  });
}
/* the row that has the keyboard focus keeps it through a redraw */
const focusKey = () => { const a = document.activeElement; return a && a.dataset && a.dataset.row || null; };
function refocus(k){ if (!k || (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.row === k)) return; const el = document.querySelector(`[data-row="${CSS.escape(k)}"]`); if (el) el.focus({preventScroll:true}); }
/* "3m old": a row whose price stopped coming while the market is open (or whose last trade is too old to alert on) */
function ageInfo(q){
  if (!q || !(q.c > 0) || session().s !== "open") return null;
  const lim = Math.max(3*60e3, 2.5*(refreshMs() || 60e3)), age = Date.now() - (q.at || 0);
  if (age > lim) return {txt: Math.round(age/60e3) + "m old", why:`No new price for ${Math.round(age/60e3)} min while the market is open`};
  const fr = freshOf(q); return fr.ok ? null : {txt:"stale", why:fr.why};
}
const ageChip = (sym, q, off) => { const a = off ? null : ageInfo(q); return a ? `<span class="chip stale" title="${esc(a.why)}. Alerts for ${esc(sym)} wait for a fresh price.">${a.txt}</span>` : ""; };
const extChip = sym => { const x = extFor(sym); return x ? `<span class="chip ext ${cls(x.pct)}" title="${x.ph === "pre" ? "Pre-market" : "After-hours"} trade of ${fmtPx(x.p)} at ${esc(dateTime(x.t) + " " + tzAbbr(x.t))} on IEX (Alpaca's free feed), against the close of ${fmt$(x.base)}. It's the price shown until the next trade. One exchange and thin trading, so treat it as a guide.">${x.ph === "pre" ? "Pre" : "AH"} ${fmtSh$(x.p - x.base, x.p)} ${fmtPct(x.pct,1)}</span>` : ""; };
/* fundamentals from the daily Finnhub metrics call (no extra calls) */
function fundHtml(sym){
  const f = (metrics[sym] || {}).f; if (!f) return "";
  const cap = f.cap == null ? null : f.cap >= 1e6 ? "$" + (f.cap/1e6).toFixed(2) + "T" : f.cap >= 1e3 ? "$" + (f.cap/1e3).toFixed(1) + "B" : "$" + Math.round(f.cap) + "M";
  return (cap ? kv("Market cap", cap, {tip:"What all the company's shares are worth together (Finnhub)"}) : "")
    + (f.pe != null ? kv("P/E", f.pe > 0 ? f.pe.toFixed(1) : "loss", {tip:"Price divided by the last 12 months' earnings per share. 'Loss' means it lost money."}) : "")
    + (f.revG != null ? kv("Sales growth", fmtPct(f.revG, 0), {c:cls(f.revG), tip:"Sales over the last 12 months against the 12 months before"}) : "")
    + (f.gm != null ? kv("Gross margin", f.gm.toFixed(0) + "%", {tip:"Share of each sales dollar left after the cost of making what it sells (last 12 months)"}) : "");
}
/* the alert rules that are switched on for a watchlist ticker, for the bell on its row */
function armedRules(w, I){
  if (I.off) return [];
  const on = (k, n) => w[k] === true || (w[k] !== false && !!w[n]), a = [];
  if (I.useLv) I.lv.forEach(L => a.push("price alert " + fmtL(L) + (w.lvRepeat === "once" ? " (once)" : w.lvRepeat === "cross" ? " (every cross)" : "")));
  if (I.useLv && w.lvUntil) a.push("price alerts end after " + w.lvUntil);
  if (on("redOn", "dayDrop")) a.push(`red day ${w.dayDrop}%`);
  if (w.offHigh && w.offOn !== false) a.push(`${w.offHigh}% under the 52-week high`);
  if (on("hiOn", "hiDrop")) a.push(`${w.hiDrop}% off today's high`);
  if (on("sigOn", "sigDrop")) a.push(`unusual drop ${w.sigDrop}σ`);
  if (on("fastOn", "fastDrop")) a.push(`fast drop ${w.fastDrop}% in ${w.fastMins || 15} min`);
  if (w.vwapOn === true) a.push("VWAP reclaim");
  return a;
}
const firedAt = {};   // sym -> when its last alert fired (the row pulses for a few seconds)
const BELL_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8z"/><path d="M6.6 14h2.8"/></svg>`;
/* next Fed and inflation dates (engine table from the official schedules) */
const macroWhen = t => (t - Date.now() < 6*864e5) ? whenStr(t) : new Date(t).toLocaleDateString("en-US", {month:"short", day:"numeric", timeZone:tzName()}) + " " + timeStr(t);
function macroHtml(){
  const M = E.nextMacro(Date.now(), 3), now = Date.now();
  if (M.expired) return `<div class="macro" title="MW's list of Fed and inflation dates ran to ${E.MACRO_VALID_TO}. A newer MW has next year's dates.">Fed and inflation dates: list ended ${E.MACRO_VALID_TO}, check the schedule</div>`;
  const ev = M.list[0]; if (!ev) return "";
  const tip = "Coming up:\n" + M.list.map(x => `${x.name}: ${macroWhen(x.t)} ${tzAbbr(x.t)}${x.past ? " (just out)" : ""}`).join("\n") + "\n\n" + ev.tip + "\nDates from the Fed, BLS and BEA published schedules.";
  const txt = ev.past ? `<b>${esc(ev.name)}</b> just out at ${timeStr(ev.t)}` : ev.today ? `<b>${esc(ev.name)}</b> today at ${timeStr(ev.t)} · in ${fmtLeft(ev.t - now)}` : `Next: <b>${esc(ev.name)}</b> ${macroWhen(ev.t)} · in ${fmtLeft(ev.t - now)}`;
  return `<div class="macro ${ev.today ? "today" : ""}" title="${esc(tip)}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg><span>${txt}</span></div>`;
}
const narrow = () => document.body.clientWidth < 360;
const fmtHero = n => n == null || !isFinite(n) ? "—" : Math.abs(n) >= 1e6 ? (n<0?"−":"") + "$" + (Math.abs(n)/1e6).toFixed(2) + "M" : narrow() && Math.abs(n) >= 1e5 ? (n<0?"−":"") + "$" + (Math.abs(n)/1e3).toFixed(1) + "K" : fmt$(n, 0);

/* ---------- small charts ---------- */
function sparkSvg(sym, levels){
  const q = quotes[sym], arr = ((spark[etNow().date]||{})[sym]||[]).slice();
  const W = 64, H = 26;
  const pts = arr;
  if (pts.length < 2){
    if (!(q && q.pc && q.c)) return `<svg class="spark" viewBox="0 0 ${W} ${H}"></svg>`;
    // no intraday points yet: show where the price sits against yesterday's close, without inventing a path
    const up = q.c >= q.pc, yy = up ? 7 : H-7;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${H/2}" y2="${H/2}" stroke="var(--muted)" stroke-opacity=".6" stroke-dasharray="1 3" vector-effect="non-scaling-stroke"/><circle cx="${W-4}" cy="${yy}" r="2.6" fill="${up?"var(--up)":"var(--down)"}"/></svg>`;
  }
  const ref = q && q.pc ? q.pc : pts[0];
  const near = (levels||[]).filter(L => L >= Math.min(...pts)*0.98 && L <= Math.max(...pts)*1.02);
  const lo = Math.min(...pts, ref, ...near), hi = Math.max(...pts, ref, ...near), span = (hi-lo) || 1;
  const y = v => (H-3) - (v-lo)/span*(H-6), x = i => i/(pts.length-1)*W;
  const d = pts.map((v,i)=>(i?"L":"M")+x(i).toFixed(1)+","+y(v).toFixed(1)).join("");
  const col = q && q.c < ref ? "var(--down)" : "var(--up)";
  const area = d + `L${W},${H}L0,${H}Z`;
  return `<svg class="spark" data-spk="${esc(sym)}" data-tip="" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${area}" fill="${col}" opacity=".10"/>
    <line x1="0" x2="${W}" y1="${y(ref)}" y2="${y(ref)}" stroke="var(--muted)" stroke-opacity=".6" stroke-dasharray="1 3" vector-effect="non-scaling-stroke"/>
    ${near.map(L=>`<line x1="0" x2="${W}" y1="${y(L)}" y2="${y(L)}" stroke="var(--warn)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`).join("")}
    <path d="${d}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function rangeBar(lo, hi, v, loLbl, hiLbl){
  if (!(lo && hi && v) || hi <= lo) return "";
  const p = Math.max(0, Math.min(100, (v-lo)/(hi-lo)*100));
  return `<div class="range"><div class="bar"><i style="left:calc(${p}% - 1px)"></i></div><div class="lbl"><span>${loLbl} ${fmtPx(lo)}</span><span>${hiLbl} ${fmtPx(hi)}</span></div></div>`;
}
function heatColor(p, cap){
  if (p == null || !isFinite(p)) return "var(--surface-2)";
  const a = Math.min(1, Math.abs(p)/cap), pct = Math.round(18 + a*62);
  return `color-mix(in srgb, ${p>=0?"var(--up)":"var(--down)"} ${pct}%, var(--surface-2))`;
}

/* ---------- this PC's database (IndexedDB "mwlab"): price history and recordings (older versions also kept an alert journal) ----------
   Nothing here leaves the PC. Every call fails soft: if the browser blocks storage, the lab still runs, just without memory. */
const IDB = {db:null, opening:null};
function idbOpen(){
  if (IDB.db) return Promise.resolve(IDB.db);
  if (IDB.opening) return IDB.opening;
  IDB.opening = new Promise((res, rej) => {
    let rq; try{ rq = indexedDB.open(BETA ? "mwlab" : "mw", 1); }catch(e){ rej(e); return; }
    rq.onupgradeneeded = () => { const db = rq.result;
      if (!db.objectStoreNames.contains("bars")) db.createObjectStore("bars", {keyPath:"sym"});
      if (!db.objectStoreNames.contains("journal")) db.createObjectStore("journal", {keyPath:"id"});
      if (!db.objectStoreNames.contains("snaps")) db.createObjectStore("snaps", {keyPath:"day"});
      if (!db.objectStoreNames.contains("tape")) db.createObjectStore("tape", {autoIncrement:true}); };
    rq.onsuccess = () => { IDB.db = rq.result; res(IDB.db); };
    rq.onerror = () => rej(rq.error); rq.onblocked = () => rej(new Error("database blocked"));
  }).catch(e => { IDB.opening = null; mwLog("warn", "this PC's database isn't available: " + (e && e.message || e)); throw e; });
  return IDB.opening;
}
const idbReq = (st, mode, fn) => idbOpen().then(db => new Promise((res, rej) => { const tx = db.transaction(st, mode), r = fn(tx.objectStore(st)); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }));
/* moving to MW 4 from the beta: boot.js copied the beta's settings; this copies its database (price history,
   recordings) once. Fails soft: MW starts either way. */
function idbFromBeta(){
  if (BETA || raw.get("mw_idbFrom") !== "mwlab") return Promise.resolve();
  const STORES = ["bars","journal","snaps","tape"];
  return new Promise(res => {
    let rq; try{ rq = indexedDB.open("mwlab", 1); }catch(e){ res(); return; }
    rq.onupgradeneeded = () => { try{ rq.transaction.abort(); }catch(e){} };   // no beta database here: nothing to copy
    rq.onerror = rq.onblocked = () => res();
    rq.onsuccess = () => { const src = rq.result, have = STORES.filter(n => src.objectStoreNames.contains(n));
      if (!have.length){ src.close(); res(); return; }
      const tx = src.transaction(have, "readonly"), out = {};
      have.forEach(n => { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { out[n] = r.result || []; }; });
      tx.oncomplete = () => { src.close();
        Promise.all(have.filter(n => n !== "tape").flatMap(n => out[n].map(v => idbPut(n, v).catch(()=>{}))))
          .then(() => { mwLog("info", "moved the beta's database over (" + have.filter(n => n !== "tape").map(n => out[n].length + " " + n).join(", ") + ")"); res(); }); };
      tx.onerror = () => { src.close(); res(); }; };
  }).then(() => { try{ localStorage.removeItem("mw_idbFrom"); }catch(e){} });
}
const idbPut = (st, v) => idbReq(st, "readwrite", s => s.put(v));
const idbGet = (st, k) => idbReq(st, "readonly", s => s.get(k));
const idbAll = st => idbReq(st, "readonly", s => s.getAll());
const idbClear = st => idbReq(st, "readwrite", s => s.clear());
const idbCount = st => idbReq(st, "readonly", s => s.count());

/* full daily history per symbol (up to ~5 years), loaded into memory for the risk figures */
let barsMem = {}, riskDirty = true;
function loadBarsMem(){ return idbAll("bars").then(rows => { (rows || []).forEach(r => { if (!barsMem[r.sym]) barsMem[r.sym] = r.bars; }); riskDirty = true; safe("fund fit", fitFunds); safe("portfolio", renderPortfolio); }).catch(()=>{}); }

/* ---------- portfolio risk (R10) ---------- */
let riskCache = {key:"", at:0, r:null};
function riskNow(P){
  const pos = {}; P.rows.forEach(r => { if (r.val > 0) pos[r.sym] = (pos[r.sym] || 0) + r.val; });
  const list = Object.entries(pos).map(([sym, value]) => ({sym, value}));
  if (!list.length) return null;
  const key = list.map(p => p.sym + ":" + Math.round(p.value / 50)).sort().join(",");
  if (!riskDirty && riskCache.key === key && Date.now() - riskCache.at < 5*60e3) return riskCache.r;
  let r = null; try{ r = E.portfolioRisk(list, barsMem); }catch(e){ mwLog("warn", "risk: " + e.message); }
  riskCache = {key, at:Date.now(), r}; riskDirty = false;
  return r;
}
const RC_COLORS = ["#5b9dff","#f472b6","#2dd4bf","#f59e0b","#a78bfa","#94a3b8"];
function lookNow(P){
  const etf = cfg.etf || {}; if (!Object.keys(etf).length) return null;
  const direct = {}; P.rows.forEach(r => { if (r.val > 0) direct[r.sym] = (direct[r.sym] || 0) + r.val; });
  if (!Object.keys(direct).some(s => etf[s] && etf[s].list && etf[s].list.length)) return null;
  const lists = {}; Object.keys(etf).forEach(s => lists[s] = etf[s].list || []);
  return E.lookThrough(Object.entries(direct).map(([sym, value]) => ({sym, value})), lists);
}
function riskHtml(RK, P, top, top3, offHi){
  const fundsCash = P.fixed, pctOf = v => P.total ? v / P.total * 100 : 0;
  const conc = `<span title="Your biggest single position as a share of everything you own.">Largest <b>${esc(top[0][0])} ${(top[0][1]/P.total*100).toFixed(0)}%</b></span>${top.length>3?`<span title="Your three biggest positions together, as a share of everything. Higher = more concentrated.">Top 3 <b>${top3.toFixed(0)}%</b></span>`:""}${offHi!=null?`<span title="Value-weighted distance of your stocks and ETFs from their 52-week highs (Finnhub)">From 52w highs <b class="${cls(offHi)}">${fmtPct(offHi,1)}</b></span>`:""}`;
  const LT = lookNow(P);
  const lt = LT && LT.rows.length ? `<div class="note" style="margin-top:6px" title="What you really own once the funds you described in Settings → Fund overlap are opened up. Share of your stocks and ETFs, through funds and directly.">Biggest real exposures: ${LT.rows.slice(0, 4).map(x => `<b style="color:var(--fg)">${esc(x.sym)}</b> ${(x.value / LT.total * 100).toFixed(1)}%${x.sources > 1 ? "*" : ""}`).join(" · ")}${LT.overlap.length ? ` <span title="Held both directly and through a fund, or through more than one fund">(* held more than one way)</span>` : ""}</div>` : "";
  if (!RK || !RK.ok){
    const why = !settings.tdKey ? "Risk figures need a free Twelve Data key (for price history)." : RK && RK.why ? "Risk figures: " + RK.why + "." : "Risk figures appear once price history has loaded.";
    return `<div class="riskx num"><div class="rk">${conc}</div><div class="note">${esc(why)}</div>${lt}</div>`;
  }
  const scale = RK.total / (P.total || RK.total);   // the measured part as a share of everything
  const segs = RK.rc.slice(0, 5), rest = RK.rc.slice(5).reduce((a, x) => a + x.pct, 0);
  const segAll = rest > 0.5 ? [...segs, {sym:"Other", pct:rest}] : segs;
  const b = RK.betas || {};
  // the header folds the block away (6.0); folded, it keeps the one-line read
  const shut = !!settings.riskHide;
  const head = `<button class="rk-h" data-act="risk" aria-expanded="${!shut}" title="${shut ? "Show" : "Hide"} the risk figures">${CHEV}Risk${shut ? `<span>1-in-20 bad day <b class="down">${myS$(-RK.var95)}</b> · largest ${esc(top[0][0])} ${(top[0][1]/P.total*100).toFixed(0)}%</span>` : `<span>measured from price history</span>`}</button>`;
  if (shut) return `<div class="riskx num shut">${head}</div>`;
  return `<div class="riskx num" title="From each holding's daily closes (Twelve Data). Covariance uses the last ${RK.days} trading days; the drawdown replays today's mix since ${esc(RK.from)}. Estimates from history, not forecasts.">
    ${head}
    <div class="rk">
      <span title="On 1 day in 20, the measured holdings lost at least this much (5th percentile of daily results over the last year, with today's mix).">1-in-20 bad day <b class="down">${myS$(-RK.var95)}</b></span>
      <span title="The average of those worst 1-in-20 days (expected shortfall). Bigger than the line before it, by definition.">Avg of worst 5% <b class="down">${myS$(-RK.es95)}</b></span>
      <span title="One standard deviation of a day's result: about two days in three land inside this.">Typical day <b>±${my$(RK.sd1d,0)}</b></span>
      <span title="The deepest peak-to-trough fall today's mix would have had since ${esc(RK.from)}${RK.mddAt ? " (bottom on " + esc(RK.mddAt) + ")" : ""}. Your actual past mix was different.">Worst drawdown <b class="down">${fmtPct(RK.mdd,0)}</b></span>
      ${b.SPY!=null?`<span title="How much the measured holdings moved for each 1% move in the S&amp;P 500 (SPY) over the last year, by regression.">Beta to S&amp;P <b>${b.SPY.toFixed(2)}</b></span>`:""}${b.SMH!=null?`<span title="The same against the chip ETF (SMH).">Beta to chips <b>${b.SMH.toFixed(2)}</b></span>`:""}
      <span title="How many truly separate bets the risk is spread across (1 / sum of squared risk shares). Five holdings that all move together count as about 1.">Independent bets <b>${RK.effBets.toFixed(1)}</b></span>
      ${conc}
    </div>
    <div class="rcbar" title="Share of the day-to-day risk from each holding (risk contribution). It differs from the share of dollars when a holding is jumpier or moves with the rest.">${segAll.map((x, i) => `<i style="width:${Math.max(0, x.pct).toFixed(1)}%;background:${RC_COLORS[i % RC_COLORS.length]}" title="${esc(x.sym)}: ${x.pct.toFixed(0)}% of the risk"></i>`).join("")}</div>
    <div class="rclg">${segAll.map((x, i) => `<span><i style="background:${RC_COLORS[i % RC_COLORS.length]}"></i>${esc(x.sym)} ${x.pct.toFixed(0)}% of risk${x.weight != null ? ` · ${(x.weight*100*scale).toFixed(0)}% of $` : ""}</span>`).join("")}</div>
    ${RK.missing.length || fundsCash ? `<div class="note">${RK.missing.length ? `Not measured yet: ${esc(RK.missing.join(", "))}. ` : ""}${fundsCash ? `Mutual funds and cash (${my$(fundsCash,0)}, ${pctOf(fundsCash).toFixed(0)}%) are left out.` : ""}</div>` : ""}
    ${lt}</div>`;
}

/* ---------- record mode (R17): keep every raw answer from the data feeds, to replay a real day in tests ----------
   Off by default. A recording holds your tickers and prices, so it stays on this PC unless you export it. */
let tapeN = 0;
function tapeAdd(src, what, data){
  if (tapeN > 20000) return;   // about one market day at 60 s refreshes is a few thousand lines
  tapeN++;
  idbPut("tape", {t:Date.now(), src, what: scrubKeys(String(what)), data}).catch(()=>{});
}

/* ---------- copy your setup from the live MW in this browser (read-only) ---------- */
/* what comes over besides holdings and watchlist: every key, alert setting and preference the regular MW has.
   Left behind on purpose: the recording switch and what only this screen remembers (the open tile, the last tab). */
const LIVE_SETTINGS = ["key","tdKey","alpKey","alpSec","fast","refresh","overnight","ntfy","ntfyFull","hcUrl","sound","allOff","pauseUntil","snooze",
  "theme","cvd","compact","layout","hideSec","collapsed","grpCollapsed","secHide","erHide","heatOrder","splash",
  "period","sort","bench","tz","newsTab","newsAll","chRange","chOv","fundEst","showZeroCash","sentryDsn"];
function liveSetup(){
  if (!BETA) return null;
  const c = liveStore.get("cfg"), s = liveStore.get("settings");
  return c && E.validCfg(c) ? {cfg:c, settings:s || {}} : null;
}
function importFromLive(silent){
  const L = liveSetup();
  if (!L){ if (!silent) toast("No MW setup found in this browser"); return false; }
  const nc = normCfg(L.cfg);
  if (!silent && !confirm("Copy your MW setup into MW?\n" + E.cfgDiff(cfg, nc) + "\nIncludes your data keys and settings. Your live MW is not changed.")) return false;
  snapCfg("before copying from MW", true);
  cfg = nc; cfg.v = E.CFG_V; store.set("cfg", cfg); snapCfg("copied from MW", true);   // its own line in the history every time, so the setup it replaced is never the one that drops out
  LIVE_SETTINGS.forEach(k => { const v = L.settings[k]; if (v != null && !(v === "" && settings[k])) settings[k] = v; });   // an empty box over there never wipes a key kept here
  saveSettings(); document.documentElement.dataset.theme = settings.theme; applyCvd();
  hist = {}; store.set("hist", hist); loadHist.day = null;
  mwLog("info", "copied the setup from MW (" + cfg.holdings.length + " holdings, " + cfg.watch.length + " watchlist)");
  if (!silent) toast("Copied from MW"); return true;
}
/* in the separate MW Lab desktop app (Ctrl+Alt+L) there is no regular MW to go back to */
const labShell = () => !!(nat.state && nat.state.hotkey_label === "Ctrl+Alt+L");
/* the show/hide hotkey: Ctrl+Alt+M in the MW app, Ctrl+Alt+L in the MW Lab app (older apps don't say, and are MW) */
const hotkeyName = () => (nat.state && nat.state.hotkey_label) || "Ctrl+Alt+M";
function leaveBeta(){
  if (!confirm("Switch back to the regular MW?\n\nYour regular setup is just as you left it. Changes you made in the beta stay in the beta. If you join again, the beta starts from your regular setup as it is then, and keeps its earlier one under Settings → Backup.")) return;
  raw.set("mw_channel", "stable"); mwLog("info", "left the beta"); location.replace("../");
}
function joinBetaHere(){ raw.set("mw_channel", "beta"); raw.set("mw_betaOk", String(Date.now())); toast("MW now opens the beta"); showTab("general"); }

/* ---------- portfolio ---------- */
// "today" only once today's session has started; before the open, on weekends and holidays the change is the last session's
function dayWord(){ const ses = session(), t = etNow(); return ses.s==="open" || (ses.label==="After hours" && t.mins < 1200) ? "today" : "last session"; }
const openRows = new Set();
function portfolioCalc(){
  let live = 0, prev = 0, missing = 0, cost = 0, costVal = 0, sLive = 0, sPrev = 0, estUsd = 0, estBase = 0, estN = 0;
  const rows = cfg.holdings.filter(h => h.sym && +h.shares > 0).map(h=>{
    const sym = h.sym.toUpperCase(), sh = +h.shares;
    if (isFund(sym)){   // a mutual fund typed into the Holdings table: priced once a day, like the funds below
      const x = fundInfo(sym, sh), val = x.live ? x.value : null;
      if (val != null){ live += val; prev += val - x.dayUsd; } else missing++;
      if (h.avg && val != null){ cost += h.avg*sh; costVal += val; }
      if (x.est){ estUsd += x.est.usd; estBase += x.value; estN++; }
      return {h, sym, q:null, sh, val, dayUsd: x.live && x.cur ? x.dayUsd : null, fund:x};
    }
    const q = quotes[sym];
    const val = q && q.c ? q.c*sh : null, pv = q && q.pc ? q.pc*sh : null;
    if (val != null){ live += val; prev += pv ?? val; sLive += val; sPrev += pv ?? val; } else missing++;
    if (h.avg && val != null){ cost += h.avg*sh; costVal += val; }
    return {h, sym, q, sh, val, dayUsd: val!=null && pv!=null ? val-pv : null};
  });
  const fi = cfg.fixed.map(fixedInfo);
  fi.forEach(x => { if (x.est){ estUsd += x.est.usd; estBase += x.value; estN++; } });
  const fixed = fi.reduce((a,x)=>a + x.value, 0), fixedDay = fi.reduce((a,x)=>a + (x.dayUsd||0), 0);
  const total = live + fixed, dayUsd = live - prev + fixedDay, base = prev + fixed - fixedDay;
  const stockPct = sPrev ? (sLive/sPrev - 1)*100 : null;
  return {rows, live, prev, fixed, total, dayUsd, dayPct: base ? dayUsd/base*100 : null, stockPct, missing, cost, costVal, fi, est: estN ? {usd:estUsd, base:estBase, n:estN} : null};
}
/* a dollar change the way rows show it: cents under $100, whole dollars above */
const fmtDay$ = v => v != null && Math.abs(v) < 0.005 ? "$0.00" : fmtS$(v, v != null && Math.abs(v) < 100 ? 2 : 0);
const myDay$ = v => !hid() ? fmtDay$(v) : (v == null || !isFinite(v)) ? "—" : (Math.abs(v) < 0.005 ? "" : v >= 0 ? "+" : "−") + HID;
const CHEV = `<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>`;
/* one fact in an open row (6.0): its name in small type over its value, so a number never breaks across lines.
   o: {c (up/down), x (a quieter figure after the value), tip, wide (takes the full width)} */
const kv = (label, val, o) => { o = o || {}; return `<span class="fact${o.wide ? " wide" : ""}"${o.tip ? ` title="${esc(o.tip)}"` : ""}><i>${label}</i><span><b${o.c ? ` class="${o.c}"` : ""}>${val}</b>${o.x ? ` <em>${o.x}</em>` : ""}</span></span>`; };
/* a row of time frames (5D, 1M, 3M …), each over its percent */
const perRow = list => { const a = list.filter(x => x && x.pct != null && isFinite(x.pct)); return a.length ? `<div class="pers">${a.map(x => `<span${x.tip ? ` title="${esc(x.tip)}"` : ""}><i>${x.k}</i><b class="${cls(x.pct)}">${fmtPct(x.pct, 1)}</b></span>`).join("")}</div>` : ""; };
const closeBtn = attr => `<button class="rbtn wclose" ${attr} title="Close the details (Esc)">Close <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg></button>`;

/* ---------- the portfolio's own day line (6.0) ----------
   One point a minute while the market is open: [time, the day's change in dollars, in percent]. Only a complete
   picture counts (every holding priced from a trade made today), so the line never starts from a half-loaded total.
   Kept on this PC for the session, like the sparklines. */
let pfDay = store.get("pfDay", null);
function pfDayAdd(){
  if (session().s !== "open" || !cfg.holdings.length) return;
  const now = Date.now(), day = etNow().date, P = portfolioCalc();
  if (P.missing || P.dayPct == null || !isFinite(P.dayUsd)) return;
  const live = P.rows.filter(r => r.q);
  if (!live.length || live.some(r => !(r.q.t > 0 && etDateOf(r.q.t * 1000) === day))) return;
  if (!pfDay || pfDay.day !== day || !Array.isArray(pfDay.pts)) pfDay = {day, pts:[]};
  const a = pfDay.pts, last = a[a.length - 1], usd = Math.round(P.dayUsd * 100) / 100, pct = +P.dayPct.toFixed(3);
  if (last && now - last[0] < 55e3){ last[1] = usd; last[2] = pct; } else a.push([now, usd, pct]);
  if (a.length > 480) a.shift();
  if (now - (pfDayAdd.at || 0) > 30e3){ pfDayAdd.at = now; store.set("pfDay", pfDay); }
}
/* drawn on the session's clock (9:30 to the close), so the line also shows how far into the day it is */
function pfLineSvg(){
  const day = E.lastSessionDate(Date.now());
  if (!pfDay || pfDay.day !== day || !Array.isArray(pfDay.pts) || pfDay.pts.length < 2) return "";
  const W = 120, H = 34, o = etMs(day, 570), c = etMs(day, closeMins(day)), pts = pfDay.pts;
  const vals = pts.map(p => p[2]), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = (hi - lo) || 1;
  const x = t => Math.max(0, Math.min(1, (t - o) / (c - o))) * W, y = v => (H - 3) - (v - lo) / span * (H - 6);
  const d = pts.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + "," + y(p[2]).toFixed(1)).join("");
  const col = vals[vals.length - 1] < 0 ? "var(--down)" : "var(--up)", y0 = y(0).toFixed(1);
  return `<svg class="pfline" data-pfl="1" data-tip="" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Your portfolio's change through the day">
    <path d="${d}L${x(pts[pts.length - 1][0]).toFixed(1)},${y0}L${x(pts[0][0]).toFixed(1)},${y0}Z" fill="${col}" opacity=".12"/>
    <line x1="0" x2="${W}" y1="${y0}" y2="${y0}" stroke="var(--muted)" stroke-opacity=".6" stroke-dasharray="1 3" vector-effect="non-scaling-stroke"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

/* ---------- what an open row shows (6.0): the same tabs for a holding and a watchlist ticker ----------
   Today: the day's change for one share and where the price sits in the day. Trend: longer time frames, averages and
   the 52-week range. Company: earnings and fundamentals. News: its headlines. A holding puts Position first. */
function symPanes(sym){
  const q = quotes[sym], px = q && q.c > 0 ? q.c : null, m = metrics[sym] || {}, h = hist[sym] || {}, vol = volOf(sym);
  const ch = chgOf(q), ds = dailyStats(sym), sv = sessVwap(sym, 60), av = anchorVwap(sym), er = erInfo(sym), nc = newsCache[sym];
  const bench = settings.bench, bq = quotes[bench], rel = px && q.dp != null && bq && bq.dp != null && sym !== bench ? q.dp - bq.dp : null;
  const tdy = dayWord() === "today", vs = (a, b) => fmtPct((a / b - 1) * 100, 1), avg$ = v => fmt$(v, v < 1 ? 4 : v < 100 ? 2 : 0);
  const T = {
    today: [
      px && ch != null ? kv(tdy ? "Today" : "Last session", fmtSh$(ch, px) + " a share", {c:cls(ch), x:fmtPct(q.dp), tip:`The price now (${fmtPx(px)}) minus the previous close (${fmtPx(q.pc)}), for one share`}) : "",
      q && q.pc > 0 ? kv("Previous close", fmtPx(q.pc)) : "",
      q && q.o > 0 ? kv("Open", fmtPx(q.o), {x:q.pc > 0 ? vs(q.o, q.pc) : "", tip:"The first trade of the regular session" + (q.pc > 0 ? ", and how far that was from the previous close" : "")}) : "",
      q && q.h > 0 && px ? (px < q.h - 0.005 ? kv(`Off ${tdy ? "today's" : "the day's"} high`, fmtSh$(px - q.h, px), {c:"down", x:vs(px, q.h), tip:`How far the price is under the day's high of ${fmtPx(q.h)}, for one share`})
        : kv(`Off ${tdy ? "today's" : "the day's"} high`, "At the high", {tip:`The day's high is ${fmtPx(q.h)}`})) : "",
      vol && q && q.dp != null ? kv(`${tdy ? "Today" : "The day"} in σ`, sgn(q.dp / vol, 1) + Math.abs(q.dp / vol).toFixed(1) + "σ", {c:cls(q.dp), x:`normal ±${vol.toFixed(1)}%`, tip:"The day's move measured in this ticker's normal daily moves (1σ is about one typical day)"}) : "",
      rel != null ? kv("vs " + esc(bench), fmtPct(rel, 1), {c:cls(rel), tip:`The day's move minus ${bench}'s: is it the stock, or just the sector?`}) : "",
      sv && px ? kv("VWAP today", fmtPx(sv.vw), {x:vs(px, sv.vw), tip:"Average price paid today, weighted by volume (from 5-minute bars, updated about every 10 min). The percent is the price against it."}) : "",
      q && px ? rangeBar(q.l, q.h, px, "Day low", "high") : ""],
    trend: [
      perRow(["5D","1M","3M","YTD","1Y"].map(k => { const c = chgFor(sym, k); return {k, pct:c.pct, tip:`${k === "YTD" ? "This year so far" : "The last " + k}: ${chgTxt(c.usd, c.pct, 1)} a share`}; })),
      h.sma50 && px ? kv("50-day average", avg$(h.sma50), {x:vs(px, h.sma50), tip:"The average close of the last 50 trading days. The percent is the price against it."}) : "",
      h.sma200 && px ? kv("200-day average", avg$(h.sma200), {x:vs(px, h.sma200), tip:"The average close of the last 200 trading days. The percent is the price against it."}) : "",
      av && px ? kv("VWAP since " + mdLabel(av.d), fmtPx(av.vw), {x:vs(px, av.vw), tip:`Average price paid by everyone since ${av.why === "gap" ? "the " + mdLabel(av.d) + " gap (usually earnings)" : "the " + mdLabel(av.d) + " high"}, weighted by volume. Price under it means most of those buyers are losing money, which often caps rallies.`}) : "",
      ds ? kv("Daily range (ATR)", fmt$(ds.atr, px && px < 1 ? 4 : ds.atr < 10 ? 2 : 0), {x:ds.atrPct.toFixed(1) + "%", tip:"Average true range over 14 days: how far this ticker normally moves in a day, high to low, for one share."}) : "",
      m.hi && px ? (px < m.hi - 0.005 ? kv("From 52-week high", fmtSh$(px - m.hi, px), {c:"down", x:vs(px, m.hi), tip:`The 52-week high is ${fmtPx(m.hi)} (Finnhub)`}) : kv("From 52-week high", "At the high", {tip:`The 52-week high is ${fmtPx(m.hi)} (Finnhub)`})) : "",
      m.beta != null ? kv("Beta", m.beta.toFixed(2), {tip:"How much this ticker has moved for each 1% move in the market (Finnhub). Above 1 means bigger swings than the market."}) : "",
      m.hi && m.lo && px ? rangeBar(m.lo, m.hi, px, "52w low", "high") : ""],
    company: [er ? kv("Next earnings", er.label.slice(3), {x:er.days === 0 ? "today" : er.days === 1 ? "tomorrow" : "in " + er.days + " days", tip:erTip(sym)}) : "", fundHtml(sym)],
    news: [newsHtml(sym)]
  };
  return {T, NAMES:{position:"Position", today:"Today", trend:"Trend", company:"Company", news:"News" + (nc && nc.items && nc.items.length ? ` (${nc.items.length})` : "")}};
}
/* one mutual fund row (in the Mutual funds group, or inside an account when it was typed into Holdings) */
function fundRow(sym, sh, x, total, key, opt){
  opt = opt || {}; const open = openRows.has(key), wt = x.live && total ? x.value / total * 100 : null;
  const sub = [sh ? myN(sh) + " sh" : "", wt != null ? wt.toFixed(1) + "%" : ""].filter(Boolean).join(" · ");
  const day = x.live ? navDayLabel(x.date) : "", one = x.live && x.prev ? x.nav - x.prev : null;   // the official change for one share
  // per share: the official change in a solid pill, an estimate in a dashed one, an older day's change faded
  let pill, pos = "";
  if (!x.live) pill = dchg(null, null, {none: x.err ? "⚠" : "—", tip: x.err ? "Couldn't get a price: " + x.err : settings.tdKey ? "Waiting for this fund's first price" : "Add a free Twelve Data key in Settings → General for fund prices"});
  else if (x.cur && x.chgPct != null){
    pill = dchg(one, x.chgPct, {tip:`Official change for ${day}: the fund's price went from ${fmt$(x.prev)} to ${fmt$(x.nav)} a share (${x.src}).`});
    pos = `<small class="${cls0(x.chgUsd)}" title="${esc(sym)} ${dayWord()} on your ${myN(sh)} shares">${myDay$(x.chgUsd)}</small>`;
  } else if (x.est){
    pill = dchg(x.est.nav - x.nav, x.est.pct, {k:"est", tip:`ESTIMATE, not the fund's price. ${sym} has moved about ${x.est.beta.toFixed(2)}x with ${x.est.sym} over the last 6 months (it explains ${Math.round(x.est.r2*100)}% of the fund's daily moves), and ${x.est.sym} has moved since the fund's last official price on ${day}. The official price replaces this as soon as it's posted. Not counted in your total.`});
    pos = `<small class="est ${cls0(x.est.usd)}" title="The same estimate on your ${myN(sh)} shares. Not counted in your total.">est. ${myDay$(x.est.usd)}</small>`;
  } else {
    pill = dchg(one, x.chgPct, {k:"old", tip:`Change on ${day}, the fund's latest official price. ${navNextText(x)}`});
    pos = x.chgUsd != null ? `<small class="old ${cls0(x.chgUsd)}" title="The change on ${day}, on your ${myN(sh)} shares">${myDay$(x.chgUsd)}</small>` : "";
  }
  let det = "";
  if (open){
    const h = hist[sym], per = k => { const r = h && h.refs && h.refs[k]; return r && r.c && x.live ? (x.nav / r.c - 1) * 100 : null; };
    const gain = opt.avg && x.live ? (x.nav / opt.avg - 1) * 100 : null, f = fundFit[sym];
    det = `<div class="wdet num"><div class="wpane">
      ${kv("Price (NAV)", x.live ? fmt$(x.nav) : "—", {tip:"Net asset value: the fund's one price for the day, set after the 4 PM ET close"})}${kv("Priced", x.live ? day : "—", {x:x.live ? esc(x.src) : ""})}
      ${x.live && x.chgPct != null ? kv("Change " + (x.cur ? dayWord() : "on " + day), fmtSh$(one) + " a share", {c:cls(x.chgPct), x:fmtPct(x.chgPct), tip:"The fund's official price change, for one share"}) + kv("On your shares", myDay$(x.chgUsd), {c:cls(x.chgUsd)}) : ""}
      ${x.est ? kv("Est. since then", fmtSh$(x.est.nav - x.nav) + " a share", {c:cls(x.est.pct), x:fmtPct(x.est.pct), tip:`An estimate from ${x.est.sym}'s move since ${day}. Not the fund's price.`}) + kv("Est. on your shares", myDay$(x.est.usd), {c:cls(x.est.usd), tip:"The same estimate on your shares. Not counted in your total."}) : ""}
      ${kv("Shares", myN(sh))}${kv("Weight", wt == null ? "—" : wt.toFixed(1) + "%", {tip:"This fund as a share of everything you own here"})}
      ${opt.avg ? kv("Avg cost", my$(opt.avg)) + kv("Gain", myS$(x.live ? (x.nav - opt.avg) * sh : null, 2), {c:cls(gain), x:fmtPct(gain, 1)}) : ""}
      ${perRow(["1M","3M","YTD","1Y"].map(k => ({k, pct:per(k)})))}
      ${f && f.sym ? kv("Moves most like", esc(f.sym), {wide:1, x:`${Math.round(f.r2*100)}% match · ${f.beta.toFixed(2)}x its moves${f.r2 < FIT_MIN ? " · too loose to estimate from" : ""}`, tip:`Found by comparing the fund's daily price changes with index ETFs over the last ${f.n} trading days. MW uses it for the estimate between official prices${f.r2 < FIT_MIN ? ", but this match is too loose, so no estimate is shown" : ""}.`}) : ""}
      ${opt.name && opt.name.toUpperCase() !== sym ? `<span class="wide muted">${esc(opt.name)}</span>` : ""}
      <span class="wide muted">${esc(x.live ? navNextText(x) : x.err ? "Couldn't get a price: " + x.err + "." : "No price yet.")}${x.at ? " Last checked " + esc(dateTime(x.at)) + "." : ""}</span>
    </div>
    <div class="wacts">${hist[sym] ? `<button class="rbtn" data-chart="${esc(sym)}" title="The fund's daily prices as a chart (G)">Chart</button>` : ""}<button class="rbtn" data-navref="${esc(sym)}" title="Ask for this fund's price now">↻ Check price</button>${closeBtn(`data-rclose="${esc(key)}"`)}</div></div>`;
  }
  return `<div class="hrow frow" role="button" tabindex="0" data-row="${esc(key)}" aria-expanded="${open}">
    <div class="s"><span class="s1"><span class="tk">${esc(sym)}</span><span class="er fundtag" title="Mutual fund: one price a day, set after the close">fund</span></span><small>${sub}</small></div>
    <span class="spark navd num" title="${x.live ? esc("Priced " + day + " (" + x.src + "). " + navNextText(x)) : ""}">${x.live && !x.cur ? `${x.est ? "est. since" : "priced"}<br>${day}` : ""}</span>
    <div class="ps"><span class="px num" title="${x.live ? esc("The fund's price (NAV) for " + day + ", from " + x.src) : ""}">${x.live ? fmt$(x.nav) : "—"}</span>${pill}</div>
    <div class="v num">${x.live ? `<b>${my$(x.value,0)}</b>` : opt.value ? `<b>${my$(opt.value,0)}</b>` : `<b class="muted" style="font-weight:400">no price</b>`}${pos}</div>${det}</div>`;
}
/* jump to a holding's row from the day's-dollars bar: open its account if it is folded, scroll to it and light it up */
function rowJump(k){
  const acct = k.split(":").slice(2).join(":"), g = acct || (k[0] === "f" ? "__funds" : "Other");
  if (settings.grpCollapsed[g]){ settings.grpCollapsed[g] = false; saveSettings(); renderPortfolio(); }
  const el = document.querySelector(`[data-row="${CSS.escape(k)}"]`); if (!el) return;
  el.scrollIntoView({block:"center", behavior:"smooth"}); el.focus({preventScroll:true});
  el.classList.remove("hl"); void el.offsetWidth; el.classList.add("hl");
}
function renderPortfolio(){
  const P = portfolioCalc(), body = $("pf-body"), any = Object.keys(quotes).length > 0, fk = focusKey();
  if (!cfg.holdings.length && !cfg.fixed.length){
    $("pf-sum").innerHTML = `<span class="muted">No holdings yet</span>`;
    body.innerHTML = `<div class="empty">Add what you own to see your total, today's change and each position.<br><br><button data-open="holdings">Add holdings</button></div>`;
    return;
  }
  const word = dayWord() === "today" ? "Today" : "Last session";
  $("pf-sum").innerHTML = any ? `<b style="color:var(--fg);font-size:13px">${hid() ? HID : fmtHero(P.total)}</b><span class="${cls(P.dayPct)}" style="font-weight:600" title="${word}">${P.dayUsd != null && Math.abs(P.dayUsd) >= 0.5 ? myS$(P.dayUsd) + " " : ""}${fmtPct(P.dayPct)}</span>` : "";
  const spy = quotes.SPY && quotes.SPY.dp, vs = (P.stockPct!=null && spy!=null) ? P.stockPct - spy : null;
  // risk read (R10): measured from each holding's own daily price history, not an assumed beta
  const RK = riskNow(P);
  const byVal = P.rows.filter(r=>r.val).map(r=>({sym:r.sym, val:r.val}));
  const merged = {}; byVal.forEach(r => merged[r.sym] = (merged[r.sym]||0) + r.val);
  const top = Object.entries(merged).sort((a,b)=>b[1]-a[1]);
  const top3 = P.total ? top.slice(0,3).reduce((a,x)=>a+x[1],0)/P.total*100 : null;
  let hv = 0, hw = 0; P.rows.forEach(r => { const m = metrics[r.sym]; if (r.val && m && m.hi && r.q && r.q.c){ hv += r.val*(r.q.c/m.hi - 1); hw += r.val; } });
  const offHi = hw ? hv/hw*100 : null;
  const gain = P.cost ? (P.costVal/P.cost - 1)*100 : null;
  const missingSyms = [...new Set(P.rows.filter(r => r.val == null).map(r => r.sym))];

  // allocation by account (+ funds & cash)
  const accts = {}; P.rows.forEach(r=>{ const a = r.h.acct || "Other"; accts[a] = (accts[a]||0) + (r.val||0); });
  if (P.fixed) accts["Funds & cash"] = (accts["Funds & cash"]||0) + P.fixed;
  const names = Object.keys(accts), tot = P.total || 1;
  const alloc = names.map((n,i)=>`<i style="width:${(accts[n]/tot*100).toFixed(2)}%;background:${ACCT_COLORS[i%ACCT_COLORS.length]}" title="${esc(n)}"></i>`).join("");
  const legend = names.map((n,i)=>`<span><i style="background:${ACCT_COLORS[i%ACCT_COLORS.length]}"></i>${esc(n)} ${(accts[n]/tot*100).toFixed(0)}%</span>`).join("");

  // groups
  const dpOf = r => r.fund ? (r.fund.cur && r.fund.chgPct != null ? r.fund.chgPct : r.fund.est ? r.fund.est.pct : 0) : (r.q && r.q.dp) || 0;
  const sorters = {value:(a,b)=>(b.val||0)-(a.val||0), day:(a,b)=>dpOf(b)-dpOf(a), usd:(a,b)=>(b.dayUsd||0)-(a.dayUsd||0), name:(a,b)=>a.sym.localeCompare(b.sym)};
  if (!sorters[settings.sort]) settings.sort = "value";
  const groups = {}; P.rows.forEach(r=>{ const a = r.h.acct || "Other"; (groups[a] = groups[a] || []).push(r); });
  const grpHtml = Object.entries(groups).map(([name, rs])=>{
    rs.sort(sorters[settings.sort] || sorters.value);
    const gv = rs.reduce((a,r)=>a+(r.val||0),0), gd = rs.reduce((a,r)=>a+(r.dayUsd||0),0), gp = gv-gd ? gd/(gv-gd)*100 : null;
    const col = settings.grpCollapsed[name];
    return `<div class="grp ${col?"collapsed":""}">
      <button class="grp-h" data-grp="${esc(name)}">${CHEV}<b>${esc(name)}</b><span class="muted">${rs.length} holding${rs.length>1?"s":""}</span>
        <span class="r num"><span>${my$(gv,0)}</span><span class="cbox ${cls(gp)}" title="This account ${dayWord()}: ${myS$(gd)} (${fmtPct(gp)})">${Math.abs(gd) >= 0.5 ? `<i>${myS$(gd)}</i>` : ""}${fmtPct(gp)}</span></span></button>
      <div class="grp-rows">${rs.map(r => r.fund ? fundRow(r.sym, r.sh, r.fund, P.total, "f:" + r.sym + ":" + (r.h.acct||""), {avg:r.h.avg}) : holdRow(r, P)).join("")}</div></div>`;
  }).join("");
  const chev = CHEV;
  const funds = cfg.fixed.filter(f=>f.sym), cashes = cfg.fixed.filter(f=>!f.sym);
  let fundsHtml = "", cashHtml = "";
  if (funds.length){
    const xs = funds.map(f=>({f, x:fixedInfo(f)}));
    const fv = xs.reduce((a,o)=>a+o.x.value,0), liveXs = xs.filter(o=>o.x.live);
    const anyLive = liveXs.length > 0, anyErr = xs.some(o=>!o.x.live && o.x.err), allCur = anyLive && liveXs.every(o=>o.x.cur);
    const asOf = liveXs.map(o=>o.x.date).sort()[0];   // the oldest price in the group: the honest "as of"
    // the group's change: official when every fund has the session's price, an estimate when one can be made, else the last official day
    const offUsd = liveXs.reduce((a,o)=>a+(o.x.chgUsd||0),0), offBase = liveXs.reduce((a,o)=>a+(o.x.chgUsd!=null ? o.x.value-o.x.chgUsd : 0),0);
    const estXs = liveXs.filter(o=>o.x.est), estUsd = estXs.reduce((a,o)=>a+o.x.est.usd,0), estBase = estXs.reduce((a,o)=>a+o.x.value,0);
    const head = !anyLive ? "" : allCur && offBase ? `<span class="cbox ${cls(offUsd)}" title="Your mutual funds ${dayWord()}, from their official prices for ${navDayLabel(asOf)}: ${myS$(offUsd)} (${fmtPct(offUsd/offBase*100)})">${Math.abs(offUsd) >= 0.5 ? `<i>${myS$(offUsd)}</i>` : ""}${fmtPct(offUsd/offBase*100)}</span>`
      : estXs.length && estBase ? `<span class="cbox est ${cls(estUsd)}" title="ESTIMATE for ${estXs.length} of ${liveXs.length} fund${liveXs.length>1?"s":""}, from the ETFs they move with, since their last official prices (${navDayLabel(asOf)}). Not counted in your total; the official prices replace it when they're posted.">est. ${Math.abs(estUsd) >= 0.5 ? `<i>${myS$(estUsd)}</i>` : ""}${fmtPct(estUsd/estBase*100)}</span>`
      : offBase ? `<span class="cbox old ${cls(offUsd)}" title="Change on ${navDayLabel(asOf)}, the funds' latest official prices. ${esc(navNextText(liveXs[0].x))}">${fmtPct(offUsd/offBase*100)}</span>` : "";
    fundsHtml = `<div class="grp ${settings.grpCollapsed.__funds?"collapsed":""}">
      <button class="grp-h" data-grp="__funds">${chev}<b>Mutual funds</b><span class="muted" title="${anyLive ? esc(navNextText(liveXs.find(o=>o.x.date===asOf).x)) : ""}">${anyLive ? (allCur ? "priced " + navDayLabel(asOf) : "as of " + (+asOf.slice(5,7)) + "/" + (+asOf.slice(8,10))) : settings.tdKey ? "waiting for prices" : "not live"}${anyErr ? ` <span title="Some fund prices couldn't update. Open a fund and click Check price, or use Settings → General → Test my keys." style="color:var(--warn)">⚠</span>` : ""}</span>
        <span class="r num"><span>${my$(fv,0)}</span>${head}</span></button>
      <div class="grp-rows">${xs.map(({f,x})=>fundRow(f.sym.toUpperCase(), +f.shares || 0, x, tot, "f:" + f.sym.toUpperCase() + ":", {name:f.name, value:+f.value||0})).join("")}</div></div>`;
  }
  // a cash row at $0 stays out of the way; it shows again as soon as it's above $0 (Settings → Holdings can show them)
  const cashShown = settings.showZeroCash ? cashes : cashes.filter(f => (+f.value||0) > 0);
  if (cashShown.length){
    const cv = cashShown.reduce((a,f)=>a+(+f.value||0),0);
    // the name exactly as typed in Settings → Holdings, so "Cash (Taxable)" and "Cash (Roth)" stay told apart
    const label = f => String(f.name||"").trim() || "Cash";
    cashHtml = `<div class="grp ${settings.grpCollapsed.__cash?"collapsed":""}">
      <button class="grp-h" data-grp="__cash">${chev}<b>Cash</b><span class="muted">${cashShown.length} account${cashShown.length > 1 ? "s" : ""}</span><span class="r num"><span>${my$(cv,0)}</span></span></button>
      <div class="grp-rows">${cashShown.map(f=>`<div class="hrow cash"><div class="s" title="${esc(label(f))}">${esc(label(f))}<small>${((+f.value||0)/tot*100).toFixed(1)}%</small></div><div class="v num"><b>${my$(+f.value||0,0)}</b></div></div>`).join("")}</div></div>`;
  }
  const fixedHtml = fundsHtml + cashHtml;
  // pre-market or after-hours move of your stocks (Alpaca IEX, a guide only)
  let ahUsd = 0, ahBase = 0, ahPh = "";
  P.rows.forEach(r => { const x = extFor(r.sym); if (x && r.val != null){ ahUsd += (x.p - x.base) * r.sh; ahBase += x.base * r.sh; ahPh = x.ph; } });
  const ahLine = ahBase ? `<small class="ah" title="Your stocks and ETFs at their latest ${ahPh === "pre" ? "pre-market" : "after-hours"} trades on IEX (Alpaca's free feed), against the last close. The value above stays at the close. Funds and cash left out. Thin trading, so a guide only.">${ahPh === "pre" ? "Pre-market" : "After hours"} <b class="${cls(ahUsd)}">${myS$(ahUsd)} ${fmtPct(ahUsd / ahBase * 100)}</b></small>` : "";
  const cashTotal = cashes.reduce((a,f)=>a+(+f.value||0),0);
  // funds between official prices: a separate, clearly marked estimate under the day's change
  const estLine = P.est ? `<small class="ah" title="ESTIMATE of how your mutual funds have moved since their last official prices, from the ETFs they track most closely. It is not in the total or the change above; the official prices replace it when they're posted (overnight on the free feed).">Funds est. <b class="${cls(P.est.usd)}">${myS$(P.est.usd)} ${fmtPct(P.est.usd / P.est.base * 100)}</b></small>` : "";
  // where the day's dollars came from (6.0): each holding's dollar change as a piece of one bar, biggest gain on the
  // left, biggest loss on the right. Official changes only; fund estimates stay out, as they do in the total.
  const mvBy = {}, mvKey = {};
  P.rows.forEach(r => { if (r.dayUsd != null && r.val != null){ mvBy[r.sym] = (mvBy[r.sym] || 0) + r.dayUsd; if (!mvKey[r.sym]) mvKey[r.sym] = (r.fund ? "f:" : "h:") + r.sym + ":" + (r.h.acct || ""); } });
  cfg.fixed.forEach((f, i) => { const x = P.fi[i], k = (f.sym || "").toUpperCase(); if (k && x.live && x.cur && x.chgUsd != null){ mvBy[k] = (mvBy[k] || 0) + x.chgUsd; if (!mvKey[k]) mvKey[k] = "f:" + k + ":"; } });
  const mvL = Object.entries(mvBy).filter(x => Math.abs(x[1]) >= 0.005).sort((a, b) => b[1] - a[1]);
  const ups = mvL.filter(x => x[1] > 0), dns = mvL.filter(x => x[1] < 0).reverse();
  const gSum = ups.reduce((a, x) => a + x[1], 0), lSum = dns.reduce((a, x) => a + x[1], 0), mvTot = gSum - lSum;
  const nUp = Math.min(ups.length, dns.length ? 2 : 3), nDn = Math.min(dns.length, 3 - nUp), flowTop = ups.slice(0, Math.min(ups.length, 3 - nDn)).concat(dns.slice(0, nDn));
  const flowBtn = ([k, v]) => `<button data-jump="${esc(mvKey[k])}" title="Go to ${esc(k)}"><b>${esc(k)}</b> <b class="${cls(v)}">${myDay$(v)}</b></button>`;
  const flow = mvL.length >= 2 && mvTot >= 1 ? `<div class="flow num">
    <div class="flow-h"><span>${word} in dollars</span><span>${ups.length ? `gains <b class="up">${myDay$(gSum)}</b>` : ""}${ups.length && dns.length ? " · " : ""}${dns.length ? `losses <b class="down">${myDay$(lSum)}</b>` : ""}</span></div>
    <div class="flow-bar" title="Each piece is one holding's dollar change ${dayWord()}: gains from the left, losses from the right. Click a piece to go to that holding.">${mvL.map(([k, v]) => `<button class="${v > 0 ? "g" : "l"}" style="flex:${(Math.abs(v) / mvTot * 100).toFixed(2)} 1 0" data-jump="${esc(mvKey[k])}" title="${esc(k)}${hid() ? "" : " " + fmtDay$(v)}: ${Math.round(Math.abs(v) / (v > 0 ? gSum : -lSum) * 100)}% of the day's ${v > 0 ? "gains" : "losses"}" aria-label="${esc(k)}"></button>`).join("")}</div>
    <div class="flow-l">${flowTop.map(flowBtn).join("")}${mvL.length > flowTop.length ? `<span class="muted" title="Sort the list by Today $ to see every holding in order">+${mvL.length - flowTop.length} more</span>` : ""}</div></div>` : "";
  const eye = `<button class="eye${hid() ? " on" : ""}" data-act="hide" aria-pressed="${hid()}" aria-label="${hid() ? "Show amounts" : "Hide amounts"}" title="${hid() ? "Show amounts again (H)" : "Hide amounts (H): masks your total, values, share counts, cost and cash. Prices and percents stay."}">${hid() ? EYE_OFF : EYE_ON}</button>`;

  body.innerHTML = `
    <div class="hero"><div class="hl"><div class="val num"><span title="Everything you own here: stocks, ETFs, mutual funds and cash, at the latest prices.${!hid() && P.total >= 1e5 ? " " + fmt$(P.total,0) : ""}">${any ? (hid() ? HID : fmtHero(P.total)) : "—"}</span>${eye}</div>${any && missingSyms.length ? `<small style="display:block;margin-top:3px;font-size:11px;color:var(--warn)" title="These holdings had no price on the last refresh, so the total leaves them out for now.">Leaves out ${esc(missingSyms.join(", "))} (no price)</small>` : ""}</div>
      ${any ? pfLineSvg() : ""}
      <div class="chg num" title="How much the whole portfolio moved today in dollars and percent. When the market is closed, this is the last trading day.">${any ? `<span class="cbox ${cls(P.dayUsd)}">${myS$(P.dayUsd)} <span>${fmtPct(P.dayPct)}</span></span>` : "—"}<small>${dayWord()}</small>${ahLine}${estLine}</div></div>
    <div class="kpis num">
      <div class="kpi ${cls(vs)}" title="Your stocks and ETFs today minus the S&amp;P 500 (cash and funds left out)"><b>${vs==null?"—":fmtPct(vs)}</b><span>stocks vs S&amp;P</span></div>
      <div class="kpi" title="Cash you listed in Settings → Holdings (rows with no ticker)"><b>${cashes.length?my$(cashTotal,0):"—"}</b><span>cash</span></div>
      <div class="kpi ${cls(gain)}" title="Your holdings now compared with what you paid for them${gain==null?"":": " + myS$(P.costVal - P.cost) + " on " + my$(P.cost,0) + " of cost"}. Needs the Avg cost column in Settings → Holdings."><b>${gain==null?"—":fmtPct(gain,1)}</b><span>${gain==null?"gain vs your cost":myS$(P.costVal - P.cost) + " vs cost"}</span></div>
    </div>
    ${flow}
    ${any && top.length ? riskHtml(RK, P, top, top3, offHi) : ""}
    <div class="alloc">${alloc}</div><div class="legend">${legend}</div>
    <div class="toolbar"><span style="flex:1"></span>
      <div class="seg" id="sortSeg">${[["value","Value","Biggest position first"],["day","Today %","Best percent change first"],["usd","Today $","Biggest dollar gain first"],["name","A–Z","By ticker"]].map(([k,l,t])=>`<button data-sort="${k}" class="${settings.sort===k?"on":""}" title="${t}">${l}</button>`).join("")}</div></div>
    <div class="hgrid">
      <div class="hhead" aria-hidden="true"><span class="h3" title="One share: its price, and under it how that price changed ${dayWord()}, in dollars and in percent">Per share</span><span class="h4" title="Your position: what your shares are worth, and under it the change on them ${dayWord()}, in dollars">Position</span></div>
      ${grpHtml}${fixedHtml}
    </div>
    ${P.missing && any ? `<div class="note">No price this round for ${esc(missingSyms.join(", "))}, so the total leaves ${missingSyms.length > 1 ? "them" : "it"} out. MW tries again with the next refresh.</div>` : ""}`;
  // the day line only shows when there is room for it between the total and the change
  { const pl = body.querySelector(".pfline"); if (pl && pl.getBoundingClientRect().width < 44) pl.remove(); }
  flashPass(body, "pf"); grpFit(); refocus(fk);
}
function holdRow(r, P){
  const q = r.q, key = "h:" + r.sym + ":" + (r.h.acct || ""), open = openRows.has(key), x = extFor(r.sym);
  const wt = r.val != null && P.total ? r.val / P.total * 100 : null, ch = chgOf(q), bq = quotes[settings.bench];
  const tdy = dayWord() === "today";
  let det = "";
  if (open){
    const gain = r.h.avg && q ? (q.c / r.h.avg - 1) * 100 : null, also = P.rows.filter(o => o.sym === r.sym && o !== r);
    const {T, NAMES} = symPanes(r.sym);
    const pos = [
      kv("Shares", myN(r.sh)), kv("Weight", wt == null ? "—" : wt.toFixed(1) + "%", {tip:"This position as a share of everything you own here"}),
      kv("Value", my$(r.val)),
      kv(tdy ? "Today" : "Last session", myS$(r.dayUsd, 2), {c:cls0(r.dayUsd), x:ch != null && !hid() ? `${fmtSh$(ch, q.c)} × ${myN(r.sh)}` : "", tip:"The day's change for one share times your shares"}),
      r.h.avg ? kv("Avg cost", my$(r.h.avg), {tip:"What you paid for one share, on average (Settings → Holdings)"}) : "", r.h.avg ? kv("Cost", my$(r.h.avg * r.sh, 0), {tip:"Your average cost times your shares"}) : "",
      r.h.avg && q ? kv("Gain", myS$((q.c - r.h.avg) * r.sh, 2), {c:cls(gain), x:fmtPct(gain, 1), tip:"The price now against your average cost"}) : "",
      r.h.avg && q ? kv("Gain a share", hid() ? (gain >= 0 ? "+" : "−") + HID : fmtSh$(q.c - r.h.avg, q.c), {c:cls(gain), tip:"The price now minus your average cost, for one share"}) : "",
      also.length ? `<span class="wide muted">Also in ${also.map(o => `${esc(o.h.acct || "Other")} (${myN(o.sh)} sh)`).join(", ")}: ${myN(also.reduce((a, o) => a + o.sh, r.sh))} sh in all</span>` : "",
      !r.h.avg ? `<span class="wide muted">Add your average cost in Settings → Holdings to see your gain here.</span>` : ""];
    const TT = Object.assign({position:pos}, T), keys = Object.keys(TT).filter(k => TT[k].some(Boolean)), cur = keys.includes(settings.hdTab) ? settings.hdTab : keys[0];
    const onW = cfg.watch.some(w => (w.sym || "").toUpperCase() === r.sym);
    det = `<div class="wdet num">
      <div class="wtabs" role="tablist">${keys.map(k => `<button role="tab" data-htab="${k}" aria-selected="${k === cur}" class="${k === cur ? "on" : ""}">${NAMES[k]}</button>`).join("")}</div>
      <div class="wpane">${TT[cur].join("")}</div>
      <div class="wacts"><button class="rbtn" data-chart="${esc(r.sym)}" title="Candles with averages and past report days (G)">Chart</button><button class="rbtn" data-ref="${esc(r.sym)}" title="Refresh just ${esc(r.sym)}">↻ Refresh</button>${onW ? `<button class="rbtn" data-wgo="${esc(r.sym)}" title="Open ${esc(r.sym)} on your watchlist, where its alerts are">Open in Watchlist</button>` : `<button class="rbtn" data-wadd="${esc(r.sym)}" title="Add ${esc(r.sym)} to your watchlist, to set price alerts and dip rules for it">+ Watchlist</button>`}${closeBtn(`data-rclose="${esc(key)}"`)}</div>
    </div>`;
  }
  const tip = q && ch != null ? `${r.sym} ${dayWord()}: ${chgTxt(ch, q.dp, 2, q.c)} a share` + (q.pc > 0 ? `, from ${fmtPx(q.pc)} to ${fmtPx(q.c)}` : "") + (bq && bq.dp != null && q.dp != null && r.sym !== settings.bench ? `. Against ${settings.bench}: ${fmtPct(q.dp - bq.dp,1)}` : "") : "";
  return `<div class="hrow" role="button" tabindex="0" data-row="${esc(key)}" aria-expanded="${open}">
    <div class="s"><span class="s1"><span class="tk">${esc(r.sym)}</span>${erChip(r.sym)}</span><small>${myN(r.sh)} sh${wt!=null?" · "+wt.toFixed(1)+"%":""}</small></div>
    ${sparkSvg(r.sym)}
    <div class="ps"><span class="px num" title="${esc(srcLine(q, x))}">${q ? extTag(x) : ""}<span data-fx="${esc(r.sym)}" data-fxk="${esc(r.h.acct||"")}">${q ? fmtPx(lastPx(r.sym)) : "—"}</span></span>${dchg(ch, q && q.dp, {tip, px:q && q.c})}${heldChip(r.sym)}${ageChip(r.sym, q)}${extChip(r.sym)}</div>
    <div class="v num">${r.val!=null ? `<b>${my$(r.val,0)}</b>` : `<b class="muted" style="font-weight:400" title="No price for ${esc(r.sym)} yet. It's left out of the total until the next refresh brings one.">no price</b>`}${r.dayUsd != null ? `<small class="${cls0(r.dayUsd)}" title="${esc(r.sym)} ${dayWord()} on your ${myN(r.sh)} shares: the change for one share times your shares">${myDay$(r.dayUsd)}</small>` : ""}</div>${det}</div>`;
}

/* ---------- markets ---------- */
function pctFor(sym, period){
  const q = quotes[sym];
  if (period === "1D") return q ? q.dp : null;
  const h = hist[sym], ref = h && h.refs[period];
  if (ref && ref.c){ const now = q && q.c ? q.c : h.last.c; return (now/ref.c - 1)*100; }
  const m = metrics[sym], P = PERIODS.find(p=>p.k===period);
  return m && m.r && P && P.f ? (m.r[P.f] ?? m.r[period] ?? null) : null;
}
/* a ticker's change over a period, in percent and in dollars for one share (1D: against the previous close) */
function chgFor(sym, period){
  const q = quotes[sym], pct = pctFor(sym, period);
  if (period === "1D") return {pct, usd: chgOf(q)};
  const h = hist[sym], ref = h && h.refs && h.refs[period], now = q && q.c > 0 ? q.c : h && h.last ? h.last.c : null;
  if (ref && ref.c > 0 && now > 0) return {pct, usd: now - ref.c};
  // no reference close on this PC (history not loaded yet): work the dollars back from the percent
  return {pct, usd: pct != null && isFinite(pct) && pct > -100 && now > 0 ? now - now / (1 + pct / 100) : null};
}
function refDate(period){
  for (const s of marketSyms()){ const r = hist[s] && hist[s].refs[period]; if (r) return r.d; }
  return null;
}
/* cross-asset tone (R12): a heuristic, not a signal. Each ETF's move is scored against its own normal day
   (from history), a 5-day stock move counts too, and the label only changes on a clear reading (hysteresis). */
let toneK = store.get("toneK", "mix");
function regime(){
  const d = sym => quotes[sym] && isFinite(quotes[sym].dp) ? quotes[sym].dp : null;
  const spy = d("SPY"), vix = d("VIXY"), hyg = d("HYG"), ief = d("IEF"), uup = d("UUP"), smh = d("SMH"), rsp = d("RSP");
  if (spy == null) return null;
  const inp = {}; ["SPY","QQQ","VIXY","HYG","IEF","UUP","SMH","RSP"].forEach(s => { const h = hist[s]; if (d(s) != null) inp[s] = {dp:d(s), vol: h && h.vol || null, r5: h && h.c4 && quotes[s] && quotes[s].c ? (quotes[s].c / h.c4 - 1) * 100 : null}; });
  const T = E.tone(inp, toneK);
  if (!T) return null;
  if (T.k !== toneK){ toneK = T.k; store.set("toneK", toneK); }
  const k = T.k, why = T.why, credit = hyg!=null && ief!=null ? hyg - ief : null;
  // [label, value, minor (hidden when narrow), up-is-bad]
  const chips = [];
  if (vix!=null) chips.push(["Vol (VIXY)", vix, false, true]);
  if (credit!=null) chips.push(["Credit vs Tsy", credit]);
  if (uup!=null) chips.push(["Dollar", uup, true, true]);
  if (smh!=null) chips.push(["Chips vs S&P", smh - spy]);
  if (rsp!=null) chips.push(["Equal-wt vs S&P", rsp - spy, true]);
  return {k, label: T.label, why, chips, score:T.score, needsHist: Object.values(inp).some(x => !x.vol)};
}
const XA_TIPS = {
  "Vol (VIXY)": "A fund that tracks expected market swings (VIX). Up means traders are paying for protection: fear is rising.",
  "Credit vs Tsy": "Riskier company bonds (HYG) compared with safe Treasuries (IEF). Down means lenders are getting nervous.",
  "Dollar": "The US dollar (UUP). A jumping dollar often means money is running to safety.",
  "Chips vs S&P": "Semiconductor stocks (SMH) compared with the S&P 500 today. Positive means chips are leading.",
  "Equal-wt vs S&P": "The average stock (RSP) compared with the S&P 500, which is dominated by giants. Positive means the move is broad, not just a few big names."
};
const RG_TIP = "Cross-asset tone: a heuristic read of market mood, not a buy or sell signal, and not tested as one.\nEach fund's move is scored against its own normal day, so a 3% volatility jump and a 0.3% dollar move count on the same scale.\nRisk-on tone: riskier things are being bought. Risk-off tone: money is moving to safety. Mixed: no clear lean.\nThe label only switches on a clear reading, so it doesn't flicker.";
/* the tile or index cell you clicked gets a details bar (6.0): price, the day's change for one share, the longer
   time frames, its chart, and a way onto your watchlist */
function mkFocusHtml(){
  const sym = settings.focus; if (!sym) return "";
  const m = [...MARKETS.indices, ...MARKETS.sectors, ...MARKETS.other, ...cfg.myMk.map(x => ({sym:x, name:x}))].find(x => x.sym === sym); if (!m) return "";
  const q = quotes[sym], c1 = chgFor(sym, "1D"), x = extFor(sym), onW = cfg.watch.some(w => (w.sym||"").toUpperCase() === sym);
  const pers = ["5D","1M","3M","YTD","1Y"].map(k => { const c = chgFor(sym, k); return c.pct == null ? "" : `<span title="${k === "YTD" ? "This year so far" : "The last " + k}: ${esc(chgTxt(c.usd, c.pct, 1))} a share">${k} <b class="${cls(c.pct)}">${fmtPct(c.pct, 1)}</b></span>`; }).join("");
  return `<div class="mkf num" data-mkf="${esc(sym)}">
    <div class="mkf-1"><b class="tk">${esc(sym)}</b><span class="nm">${m.name !== sym ? esc(m.name) : ""}</span><span class="px" title="${esc(srcLine(q, x))}">${q ? extTag(x) + fmtPx(lastPx(sym)) : "—"}</span>${dchg(c1.usd, c1.pct, {px:q && q.c, tip: q && q.pc > 0 ? `${sym} ${dayWord()}: from ${fmtPx(q.pc)} to ${fmtPx(q.c)} a share` : ""})}<button class="x" data-act="mkclose" title="Close" aria-label="Close the details">✕</button></div>
    <div class="mkf-2">${pers || `<span class="muted">${settings.tdKey ? "Longer time frames are loading" : "Add a free Twelve Data key for longer time frames"}</span>`}${x ? extChip(sym) : ""}<span class="sp"></span><button class="rbtn" data-chart="${esc(sym)}" title="Candles with averages and past report days">Chart</button>${onW ? `<button class="rbtn" data-wgo="${esc(sym)}" title="Open ${esc(sym)} on your watchlist, where its alerts are">Open in Watchlist</button>` : `<button class="rbtn" data-wadd="${esc(sym)}" title="Add ${esc(sym)} to your watchlist with the default dip rules">+ Watchlist</button>`}</div></div>`;
}
function renderMarkets(){
  const per = settings.period, cap = HEAT_CAP[per] || 15, dec = per==="1D" ? 2 : 1;
  const vis = a => a.filter(m => !cfg.hiddenMk.includes(m.sym));
  const idx = vis(MARKETS.indices), sec = vis(MARKETS.sectors), oth = vis(MARKETS.other);
  const my = cfg.myMk.map(sym => ({sym, name:sym}));
  // breadth (R12): only the 11 S&P sector funds, which split the index without overlap
  const sec11 = sec.filter(m => SPDR11.includes(m.sym));
  const secP = sec11.map(m => pctFor(m.sym, "1D")).filter(v => v!=null);
  const upN = secP.filter(v => v >= 0).length;
  const above = sec11.filter(m => { const h = hist[m.sym], q = quotes[m.sym]; return h && h.sma50 && q && q.c; });
  const aboveN = above.filter(m => quotes[m.sym].c > hist[m.sym].sma50).length;
  const rg = xaOn() ? regime() : null;
  $("mk-sum").innerHTML = idx.slice(0,2).map((m,i)=>{ const p = pctFor(m.sym,"1D"); return `<span class="${i?"mk-nq":""}">${esc(m.name.replace(" 500","").replace(" 100",""))} <b class="${cls(p)}">${fmtPct(p,1)}</b></span>`; }).join("") +
    (rg ? `<span class="rg ${rg.k}" title="${esc(RG_TIP + "\n\nRight now: " + (rg.why.join(", ") || "no strong signal"))}">${rg.label}</span>` : secP.length?`<span class="muted mk-up">${upN}/${secP.length} up</span>`:"");
  const multi = sym => ["1D","5D","1M","YTD"].map(k => { const c = chgFor(sym, k); return c.pct == null ? null : `${k} ${k === "1D" ? chgTxt(c.usd, c.pct, 2, quotes[sym] && quotes[sym].c) : fmtPct(c.pct, 1)}`; }).filter(Boolean).join(" · ");
  // every tile and index cell shows the change over the chosen time frame in percent and, under it, in dollars for one share
  const tiles = arr => { let a = arr.map(m => ({...m, ...chgFor(m.sym, per)}));
    if (settings.heatOrder === "rank") a = a.sort((x,y)=>(y.pct??-1e9)-(x.pct??-1e9));
    return a.map(m => `<button class="tile ${settings.focus===m.sym?"focus":""}" data-tile="${m.sym}" data-fx="${m.sym}" style="background:${heatColor(m.pct, cap)}" title="${esc(m.name)} (${m.sym})${quotes[m.sym] ? " " + fmtPx(quotes[m.sym].c) : ""}\n${esc(multi(m.sym))}\nClick for more.">
      <span class="n">${esc(m.name)}${erChip(m.sym)}</span><span class="b"><span class="p num">${fmtPct(m.pct, dec)}</span><span class="d num"><span class="u">${m.usd == null ? "" : fmtSh$(m.usd, quotes[m.sym] && quotes[m.sym].c)}</span><span class="t">${m.sym===m.name?"":m.sym}</span></span></span></button>`).join(""); };
  const fIdx = [...idx, ...oth, ...my].some(m => m.sym === settings.focus), fSec = !fIdx && sec.some(m => m.sym === settings.focus);
  const anyPeriod = per==="1D" || sec.some(m => pctFor(m.sym, per) != null);
  $("mk-body").innerHTML = `
    ${rg ? `<div class="regime num" title="${esc(rg.label + ": " + (rg.why.join(", ") || "no strong signal either way") + "\n\n" + RG_TIP)}"><span class="muted" style="font-size:10.5px">${esc((w => w ? w[0].toUpperCase() + w.slice(1) : "No strong signal")(rg.why.join(", ")))}</span>${rg.chips.map(([n,v,minor,inv])=>`<span class="xa ${minor?"mk-up":""}" title="${esc(XA_TIPS[n]||"")}">${esc(n)} <b class="${cls(inv ? -v : v)}">${fmtPct(v,1)}</b></span>`).join("")}</div>` : ""}
    ${macroHtml()}
    <div class="seg perseg" id="perSeg">${PERIODS.map(p=>`<button data-per="${p.k}" class="${per===p.k?"on":""}" title="Show the change over ${p.label === "1D" ? "today" : p.label === "YTD" ? "this year so far" : "the last " + p.label}">${p.label}</button>`).join("")}</div>
    <div class="idx num">${[...idx, ...oth, ...my].map(m=>{ const q = quotes[m.sym], c = chgFor(m.sym, per); return `<button class="c ${settings.focus===m.sym?"focus":""}" data-tile="${m.sym}" data-fx="${m.sym}" title="${esc(m.name === m.sym ? m.sym : m.name + " (" + m.sym + ")")}\n${esc(multi(m.sym))}\nClick for more."><span>${esc(m.name)}${erChip(m.sym)}</span><b class="${cls(c.pct)}">${fmtPct(c.pct, dec)}</b>${c.usd != null ? `<u class="${cls(c.pct)}">${fmtSh$(c.usd, q && q.c)}</u>` : ""}<em>${q?fmtPx(lastPx(m.sym)):"—"}</em>${(()=>{ const x = extFor(m.sym); return x ? `<i class="${cls(x.pct)}" title="${x.ph === "pre" ? "Pre-market" : "After hours"} ${fmtPx(x.p)} on IEX: ${fmtSh$(x.p - x.base, x.p)} a share against the close">${x.ph === "pre" ? "Pre" : "AH"} ${fmtPct(x.pct,1)}</i>` : ""; })()}</button>`; }).join("")}</div>
    ${fIdx ? mkFocusHtml() : ""}
    <div class="toolbar"><button class="sec-t" data-act="sectors" style="flex:1;font-size:11px;text-align:left;display:flex;align-items:center;gap:4px" title="Show or hide the sector tiles"><svg class="chev" style="width:11px;height:11px;${settings.secHide?"transform:rotate(-90deg)":""}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>Sectors</button>
      <div class="seg" id="ordSeg"><button data-ord="fixed" class="${settings.heatOrder!=="rank"?"on":""}" title="Tiles stay in the same place">Fixed</button><button data-ord="rank" class="${settings.heatOrder==="rank"?"on":""}" title="Best to worst">Ranked</button></div><button class="rbtn secref" data-act="secref" title="Refresh every sector tile now" aria-label="Refresh sectors" ${refreshMany.busy?"disabled":""}>${refreshMany.busy?"…":"↻"}</button><button class="rbtn" data-open="markets" title="Add your own tickers to the market tiles, or hide any tile (Settings → Markets)">Edit</button></div>
    ${settings.secHide ? "" : `<div class="heat">${tiles(sec)}</div>${fSec ? mkFocusHtml() : ""}`}
    ${secP.length?`<div class="breadth" title="How many of the 11 S&amp;P sector funds (XLK to XLRE) are up today, and how many trade above their 50-day average. Chips, power grid and software are left out because they overlap those 11."><span>${upN} of ${secP.length} sectors up today${above.length?` · ${aboveN} of ${above.length} above 50-day`:""}</span><span class="bar"><i style="width:${(upN/secP.length*100).toFixed(0)}%"></i></span></div>`:""}
    ${erPanelHtml()}
    ${anyPeriod?"":`<div class="note">${per} isn't loaded yet. ${settings.tdKey?"History loads in the background (about 3 minutes the first time each day).":"Add a free Twelve Data key in Settings to unlock 1M, 3Y and 5Y and make every time frame exact."}</div>`}
    ${per!=="1D"&&refDate(per)?`<div class="note">${per} change since ${(d=>(+d.slice(5,7))+"/"+(+d.slice(8,10))+"/"+d.slice(2,4))(refDate(per))}</div>`:""}`;
  flashPass($("mk-body"), "mk");
}

/* ---------- watchlist ---------- */
function watchInfo(w){
  const sym = (w.sym||"").toUpperCase(), q = quotes[sym], m = metrics[sym] || {}, off = w.on===false || settings.allOff;
  const ended = !E.levelsLive(w, etNow().date), lv = ended ? [] : effLevels(w), useLv = w.levelsOn!==false && lv.length, px = q && q.c;
  const hitL = useLv && px ? lv.filter(L => px <= L) : [], next = useLv && px ? lv.find(L => L < px) : null;
  const dist = next ? (px/next - 1)*100 : null, vol = volOf(sym);
  const red = !!(px && q.dp!=null && w.redOn!==false && w.dayDrop && q.dp <= -w.dayDrop);
  let st = hitL.length || red ? "hit" : (dist!=null && w.nearOn!==false && w.near && dist <= w.near) ? "near" : "";
  return {sym, q, m, off, lv, useLv, px, hitL, next, dist, vol, red, st, ended: ended && (w.levels||[]).length ? w.lvUntil : ""};
}
/* what to say about a ticker's level position (row, compact strip, tray) */
const fmtL = L => fmt$(L, L < 100 ? 2 : 0);   // levels under $100 keep their cents
function levelText(I, short){
  const deep = I.hitL[I.hitL.length-1];
  if (deep != null){
    const below = (I.px/deep - 1)*100;
    if (!I.next && below < -0.5) return short ? `${fmtPct(below,1)} < ${fmtL(deep)}` : `${fmtPct(below,1)} below ${fmtL(deep)}, your lowest alert`;
    return short ? "at " + fmtL(deep) : "At your " + fmtL(deep) + " alert";
  }
  return null;
}
function renderWatch(){
  if (dragSym) return;   // don't redraw under a drag in progress
  let hits = 0, nears = 0; const fk = focusKey();
  const bench = settings.bench, bq = quotes[bench];
  const html = watchLayout().map(x => x.hdr != null ? x.hdr : (w => {
    const I = watchInfo(w), {sym, q, m, off, lv, useLv, px, hitL, next, dist, vol} = I;
    const fromHi = m.hi && px ? (1 - px/m.hi)*100 : null;
    const ch = chgOf(q), x = extFor(sym);
    // the second line, left: where the price stands against your alerts. A short note follows it in a wide window;
    // a long one, or any note in a narrow window, takes lines of its own. Both wrap, so neither is ever cut short.
    const parts = [];
    if (useLv && px){
      if (hitL.length) parts.push(`<span class="st hit">${levelText(I)}</span>${next ? `<span class="muted"> · </span>next ${fmtL(next)}` : ""}`);
      else if (next) parts.push(`<span title="Your next price alert below the price now (Settings → Watchlist). The price is ${fmtPx(px - next, px)} a share (${dist.toFixed(1)}%) above it${vol ? ", about " + (dist/vol).toFixed(1) + " normal days' moves (σ) for this ticker" : ""}.">Alert <b>${fmtL(next)}</b> · <span class="st ${I.st}">${dist.toFixed(1)}% away</span>${vol && dist/vol < 15 ? `<span class="wsig"> · ${(dist/vol).toFixed(1)}σ</span>` : ""}</span>`);
      else parts.push(`<span class="muted">Below all your price alerts</span>`);
    }
    if (I.red) parts.push(`<span class="st hit">Red day ${fmtPct(q.dp,1)}</span>`);
    if (!parts.length) parts.push(`<span class="muted">${px ? "Watching" : "Waiting for a price"}</span>`);
    if (!off){ if (I.st==="hit") hits++; else if (I.st==="near") nears++; }
    const rel = px && bq && bq.dp!=null && sym !== bench && q.dp!=null ? q.dp - bq.dp : null;
    const sv = px && session().s === "open" ? sessVwap(sym) : null, vwd = sv ? (px / sv.vw - 1) * 100 : null;
    const sn = snoozed(sym);
    const insane = px && useLv ? E.levelSanity(lv, px) : [];
    // the second line, right: anything that needs a look, then the sector and 52-week reads. Before and after hours
    // the pre-market / after-hours move takes the place of "vs the benchmark" (a regular-session figure).
    const flags = heldChip(sym) + ageChip(sym, q, off) + extChip(sym)
      + (I.ended && !off ? `<span class="chip" title="The price alerts for ${esc(sym)} were set to end on ${esc(I.ended)}. Change or clear the date in Settings → Watchlist.">alerts ended</span>` : "")
      + (insane.length ? `<span class="chip flag" title="${esc(insane.map(fmtL).join(", "))} ${insane.length > 1 ? "are" : "is"} more than 3x away from today's price. A stock split, or a typo? Check Settings → Watchlist.">check alerts</span>` : "");
    const right = `<span class="r">${flags}${vwd!=null?`<span class="num" title="Price vs today's VWAP (${fmtPx(sv.vw)}), the average price paid today weighted by volume. Under it, sellers have the upper hand today; climbing back over it after a drop often means the selling has paused.">VWAP <b class="${cls(vwd)}">${fmtPct(vwd,1)}</b></span>`:""}${rel!=null && !x?`<span class="num vsb" title="Today's move minus ${esc(bench)}'s: separates a sector-wide dip from a stock-specific drop">vs ${esc(bench)} <b class="${cls(rel)}">${fmtPct(rel,1)}</b></span>`:""}${fromHi!=null?`<span class="num" title="How far the price is from its 52-week high of ${fmtPx(m.hi)}: ${fmtPx(Math.abs(m.hi - px), px)} a share">52w high <b class="${fromHi>0?"down":""}">${sgn(-fromHi, 1)}${Math.abs(fromHi).toFixed(1)}%</b></span>`:""}${off?`<span class="chip">alerts off</span>`:sn?`<span class="chip" title="Snoozed until ${timeStr(settings.snooze[sym])}">snoozed</span>`:""}<span class="wexp" aria-hidden="true" title="${openRows.has("w:"+sym) ? "Hide details (Esc)" : "Show details"}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg></span></span>`;
    const open = openRows.has("w:"+sym);
    let det = "";
    if (open){
      // details in tabs (Today, Trend, Company, News) so an open row stays short, with one action bar and a Close
      const {T, NAMES} = symPanes(sym);
      const keys = Object.keys(T).filter(k => T[k].some(Boolean)), cur = keys.includes(settings.wdTab) ? settings.wdTab : keys[0];
      det = `<div class="wdet num">
        <div class="wtabs" role="tablist">${keys.map(k => `<button role="tab" data-wtab="${k}" aria-selected="${k === cur}" class="${k === cur ? "on" : ""}">${NAMES[k]}</button>`).join("")}</div>
        <div class="wpane">${cur ? T[cur].join("") : `<span class="muted">No details yet.</span>`}</div>
        <div class="wacts"><button class="rbtn" data-chart="${esc(sym)}" title="Candles with averages, your price alerts and past report days (G)">Chart</button><button class="rbtn" data-walerts="${esc(sym)}" title="Open Settings → Watchlist at ${esc(sym)}: its price alerts and dip rules">Edit alerts</button><button class="rbtn" data-ref="${esc(sym)}" title="Refresh just ${esc(sym)}">↻ Refresh</button>${off?"":`<button class="rbtn" data-snzsym="${esc(sym)}" data-how="30">Snooze 30m</button><button class="rbtn" data-snzsym="${esc(sym)}" data-how="day">Mute today</button>`}<button class="rbtn" data-wmove="${esc(sym)}:top" title="Put ${esc(sym)} first on your watchlist">⤒ Top</button><button class="rbtn" data-wmove="${esc(sym)}:up" title="Move up one (Alt+↑)" aria-label="Move up">↑</button><button class="rbtn" data-wmove="${esc(sym)}:down" title="Move down one (Alt+↓)" aria-label="Move down">↓</button><button class="rbtn wrm" data-wrm="${esc(sym)}" title="Take ${esc(sym)} off your watchlist (Delete). Undo shows on the list for 12 seconds.">Remove</button>${closeBtn(`data-wclose="${esc(sym)}"`)}</div>
      </div>`;
    }
    const armed = armedRules(w, I), pulse = firedAt[sym] && Date.now() - firedAt[sym] < 4000;
    const bellHtml = armed.length ? `<span class="bell${I.st === "hit" ? " hit" : ""}" title="${armed.length} alert${armed.length > 1 ? "s" : ""} armed: ${esc(armed.join(", "))}">${BELL_SVG}${armed.length}</span>` : "";
    const longNote = !!w.note && w.note.length > 28;   // too long to sit after the status: it gets its own lines
    return `<div class="wrow ${off?"muted-row":I.st?"st-"+I.st:""}${pulse?" pulse":""}${longNote?" nl":""}" data-row="w:${esc(sym)}" role="button" tabindex="0" aria-expanded="${open}">
      <span class="grip" data-grip="1" title="Drag to reorder your watchlist">⠿</span>
      <div class="s"><span class="s1"><span class="tk">${esc(sym)}</span>${bellHtml}${erChip(sym, true)}</span></div>
      ${sparkSvg(sym, lv)}
      <div class="v num" title="${esc(srcLine(q, x))}">${extTag(x)}<span data-fx="${esc(sym)}">${px?fmtPx(lastPx(sym)):"—"}</span></div>
      <div class="c">${dchg(ch, q && q.dp, {px, tip: q && q.pc > 0 && ch != null ? `${sym} ${dayWord()}: ${chgTxt(ch, q.dp, 2, q.c)} a share, from ${fmtPx(q.pc)} to ${fmtPx(q.c)}` : ""})}</div>
      <div class="wmeta"><span class="wl"><span class="in">${parts.map(p => `<span class="p">${p}</span>`).join("")}${w.note && !longNote ? `<span class="p wn-in" title="Your note (Settings → Watchlist)">${esc(w.note)}</span>` : ""}</span></span>${right}</div>${w.note ? `<div class="wnote" title="Your note (Settings → Watchlist): ${esc(w.note)}">${esc(w.note)}</div>` : ""}${det}</div>`;
  })(x.w)).join("");
  const undo = watchUndo && Date.now() - watchUndo.t < 12e3 ? `<div class="wundo">Removed <b>${esc(watchUndo.w.sym)}</b><button class="lnk" data-wundo="1">Undo</button></div>` : "";
  const keep = document.activeElement && document.activeElement.id === "wAddSym" ? $("wAddSym").value : null;
  const sorter = cfg.watch.length > 2 ? `<div class="wsort"><div class="seg">${[["mine","My order"],["day","Biggest drop"],["alert","Closest to an alert"]].map(([k, n]) => `<button data-wsort="${k}" class="${wSort === k ? "on" : ""}">${n}</button>`).join("")}</div>${wSort !== "mine" ? `<span class="muted" title="This sort is for now only: MW goes back to your order when it restarts. Dragging is off while sorted.">for now</span>` : ""}</div>` : "";
  document.body.classList.toggle("wsorted", wSort !== "mine");
  $("wl-body").innerHTML = sorter + `<form class="wadd" id="wAdd" autocomplete="off"><input id="wAddSym" placeholder="Add a ticker, e.g. NVDA" maxlength="10" spellcheck="false" aria-label="Add a ticker to your watchlist"><button class="btn" type="submit">Add</button></form>`
    + undo + (html ? `<div class="wlist">${html}</div>` : `<div class="empty" style="padding:14px 0 6px">Nothing on your watchlist yet. Type a ticker above.</div>`);
  if (keep != null){ const i = $("wAddSym"); i.value = keep; i.focus(); }
  flashPass($("wl-body"), "wl"); refocus(fk);
  $("wl-sum").innerHTML = settings.allOff ? `<span class="muted">alerts off</span>` : pausedNow() ? `<span style="color:var(--warn);font-weight:600">paused</span>` : (hits?`<span class="down" style="font-weight:600">${hits} alerting</span>`:"") + (nears?`<span style="color:var(--warn);font-weight:600">${nears} near</span>`:"") + (!hits&&!nears?`<span class="muted">${cfg.watch.length} watching</span>`:"");
  // compact strip: same order as the Watchlist (your drag order), so rows don't jump around between refreshes
  const rows = cfg.watch.map(watchInfo);
  $("strip").innerHTML = rows.map(I => !I.px ? `<div class="srow num"><span class="s"><span class="s1"><span class="tk">${esc(I.sym)}</span>${erChip(I.sym)}</span></span><span class="muted">—</span><span></span><span></span><span class="d">waiting</span></div>` : `<div class="srow num"><span class="s"><span class="s1"><span class="tk">${esc(I.sym)}</span>${erChip(I.sym)}</span></span><span data-fx="${esc(I.sym)}">${fmtPx(lastPx(I.sym) || I.px)}</span><span class="${cls(I.q.dp)}" title="${esc(I.sym)} ${dayWord()}, for one share">${fmtSh$(chgOf(I.q), I.px)}</span><span class="${cls(I.q.dp)}">${fmtPct(I.q.dp,1)}</span>
    <span class="d ${I.hitL.length||I.red?"hit":I.st}"${!I.hitL.length && I.next ? ` title="${esc(I.sym)} is ${I.dist.toFixed(1)}% above your next price alert, ${fmtL(I.next)}"` : ""}>${I.hitL.length ? levelText(I, true) : I.next ? `${I.dist.toFixed(1)}%<span class="lv"> → ${fmtL(I.next)}</span>` : I.red ? "red day" : "—"}</span></div>`).join("") || `<div class="muted" style="grid-column:1/-1;font-size:11.5px">No tickers on your watchlist yet.</div>`;
  flashPass($("strip"), "st"); stripFit();
}
/* an account header never cuts the small label after its name ("12 holdings", "as of 11/9"): in a window with no
   room for all of it, the label steps aside */
function grpFit(){
  const ls = [...document.querySelectorAll("#pf-body .grp-h > .muted")];
  ls.forEach(l => l.classList.remove("nofit"));
  ls.filter(l => l.scrollWidth > l.clientWidth + 1).forEach(l => l.classList.add("nofit"));
}
/* the compact strip never cuts a ticker, an earnings chip or a number. A window too narrow for all of it sheds detail
   in this order: the chip's date ("ER", the date is in its tooltip), the alert price after the distance, the chip.
   Only if that still isn't enough may the last column wrap. */
function stripFit(){
  const st = $("strip"); if (!st) return;
  const steps = ["tight", "tighter", "tightest", "wrapok"];
  st.classList.remove(...steps);
  if (!st.clientWidth) return;   // not in compact view
  const over = () => st.scrollWidth > st.clientWidth + 1 || [...st.querySelectorAll(".s, .er")].some(c => c.scrollWidth > c.clientWidth + 1);
  for (const c of steps){ if (!over()) break; st.classList.add(c); }
}
/* watchlist sections (Settings → Watchlist → Section) and a sort that lasts until MW restarts */
let wSort = "mine";
function watchLayout(){
  const key = w => { const I = watchInfo(w); return wSort === "day" ? (I.q && I.q.dp != null ? I.q.dp : 1e9) : wSort === "alert" ? (I.hitL.length ? -1e9 + I.hitL.length : I.dist != null ? I.dist : 1e9) : 0; };
  const sorted = list => wSort === "mine" ? list : list.slice().sort((a, b) => key(a) - key(b));
  if (!cfg.watch.some(w => w.grp)) return sorted(cfg.watch).map(w => ({w}));
  const groups = []; cfg.watch.forEach(w => { const g = w.grp || ""; let G = groups.find(x => x.g === g); if (!G) groups.push(G = {g, list:[]}); G.list.push(w); });
  groups.sort((a, b) => (a.g === "") - (b.g === ""));   // the unnamed group goes last
  const out = [];
  groups.forEach(G => { const k = "wg:" + (G.g || "_"), shut = !!(settings.grpCollapsed || {})[k];
    out.push({hdr:`<div class="wgrp" data-grp="${esc(k)}" role="button" tabindex="0" aria-expanded="${!shut}"><svg class="chev" style="${shut ? "transform:rotate(-90deg)" : ""}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>${esc(G.g || "Other")}<span>${G.list.length}</span></div>`});
    if (!shut) sorted(G.list).forEach(w => out.push({w})); });
  return out;
}
/* add and remove watchlist tickers (main screen and Settings → Watchlist share these) */
let watchUndo = null;
function watchAdd(raw){
  const sym = String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, ""); if (!sym) return null;
  if (cfg.watch.some(w => (w.sym||"").toUpperCase() === sym)){ toast(sym + " is already on your watchlist"); return "dup"; }
  cfg.watch.push(Object.assign({sym}, JSON.parse(JSON.stringify(WATCH_DEFAULTS))));
  saveCfg("watchlist"); mwLog("info", "watchlist: added " + sym); toast(sym + " added to your watchlist");
  renderAll(); refreshOne(sym, true); if (settings.tdKey) loadHist([sym]);
  return sym;
}
const WATCH_DEFAULTS = {note:"", dayDrop:3, offHigh:10, levels:[], near:1.5, hiDrop:4, sigDrop:2, fastDrop:2, fastMins:15};
function watchAddMany(syms){
  syms.forEach(sym => cfg.watch.push(Object.assign({sym}, JSON.parse(JSON.stringify(WATCH_DEFAULTS)))));
  saveCfg("watchlist"); mwLog("info", "watchlist: added " + syms.join(", ")); renderAll();
  refreshMany(syms, "Prices for the new tickers"); if (settings.tdKey) loadHist(syms);
}
/* close an open row's details and put the focus back on the row, so the list doesn't jump */
function closeRow(k){
  if (!k) return; openRows.delete(k); k[0] === "w" ? renderWatch() : renderPortfolio();
  const el = document.querySelector(`[data-row="${CSS.escape(k)}"]`); if (el){ el.focus({preventScroll:true}); el.scrollIntoView({block:"nearest"}); }
}
function watchRemove(sym){
  const i = cfg.watch.findIndex(w => (w.sym||"").toUpperCase() === sym); if (i < 0) return;
  watchUndo = {w:cfg.watch[i], i, t:Date.now()}; cfg.watch.splice(i, 1); openRows.delete("w:" + sym);
  saveCfg("watchlist"); mwLog("info", "watchlist: removed " + sym); renderAll();
  clearTimeout(watchRemove._t); watchRemove._t = setTimeout(()=>{ watchUndo = null; safe("watchlist", renderWatch); }, 12e3);
}
function watchRestore(){
  if (!watchUndo) return; const {w, i} = watchUndo; watchUndo = null;
  if (!cfg.watch.some(x => (x.sym||"").toUpperCase() === (w.sym||"").toUpperCase())) cfg.watch.splice(Math.min(i, cfg.watch.length), 0, w);
  saveCfg("watchlist"); renderAll(); toast(w.sym + " is back on your watchlist");
}
// the list redraws while adding, so clear and focus the box that is on screen afterwards, not the old one
document.addEventListener("submit", e => { if (e.target.id !== "wAdd") return; e.preventDefault();
  const r = watchAdd($("wAddSym").value), j = $("wAddSym"); if (!j) return;
  if (r && r !== "dup") j.value = ""; j.focus(); if (r === "dup") j.select(); });
function renderLog(){
  const f = firedToday();
  $("log-sum").innerHTML = f.log.length ? `<span>${f.log.length} today</span>` : `<span class="muted">none yet</span>`;
  $("log-body").innerHTML = f.log.length ? f.log.slice(0,40).map(l=>`<div ${l.quiet?'class="muted" title="Logged quietly: this ticker alerted in the last 15 min"':""}><time>${timeStr(l.t)}</time><span>${esc(l.msg)}${l.nd ? ` <em class="chip stale" title="This alert showed here, but the phone alert didn't go through (ntfy didn't answer). Check the topic in Settings → General.">phone: not sent</em>` : ""}</span></div>`).join("") : `<div class="muted">No alerts yet today.</div>`;
}
/* where a price came from, for tooltips (R19) */
function srcLine(q, x){
  if (!q || !q.c) return "No price yet";
  if (x) return `${x.ph === "pre" ? "Pre-market" : "After-hours"} trade on IEX (Alpaca's free feed) at ${dateTime(x.t)} ${tzAbbr(x.t)}, the latest known price. Close ${fmtPx(q.c)} (${q.src === "twelvedata" ? "Twelve Data" : q.src === "alpaca" ? "Alpaca IEX" : "Finnhub"}, last trade ${q.t ? dateTime(q.t * 1000) : "unknown"}); the day's change is the regular session's.`;
  const src = q.src === "twelvedata" ? "Twelve Data (backup)" : q.src === "alpaca" ? "Alpaca IEX (fast prices)" : "Finnhub";
  return `${src} quote · last trade ${q.t ? dateTime(q.t * 1000) : "unknown"} · fetched ${q.at ? dateTime(q.at) : "—"}. Price return only (no dividends).`;
}

/* ---------- frame ---------- */
const dateTime = t => dayOf(t) === dayOf(Date.now()) ? timeStr(t) : new Date(t).toLocaleDateString("en-US", {weekday:"short", month:"numeric", day:"numeric", timeZone:tzName()}) + " " + timeStr(t);
function dataState(){
  const ses = session(), ms = refreshMs(), age = lastUpdate ? Date.now() - lastUpdate : Infinity;
  if (ses.s === "unknown") return {k:"bad", why:"Market calendar expired; alerts are off"};
  if (!settings.key) return {k:"bad", why:"No market-data key yet"};
  if (health.at && health.total && health.ok === 0) return {k:"bad", why:"No prices came back on the last refresh"};
  if (ses.s === "open" && watchSt && watchSt.state === "blind") return {k:"bad", why:"Not watching: too few fresh prices"};
  if (ses.s === "open" && ms && age > Math.max(2*ms, 3*60e3)) return {k:"stale", why:`Prices are ${Math.round(age/60000)} min old`};
  if (health.fail.length) return {k:"stale", why:`${health.fail.length} symbol(s) didn't update`};
  return {k:"ok", why:""};
}
/* status pill: open → time left to the close; otherwise → time to the next open */
function clockText(mc, now = Date.now(), short = false){
  if (mc.ph === "unknown") return short ? "Calendar?" : "Calendar expired";
  const left = mc.until - now;
  if (mc.ph === "open") return (short ? "" : "Open · ") + fmtLeft(left) + " left";
  if (left < 24*3600e3) return (short ? "Opens " : "Opens in ") + fmtLeft(left);
  return short ? "Opens " + new Date(mc.until).toLocaleDateString("en-US", {weekday:"short", timeZone:tzName()}) : "Opens " + whenStr(mc.until);
}
function clockSentence(mc, now = Date.now()){
  if (mc.ph === "unknown") return "MW's market calendar ends " + E.CAL_VALID_TO + ", so it can't tell when the market is open. Alerts are off.";
  const left = fmtLeft(mc.until - now);
  if (mc.ph === "open") return `Market open. Closes at ${timeTz(mc.until)}${mc.early ? " (half day)" : ""}, in ${left}.`;
  const lead = {pre:"Pre-market.", after:"After hours.", overnight:"Overnight session.", pause:`Nightly pause; overnight trading resumes at ${mc.extStarts ? timeTz(mc.extStarts) : "9 PM ET"}.`, closed: mc.label === "Holiday" ? "Market holiday." : mc.label === "Weekend" ? "Weekend." : "Market closed."}[mc.ph];
  return `${lead} Opens ${whenStr(mc.until)} ${tzAbbr(mc.until)}, in ${left}.`;
}
function renderPill(ses = session(), ds = dataState()){
  const mc = marketClock(), ageMin = lastUpdate ? Math.round((Date.now()-lastUpdate)/60000) : 0;
  $("mkt").className = "pill " + (ses.s==="open"?"open":ses.s==="ext"?"ext":"") + (ds.k!=="ok" ? " " + ds.k : "") + (mc.ph==="open" && mc.until - Date.now() <= 15*60e3 ? " closing" : "");
  $("mkt").lastElementChild.textContent = ds.k==="stale" && ses.s==="open" && ageMin >= 2 ? `${ageMin}m old` : ds.k==="bad" ? "No data" : clockText(mc, Date.now(), $("titlebar").clientWidth < (document.body.classList.contains("native") ? 440 : 340));
  $("mkt").title = (ds.why ? ds.why + ". " : "") + (mc.ph === "unknown" ? "MW's market calendar has run out." : clockSentence(mc)) + (ses.s==="open" ? (alpOn() && !alpSt.err ? ` Prices update every 5 seconds from Alpaca's IEX feed; Finnhub refreshes the full quote about ${everyStr(refreshMs()||60e3)}.` : ` Prices refresh about ${everyStr(refreshMs()||60e3)} from Finnhub's free feed.`) : alpOn() ? (ses.s==="ext" ? " Prices are the latest pre-market or after-hours trades from Alpaca's IEX feed, every 5 seconds while MW is on screen; the day's change stays on the regular session." : " Prices are the last trades, after hours included (marked AH); pre-market prices start at 4 AM ET.") : " Showing the last close. Add a free Alpaca key in Settings → General for pre-market and after-hours prices.") + " Click for details.";
}
function renderFrame(){
  const ses = session(), ds = dataState();
  $("mkt").className = "pill " + (ses.s==="open"?"open":ses.s==="ext"?"ext":"") + (ds.k!=="ok" ? " " + ds.k : "");
  const ageMin = lastUpdate ? Math.round((Date.now()-lastUpdate)/60000) : 0;
  renderPill(ses, ds);
  const age = lastUpdate ? Math.round((Date.now()-lastUpdate)/60000) : null;
  $("upd").textContent = lastUpdate ? (ses.s==="open" ? `Updated ${dateTime(lastUpdate)}${age>=3 ? ` (${age} min ago)` : ""}` : `Last close prices · checked ${dateTime(lastUpdate)}`) : "";
  const b = $("banner");
  if (b.classList.contains("show") && bannerDay && (bannerDay !== etNow().date || (ses.s !== "open" && lastAlertAt && Date.now() - lastAlertAt > 30*60e3))) b.classList.remove("show");
  const sn = $("since");
  if (sn.classList.contains("show") && (Date.now() - (+sn.dataset.at||0) > 15*60e3 || sn.dataset.day !== etNow().date)) sn.classList.remove("show");
  const p = $("paused");
  p.classList.toggle("show", !!pausedNow());
  if (pausedNow()) p.innerHTML = `<span>Alerts paused for the rest of today</span><button data-act="resume">Resume</button>`;
  $("mPauseLbl").textContent = pausedNow() ? "Resume alerts" : "Pause alerts today";
  if (!$("statusPop").classList.contains("hide")) renderStatus();
}
function renderAll(){
  $("mCompactLbl").textContent = settings.compact ? "Full view" : "Compact view";
  $("mHideLbl").textContent = settings.hideAmt ? "Show amounts" : "Hide amounts";
  document.body.classList.toggle("compact", !!settings.compact);
  safe("layout", applyLayout);
  document.querySelectorAll(".sec").forEach(s => s.classList.toggle("collapsed", !!settings.collapsed[s.dataset.sec]));
  safe("portfolio", renderPortfolio); safe("markets", renderMarkets); safe("watchlist", renderWatch); safe("alert log", renderLog); safe("status", renderFrame);
  safe("title", ()=>{ const P = portfolioCalc();
    document.title = (settings.compact && Object.keys(quotes).length && cfg.holdings.length) ? `${hid() ? "" : fmt$(P.total,0) + " "}${fmtPct(P.dayPct)} · MW` : "MW"; });
  safe("tray", updateTray);
  safe("chart", chartLive);
  safe("news", renderNews);
}
function renderStatus(){
  const ses = session(), ds = dataState(), d = etNow().date, L = tdBudget();
  const now = Date.now(), perMin = RL.times.filter(t => now - t < 60000).length, ms = refreshMs();
  const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
  $("statusPop").innerHTML = `<h4>${ds.k==="ok" ? (ses.s === "open" ? "✓ Data is live" : alpOn() && !alpSt.err ? "✓ Up to date · showing the last trades" : "✓ Up to date · showing the last close") : ds.k==="stale" ? "⚠ " + esc(ds.why) : "✕ " + esc(ds.why)}</h4>
    ${(()=>{ const mc = marketClock(), today = etNow().date; if (mc.ph === "unknown") return kv("Market", "Calendar expired " + E.CAL_VALID_TO);
      const td = isTradingDay(today) ? today : mc.nextOpenDay, o = etMs(td, 570), c = etMs(td, closeMins(td));
      return kv("Market", esc(mc.ph === "open" ? "Open" : mc.label) + (mstat && mstat.date===d ? " · confirmed by Finnhub's market status" : ""))
        + kv(mc.ph === "open" ? "Closes" : "Opens", `${esc(mc.ph === "open" ? timeStr(mc.until) : whenStr(mc.until))} ${esc(tzAbbr(mc.until))} · in ${fmtLeft(mc.until - now)}`)
        + kv(td === today ? "Hours today" : "Hours " + new Date(o).toLocaleDateString("en-US", {weekday:"short", timeZone:tzName()}), `${timeStr(o)} – ${timeStr(c)} ${esc(tzAbbr(o))}${closeMins(td) < 960 ? " (half day)" : ""}`)
        + kv("Extended", `Pre-market from ${timeStr(etMs(td, 240))}, after hours to ${timeStr(etMs(td, closeMins(td) === 960 ? 1200 : closeMins(td) + 240))}${settings.overnight ? `, overnight ${timeStr(etMs(td, 1260))} – ${timeStr(etMs(td, 240 + 1440))}` : ""}. Timers count to the regular open and close.`)
        + kv("Calendar", "NYSE holidays through " + E.CAL_VALID_TO); })()}
    ${kv("Last update", lastUpdate ? dateTime(lastUpdate) + (health.ms ? ` (took ${(health.ms/1000).toFixed(1)} s)` : "") : "never")}
    ${health.cov && health.cov.total ? kv("Watching", ses.s !== "open" ? `Alerts rest while the market is closed and start again at the open (${health.cov.total} watchlist ticker${health.cov.total > 1 ? "s" : ""})` : `${health.cov.ok} of ${health.cov.total} watchlist tickers can alert` + (health.cov.blind.length ? ` · not: ${esc(health.cov.blind.slice(0,6).join(", "))}` : "")) : ""}
    ${kv("Symbols priced", health.total ? `${health.ok} of ${health.total}` : "—")}
    ${health.fail.length ? kv("Didn't update", esc(health.fail.slice(0,8).join(", "))) : ""}
    ${health.backup.length ? kv("Priced by backup", esc(health.backup.slice(0,8).join(", "))) : ""}
    ${health.bad && health.bad.length ? kv("Held or dropped prints", esc(health.bad.slice(0,6).map(s => s + (health.badWhy[s] ? " (" + health.badWhy[s] + ")" : "")).join(", "))) : ""}
    ${health.xdiff ? kv("Cross-check", `${esc(health.xdiff.sym)} ${fmt$(health.xdiff.fh)} vs Twelve Data ${fmt$(health.xdiff.td)} (${fmtPct(health.xdiff.d,1)}) ${health.xdiff.ok ? "✓" : "⚠"} at ${timeStr(health.xdiff.at)}`) : ""}
    ${kv("Refresh", ms ? everyStr(ms) + (ses.s==="open" && minRefreshSec() > (+settings.refresh||60) ? " (stretched to stay under the free limit)" : "") : "manual")}
    ${kv("Finnhub calls, last minute", `${perMin} of 60` + (E.breakerOpen(fhBreaker, now) ? ` · paused until ${timeStr(fhBreaker.openUntil)} after repeated failures` : ""))}
    ${kv("Fast prices", !settings.alpKey || !settings.alpSec ? "off · add a free Alpaca key in Settings → General" : settings.fast === false ? "off in Settings" : alpSt.err ? `⚠ ${esc(alpSt.err)}${alpSt.pauseUntil > now ? " · trying again at " + timeStr(alpSt.pauseUntil) : ""}` : alpSt.at ? `Alpaca IEX · ${alpSt.got || 0} tickers at ${timeStr(alpSt.at)} (${(alpSt.ms/1000).toFixed(1)} s)` + (ses.s === "open" ? " · every 5 s" : ses.s === "ext" ? " · every 5 s while MW is on screen" : " · every 10 min until pre-market") : "starting…")}
    ${(()=>{ const fs = fundSyms().map(x => navs[x]).filter(n => n && n.nav > 0); if (!fs.length) return "";
      const d = fs.map(n => n.date).sort()[0], behind = d < E.navDueDate(now), at = Math.max(...fs.map(n => n.at || 0));
      return kv("Fund prices", `${fs.length} fund${fs.length > 1 ? "s" : ""}, priced ${esc(navDayLabel(d))}` + (behind ? ` · ${esc(navDayLabel(E.navDueDate(now)))} not posted yet` : "") + (at ? ` · checked ${timeStr(at)}` : "")); })()}
    ${news.at ? kv("News", `${newsItems().length} headline${newsItems().length === 1 ? "" : "s"} · updated ${timeStr(news.at)}` + (news.err ? ` · ⚠ ${esc(news.err)}` : "")) : ""}
    ${settings.tdKey ? kv("Twelve Data today", budgetHtml(L, ses)) : kv("Twelve Data", "no key")}
    ${(()=>{ const M = E.nextMacro(now, 3); return M.expired ? kv("Coming up", "Fed and inflation dates ended " + E.MACRO_VALID_TO) : M.list.length ? kv("Coming up", M.list.map(x => `${esc(x.name)} ${esc(macroWhen(x.t))}`).join("<br>")) : ""; })()}
    ${settings.hcUrl ? kv("Healthchecks", health.hc ? (health.hc.err ? "ping failed: " + esc(health.hc.err) : `pinged ${timeStr(health.hc.at)}${health.hc.fail ? " (reported a problem)" : ""}`) : "pings while the market is open") : ""}
    ${lastErr ? `<div class="err" style="margin:6px 0 0">${esc(lastErr)}</div>` : ""}`;
}
/* one Twelve Data budget for the day, split by feature (R13) */
const BUDGET_NAMES = {hist:"history", vwap:"VWAP", backup:"backup quotes", nav:"fund prices", intraday:"intraday charts", chart:"chart window", xcheck:"cross-checks", other:"other"};
const BUDGET_COLORS = {hist:"#5b9dff", vwap:"#f59e0b", backup:"#f472b6", nav:"#2dd4bf", intraday:"#a78bfa", chart:"#34d399", xcheck:"#94a3b8", other:"#64748b"};
function sessFrac(){ const t = etNow(); if (!isTradingDay(t.date)) return 1; const c = closeMins(t.date); return Math.max(0, Math.min(1, (t.mins - 570) / (c - 570))); }
function budgetHtml(L, ses){
  const proj = ses.s === "open" ? E.budgetProjection(L, sessFrac()) : L.n;
  const segs = Object.keys(E.TD_CAPS).filter(k => L.by[k]).map(k => `<i style="width:${(L.by[k] / E.TD_DAILY * 100).toFixed(1)}%;background:${BUDGET_COLORS[k]}" title="${esc(BUDGET_NAMES[k])}: ${L.by[k]} of its ${E.TD_CAPS[k]}"></i>`).join("");
  return `${L.n} of ${E.TD_DAILY} credits${ses.s === "open" && proj > L.n ? ` · on pace for about ${Math.min(proj, 9999)}` : ""}<div class="budget">${segs}</div><span class="muted" style="font-size:10.5px">${Object.keys(E.TD_CAPS).filter(k => L.by[k]).map(k => `${BUDGET_NAMES[k]} ${L.by[k]}/${E.TD_CAPS[k]}`).join(" · ") || "none used yet"}</span>`;
}
/* "since you last looked": snapshot when the window loses focus, compare when it comes back */
let lookSnap = null;
function snapLook(){
  if (!lastUpdate) return;
  const P = portfolioCalc(), px = {}; [...mySyms(), settings.bench].forEach(s => { if (quotes[s]) px[s] = quotes[s].c; });
  lookSnap = {t:Date.now(), total:P.total, px, alerts:firedToday().log.length, day:etNow().date};
}
function showSince(){
  const el = $("since"); if (!lookSnap || lookSnap.day !== etNow().date || Date.now() - lookSnap.t < 3*60e3) return;
  const P = portfolioCalc(), dUsd = cfg.holdings.length ? P.total - lookSnap.total : null;
  let mover = null; Object.entries(lookSnap.px).forEach(([s0, p0]) => { const q = quotes[s0]; if (q && p0){ const ch = (q.c/p0-1)*100; if (!mover || Math.abs(ch) > Math.abs(mover.ch)) mover = {s:s0, ch, d:q.c - p0, px:q.c}; } });
  const na = firedToday().log.length - lookSnap.alerts;
  if ((dUsd==null || Math.abs(dUsd) < 1) && (!mover || Math.abs(mover.ch) < 0.05) && !na) return;
  el.innerHTML = `<span>Since ${timeStr(lookSnap.t)}:</span>${dUsd!=null?`<b class="${cls(dUsd)}" title="Your total since then">${myS$(dUsd)}</b>`:""}${mover?`<span title="The ticker of yours that moved most since then, for one share">${esc(mover.s)} <b class="${cls(mover.ch)}">${fmtSh$(mover.d, mover.px)} ${fmtPct(mover.ch,1)}</b></span>`:""}${na>0?`<b style="color:var(--down)">${na} new alert${na>1?"s":""}</b>`:""}<span class="x2">✕</span>`;
  el.classList.add("show"); el.dataset.at = Date.now(); el.dataset.day = etNow().date; lookSnap = null;
}
window.addEventListener("blur", snapLook);
window.addEventListener("focus", showSince);
document.addEventListener("visibilitychange", ()=>{ document.hidden ? snapLook() : showSince(); });

/* tray icon (desktop app): tooltip shows the day at a glance; red dot while alerts are unseen */
let trayLast = "";
function updateTray(){
  if (!NATIVE) return;
  const P = portfolioCalc(), parts = ["MW · " + (m => m.ph === "unknown" ? "calendar expired" : m.ph === "open" ? "closes in " + fmtLeft(m.until - Date.now()) : "opens " + (m.until - Date.now() < 24*3600e3 ? "in " + fmtLeft(m.until - Date.now()) : whenStr(m.until)))(marketClock())];
  if (cfg.holdings.length && Object.keys(quotes).length) parts.push(hid() ? `Portfolio ${fmtPct(P.dayPct)}` : `${fmt$(P.total,0)} ${fmtPct(P.dayPct)}`);
  const b = quotes[settings.bench]; if (b) parts.push(`${settings.bench} ${chgTxt(chgOf(b), b.dp, 1, b.c)}`);
  const near = cfg.watch.map(watchInfo).filter(I => I.px && (I.hitL.length || I.dist!=null)).sort((a,b)=>(a.hitL.length?-1e9:a.dist)-(b.hitL.length?-1e9:b.dist))[0];
  if (near) parts.push(near.hitL.length ? `${near.sym} ${levelText(near, true)}` : `${near.sym} ${near.dist.toFixed(1)}% to ${fmtL(near.next)}`);
  const ds = dataState(); if (ds.k !== "ok") parts.push(ds.why);
  if (pausedNow()) parts.push("alerts paused");
  const alert = (firedToday().unseen || 0) > 0, stale = ds.k !== "ok", paused = !!pausedNow(), tip = parts.join(" · "), key = [tip, alert, stale, paused].join("|");
  if (key === trayLast) return; trayLast = key;
  nat.invoke("shell_tray", {tooltip: tip, alert, stale, paused}).catch(()=>{});
}

/* ---------- interactions ---------- */
/* ---------- drag to reorder (pointer events: works in the desktop app, where Windows
   claims the browser's own drag-and-drop for files) ---------- */
let dragSym = null;
function moveWatch(sym, where, toSym, after){
  const W = cfg.watch, i = W.findIndex(w => (w.sym||"").toUpperCase() === sym); if (i < 0) return;
  const [w] = W.splice(i, 1); let j;
  if (where === "top") j = 0; else if (where === "up") j = Math.max(0, i-1); else if (where === "down") j = Math.min(W.length, i+1);
  else { j = W.findIndex(x => (x.sym||"").toUpperCase() === toSym); if (j < 0) j = W.length; else if (after) j++; }
  W.splice(j, 0, w); saveCfg(); safe("watchlist", renderWatch);
}
/* sortDrag: press on a handle, move, release. The row follows the pointer, a blue line shows where it lands,
   and the list scrolls when you reach its top or bottom edge. */
function sortDrag(e, item, sel, onStart, onDrop){
  if (e.button !== 0) return;
  e.preventDefault();
  const scroller = item.closest("main,.sh-b") || document.scrollingElement;
  const y0 = e.clientY, top0 = scroller.scrollTop, id = e.pointerId;
  let started = false, target = null, after = false, raf = 0, lastY = y0;
  const clear = () => document.querySelectorAll(sel + ".drop-a," + sel + ".drop-b").forEach(x => x.classList.remove("drop-a","drop-b"));
  const update = () => {
    item.style.transform = `translateY(${lastY - y0 + scroller.scrollTop - top0}px)`;
    item.style.pointerEvents = "none";
    const under = document.elementFromPoint(e.clientX, lastY); item.style.pointerEvents = "";
    const t = under && under.closest(sel); clear(); target = null;
    if (t && t !== item && t.parentNode === item.parentNode){ const r = t.getBoundingClientRect(); after = lastY > r.top + r.height/2; t.classList.add(after ? "drop-a" : "drop-b"); target = t; }
  };
  const tick = () => {   // auto-scroll near the edges
    raf = 0; if (!started) return;
    const r = scroller.getBoundingClientRect ? scroller.getBoundingClientRect() : {top:0, bottom:innerHeight};
    const edge = 44, dy = lastY < r.top + edge ? -10 : lastY > r.bottom - edge ? 10 : 0;
    if (dy){ scroller.scrollTop += dy; update(); raf = requestAnimationFrame(tick); }
  };
  const move = ev => { if (ev.pointerId !== id) return; lastY = ev.clientY;
    if (!started && Math.abs(lastY - y0) < 4) return;
    if (!started){ started = true; onStart && onStart(); item.classList.add("dragging"); document.body.classList.add("sorting"); scroller.style.scrollBehavior = "auto"; }
    update(); if (!raf) raf = requestAnimationFrame(tick); };
  const up = ev => { if (ev.pointerId !== id) return;
    window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); window.removeEventListener("pointercancel", up, true);
    cancelAnimationFrame(raf); item.style.transform = ""; item.classList.remove("dragging"); document.body.classList.remove("sorting"); scroller.style.scrollBehavior = "";
    const t = target, aft = after; clear();
    if (started) window.__noClickUntil = Date.now() + 350;   // the release isn't also a click that opens the row
    if (started) onDrop(ev.type === "pointercancel" ? null : t, aft); };
  window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", up, true); window.addEventListener("pointercancel", up, true);
}
document.addEventListener("pointerdown", e => {
  const g = e.target.closest("[data-grip]"); if (!g) return;
  const row = g.closest(".wrow"); if (!row) return;
  const from = row.dataset.row.slice(2).toUpperCase();
  sortDrag(e, row, ".wrow", () => { dragSym = from; }, (t, after) => {
    dragSym = null;
    if (t){ const to = t.dataset.row.slice(2).toUpperCase(); if (to !== from){ moveWatch(from, "to", to, after); mwLog("info", "watchlist: moved " + from); return; } }
    safe("watchlist", renderWatch);
  });
});

document.addEventListener("click", e=>{
  if (Date.now() < (window.__noClickUntil || 0)){ e.stopPropagation(); return; }
  if (newsClick(e)) return;
  const wt = e.target.closest("[data-wtab]"); if (wt){ e.stopPropagation(); settings.wdTab = wt.dataset.wtab; saveSettings(); renderWatch(); const f = document.querySelector(`[data-wtab="${wt.dataset.wtab}"]`); if (f) f.focus({preventScroll:true}); return; }
  const wc = e.target.closest("[data-wclose]"); if (wc){ e.stopPropagation(); closeRow("w:" + wc.dataset.wclose); return; }
  const wm = e.target.closest("[data-wmove]"); if (wm){ e.stopPropagation(); const [sym, where] = wm.dataset.wmove.split(":"); moveWatch(sym.toUpperCase(), where); return; }
  if (e.target.closest("[data-grip]")){ e.stopPropagation(); return; }
  const sz = e.target.closest("[data-snzsym]"); if (sz){ e.stopPropagation(); snooze(sz.dataset.snzsym, sz.dataset.how); return; }
  if (e.target.closest("[data-act=resume]")){ togglePause(); return; }
  { const nr = e.target.closest("[data-navref]"); if (nr){ e.stopPropagation(); const sym = nr.dataset.navref, had = (navs[sym] || {}).date; toast("Checking " + sym + "…");
      loadNav(sym, true).then(()=>{ const n = navs[sym] || {}; toast(n.err ? "Couldn't update " + sym + ": " + n.err : !n.nav ? "No price for " + sym + " yet" : n.date === had ? `${sym}: still the ${navDayLabel(n.date)} price (${fmt$(n.nav)}). The next one isn't posted yet.` : `${sym} ${fmt$(n.nav)} for ${navDayLabel(n.date)}`); }); return; } }
  const rm = e.target.closest("[data-wrm]"); if (rm){ e.stopPropagation(); watchRemove(rm.dataset.wrm); return; }
  // 6.0: hide amounts, the risk block's header, the day's-dollars bar, a holding's tabs and its Close, the market details bar
  if (e.target.closest("[data-act=hide]")){ e.stopPropagation(); toggleHide(); return; }
  if (e.target.closest("[data-act=risk]")){ settings.riskHide = !settings.riskHide; saveSettings(); renderPortfolio(); return; }
  { const j = e.target.closest("[data-jump]"); if (j){ rowJump(j.dataset.jump); return; } }
  { const ht = e.target.closest("[data-htab]"); if (ht){ e.stopPropagation(); settings.hdTab = ht.dataset.htab; saveSettings(); renderPortfolio(); const f = document.querySelector(`[data-htab="${ht.dataset.htab}"]`); if (f) f.focus({preventScroll:true}); return; } }
  { const rc = e.target.closest("[data-rclose]"); if (rc){ e.stopPropagation(); closeRow(rc.dataset.rclose); return; } }
  { const wa = e.target.closest("[data-wadd]"); if (wa){ e.stopPropagation(); watchAdd(wa.dataset.wadd); return; } }
  { const go = e.target.closest("[data-wgo]"); if (go){ e.stopPropagation(); palGo(go.dataset.wgo); return; } }
  { const al = e.target.closest("[data-walerts]"); if (al){ e.stopPropagation(); openSheet("alerts"); const i = cfg.watch.findIndex(w => (w.sym||"").toUpperCase() === al.dataset.walerts), r = i < 0 ? null : document.querySelector(`#aList .rule[data-i="${i}"]`); if (r) r.scrollIntoView({block:"start"}); return; } }
  if (e.target.closest("[data-act=mkclose]")){ settings.focus = ""; saveSettings(); renderMarkets(); return; }
  if (e.target.closest("[data-wundo]")){ watchRestore(); return; }
  if (e.target.closest("#wAdd")) return;   // typing in the add box never opens a row
  if (e.target.closest("[data-act=secref]")){ refreshMany(MARKETS.sectors.filter(m => !cfg.hiddenMk.includes(m.sym)).map(m => m.sym), "Sectors"); return; }
  { const c = e.target.closest("[data-chart]"); if (c){ e.stopPropagation(); openChart(c.dataset.chart); return; } }
  { const s = e.target.closest("[data-wsort]"); if (s){ wSort = s.dataset.wsort; renderWatch(); return; } }
  if (e.target.closest("[data-act=erpanel]")){ settings.erHide = !settings.erHide; saveSettings(); renderMarkets(); return; }
  if (e.target.closest("[data-act=sectors]")){ settings.secHide = !settings.secHide; saveSettings(); renderMarkets(); return; }
  // desktop app: open web links in the default browser
  const a = e.target.closest("a[href^='http']");
  if (a && NATIVE){ e.preventDefault(); e.stopPropagation(); (TAURI.opener ? TAURI.opener.openUrl(a.href) : nat.invoke("plugin:opener|open_url", {url:a.href})).catch(()=>{}); return; }
  if (a) return;
  const t = e.target.closest("[data-ref],[data-tile],[data-ord],[data-toggle],[data-grp],[data-row],[data-sort],[data-per],[data-open]");
  if (!t) return;
  if (t.dataset.ref){ e.stopPropagation(); refreshOne(t.dataset.ref); return; }
  if (t.dataset.tile){ settings.focus = settings.focus===t.dataset.tile ? "" : t.dataset.tile; saveSettings(); renderMarkets(); if (settings.focus){ refreshOne(t.dataset.tile, true); const f = document.querySelector(`[data-tile="${CSS.escape(settings.focus)}"]`); if (f) f.focus({preventScroll:true}); const bar = document.querySelector(".mkf"); if (bar) bar.scrollIntoView({block:"nearest", behavior:"smooth"}); } return; }
  if (t.dataset.ord){ settings.heatOrder = t.dataset.ord; saveSettings(); renderMarkets(); return; }
  if (t.dataset.toggle){
    if (settings.compact){ settings.compact = false; Object.keys(settings.collapsed).forEach(k=>settings.collapsed[k]=true); settings.collapsed[t.dataset.toggle] = false; }
    else settings.collapsed[t.dataset.toggle] = !settings.collapsed[t.dataset.toggle];
    saveSettings(); renderAll(); return;
  }
  if (t.dataset.grp != null){ settings.grpCollapsed[t.dataset.grp] = !settings.grpCollapsed[t.dataset.grp]; saveSettings(); t.dataset.grp.startsWith("wg:") ? renderWatch() : renderPortfolio(); return; }
  if (t.dataset.row){ if (e.target.closest(".wdet")) return; const k = t.dataset.row;
    if (openRows.has(k)) openRows.delete(k); else { [...openRows].filter(x => x[0] === k[0] || (k[0] !== "w" && x[0] !== "w")).forEach(x => openRows.delete(x)); openRows.add(k); if (k[0] !== "f") loadNews(k.split(":")[1]); }
    k.startsWith("w:") ? renderWatch() : renderPortfolio();
    if (openRows.has(k)){ const el = document.querySelector(`[data-row="${CSS.escape(k)}"]`); if (el){ el.focus({preventScroll:true}); el.scrollIntoView({block:"nearest", behavior:"smooth"}); } }
    return; }
  if (t.dataset.sort){ settings.sort = t.dataset.sort; saveSettings(); renderPortfolio(); return; }
  if (t.dataset.per){ settings.period = t.dataset.per; saveSettings(); renderMarkets(); return; }
  if (t.dataset.open){ openSheet(t.dataset.open); return; }
});
document.addEventListener("keydown", e=>{
  // Esc in a Settings text box leaves the box (nothing typed is lost); the next Esc closes Settings
  if (e.key==="Escape" && e.target.matches("input,textarea,select") && !$("sheet").classList.contains("hide")){ e.target.blur(); return; }
  // Ctrl+K (Cmd+K on a Mac): jump to a ticker or run a command
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k" && $("sheet").classList.contains("hide")){ e.preventDefault(); palOpen(); return; }
  if (!$("pal").classList.contains("hide")) return;
  // Alt+↑ / Alt+↓ on a watchlist row moves it
  const rowK = (e.target.dataset && e.target.dataset.row) || "";
  if (e.altKey && !e.ctrlKey && !e.metaKey && rowK.startsWith("w:") && (e.key === "ArrowUp" || e.key === "ArrowDown")){ e.preventDefault(); moveWatch(rowK.slice(2), e.key === "ArrowUp" ? "up" : "down"); refocus(rowK); return; }
  if (e.target.matches("input,textarea,select") || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase(), sheetOpen = !$("sheet").classList.contains("hide");
  if (e.key==="Escape" && !$("chart").classList.contains("hide")){ closeChart(); return; }
  if (!$("chart").classList.contains("hide") && !sheetOpen){ const r = {"1":"1D","2":"1M","3":"3M","4":"6M","5":"1Y","6":"5Y"}[e.key]; if (r){ setChartRange(r); return; } }
  if (e.key==="Escape"){
    if (!$("menu").classList.contains("hide")) closeMenu();
    else if (!$("statusPop").classList.contains("hide")) $("statusPop").classList.add("hide");
    else if (sheetOpen) closeSheet();
    else if ($("banner").classList.contains("show")) dismissBanner();
    else if (nwOpen && rowK.startsWith("n:")){ nwOpen = null; renderNews(); refocus(rowK); }
    else if (rowK && openRows.has(rowK)) closeRow(rowK);   // the open row that has the focus goes first
    else if ([...openRows].some(x => x[0] === "w" || x[0] === "h" || x[0] === "f")) closeRow([...openRows].find(x => x[0] === "w") || [...openRows][0]);
    else if (settings.focus && e.target.closest && e.target.closest("#mk-body")){ settings.focus = ""; saveSettings(); renderMarkets(); }
    else if (NATIVE) nat.invoke("shell_hide").catch(()=>{});
    return;
  }
  if (sheetOpen) return;
  // ↑ ↓ Home End move between rows; Delete takes a watchlist row off (Undo shows on the list)
  if (rowK && ["ArrowDown","ArrowUp","Home","End"].includes(e.key)){
    e.preventDefault(); const rows = [...document.querySelectorAll("[data-row]")].filter(r => r.offsetParent !== null), i = rows.indexOf(e.target);
    const to = rows[e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (to){ to.focus(); to.scrollIntoView({block:"nearest"}); } return; }
  if (rowK.startsWith("w:") && (e.key === "Delete" || e.key === "Backspace")){
    e.preventDefault(); const rows = [...document.querySelectorAll('[data-row^="w:"]')].filter(r => r.offsetParent !== null), i = rows.indexOf(e.target), nx = rows[i + 1] || rows[i - 1];
    const sym = rowK.slice(2), nk = nx && nx.dataset.row; watchRemove(sym); toast(sym + " removed · Undo is on the watchlist"); if (nk) refocus(nk); return; }
  if (k==="g" && rowK){ const s = rowK.startsWith("n:") ? ((newsItems().find(x => x.id === rowK.slice(2)) || {syms:[]}).syms[0]) : rowK.split(":")[1]; if (s) openChart(s); return; }
  if (k==="r") schedule(true);
  else if (k==="c") $("bCompact").click();
  else if (k==="a"){ dismissBanner(); toast("Alerts marked as seen"); }
  else if (k==="p") togglePause();
  else if (k==="h") toggleHide();
  else if (k==="t" && NATIVE) $("bPin").click();
  else if (k==="/"){ e.preventDefault(); if (settings.collapsed.watch || settings.compact){ settings.collapsed.watch = false; if (settings.compact){ settings.compact = false; } saveSettings(); renderAll(); } setTimeout(()=>{ const i = $("wAddSym"); if (i){ i.focus(); i.scrollIntoView({block:"nearest"}); } }, 30); }
  else if (k==="n") newsJump("");
  else if (k==="o" && rowK.startsWith("n:")){ const a = e.target.querySelector("[data-nwgo]"); if (a) a.click(); }
  else if (["1","2","3","4","5"].includes(k)){ const sec = layoutOrder()[+k-1]; if (!sec) return; settings.compact = false; settings.collapsed[sec] = false; saveSettings(); renderAll(); document.querySelector(`[data-sec="${sec}"]`).scrollIntoView({behavior:"smooth", block:"start"}); }
  else if (e.key===",") openSheet(settings.sheetTab || "general");
  else if ((e.key==="Enter"||e.key===" ") && e.target.dataset && e.target.dataset.row){ e.preventDefault(); e.target.click(); }
});
$("bCompact").onclick = ()=>{ settings.compact = !settings.compact; saveSettings(); renderAll(); toast(settings.compact ? "Compact view" : "Full view"); };
$("bRefresh").onclick = ()=>{ schedule(true); const s = session().s;
  if (alpOn()){ alpSt.pauseUntil = 0; fastTick(); }
  if (s !== "open") toast(alpOn() ? (s === "ext" ? "Showing the latest pre-market and after-hours trades from Alpaca IEX" : "Showing the last trades, after hours included · pre-market starts at 4 AM ET") : "Showing the last close · add a free Alpaca key in Settings for after-hours prices"); };
$("bAlerts").onclick = ()=>{ markSeen(); settings.collapsed.log = false; settings.compact = false; saveSettings(); renderAll(); $("log-sec").scrollIntoView({behavior:"smooth", block:"start"}); };
$("bSettings").onclick = ()=>{ closeMenu(); openSheet(settings.sheetTab || "general"); };
$("bBrief").onclick = ()=>{ closeMenu(); copyBrief(false); };
$("bHide").onclick = ()=>{ closeMenu(); toggleHide(); };
/* in the beta that MW opened, the menu has a way back too (it's also at the top of Settings → General) */
if (BETA && onBeta()) $("bLeave").hidden = false;
$("bLeave").onclick = ()=>{ closeMenu(); leaveBeta(); };
function closeMenu(){ $("menu").classList.add("hide"); $("bMore").setAttribute("aria-expanded","false"); }
$("bMore").onclick = e=>{ e.stopPropagation(); const m = $("menu"), open = m.classList.contains("hide"); m.classList.toggle("hide", !open); $("bMore").setAttribute("aria-expanded", String(open)); if (open) m.querySelector("button").focus(); };
document.addEventListener("click", e=>{ if (!e.target.closest("#menu,#bMore")) closeMenu(); }, true);
$("menu").addEventListener("click", e=>{ if (e.target.closest("button")) setTimeout(closeMenu, 0); });
function dismissBanner(){ $("banner").classList.remove("show"); markSeen(); }
$("banner").onclick = e=>{ const b = e.target.closest("[data-snz]"); if (b && b.dataset.snz !== "ok" && bannerSyms.length) snooze(bannerSyms, b.dataset.snz); dismissBanner(); };
$("since").onclick = ()=> $("since").classList.remove("show");
$("bPause").onclick = ()=> togglePause();
$("mkt").onclick = e=>{ e.stopPropagation(); const p = $("statusPop"); p.classList.toggle("hide"); if (!p.classList.contains("hide")) renderStatus(); };
document.addEventListener("click", e=>{ if (!e.target.closest("#statusPop,#mkt")) $("statusPop").classList.add("hide"); }, true);

/* ---------- settings sheet ---------- */
let curTab = "general", draft = null, curFund = "";
function openSheet(tab){ draft = JSON.parse(JSON.stringify(cfg)); $("sheet").classList.remove("hide"); showTab(tab || "general"); }
function closeSheet(){ const a = document.activeElement; if (a && $("sheet").contains(a)) a.blur();   // shortcuts work right after closing
  $("sheet").classList.add("hide"); draft = null; document.documentElement.dataset.theme = settings.theme; applyCvd(); }
$("shClose").onclick = closeSheet;
$("tabs").onclick = e=>{ const b = e.target.closest("[data-tab]"); if (b) showTab(b.dataset.tab); };
function showTab(tab){
  curTab = tab; document.documentElement.dataset.theme = settings.theme; applyCvd();   // an unsaved theme preview ends when you leave General
  if (settings.sheetTab !== tab){ settings.sheetTab = tab; saveSettings(); }   // Settings (and ",") reopen the tab you used last
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab===tab));
  const B = $("shBody");
  B.onclick = B.oninput = B.onchange = null;   // each tab sets its own handlers
  if (tab==="general"){
    B.innerHTML = `${!BETA ? "" : labShell() ? "" : `<div class="callout" style="margin-bottom:14px"><b>${onBeta() ? "You're using MW" : "This is MW"}</b>${onBeta() ? "MW opens this beta version until you switch back. The beta started with a copy of your regular setup and keeps its own from there, so the regular one stays as you left it." : "You opened the beta directly. Make it the version MW opens?"}<div style="margin-top:8px"><button class="btn" id="sChannel">${onBeta() ? "Switch back to regular MW" : "Use the beta by default"}</button></div></div>`}
      <div class="field"><label for="sKey">Finnhub API key</label><input id="sKey" type="password" value="${esc(settings.key)}" placeholder="Paste your free key" autocomplete="off" spellcheck="false">
        <p>Free at finnhub.io. A market-data key only, not a brokerage login. Stored on this PC.</p></div>
      <div class="field"><label for="sTd">Twelve Data key (optional)</label><input id="sTd" type="password" value="${esc(settings.tdKey)}" placeholder="Paste a free Twelve Data key" autocomplete="off" spellcheck="false">
        <p>Adds price history (every time frame, risk figures, daily range and VWAP), mutual fund prices (the free plan posts them overnight) and backup prices when Finnhub misses one. Free at twelvedata.com; MW keeps within its free 800 credits a day.</p></div>
      <div class="field"><label for="sAlpK">Alpaca keys (optional): fast prices</label><input id="sAlpK" type="password" value="${esc(settings.alpKey||"")}" placeholder="API key ID" autocomplete="off" spellcheck="false">
        <input id="sAlpS" type="password" value="${esc(settings.alpSec||"")}" placeholder="Secret key" autocomplete="off" spellcheck="false" style="margin-top:6px">
        <label style="display:flex;gap:7px;align-items:center;font-weight:400;margin-top:6px"><input type="checkbox" id="sFast" ${settings.fast!==false?"checked":""}> Fast prices: every 5 seconds while the market is open, plus pre-market and after-hours prices</label>
        <p>Free with an Alpaca paper-trading account (alpaca.markets → sign up → Paper account → API keys). Paper keys can't touch real money; MW only reads prices with them. They stay on this PC and go only to Alpaca. The free feed is one exchange (IEX), so pre-market and after-hours prices are a close guide, and Finnhub still supplies yesterday's close and the day's high and low.</p></div>
      <div class="row2">
        <div class="field"><label for="sTheme">Theme</label><select id="sTheme"><option value="auto">Match Windows</option><option value="dark">Dark</option><option value="light">Light</option></select></div>
        <div class="field"><label for="sRefresh">Refresh while open</label><select id="sRefresh"><option value="30">Every 30 sec</option><option value="60">Every minute</option><option value="120">Every 2 min</option><option value="300">Every 5 min</option><option value="0">Off (manual only)</option></select></div>
      </div>
      <div class="field" style="margin-top:-6px"><label style="display:flex;gap:7px;align-items:center;font-weight:400"><input type="checkbox" id="sCvd" ${settings.cvd?"checked":""}> Color-blind friendly colors: up is blue, down is orange</label></div>
      <div class="field"><label for="sTz">Time zone</label><select id="sTz">${TZ_CHOICES.map(([v, n]) => `<option value="${v}">${esc(n)}${v === "auto" ? (z => { const known = TZ_CHOICES.find(c => c[0] === z), nm = known ? known[1].replace(/ \(.*\)/, "") : z.replace(/_/g, " ").split("/").pop(), ab = tzAbbr(Date.now(), z); return " (" + esc(nm) + (ab && ab !== nm ? " · " + esc(ab) : "") + ")"; })(sysTz()) : ""}</option>`).join("")}</select>
        <p>Every time MW shows (updates, alerts, open and close) uses this zone. Market hours themselves follow New York.</p></div>
      <div class="row2">
        <div class="field"><label for="sSound">Alert sound</label><select id="sSound"><option value="on">On</option><option value="off">Off</option></select></div>
        <div class="field"><label>Windows pop-ups</label>${NATIVE ? `<button class="btn" style="width:100%;cursor:default" title="Use 'Send a test alert' below to check. If nothing shows, turn on notifications for Market Widget in Windows Settings → System → Notifications.">Windows notifications</button>` : `<button class="btn" id="sNotif" style="width:100%">${"Notification" in window ? (Notification.permission==="granted"?"✓ Allowed":Notification.permission==="denied"?"Blocked by the browser":"Allow pop-ups") : "Not supported"}</button>`}</div>
      </div>
      ${NATIVE ? `<div class="field"><label>Desktop app</label><div class="rule" id="appOpts" style="margin:0">
        <div class="opts" style="margin:0">
          <span>Start with Windows</span><label class="sw"><input type="checkbox" data-shell="autostart"><span></span></label>
          <span>Start hidden in the tray</span><label class="sw"><input type="checkbox" data-shell="start_hidden"><span></span></label>
          <span>Keep on top of other windows (T)</span><label class="sw"><input type="checkbox" data-shell="on_top"><span></span></label>
          <span>Show / hide from anywhere: ${hotkeyName()}</span><label class="sw"><input type="checkbox" data-shell="hotkey"><span></span></label>
          <span>Opening animation when MW starts</span><label class="sw"><input type="checkbox" id="sSplash" ${settings.splash!==false?"checked":""}><span></span></label>
        </div></div><p>Closing the window (X or Esc) keeps MW running in the tray so alerts still pop up. Quit from the tray icon's menu. <span id="appVer"></span></p></div>` : ""}
      <div class="field"><label for="sNtfy">Phone alerts (optional)</label><input id="sNtfy" type="text" value="${esc(settings.ntfy)}" placeholder="ntfy topic, e.g. mk-dips-8x2q (hard to guess)">
        <p>Install the free ntfy app and subscribe to the same name to get alerts on your phone. ntfy.sh topics are public: anyone who guesses the name can read them, so by default the phone only gets "MW has a new alert", never tickers, prices or levels.</p>
        <label style="display:flex;gap:7px;align-items:center;font-weight:400;margin-top:4px"><input type="checkbox" id="sNtfyFull" ${settings.ntfyFull?"checked":""}> Send the full alert text to my phone (tickers and prices)</label></div>
      <div class="field"><label for="sHc">Outside check (optional): Healthchecks.io ping URL</label><input id="sHc" type="text" value="${esc(settings.hcUrl||"")}" placeholder="https://hc-ping.com/your-check-id" spellcheck="false">
        <p>So you hear about it when MW can't watch, even if this PC is off. Free at healthchecks.io: add a check with the schedule <code>*/10 10-15 * * 1-5</code>, time zone America/New_York, grace time 20 minutes, then paste its ping URL here. While the market is open MW pings it about every 5 minutes; if the pings stop (or MW reports it can't see prices), Healthchecks emails you. Expect one email on market holidays and 1 pm early closes.</p></div>
      <div class="field"><label style="display:flex;gap:7px;align-items:center;font-weight:400"><input type="checkbox" id="sOvernight" ${settings.overnight?"checked":""}> Show Nasdaq's overnight session in the clock (from Dec 6, 2026; subject to SEC approval)</label>
        <p>Clock text only: the free price feeds carry no overnight prices, and alerts only run in regular hours.</p></div>
      ${BETA ? "" : `<div class="field"><label>Beta version</label><p>${window.__mwBetaFailed ? `<b style="color:var(--warn)">${BETA_NAME} didn't start last time, so MW opened this regular version.</b> ` : ""}${BETA_NAME} gets new features first. Each time you join, it starts with a copy of your setup and keeps its own from there, so this version stays exactly as it is. Switch back any time in the beta under Settings → General.</p><button class="btn" id="sBeta">${window.__mwBetaFailed ? "Try the beta again" : "Try the beta"}</button></div>`}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="sSave">Save</button><button class="btn" id="sTest">Send a test alert</button><button class="btn" id="sKeys">Test my keys</button></div>
      <div id="keyRes" class="note" style="white-space:pre-line"></div>
      <p class="note">Data use: Finnhub allows 60 calls a minute with no daily cap. Twelve Data allows 800 credits a day, shared out between history, VWAP, backups, fund prices and checks so no one feature can use it all; ${tdBudget().n} used today. Alpaca allows 200 calls a minute; fast prices use 12. Click the status pill for the breakdown.</p>
      ${liveSetup() ? `<div class="callout" style="margin-top:12px"><b>Copy your setup from MW</b>MW keeps its own settings. This copies your holdings, watchlist, keys and preferences from the MW in this browser. MW itself is not changed.<div style="margin-top:8px"><button class="btn" id="sImport">Copy from MW</button></div></div>` : ""}
      <p class="note" style="margin-top:14px">Shortcuts: Ctrl+K find a ticker or command · G chart the focused row · R refresh · C compact · A mark alerts seen · P pause alerts · H hide or show amounts · / add a ticker · N news · O open the focused headline · 1–5 jump to a section · ↑ ↓ move between rows · Alt+↑ ↓ reorder the watchlist · Delete take a ticker off the watchlist · , settings · Esc close${NATIVE?" or hide to tray · T keep on top":""}. ${esc(verLine())}.</p>`;
    if ($("sChannel")) $("sChannel").onclick = ()=> onBeta() ? leaveBeta() : joinBetaHere();
    if ($("sBeta")) $("sBeta").onclick = ()=>{
      try{ localStorage.setItem("mw_channel", "beta"); localStorage.removeItem("mw_betaTry"); localStorage.removeItem("mw_betaOk"); }catch(e){ toast("This browser blocks storage, so the beta can't be turned on"); return; }
      mwLog("info", "switching to " + BETA_NAME); location.replace("lab/");
    };
    if ($("sImport")) $("sImport").onclick = ()=>{ if (importFromLive()){ closeSheet(); renderAll(); schedule(true); } };
    $("sTheme").value = settings.theme; $("sTheme").onchange = e => { document.documentElement.dataset.theme = e.target.value; };
    $("sCvd").onchange = e => { document.documentElement.dataset.cvd = e.target.checked ? "1" : ""; }; $("sTz").value = TZ_CHOICES.some(c => c[0] === settings.tz) ? settings.tz : "auto"; $("sRefresh").value = String(settings.refresh); $("sSound").value = settings.sound;
    if (NATIVE){
      const box = $("appOpts");
      nat.invoke("shell_state").then(st => { nat.state = st; box.querySelectorAll("[data-shell]").forEach(i => i.checked = !!st[i.dataset.shell]); $("appVer").textContent = "App version " + st.version + "." + (st.hotkey && !st.hotkey_ok ? " " + hotkeyName() + " is taken by another app, so the hotkey is off." : ""); }).catch(()=>{});
      box.onchange = e => { if (e.target.id === "sSplash"){ settings.splash = e.target.checked; saveSettings(); toast(e.target.checked ? "Opening animation on" : "Opening animation off"); return; }
        const k = e.target.dataset.shell; if (!k) return; nat.invoke("shell_set", {key:k, value:e.target.checked}).then(syncNative).catch(err => { toast(String(err)); e.target.checked = !e.target.checked; }); };
    }
    if ($("sNotif")) $("sNotif").onclick = async ()=>{ try{ const r = await Notification.requestPermission(); toast(r==="granted"?"Pop-ups allowed":"Pop-ups not allowed"); showTab("general"); }catch(e){} };
    $("sSave").onclick = ()=>{
      const tdChanged = $("sTd").value.trim() !== settings.tdKey;
      const hc = $("sHc").value.trim();
      const ak = $("sAlpK").value.trim(), as = $("sAlpS").value.trim();
      if (!!ak !== !!as){ $("keyRes").textContent = "Alpaca needs both the API key ID and the secret key. Not saved."; return; }
      if (hc && !/^https:\/\/hc-ping\.com\/[A-Za-z0-9_\-\/]+$/.test(hc)){ $("keyRes").textContent = "The Healthchecks URL should look like https://hc-ping.com/… (copy it from your check's page). Not saved."; return; }
      Object.assign(settings, {key:$("sKey").value.trim(), tdKey:$("sTd").value.trim(), theme:$("sTheme").value, refresh:+$("sRefresh").value, sound:$("sSound").value, tz:$("sTz").value, ntfy:$("sNtfy").value.trim(), ntfyFull:$("sNtfyFull").checked, hcUrl:hc, overnight:$("sOvernight").checked, alpKey:ak, alpSec:as, fast:$("sFast").checked, cvd:$("sCvd").checked});
      applyCvd(); Object.assign(alpSt, {pauseUntil:0, fail:0, err:""}); fastSchedule(); if (alpOn()) setTimeout(fastTick, 1500);
      saveSettings(); document.documentElement.dataset.theme = settings.theme; toast("Saved"); safe("redraw", renderAll);
      try{ if ("Notification" in window && Notification.permission==="default") Notification.requestPermission(); }catch(e){}
      closeSheet(); schedule(true); if (tdChanged){ hist = {}; loadHist.day = null; loadNavs(true); loadHist(marketSyms()); }
    };
    $("sKeys").onclick = async ()=>{
      const out = $("keyRes"); out.textContent = "Testing…"; const lines = [];
      const fk = $("sKey").value.trim(), tk = $("sTd").value.trim();
      try{ const r = await fetchT(API + "quote?symbol=SPY&token=" + encodeURIComponent(fk)); const j = await r.json(); lines.push(r.ok && j.c ? `Finnhub: working (SPY ${fmt$(j.c)})` : `Finnhub: problem (${r.status} ${j.error||""})`); }catch(e){ lines.push("Finnhub: couldn't connect (" + e.message + ")"); }
      if (tk){
        const fund = fundSyms()[0] || "VFIAX";
        for (const sym of ["SPY", fund]){
          try{ const r = await fetchT("https://api.twelvedata.com/quote?symbol=" + encodeURIComponent(sym) + "&apikey=" + encodeURIComponent(tk)); const j = await r.json();
            lines.push(j.close ? `Twelve Data ${sym}: working (${fmt$(+j.close)} on ${j.datetime})` + (isFund(sym) && String(j.datetime || "").slice(0, 10) < E.navDueDate(Date.now()) ? `. The ${navDayLabel(E.navDueDate(Date.now()))} fund price isn't posted yet; the free plan posts it overnight.` : "") : `Twelve Data ${sym}: ${j.message || "no price"}`); }
          catch(e){ lines.push(`Twelve Data ${sym}: couldn't connect (${e.message})`); }
        }
      } else lines.push("Twelve Data: no key entered");
      const ak = $("sAlpK").value.trim(), as = $("sAlpS").value.trim();
      if (ak && as){ try{ const j = await alpSnap(["SPY"], ak, as), tr = j && j.SPY && j.SPY.latestTrade; lines.push(tr ? `Alpaca: working (SPY ${fmt$(tr.p)} on IEX at ${dateTime(Date.parse(tr.t))})` : "Alpaca: the keys work, but no SPY price came back"); }catch(e){ lines.push("Alpaca: " + e.message); } }
      else lines.push(ak || as ? "Alpaca: needs both the API key ID and the secret key" : "Alpaca: no keys entered (fast prices are off)");
      out.textContent = lines.join("\n");
    };
    $("sTest").onclick = ()=>{ settings.ntfy = $("sNtfy").value.trim(); settings.ntfyFull = $("sNtfyFull").checked; notify([{kind:"test", msg:"Test alert: this is what a dip alert looks like"}]);
      const hc = $("sHc").value.trim(); if (/^https:\/\/hc-ping\.com\//.test(hc)) fetchT(hc, {mode:"no-cors", cache:"no-store", referrerPolicy:"no-referrer"}, 10000).then(()=>toast("Test ping sent to Healthchecks")).catch(e => toast("Healthchecks ping failed: " + e.message)); };
  }
  else if (tab==="holdings"){
    const accts = [...new Set(["Roth","Taxable", ...draft.holdings.map(h=>h.acct).filter(Boolean)])];
    B.innerHTML = `
      <div class="field"><label>Live holdings (ETFs and stocks)</label><p>Shares and average cost per share. Cost is optional; it powers the gain figures.</p></div>
      <table class="ed"><thead><tr><th style="width:24%">Ticker</th><th style="width:20%">Shares</th><th style="width:22%">Avg cost</th><th>Account</th><th></th></tr></thead>
      <tbody id="hBody">${draft.holdings.map((h,i)=>`<tr data-i="${i}"><td><input data-f="sym" value="${esc(h.sym)}" style="text-transform:uppercase"></td><td><input data-f="shares" type="number" step="any" min="0" value="${h.shares??""}"></td><td><input data-f="avg" type="number" step="any" min="0" value="${h.avg??""}" placeholder="—"></td>
        <td>${h._newAcct ? `<input data-f="acct" value="${esc(h.acct||"")}" placeholder="Account name" autofocus>` : `<select data-f="acct">${[...new Set([...accts, h.acct||"Taxable"])].map(a=>`<option ${a===(h.acct||"Taxable")?"selected":""}>${esc(a)}</option>`).join("")}<option value="__new">+ New account…</option></select>`}</td><td><button class="x" data-del="${i}" title="Remove">✕</button></td></tr>`).join("")}</tbody></table>
      <button class="btn" id="hAdd" style="margin:8px 0 18px">+ Add holding</button>
      <div class="field"><label>Mutual funds &amp; cash</label><p>For a mutual fund, enter its ticker and shares. A fund has one price a day, set after the 4 PM ET close; with a Twelve Data key (General tab) MW picks it up as soon as the free feed posts it, usually overnight, and says which day each price is from. For cash, leave the ticker blank and type the value. A cash row at $0 is hidden on the main screen and comes back on its own once it's above $0.</p>
        <label style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:var(--fg-2);cursor:pointer"><input type="checkbox" id="fZero" ${settings.showZeroCash?"checked":""}> Show cash rows at $0 anyway</label>
        <label style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:var(--fg-2);cursor:pointer" title="Each fund is matched to the index ETF it has moved with over the last 6 months. Until the fund's official price is posted, MW shows that ETF's move, scaled, in a dashed box marked as an estimate. It is never added to your total."><input type="checkbox" id="fEst" ${settings.fundEst !== false?"checked":""}> Estimate mutual funds between official prices (dashed boxes, never in the total)</label></div>
      <table class="ed"><thead><tr><th>Name</th><th style="width:19%">Ticker</th><th style="width:18%">Shares</th><th style="width:21%">Value ($)</th><th></th></tr></thead>
      <tbody id="fBody">${draft.fixed.map((f,i)=>`<tr data-i="${i}"><td><input data-g="name" value="${esc(f.name)}"></td><td><input data-g="sym" value="${esc(f.sym||"")}" style="text-transform:uppercase" placeholder="—"></td><td><input data-g="shares" type="number" step="any" min="0" value="${f.shares??""}" placeholder="—"></td><td><input data-g="value" type="number" step="any" value="${f.value??""}"></td><td><button class="x" data-fdel="${i}" title="Remove">✕</button></td></tr>`).join("")}</tbody></table>
      <button class="btn" id="fAdd" style="margin:8px 0 14px">+ Add fund or cash</button>
      <div class="err" id="hErr"></div>
      <div class="sh-f" style="padding:10px 0 0;border:0"><button class="btn" id="hCancel">Cancel</button><button class="btn primary" id="hSave">Save holdings</button></div>`;
    B.onchange = e=>{
      if (e.target.id === "fZero"){ settings.showZeroCash = e.target.checked; saveSettings(); renderAll(); toast(e.target.checked ? "Cash rows at $0 shown" : "Cash rows at $0 hidden"); return; }
      if (e.target.id === "fEst"){ settings.fundEst = e.target.checked; saveSettings(); if (e.target.checked){ loadNavs(false); safe("fund fit", fitFunds); } renderAll(); toast(e.target.checked ? "Fund estimates on" : "Fund estimates off"); return; }
      if (!draft) return;
      if (e.target.tagName === "SELECT" && e.target.dataset.f === "acct"){ const i = +e.target.closest("tr").dataset.i;
        if (e.target.value === "__new"){ draft.holdings[i]._newAcct = true; draft.holdings[i].acct = ""; showTab("holdings"); }
        else draft.holdings[i].acct = e.target.value; }
    };
    B.oninput = e=>{
      if (!draft) return;
      const tr = e.target.closest("tr"); if (!tr || tr.dataset.i == null) return; const i = +tr.dataset.i;
      if (e.target.tagName === "SELECT") return;
      if (e.target.dataset.f){ const k = e.target.dataset.f; let v = e.target.value; if (k==="sym") v = v.toUpperCase().trim(); if (k==="shares"||k==="avg") v = v==="" ? null : +v; draft.holdings[i][k] = v; }
      if (e.target.dataset.g){ const k = e.target.dataset.g, v = e.target.value; draft.fixed[i][k] = k==="value" ? +v : k==="shares" ? (v===""?null:+v) : k==="sym" ? v.toUpperCase().trim() : v; }
    };
    B.onclick = e=>{
      if (!draft) return;
      // a new row is ready to type into
      if (e.target.id==="hAdd"){ draft.holdings.push({sym:"", shares:null, avg:null, acct:"Taxable"}); showTab("holdings"); const i = document.querySelector("#hBody tr:last-child [data-f=sym]"); if (i) i.focus(); }
      else if (e.target.id==="fAdd"){ draft.fixed.push({name:"", sym:"", shares:null, value:0}); showTab("holdings"); const i = document.querySelector("#fBody tr:last-child [data-g=name]"); if (i) i.focus(); }
      else if (e.target.dataset.del){ draft.holdings.splice(+e.target.dataset.del,1); showTab("holdings"); }
      else if (e.target.dataset.fdel){ draft.fixed.splice(+e.target.dataset.fdel,1); showTab("holdings"); }
      else if (e.target.id==="hCancel") closeSheet();
      else if (e.target.id==="hSave"){
        const probs = [];
        draft.holdings.forEach(h => { if (h.sym && !(+h.shares > 0)) probs.push(`${h.sym}: enter how many shares`); });
        draft.fixed.forEach(f => { if (!(f.name || f.sym)) return;
          if (f.sym && !(+f.shares > 0) && !(+f.value > 0)) probs.push(`${f.sym}: enter the shares (or a dollar value)`);
          if (!f.sym && !isFinite(+f.value)) probs.push(`${f.name}: the value should be a number`); });
        if (probs.length){ $("hErr").textContent = "Not saved yet. " + probs.join(" · "); return; }
        mwLog("info", "holdings saved (" + draft.holdings.length + " holdings, " + draft.fixed.length + " funds/cash)");
        cfg.holdings = draft.holdings.filter(h=>h.sym && +h.shares>0).map(h=>({sym:h.sym.toUpperCase(), shares:+h.shares, ...(h.avg?{avg:+h.avg}:{}), acct:h.acct||"Other"}));
        cfg.fixed = draft.fixed.filter(f=>(f.name||f.sym) && isFinite(+f.value||0)).map(f=>({name:f.name||f.sym, value:+f.value||0, ...(f.sym?{sym:f.sym.toUpperCase()}:{}), ...(+f.shares>0?{shares:+f.shares}:{})}));
        saveCfg("holdings"); toast("Holdings saved"); closeSheet(); schedule(true);
      }
    };
  }
  else if (tab==="alerts"){
    B.innerHTML = `
      <div class="rule" style="display:flex;align-items:center;gap:10px"><label class="sw"><input type="checkbox" id="aAll" ${settings.allOff?"":"checked"}><span></span></label><div><b>All alerts</b><div class="muted" style="font-size:11px">Master switch. Changes save as you click.</div></div></div>
      ${cfg.watch.some(w => !w.hiDrop || !w.sigDrop || !w.fastDrop) ? `<div class="rule" style="display:flex;align-items:center;gap:10px"><div style="flex:1"><b>Intraday dip rules</b><div class="muted" style="font-size:11px">"Fast drop" (2% in 15 min), "Off today's high" (4%) and "Unusual drop" (2σ) catch flushes that a −3% day rule misses.</div></div><button class="btn" id="aNewRules">Turn on for all</button></div>` : ""}
      <div id="aList">${cfg.watch.map((w,i)=>{
        const on = w.on!==false, ck = k => w[k]!==false ? "checked" : "", ck2 = (k, v) => (w[k]===true || (w[k]!==false && w[v])) ? "checked" : "";
        return `<div class="rule" data-i="${i}">
          <div class="rule-h"><label class="sw"><input type="checkbox" data-k="on" ${on?"checked":""}><span></span></label>${esc(w.sym)}
            <input data-note="1" value="${esc(w.note||"")}" placeholder="note" style="flex:1;min-width:0;font-size:11px;padding:3px 6px;font-weight:400"><input data-g="1" value="${esc(w.grp||"")}" placeholder="section" maxlength="24" list="grpNames" title="Put tickers with the same section name together on the watchlist, e.g. Chips or Power" style="width:78px;font-size:11px;padding:3px 6px;font-weight:400">
            <button class="x" data-wmv="${i}:up" title="Move up the watchlist" ${i===0?"disabled":""}>↑</button><button class="x" data-wmv="${i}:down" title="Move down the watchlist" ${i===cfg.watch.length-1?"disabled":""}>↓</button><button class="x" data-wdel="${i}" title="Remove">✕</button></div>
          <div class="opts ${on?"":"dis"}">
            <label><input type="checkbox" data-k="redOn" ${ck("redOn")}> Red day: down at least</label><span><input type="number" step="0.5" min="0.5" data-n="dayDrop" value="${w.dayDrop??3}"> %</span>
            <label><input type="checkbox" data-k="offOn" ${ck("offOn")}> Falls below 52-week high by</label><span><input type="number" step="1" min="1" data-n="offHigh" value="${w.offHigh??10}"> %</span>
            <label title="A fast drop from today's high, even if the day is only slightly red"><input type="checkbox" data-k="hiOn" ${ck2("hiOn","hiDrop")}> Off today's high by</label><span><input type="number" step="0.5" min="0.5" data-n="hiDrop" value="${w.hiDrop??4}"> %</span>
            <label title="Scaled to how much this stock normally moves in a day (needs a Twelve Data key)"><input type="checkbox" data-k="sigOn" ${ck2("sigOn","sigDrop")}> Unusual drop: at least</label><span><input type="number" step="0.5" min="0.5" data-n="sigDrop" value="${w.sigDrop??2}"> σ</span>
            <label title="Price fell this much from its highest point in the last N minutes (a flush), even if the day is barely red"><input type="checkbox" data-k="fastOn" ${ck2("fastOn","fastDrop")}> Fast drop: down</label><span><input type="number" step="0.5" min="0.5" data-n="fastDrop" value="${w.fastDrop??2}"> % in <input type="number" step="5" min="5" max="120" data-n="fastMins" value="${w.fastMins??15}" style="width:48px"> min</span>
            <label title="The dip rules above only fire when this stock is falling harder than your benchmark, so a sector-wide dip doesn't trigger them. Price alerts always fire."><input type="checkbox" data-k="lagOn" ${w.lagOn?"checked":""}> Dip rules only if lagging ${esc(settings.bench)} by</label><span><input type="number" step="0.5" min="0.5" data-n="lagBy" value="${w.lagBy??2}"> %</span>
            <label title="Alert when the price falls to any of these. Prices, or 20d / 50d / 100d / 200d for moving averages."><input type="checkbox" data-k="levelsOn" ${ck("levelsOn")}> Price alerts at</label><span><input type="text" data-l="1" value="${esc([...(w.levels||[]), ...(w.ma||[]).map(n=>n+"d")].join(", "))}" placeholder="e.g. 150, 140, 200d"></span>
            <label title="Once a day: each price alert can fire once per day. Once: it fires one time, then MW takes it off the list. Every cross: it fires each time the price comes back down through it, at least 30 minutes apart and only after a 0.3% climb back above.">Price alerts repeat</label><span><select data-s="lvRepeat"><option value="" ${!w.lvRepeat?"selected":""}>once a day</option><option value="once" ${w.lvRepeat==="once"?"selected":""}>once, then remove</option><option value="cross" ${w.lvRepeat==="cross"?"selected":""}>every cross</option></select></span>
            <label title="Price alerts for this ticker stop after this day. Leave empty to keep them on.">Price alerts end after</label><span><input type="date" data-s="lvUntil" value="${esc(w.lvUntil||"")}" style="width:auto"></span>
            <label title="Off unless you turn it on. Alerts when the price has dropped well under today's VWAP and then climbs back over it. Uses about 40 Twelve Data credits a day per ticker (first 8 tickers), from VWAP's share of the day's budget."><input type="checkbox" data-k="vwapOn" ${w.vwapOn===true?"checked":""}> VWAP reclaim after a flush</label><span class="muted" style="font-size:11px">${settings.tdKey ? "Alert + VWAP on the row" : "Needs a Twelve Data key"}</span>
            <label title="A quiet note when the price gets this close to your next price alert"><input type="checkbox" data-k="nearOn" ${ck("nearOn")}> Heads-up within</label><span><input type="number" step="0.5" min="0" data-n="near" value="${w.near??1.5}"> % of a price alert</span>
          </div></div>`; }).join("")}</div>
      <datalist id="grpNames">${[...new Set(cfg.watch.map(w => w.grp).filter(Boolean))].map(g => `<option value="${esc(g)}">`).join("")}</datalist>
      <div style="display:flex;gap:6px;margin-top:4px"><input id="aSym" placeholder="Add a ticker, e.g. NVDA" maxlength="10" style="flex:1;text-transform:uppercase"><button class="btn primary" id="aAdd">Add</button></div>
      <div class="field" style="margin-top:16px"><label for="aBulk">Paste a list of tickers</label><textarea id="aBulk" rows="2" placeholder="e.g. NVDA, AMD TSM or NASDAQ:MU" spellcheck="false" style="width:100%;resize:vertical"></textarea>
        <p id="aBulkRes">${BULK_HINT}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="aBulkAdd" disabled>Add these</button><button class="btn" id="aCopy">Copy my watchlist</button></div></div>`;
    if ($("aNewRules")) $("aNewRules").onclick = ()=>{ cfg.watch.forEach(w => { if (!w.hiDrop){ w.hiDrop = 4; w.hiOn = true; } if (!w.sigDrop){ w.sigDrop = 2; w.sigOn = true; } if (!w.fastDrop){ w.fastDrop = 2; w.fastMins = 15; w.fastOn = true; } }); saveCfg(); renderAll(); showTab("alerts"); toast("Dip rules on for every ticker"); };
    $("aAll").onchange = e=>{ settings.allOff = !e.target.checked; saveSettings(); renderAll(); };
    const save = ()=>{ saveCfg(); renderAll(); };
    $("aList").onchange = e=>{
      const r = e.target.closest(".rule"); if (!r) return; const w = cfg.watch[+r.dataset.i], t = e.target;
      if (t.dataset.k){ w[t.dataset.k] = t.checked; if (t.dataset.k==="on") r.querySelector(".opts").classList.toggle("dis", !t.checked);
        const nf = {hiOn:"hiDrop", sigOn:"sigDrop", fastOn:"fastDrop", lagOn:"lagBy"}[t.dataset.k]; if (nf && t.checked && !w[nf]) w[nf] = +r.querySelector(`[data-n=${nf}]`).value || 2;
        if (t.dataset.k==="fastOn" && t.checked && !w.fastMins) w.fastMins = +r.querySelector(`[data-n=fastMins]`).value || 15; }
      if (t.dataset.n){ const v = parseFloat(t.value); if (isFinite(v) && v>=0) w[t.dataset.n] = v; }
      if (t.dataset.l){ const toks = t.value.split(/[ ,;$]+/).filter(Boolean);
        w.levels = toks.map(Number).filter(x=>x>0).sort((a,b)=>b-a);
        w.ma = [...new Set(toks.map(x=>(x.match(/^(20|50|100|200)d$/i)||[])[1]).filter(Boolean).map(Number))]; }
      if (t.dataset.note) w.note = t.value;
      if (t.dataset.g){ const g = t.value.trim().slice(0, 24); if (g) w.grp = g; else delete w.grp; }
      if (t.dataset.s){ if (t.value) w[t.dataset.s] = t.value; else delete w[t.dataset.s]; }
      save();
    };
    $("aList").onclick = e=>{
      const mv = e.target.closest("[data-wmv]"); if (mv){ const [i, dir] = mv.dataset.wmv.split(":"); const j = +i + (dir==="up" ? -1 : 1); if (j < 0 || j >= cfg.watch.length) return; const [w] = cfg.watch.splice(+i, 1); cfg.watch.splice(j, 0, w); save(); showTab("alerts"); return; }
      const d = e.target.closest("[data-wdel]"); if (!d) return; watchRemove(cfg.watch[+d.dataset.wdel].sym); showTab("alerts"); };
    // says what happened (added, or already there) and keeps the box ready for the next ticker
    const add = ()=>{ const r = watchAdd($("aSym").value); if (!r) return; if (r === "dup"){ $("aSym").select(); return; }
      showTab("alerts"); const box = $("aSym"); if (box){ box.focus(); box.scrollIntoView({block:"nearest"}); } };
    $("aAdd").onclick = add; $("aSym").onkeydown = e=>{ if (e.key==="Enter") add(); };
    const bulk = ()=>{ const P = E.parseTickers($("aBulk").value), have = new Set(cfg.watch.map(w => (w.sym||"").toUpperCase()));
      return {nw:P.ok.filter(s => !have.has(s)), dup:P.ok.filter(s => have.has(s)), bad:P.bad}; };
    $("aBulk").oninput = ()=>{ const r = bulk(), b = $("aBulkAdd");
      $("aBulkRes").innerHTML = !$("aBulk").value.trim() ? BULK_HINT : [r.nw.length ? `<b>Adds ${r.nw.length}:</b> ${esc(r.nw.join(", "))}` : "Nothing new to add", r.dup.length ? `already on it: ${esc(r.dup.join(", "))}` : "", r.bad.length ? `<span style="color:var(--warn)">skipped, not a ticker: ${esc(r.bad.slice(0,8).join(", "))}</span>` : ""].filter(Boolean).join(" · ");
      b.disabled = !r.nw.length; b.textContent = r.nw.length ? `Add ${r.nw.length}` : "Add these"; };
    $("aBulkAdd").onclick = ()=>{ const r = bulk(); if (!r.nw.length) return; watchAddMany(r.nw); showTab("alerts"); toast(r.nw.length === 1 ? r.nw[0] + " added to your watchlist" : r.nw.length + " tickers added to your watchlist"); };
    $("aCopy").onclick = ()=>{ const t = cfg.watch.map(w => w.sym).filter(Boolean).join(", "); if (!t){ toast("Your watchlist is empty"); return; } copyText(t, "Copied " + cfg.watch.length + " ticker" + (cfg.watch.length > 1 ? "s" : "")); };
  }
  else if (tab==="funds"){
    const own = [...new Set(cfg.holdings.map(h => (h.sym||"").toUpperCase()).filter(Boolean))];
    const etf = cfg.etf || (cfg.etf = {});
    const pickF = curFund && own.includes(curFund) ? curFund : own.find(s => etf[s]) || own[0];
    B.innerHTML = `<div class="field"><label>Fund overlap: what's inside your ETFs</label><p>A fund like a chip ETF can hold the same companies you also own directly, so your real exposure to them is bigger than it looks. Paste a fund's holdings (from the fund's own website, "Holdings", copy or download the list) and MW adds it all up. Only ticker and weight are read; it stays on this PC.</p></div>
      ${own.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${own.map(s => `<button class="btn ${s===pickF?"primary":""}" data-fund="${esc(s)}">${esc(s)}${etf[s] && etf[s].list && etf[s].list.length ? " ✓" : ""}</button>`).join("")}</div>` : `<div class="note">Add holdings first.</div>`}
      ${pickF ? `<div class="field"><label for="fPaste">Holdings of ${esc(pickF)} (ticker and weight %, one per line)</label><textarea class="code" id="fPaste" spellcheck="false" style="height:130px" placeholder="AAA, 20.5%&#10;BBB, 10.2%&#10;…">${esc(etf[pickF] && etf[pickF].list ? etf[pickF].list.map(x => x.sym + ", " + x.w + "%").join("\n") : "")}</textarea>
        <div id="fPrev" class="note"></div>
        <div style="display:flex;gap:8px;margin-top:6px"><button class="btn primary" id="fSave">Save</button>${etf[pickF] ? `<button class="btn" id="fDel">Remove</button>` : ""}</div>${etf[pickF] && etf[pickF].at ? `<p class="note">Saved ${esc(new Date(etf[pickF].at).toLocaleDateString("en-US"))}. Funds change their holdings over time; refresh this every few months.</p>` : ""}</div>` : ""}
      <div id="fLook"></div>`;
    const prev = ()=>{ const L = E.parseHoldings($("fPaste").value), sum = L.reduce((a, x) => a + x.w, 0); $("fPrev").textContent = L.length ? `${L.length} holdings read, ${sum.toFixed(1)}% of the fund${sum > 100.5 ? " (over 100%: check the list)" : ""}.` : "Nothing read yet."; return L; };
    if ($("fPaste")){ prev(); $("fPaste").oninput = prev; }
    if ($("fSave")) $("fSave").onclick = ()=>{ const L = prev(); if (!L.length){ toast("No holdings found in the text"); return; } etf[pickF] = {list:L, at:Date.now()}; cfg.etf = etf; saveCfg("fund holdings"); toast(pickF + " holdings saved"); showTab("funds"); renderPortfolio(); };
    if ($("fDel")) $("fDel").onclick = ()=>{ delete etf[pickF]; saveCfg("fund holdings"); showTab("funds"); renderPortfolio(); };
    B.onclick = e => { const b = e.target.closest("[data-fund]"); if (b){ curFund = b.dataset.fund; showTab("funds"); } };
    const LT = lookNow(portfolioCalc());
    if (LT) $("fLook").innerHTML = `<div class="field"><label>Your real exposure</label><p>Stocks and ETFs only (mutual funds and cash left out). * = held more than one way.</p></div>
      <table class="sc"><thead><tr><th>Company</th><th>Value</th><th>Share</th><th>How</th></tr></thead><tbody>${LT.rows.slice(0, 15).map(r => `<tr><td>${esc(r.sym)}${r.sources > 1 ? "*" : ""}</td><td>${fmt$(r.value,0)}</td><td>${(r.value / LT.total * 100).toFixed(1)}%</td><td class="muted" style="font-size:10.5px">${Object.entries(r.from).map(([k, v]) => (k === "direct" ? "direct" : "via " + esc(k)) + " " + fmt$(v,0)).join(", ")}</td></tr>`).join("")}
      ${Object.entries(LT.unlisted).map(([k, v]) => `<tr class="sub"><td colspan="2">Rest of ${esc(k)} (not in your pasted list)</td><td>${(v / LT.total * 100).toFixed(1)}%</td><td>${fmt$(v,0)}</td></tr>`).join("")}</tbody></table>`;
  }
  else if (tab==="markets"){
    const grp = (title, arr) => `<div class="field"><label>${title}</label><div class="mk-list">${arr.map(m=>`<label><input type="checkbox" data-mk="${m.sym}" ${cfg.hiddenMk.includes(m.sym)?"":"checked"}> ${esc(m.name)} <span class="muted">${m.sym}</span></label>`).join("")}</div></div>`;
    B.innerHTML = `<p class="muted" style="margin-top:0;font-size:12px">Choose what the Markets panel shows. Sectors are tracked with ETFs (e.g. XLV for healthcare).</p>
      <div class="field"><label>Your tiles</label><p style="margin:0 0 6px">Your own stocks or ETFs, shown in the market tiles after the indexes (up to 12). Each one adds a call per refresh.</p>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px">${cfg.myMk.map(x=>`<span class="chip">${esc(x)} <button class="x" data-mydel="${esc(x)}" style="width:16px;height:16px" title="Remove">✕</button></span>`).join("") || `<span class="muted" style="font-size:11.5px">No tiles yet. Add a ticker below.</span>`}</div>
        <div style="display:flex;gap:6px"><input id="myAdd" placeholder="e.g. SOXX" maxlength="10" style="flex:1;text-transform:uppercase"><button class="btn" id="myAddB">Add</button></div></div>
      <div class="field"><label class="mk-list" style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="xaOn" ${xaOn()?"checked":""}> Risk-on / risk-off read</label><p>Uses volatility, credit, Treasury, dollar and equal-weight ETFs (VIXY, HYG, IEF, UUP, RSP). 5 calls per refresh.</p></div>
      <div class="field"><label for="bench">Compare watchlist moves against</label><select id="bench">${["SMH","SOXX","QQQ","SPY","XLK"].map(x=>`<option ${settings.bench===x?"selected":""}>${x}</option>`).join("")}</select><p>Shows "vs ${esc(settings.bench)}" on each watchlist row, to tell a sector-wide dip from a stock-specific drop.</p></div>
      ${grp("Indexes", MARKETS.indices)}${grp("Sectors", MARKETS.sectors)}${grp("Other markets", MARKETS.other)}`;
    const addMy = ()=>{ const v = $("myAdd").value.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g,""); if (!v) return; if (cfg.myMk.includes(v)){ toast(v + " is already in your tiles"); return; } if (cfg.myMk.length >= 12){ toast("You can add up to 12 tiles"); return; } cfg.myMk.push(v); saveCfg(); renderAll(); schedule(true); showTab("markets"); toast(v + " added to the market tiles"); if ($("myAdd")) $("myAdd").focus(); };
    $("myAddB").onclick = addMy; $("myAdd").onkeydown = e=>{ if (e.key==="Enter") addMy(); };
    B.onclick = e=>{ const d = e.target.closest("[data-mydel]"); if (!d) return; cfg.myMk = cfg.myMk.filter(x=>x!==d.dataset.mydel); saveCfg(); renderAll(); showTab("markets"); };
    B.onchange = e=>{
      if (e.target.id==="xaOn"){ cfg.hiddenMk = cfg.hiddenMk.filter(x=>x!=="__xa"); if (!e.target.checked) cfg.hiddenMk.push("__xa"); saveCfg(); renderAll(); if (e.target.checked) schedule(true); return; }
      if (e.target.id==="bench"){ settings.bench = e.target.value; saveSettings(); schedule(true); showTab("markets"); return; }
      const s = e.target.dataset.mk; if (!s) return; cfg.hiddenMk = cfg.hiddenMk.filter(x=>x!==s); if (!e.target.checked) cfg.hiddenMk.push(s); saveCfg(); renderAll(); if (e.target.checked) schedule(true); };
  }
  else if (tab==="layout"){
    const L = layoutOrder();
    B.innerHTML = `<div class="field"><label>Section order</label><p>Drag the rows, or use the arrows. Turn a section off to hide it. Keys 1 to 5 jump to the sections in this order.</p></div>
      <div id="lyList">${L.map((k,i)=>`<div class="ly-row" data-ly="${k}">
        <span class="grip" title="Drag to move">⠿</span><b>${SEC_NAMES[k]}</b>
        <button class="x" data-lymv="${i}:up" title="Move up" ${i===0?"disabled":""}>↑</button><button class="x" data-lymv="${i}:down" title="Move down" ${i===L.length-1?"disabled":""}>↓</button>
        <label class="sw" title="Show or hide this section"><input type="checkbox" data-lyshow="${k}" ${(settings.hideSec||{})[k]?"":"checked"}><span></span></label></div>`).join("")}</div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="lyReset">Reset to default</button></div>
      <p class="note">Default: News, Portfolio, Markets, Watchlist, Today's alerts. Watchlist order: drag a row by its ⠿ grip, or use ↑ ↓ in Settings → Watchlist.</p>`;
    const setL = L2 => { settings.layout = L2; saveSettings(); safe("layout", applyLayout); showTab("layout"); };
    B.onclick = e=>{
      const mv = e.target.closest("[data-lymv]"); if (mv){ const [i, dir] = mv.dataset.lymv.split(":"); const L2 = layoutOrder(), j = +i + (dir==="up"?-1:1); if (j<0||j>=L2.length) return; const [k] = L2.splice(+i,1); L2.splice(j,0,k); setL(L2); return; }
      if (e.target.id==="lyReset"){ settings.hideSec = {}; setL(DEFAULT_LAYOUT.slice()); toast("Layout reset"); }
    };
    B.onchange = e=>{ const k = e.target.dataset.lyshow; if (!k) return; settings.hideSec = Object.assign({}, settings.hideSec, {[k]: !e.target.checked}); saveSettings(); safe("layout", applyLayout); };
    $("lyList").onpointerdown = e=>{
      const r = e.target.closest(".ly-row"); if (!r || e.target.closest("button,label,input")) return;
      sortDrag(e, r, ".ly-row", null, (t, after)=>{ if (!t || t === r){ showTab("layout"); return; }
        const L2 = layoutOrder().filter(k=>k!==r.dataset.ly); let j = L2.indexOf(t.dataset.ly); if (after) j++; L2.splice(j,0,r.dataset.ly); setL(L2); });
    };
  }
  else if (tab==="diag"){
    B.innerHTML = `<div class="field"><label>Version</label>
        <div class="kvs" id="dVer">${verDiag()}</div>
        <button class="btn" id="dChk" style="margin-top:8px">Check for updates</button> <button class="btn" data-methods="1" style="margin-top:8px">How every number is made</button></div>
      <div class="field"><label>How MW is doing</label>
        <div class="kvs">
          <span>Errors this session</span><b style="color:${errCount?"var(--warn)":"inherit"}">${errCount}</b>
          <span>Last price update</span><b>${lastUpdate ? dateTime(lastUpdate) : "—"}</b>
          <span>Data</span><b>${esc(health.err || (health.total ? health.ok + " of " + health.total + " prices" : "—"))}</b>
        </div></div>
      <div class="field"><label>Log</label><p>What MW did and any errors, newest at the bottom. Times in the log are UTC. It never contains your API keys. If something goes wrong, click Copy and paste it to me.</p>
        <textarea class="code" id="dLog" readonly spellcheck="false" style="height:220px">${esc(logBuf.join("\n"))}</textarea></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="dCopy">Copy diagnostics</button>${NATIVE?`<button class="btn" id="dFolder">Open log folder</button>`:""}<button class="btn" id="dClear">Clear page log</button></div>
      <div class="field" style="margin-top:18px"><label for="dSentry">Sentry crash reports (optional)</label>
        <p>Sentry is a free service that collects crash reports from your PC so problems can be fixed even when you don't notice them. Make a free account at sentry.io, create a "Browser JavaScript" project, and paste its DSN here. Reports include the error and app version only: no keys, holdings or prices.</p>
        <div style="display:flex;gap:6px"><input id="dSentry" type="text" value="${esc(settings.sentryDsn||"")}" placeholder="https://…@o123.ingest.sentry.io/456" spellcheck="false" style="flex:1"><button class="btn" id="dSentrySave">Save</button></div>
        <div style="margin-top:6px"><button class="btn" id="dSentryTest">Send a test report</button></div>
        <p id="dSentryState" class="note">${window.Sentry ? "Connected: crash reports are on." : settings.sentryDsn ? "Saved. It connects the next time MW loads." : "Off."}</p></div>
      <div class="field" style="margin-top:18px"><label>Record a market day (for testing)</label>
        <p>Keeps every raw answer from the price feeds on this PC so a real day can be replayed later to check the alert logic. It holds your tickers and prices: keep exported files private. About 1 to 3 MB a day.</p>
        <label style="display:flex;gap:7px;align-items:center;font-weight:400"><input type="checkbox" id="dRec" ${settings.record?"checked":""}> Record</label>
        <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap"><button class="btn" id="dRecDl">Download recording</button><button class="btn" id="dRecClr">Delete recording</button></div><p class="note" id="dRecN"></p></div>`;
    idbCount("tape").then(n => { const el = $("dRecN"); if (el) el.textContent = n ? n + " responses recorded." : "Nothing recorded."; }).catch(()=>{});
    $("dRec").onchange = e => { settings.record = e.target.checked; saveSettings(); mwLog("info", "recording " + (settings.record ? "on" : "off")); };
    $("dRecDl").onclick = ()=> idbAll("tape").then(rows => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify({v:1, app:APP_VERSION, rows})], {type:"application/json"})); a.download = "mw-lab-recording-" + etNow().date + ".json"; a.click(); }).catch(e => toast(e.message));
    $("dRecClr").onclick = ()=>{ if (confirm("Delete the recording on this PC?")) idbClear("tape").then(()=>{ tapeN = 0; showTab("diag"); }); };
    const shellLog = ()=> NATIVE ? nat.invoke("shell_logs").catch(()=> "") : Promise.resolve("");
    $("dChk").onclick = ()=> checkUpdates(true);
    if (NATIVE){
      shellLog().then(t => { const el = $("dLog"); if (el && t){ el.value = "— desktop app log —\n" + t.split("\n").slice(-120).join("\n") + "\n\n— page log —\n" + logBuf.join("\n"); el.scrollTop = el.scrollHeight; } }); }
    setTimeout(()=>{ const el = $("dLog"); if (el) el.scrollTop = el.scrollHeight; }, 0);
    $("dCopy").onclick = async ()=>{ const head = `${verLine()}${upd.widget ? " (latest widget " + upd.widget + ")" : ""}${upd.app ? " (latest app " + upd.app.tag + ")" : ""} · ${navigator.userAgent.match(/Edg\/[\d.]+|Chrome\/[\d.]+/)?.[0] || ""} · errors ${errCount}\n`;
      const txt = scrubKeys(head + $("dLog").value); try{ await navigator.clipboard.writeText(txt); }catch(e){ $("dLog").select(); document.execCommand("copy"); } toast("Copied. Paste it into the chat"); };
    if ($("dFolder")) $("dFolder").onclick = ()=> nat.invoke("shell_open_logs").catch(e => toast(String(e)));
    $("dClear").onclick = ()=>{ logBuf = []; try{ localStorage.removeItem(NS+"diag"); }catch(e){} showTab("diag"); };
    $("dSentryTest").onclick = ()=>{
      if (!window.Sentry){ $("dSentryState").textContent = settings.sentryDsn ? "Still connecting. Try again in a few seconds." : "Paste your DSN and click Save first."; if (settings.sentryDsn) initSentry(); return; }
      try{ window.Sentry.captureException(new Error("MW test report (" + APP_VERSION + (NATIVE && nat.state ? " / app " + nat.state.version : "") + "): this is a test, nothing is wrong")); $("dSentryState").textContent = "Test report sent. It should appear in Sentry under Issues within a minute."; mwLog("info", "Sentry test report sent"); }
      catch(e){ $("dSentryState").textContent = "Couldn't send: " + e.message; } };
    $("dSentrySave").onclick = ()=>{ const v = $("dSentry").value.trim();
      if (v && !/^https:\/\/[^@\s]+@[^\s\/]+\/\d+$/.test(v)){ $("dSentryState").textContent = "That doesn't look like a Sentry DSN (it starts with https:// and ends with a number)."; return; }
      settings.sentryDsn = v; saveSettings(); initSentry(); $("dSentryState").textContent = v ? "Saved. Connecting…" : "Off."; mwLog("info", "Sentry " + (v ? "turned on" : "turned off")); };
  }
  else if (tab==="backup"){
    B.innerHTML = `
      <div class="field"><label>Back up or move your setup</label><p>Holdings, funds and cash, watchlist and alert rules. Keep this private: it's your portfolio.</p>
        <label style="display:flex;gap:7px;align-items:center;font-weight:400;margin-top:6px"><input type="checkbox" id="bKeys"> Include my data keys and settings (to move to the desktop app or another PC)</label></div>
      <textarea class="code" id="bTxt" spellcheck="false">${esc(JSON.stringify(cfg))}</textarea>
      <div style="display:flex;gap:8px;margin:8px 0 18px;flex-wrap:wrap"><button class="btn" id="bCopy">Copy</button><button class="btn" id="bDl">Download file</button></div>
      <div class="field"><label>Restore</label><p>Paste a backup above, then click Restore. This replaces your current list (the current one is kept in History below).</p></div>
      <button class="btn primary" id="bRestore">Restore from the box above</button><div class="err" id="bErr"></div>
      <div class="field" style="margin-top:18px"><label>History</label><p>Earlier versions of your setup on this PC, newest first. Restoring one keeps the current version here too.</p></div>
      <div id="bHist">${store.get("cfgHist", []).map((h, i) => { let c = null; try{ c = JSON.parse(h.cfg); }catch(e){} return c ? `<div class="jrow"><time>${esc(dateTime(h.t))}</time><span>${esc(h.why)} <span class="muted">· ${c.holdings.length} holdings, ${(c.fixed||[]).length} funds/cash, ${c.watch.length} watchlist</span></span><span class="acts">${i === 0 && h.cfg === JSON.stringify(cfg) ? `<span class="muted" style="font-size:10.5px">current</span>` : `<button data-hist="${i}">Restore</button>`}</span></div>` : ""; }).join("") || `<div class="note">No history yet.</div>`}</div>
      ${liveSetup() ? `<div class="field" style="margin-top:18px"><label>Copy from MW</label><p>Bring your holdings, watchlist, keys and preferences over from the MW in this browser. MW itself is not changed.</p><button class="btn" id="bImport">Copy from MW</button></div>` : ""}`;
    B.onclick = e => { const b = e.target.closest("[data-hist]"); if (!b) return; const h = store.get("cfgHist", [])[+b.dataset.hist]; if (!h) return;
      let c; try{ c = JSON.parse(h.cfg); }catch(err){ return; }
      if (!confirm("Go back to the version from " + dateTime(h.t) + "?\n" + E.cfgDiff(cfg, c))) return;
      snapCfg("before restore", true); cfg = normCfg(c); saveCfg("restored"); toast("Restored"); showTab("backup"); renderAll(); schedule(true); };
    if ($("bImport")) $("bImport").onclick = ()=>{ if (importFromLive()){ closeSheet(); renderAll(); schedule(true); } };
    $("bKeys").onchange = e=>{ const c = JSON.parse(JSON.stringify(cfg)); if (e.target.checked){ c._keys = {key:settings.key, tdKey:settings.tdKey, alpKey:settings.alpKey, alpSec:settings.alpSec}; c._settings = {ntfy:settings.ntfy, sound:settings.sound, refresh:settings.refresh, bench:settings.bench, theme:settings.theme, heatOrder:settings.heatOrder, layout:settings.layout, hideSec:settings.hideSec, sentryDsn:settings.sentryDsn}; } $("bTxt").value = JSON.stringify(c); };
    $("bCopy").onclick = async ()=>{ try{ await navigator.clipboard.writeText($("bTxt").value); toast("Copied"); }catch(e){ $("bTxt").select(); document.execCommand("copy"); toast("Copied"); } };
    $("bDl").onclick = ()=>{ const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([$("bTxt").value], {type:"application/json"})); a.download = "mw-lab-backup.json"; a.click(); };
    $("bRestore").onclick = ()=>{
      try{ const c = JSON.parse($("bTxt").value); if (!E.validCfg(c)) throw new Error("this doesn't look like a widget backup");
        if (!confirm("Restore this backup?\n" + E.cfgDiff(cfg, c) + (c._keys ? "\nIt also replaces your data keys." : ""))) return;
        if (c._keys){ if (c._keys.key) settings.key = String(c._keys.key); if (c._keys.tdKey) settings.tdKey = String(c._keys.tdKey); if (c._keys.alpKey && c._keys.alpSec){ settings.alpKey = String(c._keys.alpKey); settings.alpSec = String(c._keys.alpSec); } delete c._keys; hist = {}; loadHist.day = null; }
        if (c._settings && typeof c._settings === "object"){ ["ntfy","sound","refresh","bench","theme","heatOrder","layout","hideSec","sentryDsn"].forEach(k => { if (c._settings[k] != null) settings[k] = c._settings[k]; }); document.documentElement.dataset.theme = settings.theme; delete c._settings; }
        saveSettings();
        snapCfg("before restore", true); cfg = normCfg(c); saveCfg("restored"); toast("Restored"); closeSheet(); schedule(true);
      }catch(e){ $("bErr").textContent = "Couldn't restore: " + e.message; }
    };
  }
}

/* ---------- 4.4: color-blind colors, sparkline readout, market brief, Ctrl+K ---------- */
const BULK_HINT = 'Commas, spaces or new lines all work; prefixes like "NASDAQ:" are dropped. New tickers start with the default dip rules.';
function applyCvd(){ document.documentElement.dataset.cvd = settings.cvd ? "1" : ""; }
applyCvd();
async function copyText(t, msg){
  try{ await navigator.clipboard.writeText(t); }
  catch(e){ const a = document.createElement("textarea"); a.value = t; a.style.position = "fixed"; a.style.opacity = "0"; document.body.appendChild(a); a.select(); try{ document.execCommand("copy"); }catch(e2){} a.remove(); }
  toast(msg);
}
/* hover a sparkline: the price at that point and how far it is from yesterday's close */
(function(){
  let on = false;
  const off = ()=>{ if (!on) return; on = false; const b = $("tip"); if (b) b.classList.remove("show"); };
  document.addEventListener("mousemove", e => {
    const s = e.target.closest && e.target.closest("svg[data-spk],svg[data-pfl]"); if (!s) return off();
    const b = $("tip"); if (!b) return off();
    const r = s.getBoundingClientRect(), f = Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1)));
    if (s.dataset.pfl){
      // the portfolio's day line: the point nearest the pointer on the session's clock
      const pts = pfDay && pfDay.pts; if (!pts || pts.length < 2) return off();
      const o = etMs(pfDay.day, 570), c = etMs(pfDay.day, closeMins(pfDay.day)), t = o + f * (c - o);
      const pt = pts.reduce((a, x) => Math.abs(x[0] - t) < Math.abs(a[0] - t) ? x : a, pts[0]);
      b.textContent = `Your portfolio at ${timeStr(pt[0])}: ${hid() ? "" : fmtS$(pt[1]) + " "}${fmtPct(pt[2])} on the day${pt === pts[pts.length - 1] ? " · latest" : ""}`;
    } else {
      const sym = s.dataset.spk, arr = (spark[etNow().date] || {})[sym] || []; if (arr.length < 2) return off();
      const p = arr[Math.round(f * (arr.length - 1))], q = quotes[sym], ref = q && q.pc;
      b.textContent = `${sym} ${fmtPx(p)}${ref ? " · " + chgTxt(p - ref, (p / ref - 1) * 100, 2, p) + " vs yesterday's close" : ""}${f > 0.97 ? " · latest" : ""}`;
    }
    b.classList.add("show"); on = true;
    const w = b.offsetWidth, h = b.offsetHeight;
    b.style.left = Math.min(Math.max(8, e.clientX - w / 2), innerWidth - w - 8) + "px";
    b.style.top = (r.top - h - 6 < 8 ? r.bottom + 6 : r.top - h - 6) + "px";
  }, true);
  window.addEventListener("scroll", off, true); window.addEventListener("blur", off);
})();
/* a short text summary to paste anywhere; holdings only when asked for */
function briefText(withPf){
  const now = Date.now(), mc = marketClock(), bench = settings.bench, bq = quotes[bench];
  const L = [`MW market brief · ${new Date(now).toLocaleDateString("en-US", {weekday:"short", month:"short", day:"numeric", timeZone:tzName()})} ${timeStr(now)} ${tzAbbr(now)}`, clockSentence(mc, now)];
  const idx = MARKETS.indices.filter(m => quotes[m.sym] && quotes[m.sym].dp != null).map(m => `${m.name} ${fmtPct(quotes[m.sym].dp, 1)}`);
  if (idx.length) L.push(idx.join(" · "));
  const sec = MARKETS.sectors.filter(m => quotes[m.sym] && quotes[m.sym].dp != null).sort((a, b) => quotes[b.sym].dp - quotes[a.sym].dp);
  if (sec.length > 1) L.push(`Sectors: best ${sec[0].name} ${fmtPct(quotes[sec[0].sym].dp, 1)}, worst ${sec[sec.length-1].name} ${fmtPct(quotes[sec[sec.length-1].sym].dp, 1)}`);
  const w = cfg.watch.map(x => (x.sym||"").toUpperCase()).filter(s => quotes[s] && quotes[s].c).map(s => { const q = quotes[s], x = extFor(s);
    return `${s} ${fmtPx(q.c)} ${chgTxt(chgOf(q), q.dp, 1, q.c)}${bq && s !== bench && q.dp != null && bq.dp != null ? ` (vs ${bench} ${fmtPct(q.dp - bq.dp, 1)})` : ""}${x ? `, ${x.ph === "pre" ? "pre-market" : "after hours"} ${chgTxt(x.p - x.base, x.pct, 1, x.p)}` : ""}`; });
  if (w.length) L.push("Watchlist: " + w.join(" · "));
  const f = firedToday(); L.push(f.log.length ? `Alerts today: ${f.log.length} · latest at ${timeStr(f.log[0].t)}: ${f.log[0].msg}` : "Alerts today: none");
  const M = E.nextMacro(now, 2); if (!M.expired && M.list.length) L.push("Coming up: " + M.list.map(x => `${x.name} ${macroWhen(x.t)}`).join(" · "));
  const hl = (withPf ? newsItems() : [...new Set([...nwList("watch"), ...nwList("market")])].sort((a, b) => b.t - a.t)).filter(n => now - n.t < 24*3600e3).slice(0, 3);
  if (hl.length) L.push("Headlines:", ...hl.map(n => `- ${n.syms.length ? n.syms.slice(0, 2).join("/") + ": " : ""}${n.h} (${n.src ? n.src + ", " : ""}${E.agoShort(n.t, now)} ago)`));
  if (withPf && cfg.holdings.length){ const P = portfolioCalc(); L.push(hid() ? `Portfolio: ${dayWord()} ${fmtPct(P.dayPct)} (amounts hidden)` : `Portfolio: ${fmt$(P.total, 0)} · ${dayWord()} ${P.dayUsd != null ? fmtS$(P.dayUsd) : "—"} (${fmtPct(P.dayPct)})`); }
  return L.join("\n");
}
function copyBrief(withPf){ copyText(briefText(withPf), withPf ? "Market brief copied, with your portfolio" : "Market brief copied"); }

/* Ctrl+K: type a ticker to jump to it (or add it), or a word to run a command */
let palSel = 0, palItems = [], palBack = null;
function palOpen(){
  closeMenu(); $("statusPop").classList.add("hide");
  palBack = document.activeElement; $("pal").classList.remove("hide");
  const i = $("palIn"); i.value = ""; palRender(); i.focus();
}
function palClose(back){ $("pal").classList.add("hide"); if (back !== false && palBack && palBack.isConnected && palBack.focus) palBack.focus({preventScroll:true}); palBack = null; }
function palCmds(){
  const C = [
    {n:"Refresh prices", k:"R", run:()=>$("bRefresh").click()},
    {n:settings.compact ? "Full view" : "Compact view", k:"C", run:()=>$("bCompact").click()},
    {n:pausedNow() ? "Resume alerts" : "Pause alerts today", k:"P", run:togglePause},
    {n:"Mark alerts as seen", k:"A", run:()=>{ dismissBanner(); toast("Alerts marked as seen"); }},
    {n:settings.hideAmt ? "Show amounts" : "Hide amounts (total, values, shares, cost, cash)", k:"H", run:toggleHide},
    {n:"Refresh sectors", run:()=>refreshMany(MARKETS.sectors.filter(m => !cfg.hiddenMk.includes(m.sym)).map(m => m.sym), "Sectors")},
    {n:"News: show every headline", k:"N", run:()=>{ settings.newsAll = true; newsJump(""); }},
    {n:"News: check for new headlines", run:()=>{ loadHeadlines(true).then(()=> toast(news.err ? "Some headlines didn't load: " + news.err : "Headlines updated")); }},
    {n:"Copy market brief", run:()=>copyBrief(false)}
  ];
  if (newsItems().some(nwIsNew)) C.splice(5, 0, {n:"News: mark all as read", run:()=>{ const n = nwMark(newsItems().map(x => x.id)); toast(`${n} headline${n === 1 ? "" : "s"} marked as read`); safe("news", renderNews); }});
  if (fundSyms().length && settings.tdKey) C.push({n:"Check mutual fund prices now", run:()=>{ loadNavs(true).then(()=>{ const fs = fundSyms().map(x => navs[x]).filter(n => n && n.nav > 0), d = fs.map(n => n.date).sort()[0]; toast(d ? "Funds are priced " + navDayLabel(d) + (d < E.navDueDate(Date.now()) ? ". Nothing newer is posted yet" : "") : "No fund prices came back"); }); }});
  if (cfg.holdings.length) C.push({n:"Copy market brief with my portfolio", run:()=>copyBrief(true)});
  [...document.querySelectorAll("#tabs button")].forEach(b => C.push({n:"Settings: " + b.textContent.trim(), k:b.dataset.tab === "general" ? "," : "", run:()=>openSheet(b.dataset.tab)}));
  [["dark","Dark"],["light","Light"],["auto","Match Windows"]].forEach(([v, n]) => { if (settings.theme !== v) C.push({n:"Theme: " + n, run:()=>{ settings.theme = v; saveSettings(); document.documentElement.dataset.theme = v; toast("Theme: " + n); }}); });
  C.push({n:settings.cvd ? "Standard colors: up green, down red" : "Color-blind friendly colors: up blue, down orange", run:()=>{ settings.cvd = !settings.cvd; saveSettings(); applyCvd(); safe("redraw", renderAll); toast(settings.cvd ? "Up is blue, down is orange" : "Up is green, down is red"); }});
  if (settings.alpKey && settings.alpSec) C.push({n:settings.fast !== false ? "Turn fast prices off" : "Turn fast prices on", run:()=>{ settings.fast = settings.fast === false; saveSettings(); alpSt.pauseUntil = 0; fastSchedule(); safe("status", renderFrame); toast(alpOn() ? "Fast prices on" : "Fast prices off"); }});
  return C;
}
function palRender(){
  const q = $("palIn").value.trim(), Q = q.toUpperCase().replace(/^\$/, ""), names = {};
  [...MARKETS.indices, ...MARKETS.sectors, ...MARKETS.other, ...XASSET].forEach(m => names[m.sym] = m.name);
  const inW = s => cfg.watch.some(w => (w.sym||"").toUpperCase() === s), inH = s => cfg.holdings.some(h => (h.sym||"").toUpperCase() === s);
  const syms = [...new Set([...mySyms(), ...fundSyms(), ...marketSyms()])];
  const score = s => !Q ? (inW(s) ? 2 : 0) : s === Q ? 100 : s.startsWith(Q) ? 50 - s.length : (names[s]||"").toUpperCase().includes(Q) ? 10 : 0;
  const items = syms.map(s => ({s, sc:score(s)})).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, Q ? 8 : 5).map(({s}) => { const qq = quotes[s];
    return {n:s, sub:[names[s] && names[s] !== s ? names[s] : "", inW(s) ? "Watchlist" : fundSyms().includes(s) ? "Mutual fund" : inH(s) ? "Holding" : "Market tile"].filter(Boolean).join(" · "), px:qq && qq.c ? (extFor(s) ? (extFor(s).ph === "pre" ? "Pre " : "AH ") : "") + fmtPx(lastPx(s)) : "", chg:qq && qq.c ? chgTxt(chgOf(qq), qq.dp, 1, qq.c) : "", c:qq ? cls(qq.dp) : "", run:()=>palGo(s)}; });
  if (Q && items.length && items[0].n === Q && newsItems().some(n => n.syms.includes(Q))) items.splice(1, 0, {n:"News on " + Q, sub:newsItems().filter(n => n.syms.includes(Q)).length + " headlines", run:()=>newsJump(Q)});
  if (Q && items.length && items[0].n === Q) items.splice(1, 0, {n:"Chart " + Q, sub:"Candles, averages and your alerts", k:"G", run:()=>openChart(Q)});
  if (Q && !syms.includes(Q) && E.parseTickers(Q).ok[0] === Q) items.push({n:`Add ${Q} to the watchlist`, sub:"New ticker with the default dip rules", run:()=>{ if (watchAdd(Q)) setTimeout(()=>palGo(Q), 80); }});
  const ql = q.toLowerCase(); items.push(...palCmds().filter(c => !ql || c.n.toLowerCase().includes(ql)).slice(0, Q ? 6 : 14));
  palItems = items; palSel = 0;
  $("palList").innerHTML = items.length ? items.map((it, i) => `<div class="pi${i === 0 ? " on" : ""}" role="option" data-pi="${i}" aria-selected="${i === 0}"><b>${esc(it.n)}</b>${it.sub ? `<span>${esc(it.sub)}</span>` : ""}${it.px ? `<em class="num">${esc(it.px)}${it.chg ? `<i class="${it.c}">${esc(it.chg)}</i>` : ""}</em>` : ""}${it.k ? `<kbd>${esc(it.k)}</kbd>` : ""}</div>`).join("") : `<div class="pnone">Nothing matches. Type a ticker like NVDA, or a word like "pause".</div>`;
}
function palMove(d){
  if (!palItems.length) return; palSel = (palSel + d + palItems.length) % palItems.length;
  $("palList").querySelectorAll("[data-pi]").forEach(el => { const on = +el.dataset.pi === palSel; el.classList.toggle("on", on); el.setAttribute("aria-selected", on); if (on) el.scrollIntoView({block:"nearest"}); });
}
function palRun(i){ const it = palItems[i]; if (!it) return; palClose(false); it.run(); }
/* open a ticker where it lives: its watchlist row, its holding row, or its market tile */
function palGo(sym){
  const w = cfg.watch.some(x => (x.sym||"").toUpperCase() === sym), fund = !w && fundSyms().includes(sym), h = !w && (fund || cfg.holdings.some(x => (x.sym||"").toUpperCase() === sym));
  settings.compact = false; settings.collapsed[w ? "watch" : h ? "portfolio" : "markets"] = false;
  if (fund && cfg.fixed.some(f => (f.sym||"").toUpperCase() === sym)) settings.grpCollapsed.__funds = false;
  if (!w && !h && MARKETS.sectors.some(m => m.sym === sym)) settings.secHide = false;
  if (!w && !h){ settings.focus = sym; refreshOne(sym); }
  saveSettings(); renderAll();
  const sel = w ? `[data-row="${CSS.escape("w:" + sym)}"]` : h ? `[data-row^="${CSS.escape((fund ? "f:" : "h:") + sym + ":")}"]` : `[data-tile="${CSS.escape(sym)}"]`;
  let el = document.querySelector(sel);
  if (el && (w || h) && !openRows.has(el.dataset.row)){ el.click(); el = document.querySelector(sel); }
  if (el && el.offsetParent !== null){ el.scrollIntoView({block:"center", behavior:"smooth"}); el.focus({preventScroll:true}); }
  else toast(sym + " is in a collapsed group right now");
}
$("palIn").addEventListener("input", palRender);
$("palIn").addEventListener("keydown", e => {
  if (e.key === "Escape" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")){ e.preventDefault(); e.stopPropagation(); palClose(); return; }
  if (e.key === "ArrowDown" || e.key === "ArrowUp"){ e.preventDefault(); palMove(e.key === "ArrowDown" ? 1 : -1); return; }
  if (e.key === "Enter"){ e.preventDefault(); palRun(palSel); }
});
$("palList").addEventListener("click", e => { const r = e.target.closest("[data-pi]"); if (r) palRun(+r.dataset.pi); });
$("palList").addEventListener("mousemove", e => { const r = e.target.closest("[data-pi]"); if (r && +r.dataset.pi !== palSel) palMove(+r.dataset.pi - palSel); });
$("pal").addEventListener("mousedown", e => { if (e.target.id === "pal") palClose(); });

/* ---------- News (5.0): one section for every headline about what you own and watch, plus the market's own ----------
   Finnhub company news, one low-priority call per ticker every 15 minutes (up to 24 tickers), and its general market
   news (1 call). The same story on several of your tickers is one line. A headline you opened is "read"; unread ones
   from the last 24 hours count as new. Click a headline to read its summary here; ↗ opens the article. */
let news = store.get("news", {at:0, items:[]});
let newsRead = store.get("newsRead", {});   // id -> 1, pruned to the headlines still listed
try{ localStorage.removeItem(NS + "heads"); }catch(e){}   // the old headline strip's cache (before 5.0)
let nwOpen = null, nwBusy = false;
const NW_PEEK = 3, NW_MAX = 40, NW_NEW_MS = 24*3600e3;
const newsItems = () => (news.items || []).filter(n => n && Array.isArray(n.syms));
const nwIsNew = n => !newsRead[n.id] && Date.now() - n.t < NW_NEW_MS;
function nwList(tab, sym){
  let L = newsItems();
  const own = new Set(cfg.holdings.map(h => (h.sym||"").toUpperCase())), wat = new Set(cfg.watch.map(w => (w.sym||"").toUpperCase()));
  if (tab === "mine") L = L.filter(n => n.syms.some(x => own.has(x)));
  else if (tab === "watch") L = L.filter(n => n.syms.some(x => wat.has(x)));
  else if (tab === "market") L = L.filter(n => !n.syms.length);
  if (sym) L = L.filter(n => n.syms.includes(sym));
  return L;
}
async function loadHeadlines(force){
  if (!settings.key || nwBusy || (!force && Date.now() - news.at < 15*60e3)) return;
  nwBusy = true; safe("news", renderNews);
  try{
    const to = etNow().date, from = addDays(to, -3), all = []; let ok = 0, err = "";
    const jobs = mySyms().slice(0, 24).map(sym => limited(()=>api(`company-news?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}`), !force)
      .then(j => { ok++; (Array.isArray(j) ? j : []).sort((a, b) => b.datetime - a.datetime).slice(0, 8).forEach(n => all.push(nwNorm(n, sym))); }).catch(e => { err = e.message; }));
    jobs.push(limited(()=>api("news?category=general"), !force)
      .then(j => { ok++; (Array.isArray(j) ? j : []).sort((a, b) => b.datetime - a.datetime).slice(0, 20).forEach(n => all.push(Object.assign(nwNorm(n, ""), {cat:"market"}))); }).catch(e => { err = e.message; }));
    await Promise.all(jobs);
    if (ok){
      news = {at:Date.now(), items:E.newsMerge(all, Date.now()), err: ok < jobs.length ? err : ""}; store.set("news", news);
      const live = new Set(news.items.map(n => n.id)); Object.keys(newsRead).forEach(id => { if (!live.has(id)) delete newsRead[id]; }); store.set("newsRead", newsRead);
    } else { news.err = err || "no answer"; mwLog("warn", "news didn't load: " + news.err); }
  } finally { nwBusy = false; safe("news", renderNews); }
}
function nwMark(ids){ let n = 0; ids.forEach(id => { if (!newsRead[id]){ newsRead[id] = 1; n++; } }); if (n) store.set("newsRead", newsRead); return n; }
const NW_GO = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5L7.5 8.5"/></svg>`;
function nwRow(n){
  const open = nwOpen === n.id, isNew = nwIsNew(n), now = Date.now();
  const tags = n.syms.length ? n.syms.slice(0, 2).map(x => { const q = quotes[x]; return `<button class="nw-tk" data-nwsym="${esc(x)}" tabindex="-1" title="Show only ${esc(x)} headlines${q && q.dp != null ? ". " + esc(x) + " is " + chgTxt(chgOf(q), q.dp, 2, q.c) + " a share " + dayWord() : ""}">${esc(x)}${q && q.dp != null ? `<i class="${cls0(+q.dp.toFixed(1) || chgOf(q))}">${chgTxt(chgOf(q), q.dp, 1, q.c)}</i>` : ""}</button>`; }).join("") + (n.syms.length > 2 ? `<span class="nw-tk" title="${esc(n.syms.slice(2).join(", "))}">+${n.syms.length - 2}</span>` : "") : `<span class="nw-tk mk" title="General market news, not about one of your tickers">Market</span>`;
  const sum = n.sum && E.newsKey(n.sum) !== E.newsKey(n.h) ? n.sum : "";
  return `<div class="nw${isNew ? " new" : ""}${open ? " open" : ""}" data-row="n:${esc(n.id)}" role="button" tabindex="0" aria-expanded="${open}">
    <div class="nw-top"><div class="nw-h">${esc(n.h)}</div><a class="nw-go" href="${esc(n.url)}" target="_blank" rel="noopener" tabindex="-1" data-nwgo="${esc(n.id)}" title="Open the article in your browser (O)" aria-label="Open the article">${NW_GO}</a></div>
    <div class="nw-m">${tags}<span class="nw-src">${esc(n.src)}</span><time title="${esc(dateTime(n.t) + " " + tzAbbr(n.t))}">${n.src ? "· " : ""}${E.agoShort(n.t, now)}</time></div>
    ${open ? `<div class="nw-x"><p${sum ? "" : ` class="muted"`}>${sum ? esc(sum) : "No summary came with this headline."}</p>
      <div class="nw-acts"><a class="btn primary" href="${esc(n.url)}" target="_blank" rel="noopener" data-nwgo="${esc(n.id)}">Open article ${NW_GO}</a><button class="rbtn" data-nwcopy="${esc(n.id)}">Copy link</button>${n.syms.slice(0, 2).map(x => `<button class="rbtn" data-chart="${esc(x)}" title="Open ${esc(x)}'s chart">${esc(x)} chart</button>`).join("")}<button class="rbtn nw-cl" data-nwclose="1" title="Close the summary (Esc)">Close</button></div></div>` : ""}
  </div>`;
}
/* the tabs must never be cut off: when they don't fit beside the two buttons, the word "Read" goes first (its tick
   and tooltip stay), then the tabs sit a little closer together. Checked after every render and when the window resizes. */
function nwFit(){
  const bar = document.querySelector("#nw-body .nw-bar"), seg = bar && bar.querySelector(".seg"); if (!seg) return;
  const over = () => seg.scrollWidth > seg.clientWidth + 1;
  bar.classList.remove("tight", "tighter");
  if (over()){ bar.classList.add("tight"); if (over()) bar.classList.add("tighter"); }
}
function renderNews(){
  const sec = $("nw-sec"), body = $("nw-body"), sum = $("nw-sum"); if (!sec) return;
  const items = newsItems(), fk = focusKey(), nNew = items.filter(nwIsNew).length, top = items[0];
  const shut = !!settings.collapsed.news || !!settings.compact;
  sum.innerHTML = (nNew ? `<span class="nw-new" title="Headlines from the last 24 hours you haven't opened yet">${nNew} new</span>` : "")
    + (shut && top ? `<span class="nw-latest" title="${esc(top.h)}">${top.syms[0] ? `<b>${esc(top.syms[0])}</b> ` : ""}${esc(top.h)}</span>` : nwBusy ? `<span class="muted">updating…</span>` : news.at ? `<span class="muted" title="Headlines refresh every 15 minutes">updated ${timeStr(news.at)}</span>` : "");
  if (!settings.key){ body.innerHTML = `<div class="empty" style="padding:6px 4px 2px">Headlines appear once your Finnhub key is in Settings.</div>`; return; }
  if (!items.length){ body.innerHTML = `<div class="empty" style="padding:6px 4px 2px">${nwBusy || !news.at ? "Loading headlines…" : news.err ? "Headlines didn't load (" + esc(news.err) + "). " : "No headlines in the last 3 days for your tickers. "}${nwBusy || !news.at ? "" : `<button data-nw="ref">Try again</button>`}</div>`; return; }
  const TABS = [["all","All"],["mine","Holdings"],["watch","Watchlist"],["market","Market"]].map(([k, n]) => ({k, n, L:nwList(k)})).filter(t => t.k === "all" || t.L.length);
  const tab = TABS.some(t => t.k === settings.newsTab) ? settings.newsTab : "all", inTab = TABS.find(t => t.k === tab).L;
  // ticker chips: who the headlines in this tab are about, most headlines first
  const cnt = {}; inTab.forEach(n => n.syms.forEach(x => { const c = cnt[x] || (cnt[x] = {n:0, nw:0}); c.n++; if (nwIsNew(n)) c.nw++; }));
  const chipSyms = Object.keys(cnt).sort((a, b) => cnt[b].n - cnt[a].n || a.localeCompare(b));
  const sym = chipSyms.includes(nwSym) ? nwSym : ""; if (!sym) nwSym = "";
  const L = sym ? inTab.filter(n => n.syms.includes(sym)) : inTab, all = !!settings.newsAll || !!sym;
  const shown = L.slice(0, all ? NW_MAX : NW_PEEK);
  if (nwOpen && !shown.some(n => n.id === nwOpen)){ const o = L.find(n => n.id === nwOpen); if (o) shown.push(o); else nwOpen = null; }
  let day = "";
  const dayHdr = n => { if (!all) return ""; const d = dayOf(n.t); if (d === day) return ""; day = d;
    const lbl = d === dayOf(Date.now()) ? "Today" : d === dayOf(Date.now() - 864e5) ? "Yesterday" : new Date(n.t).toLocaleDateString("en-US", {weekday:"long", month:"short", day:"numeric", timeZone:tzName()});
    return `<div class="nw-day">${lbl}</div>`; };
  body.innerHTML = `<div class="nw-bar"><div class="seg" role="tablist">${TABS.map(t => { const nw = t.L.filter(nwIsNew).length; return `<button role="tab" data-nwtab="${t.k}" aria-selected="${t.k === tab}" class="${t.k === tab ? "on" : ""}" title="${t.L.length} headline${t.L.length === 1 ? "" : "s"}${nw ? ", " + nw + " new" : ""}">${t.n}${nw && t.k !== "all" ? `<i>${nw}</i>` : ""}</button>`; }).join("")}</div>
      <button class="rbtn" data-nw="read" title="Mark every headline as read" aria-label="Mark every headline as read" ${nNew ? "" : "disabled"}>✓<span> Read</span></button><button class="rbtn" data-nw="ref" title="Check for new headlines now" aria-label="Refresh headlines" ${nwBusy ? "disabled" : ""}>${nwBusy ? "…" : "↻"}</button></div>
    ${chipSyms.length > 1 ? `<div class="nw-chips">${chipSyms.slice(0, 14).map(x => `<button data-nwsym="${esc(x)}" class="${x === sym ? "on" : ""}" title="${x === sym ? "Show every ticker again" : "Show only " + esc(x) + " headlines"}">${esc(x)}<span>${cnt[x].n}</span>${cnt[x].nw ? `<i></i>` : ""}${x === sym ? ` ✕` : ""}</button>`).join("")}</div>` : ""}
    <div class="nw-list">${shown.map(n => dayHdr(n) + nwRow(n)).join("") || `<div class="empty" style="padding:8px 4px">Nothing here right now.</div>`}</div>
    ${sym ? `<div class="nw-foot"><span class="muted">${L.length} headline${L.length === 1 ? "" : "s"} on ${esc(sym)}</span><button class="rbtn" data-nwsym="${esc(sym)}">Show every ticker</button></div>`
      : L.length > NW_PEEK ? `<div class="nw-foot"><button class="rbtn" data-nw="more">${all ? "Show fewer" : `Show all ${Math.min(L.length, NW_MAX)} headlines`}</button></div>` : ""}`;
  nwFit(); refocus(fk);
}
let nwSym = "";
/* open the News section on one ticker (from a row's details, or Ctrl+K) */
function newsJump(sym){
  settings.compact = false; settings.collapsed.news = false; (settings.hideSec || {}).news = false; settings.newsTab = "all"; nwSym = sym || ""; saveSettings(); renderAll();
  const sec = $("nw-sec"); sec.scrollIntoView({behavior:"smooth", block:"start"});
  const first = sec.querySelector(".nw"); if (first) first.focus({preventScroll:true});
}
function newsClick(e){
  const go = e.target.closest("[data-nwgo]");
  if (go){ if (nwMark([go.dataset.nwgo])) setTimeout(()=>{ safe("news", renderNews); safe("portfolio", renderPortfolio); safe("watchlist", renderWatch); }, 80); return false; }   // the link itself still opens
  const jump = e.target.closest("[data-nwjump]"); if (jump){ e.stopPropagation(); newsJump(jump.dataset.nwjump); return true; }
  if (!e.target.closest("#nw-sec")) return false;
  const tk = e.target.closest("[data-nwsym]"); if (tk){ nwSym = nwSym === tk.dataset.nwsym ? "" : tk.dataset.nwsym; nwOpen = null; renderNews(); return true; }
  const tb = e.target.closest("[data-nwtab]"); if (tb){ settings.newsTab = tb.dataset.nwtab; nwSym = ""; nwOpen = null; saveSettings(); renderNews(); const f = document.querySelector(`[data-nwtab="${tb.dataset.nwtab}"]`); if (f) f.focus({preventScroll:true}); return true; }
  const act = e.target.closest("[data-nw]");
  if (act){ const k = act.dataset.nw;
    if (k === "read"){ const n = nwMark(newsItems().map(x => x.id)); toast(n ? `${n} headline${n === 1 ? "" : "s"} marked as read` : "Nothing new to mark"); renderNews(); }
    else if (k === "ref"){ loadHeadlines(true).then(()=> toast(news.err ? "Some headlines didn't load: " + news.err : "Headlines updated")); }
    else if (k === "more"){ settings.newsAll = !settings.newsAll; saveSettings(); renderNews(); if (!settings.newsAll) $("nw-sec").scrollIntoView({block:"nearest"}); }
    return true; }
  const cp = e.target.closest("[data-nwcopy]"); if (cp){ const n = newsItems().find(x => x.id === cp.dataset.nwcopy); if (n) copyText(n.url, "Link copied"); return true; }
  if (e.target.closest("[data-nwclose]")){ const k = "n:" + nwOpen; nwOpen = null; renderNews(); refocus(k); return true; }
  if (e.target.closest("[data-chart]")) return false;
  const row = e.target.closest(".nw");
  if (row){ if (e.target.closest(".nw-x")) return true;   // reading or selecting the summary doesn't close it
    const id = row.dataset.row.slice(2); nwOpen = nwOpen === id ? null : id; if (nwOpen) nwMark([id]); renderNews(); refocus("n:" + id);
    const el = document.querySelector(`[data-row="${CSS.escape("n:" + id)}"]`); if (el && nwOpen) el.scrollIntoView({block:"nearest", behavior:"smooth"}); return true; }
  return false;
}

/* ---------- chart window (4.5): TradingView Lightweight Charts (Apache-2.0, in vendor/, loaded on first use) ----------
   Daily candles come from the price history MW already keeps (Twelve Data, on this PC); 1D is today's 5-minute bars
   (1 Twelve Data credit, at most every 5 minutes). Today's candle follows the live price. */
const CH_RANGES = {"1D":0, "1M":22, "3M":64, "6M":127, "1Y":253, "5Y":1300};
let chSym = null, chObj = null, chSeries = null, chLastBar = null;
const chIntra = {};   // sym -> {at, day, bars}
function loadLwc(){
  if (window.LightweightCharts) return Promise.resolve();
  return loadLwc.p || (loadLwc.p = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "vendor/lightweight-charts-4.2.3.js";
    s.onload = res; s.onerror = () => { loadLwc.p = null; rej(new Error("the chart library didn't load")); }; document.head.appendChild(s); }));
}
/* a moment shown as the wall-clock time in your time zone (the chart library labels times as UTC) */
function wallSec(ms){
  const p = {}; new Intl.DateTimeFormat("en-US", {timeZone:tzName(), year:"numeric", month:"numeric", day:"numeric", hour:"numeric", minute:"numeric", hourCycle:"h23"}).formatToParts(ms).forEach(x => p[x.type] = +x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) / 1000;
}
function chOv(){ return Object.assign({ma50:true, ma200:true, lv:true, hi:true, er:true}, settings.chOv || {}); }
async function openChart(sym){
  sym = String(sym || "").toUpperCase(); if (!sym) return;
  closeMenu(); chSym = sym; $("chart").classList.remove("hide"); $("chSym").textContent = sym; $("chNote").textContent = ""; chartHead();
  $("chX").focus({preventScroll:true});
  try{ await loadLwc(); }catch(e){ $("chNote").textContent = "The chart couldn't open: " + e.message + ". Check your connection and try again."; return; }
  if (chSym !== sym) return;
  drawChart();
  if (!barsMem[sym] && settings.tdKey) loadHist([sym]);
  loadErHist([sym]).then(()=>{ if (chSym === sym && (settings.chRange || "6M") !== "1D") safe("chart", drawChart); });
}
function closeChart(){ $("chart").classList.add("hide"); if (chObj){ chObj.remove(); chObj = null; } chSeries = null; chLastBar = null; const k = chSym; chSym = null; if (k) refocus(document.querySelector(`[data-row="${CSS.escape("w:" + k)}"]`) ? "w:" + k : ""); }
function setChartRange(r){ settings.chRange = r; saveSettings(); drawChart(); }
function chartHeadPx(){
  const q = quotes[chSym], names = {}; [...MARKETS.indices, ...MARKETS.sectors, ...MARKETS.other, ...XASSET].forEach(m => names[m.sym] = m.name);
  $("chPx").innerHTML = q && q.c ? `${extTag(extFor(chSym))}${fmtPx(lastPx(chSym))} <b class="${cls(q.dp)}" title="${dayWord() === "today" ? "Today" : "Last session"}, for one share">${chgTxt(chgOf(q), q.dp, 2, q.c)}</b>${names[chSym] ? ` <span class="muted">${esc(names[chSym])}</span>` : ""}` : "";
}
function chartHead(){
  chartHeadPx();
  const r = settings.chRange || "6M";
  $("chRange").innerHTML = Object.keys(CH_RANGES).map(k => `<button data-r="${k}" class="${k === r ? "on" : ""}">${k}</button>`).join("");
  const o = chOv(), lv = cfg.watch.some(w => (w.sym||"").toUpperCase() === chSym);
  $("chLeg").innerHTML = (r === "1D" ? [] : [["ma50", "50-day avg", "var(--accent)"], ["ma200", "200-day avg", "var(--warn)"], ["hi", "52-week high and low", "var(--muted)"], ["er", "report days", "var(--fg-2)"]]).concat(lv ? [["lv", "your price alerts", "var(--down)"]] : [])
    .map(([k, n, c]) => `<button data-ov="${k}" class="${o[k] ? "on" : ""}" aria-pressed="${!!o[k]}"><i style="background:${c}"></i>${n}</button>`).join("");
}
/* the readout line (6.0): the candle under the pointer, or the latest one when the pointer is away. Its change is
   against the candle before it on daily charts, and against the previous close on the 1D chart. */
let chAll = [], chRef = null;
const chKey = t => typeof t === "string" || typeof t === "number" ? t : t && t.year ? `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}` : "";
function chHoverSet(bar){
  const el = $("chHover"); if (!el) return;
  const b = bar && bar.close > 0 ? bar : chLastBar; if (!b){ el.innerHTML = ""; return; }
  const k = chKey(b.time), intra = typeof k === "number", i = chAll.findIndex(x => x.time === k);
  const prev = intra ? chRef : i > 0 ? chAll[i - 1].close : null, f = v => fmtPx(v).replace("$", "");
  const when = intra ? new Date(k * 1000).toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit", timeZone:"UTC"})
    : new Date(k + "T12:00:00Z").toLocaleDateString("en-US", k.slice(0, 4) === etNow().date.slice(0, 4) ? {weekday:"short", month:"numeric", day:"numeric", timeZone:"UTC"} : {month:"numeric", day:"numeric", year:"2-digit", timeZone:"UTC"});
  el.innerHTML = `<span class="g"><span><b>${esc(when)}</b></span><span>Close <b>${f(b.close)}</b></span>${prev > 0 ? `<span title="${intra ? "Against the previous close" : "Against the close of the day before"}, for one share"><b class="${cls(b.close - prev)}">${chgTxt(b.close - prev, (b.close / prev - 1) * 100, 2, b.close)}</b></span>` : ""}</span><span class="g"><span>Open <b>${f(b.open)}</b></span><span>High <b>${f(b.high)}</b></span><span>Low <b>${f(b.low)}</b></span></span>`;
}
function chIntraLoad(sym){
  const c = chIntra[sym], day = etNow().date; if (c && (c.loading || Date.now() - c.at < 5*60e3)) return;
  if (!settings.tdKey){ return; }
  chIntra[sym] = Object.assign({}, c || {}, {loading:true});
  tdCall("time_series?symbol=" + encodeURIComponent(sym) + "&interval=5min&outputsize=90", "chart").then(js => {
    const v = (js.values || []).slice().reverse(), last = v.length ? v[v.length - 1].datetime.slice(0, 10) : day;
    chIntra[sym] = {at:Date.now(), day:last, bars:v.filter(x => x.datetime.slice(0, 10) === last).map(x => { const [d, t] = x.datetime.split(" "), [hh, mm] = t.split(":").map(Number);
      return {time:wallSec(etMs(d, hh*60 + mm)), open:+x.open, high:+x.high, low:+x.low, close:+x.close}; })};
  }).catch(e => { chIntra[sym] = {at:Date.now(), day, bars:(c && c.bars) || [], err:e.message}; })
    .finally(() => { if (chSym === sym && (settings.chRange || "6M") === "1D") safe("chart", drawChart); });
}
function drawChart(){
  const sym = chSym, box = $("chBox"); if (!sym || !window.LightweightCharts) return;
  chartHead();
  if (chObj){ chObj.remove(); chObj = null; } chSeries = null; chLastBar = null; chAll = []; chRef = null; chHoverSet(null);
  const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim(), r = settings.chRange || "6M", o = chOv(), q = quotes[sym];
  const note = [];
  let data = [];
  if (r === "1D"){
    const c = chIntra[sym]; chIntraLoad(sym);
    data = c && c.bars ? c.bars.slice() : [];
    if (!settings.tdKey) note.push("The 1D chart needs a free Twelve Data key (Settings → General).");
    else if (!data.length) note.push(c && c.err ? "Couldn't load today's bars: " + c.err : "Loading today's 5-minute bars…");
    else note.push(`5-minute bars for ${c.day === etNow().date ? "today" : mdLabel(c.day)}, times in ${tzAbbr(Date.now())}.`);
  } else {
    const bars = (barsMem[sym] || []).slice().reverse();
    data = bars.map(b => ({time:b[0], open:b[1], high:b[2], low:b[3], close:b[4]})).filter(b => b.open > 0 && b.close > 0);
    const today = etNow().date;
    if (data.length && q && q.c > 0 && q.o > 0 && isTradingDay(today) && etNow().mins >= 570 && data[data.length - 1].time < today && q.at && etDateOf(q.at) === today)
      data.push({time:today, open:q.o, high:Math.max(q.h || q.c, q.c), low:Math.min(q.l || q.c, q.c), close:q.c});
    if (!data.length) note.push(settings.tdKey ? "Loading price history… (about a minute the first time)" : "Daily charts need a free Twelve Data key (Settings → General).");
  }
  const font = css.getPropertyValue("--font").trim() || "system-ui";
  chObj = LightweightCharts.createChart(box, {autoSize:true,
    layout:{background:{type:"solid", color:v("--surface")}, textColor:v("--fg-2"), fontFamily:font, fontSize:11},
    grid:{vertLines:{visible:false}, horzLines:{color:v("--line")}},
    rightPriceScale:{borderVisible:false, scaleMargins:{top:0.12, bottom:0.08}}, timeScale:{borderVisible:false, timeVisible:r === "1D", secondsVisible:false, rightOffset:2},
    crosshair:{mode:0}, localization:{priceFormatter:p => fmtPx(p)}, handleScale:{axisPressedMouseMove:false}});
  if (!data.length){ $("chNote").textContent = note.join(" "); return; }
  const shown = r === "1D" ? data : data.slice(-CH_RANGES[r]), from = shown[0].time;
  chSeries = chObj.addCandlestickSeries({upColor:v("--up"), downColor:v("--down"), borderVisible:false, wickUpColor:v("--up"), wickDownColor:v("--down"), priceLineColor:v("--muted")});
  chSeries.setData(shown); chLastBar = Object.assign({}, shown[shown.length - 1]);
  // the readout: 1D bars are measured against the previous close, when the bars are from the session the quote is for
  chAll = data; chRef = r === "1D" && q && q.pc > 0 && chIntra[sym] && chIntra[sym].day === E.quoteDay(q.t ? q.t * 1000 : q.at) ? q.pc : null;
  chHoverSet(null);
  chObj.subscribeCrosshairMove(p => { const d = p && p.time != null && p.seriesData && chSeries ? p.seriesData.get(chSeries) : null; chHoverSet(d || null); });
  if (r !== "1D"){
    const sma = n => { let s = 0; const out = []; data.forEach((d, i) => { s += d.close; if (i >= n) s -= data[i - n].close; if (i >= n - 1 && d.time >= from) out.push({time:d.time, value:s / n}); }); return out; };
    const line = (col, pts) => { if (pts.length) chObj.addLineSeries({color:col, lineWidth:1, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false}).setData(pts); };
    if (o.ma50) line(v("--accent"), sma(50));
    if (o.ma200) line(v("--warn"), sma(200));
    const m = metrics[sym] || {};
    if (o.hi && m.hi) chSeries.createPriceLine({price:m.hi, color:v("--muted"), lineStyle:1, lineWidth:1, axisLabelVisible:false, title:"52w high"});
    if (o.hi && m.lo) chSeries.createPriceLine({price:m.lo, color:v("--muted"), lineStyle:1, lineWidth:1, axisLabelVisible:false, title:"52w low"});
    if (o.er){ const mv = erMoveOf(sym), e = erInfo(sym);
      if (mv) chSeries.setMarkers(mv.list.filter(x => x.d >= from).sort((a, b) => a.d.localeCompare(b.d)).map(x => ({time:x.d, position:x.move >= 0 ? "belowBar" : "aboveBar", shape:"circle", color:v("--fg-2"), text:"ER " + fmtPct(x.move, 1)})));
      if (e) note.push(`Next report ${new Date(e.d + "T12:00:00Z").toLocaleDateString("en-US", {weekday:"short", timeZone:"UTC"})} ${+e.d.slice(5, 7)}/${+e.d.slice(8, 10)}${e.hour === "amc" ? " after the close" : e.hour === "bmo" ? " before the open" : ""}${mv ? `, typical move ±${mv.avg.toFixed(1)}%` : ""}.`); }
  }
  const w = cfg.watch.find(x => (x.sym||"").toUpperCase() === sym);
  if (o.lv && w && E.levelsLive(w, etNow().date)) effLevels(w).forEach(L => chSeries.createPriceLine({price:L, color:v("--down"), lineStyle:2, lineWidth:1, axisLabelVisible:true, title:"alert " + fmtL(L)}));
  chObj.timeScale().fitContent();
  $("chNote").textContent = note.join(" ");
}
/* the newest candle follows the live price */
function chartLive(){
  if (!chSym || !chSeries || !chLastBar) return;
  chartHeadPx();
  const q = quotes[chSym], r = settings.chRange || "6M"; if (!q || !(q.c > 0) || !q.at || etDateOf(q.at) !== etNow().date || session().s !== "open") return;
  let b = Object.assign({}, chLastBar);
  if (r === "1D"){
    const c = chIntra[chSym]; if (!c || c.day !== etNow().date) return;
    const t = wallSec(Math.floor(Date.now() / 300e3) * 300e3);
    b = t > b.time ? {time:t, open:b.close, high:Math.max(b.close, q.c), low:Math.min(b.close, q.c), close:q.c} : Object.assign(b, {high:Math.max(b.high, q.c), low:Math.min(b.low, q.c), close:q.c});
  } else {
    if (b.time !== etNow().date) return;
    Object.assign(b, {high:Math.max(b.high, q.c), low:Math.min(b.low, q.c), close:q.c});
  }
  try{ chSeries.update(b); chLastBar = b; const i = chAll.findIndex(x => x.time === b.time); if (i >= 0) chAll[i] = b; else chAll.push(b); }catch(e){}
}
$("chX").onclick = closeChart;
$("chart").addEventListener("mousedown", e => { if (e.target.id === "chart") closeChart(); });
$("chRange").addEventListener("click", e => { const b = e.target.closest("[data-r]"); if (b) setChartRange(b.dataset.r); });
$("chLeg").addEventListener("click", e => { const b = e.target.closest("[data-ov]"); if (!b) return; const o = chOv(); o[b.dataset.ov] = !o[b.dataset.ov]; settings.chOv = o; saveSettings(); drawChart(); });

/* ---------- loop ---------- */
let timer = null;
function schedule(now){
  clearTimeout(timer);
  const next = ()=>{ const ms = refreshMs(); if (ms) timer = setTimeout(run, ms); };
  const run = async ()=>{ try{ await tick(); }catch(e){ report(e); mwLog("error", "refresh: " + (e && e.message || e)); } finally{ next(); } };
  if (now) run(); else next();
}
document.addEventListener("visibilitychange", ()=>{ if (!document.hidden && refreshMs() && lastUpdate && Date.now()-lastUpdate > refreshMs()) schedule(true); });

/* ---------- app shell: title bar overlay, first-run size, offline cache ---------- */
(function(){
  const wco = navigator.windowControlsOverlay;
  const apply = ()=> document.body.classList.toggle("wco", !!(wco && wco.visible));
  if (wco){ apply(); wco.addEventListener("geometrychange", apply); }
  try{
    const standalone = matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches;
    if (standalone && !store.get("sized", false)){ store.set("sized", true); window.resizeTo(440, 900); }
  }catch(e){}
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(()=>{});
})();

/* ---------- desktop app wiring ---------- */
async function syncNative(){
  try{ nat.state = await nat.invoke("shell_state"); $("bPin").classList.toggle("on", !!nat.state.on_top); $("bPin").title = (nat.state.on_top ? "On top (T to release)" : "Keep on top (T)"); }catch(e){}
}
const verNum = v => String(v||"").replace(/^[^0-9]*/,"").split(".").map(n=>parseInt(n)||0);
const newer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i=0;i<3;i++){ if ((x[i]||0) !== (y[i]||0)) return (x[i]||0) > (y[i]||0); } return false; };
/* ---------- versions: am I up to date? ----------
   Widget = this page (updates itself; version.json says what is live).
   App = the Windows app around it (GitHub Releases; needs a download). */
const upd = { widget:null, app:null, checking:false, at:0 };
const METHODS_URL = "https://github.com/awpmap/market-widget/blob/main/lab/METHODS.md";
document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-methods]"); if (b){ e.preventDefault(); openExt(METHODS_URL); } });
const openExt = url => { if (!NATIVE) return window.open(url, "_blank", "noopener");
  Promise.resolve().then(()=> TAURI.opener ? TAURI.opener.openUrl(url) : nat.invoke("plugin:opener|open_url", {url})).catch(()=>{ try{ window.open(url, "_blank"); }catch(e){} }); };
// an app older than 1.1.1 can't answer the page at all (its permissions don't cover the hosted page): treat it as out of date
const appVer = () => nat.state ? nat.state.version : "too old to report";
function updState(){
  const widgetNew = !!(upd.widget && newer(upd.widget, APP_VERSION));
  const appNew = !!(NATIVE && upd.app && upd.app.tag && (!nat.state ? upd.shellTried : newer(upd.app.tag, nat.state.version)));
  return { widgetNew, appNew, any: widgetNew || appNew };
}
async function checkUpdates(force){
  if (upd.checking) return;
  upd.checking = true; renderVersion();
  let ok = false;
  try{
    try{ const r = await fetchT("version.json?t=" + Date.now(), {cache:"no-store"}, 10000);
      if (r.ok){ const j = await r.json(); if (j && j.widget){ upd.widget = String(j.widget); ok = true; } } }catch(e){}
    if (NATIVE){
      if (!nat.state) await syncNative();
      upd.shellTried = true;
      let u = store.get("appUpd", {});
      const kind = labShell() ? "lab" : "mw";
      if (force || !u.at || !u.v2 || u.kind !== kind || Date.now() - u.at > 3*3600e3){
        // the MW Lab app ships as pre-releases tagged lab-app-v…; the regular MW app (which may be showing this beta) as app-v…
        try{ const r = await fetchT("https://api.github.com/repos/awpmap/market-widget/releases?per_page=30", {headers:{Accept:"application/vnd.github+json"}}, 15000);
          if (r.ok){ const list = await r.json(), j = (Array.isArray(list) ? list : []).find(x => !x.draft && (kind === "lab" ? /^lab-app-v/.test(x.tag_name || "") : /^app-v/.test(x.tag_name || "") && !x.prerelease));
            const a = j && (j.assets||[]).find(x => /_x64-setup\.exe$/i.test(x.name||""));
            u = j ? {v2:1, kind, at:Date.now(), tag:j.tag_name, url:j.html_url, dl: a ? a.browser_download_url : ""} : {v2:1, kind, at:Date.now()}; store.set("appUpd", u); }
          else ok = false;
        }catch(e){ ok = false; }
      }
      upd.app = u.tag ? u : null;
    }
    if (ok) upd.at = Date.now();
    const st = updState();
    mwLog("info", "update check: widget " + APP_VERSION + (upd.widget ? " (latest " + upd.widget + ")" : " (latest unknown)") + (NATIVE ? ", app " + appVer() + (upd.app ? " (latest " + upd.app.tag + ")" : "") : "") + (st.any ? ", UPDATE AVAILABLE" : ok ? ", up to date" : ""));
  } finally { upd.checking = false; renderVersion(); maybeAutoReload(); }
}
// fresh copy of the page: a new URL skips every cache (browser, service worker, GitHub's CDN)
function reloadForUpdate(){ mwLog("info", "reloading for widget " + upd.widget); location.replace(location.pathname + "?v=" + encodeURIComponent(upd.widget || Date.now()) + location.hash); }
// widget update while nobody is looking (hidden in the tray / tab in the background): take it, once per version,
// but never between 9:25 and 4:05 on a trading day (R2): a new version waits for the close instead of swapping code mid-session
function inMarketHours(){ const t = etNow(); return E.calendarValid(t.date) && isTradingDay(t.date) && t.mins >= 565 && t.mins < closeMins(t.date) + 5; }
function maybeAutoReload(){
  const st = updState();
  if (!st.widgetNew || !document.hidden || !$("sheet").classList.contains("hide")) return;
  if (inMarketHours()){ if (!maybeAutoReload.told){ maybeAutoReload.told = true; mwLog("info", "MW " + upd.widget + " is ready; it installs after the close (no code changes during market hours)"); } return; }
  if (store.get("autoRel", "") === upd.widget) return;
  store.set("autoRel", upd.widget); reloadForUpdate();
}
document.addEventListener("visibilitychange", ()=>{ if (document.hidden) maybeAutoReload(); else if (Date.now() - upd.at > 30*60e3) checkUpdates(); });
function verLine(){ return "MW " + APP_VERSION + (NATIVE ? " · app " + (nat.state ? nat.state.version : "?") : ""); }
function verStatus(){
  const st = updState();
  if (upd.checking) return {k:"chk", t:"Checking…"};
  if (st.any) return {k:"new", t:"Update available"};
  if (upd.at) return {k:"ok", t:"Up to date ✓"};
  return {k:"unk", t:"Check now"};
}
function renderVersion(){
  const st = updState(), vs = verStatus();
  $("mVer").textContent = verLine();
  $("mVerSub").textContent = st.appNew ? "App " + upd.app.tag.replace(/^(lab-)?app-v/,"") + " is out. Click to download"
    : st.widgetNew ? "MW " + upd.widget + " is out. Click to reload"
    : upd.at ? "Checked " + timeStr(upd.at) + ". Click to check again" : "Click to check for updates";
  const c = $("mVerChip"); c.textContent = vs.t; c.className = "vchip " + vs.k;
  $("bMore").classList.toggle("has-upd", st.any);
  $("bMore").title = st.any ? "Menu · update available" : "Menu";
  const el = $("update"), parts = [];
  if (st.appNew) parts.push(`<div><b>New desktop app: ${esc(upd.app.tag.replace(/^(lab-)?app-v/,""))}</b> ${nat.state ? `You have ${esc(nat.state.version)}.` : "Your app is too old to report its version."} Quit ${labShell() ? "MW Lab" : "MW"} from the tray, run the installer, your settings stay. <button class="lnk" data-upd="app">Download</button></div>`);
  if (st.widgetNew) parts.push(`<div><b>MW ${esc(upd.widget)} is ready</b> You're on ${esc(APP_VERSION)}.${inMarketHours() ? " It installs by itself after the close, or now if you click:" : ""} <button class="lnk" data-upd="reload">Reload now</button></div>`);
  if (parts.length && store.get("updDismiss", "") !== (upd.widget || "") + "|" + (upd.app && upd.app.tag || "")){
    el.innerHTML = parts.join("") + `<button class="x" data-upd="dismiss" aria-label="Hide until the next version">×</button>`; el.classList.add("show");
  } else el.classList.remove("show");
  const d = $("dVer"); if (d) d.innerHTML = verDiag();
}
function verDiag(){
  const st = updState();
  return `<span>Widget</span><b>${APP_VERSION}${upd.widget ? (st.widgetNew ? ` <em class="vchip new">${esc(upd.widget)} available</em>` : ` <em class="vchip ok">latest</em>`) : ""}</b>`
    + (NATIVE ? `<span>Desktop app</span><b>${esc(appVer())}${upd.app ? (st.appNew ? ` <em class="vchip new">${esc(upd.app.tag.replace(/^(lab-)?app-v/,""))} available</em>` : ` <em class="vchip ok">latest</em>`) : ""}</b>` : "")
    + `<span>Last checked</span><b>${upd.at ? dateTime(upd.at) : "—"}</b>`;
}
function doUpdate(){
  const st = updState();
  if (st.appNew) openExt(upd.app.dl || upd.app.url);
  else if (st.widgetNew) reloadForUpdate();
  else checkUpdates(true);
}
$("bVer").onclick = e=>{ e.stopPropagation(); const st = updState(); if (st.any) closeMenu(); doUpdate(); };
$("update").onclick = e=>{
  const b = e.target.closest("[data-upd]"); if (!b) return;
  if (b.dataset.upd === "app") openExt(upd.app.dl || upd.app.url);
  else if (b.dataset.upd === "reload") reloadForUpdate();
  else { store.set("updDismiss", (upd.widget || "") + "|" + (upd.app && upd.app.tag || "")); renderVersion(); }
};
if (NATIVE){
  document.body.classList.add("native");
  $("wMin").onclick = ()=> nat.win().minimize().catch(()=>{});
  $("wClose").onclick = ()=> nat.invoke("shell_hide").catch(()=>{});
  $("bPin").onclick = async ()=>{ const on = !(nat.state && nat.state.on_top); try{ await nat.invoke("shell_set", {key:"on_top", value:on}); await syncNative(); toast(on ? "Kept on top" : "No longer on top"); }catch(e){ toast(String(e)); } };
  try{
    TAURI.event.listen("mw-refresh", ()=> schedule(true));
    TAURI.event.listen("mw-pause", ()=> togglePause());
    TAURI.event.listen("mw-shell-changed", ()=> syncNative());
  }catch(e){}
  // no browser right-click menu (Back, Reload, Inspect) except where text is editable
  document.addEventListener("contextmenu", e=>{ if (!e.target.closest("input,textarea")) e.preventDefault(); });
  syncNative().then(renderVersion);
  // heartbeat: the tray app reloads the page if this stops (crash, failed load)
  const alive = ()=> nat.invoke("shell_alive").catch(()=>{});
  alive(); setInterval(alive, 30e3);
  // the tray app calls this when it hasn't heard from the page (timers held back while hidden)
  window.__mwWake = why => { mwLog("info", "woken by " + why); alive(); if (refreshMs() && (!lastUpdate || Date.now() - lastUpdate > refreshMs())) schedule(true); safe("frame", renderFrame); };
}
/* opening animation hand-off (R21a): it ends as soon as prices are in (after a short 0.6 s minimum so it never
   flashes), 3 s at most; the logo flies into the title bar and the app shows through. A click skips it. */
(function(){
  const el = $("splash");
  if (!document.documentElement.classList.contains("boot")){ if (el) el.remove(); return; }
  mwLog("info", "opening animation");
  try{ if (location.hash === "#splash") history.replaceState(null, "", location.pathname + location.search); }catch(e){}
  const t0 = performance.now(); let done = false;
  const finish = () => {
    if (done) return; done = true;
    try{
      $("spStatus").textContent = "Ready";
      const mark = el.querySelector(".sp-mark"), dst = document.querySelector("#titlebar .logo");
      const a = mark.getBoundingClientRect(), b = dst ? dst.getBoundingClientRect() : null;
      if (b && b.width && mark.animate){
        mark.animate([{transform:"none"}, {transform:`translate(${(b.left + b.width/2) - (a.left + a.width/2)}px,${(b.top + b.height/2) - (a.top + a.height/2)}px) scale(${b.width / a.width})`}], {duration:480, easing:"cubic-bezier(.6,0,.2,1)", fill:"forwards"});
        el.querySelectorAll(".sp-word,.sp-load,.sp-status").forEach(n => n.animate([{opacity:getComputedStyle(n).opacity}, {opacity:0}], {duration:200, fill:"forwards"}));
        el.animate([{backgroundColor:getComputedStyle(el).backgroundColor}, {backgroundColor:"rgba(0,0,0,0)"}], {duration:360, delay:160, fill:"forwards"});
      }
    }catch(e){}
    setTimeout(()=>{ el.remove(); document.documentElement.classList.remove("boot"); }, 520);
  };
  const fresh = () => lastUpdate && Date.now() - lastUpdate < 90e3;
  const check = () => { const t = performance.now() - t0; if (t >= 600 && (fresh() || !settings.key || t >= 3000)) finish(); else setTimeout(check, 100); };
  setTimeout(check, 600);
  el.addEventListener("click", finish);
  setTimeout(finish, 6000);   // never stuck
})();
/* ---------- section headers stay in view (6.0) ----------
   A section's header sticks to the top while you scroll through it (CSS); this adds the shadow under a stuck header
   and, for Portfolio, lets its total show there (it is hidden while the big total is on screen). */
(function(){
  const main = $("main"); if (!main) return; let raf = 0;
  const upd = () => { raf = 0; const top = main.getBoundingClientRect().top;
    document.querySelectorAll(".sec").forEach(sec => { const r = sec.getBoundingClientRect(); sec.classList.toggle("stuck", !sec.classList.contains("collapsed") && r.top < top - 1 && r.bottom > top + 34); }); };
  main.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(upd); }, {passive:true});
})();
/* ---------- what's new (6.0): one card, once, after an update that changes how the screen reads ---------- */
const WHATS_NEW = {ver:"6.0.0", url:"https://github.com/awpmap/market-widget/blob/main/lab/CHANGES-6.0.0.md", title:"New in MW 6.0", items:[
  "<b>Dollars for one share, everywhere.</b> Next to every day's percent is the change for one share, like +$5.27 +2.59%: holdings, watchlist, market tiles, funds, the chart and alerts.",
  "<b>Two columns in Portfolio.</b> Per share is the price over its change. Position is your value over its change.",
  "<b>Hide amounts.</b> Click the eye next to your total, or press H. Prices and percents stay.",
  "<b>More to click.</b> A holding opens Position, Today, Trend, Company and News. A market tile opens its details. The bar under your total shows where the day's dollars came from."]};
function renderWhatsNew(){
  const el = $("whatsnew"); if (!el) return;
  const seen = store.get("seenVer", "");
  if (firstRun && !cameOver && !seen){ store.set("seenVer", WHATS_NEW.ver); return; }   // a brand-new setup has nothing to compare with
  if (seen && !newer(WHATS_NEW.ver, seen)){ el.classList.remove("show"); return; }
  el.innerHTML = `<b>${WHATS_NEW.title}</b><ul>${WHATS_NEW.items.map(t => `<li>${t}</li>`).join("")}</ul><button class="btn primary" data-wn="ok">Got it</button> <button class="lnk" data-wn="all" style="margin-left:8px">Everything that changed</button><button class="x" data-wn="ok" aria-label="Close">×</button>`;
  el.classList.add("show");
}
$("whatsnew").onclick = e => { const b = e.target.closest("[data-wn]"); if (!b) return;
  if (b.dataset.wn === "all"){ openExt(WHATS_NEW.url); return; }
  store.set("seenVer", WHATS_NEW.ver); $("whatsnew").classList.remove("show"); };
renderVersion(); setTimeout(()=>checkUpdates(), 4000); setInterval(()=>checkUpdates(), 60*60e3);   // am I on the latest version?
// every 30 s: keep the status light and "x min ago" honest, and re-check that MW can still see prices
// (this catches refreshes that stopped altogether, not just ones that came back empty)
setInterval(()=>{ safe("frame", renderFrame); safe("health", watchHealth); updateTray(); }, 30e3);
setInterval(()=>{ try{ renderPill(); }catch(e){} }, 10e3);   // keeps the countdown to the minute
addEventListener("resize", ()=>{ clearTimeout(applyLayout._r); applyLayout._r = setTimeout(()=>{ safe("layout", applyLayout); safe("news bar", nwFit); safe("strip", stripFit); safe("account headers", grpFit); }, 150); });
addEventListener("resize", ()=>{ clearTimeout(renderPill._r); renderPill._r = setTimeout(()=>{ try{ renderPill(); }catch(e){} }, 120); });

mwLog("info", "MW " + APP_VERSION + " started" + (NATIVE ? " in the desktop app" : " in the browser"));
safe("sentry", initSentry);
/* Arriving from "Try the beta" in MW: bring the regular setup over without asking again (the person just opted in).
   That button clears mw_betaOk, so a start without it is that arrival. Joining again later counts too: the regular
   MW's setup is the one in use by then, and the beta's earlier one stays in the list under Settings → Backup. */
let cameOver = false, hadOwn = false;
if (BETA && onBeta() && (firstRun || raw.get("mw_betaOk") == null) && liveSetup()) safe("beta setup", ()=>{
  const mine = JSON.stringify(cfg);
  if (!importFromLive(true)) return;
  cameOver = true; hadOwn = !firstRun && JSON.stringify(cfg) !== mine;
  mwLog("info", "beta: copied your MW setup " + (firstRun ? "on first start" : "on joining again"));
});
safe("what's new", renderWhatsNew);
renderAll(); safe("badge", updateBadge); safe("health", ()=>renderBlind());
if (hadOwn) toast("Copied your current setup from MW");
if (BETA && onBeta()) raw.set("mw_betaOk", String(Date.now()));   // tells MW the beta started, so it keeps opening it
idbFromBeta().then(loadBarsMem);
schedule(true);
fastSchedule();   // fast prices run on their own timer (5 s open, 15 s pre-market and after hours)
