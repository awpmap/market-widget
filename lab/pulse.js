"use strict";
/* =====================================================================
   Market pulse (6.3): risk-on or risk-off at a glance, from the market's internals rather than its prices.
   Markets already shows the indexes, the sector heatmap and the tiles; this section reads what sits underneath:
   - Leadership: six pairs of funds (chips vs the S&P 500, Nasdaq vs S&P, small caps vs S&P, high beta vs low
     volatility, discretionary vs staples, junk bonds vs Treasuries), as how A did against B today, over 5 and over
     20 sessions, with the 20-day line of the ratio.
   - Cross-asset: volatility (VIXY), the dollar (UUP), bitcoin, long bonds (TLT), gold (GLD), oil (USO).
   - Breadth: how many of the 11 S&P sector funds are up today, and how many trade above their 20-day average.
   - A Risk appetite reading from -100 to +100 that blends them (E.pulseScore in engine.js), and one line saying why.
   An indicator, not advice. Runs on top of app.js (same page, same globals). Public build: no personal data here.

   Data, staying inside the free limits (nothing is fetched unless the section is open and on screen):
   - With an Alpaca key: every fund in one snapshot call, every 20 s in market hours, pre-market and after hours,
     every 10 minutes while the market is closed (3 calls a minute at most). Daily bars for the 5- and 20-day
     figures: one call (24 funds, about 45 days) once a day, kept in this browser.
   - Without one: Finnhub, one fund every 3 s through MW's shared limit (background lane, about 20 a minute), and
     only the funds MW isn't already pricing for Markets. Daily history from Twelve Data when you have that key
     (MW loads most of these funds anyway; the 3 or so it doesn't cost one credit each, once a day).
   - Bitcoin: Alpaca's crypto feed, which needs no key, every 30 s (every 2 minutes while stocks are closed).
   - Closed (collapsed) or hidden, the header still shows a reading from the prices MW already has, at no cost.
   ===================================================================== */
