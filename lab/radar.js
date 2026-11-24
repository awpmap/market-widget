"use strict";
/* =====================================================================
   In-play radar (6.3): which stocks are "in play" right now. It ranks a universe (your watchlist and holdings plus
   about 150 liquid US stocks and funds, E.RADAR_UNIVERSE) by RELATIVE VOLUME: today's volume so far against what
   is normal for that ticker by this time of day. That is the one filter that held up in MW's own backtests, so the
   radar is built around it and says plainly what it is: where the attention is, not which way to trade.
   Runs on top of app.js (same page, same globals). Public build: no personal data here. The math is in engine.js
   (the RADAR region) and tested in labdev/test/radar.test.mjs.

   Three views: In play (relative volume), Leaders / laggards (the day's move against SPY's), Mine (your tickers).
   The scope on top plots every ticker once: sideways is today's change, upward is volume against usual. A ticker
   whose latest minute traded 5 times its usual pace gets a ring there and a "Volume surge" tag (nothing is sent to
   the phone or the desktop: it is a highlight on this screen only).

   Data, staying inside the free limits, and ONLY while this section is open and on screen:
   - Alpaca snapshots (free IEX feed, your key): 100 tickers a call, so 2 calls every 30 s in market hours,
     pre-market and after hours. Once the session is over and after-hours trading has ended: one last read, then
     nothing until the next pre-market.
   - Alpaca daily bars, once a day (about 5 calls): the 20-day average volume, the 14-day ATR and the 20-day and
     52-week highs and lows.
   - Finnhub earnings calendar for yesterday and today: 1 call a day, in MW's background lane.
   - Without an Alpaca key: no calls at all. Your own tickers are ranked by today's move from the prices MW already
     has; those carry no volume, so relative volume is left blank and the section says so.
   Rows keep their places: prices follow every read, the order is redone once a minute (and not while the pointer
   is moving over the list), and a ticker only passes its neighbour when it beats it by more than 10%.
   ===================================================================== */
const RD_BARS = "https://data.alpaca.markets/v2/stocks/bars";
const RD_EVERY = 30e3, RD_RERANK = 60e3, RD_PING_HOT = 5 * 60e3, RD_PING_KEEP = 15 * 60e3;
const RD_DEF = {view:"inplay", minPx:0, minDv:0, more:false, scope:true, filt:false};
const RD_PX = [0, 5, 10, 20, 50], RD_DV = [0, 1e6, 5e6, 20e6];
const rdCfg = () => Object.assign({}, RD_DEF, settings.radar || {});
function rdSet(k, v){ settings.radar = Object.assign(rdCfg(), {[k]:v}); saveSettings(); }
const RADAR = (() => { const s = store.get("radarQ", null) || {};
  return {q: s.q && typeof s.q === "object" ? s.q : {}, base: store.get("radarBase", null) || {date:"", s:{}}, earn: store.get("radarEarn", null) || {date:"", m:{}},
    st:{at:0, okAt:+s.at || 0, err:"", fail:0, wait:0, ms:0, n:0}, asked:new Set(), busy:false, baseBusy:false, earnBusy:false, savedAt:0,
    rows:{}, spy:null, ph:null, pings:{}, ver:0, sig:"", order:{}, rankAt:0, rankKey:"", lab:[], scale:{cap:3, top:4}, hoverAt:0,
    sec:null, els:null, rowEls:new Map(), dotEls:new Map(), local:{}}; })();

/* ---------- small formatters ---------- */
const rdX = v => (v >= 9.95 ? String(Math.round(v)) : v.toFixed(1)) + "×";
const rdN = n => n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n));
const rdMd = d => { const t = E.etMs(d, 720); return new Date(t).toLocaleDateString("en-US", {weekday:"short", month:"numeric", day:"numeric", timeZone:E.ET_TZ}); };

