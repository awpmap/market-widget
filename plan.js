/* Generated from lab/ by labdev/promote.mjs. Edit lab/ and promote again, not this file. */
"use strict";
/* =====================================================================
   Game plan (6.3): the trader's prep sheet for today.
   - Next up: the big events coming (Fed, CPI, jobs, PCE, GDP, retail sales, options expiration, earnings of your
     tickers) with a live countdown, and a bar of today's trading session with a "now" marker.
   - Key levels for your tickers (and SPY and QQQ): prior-day high/low/close, pre-market high/low, the opening
     range (first 5 and 15 minutes), today's VWAP, 20-day and 52-week high/low, on a small ladder with the nearest
     level above and below and a label when price is near a level or just broke one.
   - Calendar: the next 14 or 30 days, in your time zone.
   Runs on top of app.js (same page, same globals). Pure math and the official date table are in engine.js
   (PLAN region). Public build: no personal data here.

   Data, staying inside the free limits, and only while the section is open and in view (secLive):
   - Alpaca daily bars (IEX): one multi-ticker call per 25 tickers, once per session day, only for tickers MW's own
     Twelve Data history cannot already answer.
   - Alpaca 5-minute bars: one call at each phase (pre-market so far every 5 minutes before 9:30, pre-market done,
     first 5 minutes done, first 15 minutes done).
   - Alpaca snapshots (VWAP): one call per 100 tickers every 30 s while the market is open.
   - Earnings dates and 52-week ranges: what MW already loaded (earn, metrics). Nothing is fetched twice.
   Without an Alpaca key: prior day, 20-day and 52-week levels from MW's own history, and a note that the
   pre-market, opening range and VWAP need the free key.
   ===================================================================== */
