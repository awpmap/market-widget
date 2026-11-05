/* opening animation: only when the desktop app starts (or with #splash), never on background reloads */
(function(){ try{
  var st = JSON.parse(localStorage.getItem("mwlab_settings") || "{}");
  var cold = location.hash === "#splash" || (!!window.__TAURI__ && /tauri\.localhost|^tauri:/.test(document.referrer || ""));
  if (cold && st.splash !== false && !document.hidden) document.documentElement.classList.add("boot");
}catch(e){} })();
