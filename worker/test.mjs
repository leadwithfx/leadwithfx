import w, { deliver, processOutbox, validate, validateRequest, analyse, buildReport, reflect, makeToken, tokenOk } from "./index.js";
import { writeFileSync } from "node:fs";
let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch { /* older Node: outbox tests are skipped, the CI workflow runs them on Node 22 */ }
import { readFileSync } from "node:fs";
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


// Insights signup
{
  const sc = [];
  globalThis.fetch = async (u, o) => { sc.push(u); if (u.includes("turnstile")) return new Response(JSON.stringify({ success: String(o.body).includes("goodtoken") }), { status: 200 }); return new Response("{}", { status: 201 }); };
  const sb = { stage: "subscribe", email: "sam@example.com", consent_news: true, hp: "", ts: "goodtoken-goodtoken" };
  const E = { TURNSTILE_SECRET: "s", BREVO_API_KEY: "b", INSIGHTS_LIST_ID: "7" };
  const post = (b, env) => w.fetch(new Request("https://x/", { method: "POST", headers: { Origin: ORI, "content-type": "application/json" }, body: JSON.stringify(b) }), env);
  let r = await post(sb, E);
  t("signup: ok adds contact to the Insights list", r.status === 200 && sc.some((c) => c.includes("brevo") && c.includes("contacts")));
  r = await post({ ...sb, consent_news: false }, E);
  t("signup: no tick, 400", r.status === 400);
  r = await post({ ...sb, email: "nope" }, E);
  t("signup: bad email, 400", r.status === 400);
  r = await post({ ...sb, hp: "x" }, E);
  t("signup: honeypot filled, 400", r.status === 400);
  r = await post({ ...sb, ts: "badtoken-badtoken" }, E);
  t("signup: failed human check, 403", r.status === 403);
  r = await post(sb, { ...E, INSIGHTS_LIST_ID: "" });
  t("signup: list not set, 503 (form stays honest)", r.status === 503);
  sc.length = 0;
  r = await post(sb, { ...E, DRY_RUN: "1" });
  t("signup: dry run sends nothing", r.status === 200 && !sc.some((c) => c.includes("brevo")));
}

// Retry outbox, run against a real SQL engine (node:sqlite) using the repo's schema.sql
if (!DatabaseSync) console.log("SKIP outbox tests (needs Node 22.5+)");
else {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  const DB = { prepare: (q) => { const st = sql.prepare(q); let args = []; const o = { bind: (...a) => { args = a; return o; }, run: async () => { st.run(...args); return {}; }, all: async () => ({ results: st.all(...args) }) }; return o; } };
  const count = (where = "1=1") => sql.prepare("SELECT COUNT(*) AS n FROM outbox WHERE " + where).get().n;
  const env = { BREVO_API_KEY: "b", FROM_EMAIL: "f@x.com", DB };
  let mode = 503;
  globalThis.fetch = async () => (mode === "throw" ? Promise.reject(new Error("net")) : new Response("{}", { status: mode }));
  const P = { to: [{ email: "a@b.c" }], subject: "s" };
  const T0 = 1_000_000;
  t("outbox: success sends and stores nothing", (mode = 201, await deliver(env, "smtp/email", P, T0)) === "sent" && count() === 0);
  t("outbox: 503 is queued", (mode = 503, await deliver(env, "smtp/email", P, T0)) === "queued" && count("status='pending'") === 1);
  t("outbox: network error is queued", (mode = "throw", await deliver(env, "smtp/email", P, T0)) === "queued" && count() === 2);
  t("outbox: 400 is not retried", (mode = 400, await deliver(env, "smtp/email", P, T0)) === "failed" && count() === 2);
  t("outbox: no DB means failed, as before", (mode = 503, await deliver({ ...env, DB: undefined }, "smtp/email", P, T0)) === "failed");
  mode = 503;
  let r1 = await processOutbox(env, T0 + 1000);
  t("outbox: not retried before its time", r1.sent + r1.retried + r1.dead === 0);
  r1 = await processOutbox(env, T0 + 61_000);
  t("outbox: still failing is rescheduled with backoff", r1.retried === 2 && count("attempts=2") === 2 && count("next_at > " + (T0 + 61_000 + 100_000)) === 2);
  mode = 201;
  r1 = await processOutbox(env, T0 + 10 * 60_000);
  t("outbox: recovered sends are delivered and deleted", r1.sent === 2 && count() === 0);
  mode = 503;
  await deliver(env, "smtp/email", P, T0);
  let now = T0, dead = 0;
  for (let i = 0; i < 12; i++) { now += 3_600_000; const r2 = await processOutbox(env, now); dead += r2.dead; }
  t("outbox: gives up after 8 attempts and keeps the row as dead", dead === 1 && count("status='dead'") === 1 && count("status='pending'") === 0);
  await processOutbox(env, now + 8 * 24 * 3600 * 1000);
  t("outbox: dead rows are purged after 7 days", count() === 0);
  mode = 400;
  await deliver({ ...env, DB }, "smtp/email", P, T0);
  t("outbox: permanent errors never enter the queue", count() === 0);
  // end to end: owner email succeeds, visitor email fails, only the visitor email is queued
  let n = 0; globalThis.fetch = async () => new Response("{}", { status: ++n === 1 ? 201 : 503 });
  const rr = await w.fetch(mk(ORI, base), env); const jj = await rr.json();
  t("outbox: step 1 partial failure queues only the failed email and still answers ok", rr.status === 200 && jj.ok && jj.queued && count() === 1);
  t("outbox: DRY_RUN never touches the outbox", (await processOutbox({ ...env, DRY_RUN: "1" }, T0 + 99 * 3600_000)).sent === 0);
}
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
