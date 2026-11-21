/* Generated from lab/ by labdev/promote.mjs. Edit lab/ and promote again, not this file. */
"use strict";
/* =====================================================================
   Market map (6.1): about 200 funds in eleven panels (US, sectors, international, large/mid/small caps, global
   themes, fixed income, commodities, crypto, strategy), drawn as nested treemaps. Tile area follows the fund's size
   (or today's dollar volume, or equal), color follows the change over the chosen time frame.
   Runs on top of app.js (same page, same globals). Public build: no personal data here; the fund list and the
   rough fund sizes live in engine.js (E.MAP_SRC).

   Data, staying inside the free limits:
   - With an Alpaca key: every fund in 3 calls (100 tickers each) every 15 s while the map is open in market
     hours, pre-market and after hours; every 10 minutes while the market is closed. The longer time frames come
     from Alpaca daily bars, about 6 calls once a day, and only once you pick 5D or longer.
   - Without one: Finnhub, one fund every 3 s (about 20 a minute, under MW's own 40-a-minute background cap),
     biggest funds first, then whichever is oldest. Nothing is fetched while the map is closed.
   - Spot coins: Alpaca's crypto feed, which needs no key, every 30 s.
   ===================================================================== */
const MAP = {U: E.mapUniverse(), open:false, q: store.get("mapq", {}), refs: store.get("mapRefs", {date:"", r:{}}),
  sel:"", find:"", timer:null, paintT:null, busy:false, st:{at:0, err:"", n:0, ms:0, cAt:0, cErr:""}, fhBusy:false,
  laidKey:"", tiles:new Map(), savedAt:0, refBusy:false, showPanels:false, last:{}};
MAP.all = MAP.U.flatMap(p => p.groups.flatMap(g => g.items.map(it => Object.assign(it, {panel:p.k, ptitle:p.title, group:g.name}))));
MAP.by = Object.fromEntries(MAP.all.map(i => [i.sym, i]));
const MAP_PERIODS = ["1D", "5D", "1M", "3M", "YTD", "1Y"];
const MAP_CAP = {"1D":3, "5D":6, "1M":10, "3M":15, "YTD":25, "1Y":35, ext:2};
const MAP_PER_WORD = {"1D":"today", "5D":"over 5 days", "1M":"over 1 month", "3M":"over 3 months", "YTD":"this year", "1Y":"over 1 year"};
const ALP_BASE = "https://data.alpaca.markets/";
const mapCfg = () => Object.assign({per:"1D", size:"aum", mode:"auto", hide:{}}, settings.map || {});
function mapSet(k, v){ settings.map = Object.assign(mapCfg(), {[k]:v}); saveSettings(); }
const mapHidden = k => !!mapCfg().hide[k];
const alpHdr = () => settings.alpKey && settings.alpSec ? {"APCA-API-KEY-ID":settings.alpKey, "APCA-API-SECRET-KEY":settings.alpSec} : {};
function mapSave(force){ const now = Date.now(); if (!force && now - MAP.savedAt < 60e3) return; MAP.savedAt = now; store.set("mapq", MAP.q); }

/* ---------- which price a tile shows ---------- */
/* the map's own quote, unless MW's regular feed has a newer one for the same session (tickers you already track) */
function mapQuote(sym){
  const a = MAP.q[sym], b = quotes[sym], it = MAP.by[sym];
  if (!it || it.crypto || !b || !(b.c > 0) || !b.at) return a || null;
  const bDay = E.quoteDay(b.t ? b.t * 1000 : b.at);
  if (a && (a.at || 0) >= b.at) return a;
  if (a && a.day && bDay && bDay < a.day) return a;
  const x = extFor(sym);
  return {c:b.c, pc:b.pc, dp:b.dp, h:b.h, l:b.l, o:b.o, dv: a && a.day === bDay ? a.dv : 0, t: b.t ? b.t * 1000 : 0, day:bDay, at:b.at, src:b.src || "finnhub",
    ext: x ? {p:x.p, pct:x.pct, ph:x.ph, t:x.t} : a && a.day === bDay ? a.ext : null, quiet:false};
}
/* Day, or Since close (the latest pre-market or after-hours trade against the regular close). Auto: Since close
   in pre-market, when the day's change is still yesterday's; Day the rest of the time. */