/* ---------- data ---------- */
async function radarSnapshots(){
  const syms = E.radarUniverse(mySyms()), got = {}; let bad = null;
  for (let i = 0; i < syms.length; i += 100){
    try{ Object.assign(got, await alpSnap(syms.slice(i, i + 100))); }
    catch(e){ if (i === 0 || e.auth) throw e; bad = e; }   // a later call failing keeps what the first one brought
  }
  const now = Date.now(); let n = 0;
  Object.keys(got).forEach(s => { const v = E.radarSnap(got[s], now); if (v){ RADAR.q[s] = v; n++; } });
  RADAR.asked = new Set(syms); RADAR.st.n = n;
  radarPings(now);
  if (now - RADAR.savedAt > 60e3){ RADAR.savedAt = now; const keep = {}; syms.forEach(s => { if (RADAR.q[s]) keep[s] = RADAR.q[s]; }); store.set("radarQ", {at:now, q:keep}); }
  if (bad) throw bad;
}
/* volume surges: each ticker's latest minute against that minute's usual pace; kept for 15 minutes */
function radarPings(now){
  E.radarUniverse(mySyms()).forEach(s => { const q = RADAR.q[s], b = q && (RADAR.base.s[s] || []).find(x => x && x.asOf < q.day), k = b ? E.radarShock(q, b, now) : null;
    if (k && (!RADAR.pings[s] || RADAR.pings[s].t !== k.t)) RADAR.pings[s] = k; });
  Object.keys(RADAR.pings).forEach(s => { if (now - RADAR.pings[s].t > RD_PING_KEEP) delete RADAR.pings[s]; });
}
/* what is normal for each ticker, from a year of daily bars: once a day, and for any ticker added since */
async function radarLoadBase(){
  const today = etNow().date, B = RADAR.base, fresh = B.date === today;
  if (RADAR.baseBusy || !alpOn() || (B.errAt && Date.now() - B.errAt < 10 * 60e3)) return false;
  const need = E.radarUniverse(mySyms()).filter(s => !fresh || !(s in B.s));
  if (!need.length) return false;
  RADAR.baseBusy = true; radarPaint();
  try{
    const start = E.addDays(today, -380), acc = {};
    for (let i = 0; i < need.length; i += 100){
      let tok = "", guard = 0;
      do {
        const r = await fetchT(RD_BARS + "?feed=iex&timeframe=1Day&adjustment=split&limit=10000&start=" + start + "&symbols=" + need.slice(i, i + 100).map(encodeURIComponent).join(",") + (tok ? "&page_token=" + encodeURIComponent(tok) : ""), {headers:alpHdr(), cache:"no-store"}, 20000);
        if (!r.ok) throw new Error("Alpaca's daily bars answered " + r.status);
        const j = await r.json();
        Object.entries(j.bars || {}).forEach(([s, a]) => { (acc[s] || (acc[s] = [])).push(...(a || []).map(b => ({d:E.etDateOf(Date.parse(b.t)), h:+b.h, l:+b.l, c:+b.c, v:+b.v || 0}))); });
        tok = j.next_page_token || "";
      } while (tok && ++guard < 12);
    }
    const s = fresh ? Object.assign({}, B.s) : {};
    // two answers per ticker: what was normal before today, and before the last finished session (for the hours when that one is on screen)
    need.forEach(sym => { const a = E.radarBase(acc[sym], today), p = a ? E.radarBase(acc[sym], a.asOf) : null; s[sym] = [a, p].filter(Boolean); });
    RADAR.base = {date:today, s}; store.set("radarBase", RADAR.base);
    mwLog("info", "radar: 20-day averages loaded for " + need.filter(x => s[x].length).length + " tickers");
  }catch(e){ RADAR.base = Object.assign({}, RADAR.base, {errAt:Date.now(), err:e.message}); mwLog("warn", "radar: " + e.message); }
  finally{ RADAR.baseBusy = false; }
  return true;
}
/* who reports today, and who reported after yesterday's close (Finnhub's calendar, one background call a day) */
async function radarLoadEarn(){
  const today = etNow().date, now = Date.now();
  if (RADAR.earnBusy || !settings.key || RADAR.earn.date === today || now - (RADAR.earn.tryAt || 0) < 15 * 60e3) return;
  RADAR.earnBusy = true; RADAR.earn.tryAt = now;
  try{
    const prev = E.prevTradingDay(today), j = await limited(() => api(`calendar/earnings?from=${prev}&to=${today}`), true);
    const want = new Set(E.radarUniverse(mySyms())), m = {};
    (j.earningsCalendar || []).forEach(e => { if (e && want.has(e.symbol) && (e.date === today || e.date === prev) && (!m[e.symbol] || e.date > m[e.symbol].d)) m[e.symbol] = {d:e.date, hour:e.hour || ""}; });
    RADAR.earn = {date:today, prev, m}; store.set("radarEarn", RADAR.earn); RADAR.ver++; radarPaint();
  }catch(e){} finally{ RADAR.earnBusy = false; }
}
function rdEarn(sym, today){
  const R = RADAR.earn, e = R.date === today && R.m ? R.m[sym] : null;
  if (e) return {d:e.d, hour:e.hour, prev:e.d === R.prev};
  const x = erInfo(sym); return x && x.days === 0 ? {d:x.d, hour:x.hour, prev:false} : null;   // MW's own calendar (your tickers)
}
/* the freshest headline of the last hour for each ticker, from the news MW already has (the live tape and Finnhub) */
function rdNews(now){
  const m = {}, take = n => { if (!n || !n.h || !(n.t > 0) || now - n.t > 3600e3 || n.t > now + 120e3 || !Array.isArray(n.syms)) return;
    n.syms.forEach(s => { s = String(s).toUpperCase(); if (!m[s] || n.t > m[s].t) m[s] = {h:n.h, t:n.t, mins:Math.max(0, (now - n.t) / 60e3)}; }); };
  try{ (wire.items || []).forEach(take); (news.items || []).forEach(take); }catch(e){}
  return m;
}
/* is it time to read the market again? Only while the section can be seen. */
function radarDue(now){
  if (!alpOn() || !secLive("radar") || RADAR.busy) return false;
  const st = RADAR.st, ph = E.radarPhase(now, clockOpts());
  if (st.err) return now - st.at >= st.wait;
  if (E.radarUniverse(mySyms()).some(s => !RADAR.asked.has(s))) return now - st.at >= 3000;   // first look, or a ticker you just added
  if (ph.ph === "closed") return st.okAt < ph.settled;   // one last read once after-hours trading has ended, then rest
  return now - st.at >= RD_EVERY - 500;
}
async function radarTick(){
  if (RADAR.busy) return; RADAR.busy = true;
  const st = RADAR.st, t0 = Date.now();
  if (!st.okAt) radarPaint();
  try{ await radarSnapshots(); Object.assign(st, {at:Date.now(), okAt:Date.now(), err:"", fail:0, wait:0, ms:Date.now() - t0}); }
  catch(e){ st.fail++; st.err = e.message || "no answer"; st.at = Date.now(); st.wait = e.auth ? 10 * 60e3 : Math.min(10 * 60e3, 30e3 * 2 ** Math.min(st.fail - 1, 5));
    if (st.fail <= 2 || e.auth) mwLog("warn", "radar: " + st.err); }
  finally{ RADAR.busy = false; }
  RADAR.ver++; radarPaint();
  radarExtras();
}
/* the once-a-day loads; each one returns at once when it has nothing to do */
function radarExtras(){
  radarLoadBase().then(did => { if (did){ radarPings(Date.now()); RADAR.ver++; radarPaint(); } }).catch(() => {});
  radarLoadEarn();
}
function radarLoop(){
  if (radarDue(Date.now())) radarTick();
  else if (alpOn() && secLive("radar") && !RADAR.busy && RADAR.st.okAt && !RADAR.st.err) radarExtras();   // a new day, or a retry, while the market is closed
}

/* ---------- rows ---------- */
/* without Alpaca: your own tickers from MW's regular quotes (no volume there), with the daily bars MW keeps for the watchlist */
function rdLocal(now){
  const qs = {}, bases = {};
  mySyms().forEach(sym => { const q = quotes[sym]; if (!q || !(q.c > 0)) return;
    const day = E.quoteDay(q.t ? q.t * 1000 : q.at) || E.lastSessionDate(now);
    qs[sym] = {day, c:+q.c, pc:+q.pc || null, o:+q.o || null, h:+q.h || null, l:+q.l || null, v:0, vw:null, t:q.t ? q.t * 1000 : 0, ext:null, mv:0, mt:0};
    const h = hist[sym], k = h && h.bars ? h.date + "|" + day : "";
    if (k){ const memo = RADAR.local[sym]; bases[sym] = memo && memo.k === k ? memo.b : (RADAR.local[sym] = {k, b:[E.radarBase(h.bars.map(b => ({d:b[0], h:b[2], l:b[3], c:b[4], v:b[5]})), day)].filter(Boolean)}).b; } });
  const R = E.radarRows(qs, bases, {now, clock:clockOpts()});
  Object.values(R.rows).forEach(r => { r.rvol = null; r.dv = 0; r.thin = false; r.noVol = true; });
  return R;
}
function radarCompute(now){
  if (!alpOn()){ const R = rdLocal(now); RADAR.rows = R.rows; RADAR.spy = R.spy; RADAR.ph = R.ph; return; }
  const qs = {}; E.radarUniverse(mySyms()).forEach(s => { if (RADAR.q[s]) qs[s] = RADAR.q[s]; });
  const R = E.radarRows(qs, RADAR.base.s || {}, {now, clock:clockOpts()});
  RADAR.rows = R.rows; RADAR.spy = R.spy; RADAR.ph = R.ph;
}
/* the order of each view. Redone once a minute, at once when you change the view, a filter or your tickers, and
   never while the pointer is moving over the list or a button is held down. */
function radarRank(now, force){
  const c = rdCfg(), ph = RADAR.ph.ph, on = alpOn(), mine = mySyms(), all0 = Object.values(RADAR.rows);
  // a new key (your tickers, a filter, the session, or the 20-day averages arriving) ranks at once
  const key = [on ? 1 : 0, ph, c.minPx, c.minDv, mine.join(), all0.length, all0.filter(r => r.av != null).length].join("|"), same = key === RADAR.rankKey;
  if (!force && same && (now - RADAR.rankAt < RD_RERANK - 1500 || now - RADAR.hoverAt < 20e3 || ptrDown)) return false;
  const prev = same ? RADAR.order : {}, all = Object.values(RADAR.rows), f = {minPx:c.minPx, minDv:c.minDv};
  const sc = (list, view) => list.map(r => ({sym:r.sym, score:E.radarScore(r, view, ph)}));
  const pass = all.filter(r => E.radarPass(r, f)), mineRows = mine.map(s => RADAR.rows[s]).filter(Boolean), o = {};
  if (on){
    o.inplay = E.radarRank(prev.inplay, sc(pass, "inplay"));
    o.rs = E.radarRank(prev.rs, sc(pass.filter(r => r.sym !== "SPY"), "rs"));
    const ranked = E.radarRank(prev.mineRanked, sc(mineRows, "inplay")), got = new Set(ranked);
    o.mineRanked = ranked; o.mine = [...ranked, ...mineRows.map(r => r.sym).filter(s => !got.has(s)).sort()];
  } else {
    const ranked = E.radarRank(prev.mineRanked, mineRows.map(r => ({sym:r.sym, score:r.move == null ? null : Math.abs(r.move)}))), got = new Set(ranked);
    o.mineRanked = ranked; o.mine = [...ranked, ...mineRows.map(r => r.sym).filter(s => !got.has(s)).sort()]; o.inplay = []; o.rs = [];
  }
  o.pass = new Set(pass.map(r => r.sym));
  // the scope's scales and which dots carry a name change with the ranking, so they stay put between rankings too
  const plot = (c.view === "mine" ? mineRows : pass).filter(r => r.rvol != null && r.move != null);
  RADAR.scale = {cap:E.radarCap(plot.map(r => r.move), plot.filter(r => r.rvol >= 2).map(r => r.move)), top:E.radarTop(plot.map(r => r.rvol))};
  const mineSet = new Set(mine), busy = plot.filter(r => r.rvol >= 1.5).sort((a, b) => b.rvol - a.rvol).slice(0, 7).map(r => r.sym);
  RADAR.lab = [...busy, ...plot.filter(r => mineSet.has(r.sym) && !busy.includes(r.sym)).sort((a, b) => b.rvol - a.rvol).map(r => r.sym)];
  RADAR.order = o; RADAR.rankAt = now; RADAR.rankKey = key;
  return true;
}
const rdView = () => alpOn() ? rdCfg().view : "mine";

