// Makes the beta the regular MW: copies lab/ into the site root with the regular name and storage.
//   node labdev/promote.mjs [target-dir]      (target defaults to this checkout's root)
// The code itself is shared: app.js, boot.js and sw.js check whether they run under /lab/ and behave accordingly.
// Only the name ("MW Beta" -> "MW") and the storage prefix ("mwlab_" -> "mw_") are rewritten here.
// The root manifest.webmanifest and icons/ are left alone, so an installed MW stays the same app.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAB = path.join(ROOT, "lab"), OUT = path.resolve(process.argv[2] || ROOT);
const read = f => fs.readFileSync(path.join(LAB, f), "utf8");
const write = (f, s) => { fs.writeFileSync(path.join(OUT, f), s); console.log("wrote " + path.join(OUT, f)); };
function swap(s, a, b, file){ if (!s.includes(a)) throw new Error(file + ": expected to find " + JSON.stringify(a)); return s.split(a).join(b); }
const HEAD = "/* Generated from lab/ by labdev/promote.mjs. Edit lab/ and promote again, not this file. */\n";

let app = read("app.js");
app = swap(app, 'const NS = "mwlab_";', 'const NS = "mw_";', "app.js");
app = swap(app, "MW Beta", "MW", "app.js");
write("app.js", HEAD + app);
write("engine.js", HEAD + read("engine.js"));
write("boot.js", HEAD + read("boot.js"));
write("sw.js", HEAD.replace("/*", "//").replace(" */", "") + read("sw.js"));
write("version.json", read("version.json"));
// third-party files used as-is (the chart library and its license)
fs.mkdirSync(path.join(OUT, "vendor"), {recursive:true});
for (const f of fs.readdirSync(path.join(LAB, "vendor"))) { fs.copyFileSync(path.join(LAB, "vendor", f), path.join(OUT, "vendor", f)); console.log("copied " + path.join(OUT, "vendor", f)); }

let html = read("index.html");
html = swap(html, "<title>MW Beta</title>", "<title>Market Widget</title>", "index.html");
html = html.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="A small market widget with sector heatmap, portfolio summary and intraday dip alerts.">');
html = swap(html, '<div class="sp-word"><b>MW Beta</b><small>Beta version</small></div>', '<div class="sp-word"><b>MW</b><small>Market Widget</small></div>', "index.html");
html = html.replace(/<span class="appname"[^>]*>MW <em class="labtag"[^>]*>BETA<\/em><\/span>/, '<span class="appname" title="Market Widget" data-tauri-drag-region>MW</span>');
html = swap(html, "<span>MW Beta · info only · never trades</span>", "<span>Info only · never trades</span>", "index.html");
html = html.split("MW Beta").join("MW");
if (/labtag" data/.test(html)) throw new Error("index.html still has the BETA tag");
write("index.html", html.replace("<!doctype html>", "<!doctype html>\n<!-- Generated from lab/index.html by labdev/promote.mjs -->"));
