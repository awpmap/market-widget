/* Runs first, before the page draws. The same file serves the beta (/lab/) and, after labdev/promote.mjs, the regular MW.
   Regular MW: the one-time move to MW 4, then the beta switch. Both: the opening animation. */
(function(){ try{
  var L = localStorage, BETA = /\/lab(\/|$)/.test(location.pathname), ns = BETA ? "mwlab_" : "mw_";
  if (BETA){
    // MW 4 made the beta the regular version. If MW sent you here before that, go back once so it can move your setup over.
    if (L.getItem("mw_channel") === "beta" && !L.getItem("mw_v4") && L.getItem("mw_cfg")){ location.replace("../" + location.hash); return; }
  } else {
    if (!L.getItem("mw_v4")){
      if (L.getItem("mw_channel") === "beta" && L.getItem("mwlab_cfg")){
        // you were using the beta: carry on with its setup (the old regular setup is kept as mw_pre4_cfg / mw_pre4_settings)
        ["cfg", "settings"].forEach(function(k){ var v = L.getItem("mw_" + k); if (v != null) L.setItem("mw_pre4_" + k, v); });
        var keys = []; for (var i = 0; i < L.length; i++){ var k = L.key(i); if (k && k.indexOf("mwlab_") === 0) keys.push(k); }
        keys.forEach(function(k){ L.setItem("mw_" + k.slice(6), L.getItem(k)); });
        L.setItem("mw_idbFrom", "mwlab");
      } else L.removeItem("mw_hist");   // MW 4 keeps more history per ticker; it refills on its own
      L.setItem("mw_channel", "stable"); L.setItem("mw_v4", "1");
    }
    /* If you turned on MW Beta, open it instead. If the beta didn't confirm it started last time, stay here,
       so a broken beta can never lock you out. ?stable always opens this version and turns the beta off. */
    if (/[?&]stable(=|&|$)/.test(location.search)) L.setItem("mw_channel", "stable");
    else if (L.getItem("mw_channel") === "beta"){
      var tryAt = +L.getItem("mw_betaTry") || 0, okAt = +L.getItem("mw_betaOk") || 0;
      if (tryAt && okAt < tryAt) window.__mwBetaFailed = true;
      else { L.setItem("mw_betaTry", String(Date.now())); location.replace("lab/" + location.hash); return; }
    }
  }
  /* opening animation: only when the desktop app starts (or with #splash), never on background reloads */
  var st = JSON.parse(L.getItem(ns + "settings") || "{}");
  var cold = location.hash === "#splash" || (!!window.__TAURI__ && /tauri\.localhost|^tauri:/.test(document.referrer || ""));
  if (cold && st.splash !== false && !document.hidden) document.documentElement.classList.add("boot");
}catch(e){} })();