function mapMode(){
  const m = mapCfg().mode; if (m === "day" || m === "ext") return m;
  const s = session().s; return s === "ext" && etNow().mins < 570 && alpOn() ? "ext" : "day";
}
function mapVal(it){
  const per = mapCfg().per, mode = mapMode(), q = mapQuote(it.sym);
  if (!q || !(q.c > 0)) return {pct:null, q:null};
  if (mode === "ext" && !it.crypto){
    return q.ext ? {pct:q.ext.pct, usd:q.ext.p - q.c, px:q.ext.p, q, ext:true} : {pct:null, q, noExt:true};
  }
  if (per === "1D") return {pct:q.dp, usd: q.pc > 0 ? q.c - q.pc : null, px:q.c, q};
  const r = MAP.refs.r[it.sym] && MAP.refs.r[it.sym][per];
  let ref = r ? r[1] : null;
  if (!(ref > 0) && !it.crypto){ const h = hist[it.sym], hr = h && h.refs && h.refs[per]; if (hr && hr.c > 0) ref = hr.c; }
  if (!(ref > 0)) return {pct:null, q, noRef:true};
  return {pct:(q.c / ref - 1) * 100, usd:q.c - ref, px:q.c, q, ref, refD: r ? r[0] : null};
}
function mapColor(p, cap){
  if (p == null || !isFinite(p)) return "var(--surface-2)";
  if (Math.abs(p) < 0.005) return "color-mix(in srgb, var(--muted) 18%, var(--surface-2))";
  const a = Math.pow(Math.min(1, Math.abs(p) / cap), 0.8), pct = Math.round(16 + a * 62);
  return `color-mix(in srgb, ${p > 0 ? "var(--up)" : "var(--down)"} ${pct}%, var(--surface-2))`;
}

/* ---------- data ---------- */
async function mapAlpaca(){
  const syms = MAP.all.filter(i => !i.crypto && !mapHidden(i.panel)).map(i => i.sym), out = {}, t0 = Date.now();
  try{
    for (let i = 0; i < syms.length; i += 100) Object.assign(out, await alpSnap(syms.slice(i, i + 100)));
    const now = Date.now(); let n = 0;
    Object.keys(out).forEach(s => { const v = E.mapSnap(out[s], now); if (v){ v.at = now; MAP.q[s] = v; n++; } });
    Object.assign(MAP.st, {at:now, err:"", n, ms:now - t0, src:"alpaca"});
    mapSave();
  }catch(e){ MAP.st.err = e.message; MAP.st.at = Date.now(); mwLog("warn", "market map: " + e.message); }
}
async function mapCrypto(){
  const syms = MAP.all.filter(i => i.crypto).map(i => i.sym); if (!syms.length || mapHidden("crypto")) return;
  MAP.st.cAt = Date.now();
  try{
    const r = await fetchT(ALP_BASE + "v1beta3/crypto/us/snapshots?symbols=" + syms.map(encodeURIComponent).join(","), {headers:alpHdr(), cache:"no-store"}, 8000);
    if (!r.ok) throw new Error("Alpaca's crypto feed answered " + r.status);
    const j = await r.json(), now = Date.now();
    Object.entries(j.snapshots || {}).forEach(([s, v]) => { const m = E.mapCryptoSnap(v, now); if (m){ m.at = now; MAP.q[s] = m; } });
    MAP.st.cErr = "";
  }catch(e){ MAP.st.cErr = e.message; }
}
/* without an Alpaca key: one Finnhub quote every few seconds, through MW's shared rate limit (background lane) */
function mapFinnhubStep(){
  if (!settings.key || MAP.fhBusy || E.breakerOpen(fhBreaker, Date.now())) return;
  const ses = session().s, last = E.lastSessionDate(Date.now()), now = Date.now();
  const due = MAP.all.filter(i => !i.crypto && !mapHidden(i.panel)).filter(i => {
    const q = mapQuote(i.sym); if (!q || !q.at) return true;
    return ses === "open" ? now - q.at > 120e3 : (q.day || "") < last;
  });
  if (!due.length) return;
  due.sort((a, b) => ((mapQuote(a.sym) || {}).at || 0) - ((mapQuote(b.sym) || {}).at || 0) || b.aum - a.aum);
  const it = due[0]; MAP.fhBusy = true;
  limited(() => api("quote?symbol=" + encodeURIComponent(it.sym)), true).then(q => {
    if (!(q && q.c > 0)) return;
    const t = q.t ? q.t * 1000 : 0, prev = MAP.q[it.sym];
    MAP.q[it.sym] = {c:+q.c, pc:+q.pc || null, dp: q.pc > 0 ? (q.c / q.pc - 1) * 100 : null, h:+q.h || null, l:+q.l || null, o:+q.o || null,
      dv: prev ? prev.dv || 0 : 0, t, day:E.quoteDay(t || Date.now()), at:Date.now(), ext: prev && prev.src === "alpaca" ? prev.ext : null, quiet:false, src:"finnhub"};
    MAP.st.err = ""; mapSave();
  }).catch(e => { MAP.st.err = e.message; }).finally(() => { MAP.fhBusy = false; });
}
/* reference closes for 5D to 1Y: Alpaca daily bars for every fund, once a day */
async function mapLoadRefs(){
  const today = etNow().date;
  if (MAP.refBusy || !alpOn() || (MAP.refs.date === today && !MAP.refs.err)) return;
  if (MAP.refs.err && Date.now() - (MAP.refs.errAt || 0) < 10 * 60e3) return;
  MAP.refBusy = true; mapPaint();
  try{
    const start = E.addDays(today, -400), acc = {};
    const stocks = MAP.all.filter(i => !i.crypto).map(i => i.sym), coins = MAP.all.filter(i => i.crypto).map(i => i.sym);
    for (let i = 0; i < stocks.length; i += 100){
      let tok = "", guard = 0;
      do {
        const r = await fetchT(ALP_BASE + "v2/stocks/bars?feed=iex&timeframe=1Day&adjustment=split&limit=10000&start=" + start + "&symbols=" + stocks.slice(i, i + 100).join(",") + (tok ? "&page_token=" + encodeURIComponent(tok) : ""), {headers:alpHdr(), cache:"no-store"}, 20000);
        if (!r.ok) throw new Error("Alpaca daily bars answered " + r.status);
        const j = await r.json();
        Object.entries(j.bars || {}).forEach(([s, a]) => { (acc[s] || (acc[s] = [])).push(...a.map(b => [E.etDateOf(Date.parse(b.t)), +b.c])); });
        tok = j.next_page_token || "";
      } while (tok && ++guard < 12);
    }
    const r = {}; Object.entries(acc).forEach(([s, a]) => { r[s] = E.mapRefs(a, today); });
    try{   // coins: UTC calendar days
      const utc = new Date().toISOString().slice(0, 10);
      const cr = await fetchT(ALP_BASE + "v1beta3/crypto/us/bars?timeframe=1Day&limit=10000&start=" + start + "T00:00:00Z&symbols=" + coins.map(encodeURIComponent).join(","), {headers:alpHdr(), cache:"no-store"}, 20000);
      if (cr.ok){ const j = await cr.json(); Object.entries(j.bars || {}).forEach(([s, a]) => { r[s] = E.mapRefs(a.map(b => [String(b.t).slice(0, 10), +b.c]), utc); }); }
    }catch(e){}
    MAP.refs = {date:today, r}; store.set("mapRefs", MAP.refs);
    mwLog("info", "market map: longer time frames loaded for " + Object.keys(r).length + " funds");
  }catch(e){ MAP.refs = Object.assign({}, MAP.refs, {err:e.message, errAt:Date.now()}); mwLog("warn", "market map: " + e.message); }
  finally{ MAP.refBusy = false; }
  mapPaint();
}
async function mapTick(force){
  if (MAP.busy) return; MAP.busy = true;
  try{
    const now = Date.now(), ses = session().s;
    const coins = force || now - (MAP.st.cAt || 0) > 28e3;
    if (alpOn()){
      const due = force || ses === "open" || ses === "ext" || !MAP.st.at || now - MAP.st.at > 10 * 60e3 || MAP.st.err;
      await Promise.all([due ? mapAlpaca() : null, coins ? mapCrypto() : null]);
    } else {
      mapFinnhubStep();
      if (coins) await mapCrypto();
    }
    if (alpOn()) mapLoadRefs();   // once a day: the details and tooltips show 5D to 1Y even on 1D
  } finally { MAP.busy = false; }
  mapPaint();
}
function mapSchedule(){
  clearTimeout(MAP.timer); if (!MAP.open) return;
  const s = session().s, ms = alpOn() ? (s === "open" || s === "ext" ? 15e3 : 30e3) : 3e3;
  MAP.timer = setTimeout(async () => { try{ await mapTick(); }catch(e){ mwLog("warn", "market map: " + e.message); } mapSchedule(); }, ms);
}