/* ---------- drawing ---------- */
const RD_ICON = {
  scope:`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><circle cx="8" cy="8" r="2.2"/><path d="M8 8l4-4"/></svg>`,
  filt:`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11L9.5 8.4v4.1l-3-1.5V8.4z"/></svg>`
};
function rdCss(){
  if ($("radar-css")) return;
  const st = document.createElement("style"); st.id = "radar-css";
  st.textContent = `
.radar{container-type:inline-size;container-name:radar}
.radar-top{display:flex;align-items:center;gap:4px;margin:0 0 8px}
.radar-top .seg{min-width:0}
.radar-top .seg button{white-space:nowrap}
.radar-sp{flex:1}
.radar-ib{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:24px;min-width:26px;padding:0 6px;border-radius:7px;color:var(--muted);font-size:11px;position:relative;flex:none}
.radar-ib:hover{background:var(--surface-2);color:var(--fg)}
.radar-ib[aria-pressed="true"]{color:var(--accent)}
.radar-ib svg{width:14px;height:14px}
.radar-ib.set::after{content:"";position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:var(--accent)}
.radar-filt{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin:0 0 8px;padding:8px 10px;background:var(--surface-2);border-radius:var(--r-sm);font-size:11.5px;color:var(--fg-2)}
.radar-filt label{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.radar-filt select{font-size:11.5px;padding:3px 24px 3px 7px;background-color:var(--surface)}
.radar-note:empty{display:none}
.radar-note .callout .btn{margin-top:8px}
.radar-note .err{margin:0 0 8px}
.radar-st{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:0 0 8px;font-size:11px;color:var(--muted)}
.radar-ses{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--fg-2);padding:2px 8px;border-radius:20px;background:var(--surface-2);white-space:nowrap}
.radar-ses i{width:7px;height:7px;border-radius:50%;background:var(--muted)}
.radar[data-ph="open"] .radar-ses i{background:var(--up);box-shadow:0 0 0 3px color-mix(in srgb,var(--up) 25%,transparent)}
.radar[data-ph="pre"] .radar-ses i,.radar[data-ph="after"] .radar-ses i{background:var(--warn)}
.radar-stx{min-width:0}
.radar-scope{position:relative;height:184px;margin:0 0 8px;border-radius:var(--r-sm);background:var(--surface-2);overflow:hidden}
.radar-plot{position:absolute;left:30px;right:12px;top:16px;bottom:20px}
.radar-zone{position:absolute;left:0;right:0;top:0;background:color-mix(in srgb,var(--accent) 7%,transparent);border-bottom:1px dashed color-mix(in srgb,var(--accent) 50%,transparent);transition:height .7s ease}
.radar-zone b{position:absolute;right:28px;top:5px;font:600 9.5px var(--font);letter-spacing:.4px;text-transform:uppercase;color:color-mix(in srgb,var(--accent) 80%,var(--fg-2))}
.radar-hl{position:absolute;left:0;right:0;height:0;border-top:1px solid color-mix(in srgb,var(--line-2) 55%,transparent)}
.radar-hl.one{border-top-color:var(--line-2)}
.radar-hl b{position:absolute;left:-28px;top:-7px;width:23px;text-align:right;font:500 9.5px var(--font);color:var(--muted)}
.radar-vl{position:absolute;top:0;bottom:0;width:0;border-left:1px solid color-mix(in srgb,var(--line-2) 55%,transparent)}
.radar-vl.zero{border-left-color:var(--line-2)}
.radar-vl b{position:absolute;bottom:-16px;left:0;transform:translateX(-50%);font:500 9.5px var(--font);color:var(--muted);white-space:nowrap}
.radar-vl.first b{transform:none}
.radar-vl.last b{transform:translateX(-100%)}
.radar-vl.spy{border-left:1px dashed color-mix(in srgb,var(--fg-2) 70%,transparent);transition:left .7s ease}
.radar-vl.spy b{bottom:auto;top:-14px;color:var(--fg-2);font-weight:600}
.radar-dot{position:absolute;width:7px;height:7px;border-radius:50%;transform:translate(-50%,-50%);background:var(--muted);opacity:.42;cursor:pointer;transition:left .7s ease,top .7s ease,opacity .3s}
.radar-dot::before{content:"";position:absolute;inset:-4px;border-radius:50%}
.radar-dot.up{background:var(--up)}
.radar-dot.down{background:var(--down)}
.radar-dot.mid{opacity:.72}
.radar-dot.hot{opacity:1;width:9px;height:9px;z-index:2}
.radar-dot.mine{opacity:1;z-index:3;box-shadow:0 0 0 1.5px var(--surface-2),0 0 0 3px var(--accent)}
.radar-dot.lab{z-index:4}
.radar-dot:hover,.radar-dot.hl{opacity:1;z-index:6;box-shadow:0 0 0 1.5px var(--surface-2),0 0 0 3.5px var(--fg)}
.radar-dot b{position:absolute;left:100%;top:50%;transform:translateY(-50%);margin-left:5px;font:600 10px var(--font);color:var(--fg);white-space:nowrap;pointer-events:none;text-shadow:0 0 3px var(--surface-2),0 0 3px var(--surface-2),0 0 2px var(--surface-2)}
.radar-dot.lf b{left:auto;right:100%;margin:0 5px 0 0}
.radar-dot.ping::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:1.5px solid var(--warn);animation:radarPing 1.7s ease-out infinite}
@keyframes radarPing{from{transform:scale(.7);opacity:1}to{transform:scale(2.6);opacity:0}}
.radar-ax{position:absolute;font:500 9.5px var(--font);color:var(--muted);pointer-events:none}
.radar-ax.y{left:6px;top:3px}
.radar-q{position:absolute;right:5px;top:4px;width:16px;height:16px;border-radius:50%;font:600 10px var(--font);color:var(--muted);border:1px solid var(--line-2);line-height:1;z-index:7;background:var(--surface-2)}
.radar-q:hover{color:var(--fg);border-color:var(--accent)}
.radar-pings{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;margin:0 0 8px;font-size:11px;color:var(--muted)}
.radar-pings:empty{display:none}
.radar-pg{display:inline-flex;align-items:center;gap:5px;padding:1px 7px;border-radius:10px;font-size:10.5px;color:var(--fg-2);background:color-mix(in srgb,var(--warn) 16%,transparent);white-space:nowrap}
.radar-pg b{color:var(--warn);font-weight:700}
.radar-pg.old{background:var(--surface-2)}
.radar-pg.old b{color:var(--fg-2)}
.radar-pg:hover{box-shadow:inset 0 0 0 1px var(--warn)}
.radar-list{display:grid;grid-template-columns:minmax(50px,auto) minmax(56px,1fr) auto auto 22px;column-gap:8px;margin:0 -12px}
.radar-cap,.radar-row{grid-column:1/-1;display:grid;grid-template-columns:subgrid;align-items:center;padding:8px 12px}
.radar-cap{padding-top:0;padding-bottom:5px;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.radar-cap .r{text-align:right}
.radar-row{row-gap:5px;border-top:1px solid color-mix(in srgb,var(--line) 60%,transparent);cursor:pointer;position:relative;scroll-margin-top:46px}
.radar-row:hover{background:color-mix(in srgb,var(--surface-2) 55%,transparent)}
.radar-row:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.radar-row.surge::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:var(--warn)}
.radar-s{display:flex;align-items:center;gap:5px;font-weight:600;white-space:nowrap}
.radar-me{width:5px;height:5px;border-radius:50%;background:var(--accent);flex:none}
.radar-rv{display:flex;align-items:center;gap:6px;min-width:0}
.radar-bar{position:relative;flex:1;min-width:18px;max-width:130px;height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden}
.radar-bar i{display:block;height:100%;border-radius:3px;background:var(--muted);transition:width .6s ease}
.radar-bar::after{content:"";position:absolute;left:20%;top:0;bottom:0;width:1.5px;background:var(--surface)}
.radar-rv b{flex:none;min-width:31px;font:600 11.5px var(--font);text-align:right;color:var(--fg-2)}
.radar-rv.l1 .radar-bar i{background:var(--fg-2)}
.radar-rv.l2 .radar-bar i{background:var(--accent)}
.radar-rv.l2 b{color:var(--accent)}
.radar-rv.l3 .radar-bar i{background:var(--warn)}
.radar-rv.l3 b{color:var(--warn)}
.radar-rv.old{opacity:.55}
.radar-rv.none b{color:var(--muted);font-weight:400}
.radar-p{text-align:right;white-space:nowrap;font-size:13px}
.radar-c{display:flex;justify-content:flex-end}
.radar-a{display:flex;justify-content:flex-end}
.radar-add{width:22px;height:22px;border-radius:6px;color:var(--muted);font-size:15px;line-height:20px;text-align:center}
.radar-add:hover{background:var(--surface-2);color:var(--accent)}
.radar-tags{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:4px}
.radar-tags:empty{display:none}
.radar-tag{font:500 10.5px/1.55 var(--font);padding:0 6px;border-radius:5px;background:var(--surface-2);color:var(--fg-2);white-space:nowrap}
.radar-tag.t-hot{color:var(--warn);background:color-mix(in srgb,var(--warn) 18%,transparent);font-weight:700}
.radar-tag.t-warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 14%,transparent);font-weight:600}
.radar-tag.t-info,.radar-tag.t-vol{color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent)}
.radar-tag.t-vol{font-weight:600}
.radar-tag.t-vol2{color:var(--warn);background:color-mix(in srgb,var(--warn) 16%,transparent);font-weight:700}
.radar-tag.t-up,.radar-tag.t-up2{color:var(--up);background:color-mix(in srgb,var(--up) 13%,transparent)}
.radar-tag.t-down,.radar-tag.t-down2{color:var(--down);background:color-mix(in srgb,var(--down) 13%,transparent)}
.radar-tag.t-up2,.radar-tag.t-down2{font-weight:700;box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 45%,transparent)}
.radar-tag.t-sup{color:var(--up);background:transparent;padding:0 2px}
.radar-tag.t-sdown{color:var(--down);background:transparent;padding:0 2px}
.radar-tag.t-fade{background:transparent;box-shadow:inset 0 0 0 1px var(--line-2)}
.radar-tag.t-xup,.radar-tag.t-xdown{background:transparent;border:1px dashed color-mix(in srgb,currentColor 45%,transparent);line-height:1.4}
.radar-tag.t-xup{color:var(--up)}
.radar-tag.t-xdown{color:var(--down)}
.radar-tag.t-rs{font-variant-numeric:tabular-nums}
.radar-gh{grid-column:1/-1;display:flex;align-items:baseline;gap:8px;padding:9px 12px 5px;font-size:11px;font-weight:600;color:var(--fg-2);border-top:1px solid var(--line)}
.radar-gh:first-child{border-top:0;padding-top:0}
.radar-gh span{margin-left:auto;font-weight:400;color:var(--muted)}
.radar-msg{grid-column:1/-1;padding:14px 12px;color:var(--muted);font-size:12px;text-align:center;border-top:1px solid color-mix(in srgb,var(--line) 60%,transparent)}
.radar-msg.slim{padding:6px 12px 8px;text-align:left;font-size:11.5px;border-top:0}
.radar-msg button{color:var(--accent);font-weight:600}
.radar-foot{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin-top:8px;padding-top:8px;border-top:1px solid color-mix(in srgb,var(--line) 60%,transparent);font-size:10.5px;line-height:1.45;color:var(--muted)}
.radar-foot .rbtn{padding:0}
.radar-foot p{margin:0;flex:1 1 220px}
.radar-foot u{text-decoration:underline dotted;text-underline-offset:2px;cursor:help}
@container radar (max-width: 372px){
  .radar-bar{display:none}
  .radar-list{column-gap:6px;grid-template-columns:minmax(46px,auto) minmax(30px,1fr) auto auto 20px}
  .radar-rv{justify-content:flex-start}
  .radar-top .seg button{padding:3px 6px}
}`;
  document.head.appendChild(st);
}
function rdBuild(body){
  rdCss();
  body.innerHTML = `<div class="radar">
    <div class="radar-top"><div class="seg" role="tablist" aria-label="Radar view">
        <button role="tab" data-rdv="inplay" title="Ranked by relative volume: today's volume against what is normal for the ticker by this time of day">In play</button>
        <button role="tab" data-rdv="rs" title="Today's move against SPY's: who is leading the market and who is lagging it">Leaders / laggards</button>
        <button role="tab" data-rdv="mine" title="Only your watchlist and holdings">Mine</button></div>
      <span class="radar-sp"></span>
      <button class="radar-ib" data-rdact="scope" aria-label="Show or hide the scope" title="Show or hide the scope: every ticker plotted by today's change and by volume against usual">${RD_ICON.scope}</button>
      <button class="radar-ib" data-rdact="filt" aria-label="Filters" title="Filters: leave out low-priced or thinly traded tickers">${RD_ICON.filt}</button></div>
    <div class="radar-filt hide">
      <label>Price at least <select data-rdf="minPx" aria-label="Lowest price to list">${RD_PX.map(v => `<option value="${v}">${v ? "$" + v : "Any"}</option>`).join("")}</select></label>
      <label title="Dollars traded this session on IEX, the one exchange in Alpaca's free feed (a few percent of all US trading; $1M there is roughly $40M market-wide)">Traded on IEX at least <select data-rdf="minDv" aria-label="Lowest dollar volume on IEX to list">${RD_DV.map(v => `<option value="${v}">${v ? "$" + v / 1e6 + "M" : "Any"}</option>`).join("")}</select></label>
      <button class="rbtn" data-rdact="clear">Clear</button></div>
    <div class="radar-note"></div>
    <div class="radar-st"><span class="radar-ses"><i></i><span></span></span><span class="radar-stx"></span></div>
    <div class="radar-scope hide"><i class="radar-zone"><b>In play</b></i><div class="radar-plot"><div class="radar-grid"></div><div class="radar-dots"></div></div>
      <span class="radar-ax y">Volume vs usual</span>
      <button class="radar-q" aria-label="How to read the scope" data-tip="Each dot is one ticker.\nSideways: its change today, losers on the left, winners on the right. The dashed line is SPY, so a dot to its right is beating the market.\nUpward: its volume against what is normal by this time of day. Above the 2× line it is in play.\nA ring in your accent color marks your own tickers; a pulsing ring is a volume surge in the last few minutes. Click a dot for its chart.">?</button></div>
    <div class="radar-pings"></div>
    <div class="radar-list"></div>
    <div class="radar-foot"></div></div>`;
  const q = s => body.querySelector(s);
  RADAR.els = {root:q(".radar"), seg:q(".seg"), filt:q(".radar-filt"), note:q(".radar-note"), ses:q(".radar-ses span"), stx:q(".radar-stx"), scope:q(".radar-scope"), zone:q(".radar-zone"), plot:q(".radar-plot"),
    grid:q(".radar-grid"), dots:q(".radar-dots"), pings:q(".radar-pings"), list:q(".radar-list"), foot:q(".radar-foot"), bScope:q('[data-rdact="scope"]'), bFilt:q('[data-rdact="filt"]')};
  RADAR.rowEls = new Map(); RADAR.dotEls = new Map(); RADAR.memo = {};
  body.addEventListener("click", e => {
    const v = e.target.closest("[data-rdv]"); if (v){ rdSet("view", v.dataset.rdv); rdSet("more", false); radarPaint(true); return; }
    const a = e.target.closest("[data-rdact]"); if (!a) return;
    const k = a.dataset.rdact, c = rdCfg();
    if (k === "scope") rdSet("scope", !c.scope);
    else if (k === "filt") rdSet("filt", !c.filt);
    else if (k === "more") rdSet("more", !c.more);
    else if (k === "clear"){ rdSet("minPx", 0); rdSet("minDv", 0); }
    radarPaint(true);
  });
  body.addEventListener("change", e => { const s = e.target.closest("[data-rdf]"); if (s){ rdSet(s.dataset.rdf, +s.value || 0); radarPaint(true); } });
  body.addEventListener("keydown", e => {
    const row = e.target.closest && e.target.closest(".radar-row"); if (!row || e.target !== row || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Enter" || e.key === " "){ e.preventDefault(); e.stopPropagation(); openChart(row.dataset.chart); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp"){ e.preventDefault(); e.stopPropagation();
      const rows = [...RADAR.els.list.querySelectorAll(".radar-row")], n = rows[rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)]; if (n) n.focus(); }
  });
  // the order waits while the pointer is moving over the list, and catches up when it leaves
  RADAR.els.list.addEventListener("pointermove", () => { RADAR.hoverAt = Date.now(); });
  RADAR.els.list.addEventListener("pointerleave", () => { RADAR.hoverAt = 0; if (Date.now() - RADAR.rankAt >= RD_RERANK){ RADAR.sig = ""; radarPaint(); } });
  // a row and its dot point at each other
  const hl = (sym, on) => { const d = RADAR.dotEls.get(sym); if (d) d.classList.toggle("hl", on); };
  RADAR.els.list.addEventListener("pointerover", e => { const r = e.target.closest(".radar-row"); if (r && r.dataset.chart !== RADAR.hl){ if (RADAR.hl) hl(RADAR.hl, false); RADAR.hl = r.dataset.chart; hl(RADAR.hl, true); } });
  RADAR.els.list.addEventListener("pointerleave", () => { if (RADAR.hl) hl(RADAR.hl, false); RADAR.hl = ""; });
}
const rdPut = (el, html, key) => { const m = RADAR.memo; if (m[key] !== html){ m[key] = html; el.innerHTML = html; } };

