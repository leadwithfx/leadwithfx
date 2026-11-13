import w, { validate, validateRequest, analyse, buildReport, fallbackReflection } from "./index.js";
import { writeFileSync } from "node:fs";
let fails = 0;
const t = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails++; };
const ans = [2, 1, 1, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2];
const base = { a: ans, name: "Sam", email: "sam@example.com", consent_report: true, consent_contact: true, hp: "" };
const mk = (origin, body) => new Request("https://x/", { method: "POST", headers: { Origin: origin, "content-type": "application/json" }, body: JSON.stringify(body) });
const ORI = "https://leadwithfx.com";

t("valid answers", !!validate({ a: ans }));
t("bad length rejected", !validate({ a: [1] }));
t("out-of-range rejected", !validate({ a: [...ans.slice(0, 12), 9] }));
t("valid request", !!validateRequest(base));
t("needs report consent", !validateRequest({ ...base, consent_report: false }));
t("bad email rejected", !validateRequest({ ...base, email: "nope" }));
t("empty name rejected", !validateRequest({ ...base, name: "  " }));
t("html in name rejected", !validateRequest({ ...base, name: "<b>x" }));
t("honeypot rejected", !validateRequest({ ...base, hp: "bot" }));
t("contact flag optional", validateRequest({ ...base, consent_contact: undefined }).contact === false);

const a = analyse(ans);
t("band computed", a.band.title === "Take the step");
t("five themes", a.themes.length === 5);
const hi = analyse([1, 1, 1, 4,4,4,4,4,4,4,4,4,4]), lo = analyse([1, 1, 1, 1,1,1,1,1,1,1,1,1,1]);
t("high band", hi.band.title === "Keep moving" && lo.band.title === "Light the path");
const rep = buildReport("Sam <script>", ans, a, fallbackReflection(a), false);
t("name escaped in email", !rep.html.includes("<script>") && rep.html.includes("&lt;script&gt;"));
t("no VIA name in email", !/VIA/.test(rep.html) && !/VIA/.test(rep.text));
t("independent-organisation line", rep.html.includes("independent organisation"));
t("AI label only when AI used", !rep.html.includes("Written by AI") && buildReport("Sam", ans, a, "x y z", true).html.includes("Written by AI"));
writeFileSync("/tmp/sample-report.html", buildReport("Sam", ans, a, "Your answers show real momentum, and a gap in who knows the value you bring.\n\nWhat would change if the people who matter saw your results more often?", true).html);

const calls = [];
globalThis.fetch = async (u, o) => {
  calls.push(u);
  if (u.includes("anthropic")) return new Response(JSON.stringify({ content: [{ text: "Test reflection that is long enough to pass the length check." }] }), { status: 200 });
  return new Response("{}", { status: 201 });
};
let r = await w.fetch(mk(ORI, base), { DRY_RUN: "1", ANTHROPIC_API_KEY: "k" });
let j = await r.json();
t("dry run returns report, sends nothing", r.status === 200 && j.dry && j.html && !calls.some((c) => c.includes("brevo")));
calls.length = 0;
r = await w.fetch(mk(ORI, base), { BREVO_API_KEY: "b", FROM_EMAIL: "hello@leadwithfx.com", ALERT_EMAIL: "me@x.com", BREVO_LIST_ID: "3", ANTHROPIC_API_KEY: "k" });
t("live path: report + contact + alert", r.status === 200 && calls.filter((c) => c.includes("brevo")).length === 3);
calls.length = 0;
r = await w.fetch(mk(ORI, { ...base, consent_contact: false }), { BREVO_API_KEY: "b", FROM_EMAIL: "hello@leadwithfx.com", ALERT_EMAIL: "me@x.com" });
t("no tick: report only, nothing stored", r.status === 200 && calls.filter((c) => c.includes("brevo")).length === 1 && !calls.some((c) => c.includes("contacts")));
globalThis.fetch = async () => new Response("no", { status: 500 });
r = await w.fetch(mk(ORI, base), { BREVO_API_KEY: "b", FROM_EMAIL: "f@x.com" });
t("send failure returns 502", r.status === 502);
r = await w.fetch(mk("https://evil.com", base), {});
t("evil origin 403", r.status === 403);
r = await w.fetch(mk(ORI, { ...base, email: "bad" }), {});
t("bad request 400", r.status === 400);
// abuse protection
{
  const seen = [];
  globalThis.fetch = async (u, o) => { seen.push(u); if (u.includes("turnstile")) { const ok = String(o.body).includes("goodtoken"); return new Response(JSON.stringify({ success: ok }), { status: 200 }); } if (u.includes("anthropic")) return new Response(JSON.stringify({ content: [{ text: "Test reflection that is long enough to pass the length check." }] }), { status: 200 }); return new Response("{}", { status: 201 }); };
  const env = { DRY_RUN: "1", TURNSTILE_SECRET: "s" };
  let r = await w.fetch(mk(ORI, base), env);
  t("turnstile on: no token rejected", r.status === 403);
  r = await w.fetch(mk(ORI, { ...base, ts: "badtoken-badtoken" }), env);
  t("turnstile on: bad token rejected", r.status === 403);
  r = await w.fetch(mk(ORI, { ...base, ts: "goodtoken-goodtoken" }), env);
  t("turnstile on: good token accepted", r.status === 200);
  r = await w.fetch(mk(ORI, base), { DRY_RUN: "1" });
  t("turnstile off: still works", r.status === 200);
  r = await w.fetch(mk(ORI, base), { DRY_RUN: "1", LIMITER: { limit: async () => ({ success: false }) } });
  t("rate limit returns 429", r.status === 429);
  r = await w.fetch(mk(ORI, base), { DRY_RUN: "1", LIMITER: { limit: async () => ({ success: true }) } });
  t("under the limit passes", r.status === 200);
  r = await w.fetch(mk(ORI, { ...base, name: "x".repeat(6000) }), { DRY_RUN: "1" });
  t("oversize body rejected", r.status === 413);
  seen.length = 0;
  await w.fetch(mk(ORI, { ...base, email: "bad" }), { DRY_RUN: "1", TURNSTILE_SECRET: "s" });
  t("bad requests never reach the AI", !seen.some((u) => u.includes("anthropic")));
}
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
