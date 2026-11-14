// Dependency-free checks on the static site. Run: node scripts/check-site.mjs
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const pages = [];
const walk = (d) => { for (const f of readdirSync(d)) { if (f.startsWith(".") || f === "TEMPLATE.html" || f === "node_modules" || f === "worker" || f === "scripts") continue; const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith(".html") && pages.push(p); } };
walk(root);

let fails = 0;
const bad = (page, msg) => { console.log("FAIL " + page.replace(root + "/", "") + ": " + msg); fails++; };

for (const page of pages) {
  const html = readFileSync(page, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  if (!/<html[^>]*\slang="/i.test(html)) bad(page, "missing <html lang>");
  if (!/<title>[^<]{3,}<\/title>/i.test(html)) bad(page, "missing <title>");
  if (!/<meta[^>]+name="description"[^>]+content="[^"]{20,}"/i.test(html)) bad(page, "missing meta description");
  if (!/<meta[^>]+name="viewport"/i.test(html)) bad(page, "missing viewport meta");
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) if (!/\salt=/.test(m[0])) bad(page, "image without alt: " + m[0].slice(0, 60));
  for (const m of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gi)) if (!/rel="[^"]*noopener/.test(m[0])) bad(page, "target=_blank without rel=noopener: " + m[0].slice(0, 70));
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) { try { JSON.parse(m[1]); } catch { bad(page, "invalid JSON-LD"); } }
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  ids.filter((v, i) => ids.indexOf(v) !== i).forEach((d) => bad(page, "duplicate id: " + d));
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const u = m[1];
    if (/^(https?:|\/\/|mailto:|tel:|data:|javascript:)/i.test(u)) continue;
    const [pathPart, frag] = u.split("#");
    const file = pathPart.split("?")[0];
    const target = file === "" ? page : file.startsWith("/") ? join(root, file) : join(dirname(page), file);
    const resolved = existsSync(target) && statSync(target).isFile() ? target : existsSync(target + ".html") ? target + ".html" : null;
    if (!resolved) { bad(page, "broken local link: " + u); continue; }
    if (frag && resolved.endsWith(".html") && !new RegExp('\\sid="' + frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"').test(readFileSync(resolved, "utf8"))) bad(page, "link to a missing section: " + u);
  }
}

// Privacy: no third-party font hosts. Weight: size budget per asset type (bytes).
for (const page of pages) {
  const html = readFileSync(page, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  if (/fonts\.(googleapis|gstatic)\.com/.test(html)) bad(page, "loads fonts from a third party; self-host them in /fonts");
}
const BUDGET = { ".css": 60000, ".js": 25000, ".woff": 80000, ".woff2": 80000, ".avif": 120000, ".webp": 160000, ".jpg": 200000, ".png": 120000, ".svg": 20000 };
const walkAssets = (d) => { for (const f of readdirSync(d)) { if (f.startsWith(".") || ["node_modules", "worker", "scripts"].includes(f)) continue; const p = join(d, f); if (statSync(p).isDirectory()) { walkAssets(p); continue; } const ext = f.slice(f.lastIndexOf(".")); const max = BUDGET[ext]; if (max && statSync(p).size > max) bad(p, "over size budget (" + statSync(p).size + " > " + max + " bytes)"); } };
walkAssets(root);
for (const f of ["sitemap.xml", "robots.txt", "CNAME"]) if (!existsSync(join(root, f))) { console.log("FAIL missing " + f); fails++; }
console.log(pages.length + " pages checked");
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