/* ---------- open and close ---------- */
function openMap(sym){
  if (typeof closeMenu === "function") closeMenu();
  const el = $("map"), tb = $("titlebar");
  el.style.top = (tb ? tb.offsetHeight : 0) + "px";
  el.classList.remove("hide"); MAP.open = true; MAP.laidKey = "";
  if (sym && MAP.by[sym]) MAP.sel = sym;
  mapBar(); mapLayout(); mapPaint();
  mapTick(true).then(mapSchedule);
  clearInterval(MAP.paintT); MAP.paintT = setInterval(() => { if (MAP.open && !document.hidden) mapPaint(); }, 5000);
  mwLog("info", "market map opened");
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}
function closeMap(){
  $("map").classList.add("hide"); MAP.open = false; clearTimeout(MAP.timer); clearInterval(MAP.paintT); mapSave(true);
  const b = document.querySelector('[data-act="map"]'); if (b) b.focus({preventScroll:true});
}

/* ---------- toolbar ---------- */
function mapBar(){
  const c = mapCfg(), mode = mapMode(), canExt = alpOn(), canVol = alpOn();
  const seg = (k, opts, cur) => `<div class="seg" data-mseg="${k}">${opts.map(([v, l, tip, dis]) => `<button data-mv="${v}" class="${cur === v ? "on" : ""}" title="${esc(tip)}"${dis ? " disabled" : ""}>${l}</button>`).join("")}</div>`;
  $("mpBar").innerHTML =
    seg("per", MAP_PERIODS.map(p => [p, p, p === "1D" ? "The change today (keys 1 to 6 switch)" : p === "YTD" ? "The change this year so far" : "The change over the last " + p]), mode === "ext" ? "" : c.per) +
    seg("mode", [["day", "Day", "The regular session's change", false], ["ext", "Since close", canExt ? "The latest pre-market or after-hours trade against the regular close (Alpaca's IEX feed)" : "Needs a free Alpaca key (Settings → General) for pre-market and after-hours trades", !canExt]], mode) +
    seg("size", [["aum", "Fund size", "Tile area follows the fund's rough size (square-root scaled so small funds stay readable)"], ["vol", "Volume", canVol ? "Tile area follows today's dollar volume on IEX, so the busiest funds today are biggest" : "Needs a free Alpaca key (Settings → General) for volume", !canVol], ["eq", "Equal", "Every fund the same size"]], c.size) +
    `<span class="mp-leg num" title="Colors run from −${MAP_CAP[mode === "ext" ? "ext" : c.per]}% (deepest red) to +${MAP_CAP[mode === "ext" ? "ext" : c.per]}% (deepest green) for this time frame. Gray: no change or no price yet."><span>−${MAP_CAP[mode === "ext" ? "ext" : c.per]}%</span><i></i><span>+${MAP_CAP[mode === "ext" ? "ext" : c.per]}%</span></span>` +
    `<span class="sp"></span><button class="rbtn" data-act="mpPanels" aria-expanded="${MAP.showPanels}" title="Choose which panels show">Panels${Object.values(c.hide).filter(Boolean).length ? " (" + MAP.U.filter(p => !c.hide[p.k]).length + " of " + MAP.U.length + ")" : ""}</button>` +
    `<button class="rbtn" data-act="mpRef" title="Refresh every tile now">↻</button>`;
  $("mpPanels").innerHTML = MAP.showPanels ? MAP.U.map(p => `<label class="mp-pc"><input type="checkbox" data-mpp="${p.k}" ${c.hide[p.k] ? "" : "checked"}> ${esc(p.title)}</label>`).join("") : "";
  $("mpPanels").classList.toggle("hide", !MAP.showPanels);
}