(function(){
const P = E.PULSE, SYMS = E.pulseSyms(), BTC = "BTC/USD", BASE = "https://data.alpaca.markets/";
const PS = {q: store.get("pulseQ", {}), bars: store.get("pulseBars", {date:"", c:{}}), at:0, err:"", fails:0, pauseUntil:0, cAt:0, cErr:"",
  busy:false, cBusy:false, bBusy:false, fhBusy:false, fhAt:0, tdDay:"", log:[], sig:"", savedAt:0, how:false, last:null};
window.__pulse = PS;   // for the browser harness

/* plain words for every line (one sentence each, shown on hover or focus) */
const PAIR_TXT = {
  chips:    {name:"Chips vs S&P 500", tip:"SMH (chip makers) against SPY (the S&P 500). Above zero: chips are leading, the AI-hardware trade is in charge."},
  growth:   {name:"Nasdaq vs S&P 500", tip:"QQQ (the Nasdaq 100) against SPY. Above zero: big growth and tech names are leading the market."},
  small:    {name:"Small caps vs S&P 500", tip:"IWM (Russell 2000 small caps) against SPY. Small caps lead when investors reach for risk."},
  beta:     {name:"High beta vs low vol", tip:"SPHB (the S&P 500's most volatile stocks) against SPLV (its calmest). The plainest risk-on or risk-off read there is."},
  consumer: {name:"Discretionary vs staples", tip:"XLY (shopping, travel, cars) against XLP (food and household goods). Above zero: consumers' risk appetite is up."},
  credit:   {name:"Junk bonds vs Treasuries", tip:"HYG (high-yield bonds) against IEF (7 to 10 year Treasuries). Junk beating Treasuries means credit markets are at ease with risk."}
};
const CROSS_TXT = {
  vol:    {name:"Volatility", tip:"VIXY tracks VIX futures. Rising volatility means traders are paying up for protection (counts toward risk-off)."},
  dollar: {name:"US dollar", tip:"UUP tracks the dollar against major currencies. A firmer dollar tightens money around the world (counts lightly toward risk-off)."},
  btc:    {name:"Bitcoin", tip:"Bitcoin since midnight UTC (it trades around the clock): a quick read on speculative appetite (counts lightly)."},
  rates:  {name:"Long bonds", tip:"TLT holds 20+ year Treasuries and rises when long-term rates fall. Shown for context, not scored."},
  gold:   {name:"Gold", tip:"GLD tracks gold, the classic haven. Shown for context, not scored."},
  oil:    {name:"Oil", tip:"USO tracks oil futures. Shown for context, not scored."}
};
const SECT_NAME = {XLK:"Tech", XLC:"Comms", XLY:"Discretionary", XLF:"Financials", XLV:"Healthcare", XLI:"Industrials", XLE:"Energy", XLB:"Materials", XLU:"Utilities", XLP:"Staples", XLRE:"Real estate"};
const METHOD = "Risk appetite, from −100 (risk-off) to +100 (risk-on). Each line becomes a reading from −1 to +1 against a typical move, and the readings are averaged with weights: the six pairs (today 50%, 5 days 30%, 20 days 20%), volatility, the dollar and bitcoin (lighter), sectors up today and sectors above their 20-day average. +15 and up reads Risk-on, +40 Strong; −15 and below Risk-off. An indicator, not advice.";

/* ---------- prices ---------- */
const lastMin = kind => { const t = Date.now() - 60e3; PS.log = PS.log.filter(x => x.t > t); return PS.log.filter(x => !kind || x.k === kind).length; };
const logCall = k => PS.log.push({t:Date.now(), k});
/* the pulse's own quote, or MW's regular one when that is newer (funds MW already prices for Markets) */
function pq(sym){
  const a = PS.q[sym], b = sym === BTC ? null : quotes[sym];
  if (!(b && b.c > 0 && b.at)) return a && a.c > 0 ? a : null;
  if (a && a.c > 0 && (a.at || 0) >= b.at) return a;
  return {c:b.c, pc:b.pc, dp: b.pc > 0 ? (b.c / b.pc - 1) * 100 : b.dp, at:b.at, src:b.src || "finnhub"};
}
/* completed daily closes, oldest first: Alpaca's bars when we have them, else MW's own daily history */
function closes(sym){
  const today = etNow().date, a = PS.bars.c && PS.bars.c[sym];
  if (Array.isArray(a) && a.length) return a.filter(x => x[0] < today);
  const m = typeof barsMem !== "undefined" && barsMem[sym];
  if (Array.isArray(m) && m.length) return m.filter(x => x[0] < today).slice(0, 60).reverse().map(x => [x[0], x[4]]);
  return null;
}
function save(force){ const now = Date.now(); if (!force && now - PS.savedAt < 60e3) return; PS.savedAt = now; store.set("pulseQ", PS.q); }
async function snap(){
  PS.busy = true; const t0 = Date.now();
  try{
    logCall("alpaca"); const out = await alpSnap(SYMS), now = Date.now(); let n = 0;
    Object.keys(out || {}).forEach(s => { const v = E.mapSnap(out[s], now); if (v){ v.at = now; PS.q[s] = v; n++; } });
    Object.assign(PS, {at:now, err: n ? "" : "Alpaca sent no prices", fails:0, ms:now - t0, src:"alpaca"}); save();
  }catch(e){
    PS.fails++; PS.err = e.message; PS.at = Date.now();
    PS.pauseUntil = Date.now() + (e.auth ? 10 * 60e3 : Math.min(10 * 60e3, 15e3 * 2 ** Math.min(6, PS.fails)));
    if (PS.fails <= 2) mwLog("warn", "market pulse: " + e.message);
  }finally{ PS.busy = false; }
  paint();
}
async function coin(){
  PS.cBusy = true; PS.cAt = Date.now();
  try{
    logCall("crypto");
    const r = await fetchT(BASE + "v1beta3/crypto/us/snapshots?symbols=" + encodeURIComponent(BTC), {headers:alpHdr(), cache:"no-store"}, 8000);
    if (!r.ok) throw new Error("Alpaca's crypto feed answered " + r.status);
    const j = await r.json(), v = E.mapCryptoSnap((j.snapshots || {})[BTC], Date.now());
    if (v){ v.at = Date.now(); PS.q[BTC] = v; } PS.cErr = "";
  }catch(e){ PS.cErr = e.message; }
  finally{ PS.cBusy = false; }
  paint();
}
/* daily bars for the 5- and 20-day figures: one call, once a day */
async function loadBars(){
  const today = etNow().date, b = PS.bars;
  if (PS.bBusy || (b.date === today && !b.err) || (b.err && Date.now() - (b.errAt || 0) < 10 * 60e3)) return;
  PS.bBusy = true;
  try{
    const acc = {}; let tok = "", guard = 0;
    do {
      logCall("alpaca");
      const r = await fetchT(BASE + "v2/stocks/bars?feed=iex&timeframe=1Day&adjustment=split&limit=10000&start=" + E.addDays(today, -45) + "&symbols=" + SYMS.join(",") + (tok ? "&page_token=" + encodeURIComponent(tok) : ""), {headers:alpHdr(), cache:"no-store"}, 15000);
      if (!r.ok) throw new Error("Alpaca daily bars answered " + r.status);
      const j = await r.json();
      Object.entries(j.bars || {}).forEach(([s, a]) => { (acc[s] || (acc[s] = [])).push(...a.map(x => [E.etDateOf(Date.parse(x.t)), +x.c]).filter(x => x[1] > 0)); });
      tok = j.next_page_token || "";
    } while (tok && ++guard < 5);
    Object.values(acc).forEach(a => a.sort((x, y) => x[0] < y[0] ? -1 : 1));
    PS.bars = {date:today, c:acc}; store.set("pulseBars", PS.bars);
  }catch(e){ PS.bars = Object.assign({}, PS.bars, {err:e.message, errAt:Date.now()}); mwLog("warn", "market pulse: " + e.message); }
  finally{ PS.bBusy = false; }
  PS.sig = ""; paint();
}
/* without Alpaca: one Finnhub quote at a time for the funds MW isn't already pricing */
function fhStep(){
  if (PS.fhBusy || !settings.key || E.breakerOpen(fhBreaker, Date.now())) return;
  const now = Date.now(), open = session().s === "open", last = E.lastSessionDate(now);
  const due = SYMS.filter(s => { const q = pq(s); if (!q || !q.at) return true; return open ? now - q.at > 120e3 : E.etDateOf(q.at) < last; });
  if (!due.length) return;
  due.sort((a, b) => ((pq(a) || {}).at || 0) - ((pq(b) || {}).at || 0));
  const sym = due[0]; PS.fhBusy = true; PS.fhAt = now; logCall("finnhub");
  limited(() => api("quote?symbol=" + encodeURIComponent(sym)), true).then(q => {
    if (!(q && q.c > 0)) return;
    PS.q[sym] = {c:+q.c, pc:+q.pc || null, dp: q.pc > 0 ? (q.c / q.pc - 1) * 100 : null, at:Date.now(), src:"finnhub"}; PS.err = ""; save();
  }).catch(e => { PS.err = e.message; }).finally(() => { PS.fhBusy = false; paint(); });
}
function step(){
  if (!secLive("pulse")) return;
  const now = Date.now(), s = session().s, mkt = s === "open" || s === "ext";
  if (alpOn()){
    if (!PS.busy && now >= PS.pauseUntil && (!PS.at || now - PS.at >= (mkt ? 20e3 : 10 * 60e3) || (PS.err && now - PS.at >= 20e3))) snap();
    loadBars();
  } else if (settings.key && now - PS.fhAt >= 3000) fhStep();
  if (!alpOn() && settings.tdKey && PS.tdDay !== etNow().date && typeof loadHist === "function"){ PS.tdDay = etNow().date; loadHist(SYMS); }
  if ((alpOn() || settings.key) && !PS.cBusy && now - PS.cAt >= (mkt ? 30e3 : 120e3)) coin();
}
setInterval(() => { try{ step(); }catch(e){ mwLog("warn", "market pulse: " + e.message); } }, 1000);

/* ---------- the reading ---------- */
function model(){
  const pairs = {}, cross = {};
  P.pairs.forEach(p => { const A = pq(p.a), B = pq(p.b), t = E.pulseTrend(closes(p.a), closes(p.b), A && A.c, B && B.c);
    pairs[p.k] = {today: A && B ? E.pulseRel(A.dp, B.dp) : null, r5:t.r5, r20:t.r20, line:t.line}; });
  P.cross.forEach(x => { const q = pq(x.sym); cross[x.k] = {q, dp: q ? q.dp : null, r5: x.sym === BTC || !q ? null : E.pulseBack(closes(x.sym), q.c, 5)}; });
  const rows = P.sectors.map(s => { const q = pq(s); return {sym:s, dp: q ? q.dp : null, px: q ? q.c : null, closes: closes(s)}; });
  const breadth = E.pulseBreadth(rows), score = E.pulseScore({pairs, cross, breadth});
  const ats = [...SYMS, BTC].map(s => (pq(s) || {}).at || 0).filter(Boolean);
  return {pairs, cross, rows, breadth, score, at: ats.length ? Math.max(...ats) : 0, have: ats.length, hist: P.pairs.some(p => pairs[p.k].r20 != null)};
}

/* ---------- drawing ---------- */
const pct = (v, d = 2) => `<span class="num ${cls(v == null ? null : +v.toFixed(d))}">${fmtPct(v, d)}</span>`;
function line(a){
  if (!a || a.length < 3) return `<svg class="pulse-sp" viewBox="0 0 60 18" aria-hidden="true"></svg>`;
  const lo = Math.min(...a), hi = Math.max(...a), sp = hi - lo || 1, pts = a.map((v, i) => `${(i / (a.length - 1) * 58 + 1).toFixed(1)},${(17 - (v - lo) / sp * 16).toFixed(1)}`).join(" ");
  const c = a[a.length - 1] > a[0] ? "var(--up)" : a[a.length - 1] < a[0] ? "var(--down)" : "var(--muted)";
  return `<svg class="pulse-sp" viewBox="0 0 60 18" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
const scoreCls = s => s == null ? "" : s >= 15 ? "up" : s <= -15 ? "down" : "";
const scoreTxt = s => s == null ? "—" : (s > 0 ? "+" : s < 0 ? "−" : "") + Math.abs(s);
function summary(m){
  const sum = $("pulse-sum"); if (!sum) return;
  const s = m.score, html = s.score == null ? "" : `<span class="pulse-sl ${scoreCls(s.score)}">${esc(s.label)}</span><b class="num ${scoreCls(s.score)}">${scoreTxt(s.score)}</b>`;
  if (sum.dataset.h !== html){ sum.innerHTML = html; sum.dataset.h = html; sum.dataset.tip = s.score == null ? "" : s.verdict + ". " + METHOD; }
}
function body(m){
  const S = m.score, day = dayWord() === "today" ? "today" : "in the last session";
  if (S.score == null && !m.have) return `<div class="empty">Loading the pulse…</div>`;
  const pos = S.score == null ? 50 : (S.score + 100) / 2;
  const top = `<div class="pulse-top" data-tip="${esc(METHOD)}">
      <div class="pulse-g"><b class="pulse-gv num ${scoreCls(S.score)}">${scoreTxt(S.score)}</b><span class="pulse-gl"><b class="${scoreCls(S.score)}">${esc(S.label)}</b><small>Risk appetite, −100 to +100</small></span></div>
      <div class="pulse-bar" role="img" aria-label="Risk appetite ${scoreTxt(S.score)} on a scale from minus 100 to plus 100"><i style="left:${pos.toFixed(1)}%"></i></div>
      <div class="pulse-ends"><span>Risk-off</span><span>Mixed</span><span>Risk-on</span></div>
      <p class="pulse-v">${S.score == null ? "Not enough prices yet for a reading." : esc(S.verdict.replace(/^[^:]+: /, "").replace(/^./, c => c.toUpperCase()))}${dayWord() === "today" ? "" : ` <span class="muted">(market closed: the last session's moves)</span>`}</p>
    </div>`;
  const pr = P.pairs.map(p => { const x = m.pairs[p.k], T = PAIR_TXT[p.k];
    return `<button class="pulse-r" data-chart="${p.a}" data-pk="${p.k}" data-tip="${esc(T.tip + " Click for the " + p.a + " chart.")}"><span class="pulse-n"><b>${esc(T.name)}</b><small>${p.a} / ${p.b}</small></span>${pct(x.today)}${pct(x.r5, 1)}${pct(x.r20, 1)}${line(x.line)}</button>`; }).join("");
  const lead = `<div class="pulse-k"><span>Leadership</span><span data-tip="How the first fund did against the second ${day}, in percent">1D</span><span data-tip="Over 5 sessions, today counting as one">5D</span><span data-tip="Over 20 sessions, about a month">20D</span><span class="pulse-spk" data-tip="The ratio of the two over the last 20 sessions: rising means the first fund is leading">20 days</span></div>${pr}`;
  const xs = P.cross.map(x => { const c = m.cross[x.k], T = CROSS_TXT[x.k], q = c.q, btc = x.sym === BTC, tk = btc ? "BTC" : x.sym;
    const usd = q && q.pc > 0 ? q.c - q.pc : null, tip = T.tip + (c.r5 != null ? " Over 5 sessions: " + fmtPct(c.r5, 1) + "." : "") + (btc ? "" : " Click for the chart.");
    return `<${btc ? "div" : "button"} class="pulse-x${x.w ? "" : " ctx"}"${btc ? "" : ` data-chart="${x.sym}" data-pk="${x.k}"`} data-tip="${esc(tip)}"><span class="pulse-xn">${esc(T.name)} <small>${tk}</small></span><b class="num">${q ? fmtPx(q.c) : "—"}</b><span class="num ${cls0(usd)}">${q ? chgTxt(usd, q.dp, 2, q.c) || "—" : "—"}</span></${btc ? "div" : "button"}>`; }).join("");
  const b = m.breadth, dots = m.rows.map(r => `<i class="${r.dp == null ? "" : cls(+r.dp.toFixed(2))}" data-tip="${r.sym} ${esc(SECT_NAME[r.sym])}: ${fmtPct(r.dp)} ${day}"></i>`).join("");
  const bar = (k, n, tip, lbl) => `<div class="pulse-bl" data-tip="${esc(tip)}"><span>${lbl}</span><b class="num">${n ? k + " of " + n : "—"}</b><span class="pulse-bb"><i style="width:${n ? (k / n * 100).toFixed(0) : 0}%"></i></span></div>`;
  const br = `<div class="pulse-k pulse-k2"><span>Breadth: the 11 S&amp;P sectors</span></div>
    ${bar(b.up, b.n, "How many of the 11 S&P sector funds are up " + day + (b.down ? " (" + b.down + " down)" : ""), "Up " + (day === "today" ? "today" : "last session"))}
    <div class="pulse-dots" aria-hidden="true">${dots}</div>
    ${bar(b.above, b.n20, "How many of the 11 S&P sector funds trade above their 20-day average: the share of the market in an uptrend", "Above 20-day average")}`;
  const src = alpOn() ? (PS.err ? "Alpaca: " + PS.err : `Alpaca IEX, every ${["open","ext"].includes(session().s) ? "20 s" : "10 min"}`) : settings.key ? "Finnhub, one fund every 3 s" : "";
  const note = !m.hist ? `<p class="note">${alpOn() ? "The 5- and 20-day figures load once a day from Alpaca's daily bars." : "Add your free Alpaca key in Settings → General for the 5- and 20-day figures and every fund in one call."}</p>` : "";
  return `${top}<div class="pulse-lead">${lead}</div><div class="pulse-cross"><div class="pulse-k"><span>Cross-asset</span><span data-tip="The price and its change ${day}, for one share">${day === "today" ? "Today" : "Last session"}</span></div><div class="pulse-xs">${xs}</div></div><div class="pulse-br">${br}</div>${note}
    <details class="pulse-how"${PS.how ? " open" : ""}><summary>How it's scored</summary><p>${esc(METHOD)}</p></details>
    <div class="pulse-f"><span>Indicator, not advice</span><span data-tip="Calls in the last minute: ${lastMin("alpaca")} to Alpaca, ${lastMin("crypto")} to its crypto feed, ${lastMin("finnhub")} to Finnhub">${esc(src)}${m.at ? " · " + esc(timeStr(m.at)) : ""}</span></div>`;
}
function emptyState(){
  return `<div class="empty pulse-empty"><b>Add your free Alpaca key for the pulse</b><br>Market pulse reads 24 funds and bitcoin at once. A free Alpaca paper account (no money involved) brings every fund in one call, plus the 5- and 20-day trends; a Finnhub key alone works too, a little slower.<br><button data-open="general">Open settings</button></div>`;
}
function paint(){ PS.sig = ""; render(); }
function render(){
  const el = $("pulse-body"); if (!el) return;
  const m = model(); summary(m);
  PS.last = m.score;
  if (!secLive("pulse") && el.offsetParent === null){ PS.sig = ""; return; }   // closed: only the header line
  const noKey = !alpOn() && !settings.key;
  const sig = noKey ? "nokey" : JSON.stringify([m.score.score, m.score.verdict, m.at, PS.err, PS.how, dayWord(), alpOn(), m.hist,
    P.pairs.map(p => { const x = m.pairs[p.k]; return [x.today, x.r5, x.r20].map(v => v == null ? null : +v.toFixed(2)); }),
    P.cross.map(x => { const q = m.cross[x.k].q; return q ? [q.c, q.dp == null ? null : +q.dp.toFixed(2)] : null; }), m.rows.map(r => r.dp == null ? null : +r.dp.toFixed(2)), m.breadth.above, m.breadth.n20]);
  if (sig === PS.sig) return;
  PS.sig = sig;
  const a = document.activeElement, keep = a && el.contains(a) ? (a.dataset.pk ? `[data-pk="${a.dataset.pk}"]` : a.tagName === "SUMMARY" ? ".pulse-how summary" : "") : "";
  el.innerHTML = noKey ? emptyState() : body(m);
  if (keep){ const f = el.querySelector(keep); if (f) f.focus({preventScroll:true}); }
  const d = el.querySelector(".pulse-how"); if (d) d.ontoggle = () => { PS.how = d.open; };
}

/* ---------- the section ---------- */
const css = document.createElement("style"); css.id = "pulse-css";
css.textContent = `
#pulse-body{container-type:inline-size}
#pulse-sum{gap:6px}
#pulse-sum .pulse-sl{font-size:11.5px;font-weight:600}
#pulse-sum .pulse-sl:not(.up):not(.down){color:var(--fg-2)}
.pulse-top{padding:2px 0 10px}
.pulse-g{display:flex;align-items:center;gap:10px}
.pulse-gv{font:700 26px/1 var(--font-d);min-width:58px;letter-spacing:-.3px}
.pulse-gl{display:flex;flex-direction:column;gap:1px;min-width:0}
.pulse-gl b{font:600 13px var(--font-d)}
.pulse-gl small{font-size:10.5px;color:var(--muted)}
.pulse-bar{position:relative;height:6px;border-radius:4px;margin:10px 0 3px;background:linear-gradient(90deg,color-mix(in srgb,var(--down) 70%,var(--surface-2)),color-mix(in srgb,var(--muted) 30%,var(--surface-2)) 50%,color-mix(in srgb,var(--up) 70%,var(--surface-2)))}
.pulse-bar i{position:absolute;top:-4px;width:4px;height:14px;margin-left:-2px;border-radius:2px;background:var(--fg);box-shadow:0 0 0 2px var(--surface);transition:left .4s ease}
.pulse-ends{display:flex;justify-content:space-between;font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.pulse-v{margin:7px 0 0;font-size:12px;color:var(--fg);line-height:1.4}
.pulse-k{display:grid;grid-template-columns:minmax(0,1fr) 52px 48px 48px;gap:4px;align-items:end;padding:8px 2px 3px;border-top:1px solid var(--line);font:600 9.5px var(--font);letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}
.pulse-k > span:not(:first-child){text-align:right}
.pulse-k2,.pulse-cross .pulse-k{grid-template-columns:minmax(0,1fr) auto}
.pulse-spk,.pulse-sp{display:none}
.pulse-r{display:grid;grid-template-columns:minmax(0,1fr) 52px 48px 48px;gap:4px;align-items:center;width:100%;padding:5px 2px;text-align:left;border-radius:6px;font-size:12px}
.pulse-r:hover,.pulse-x:hover{background:var(--surface-2)}
.pulse-r:focus-visible,.pulse-x:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.pulse-r > .num{text-align:right}
.pulse-n{display:flex;flex-direction:column;min-width:0}
.pulse-n b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pulse-n small{font-size:10px;color:var(--muted);font-family:var(--mono)}
.pulse-xs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:2px 0 4px}
.pulse-x{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:0;padding:6px 7px;border-radius:7px;background:color-mix(in srgb,var(--surface-2) 55%,transparent);text-align:left;font-size:11px}
.pulse-x.ctx{background:none;box-shadow:inset 0 0 0 1px var(--line)}
.pulse-xn{font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.pulse-xn small{font-family:var(--mono);font-size:9.5px}
.pulse-x b{font-size:12.5px;font-weight:600}
.pulse-x > span.num{white-space:nowrap;font-size:10.5px;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.pulse-bl{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:8px;padding:4px 2px 0;font-size:12px}
.pulse-bl b{font-weight:600}
.pulse-bb{grid-column:1/-1;height:4px;border-radius:3px;background:var(--line-2);margin-top:4px;overflow:hidden}
.pulse-bb i{display:block;height:100%;background:var(--accent);border-radius:3px}
.pulse-dots{display:grid;grid-template-columns:repeat(11,minmax(0,1fr));gap:3px;padding:6px 2px 4px}
.pulse-dots i{height:8px;border-radius:2px;background:var(--line-2)}
.pulse-dots i.up{background:var(--up)} .pulse-dots i.down{background:var(--down)}
.pulse-how{margin-top:8px;font-size:11px;color:var(--fg-2)}
.pulse-how summary{cursor:pointer;color:var(--accent);font-weight:600;width:max-content}
.pulse-how p{margin:5px 0 0;line-height:1.45}
.pulse-f{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 10px;margin-top:8px;padding-top:7px;border-top:1px solid var(--line);font-size:10.5px;color:var(--muted)}
.pulse-empty{line-height:1.5}
.pulse-empty b{color:var(--fg)}
@container (min-width:400px){
  .pulse-k:not(.pulse-k2),.pulse-r{grid-template-columns:minmax(0,1fr) 54px 50px 50px 64px}
  .pulse-cross .pulse-k{grid-template-columns:minmax(0,1fr) auto}
  .pulse-spk{display:block} .pulse-sp{display:block;width:60px;height:18px;justify-self:end}
}
@container (min-width:560px){
  .pulse-xs{grid-template-columns:repeat(6,minmax(0,1fr))}
  .pulse-top{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:18px;align-items:center}
  .pulse-top .pulse-g{grid-row:1/4}
  .pulse-bar{margin-top:2px}
}`;
document.head.appendChild(css);
// a new section starts closed once (so a first look costs no calls); its header still shows the reading
if (!settings.pulse63){ settings.pulse63 = 1; if (settings.collapsed.pulse == null) settings.collapsed.pulse = true; saveSettings(); }
registerSection({key:"pulse", name:"Market pulse", sumClass:"num pulse-s", render: () => safe("market pulse", render)});
})();
