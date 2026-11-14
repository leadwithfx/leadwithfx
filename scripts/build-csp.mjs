// Writes a Content-Security-Policy <meta> into every page, with a hash for each inline script,
// so inline code is allowed only if it is exactly what is in the repo. Run: node scripts/build-csp.mjs
// (CI fails if the committed pages are stale). GitHub Pages cannot send headers; see README for the Cloudflare ones.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(new URL("..", import.meta.url).pathname);
const pages = [];
const walk = (d) => { for (const f of readdirSync(d)) { if (f.startsWith(".") || ["node_modules", "worker", "scripts", "content"].includes(f)) continue; const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith(".html") && pages.push(p); } };
walk(root);

export function policy(hashes) {
  return [
    "default-src 'self'",
    "script-src 'self' " + hashes.map((h) => "'sha256-" + h + "'").join(" ") + " https://assets.calendly.com https://gc.zgo.at https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://assets.calendly.com",
    "img-src 'self' data: https://leadwithfx.goatcounter.com https://assets.calendly.com https://*.calendly.com",
    "font-src 'self'",
    "connect-src 'self' https://clarity-report.leadwithfx.workers.dev https://leadwithfx.goatcounter.com https://*.calendly.com",
    "frame-src https://calendly.com https://challenges.cloudflare.com",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

if (process.argv[1] && process.argv[1].endsWith("build-csp.mjs")) {
  for (const p of pages) {
    let h = readFileSync(p, "utf8");
    const before = h;
    h = h.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/g, "");
    const hashes = [...h.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => createHash("sha256").update(m[1]).digest("base64"));
    const unique = [...new Set(hashes)];
    const tag = '<meta http-equiv="Content-Security-Policy" content="' + policy(unique) + '">\n';
    if (!/<meta charset="utf-8">/.test(h)) { console.log("skip (no charset meta): " + p); continue; }
    h = h.replace(/<meta charset="utf-8">\n?/, (m) => m.replace(/\n?$/, "\n") + tag);
    if (h !== before) writeFileSync(p, h);
  }
  console.log(pages.length + " page(s) have a Content-Security-Policy");
}