/* ---------- layout: panels into the grid, groups into each panel, tiles into each group ---------- */
function mapWeights(items, mode){
  const ws = items.map(it => { const q = mapQuote(it.sym); return E.mapWeight(it, mode, q ? q.dv : 0); });
  if (mode === "vol" && !ws.some(w => w > 0)) return E.mapGroupWeights(items.map(it => E.mapWeight(it, "aum")), "aum");
  return E.mapGroupWeights(ws, mode);
}
function mapLayout(){
  if (!MAP.open) return;
  const c = mapCfg(), grid = $("mpGrid"), vis = MAP.U.filter(p => !c.hide[p.k]);
  const key = vis.map(p => p.k).join(",") + "|" + c.size + "|" + (c.size === "vol" ? Math.floor(Date.now() / 300e3) : "") + "|" + grid.clientWidth + "x" + grid.clientHeight;
  if (key !== MAP.laidKey || grid.children.length !== vis.length){
    grid.innerHTML = vis.map(p => `<section class="mp-p ${p.big ? "big" : ""}" data-mpk="${p.k}"><div class="mp-ph"><b>${esc(p.title)}</b><span class="num" data-mpa="${p.k}"></span></div><div class="mp-tm" data-mpt="${p.k}"></div></section>`).join("") ||
      `<p class="note" style="padding:20px">Every panel is hidden. Click Panels to show some.</p>`;
  }
  MAP.laidKey = key; MAP.tiles = new Map();
  // a wide window: rows stretch or shrink so every panel fits on one screen (within reason); narrow: scroll
  if (innerWidth >= 1180 && vis.length){
    grid.style.gridAutoRows = "190px"; const n = Math.max(1, Math.ceil((grid.scrollHeight - 4 + 8) / 198 - 0.05));
    grid.style.gridAutoRows = Math.max(140, Math.min(280, Math.floor((grid.clientHeight - 4 - 8 * (n - 1)) / n))) + "px";
  } else grid.style.gridAutoRows = "";
  vis.forEach(p => {
    const box = grid.querySelector(`[data-mpt="${p.k}"]`); if (!box) return;
    const W = box.clientWidth, H = box.clientHeight; if (!(W > 0 && H > 0)) return;
    const gw = p.groups.map(g => ({g, ...mapWeights(g.items, c.size)}));
    const rects = E.squarify(gw.map(x => ({w:x.group, x0:x})), 0, 0, W, H);
    let html = "";
    rects.forEach(R => {
      const {g, tiles} = R.x0, lbl = R.h0 >= 44 && R.w0 >= 46 ? 13 : 0;
      if (lbl) html += `<span class="mp-gl" style="left:${R.x + 3}px;top:${R.y}px;width:${Math.max(0, R.w0 - 6)}px" title="${esc(g.name)}">${esc(g.name)}</span>`;
      const tr = E.squarify(g.items.map((it, i) => ({w:tiles[i], it})), R.x, R.y + lbl, R.w0, R.h0 - lbl);
      tr.forEach(T => {
        const w = Math.max(0, T.w0 - 2), h = Math.max(0, T.h0 - 2);
        MAP.tiles.set(T.it.sym, {w, h, it:T.it, wt:T.w});
        html += `<button class="mt" data-ms="${esc(T.it.sym)}" aria-label="${esc(T.it.sym + ", " + T.it.name)}" style="left:${T.x + 1}px;top:${T.y + 1}px;width:${w}px;height:${h}px"><b></b><i></i><u></u></button>`;
      });
    });
    box.innerHTML = html;
  });
  MAP.last = {};
}
const mapRO = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (!MAP.open) return; cancelAnimationFrame(mapRO._r); mapRO._r = requestAnimationFrame(() => { MAP.laidKey = ""; mapLayout(); mapPaint(); }); }) : null;