(function(){
const PL_ALP = "https://data.alpaca.markets/";
const PL_MAX = 40;
const PL = {daily: store.get("planDaily", {prior:"", r:{}, at:0}), intra: store.get("planIntra", {date:"", ph:"", at:0, r:{}}),
  snap:{at:0, r:{}}, mem:{}, busy:{d:false, i:false, s:false}, err:{d:"", i:"", s:""}, errAt:{d:0, i:0, s:0}, tdc:{}, n:{d:0, i:0, s:0}, built:false, kickAt:0, sig:{}, memDay:""};
const plCfg = () => Object.assign({scope:"all", hot:false, days:14, open:{}}, settings.plan || {});
function plSet(k, v){ settings.plan = Object.assign(plCfg(), {[k]:v}); saveSettings(); plRender(); plKick(true); }
const plHdr = () => ({"APCA-API-KEY-ID":settings.alpKey, "APCA-API-SECRET-KEY":settings.alpSec});
const okSym = s => /^[A-Z][A-Z.]{0,6}$/.test(s) && !isFund(s);
const INDEX = ["SPY", "QQQ"];
function plSyms(){
  const sc = plCfg().scope, mine = mySyms().filter(okSym);
  const all = sc === "mine" ? mine : sc === "index" ? INDEX.slice() : [...new Set([...INDEX, ...mine])];
  return all;
}
const setH = (el, html) => { if (el && el.__h !== html){ el.__h = html; el.innerHTML = html; } };
const setT = (el, txt) => { if (el && el.__t !== txt){ el.__t = txt; el.textContent = txt; } };
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- data ---------- */
async function plGet(path, params){
  const r = await fetchT(PL_ALP + path + "?" + params, {headers:plHdr(), cache:"no-store"}, 20000);
  if (r.status === 401 || r.status === 403) throw new Error("Alpaca didn't accept the keys. Check them in Settings.");
  if (r.status === 429) throw new Error("Alpaca's free limit was reached for this minute");
  if (!r.ok) throw new Error("Alpaca answered " + r.status);
  return r.json();
}
/* daily bars (IEX): prior-day, 20-day and 52-week levels for tickers MW's own history cannot answer */
async function plFetchDaily(syms, prior){
  PL.busy.d = true; PL.n.d++;
  try{
    const start = addDays(prior, -380), acc = {};
    for (let i = 0; i < syms.length; i += 25){
      let tok = "", guard = 0;
      do {
        const j = await plGet("v2/stocks/bars", "feed=iex&timeframe=1Day&adjustment=split&limit=10000&start=" + start + "&symbols=" + syms.slice(i, i + 25).map(encodeURIComponent).join(",") + (tok ? "&page_token=" + encodeURIComponent(tok) : ""));
        Object.entries(j.bars || {}).forEach(([s, a]) => { (acc[s] || (acc[s] = [])).push(...a.map(b => [etDateOf(Date.parse(b.t)), +b.o, +b.h, +b.l, +b.c, +b.v || 0])); });
        tok = j.next_page_token || "";
      } while (tok && ++guard < 6);
    }
    const r = PL.daily.prior === prior ? Object.assign({}, PL.daily.r) : {};
    syms.forEach(s => { const bars = (acc[s] || []).sort((a, b) => b[0].localeCompare(a[0])); r[s] = E.planDaily(bars, prior) || {fresh:false, asOf:null}; });
    PL.daily = {prior, r, at:Date.now()}; store.set("planDaily", PL.daily); PL.err.d = "";
    mwLog("info", "game plan: daily levels for " + syms.length + " tickers");
  }catch(e){ PL.err.d = e.message; PL.errAt.d = Date.now(); mwLog("warn", "game plan daily bars: " + e.message); }
  finally{ PL.busy.d = false; }
}
/* 5-minute bars from 4:00 AM ET: pre-market and the opening range; every 5-minute bar's high and low are exact */
async function plFetchIntra(syms, ph, merge){
  PL.busy.i = true; PL.n.i++;
  try{
    const now = Date.now(), d = E.planSessionDay(now); if (!d) return;
    const acc = {}, endMs = etMs(d, 585), end = now > endMs ? "&end=" + new Date(endMs).toISOString() : "";
    for (let i = 0; i < syms.length; i += 100){
      const j = await plGet("v2/stocks/bars", "feed=iex&timeframe=5Min&limit=10000&start=" + new Date(etMs(d, 240)).toISOString() + end + "&symbols=" + syms.slice(i, i + 100).map(encodeURIComponent).join(","));
      Object.entries(j.bars || {}).forEach(([s, a]) => { (acc[s] || (acc[s] = [])).push(...a.map(b => ({t:Date.parse(b.t), h:+b.h, l:+b.l}))); });
    }
    const r = merge && PL.intra.date === d ? Object.assign({}, PL.intra.r) : {};
    syms.forEach(s => { r[s] = E.planIntraday(acc[s] || [], d, now); });
    PL.intra = merge && PL.intra.date === d ? Object.assign({}, PL.intra, {r}) : {date:d, ph, at:now, r};
    store.set("planIntra", PL.intra); PL.err.i = "";
  }catch(e){ PL.err.i = e.message; PL.errAt.i = Date.now(); mwLog("warn", "game plan 5-minute bars: " + e.message); }
  finally{ PL.busy.i = false; }
}
async function plFetchSnap(syms){
  PL.busy.s = true; PL.n.s++;
  try{
    const out = {}, today = etNow().date;
    for (let i = 0; i < syms.length; i += 100) Object.assign(out, await alpSnap(syms.slice(i, i + 100)));
    const r = {}; Object.keys(out).forEach(s => { const db = out[s] && out[s].dailyBar; if (db && db.vw > 0 && etDateOf(Date.parse(db.t)) === today) r[s] = {vw:+db.vw}; });
    PL.snap = {at:Date.now(), r}; PL.err.s = "";
  }catch(e){ PL.err.s = e.message; PL.errAt.s = Date.now(); PL.snap.at = Date.now(); }
  finally{ PL.busy.s = false; }
}
/* the tick: what is due, if anybody is looking. Nothing runs while the section is closed or hidden. */
function plTick(){
  if (!secLive("plan") || !alpOn()) return;
  const now = Date.now(), syms = plSyms().slice(0, PL_MAX); if (!syms.length) return;
  PL.kickAt = now;
  const prior = E.planPriorDay(now), calm = k => now - PL.errAt[k] > 2 * 60e3;
  if (!PL.busy.d && calm("d")){
    const need = syms.filter(s => !tdFresh(s, prior) && !(PL.daily.prior === prior && PL.daily.r[s]));
    if (need.length) plFetchDaily(need, prior).then(() => plRender());
  }
  const sd = E.planSessionDay(now);
  if (sd && !PL.busy.i && calm("i")){
    const due = E.planFetchDue(PL.intra, now), miss = PL.intra.date === sd ? syms.filter(s => !PL.intra.r[s]) : [];
    if (due) plFetchIntra(syms, due, false).then(() => plRender());
    else if (miss.length) plFetchIntra(miss, PL.intra.ph, true).then(() => plRender());
  }
  if (session().s === "open" && !PL.busy.s && calm("s") && now - PL.snap.at >= 30e3) plFetchSnap(syms).then(() => plRender());
}
function plKick(force){ if (!secLive("plan")) return; if (force || Date.now() - PL.kickAt > 10e3) setTimeout(plTick, 30); }

/* ---------- levels for one ticker ---------- */
function tdFresh(sym, prior){ const t = tdLevels(sym, prior); return !!(t && t.fresh); }
function tdLevels(sym, prior){
  const b = barsMem[sym]; if (!b || !b.length) return null;
  const key = prior + "|" + b.length + "|" + b[0][0], c = PL.tdc[sym];
  if (c && c.key === key) return c.v;
  const v = E.planDaily(b, prior); PL.tdc[sym] = {key, v}; return v;
}
function dailyFor(sym, prior){
  const t = tdLevels(sym, prior); if (t && t.fresh) return Object.assign({src:"td"}, t);
  const a = PL.daily.prior === prior ? PL.daily.r[sym] : null;
  if (a && a.fresh) return Object.assign({src:"alp"}, a);
  const x = t || a; return x ? Object.assign({src: t ? "td" : "alp"}, x) : null;
}
function plLevels(sym, now){
  now = now || Date.now();
  const prior = E.planPriorDay(now), sd = E.planSessionDay(now), q = quotes[sym], daily = dailyFor(sym, prior);
  const intra = sd && PL.intra.date === sd ? PL.intra.r[sym] || null : null;
  const snap = session().s === "open" && now - PL.snap.at < 5 * 60e3 ? PL.snap.r[sym] : null, m = metrics[sym];
  const L = E.planLevels({daily, intra, vwap:snap && snap.vw, m52: m && m.hi > 0 && m.lo > 0 ? {hi:m.hi, lo:m.lo} : null, pc: session().s === "open" && q && q.pc > 0 ? q.pc : null});
  return {L, daily, intra, vwap:!!snap};
}
/* what crossed what since the last look: remembered in this window only, shown for 30 minutes */
function plMem(sym, L, px, now){
  const day = etNow().date; if (PL.memDay !== day){ PL.mem = {}; PL.memDay = day; }
  const prev = PL.mem[sym], sides = E.planSides(L, px), fl = ((prev && prev.flips) || []).filter(f => now - f.t < 30 * 60e3);
  E.planFlips(prev, sides, now).forEach(f => { const i = fl.findIndex(x => x.k === f.k); if (i >= 0) fl.splice(i, 1); fl.push(f); });
  PL.mem[sym] = {sides, at:now, flips:fl};
  return fl;
}

/* ---------- events ---------- */
function plEarn(){
  const mine = new Set([...mySyms(), ...cfg.myMk]), out = [];
  new Set([...mine, ...BELLWETHERS]).forEach(sym => { const i = erInfo(sym); if (i) out.push({sym, d:i.d, hour:i.hour, mine:mine.has(sym)}); });
  return out;
}
const dayLbl = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {weekday:"short", month:"short", day:"numeric", timeZone:"UTC"});
const etTime = t => new Date(t).toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit", timeZone:ET_TZ}) + " ET";
const isFed = ev => ev.k === "fomc" || ev.k === "fomc1" || ev.k === "fomcs" || ev.k === "fomcmin";
function evName(ev){
  if (ev.k === "earn"){ const m = ev.syms.filter(s => s.mine), a = m.length ? m : ev.syms; return a[0].sym + (a.length > 1 ? " +" + (a.length - 1) : "") + " earnings"; }
  return ev.name;
}
function evWhen(ev){
  if (ev.k === "earn") return ev.hour === "bmo" ? "before open" : ev.hour === "amc" ? "after close" : "time not given";
  if (ev.k === "opex" || ev.k === "quad") return "at the close";
  if (ev.k === "early") return "closes " + timeStr(ev.t) + " " + tzAbbr(ev.t);
  if (ev.k === "holiday" || ev.k === "fomc1" || ev.k === "fomcs") return "all day";
  return timeStr(ev.t);
}
function evFull(ev){
  const L = [evName(ev) + (ev.ref && ev.k !== "earn" ? " · " + ev.ref : ""), dayLbl(ev.d) + (ev.timed ? " · " + etTime(ev.t) + (tzName() !== ET_TZ ? " = " + timeStr(ev.t) + " " + tzAbbr(ev.t) : "") : ""), ev.tip];
  if (ev.tentative) L.push("Date is tentative: the Fed confirms it at the meeting before.");
  if (ev.k === "earn") ev.syms.forEach(s => { const t = erTip(s.sym); if (t) L.push(s.sym + (s.mine ? "" : " (chip bellwether)") + ": " + t); });
  return L.join("\n");
}
function evLeft(ev, now){
  if (ev.k === "earn" || ev.k === "holiday" || ev.k === "fomc1" || ev.k === "fomcs") return ev.today ? "today" : E.planDayWord(ev.d, etNow().date);
  if (ev.past) return ev.timed && now - ev.t < 90 * 60e3 ? "just out" : "out";
  return (ev.today ? "in " : "in ") + E.planLeft(ev.t - now);
}
function plEvents(now){ const c = plCfg(); return E.planEvents(now, {days:c.days === 30 ? 30 : 14, earn:plEarn()}); }

function sumText(now){
  const L = E.planNextUp(E.planEvents(now, {days:30, earn:plEarn()}), now, 1), ev = L[0];
  if (!ev) return "";
  if (ev.k === "earn") return `${evName(ev)} ${ev.today ? "today" : E.planDayWord(ev.d, etNow().date)}`;
  if (ev.past) return `${ev.name} just out`;
  if (ev.today && (ev.k === "opex" || ev.k === "quad")) return `${ev.name} today`;
  return `${ev.name} ${ev.today ? "today " + timeStr(ev.t) : "in " + E.planLeft(ev.t - now)}`;
}
function cardHtml(ev, i, now){
  const fed = isFed(ev), left = evLeft(ev, now), who = ev.k === "earn" ? ev.syms.slice(0, 4).map(s => s.sym).join(", ") + (ev.syms.length > 4 ? " +" + (ev.syms.length - 4) : "") : ev.ref && ev.timed ? ev.ref : "";
  return `<div class="pl-nx${fed ? " fed" : ""}${ev.today ? " today" : ""}${i === 0 ? " first" : ""}" title="${esc(evFull(ev))}">
    <div class="pl-nx-t"><b>${esc(evName(ev))}</b>${ev.today ? `<i class="pl-bd now">TODAY</i>` : ""}${ev.tentative ? `<i class="pl-bd">tentative</i>` : ""}</div>
    <div class="pl-nx-c num">${esc(left)}</div>
    <div class="pl-nx-w">${esc(dayLbl(ev.d))} · ${esc(evWhen(ev))}${ev.timed ? " " + esc(tzAbbr(ev.t)) : ""}${who ? `<br><span class="muted">${esc(who)}</span>` : ""}</div></div>`;
}
function listHtml(events, now){
  const today = etNow().date; let html = "", cur = "";
  events.forEach(ev => {
    if (ev.d !== cur){ cur = ev.d; html += `<div class="pl-dh${ev.d === today ? " today" : ""}">${ev.d === today || ev.d === E.addDays(today, 1) ? `<b>${ev.d === today ? "Today" : "Tomorrow"}</b> <span>${esc(dayLbl(ev.d))}</span>` : `<b>${esc(dayLbl(ev.d))}</b>`}</div>`; }
    const fed = isFed(ev), left = evLeft(ev, now);
    const name = ev.k === "earn"
      ? `<b>Earnings</b> <small>${esc(ev.ref)}</small><div class="pl-sy">${ev.syms.map(s => `<span class="pl-sym${s.mine ? " mine" : ""}" title="${esc(s.sym + (s.mine ? "" : " (chip bellwether)") + ": " + (erTip(s.sym) || ""))}">${esc(s.sym)}</span>`).join("")}</div>`
      : `<b>${esc(ev.name)}</b>${ev.ref ? ` <small>${esc(ev.ref)}</small>` : ""}`;
    html += `<div class="pl-er ${ev.k}${fed ? " fed" : ""}${ev.big >= 3 ? " big" : ""}${ev.past ? " past" : ""}${ev.today ? " today" : ""}" title="${esc(ev.k === "earn" ? ev.tip : evFull(ev))}">
      <span class="pl-et num">${esc(evWhen(ev))}</span><span class="pl-en">${name}</span>
      <span class="pl-eb">${ev.today ? `<i class="pl-bd now">TODAY</i>` : ""}${ev.sep ? `<i class="pl-bd" title="This meeting also brings new projections (the dot plot).">projections</i>` : ""}${ev.tentative ? `<i class="pl-bd">tentative</i>` : ""}${fed && !ev.today ? `<i class="pl-bd fed">FED</i>` : ""}</span>
      <span class="pl-el num">${esc(left)}</span></div>`;
  });
  return html || `<p class="note">Nothing scheduled in this window.</p>`;
}
function coverageHtml(now, days){
  const c = E.planCoverage(now, days);
  const L = c.map(x => x.k === "fomcmin" ? "FOMC minutes (the Fed has not posted the date yet)" : `${x.name} (published through ${new Date(x.through + "T12:00:00Z").toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric", timeZone:"UTC"})})`);
  const src = Object.values(E.PLAN_SOURCES).filter(s => s.url).map(s => s.name + ": " + s.url + (s.note ? " (" + s.note + ")" : "")).join("\n");
  return (L.length ? `<p class="note">Not published yet, so not listed: ${esc(L.join("; "))}.</p>` : "") +
    `<p class="note" title="${esc("Release dates are copied from the publishers' own schedules, read " + E.PLAN_CHECKED + ":\n" + src + "\nOptions expiration is the third Friday (the Thursday before when that is a market holiday). Times are New York time, shown in your time zone.")}">Dates from the Fed, BLS, BEA and Census release schedules (read ${esc(E.PLAN_CHECKED)}). Times in ${esc(tzAbbr())}.</p>`;
}

/* ---------- the trading day as a bar ---------- */
function timelineHtml(now, events){
  const p = E.etParts(now), d = p.date, mc = marketClock(now);
  const over = E.OVERNIGHT_FROM > now ? `<p class="note">Nasdaq's overnight session is planned from ${esc(new Date(E.OVERNIGHT_FROM).toLocaleString("en-US", {weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit", timeZone:ET_TZ}))} ET (subject to SEC approval).</p>` : "";
  if (!E.isTradingDay(d)) return `<div class="pl-tlc">${esc(mc.label)}${mc.until ? ` · ${esc(mc.untilWhat)} in ${esc(fmtLeft(mc.until - now))}` : ""}</div>${over}`;
  const T = E.planTimeline(d), W = T.end - T.start, pos = m => ((m - T.start) / W * 100).toFixed(2);
  const short = {pre:"Pre", open:"Open", morn:"AM", lunch:"Lunch", aft:"PM", power:"Power", after:"After"};
  const segs = T.segs.map(s => `<i class="pl-sg ${s.k}" style="flex:${s.to - s.from}" title="${esc(s.name + ": " + s.tip)}">${esc(short[s.k] || s.name)}</i>`).join("");
  const pins = events.filter(e => e.d === d && e.timed && e.mins >= T.start && e.mins < T.end).map(e => `<u class="pl-pin${isFed(e) ? " fed" : ""}${e.past ? " past" : ""}" style="left:${pos(e.mins)}%" title="${esc(e.name + " " + evWhen(e) + " " + tzAbbr(e.t) + (e.ref ? " · " + e.ref : ""))}"></u>`).join("");
  const m = p.mins, inside = m >= T.start && m < T.end;
  return `<div class="pl-tlb"><div class="pl-segs">${segs}</div>${pins}${inside ? `<b class="pl-nowm" style="left:${pos(m)}%" title="Now: ${esc(timeStr(now) + " " + tzAbbr(now))}"></b>` : ""}</div>
    <div class="pl-tlc">${esc(mc.label)}${mc.until ? ` · ${esc(mc.untilWhat)} in ${esc(fmtLeft(mc.until - now))}` : ""}${mc.early ? " · early close today" : ""}</div>${over}`;
}

/* ---------- key levels ---------- */
function ladderHtml(lad, px){
  const T = lad.ticks; if (!T.length || !(px > 0)) return {ticks:"", pos:null};
  const below = T.filter(t => t.v < px).slice(-3), above = T.filter(t => t.v > px).slice(0, 3), pick = below.concat(above);
  if (!pick.length) return {ticks:"", pos:null};
  let lo = Math.min(px, ...pick.map(t => t.v)), hi = Math.max(px, ...pick.map(t => t.v));
  if (!(hi > lo)){ lo *= 0.995; hi *= 1.005; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const at = v => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  const html = pick.map(t => { const lv = E.PLAN_LV[t.ks[0]];
    return `<i class="pl-t ${lv.g}" style="left:${at(t.v).toFixed(1)}%" title="${esc(t.ks.map(k => E.PLAN_LV[k].s).join(" · ") + " " + fmtPx(t.v) + " (" + chgTxt(t.usd, t.pct, 2, px) + ")")}"></i>`; }).join("");
  return {ticks:html, pos:at(px)};
}
const nearTxt = (t, px) => `${esc(t.ks.map(k => E.PLAN_LV[k].s).join(" · "))} <b>${fmtPx(t.v)}</b> <span class="${cls(t.usd)}">${esc(chgTxt(t.usd, t.pct, 2, px))}</span>`;
function fullHtml(lad, px, d){
  const rows = lad.ticks.slice().reverse().map(t => `<div class="pl-lr ${t.v > px ? "ab" : "bl"}" title="${esc(t.ks.map(k => cap1(E.PLAN_LV[k].n) + ": " + E.PLAN_LV[k].tip).join("\n"))}"><span class="pl-ln">${esc(t.ks.map(k => cap1(E.PLAN_LV[k].n)).join(" · "))}</span><span class="num">${fmtPx(t.v)}</span><span class="num ${cls(t.usd)}">${esc(chgTxt(t.usd, t.pct, 2, px))}</span></div>`);
  const i = lad.ticks.slice().reverse().findIndex(t => t.v < px); rows.splice(i < 0 ? rows.length : i, 0, `<div class="pl-lr pl-now"><span class="pl-ln">Price now</span><span class="num">${fmtPx(px)}</span><span></span></div>`);
  const src = d ? (d.src === "td" ? "Prior-day, 20-day and 52-week levels: Twelve Data daily history (all exchanges)." : "Prior-day and 20-day levels: Alpaca daily bars from IEX, one exchange, so they can differ from the full-market high and low by a few cents.") : "";
  return rows.join("") + (src ? `<p class="note">${esc(src)}</p>` : "");
}
function rowModel(sym, now, cfg0){
  const q = quotes[sym], px = lastPx(sym), lv = plLevels(sym, now), L = lv.L;
  if (!(px > 0)) return {sym, px:null, empty:"Waiting for a price"};
  const fl = plMem(sym, L, px, now), s = session().s, intra = lv.intra || {};
  const chips = E.planChips(L, px, {open:s === "open", or5Done:!!intra.or5Done, or15Done:!!intra.or15Done, pmDone:!!intra.pmDone, flips:fl, now, near:0.5}).slice(0, 4);
  const lad = E.planLadder(L, px, 0.5), hot = chips.some(c => c.fresh || /^Near /.test(c.text));
  return {sym, q, px, L, lad, chips, hot, lv, n:Object.keys(L).length};
}
function updRow(el, m, open){
  const $ = s => el.querySelector(s);
  el.classList.toggle("hot", !!m.hot); el.classList.toggle("open", !!open);
  if (!m.px){ setH($(".pl-px"), ""); setH($(".pl-ch"), ""); setH($(".pl-chips"), `<span class="muted">${esc(m.empty)}</span>`); setH($(".pl-ticks"), ""); $(".pl-lad").hidden = true; setH($(".pl-dn"), ""); setH($(".pl-up"), ""); setH($(".pl-ex"), ""); return; }
  const q = m.q, d1 = chgOf(q), ext = extFor(m.sym);
  setH($(".pl-px"), (ext ? extTag(ext) : "") + fmtPx(m.px));
  setH($(".pl-ch"), q ? dchg(d1, q.dp, {px:q.c, sm:true}) : "");
  setH($(".pl-chips"), m.chips.map(c => `<span class="pl-c ${c.tone}${c.fresh ? " fresh" : ""}" title="${esc(c.tip)}">${esc(c.text)}</span>`).join("") || (m.n ? "" : `<span class="muted" title="Levels need price history: add a free Alpaca key (Settings → General), or a Twelve Data key for daily history.">No levels yet</span>`));
  const lh = ladderHtml(m.lad, m.px); $(".pl-lad").hidden = !lh.ticks;
  setH($(".pl-ticks"), lh.ticks); if (lh.pos != null){ const p = $(".pl-p"), v = lh.pos.toFixed(1) + "%"; if (p.__l !== v){ p.__l = v; p.style.left = v; } }
  const lines = m.lad.ticks.slice().reverse().map(t => `${t.ks.map(k => E.PLAN_LV[k].s).join(" · ")} ${fmtPx(t.v)} (${chgTxt(t.usd, t.pct, 2, m.px)})`).join("\n");
  $(".pl-lad").title = lines ? "Levels around " + fmtPx(m.px) + ":\n" + lines : "";
  const up = m.lad.up, dn = m.lad.dn;
  setH($(".pl-dn"), dn ? `<i>▼</i> ${nearTxt(dn, m.px)}` : `<span class="muted">nothing below</span>`);
  setH($(".pl-up"), up ? `<i>▲</i> ${nearTxt(up, m.px)}` : `<span class="muted">nothing above</span>`);
  $(".pl-dn").title = dn ? E.PLAN_LV[dn.ks[0]].tip : ""; $(".pl-up").title = up ? E.PLAN_LV[up.ks[0]].tip : "";
  setH($(".pl-ex"), open ? fullHtml(m.lad, m.px, m.lv.daily) : "");
}
function mkRow(sym){
  const el = document.createElement("div"); el.className = "pl-row"; el.dataset.k = sym;
  el.innerHTML = `<button class="pl-hd" data-pl-open="${esc(sym)}" aria-expanded="false" title="Show every level for ${esc(sym)}"><b class="pl-tk">${esc(sym)}</b><span class="pl-px num"></span><span class="pl-ch"></span><svg class="pl-cv" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>
    <div class="pl-chips"></div><div class="pl-lad" hidden><span class="pl-ticks"></span><b class="pl-p"></b></div>
    <div class="pl-nx2 num"><span class="pl-dn"></span><span class="pl-up"></span></div><div class="pl-ex num"></div>`;
  return el;
}
function levelsStatus(syms, now){
  const alp = alpOn(), prior = E.planPriorDay(now), sd = E.planSessionDay(now), L = [];
  const covered = syms.filter(s => { const l = plLevels(s, now); return l.daily && l.daily.fresh; }).length;
  let t = `Levels from ${dayLbl(prior)}'s session`;
  if (!alp) L.push(`<span class="pl-warn">Pre-market, opening-range and VWAP levels need the free Alpaca key (Settings → General).</span>`);
  else if (PL.err.d || PL.err.i || PL.err.s) L.push(`<span class="pl-warn">⚠ ${esc(PL.err.d || PL.err.i || PL.err.s)}</span>`);
  else if (sd){ const ph = E.planPhase(now).ph; L.push(ph === "pre" ? "Pre-market high and low so far; the opening range comes after 9:35 and 9:45 AM ET." : PL.intra.date === sd && PL.intra.at ? `Pre-market and opening range from Alpaca IEX, updated ${timeStr(PL.intra.at)}.` : "Loading pre-market and opening-range levels…"); }
  else if (E.isTradingDay(etNow().date)) L.push("Pre-market and opening-range levels start at 4:00 AM ET.");
  else L.push("The market is closed: prior-day, 20-day and 52-week levels. Pre-market and opening-range levels return with the next session.");
  if (syms.length && covered < syms.length && (alp || settings.tdKey)) L.push(`<span class="muted">${covered} of ${syms.length} have prior-day levels${PL.busy.d ? " (loading…)" : ""}.</span>`);
  return `<span>${esc(t)}.</span> ` + L.join(" ");
}

/* ---------- build and paint ---------- */
const PL_CSS = `
.pl{container-type:inline-size;container-name:pl;display:flex;flex-direction:column;gap:10px}
.pl-hh{font-size:10.5px;font-weight:650;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);margin:2px 0 6px}
.pl-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px}
.pl-nx{background:var(--surface-2);border-radius:var(--r-sm);padding:7px 9px;border:1px solid transparent;min-width:0}
.pl-nx.first{border-color:var(--line-2)}
.pl-nx.today{border-color:color-mix(in srgb,var(--accent) 55%,transparent);background:color-mix(in srgb,var(--accent) 9%,var(--surface-2))}
.pl-nx.fed{border-left:3px solid var(--warn)}
.pl-nx.fed.today{background:color-mix(in srgb,var(--warn) 13%,var(--surface-2));border-color:var(--warn)}
.pl-nx-t{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:12px;line-height:1.25}
.pl-nx-t b{font-weight:650}
.pl-nx-c{font-size:16px;font-weight:650;margin:2px 0 1px;letter-spacing:-.1px;white-space:nowrap}
.pl-nx.first .pl-nx-c{color:var(--accent)} .pl-nx.fed .pl-nx-c{color:var(--warn)}
.pl-nx-w{font-size:10.5px;color:var(--fg-2);line-height:1.35}
.pl-bd{font-style:normal;font-size:9px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;border-radius:6px;padding:1px 5px;background:var(--surface);color:var(--fg-2);white-space:nowrap}
.pl-bd.now{background:var(--accent);color:var(--accent-fg)} .pl-bd.fed{background:color-mix(in srgb,var(--warn) 22%,var(--surface));color:var(--warn)}
.pl-tlb{position:relative;margin-top:2px;padding:9px 0 0}
.pl-segs{display:flex;gap:2px;height:16px}
.pl-sg{flex:1 1 0;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:clip;font-style:normal;font-size:9px;line-height:16px;text-align:center;color:var(--muted);background:var(--surface-2);border-radius:3px}
.pl-sg.open,.pl-sg.power{color:var(--fg-2);background:color-mix(in srgb,var(--accent) 14%,var(--surface-2))}
.pl-sg.pre,.pl-sg.after{background:color-mix(in srgb,var(--muted) 10%,var(--surface-2))}
.pl-nowm{position:absolute;top:2px;bottom:-2px;width:2px;margin-left:-1px;background:var(--accent);border-radius:1px}
.pl-nowm::before{content:"";position:absolute;top:-2px;left:-2px;width:6px;height:6px;border-radius:50%;background:var(--accent)}
.pl-pin{position:absolute;top:0;width:7px;height:7px;margin-left:-3px;border-radius:50%;background:var(--fg-2);text-decoration:none}
.pl-pin.fed{background:var(--warn)} .pl-pin.past{opacity:.4}
.pl-tlc{font-size:11px;color:var(--fg-2);margin-top:4px}
.pl-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
@container pl (min-width:720px){ .pl-cols{grid-template-columns:minmax(0,1.5fr) minmax(280px,1fr);align-items:start} }
.pl-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.pl-bar>b{font-size:10.5px;font-weight:650;letter-spacing:.4px;text-transform:uppercase;color:var(--muted)}
.pl-bar .sp{flex:1}
.pl-hot{font-size:11px;padding:3px 9px;border-radius:8px;background:var(--surface-2);color:var(--fg-2)}
.pl-hot.on{background:color-mix(in srgb,var(--warn) 20%,var(--surface-2));color:var(--fg)}
.pl-st{font-size:11px;color:var(--fg-2);margin:0 0 6px;line-height:1.4}
.pl-warn{color:var(--warn)}
.pl-rows{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:6px}
.pl-row{background:var(--surface-2);border-radius:var(--r-sm);padding:6px 9px 7px;border-left:3px solid transparent;min-width:0}
.pl-row.hot{border-left-color:var(--warn)}
.pl-hd{display:flex;align-items:baseline;gap:8px;width:100%;text-align:left;padding:0;color:var(--fg);border-radius:5px}
.pl-hd:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.pl-tk{font-weight:650;min-width:44px}
.pl-px{font-size:13px}
.pl-ch{margin-left:auto}
.pl-cv{width:12px;height:12px;flex:none;color:var(--muted);align-self:center;transition:transform .12s}
.pl-row.open .pl-cv{transform:rotate(180deg)}
.pl-chips{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 0;min-height:17px;font-size:11px}
.pl-c{font-size:10.5px;line-height:1.3;border-radius:9px;padding:1px 7px;background:var(--surface);color:var(--fg-2);white-space:nowrap}
.pl-c.up{color:var(--up);background:color-mix(in srgb,var(--up) 13%,var(--surface))}
.pl-c.down{color:var(--down);background:color-mix(in srgb,var(--down) 13%,var(--surface))}
.pl-c.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 15%,var(--surface))}
.pl-c.fresh::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;margin-right:5px;vertical-align:0;animation:pl-pulse 1.6s ease-in-out infinite}
@keyframes pl-pulse{50%{opacity:.3}}
@media (prefers-reduced-motion:reduce){.pl-c.fresh::before{animation:none}}
.pl-lad{position:relative;height:16px;margin:5px 3px 3px}
.pl-lad::before{content:"";position:absolute;left:0;right:0;top:7px;height:2px;border-radius:1px;background:var(--line-2)}
.pl-t{position:absolute;top:2px;width:3px;height:12px;margin-left:-1px;border-radius:1.5px;background:var(--muted)}
.pl-t.pd{background:var(--fg-2)} .pl-t.pm{background:var(--warn)} .pl-t.or{background:var(--accent)} .pl-t.vw{background:color-mix(in srgb,var(--accent) 55%,var(--up))} .pl-t.lng{background:var(--muted);opacity:.8}
.pl-p{position:absolute;top:3px;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:var(--fg);box-shadow:0 0 0 2px var(--surface-2)}
.pl-nx2{display:flex;flex-direction:column-reverse;gap:1px;font-size:11px;color:var(--fg-2)}
.pl-nx2>span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pl-nx2 i{font-style:normal;color:var(--muted);font-size:9px}
.pl-nx2 b{font-weight:600;color:var(--fg)}
.pl-ex{margin-top:6px;border-top:1px dashed var(--line-2);padding-top:5px}
.pl-ex:empty{display:none}
.pl-lr{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;font-size:11px;padding:2px 0;color:var(--fg-2)}
.pl-lr .pl-ln{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pl-lr.pl-now{color:var(--fg);font-weight:650;background:color-mix(in srgb,var(--accent) 12%,transparent);border-radius:4px;padding:2px 4px;margin:1px -4px}
.pl-dh{display:flex;align-items:baseline;gap:7px;font-size:11px;margin:9px 0 3px;color:var(--muted)}
.pl-dh:first-child{margin-top:0}
.pl-dh b{color:var(--fg-2);font-size:11.5px} .pl-dh.today b{color:var(--accent)}
.pl-er{display:grid;grid-template-columns:76px minmax(0,1fr) auto auto;align-items:baseline;gap:4px 8px;padding:5px 7px;border-radius:7px;font-size:12px;border-left:3px solid transparent}
.pl-er:nth-child(odd){background:color-mix(in srgb,var(--surface-2) 55%,transparent)}
.pl-er.past{opacity:.55}
.pl-er.big .pl-en b{font-weight:700}
.pl-er.fed{border-left-color:var(--warn);background:color-mix(in srgb,var(--warn) 9%,var(--surface-2))}
.pl-er.fed.today{background:color-mix(in srgb,var(--warn) 17%,var(--surface-2))}
.pl-er.holiday,.pl-er.early{color:var(--muted)}
.pl-et{font-size:11px;color:var(--fg-2);white-space:nowrap}
.pl-en small{color:var(--muted);font-size:10.5px}
.pl-eb{display:inline-flex;gap:3px;justify-content:flex-end}
.pl-el{font-size:11px;color:var(--fg-2);text-align:right;white-space:nowrap;min-width:64px}
.pl-sy{display:flex;flex-wrap:wrap;gap:3px;margin-top:3px}
.pl-sym{font-size:10.5px;padding:0 6px;border-radius:8px;background:var(--surface);color:var(--muted)}
.pl-sym.mine{color:var(--fg);font-weight:650;background:color-mix(in srgb,var(--accent) 16%,var(--surface))}
@container pl (max-width:420px){
  .pl-er{grid-template-columns:62px minmax(0,1fr) auto;grid-template-areas:"t n l" "t b b"}
  .pl-et{grid-area:t} .pl-en{grid-area:n} .pl-el{grid-area:l} .pl-eb{grid-area:b;justify-content:flex-start}
  .pl-eb:empty{display:none}
  .pl-rows{grid-template-columns:minmax(0,1fr)}
}
.pl-sum b{color:var(--accent)}
`;
function plBuild(body){
  if (!document.getElementById("pl-css")){ const s = document.createElement("style"); s.id = "pl-css"; s.textContent = PL_CSS; document.head.appendChild(s); }
  body.innerHTML = `<div class="pl" id="pl-root">
    <div class="pl-top"><div class="pl-hh">Next up</div><div class="pl-cards" id="pl-cards"></div></div>
    <div class="pl-tl" id="pl-tl"></div>
    <div class="pl-cols">
      <div class="pl-lv"><div class="pl-bar"><b>Key levels</b><span id="pl-sc"></span><span class="sp"></span><button class="pl-hot" id="pl-hotb" data-pl-hot="1" title="Show only tickers within 0.5% of a level or that just crossed one">Needs a look</button></div>
        <div class="pl-st" id="pl-st"></div><div class="pl-rows" id="pl-rows"></div><p class="note" id="pl-more"></p></div>
      <div class="pl-ev"><div class="pl-bar"><b>Calendar</b><span class="sp"></span><span id="pl-dy"></span></div><div id="pl-list"></div><div id="pl-cov"></div></div>
    </div></div>`;
  body.addEventListener("click", e => {
    const sc = e.target.closest("[data-pl-sc]"); if (sc){ plSet("scope", sc.dataset.plSc); return; }
    const dy = e.target.closest("[data-pl-days]"); if (dy){ plSet("days", +dy.dataset.plDays); return; }
    if (e.target.closest("[data-pl-hot]")){ plSet("hot", !plCfg().hot); return; }
    const op = e.target.closest("[data-pl-open]"); if (op){ const o = Object.assign({}, plCfg().open); const s = op.dataset.plOpen; if (o[s]) delete o[s]; else o[s] = 1; plSet("open", o); }
  });
  PL.built = true;
}
const seg = (attr, opts, cur) => `<div class="seg">${opts.map(([v, l, tip]) => `<button ${attr}="${v}" class="${String(cur) === String(v) ? "on" : ""}" title="${esc(tip)}">${esc(l)}</button>`).join("")}</div>`;

function plRender(){
  const now = Date.now(), sum = $("plan-sum"), body = $("plan-body");
  if (!sum || !body) return;
  setT(sum, sumText(now));
  if (settings.collapsed.plan || settings.compact || (settings.hideSec || {}).plan) return;
  if (!PL.built) plBuild(body);
  const c = plCfg(), events = plEvents(now);
  // next up + the day's bar
  const nx = E.planNextUp(E.planEvents(now, {days:30, earn:plEarn()}), now, 4);
  setH($("pl-cards"), nx.map((ev, i) => cardHtml(ev, i, now)).join("") || `<p class="note">No big events in the next 30 days.</p>`);
  setH($("pl-tl"), timelineHtml(now, events));
  // key levels
  const all = plSyms(), syms = all.slice(0, PL_MAX), mineN = mySyms().filter(okSym).length;
  setH($("pl-sc"), seg("data-pl-sc", [["mine", "Mine" + (mineN ? " " + mineN : ""), "Your holdings and watchlist"], ["index", "Index", "SPY and QQQ"], ["all", "All", "Your tickers, SPY and QQQ"]], c.scope));
  const hb = $("pl-hotb"); hb.classList.toggle("on", !!c.hot); hb.setAttribute("aria-pressed", String(!!c.hot));
  setH($("pl-st"), levelsStatus(syms, now));
  const box = $("pl-rows"), models = syms.map(s => rowModel(s, now, c)), shown = c.hot ? models.filter(m => m.hot) : models;
  const have = new Map([...box.children].filter(el => el.dataset && el.dataset.k).map(el => [el.dataset.k, el]));
  let prev = null;
  shown.forEach(m => { let el = have.get(m.sym); if (!el) el = mkRow(m.sym); have.delete(m.sym);
    const want = prev ? prev.nextSibling : box.firstChild; if (el !== want) box.insertBefore(el, want);
    updRow(el, m, !!c.open[m.sym]); prev = el; el.querySelector(".pl-hd").setAttribute("aria-expanded", String(!!c.open[m.sym])); });
  have.forEach(el => el.remove());
  setT($("pl-more"), !syms.length ? (c.scope === "mine" ? "No tickers yet: add holdings or a watchlist in Settings." : "") : c.hot && !shown.length ? "Nothing is within 0.5% of a level or just crossed one." : all.length > PL_MAX ? `Showing the first ${PL_MAX} of ${all.length} tickers.` : "");
  // calendar
  setH($("pl-dy"), seg("data-pl-days", [[14, "14 days", "Everything in the next 14 days"], [30, "30 days", "Everything in the next 30 days"]], c.days === 30 ? 30 : 14));
  setH($("pl-list"), listHtml(events, now) + (earn && earn.map && Object.keys(earn.map).length ? "" : `<p class="note">Earnings dates load with a free Finnhub key (Settings → General).</p>`));
  setH($("pl-cov"), coverageHtml(now, c.days === 30 ? 30 : 14));
  plKick();
}
function plStart(){
  // first time only: start closed, so nothing is fetched until you open it
  if (!settings.planInit){ settings.planInit = 1; settings.collapsed = Object.assign({}, settings.collapsed, {plan:true}); saveSettings(); }
  registerSection({key:"plan", name:"Game plan", sumClass:"num pl-sum", render:plRender});
  setInterval(() => { if (document.visibilityState !== "hidden") plRender(); }, 20e3);
  setInterval(plTick, 10e3);
  const hdr = document.querySelector('[data-toggle="plan"]'); if (hdr) hdr.addEventListener("click", () => setTimeout(() => { plRender(); plKick(true); }, 50));
}
plStart();
/* how many times this section has asked Alpaca (for the browser harness) */
window.mwPlanCalls = () => Object.assign({}, PL.n);
})();