/* one row's cells, as HTML strings (a cell is only touched when its string changes) */
function rdCells(r, x){
  const ph = x.ph, pre = ph === "pre", sym = esc(r.sym), mine = x.watch.has(r.sym) || x.held.has(r.sym);
  const why = x.watch.has(r.sym) && x.held.has(r.sym) ? "You hold it and it is on your watchlist" : x.held.has(r.sym) ? "One of your holdings" : "On your watchlist";
  const s = `<b>${sym}</b>${mine ? `<i class="radar-me" data-tip="${why}"></i>` : ""}`;
  let rv;
  if (r.rvol != null){
    const lv = r.rvol >= 5 ? "l3" : r.rvol >= 2 ? "l2" : r.rvol >= 1 ? "l1" : "l0", usual = r.live && r.rvol > 0 ? r.v / r.rvol : r.av;
    const tip = pre ? `Last session (${rdMd(r.day)}): ${rdX(r.rvol)} its 20-day average volume.\nToday's volume starts counting at the open.`
      : r.live ? `${rdX(r.rvol)} its usual volume for this time of day.\n${rdN(r.v)} shares so far on IEX; about ${rdN(usual)} is normal by now (a normal full day is ${rdN(r.av)}).`
      : `${rdX(r.rvol)} its 20-day average volume.\n${rdN(r.v)} shares on IEX in that session; a normal day is ${rdN(r.av)}.`;
    rv = {cls:"radar-rv " + lv + (pre ? " old" : ""), tip, html:`<span class="radar-bar"><i style="width:${Math.min(100, r.rvol * 20).toFixed(1)}%"></i></span><b class="num">${rdX(r.rvol)}</b>`};
  } else rv = {cls:"radar-rv none", html:`<b class="num">—</b>`,
    tip: r.noVol ? "Relative volume needs Alpaca's feed: the prices MW has without it carry no volume." : r.stale ? "No trade on IEX in today's session yet." : r.thin ? "Too little volume on IEX to measure against (under 20,000 shares on an average day, or under 10 days of history)." : RADAR.baseBusy || !RADAR.base.date ? "The 20-day averages are still loading." : "No daily history for this ticker on IEX."};
  const p = pre && r.ext ? `<span data-tip="The latest pre-market trade on IEX, at ${esc(timeStr(r.ext.t))}">${fmtPx(r.last)}</span>` : pre ? `<span class="muted" data-tip="No pre-market trade on IEX yet: this is the last close">${fmtPx(r.last)}</span>` : fmtPx(r.last);
  const c = dchg(r.moveUsd, r.move, {px:r.last, none: pre ? "no trade yet" : "—",
    tip: pre ? (r.ext ? "The latest pre-market trade against the last close (" + fmtPx(r.px) + ")" : "No pre-market trade on IEX yet: the price is the last close") : r.stale ? "No trade in today's session yet" : (r.live ? "Today's change" : "The change in that session") + ", for one share and in percent, from the previous close" + (r.pc ? " (" + fmtPx(r.pc) + ")" : "")
      + (r.gapPct != null && r.sinceOpen != null ? `.\nIt opened ${fmtPct(r.gapPct)} from that close and ${r.live ? "is" : "finished"} ${fmtPct(r.sinceOpen)} ${r.live ? "since" : "from"} the open.` : "")});
  const a = x.watch.has(r.sym) ? "" : `<button class="radar-add" data-wadd="${sym}" aria-label="Add ${sym} to your watchlist" data-tip="Add ${sym} to your watchlist">+</button>`;
  const T = E.radarTags(r, {ph, today:x.today, er:rdEarn(r.sym, x.today), news:x.news[r.sym], ping:x.hot[r.sym], time:timeStr});
  let tags = T.map(t => `<span class="radar-tag t-${t.tone}" data-rdt="${t.k}" data-tip="${esc(t.tip)}">${esc(t.t)}</span>`).join("");
  if (x.view === "rs" && r.rs != null) tags = `<span class="radar-tag t-rs ${r.rs > 0 ? "t-up" : r.rs < 0 ? "t-down" : ""}" data-rdt="rs" data-tip="${esc(`${r.sym} ${fmtPct(r.move)} against SPY ${fmtPct(x.spy)}: ${Math.abs(r.rs).toFixed(2)} percentage points ${r.rs >= 0 ? "ahead of" : "behind"} the market${pre ? " in the pre-market" : ""}.`)}">vs SPY ${sgn(r.rs)}${Math.abs(r.rs).toFixed(2)} pts</span>` + tags;
  return {s, rv, p, c, a, tags, T, surge:!!x.hot[r.sym]};
}
function rdRowEl(sym){
  const el = document.createElement("div"); el.className = "radar-row"; el.setAttribute("role", "button"); el.tabIndex = 0; el.dataset.chart = sym; el.dataset.rdsym = sym;
  el.innerHTML = `<span class="radar-s"></span><span class="radar-rv"></span><span class="radar-p num"></span><span class="radar-c"></span><span class="radar-a"></span><span class="radar-tags"></span>`;
  el._c = {}; return el;
}
function rdFill(el, C, r){
  const k = el.children, set = (i, key, html) => { if (el._c[key] !== html){ el._c[key] = html; k[i].innerHTML = html; } };
  set(0, "s", C.s);
  if (el._c.rv !== C.rv.html){ el._c.rv = C.rv.html; const bar = k[1].querySelector(".radar-bar i"), w = /width:([\d.]+%)/.exec(C.rv.html);
    // an existing bar slides to its new length instead of being redrawn
    if (bar && w && k[1].querySelector("b")){ bar.style.width = w[1]; k[1].querySelector("b").textContent = rdX(r.rvol); } else k[1].innerHTML = C.rv.html; }
  if (k[1].className !== C.rv.cls) k[1].className = C.rv.cls;
  if (k[1].dataset.tip !== C.rv.tip) k[1].dataset.tip = C.rv.tip;
  set(2, "p", C.p); set(3, "c", C.c); set(4, "a", C.a); set(5, "tags", C.tags);
  el.classList.toggle("surge", C.surge);
  const lab = `${r.sym}, ${fmtPx(r.last)}, ${chgTxt(r.moveUsd, r.move, 2, r.last) || "no change yet"}${r.rvol != null ? ", " + rdX(r.rvol) + " usual volume" : ""}. Open the chart.`;
  if (el._c.lab !== lab){ el._c.lab = lab; el.setAttribute("aria-label", lab); }
}
/* put the list in order without rebuilding it: rows keep their elements, and a row that changes place slides there */
function rdSync(items){
  const L = RADAR.els.list, keep = new Set(items.map(i => i.key)), before = new Map();
  const calm = !window.matchMedia || !matchMedia("(prefers-reduced-motion: reduce)").matches;
  RADAR.rowEls.forEach((el, key) => { if (!keep.has(key)){ el.remove(); RADAR.rowEls.delete(key); } else if (el.classList.contains("radar-row")) before.set(key, el.getBoundingClientRect().top); });
  let moved = false;
  items.forEach((it, i) => {
    let el = RADAR.rowEls.get(it.key);
    if (!el){ el = it.sym ? rdRowEl(it.sym) : document.createElement("div"); RADAR.rowEls.set(it.key, el); }
    if (it.sym) rdFill(el, it.C, it.r); else { if (el.className !== it.cls) el.className = it.cls; if (el._h !== it.html){ el._h = it.html; el.innerHTML = it.html; } }
    if (L.children[i] !== el){ L.insertBefore(el, L.children[i] || null); moved = true; }
  });
  if (moved && calm && before.size && before.size <= 60) RADAR.rowEls.forEach((el, key) => { const y0 = before.get(key); if (y0 == null || !el.animate) return;
    const dy = y0 - el.getBoundingClientRect().top; if (Math.abs(dy) > 1) el.animate([{transform:`translateY(${dy}px)`}, {transform:"none"}], {duration:420, easing:"cubic-bezier(.2,.7,.2,1)"}); });
}
function rdScope(list, x){
  const els = RADAR.els, c = rdCfg(), show = c.scope && alpOn() && x.ph !== "pre" && list.length > 0;
  els.scope.classList.toggle("hide", !show);
  els.bScope.setAttribute("aria-pressed", String(!!c.scope)); els.bScope.classList.toggle("hide", !alpOn() || x.ph === "pre");
  if (!show) return;
  const {cap, top} = RADAR.scale, xy = (m, v) => E.radarXY(m, v, cap, top), yOf = v => (1 - xy(0, v).y) * 100;
  const pc = v => (Math.abs(v) < 1 && v !== 0 ? Math.abs(v).toFixed(1) : String(Math.abs(v))) + "%";
  const hl = [0.5, 1, 2, 4, 8, 16].filter(v => v < top).map(v => `<i class="radar-hl${v === 1 ? " one" : ""}" style="top:${yOf(v).toFixed(2)}%"><b>${v}×</b></i>`).join("");
  const vl = [-1, -0.5, 0, 0.5, 1].map(f => `<i class="radar-vl${f === 0 ? " zero" : f === -1 ? " first" : f === 1 ? " last" : ""}" style="left:${(50 + f * 50).toFixed(1)}%"><b>${f === 0 ? "0%" : (f < 0 ? "−" : "+") + pc(cap * f)}</b></i>`).join("");
  const spy = x.spy != null && c.view !== "mine" ? `<i class="radar-vl spy" style="left:${(xy(x.spy, 1).x * 100).toFixed(2)}%" data-tip="SPY is ${x.spy > 0 ? "up" : x.spy < 0 ? "down" : "flat"}${x.spy ? " " + Math.abs(x.spy).toFixed(2) + "%" : ""}: dots to the right of this line are beating the market"><b>SPY</b></i>` : "";
  rdPut(els.grid, hl + vl + spy, "grid");
  els.zone.style.height = `calc(16px + ${(yOf(2) / 100).toFixed(4)} * (100% - 36px))`;
  // dots: one element per ticker, kept and moved
  const keep = new Set(list.map(r => r.sym)), W = els.plot.clientWidth, H = els.plot.clientHeight, placed = [], labs = new Set(RADAR.lab);
  // a name never sits on top of another in-play dot
  const dots = list.filter(r => r.rvol >= 2 || labs.has(r.sym)).map(r => { const p = xy(r.move, r.rvol), px = p.x * W, py = (1 - p.y) * H; return {sym:r.sym, x0:px - 7, x1:px + 7, y0:py - 7, y1:py + 7}; });
  Object.keys(x.hot).forEach(s => labs.add(s));
  RADAR.dotEls.forEach((el, s) => { if (!keep.has(s)){ el.remove(); RADAR.dotEls.delete(s); } });
  const order = list.slice().sort((a, b) => (labs.has(b.sym) ? 1 : 0) - (labs.has(a.sym) ? 1 : 0) || b.rvol - a.rvol);
  order.forEach(r => {
    const p = xy(r.move, r.rvol); let el = RADAR.dotEls.get(r.sym);
    if (!el){ el = document.createElement("i"); el.dataset.chart = r.sym; els.dots.appendChild(el); RADAR.dotEls.set(r.sym, el); }
    const left = (p.x * 100).toFixed(2) + "%", topP = ((1 - p.y) * 100).toFixed(2) + "%";
    if (el.style.left !== left) el.style.left = left;
    if (el.style.top !== topP) el.style.top = topP;
    // a name next to the dot, when there is room for it (the busiest tickers get first pick)
    let lab = "", side = "";
    if (labs.has(r.sym) && W > 0){
      const w = r.sym.length * 6.6 + 4, px = p.x * W, py = (1 - p.y) * H, tryBox = lf => ({x0: lf ? px - 9 - w : px + 9, x1: lf ? px - 9 : px + 9 + w, y0: py - 7, y1: py + 7});
      const hit = (b, o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0;
      const free = b => b.x0 >= -26 && b.x1 <= W + 10 && !placed.some(o => hit(b, o)) && !dots.some(o => o.sym !== r.sym && hit(b, o));
      const R = tryBox(false), Lf = tryBox(true), pick = free(R) ? R : free(Lf) ? Lf : null;
      if (pick){ placed.push(pick); lab = r.sym; side = pick === Lf ? " lf" : ""; }
    }
    const mine = x.watch.has(r.sym) || x.held.has(r.sym), hot = x.hot[r.sym];
    const cls = "radar-dot" + (r.move > 0 ? " up" : r.move < 0 ? " down" : "") + (r.rvol >= 2 ? " hot" : r.rvol >= 1 ? " mid" : "") + (mine ? " mine" : "") + (hot ? " ping" : "") + (lab ? " lab" + side : "") + (RADAR.hl === r.sym ? " hl" : "");
    if (el.className !== cls) el.className = cls;
    if (el._l !== lab){ el._l = lab; el.innerHTML = lab ? `<b>${esc(lab)}</b>` : ""; }
    const T = x.cells[r.sym] ? x.cells[r.sym].T : E.radarTags(r, {ph:x.ph, today:x.today, er:rdEarn(r.sym, x.today), news:x.news[r.sym], ping:hot, time:timeStr});
    const tip = `${r.sym}  ${fmtPx(r.last)}  ${chgTxt(r.moveUsd, r.move, 2, r.last)}\n${rdX(r.rvol)} its usual volume${r.live ? " for this time of day" : ""}${T.length ? "\n" + T.map(t => t.t).join(" · ") : ""}`;
    if (el.dataset.tip !== tip) el.dataset.tip = tip;
  });
}
function radarPaint(force){
  const S = RADAR.sec; if (!S) return;
  const now = Date.now(), on = alpOn(), c = rdCfg(), view = rdView(), mine = mySyms(), open = !settings.collapsed.radar && !settings.compact;
  if (!open){ if (RADAR.sum !== "shut"){ RADAR.sum = "shut"; S.sum.innerHTML = `<span class="muted">Open to scan</span>`; } RADAR.sig = ""; return; }
  let nv = 0; try{ nv = (typeof wireV === "number" ? wireV : 0) + ":" + ((news && news.at) || 0); }catch(e){}
  const sig = [RADAR.ver, on ? 1 : 0, settings.alpKey ? 1 : 0, view, c.minPx, c.minDv, c.more, c.scope, c.filt, mine.join(), cfg.holdings.length, E.radarPhase(now, clockOpts()).ph, Math.floor(now / 60e3),
    on ? "" : lastUpdate, RADAR.busy ? 1 : 0, RADAR.baseBusy ? 1 : 0, nv, settings.tz, document.body.clientWidth].join("|");
  if (!force && sig === RADAR.sig) return;
  RADAR.sig = sig;
  if (!RADAR.els) rdBuild(S.body);
  const els = RADAR.els;
  radarCompute(now); radarRank(now, !!force);
  const ph = RADAR.ph, rows = RADAR.rows, O = RADAR.order, st = RADAR.st, today = ph.date;
  // the order is from the last ranking; only tickers that still have a row are drawn
  const o = {inplay:(O.inplay || []).filter(s => rows[s]), rs:(O.rs || []).filter(s => rows[s] && rows[s].rs != null), mine:(O.mine || []).filter(s => rows[s]), pass:O.pass || new Set()};
  const watch = new Set(cfg.watch.map(w => (w.sym || "").toUpperCase())), held = new Set(cfg.holdings.map(h => (h.sym || "").toUpperCase()));
  const hot = {}; if (on) Object.keys(RADAR.pings).forEach(s => { if (ph.ph === "open" && now - RADAR.pings[s].t <= RD_PING_HOT) hot[s] = RADAR.pings[s]; });
  const x = {ph:ph.ph, today, view, watch, held, hot, news:rdNews(now), spy:RADAR.spy, cells:{}};
  const have = Object.keys(rows).length > 0, baseReady = on && Object.values(rows).some(r => r.av != null);
  els.root.dataset.ph = ph.ph;

  // toolbar
  els.seg.classList.toggle("hide", !on);
  els.seg.querySelectorAll("[data-rdv]").forEach(b => { const sel = b.dataset.rdv === view; b.classList.toggle("on", sel); b.setAttribute("aria-selected", String(sel)); });
  const filtOn = c.minPx > 0 || c.minDv > 0;
  els.bFilt.classList.toggle("hide", !on); els.bFilt.classList.toggle("set", filtOn); els.bFilt.setAttribute("aria-pressed", String(!!c.filt));
  els.filt.classList.toggle("hide", !on || !c.filt);
  els.filt.querySelectorAll("[data-rdf]").forEach(s => { const v = String(c[s.dataset.rdf] || 0); if (s.value !== v && document.activeElement !== s) s.value = v; });
  els.filt.querySelector('[data-rdact="clear"]').classList.toggle("hide", !filtOn);

  // notes: no key, or the feed is failing
  const keys = !!(settings.alpKey && settings.alpSec);
  rdPut(els.note, !on ? `<div class="callout"><b>${keys ? "Fast prices are switched off" : "Add your free Alpaca key to scan the market"}</b>${keys
      ? "The radar scans with the same Alpaca feed. Turn Fast prices back on in Settings and it will measure relative volume on about 150 liquid stocks and funds plus your own tickers."
      : "With it the radar measures relative volume, the surest sign a stock is in play, on about 150 liquid stocks and funds plus your own tickers. A free Alpaca paper account is enough, and its keys can only read prices."}
      Until then your own tickers are ranked by today's move from the prices MW already has. Those carry no volume, so the volume column stays blank.<br><button class="btn" data-open="general">Open Settings</button></div>`
    : st.err ? `<div class="err">The radar couldn't reach Alpaca: ${esc(st.err)}${st.wait ? ` Trying again at ${esc(timeStr(st.at + st.wait))}.` : ""}${st.okAt ? " Showing the last read." : ""}</div>`
    : RADAR.base.err && !baseReady ? `<div class="err">The 20-day averages didn't load (${esc(RADAR.base.err)}), so relative volume can't be measured yet. Trying again at ${esc(timeStr(RADAR.base.errAt + 10 * 60e3))}.</div>` : "", "note");

  // where the market is, and how fresh the read is
  const sesTxt = ph.ph === "open" ? "Market open" : ph.ph === "pre" ? "Pre-market" : ph.ph === "after" ? "After hours" : "Last session · " + rdMd(ph.sess);
  if (els.ses.textContent !== sesTxt) els.ses.textContent = sesTxt;
  const nRows = Object.keys(rows).length, upd = on ? (st.okAt ? "updated " + dateTime(st.okAt) : "") : (lastUpdate ? "prices from " + dateTime(lastUpdate) : "");
  const stx = !on ? [nRows + (nRows === 1 ? " ticker" : " tickers") + " of yours", upd]
    : ph.ph === "pre" ? ["ranked by gap from the close", upd]
    : ph.ph === "open" ? [nRows + " tickers", upd]
    : [ph.ph === "after" ? "today's final ranking" : "final ranking", nRows + " tickers", upd];
  rdPut(els.stx, esc(stx.filter(Boolean).join(" · ")) + (RADAR.baseBusy ? " · loading 20-day averages…" : ""), "stx");

  // the list
  const items = [], cell = sym => { const r = rows[sym]; return {key:sym, sym, r, C:(x.cells[sym] = rdCells(r, x))}; };
  const cap = `<span>Ticker</span><span data-tip="${ph.ph === "pre" ? "The last session's volume against the ticker's 20-day average. Today's volume starts counting at the open." : "Today's volume so far against what is normal for the ticker by this time of day (its 20-day average, IEX). 1× is a normal day; the mark on the bar is 1× and a full bar is 5×."}">${ph.ph === "pre" ? "Volume, last session" : on ? "Volume vs usual" : "Volume"}</span><span class="r">${ph.ph === "pre" ? "Pre-market" : "Price"}</span><span class="r">${ph.ph === "pre" ? "Since close" : ph.ph === "open" ? "Today" : "Day"}</span><span></span>`;
  const msg = (key, html, slim) => items.push({key, cls:"radar-msg" + (slim ? " slim" : ""), html});
  const clearBtn = ` <button data-rdact="clear">Clear the filters</button>`;
  let more = "";
  if (!have){
    msg("m:none", on ? (st.err ? "Nothing to show until Alpaca answers." : "Scanning " + E.radarUniverse(mine).length + " tickers…") : mine.length ? "Waiting for the first prices…" : `No tickers yet. <button data-open="alerts">Add a ticker to your watchlist</button> and it shows here.`);
  } else if (view === "inplay"){
    const N = c.more ? 25 : 10, top = o.inplay.slice(0, N), best = top.length ? E.radarScore(rows[top[0]], "inplay", ph.ph) : 0;
    if (top.length) items.push({key:"cap", cls:"radar-cap", html:cap});
    if (!top.length) msg("m:empty", !baseReady && ph.ph !== "pre" ? "Measuring what is normal for each ticker (20-day averages)…" : ph.ph === "pre" ? "No pre-market trades yet on IEX." + (filtOn ? clearBtn : "") : filtOn ? "Nothing passes your filters." + clearBtn : "Nothing to rank yet.");
    else if (ph.ph !== "pre" && best < 1.5) msg("m:quiet", "A quiet tape: nothing is trading at even 1.5 times its usual volume. The busiest are listed anyway.", true);
    top.forEach(s => items.push(cell(s)));
    if (o.inplay.length > 10) more = `<button class="rbtn" data-rdact="more">${c.more ? "Show the top 10" : "Show the top " + Math.min(25, o.inplay.length)}</button>`;
  } else if (view === "rs"){
    const N = c.more ? 10 : 5, lead = o.rs.filter(s => rows[s].rs > 0).slice(0, N), lag = o.rs.filter(s => rows[s].rs < 0).slice(-N).reverse();
    if (RADAR.spy == null) msg("m:nospy", ph.ph === "pre" ? "SPY has not traded in the pre-market yet, so there is nothing to compare against." : "Waiting for SPY's price to compare against.");
    else {
      const spyTxt = `SPY ${fmtPct(RADAR.spy)}${ph.ph === "pre" ? " pre-market" : ""}`;
      items.push({key:"cap", cls:"radar-cap", html:cap});
      items.push({key:"g:lead", cls:"radar-gh", html:`Leading the market<span class="num">${esc(spyTxt)}</span>`});
      if (!lead.length) msg("m:nolead", "Nothing is ahead of SPY" + (filtOn ? " with your filters." : "."), true);
      lead.forEach(s => items.push(cell(s)));
      items.push({key:"g:lag", cls:"radar-gh", html:`Lagging the market`});
      if (!lag.length) msg("m:nolag", "Nothing is behind SPY" + (filtOn ? " with your filters." : "."), true);
      lag.forEach(s => items.push(cell(s)));
      if (o.rs.length > 10) more = `<button class="rbtn" data-rdact="more">${c.more ? "Show 5 each" : "Show 10 each"}</button>`;
    }
  } else {
    if (!o.mine.length) msg("m:nomine", mine.length ? "Waiting for prices for your tickers…" : `No tickers yet. <button data-open="alerts">Add a ticker to your watchlist</button> and it shows here.`);
    else items.push({key:"cap", cls:"radar-cap", html:cap});
    o.mine.forEach(s => items.push(cell(s)));
  }
  rdSync(items);

  // the scope and the surges under it
  const plot = !on ? [] : (view === "mine" ? o.mine.map(s => rows[s]) : Object.values(rows).filter(r => o.pass.has(r.sym))).filter(r => r && r.rvol != null && r.move != null);
  rdScope(plot, x);
  const pg = on && ph.ph === "open" ? Object.keys(RADAR.pings).filter(s => rows[s]).sort((a, b) => RADAR.pings[b].t - RADAR.pings[a].t).slice(0, 6) : [];
  rdPut(els.pings, pg.length ? `<span>Volume surges</span>` + pg.map(s => { const k = RADAR.pings[s];
    return `<button class="radar-pg${hot[s] ? "" : " old"}" data-chart="${esc(s)}" data-tip="${esc(`${s}: about ${Math.round(k.x)} times its usual volume for one minute at ${timeStr(k.t)} (${rdN(k.v)} shares on IEX). Click for the chart.`)}"><b>${esc(s)}</b><span class="num">${esc(timeStr(k.t))}</span></button>`; }).join("") : "", "pings");

  // footer: more rows, and what the number is
  rdPut(els.foot, more + (on ? `<p><u data-tip="Relative volume = today's volume so far ÷ (the ticker's 20-day average full-day volume × the share of a day's volume that has normally traded by this minute).\nThat share is one typical curve for US stocks (busy open, quiet midday, busy close), so the number is an estimate during the day and exact at the close.\nVolumes are IEX's, one exchange and a few percent of all US trading, compared with IEX's own average, so the ratio is like for like. Tickers too thin there are not measured.">Relative volume</u> shows where the attention is today. It does not say which way to trade.</p>` : ""), "foot");

  // header
  const inPlay = !on ? 0 : ph.ph === "pre" ? o.inplay.filter(s => rows[s].ext && rows[s].ext.big).length : o.inplay.filter(s => rows[s].rvol >= 2).length;
  const sum = !on ? `<span class="muted">${nRows ? "your tickers" : ""}</span>` : !have ? `<span class="muted">${st.err ? "no data" : "scanning…"}</span>`
    : `<span class="muted">${ph.ph === "open" ? "" : esc(ph.ph === "pre" ? "Pre-market · " : ph.ph === "after" ? "After hours · " : "Last session · ")}</span><span>${inPlay} ${ph.ph === "pre" ? "gapping" : "in play"}</span>`;
  if (RADAR.sum !== sum){ RADAR.sum = sum; S.sum.innerHTML = sum; }
}

/* ---------- start ---------- */
/* The first time the radar exists it starts closed: opening it is what starts the scan (about 150 tickers every
   30 seconds), so it costs nothing until you ask for it. After that it stays the way you leave it. */
if (!settings.radarInit){ settings.radarInit = 1; settings.collapsed.radar = true; saveSettings(); }
RADAR.sec = registerSection({key:"radar", name:"In-play radar", render(){ radarPaint(); radarLoop(); }});
safe("radar", () => { radarPaint(); radarLoop(); });   // registerSection drew once before RADAR.sec was set
setInterval(() => { safe("radar", () => { radarPaint(); radarLoop(); }); }, 5000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) safe("radar", () => { radarPaint(); radarLoop(); }); });