/* ---------- paint: colors, text that fits, tooltips, headers, summary ---------- */
function fitTxt(el, txt, fs){ el.textContent = txt; el.style.fontSize = fs ? fs.toFixed(1) + "px" : ""; el.hidden = !fs; }
function mapPaint(){
  if (!MAP.open) return;
  const c = mapCfg(), mode = mapMode(), cap = MAP_CAP[mode === "ext" ? "ext" : c.per], dec = c.per === "1D" || mode === "ext" ? 2 : 1;
  // volume sizing follows the day, so its layout is redone every 5 minutes, not on every price (tiles would jump)
  if (c.size === "vol" && MAP.laidKey && !MAP.laidKey.includes("|" + Math.floor(Date.now() / 300e3) + "|")) mapLayout();
  const find = MAP.find.trim().toUpperCase(), rows = {}, all = [];
  document.querySelectorAll("#mpGrid .mt").forEach(el => {
    const sym = el.dataset.ms, T = MAP.tiles.get(sym); if (!T) return;
    const it = T.it, v = mapVal(it), p = v.pct;
    (rows[it.panel] || (rows[it.panel] = [])).push({pct:p, lev:it.lev, w:T.wt, sym, it});
    all.push({pct:p, lev:it.lev, w:T.wt, sym, it});
    el.style.background = mapColor(p, cap);
    el.classList.toggle("sel", MAP.sel === sym);
    el.classList.toggle("dim", !!find && !(sym.startsWith(find) || it.name.toUpperCase().includes(find)));
    el.classList.toggle("nd", p == null);
    const pctS = p == null ? (v.q ? "—" : "") : fmtPct(p, dec);
    if (MAP.last[sym] != null && MAP.last[sym] !== pctS && p != null){ el.classList.remove("fl"); void el.offsetWidth; el.classList.add("fl"); }
    MAP.last[sym] = pctS;
    // text sizes from the tile's own size: ticker first, then the percent, then dollars for one share
    const label = it.crypto ? sym.split("/")[0] : sym, W = T.w - 6, H = T.h;
    let f1 = Math.min(H * 0.36, W / (label.length * 0.74), 30); if (f1 < 7.5) f1 = 0;
    let f2 = f1 ? Math.min(f1 * 0.66, W / (Math.max(5, pctS.length) * 0.64), 20) : 0; if (f2 < 7 || H < f1 * 1.1 + f2 * 1.25 + 2) f2 = 0;
    const usd = v.usd != null && isFinite(v.usd) ? fmtSh$(v.usd, v.px) : "";
    const xs = mode === "day" && c.per === "1D" && v.q && v.q.ext && !it.crypto && Math.abs(v.q.ext.pct) >= 0.05 ? (v.q.ext.ph === "pre" ? "Pre " : "AH ") + fmtPct(v.q.ext.pct, 1) : "";
    const third = H >= f1 * 1.1 + f2 * 2.6 + 6 ? (xs && H >= 70 ? xs : usd) : "";
    let f3 = third && f2 ? Math.min(f2 * 0.72, W / (third.length * 0.58), 13) : 0; if (f3 < 7) f3 = 0;
    fitTxt(el.children[0], label, f1); fitTxt(el.children[1], pctS, f2); fitTxt(el.children[2], third, f3);
    el.children[2].className = third === xs && xs ? "x" : "";
    el.dataset.tip = mapTip(it, v);
  });
  // panel headers: the 1x funds' average, weighted like the tiles
  Object.entries(rows).forEach(([k, r]) => { const s = E.mapStats(r), el = document.querySelector(`[data-mpa="${k}"]`); if (!el) return;
    el.innerHTML = s.avg == null ? "" : `<b class="${cls(s.avg)}">${fmtPct(s.avg, 2)}</b> avg`;
    el.title = s.avg == null ? "" : `Average ${MAP_PER_WORD[c.per] && mode !== "ext" ? MAP_PER_WORD[c.per] : "since the close"} of the regular (1x) funds in this panel, weighted like the tiles. Leveraged and inverse funds are left out of the average.\n${s.up} up · ${s.down} down${s.flat ? " · " + s.flat + " flat" : ""}`; });
  mapSummary(all, mode, dec); mapStatus(); mapDetail();
}
function mapTip(it, v){
  const q = v.q, L = [`${it.crypto ? it.sym : it.sym} · ${it.name}`, `${it.ptitle} · ${it.group}${it.lev !== 1 ? ` · ${it.lev > 0 ? it.lev + "x leveraged" : Math.abs(it.lev) + "x inverse"}: aims for ${it.lev}x the index's DAILY move` : ""}`];
  if (!q){ L.push(MAP.open && (alpOn() || settings.key || it.crypto) ? "Waiting for a price" : "Add a Finnhub or Alpaca key in Settings to price the map"); return L.join("\n"); }
  const d1 = q.pc > 0 ? q.c - q.pc : null;
  L.push(`${fmtPx(q.c)} · ${chgTxt(d1, q.dp, 2, q.c) || "—"} ${it.crypto ? "since 00:00 UTC" : q.quiet ? "(no IEX trade yet today)" : dayWord()}`);
  if (q.ext && !it.crypto) L.push(`${q.ext.ph === "pre" ? "Pre-market" : "After hours"} ${fmtPx(q.ext.p)} · ${chgTxt(q.ext.p - q.c, q.ext.pct, 2, q.ext.p)} against the close (${timeStr(q.ext.t)})`);
  const per = MAP_PERIODS.slice(1).map(k => { const r = MAP.refs.r[it.sym] && MAP.refs.r[it.sym][k]; return r && r[1] > 0 ? `${k} ${fmtPct((q.c / r[1] - 1) * 100, 1)}` : ""; }).filter(Boolean);
  if (per.length) L.push(per.join(" · "));
  if (q.dv > 0) L.push(`Traded on IEX ${it.crypto ? "today (UTC)" : dayWord()}: ${fmtBig$(q.dv)}${it.crypto ? "" : " (IEX is a small slice of all trading)"}`);
  L.push("Click for details");
  return L.join("\n");
}

function mapSummary(all, mode, dec){
  const s = E.mapStats(all), c = mapCfg(), n = all.filter(r => r.pct != null).length, el = $("mpSum");
  if (!n){ el.innerHTML = `<span class="muted">${mode === "ext" ? "No pre-market or after-hours trades yet. They start at 4 AM ET and run to 8 PM ET." : MAP.refBusy ? "Loading the longer time frames…" : c.per !== "1D" && !alpOn() ? `5D to 1Y need a free Alpaca key (Settings → General). MW's own history covers the funds you already track.` : "Waiting for prices…"}</span>`; return; }
  const tot = s.up + s.down + s.flat, word = mode === "ext" ? "since the close" : MAP_PER_WORD[c.per];
  el.innerHTML = `<span><b class="up">▲ ${s.up}</b> <b class="down">▼ ${s.down}</b>${s.flat ? ` <span class="muted">· ${s.flat} flat</span>` : ""}</span>
    <span class="mp-br" title="${s.up} of ${tot} funds are up ${word}"><i style="width:${(s.up / Math.max(1, tot) * 100).toFixed(1)}%"></i></span>
    ${s.avg != null ? `<span title="Average of every regular (1x) fund on the map, weighted like the tiles">Avg <b class="${cls(s.avg)}">${fmtPct(s.avg, 2)}</b></span>` : ""}
    ${s.best ? `<button class="mp-bw" data-ms="${esc(s.best.sym)}" title="The best regular (1x) fund ${word}: ${esc(s.best.it.name)}">Best <b>${esc(s.best.it.crypto ? s.best.sym.split("/")[0] : s.best.sym)}</b> <b class="${cls(s.best.pct)}">${fmtPct(s.best.pct, dec)}</b></button>` : ""}
    ${s.worst ? `<button class="mp-bw" data-ms="${esc(s.worst.sym)}" title="The worst regular (1x) fund ${word}: ${esc(s.worst.it.name)}">Worst <b>${esc(s.worst.it.crypto ? s.worst.sym.split("/")[0] : s.worst.sym)}</b> <b class="${cls(s.worst.pct)}">${fmtPct(s.worst.pct, dec)}</b></button>` : ""}`;
}
function mapStatus(){
  const ses = session(), now = Date.now(), st = MAP.st, el = $("mpSt"); let t, tip;
  const fresh = MAP.all.filter(i => !i.crypto && !mapHidden(i.panel)), priced = fresh.filter(i => { const q = mapQuote(i.sym); return q && q.at && now - q.at < 15 * 60e3; }).length;
  if (alpOn()){
    t = st.err ? "⚠ " + st.err : st.at ? `${ses.s === "open" ? "Live" : ses.s === "ext" ? (etNow().mins < 570 ? "Pre-market" : "After hours") : "Closed"} · ${timeStr(st.at)}` : "Loading…";
    tip = `Prices from Alpaca's free IEX feed: ${st.n || 0} funds in ${((st.ms || 0) / 1000).toFixed(1)} s. ` + (ses.s === "open" || ses.s === "ext" ? "Every 15 seconds while the map is open." : "Every 10 minutes while the market is closed; the tiles show the last regular close.") + " IEX is one exchange, so prices are a close guide; MW's regular Finnhub prices win for the tickers you already track.";
  } else if (settings.key){
    t = `Finnhub · ${priced} of ${fresh.length} fresh`;
    tip = `Without an Alpaca key, MW prices the map one fund every 3 seconds (about 20 a minute, inside the free Finnhub limit), biggest first. A full pass takes about ${Math.ceil(fresh.length / 20)} minutes. Add a free Alpaca key in Settings → General to price every tile at once, every 15 seconds, after hours too.`;
  } else { t = "No data key"; tip = "Add a free Finnhub key, or better a free Alpaca key, in Settings → General."; }
  if (MAP.refBusy) t += " · loading 5D–1Y…";
  if (st.cErr && !mapHidden("crypto")) tip += "\nCoins: " + st.cErr;
  el.textContent = t; el.title = tip; el.classList.toggle("warn", !!st.err);
}

/* ---------- details for the clicked tile ---------- */
function mapDetail(){
  const el = $("mpDet"), sym = MAP.sel, it = MAP.by[sym];
  $("map").classList.toggle("det", !!it);
  if (!it){ el.innerHTML = ""; el.classList.add("hide"); return; }
  el.classList.remove("hide");
  const v = mapVal(it), q = v.q, onW = cfg.watch.some(w => (w.sym || "").toUpperCase() === sym), label = it.crypto ? sym.split("/")[0] : sym;
  const d1 = q && q.pc > 0 ? q.c - q.pc : null;
  const pers = MAP_PERIODS.map(k => { let pct = null;
    if (q && k === "1D") pct = q.dp;
    else if (q){ const r = MAP.refs.r[sym] && MAP.refs.r[sym][k]; let ref = r ? r[1] : null; if (!(ref > 0) && !it.crypto){ const h = hist[sym], hr = h && h.refs && h.refs[k]; if (hr) ref = hr.c; } if (ref > 0) pct = (q.c / ref - 1) * 100; }
    return `<span><small>${k}</small><b class="${cls(pct)}">${fmtPct(pct, k === "1D" ? 2 : 1)}</b></span>`; }).join("");
  const peers = it.panel && MAP.U.find(p => p.k === it.panel).groups.find(g => g.name === it.group).items.map(x => ({x, v:mapVal(x)}))
    .sort((a, b) => (b.v.pct ?? -1e9) - (a.v.pct ?? -1e9));
  const mx = Math.max(0.01, ...peers.map(p => Math.abs(p.v.pct || 0)));
  el.innerHTML = `<div class="md-h"><b class="tk">${esc(label)}</b><button class="x" data-act="mpDetX" title="Close the details (Esc)" aria-label="Close the details">✕</button></div>
    <div class="md-n">${esc(it.name)}</div><div class="md-g muted">${esc(it.ptitle)} · ${esc(it.group)}${it.lev !== 1 ? ` · <span class="chip" title="Aims for ${it.lev}x the index's move each DAY. Over longer stretches it drifts from ${it.lev}x, most in choppy markets.">${it.lev > 0 ? it.lev + "x" : "−" + Math.abs(it.lev) + "x"}</span>` : ""}</div>
    <div class="md-p num"><span class="px">${q ? fmtPx(q.c) : "—"}</span>${q ? dchg(d1, q.dp, {px:q.c, tip:`${label} ${it.crypto ? "since 00:00 UTC" : dayWord()}`}) : ""}</div>
    ${q && q.ext && !it.crypto ? `<div class="md-x num">${q.ext.ph === "pre" ? "Pre-market" : "After hours"} ${fmtPx(q.ext.p)} <b class="${cls(q.ext.pct)}">${esc(chgTxt(q.ext.p - q.c, q.ext.pct, 2, q.ext.p))}</b> <span class="muted">${esc(timeStr(q.ext.t))}</span></div>` : ""}
    ${q && q.quiet ? `<div class="md-x muted">No trade on IEX yet today, so this is the last close.</div>` : ""}
    <div class="md-per num">${pers}</div>
    ${q && q.l > 0 && q.h > q.l ? rangeBar(q.l, q.h, q.c, "Low", "High") : ""}
    ${q && q.dv > 0 ? `<div class="md-k"><span>Traded on IEX ${it.crypto ? "today (UTC)" : dayWord()}</span><b class="num">${fmtBig$(q.dv)}</b></div>` : ""}
    <div class="md-k"><span>Price from</span><b>${q ? (q.src === "alpaca" ? "Alpaca IEX" : q.src === "twelvedata" ? "Twelve Data" : "Finnhub") + (q.at ? " · " + timeStr(q.at) : "") : "—"}</b></div>
    <div class="md-a">${it.crypto ? "" : `<button class="btn" data-chart="${esc(sym)}" title="Candles with averages">Chart</button>${onW ? `<button class="btn" data-mpw="${esc(sym)}" title="Close the map and open ${esc(sym)} on your watchlist">Open in Watchlist</button>` : `<button class="btn" data-wadd="${esc(sym)}" title="Add ${esc(sym)} to your watchlist with the default dip rules">+ Watchlist</button>`}`}</div>
    <div class="md-pe"><div class="md-pt">${esc(it.group)}, ${MAP_PER_WORD[mapCfg().per] && mapMode() !== "ext" ? MAP_PER_WORD[mapCfg().per] : "since the close"}</div>${peers.map(p => `<button class="pe ${p.x.sym === sym ? "on" : ""}" data-ms="${esc(p.x.sym)}" title="${esc(p.x.name)}"><span class="s">${esc(p.x.crypto ? p.x.sym.split("/")[0] : p.x.sym)}</span><span class="bar"><i class="${cls(p.v.pct)}" style="width:${(Math.abs(p.v.pct || 0) / mx * 100).toFixed(1)}%"></i></span><b class="num ${cls(p.v.pct)}">${fmtPct(p.v.pct, mapCfg().per === "1D" || mapMode() === "ext" ? 2 : 1)}</b></button>`).join("")}</div>`;
}

/* ---------- events ---------- */
(function(){
  const root = $("map"); if (!root) return;
  if (mapRO) mapRO.observe($("mpGrid"));
  root.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("#mpX")){ closeMap(); return; }
    const w = t.closest("[data-mpw]"); if (w){ e.stopPropagation(); const s = w.dataset.mpw; closeMap(); palGo(s); return; }
    if (t.closest("[data-act=mpDetX]")){ MAP.sel = ""; mapPaint(); return; }
    const b = t.closest("[data-mv]");
    if (b && !b.disabled){ const k = b.closest("[data-mseg]").dataset.mseg, v = b.dataset.mv;
      if (k === "per"){ mapSet("per", v); if (mapMode() === "ext") mapSet("mode", "day"); if (v !== "1D") mapLoadRefs(); }
      else if (k === "mode") mapSet("mode", v);
      else if (k === "size"){ mapSet("size", v); MAP.laidKey = ""; mapLayout(); }
      mapBar(); mapPaint(); return; }
    if (t.closest("[data-act=mpPanels]")){ MAP.showPanels = !MAP.showPanels; mapBar(); return; }
    if (t.closest("[data-act=mpRef]")){ if (!alpOn() && !settings.key){ toast("Add a Finnhub or Alpaca key in Settings first"); return; }
      toast(alpOn() ? "Updating every tile…" : "Updating: about 20 funds a minute without an Alpaca key"); mapTick(true); return; }
    const m = t.closest("[data-ms]");
    if (m){ const s = m.dataset.ms; MAP.sel = MAP.sel === s && m.classList.contains("mt") ? "" : s; mapPaint();
      const el = document.querySelector(`#mpGrid .mt[data-ms="${CSS.escape(s)}"]`); if (el && !m.classList.contains("mt")) el.scrollIntoView({block:"nearest"}); return; }
  });
  root.addEventListener("change", e => { const p = e.target.closest("[data-mpp]"); if (!p) return;
    const h = Object.assign({}, mapCfg().hide); if (p.checked) delete h[p.dataset.mpp]; else h[p.dataset.mpp] = true;
    mapSet("hide", h); MAP.laidKey = ""; mapBar(); mapLayout(); mapPaint(); if (p.checked) mapTick(true); });
  $("mpFind").addEventListener("input", e => { MAP.find = e.target.value; mapPaint(); });
  $("mpFind").addEventListener("keydown", e => {
    if (e.key === "Enter"){ const f = MAP.find.trim().toUpperCase(); const hit = MAP.all.find(i => i.sym === f) || MAP.all.find(i => i.sym.startsWith(f)) || MAP.all.find(i => i.name.toUpperCase().includes(f));
      if (hit && !mapHidden(hit.panel)){ MAP.sel = hit.sym; mapPaint(); const el = document.querySelector(`#mpGrid .mt[data-ms="${CSS.escape(hit.sym)}"]`); if (el) el.scrollIntoView({block:"nearest"}); } else if (f) toast(hit ? hit.sym + " is in a hidden panel" : "Not on the map: " + f); }
    if (e.key === "Escape"){ e.stopPropagation(); if (MAP.find){ MAP.find = ""; e.target.value = ""; mapPaint(); } else e.target.blur(); }
  });
  // keys: M opens and closes the map, Esc closes the details and then the map, 1-6 pick the time frame, / finds
  document.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const typing = e.target.matches && e.target.matches("input,textarea,select");
    const over = !$("chart").classList.contains("hide") || !$("pal").classList.contains("hide") || !$("sheet").classList.contains("hide");
    if (!MAP.open){ if (!typing && !over && e.key.toLowerCase() === "m"){ e.preventDefault(); openMap(); } return; }
    if (over || typing) return;
    const k = e.key.toLowerCase();
    if (e.key === "Escape"){ e.stopImmediatePropagation(); e.preventDefault(); if (MAP.sel){ MAP.sel = ""; mapPaint(); } else closeMap(); return; }
    if (k === "m"){ e.stopImmediatePropagation(); closeMap(); return; }
    if (k === "/"){ e.stopImmediatePropagation(); e.preventDefault(); $("mpFind").focus(); return; }
    if (/^[1-6]$/.test(k)){ e.stopImmediatePropagation(); mapSet("per", MAP_PERIODS[+k - 1]); if (mapMode() === "ext") mapSet("mode", "day"); if (k !== "1") mapLoadRefs(); mapBar(); mapPaint(); return; }
    if (k === "r"){ e.stopImmediatePropagation(); mapTick(true); return; }
    if (["c", "n", "a", "p", "o", "g", "arrowup", "arrowdown", "home", "end", "delete", "backspace"].includes(k)) e.stopImmediatePropagation();
  }, true);
  window.addEventListener("resize", () => { if (MAP.open){ const tb = $("titlebar"); root.style.top = (tb ? tb.offsetHeight : 0) + "px"; } });
  document.addEventListener("visibilitychange", () => { if (MAP.open && !document.hidden) mapTick(); });
  if (/^#map\b/.test(location.hash)) setTimeout(() => openMap(), 300);
})();
