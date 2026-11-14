import w, { validate, validateRequest, analyse, buildReport, reflect, makeToken, tokenOk } from "./index.js";
import { writeFileSync } from "node:fs";
let fails = 0;
const t = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails++; };
const ans = [2, 1, 1, 3, 2, 3, 2, 3];
const base = { a: ans, name: "Sam", email: "sam@example.com", consent_report: true, hp: "" };
const mk = (origin, body) => new Request("https://x/", { method: "POST", headers: { Origin: origin, "content-type": "application/json" }, body: JSON.stringify(body) });
const ORI = "https://leadwithfx.com";

t("valid answers", !!validate({ a: ans }));
t("bad length rejected", !validate({ a: [1] }));
t("out-of-range rejected", !validate({ a: [...ans.slice(0, 7), 9] }));
t("valid request", !!validateRequest(base));
t("needs report consent", !validateRequest({ ...base, consent_report: false }));
t("bad email rejected", !validateRequest({ ...base, email: "nope" }));
t("empty name rejected", !validateRequest({ ...base, name: "  " }));
t("html in name rejected", !validateRequest({ ...base, name: "<b>x" }));
t("honeypot rejected", !validateRequest({ ...base, hp: "bot" }));
t("stage defaults to result", validateRequest(base).stage === "result" && validateRequest({ ...base, stage: "request" }).stage === "request");

const a = analyse(ans);
t("band computed", a.band.title === "Take the step");
t("five themes", a.themes.length === 5);
const hi = analyse([1, 1, 1, 4,4,4,4,4]), lo = analyse([1, 1, 1, 1,1,1,1,1]);
t("high band", hi.band.title === "Keep moving" && lo.band.title === "Light the path");
const rep = buildReport("Sam <script>", ans, a);
t("name escaped in email", !rep.html.includes("<script>") && rep.html.includes("&lt;script&gt;"));
t("no VIA name in email", !/VIA/.test(rep.html) && !/VIA/.test(rep.text));
t("independent-organisation line", rep.html.includes("independent organisation"));
t("no AI label or AI wording", !/Written by AI|artificial/i.test(rep.html + rep.text));
writeFileSync("/tmp/sample-report.html", buildReport("Sam", ans, a).html);

t("visitor report has booking button and owner copy does not", rep.html.includes("calendly.com") && !buildReport("Sam", ans, a, true).html.includes("calendly.com"));
{
  // every combination of the five scored answers gives a reflection; same answers, same words
  let ok = true, seenText = new Set();
  for (let p = 1; p <= 4; p++) for (let q1 = 1; q1 <= 4; q1++) for (let q2 = 1; q2 <= 4; q2++) for (let q3 = 1; q3 <= 4; q3++) for (let q4 = 1; q4 <= 4; q4++) {
    const n = [1, 1, 1, p, q1, q2, q3, q4], an = analyse(n), r1 = reflect(an, n);
    if (r1 !== reflect(analyse(n), n) || !/A question to sit with: .+\?$/.test(r1) || /undefined|NaN/.test(r1)) ok = false;
    seenText.add(r1);
  }
  t("reflection covers all 1024 combinations cleanly", ok && seenText.size > 50);
  t("reflection tailored to profile", reflect(analyse([1, 1, 1, 2, 3, 3, 3, 3]), [1, 1, 1, 2, 3, 3, 3, 3]).includes("tech leader") && reflect(analyse([2, 1, 1, 2, 3, 3, 3, 3]), [2, 1, 1, 2, 3, 3, 3, 3]).includes("changing careers"));
  t("even answers handled", /fairly even/.test(reflect(analyse([1, 1, 1, 2, 2, 2, 2, 2]), [1, 1, 1, 2, 2, 2, 2, 2])));
}
const calls = [];
globalThis.fetch = async (u, o) => {
  calls.push(u);
  return new Response("{}", { status: 201 });
};
let r = await w.fetch(mk(ORI, base), { DRY_RUN: "1" });
let j = await r.json();
t("dry run returns report, sends nothing", r.status === 200 && j.dry && j.html && !calls.some((c) => c.includes("brevo")));
calls.length = 0;
r = await w.fetch(mk(ORI, base), { BREVO_API_KEY: "b", FROM_EMAIL: "hello@leadwithfx.com", ALERT_EMAIL: "me@x.com", BREVO_LIST_ID: "3" });
t("step 1: visitor report + owner copy, nothing stored", r.status === 200 && calls.filter((c) => c.includes("brevo")).length === 2 && !calls.some((c) => c.includes("contacts")));
calls.length = 0;
r = await w.fetch(mk(ORI, { ...base, stage: "request" }), { BREVO_API_KEY: "b", FROM_EMAIL: "hello@leadwithfx.com", ALERT_EMAIL: "me@x.com", BREVO_LIST_ID: "3" });
t("step 2: alert + contact saved", r.status === 200 && calls.filter((c) => c.includes("brevo")).length === 2 && calls.some((c) => c.includes("contacts")));
// step 2 proof token
const TS = { TURNSTILE_SECRET: "s", BREVO_API_KEY: "b", FROM_EMAIL: "f@x.com" };
const tk = await makeToken(TS, "sam@example.com");
t("token round trip", await tokenOk(TS, "sam@example.com", tk) && await tokenOk(TS, "SAM@example.com", tk));
t("token wrong email rejected", !(await tokenOk(TS, "other@example.com", tk)));
t("token tampered rejected", !(await tokenOk(TS, "sam@example.com", tk.slice(0, -2) + "xx")));
t("token expired rejected", !(await tokenOk(TS, "sam@example.com", tk, Date.now() + 2 * 3600 * 1000)));
t("no token rejected when check is on", !(await tokenOk(TS, "sam@example.com", "")));
calls.length = 0;
r = await w.fetch(mk(ORI, { ...base, stage: "request" }), TS);
t("step 2 without token: 403", r.status === 403 && calls.length === 0);
r = await w.fetch(mk(ORI, { ...base, stage: "request", tok: tk }), TS);
t("step 2 with token: 200", r.status === 200);
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
  t("no AI service is ever called", !seen.some((u) => u.includes("anthropic")));
}
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
