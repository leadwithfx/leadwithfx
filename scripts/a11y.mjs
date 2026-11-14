// Serves the site locally and runs axe-core on each page. Fails on serious or critical issues.
import { chromium } from "playwright";
import * as axe from "@axe-core/playwright";
const AxeBuilder = axe.AxeBuilder || (axe.default && axe.default.AxeBuilder) || axe.default;
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".xml": "text/xml", ".txt": "text/plain" };
const server = createServer((req, res) => {
  let p = join(root, decodeURIComponent(req.url.split("?")[0]));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
}).listen(0);
const base = "http://127.0.0.1:" + server.address().port;

let fails = 0;
try {
const pages = ["/index.html", "/quiz.html", "/insights.html", "/privacy.html", "/terms.html"];
process.on("unhandledRejection", (e) => { console.log("::error title=a11y crashed::" + String(e && e.stack || e).replace(/\n/g, " | ").slice(0, 900)); process.exit(1); });
const browser = await chromium.launch();
for (const path of pages) {
  const page = await browser.newPage();
  // Third-party scripts (analytics, Turnstile) are not ours to audit and are not needed for the check.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(base + path, { waitUntil: "load" });
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  console.log((serious.length ? "FAIL " : "PASS ") + path + (serious.length ? ": " + serious.map((v) => v.id + " (" + v.nodes.length + ")").join(", ") : ""));
  for (const v of serious) console.log("::error title=axe " + path + " " + v.id + "::" + v.help + " | " + v.nodes.slice(0, 4).map((n) => n.target.join(" ") + " :: " + (n.any[0] || n.all[0] || n.none[0] || {}).message).join(" || "));
  if (serious.length) fails++;
  await page.close();
}
await browser.close();
server.close();
console.log(fails ? fails + " FAILED" : "ALL PASSED");
} catch (e) { console.log("::error title=a11y crashed::" + String((e && e.stack) || e).replace(/\n/g, " | ").slice(0, 900)); process.exit(1); }
process.exit(fails ? 1 : 0);
