// Deployed from GitHub by Cloudflare Workers Builds.
// Cloudflare Worker for the Clarity Report.
// Receives answer numbers plus a first name and email. Step 1 ("result") emails the report to the visitor (so only a real address gets it) and a copy to the owner.
// Step 2 ("request", only if the visitor ticks the box) alerts the owner and adds them to the pipeline.
// The reflection is built from fixed wording chosen by the answers. No AI is used.
//
// Secrets and variables (Cloudflare > Worker > Settings):
//   BREVO_API_KEY (secret)
//   FROM_EMAIL (a sender verified in Brevo, e.g. hello@leadwithfx.com)
//   ALERT_EMAIL (where lead alerts go)   BREVO_LIST_ID (number, the pipeline list)
//   INSIGHTS_LIST_ID (number, the Insights newsletter list; signup is off until set)
//   DB (D1 binding, optional): retry outbox for failed Brevo calls; see schema.sql and the cron trigger in wrangler.jsonc
//   Optional: DRY_RUN=1 (builds the report but sends nothing)
//   "Drop me a message" (stages msg_code and msg_send) needs BREVO_API_KEY, FROM_EMAIL and TURNSTILE_SECRET. It emails a 6-digit code to the visitor's address and sends the message only once the code is entered.
//   Abuse protection (each is optional and switches on when set):
//     TURNSTILE_SECRET (secret)  Cloudflare Turnstile secret key: requires a human check token from the quiz page
//     LIMITER (rate limit binding)  per-visitor limit, e.g. 3 requests per 60 seconds; see README

const ALLOWED_ORIGINS = ["https://leadwithfx.com", "https://www.leadwithfx.com"];
const BOOK_URL = "https://calendly.com/freddie-rx";
const ASSESS_URL = "https://www.viacharacter.org/account/register";

const QUESTIONS = [{"q":"Which best describes you?","o":["Tech leader or manager","Career changer","Early-career professional","Something else"],"profile":1},{"q":"Have you worked with a coach before?","o":["No, this would be my first time","Once or twice","Yes, several times"],"profile":1},{"q":"Think of a time you got unstuck on something important. What made the difference?","o":["I talked it through with someone and the answer became clear to me","Someone who had done it told me what worked for them","An expert gave me the answer or took it on","I haven't really got unstuck yet"],"profile":1},{"q":"How clear are you on your next role or move?","o":["I have no real idea","A few options, but nothing feels right","I have a direction, but I'm not sure it's the right one","I know exactly what I want next"]},{"q":"How well do the people who matter know the value you bring?","o":["Hardly at all","Some of them","Most of them, but not the key decision makers","Clearly, including the key decision makers"]},{"q":"Who holds you accountable for your growth?","o":["Nobody","I only check in with myself","Someone occasionally","Someone regularly, and it works"]},{"q":"How would you describe your momentum right now?","o":["Stuck","Slow and stop-start","Steady, but not going where I want","Moving, and building speed"]},{"q":"How confident are you influencing senior stakeholders?","o":["I avoid it","I do it, but it feels uncomfortable","Fairly confident in familiar situations","Confident, even in high-stakes rooms"]}];

const THEMES = [
  { n: "Clarity", q: [1], plan: [
    "Write one sentence on the role or move you want next, and why it matters to you.",
    "List the three biggest gaps between you and it, then ask someone who has been there which one matters most.",
    "Set a date to decide, and put it in your calendar." ] },
  { n: "Visibility", q: [2], plan: [
    "List the five people who most shape your next step, and what each of them knows about your work.",
    "Share one recent result with a senior person this month.",
    "Ask someone you trust what you are known for, and whether that matches what you want to be known for." ] },
  { n: "Accountability", q: [3], plan: [
    "Pick one growth goal for the next 90 days and write it down with a date.",
    "Book a standing monthly check-in with someone who will be straight with you.",
    "Review your progress at day 30, day 60 and day 90." ] },
  { n: "Momentum", q: [4], plan: [
    "Block two hours a week in your calendar for your growth, and protect them.",
    "Each week, do the one task that moves you most before anything else.",
    "At the end of each month, write down one thing you finished." ] },
  { n: "Influence", q: [5], plan: [
    "Before your next senior meeting, write the one point you want them to leave with.",
    "Ask a senior stakeholder for 15 minutes to understand their priorities.",
    "Afterwards, note what landed and what didn't." ] },
];
const BANDS = [
  { max: 9, title: "Light the path", body: "Right now the main thing missing is clarity. You have the experience and the tools, but too many thoughts and options are competing, so it's hard to see the way forward.", step: "Start by getting a candid look at where you are, what's working and what's in the way. That makes the next move much easier to choose." },
  { max: 15, title: "Take the step", body: "You can already see some of the path. What holds you back now is choosing the next move and committing to it, rather than waiting until everything feels certain.", step: "Pick one focused move, decide when you'll do it, and use practical tools you can apply in your next meeting, not next quarter." },
  { max: 20, title: "Keep moving", body: "You have clarity and momentum. The risk now is drifting, or plateauing without noticing, because nobody is checking your direction.", step: "Add regular check-ins and honest accountability, and plan for the next level before you need it." },
];

export function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function validate(body) {
  if (!body || !Array.isArray(body.a) || body.a.length !== QUESTIONS.length) return null;
  const nums = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const n = body.a[i];
    if (!Number.isInteger(n) || n < 1 || n > QUESTIONS[i].o.length) return null;
    nums.push(n);
  }
  return nums;
}

export function validateRequest(body) {
  const nums = validate(body);
  if (!nums) return null;
  if (body.hp) return null;
  if (body.consent_report !== true) return null;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!name || name.length > 60 || /[\u0000-\u001f<>]/.test(name)) return null;
  if (email.length > 254 || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return null;
  const stage = body.stage === "request" ? "request" : "result";
  return { nums, name, email, stage, tok: typeof body.tok === "string" ? body.tok : "" };
}

export function analyse(nums) {
  const score = nums.slice(3).reduce((a, b) => a + b, 0);
  const band = BANDS.find((b) => score <= b.max) || BANDS[BANDS.length - 1];
  const themes = THEMES.map((t) => {
    const vals = t.q.map((k) => nums[k + 2]);
    const frac = (vals.reduce((a, b) => a + b, 0) / vals.length - 1) / 3;
    return { n: t.n, lvl: Math.round(frac * 3) + 1, frac, label: frac < 0.34 ? "Early" : frac < 0.67 ? "Building" : "Strong", plan: t.plan };
  });
  let low = themes[0], high = themes[0];
  themes.forEach((t) => { if (t.frac < low.frac) low = t; if (t.frac > high.frac) high = t; });
  return { score, band, themes, low, high };
}

const SHOWS = {
  Clarity: ["you don't yet have a clear picture of your next move", "you can see a few options, but none of them feels right yet", "you have a direction, though you're not sure it's the right one", "you know what you want next"],
  Visibility: ["the people who matter hardly know the value you bring", "only some of the people who matter know the value you bring", "most people who matter know your value, but not the key decision makers", "the key decision makers clearly know the value you bring"],
  Accountability: ["nobody is holding you accountable for your growth", "you mostly check in with yourself on your growth", "someone checks in with you on your growth now and then", "someone holds you accountable for your growth regularly, and it works"],
  Momentum: ["you feel stuck right now", "your momentum is slow and stop-start", "your momentum is steady, though not heading where you want", "you are moving and building speed"],
  Influence: ["you tend to avoid influencing senior stakeholders", "you do influence senior stakeholders, though it feels uncomfortable", "you are fairly confident influencing senior stakeholders in familiar situations", "you are confident influencing senior stakeholders, even in high-stakes rooms"],
};
const ASK = {
  Clarity: "What would you want your next move to look like twelve months from now?",
  Visibility: "Who most needs to know what you have achieved, and what would you want them to say about you?",
  Accountability: "Who would you trust to ask you the hard questions about your growth?",
  Momentum: "What is the one thing that, done every week, would restart your momentum?",
  Influence: "What is the one point you want senior stakeholders to remember you for?",
};
const OPENER = ["As a tech leader or manager, ", "As someone changing careers, ", "As someone early in your career, ", ""];

// Tailored wording chosen from fixed text by the answers: same answers, same reflection.
export function reflect(a, nums) {
  const op = OPENER[nums[0] - 1] || "";
  const sh = (t) => SHOWS[t.n][t.lvl - 1];
  let p1;
  if (a.high.lvl === a.low.lvl) {
    p1 = op + "your answers are fairly even across the five themes, so you have a free choice about where to start.";
    p1 = p1.charAt(0).toUpperCase() + p1.slice(1);
  } else {
    p1 = op + "your answers show that " + sh(a.high) + ". The theme with the most room to grow is " + a.low.n.toLowerCase() + ": " + sh(a.low) + ".";
    p1 = p1.charAt(0).toUpperCase() + p1.slice(1);
  }
  const q = a.high.lvl === a.low.lvl ? "Which of the five themes would make the biggest difference to you if it moved up one level?" : ASK[a.low.n];
  return p1 + "\n\nA question to sit with: " + q;
}

const PROFILE = QUESTIONS[0].o, COACHED = QUESTIONS[1].o, HELPED = QUESTIONS[2].o;

export function buildReport(name, nums, a, owner = false) {
  const reflection = reflect(a, nums);
  const first = esc(name);
  const bars = a.themes.map((t) =>
    '<tr><td style="padding:6px 0;font-size:14px;color:#12294D;width:120px">' + t.n + '</td>' +
    '<td style="padding:6px 8px"><div style="background:#EDE8D8;border-radius:4px;height:8px"><div style="background:#C9A227;border-radius:4px;height:8px;width:' + Math.max(10, Math.round(t.frac * 100)) + '%"></div></div></td>' +
    '<td style="padding:6px 0;font-size:13px;color:#6b7280;width:70px">' + t.label + '</td></tr>').join("");
  const plan = a.low.plan.map((p, i) => '<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#4a5568">' + (i + 1) + ". " + esc(p) + "</p>").join("");
  const reflHtml = esc(reflection).split(/\n\n+/).map((p) => '<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#4a5568">' + p + "</p>").join("");
  const sec = (h, inner) => '<div style="border-top:1px solid #EDE8D8;margin-top:18px;padding-top:14px"><div style="font-size:15px;font-weight:bold;color:#12294D;margin-bottom:6px">' + h + "</div>" + inner + "</div>";
  const btn = (href, label) => '<a href="' + href + '" style="display:inline-block;background:#C9A227;color:#12294D;font-weight:bold;font-size:14px;text-decoration:none;padding:12px 22px;border-radius:999px">' + label + "</a>";
  const html = '<div style="background:#FAF8F3;padding:24px 12px;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 26px">' +
    '<div style="font-size:12px;letter-spacing:.12em;color:#C9A227;font-weight:bold">LEAD WITH FX</div>' +
    '<h1 style="font-size:22px;color:#12294D;margin:8px 0 10px">' + (owner ? "Clarity Report for " : "Hi ") + first + (owner ? "" : ", here's your Clarity Report") + "</h1>" +
    '<p style="margin:0;font-size:15px;line-height:1.6;color:#4a5568"><b style="color:#12294D">' + a.band.title + ".</b> " + a.band.body + "</p>" +
    '<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#4a5568"><b style="color:#12294D">Your next step.</b> ' + a.band.step + "</p>" +
    sec("Your five themes", '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">' + bars + "</table>") +
    sec("A closer look at your answers", reflHtml) +
    sec("Your 90-day starter plan: " + a.low.n, plan) +
    sec("Using your strengths", '<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#4a5568">Take this free strengths assessment (about 15 minutes). It is run by an independent organisation, not by me. When you have your top strengths, look for the one that could lift your lowest theme, ' + a.low.n.toLowerCase() + ", and bring them to our intro call.</p>" + btn(ASSESS_URL, "Take the assessment")) +
    (owner ? "" : '<div style="margin-top:22px">' + btn(BOOK_URL, "Book a free intro call") + "</div>") +
    '<p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#6b7280">' + (owner ? "Prepared from the answers this person shared on leadwithfx.com, to go through together on the intro call." : "You got this one-off email because you asked for your report on leadwithfx.com. Freddie Xavier, Lead with FX, leadwithfx@gmail.com") + ' This is a reflection tool, not an assessment or a diagnosis.</p>' +
    "</div></div>";
  const text = ["Clarity Report for " + name, "", a.band.title + ". " + a.band.body, "Your next step. " + a.band.step, "",
    "YOUR FIVE THEMES", ...a.themes.map((t) => t.n + ": " + t.label), "",
    "A CLOSER LOOK AT YOUR ANSWERS", reflection, "",
    "YOUR 90-DAY STARTER PLAN: " + a.low.n.toUpperCase(), ...a.low.plan.map((p, i) => (i + 1) + ". " + p), "",
    "USING YOUR STRENGTHS", "Take this free strengths assessment (about 15 minutes), run by an independent organisation, not by me: " + ASSESS_URL, "",
    ...(owner ? [] : ["Book a free intro call: " + BOOK_URL, ""]),
    (owner ? "Prepared from the answers this person shared on leadwithfx.com, to go through together on the intro call." : "You got this one-off email because you asked for your report on leadwithfx.com. Freddie Xavier, Lead with FX, leadwithfx@gmail.com")].join("\n");
  return { subject: owner ? "Clarity Report for " + name : "Your Clarity Report, " + name, html, text };
}

async function brevo(env, path, payload) {
  return fetch("https://api.brevo.com/v3/" + path, {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
}

// Reliable delivery: a failed Brevo call is kept in a small D1 "outbox" and retried by the cron trigger.
// Rows exist only while a call is failing (deleted on success), so nothing is stored in normal operation.
const MAX_ATTEMPTS = 8, DEAD_KEEP_MS = 7 * 24 * 3600 * 1000;
const backoff = (attempts) => Math.min(3600 * 1000, 60 * 1000 * 2 ** (attempts - 1));
const retriable = (status) => status === 0 || status === 429 || status >= 500;
const log = (event, data) => console.log(JSON.stringify({ event, ...data }));

async function trySend(env, path, payload) {
  try { const r = await brevo(env, path, payload); return { ok: r.ok, status: r.status }; }
  catch { return { ok: false, status: 0 }; }
}

// Daily counters in D1 (table "daily"): emails sent today, per-person limits on the contact form, and alert de-duplication.
// Only hashed keys are kept (never an email address) and rows older than 3 days are purged. If D1 is unavailable, limits are skipped rather than blocking visitors.
const DAILY_EMAIL_BUDGET = 240; // Brevo's free plan allows 300 a day; the contact form pauses here so quiz reports and lead alerts still get through
const MSG_PER_PERSON = 2, CODES_PER_PERSON = 5;
const dayOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const readyDbs = new WeakSet();
async function dailyReady(env) {
  if (!env.DB) return false;
  if (readyDbs.has(env.DB)) return true;
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS daily (k TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (k, day))").run();
    readyDbs.add(env.DB); return true;
  } catch { return false; }
}
export async function bump(env, k, now = Date.now(), day = dayOf(now)) {
  if (!(await dailyReady(env))) return null;
  try {
    const { results } = await env.DB.prepare("INSERT INTO daily (k, day, n) VALUES (?, ?, 1) ON CONFLICT (k, day) DO UPDATE SET n = n + 1 RETURNING n").bind(k, day).all();
    return results && results[0] ? results[0].n : null;
  } catch { return null; }
}
export async function peek(env, k, now = Date.now(), day = dayOf(now)) {
  if (!(await dailyReady(env))) return null;
  try {
    const { results } = await env.DB.prepare("SELECT n FROM daily WHERE k = ? AND day = ?").bind(k, day).all();
    return results && results[0] ? results[0].n : 0;
  } catch { return null; }
}
// A plain email to the owner (not counted, not queued): used for alerts only.
async function alertOwner(env, subject, text) {
  if (!env.BREVO_API_KEY || !env.FROM_EMAIL || env.DRY_RUN === "1") return false;
  const r = await trySend(env, "smtp/email", { sender: { name: "Lead with FX alerts", email: env.FROM_EMAIL }, to: [{ email: env.ALERT_EMAIL || "leadwithfx@gmail.com" }], subject, textContent: text });
  log("alert", { subject, ok: r.ok });
  return r.ok;
}

// Returns "sent", "queued" (will be retried) or "failed" (not sent and not retryable).
export async function deliver(env, path, payload, now = Date.now()) {
  const r = await trySend(env, path, payload);
  if (r.ok) { if (path === "smtp/email") await bump(env, "emails", now); return "sent"; }
  log("send_failed", { path, status: r.status });
  if (env.DB && retriable(r.status)) {
    try {
      await env.DB.prepare("INSERT INTO outbox (id, path, payload, status, attempts, next_at, last_error, created_at) VALUES (?, ?, ?, 'pending', 1, ?, ?, ?)")
        .bind(crypto.randomUUID(), path, JSON.stringify(payload), now + backoff(1), "status " + r.status, now).run();
      log("outbox_queued", { path });
      if (path === "smtp/email") await bump(env, "emails", now);
      return "queued";
    } catch { log("outbox_write_failed", { path }); }
  }
  return "failed";
}

// Run by the cron trigger: retry due rows with exponential backoff, give up after MAX_ATTEMPTS.
export async function processOutbox(env, now = Date.now(), limit = 20) {
  const out = { sent: 0, retried: 0, dead: 0 };
  if (!env.DB || !env.BREVO_API_KEY || env.DRY_RUN === "1") return out;
  const { results } = await env.DB.prepare("SELECT id, path, payload, attempts FROM outbox WHERE status = 'pending' AND next_at <= ? ORDER BY next_at LIMIT ?").bind(now, limit).all();
  for (const row of results || []) {
    const r = await trySend(env, row.path, JSON.parse(row.payload));
    if (r.ok) { await env.DB.prepare("DELETE FROM outbox WHERE id = ?").bind(row.id).run(); out.sent++; log("outbox_sent", { path: row.path, attempts: row.attempts + 1 }); continue; }
    const attempts = row.attempts + 1;
    if (!retriable(r.status) || attempts >= MAX_ATTEMPTS) {
      await env.DB.prepare("UPDATE outbox SET status = 'dead', attempts = ?, last_error = ? WHERE id = ?").bind(attempts, "status " + r.status, row.id).run();
      out.dead++; log("outbox_dead", { path: row.path, attempts, status: r.status });
    } else {
      await env.DB.prepare("UPDATE outbox SET attempts = ?, next_at = ?, last_error = ? WHERE id = ?").bind(attempts, now + backoff(attempts), "status " + r.status, row.id).run();
      out.retried++;
    }
  }
  await env.DB.prepare("DELETE FROM outbox WHERE status = 'dead' AND created_at < ?").bind(now - DEAD_KEEP_MS).run();
  return out;
}

// Run by the cron trigger after the outbox: tells the owner about stuck sends, an unreachable site, and a spent email budget.
export async function watch(env, now = Date.now(), check = (u) => fetch(u, { redirect: "follow", signal: AbortSignal.timeout(8000) })) {
  const out = { dead: false, site: false };
  if (!env.DB || !env.BREVO_API_KEY || env.DRY_RUN === "1") return out;
  try {
    const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status = 'dead'").all();
    if (results && results[0] && results[0].n > 0 && (await bump(env, "alert:dead", now)) === 1) {
      out.dead = await alertOwner(env, "Lead with FX: " + results[0].n + " email(s) could not be sent", "The Worker gave up on " + results[0].n + " email(s) after repeated failures, so a visitor may not have received a report or a message, or you may have missed a lead. Check the Brevo transactional log (limits, sender, API key) and the Worker logs in Cloudflare. The failed emails are kept for 7 days in the clarity-outbox database (status 'dead').");
    }
  } catch { /* table missing: nothing to report */ }
  let up = false;
  try { const r = await check("https://leadwithfx.com/"); up = r.ok; } catch { up = false; }
  if (up) {
    if (await peek(env, "site_fail", now, "state")) await env.DB.prepare("DELETE FROM daily WHERE k = 'site_fail'").run();
  } else {
    const n = await bump(env, "site_fail", now, "state");
    if (n === 3) out.site = await alertOwner(env, "leadwithfx.com is not responding", "The site has failed three checks in a row (about 15 minutes). Check GitHub Pages (repo Settings > Pages and the latest deploy) and the domain in GoDaddy. You will not get another alert for this outage.");
  }
  try { await env.DB.prepare("DELETE FROM daily WHERE day < ? AND day != 'state'").bind(dayOf(now - 3 * 24 * 3600 * 1000)).run(); } catch { /* ignore */ }
  return out;
}

const MAX_BODY = 8192;

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
}
// A short-lived proof that this email already passed the human check, so the second step needs no new check.
export async function makeToken(env, email, now = Date.now()) {
  if (!env.TURNSTILE_SECRET) return "";
  const exp = now + 60 * 60 * 1000;
  return exp + "." + (await hmac(env.TURNSTILE_SECRET, "req|" + email.toLowerCase() + "|" + exp));
}
export async function tokenOk(env, email, tok, now = Date.now()) {
  if (!env.TURNSTILE_SECRET) return true; // not switched on yet
  const [exp, sig] = String(tok || "").split(".");
  if (!exp || !sig || !(Number(exp) > now)) return false;
  return sig === (await hmac(env.TURNSTILE_SECRET, "req|" + email.toLowerCase() + "|" + exp));
}

export async function humanOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true; // not switched on yet
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) return false;
  try {
    const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
    if (ip) form.set("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const d = await r.json();
    return !!(d && d.success);
  } catch { return false; }
}

// Insights email signup: one email address, explicit tick, human check, added to its own Brevo list.
export async function subscribe(env, body, ip, origin) {
  if (body.hp) return json({ error: "request" }, 400, origin);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (body.consent_news !== true || email.length > 254 || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return json({ error: "request" }, 400, origin);
  if (!(await humanOk(env, body.ts, ip))) return json({ error: "human" }, 403, origin);
  if (!env.INSIGHTS_LIST_ID || !env.BREVO_API_KEY) return json({ error: "off" }, 503, origin);
  if (env.DRY_RUN === "1") return json({ ok: true, dry: true }, 200, origin);
  const today = new Date().toISOString().slice(0, 10);
  const r = await deliver(env, "contacts", { email, attributes: { SOURCE: "Insights signup", CONSENT_DATE: today }, listIds: [Number(env.INSIGHTS_LIST_ID)], updateEnabled: true });
  if (r === "failed") return json({ error: "send" }, 502, origin);
  return json({ ok: true }, 200, origin);
}

// "Drop me a message": the visitor writes a message, we email a 6-digit code to their address, and the message is sent to the owner only after they enter it.
// Nothing is stored: the code is bound to the email, name and message by a signed token that the page holds and returns.
const MSG_MAX = 2000, CODE_TTL_MS = 10 * 60 * 1000;
export function validateMessage(body) {
  if (!body || body.hp || body.consent_msg !== true) return null;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const message = typeof body.message === "string" ? body.message.replace(/\r\n?/g, "\n").trim() : "";
  if (!name || name.length > 60 || /[\u0000-\u001f<>]/.test(name)) return null;
  if (email.length > 254 || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return null;
  if (!message || message.length > MSG_MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(message)) return null;
  return { name, email, message };
}
const codeSig = (env, m, code, exp) => hmac(env.TURNSTILE_SECRET, ["msg", m.email.toLowerCase(), code, exp, m.name, m.message].join("|"));
function newCode() { const n = new Uint32Array(1); crypto.getRandomValues(n); return String(n[0] % 1000000).padStart(6, "0"); }
const para = (s) => esc(s).split(/\n/).join("<br>");
const wrap = (inner) => '<div style="background:#FAF8F3;padding:24px 12px;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 26px"><div style="font-size:12px;letter-spacing:.12em;color:#C9A227;font-weight:bold">LEAD WITH FX</div>' + inner + "</div></div>";

export async function contact(env, body, ip, origin, now = Date.now()) {
  const m = validateMessage(body);
  if (!m) return json({ error: "request" }, 400, origin);
  if (!env.TURNSTILE_SECRET || !env.BREVO_API_KEY || !env.FROM_EMAIL) return json({ error: "off" }, 503, origin);
  const dry = env.DRY_RUN === "1";
  const sender = { name: "Freddie at Lead with FX", email: env.FROM_EMAIL };
  const to = [{ email: env.ALERT_EMAIL || "leadwithfx@gmail.com" }];

  const who = "msg:" + (await hmac(env.TURNSTILE_SECRET, "ctr|" + m.email.toLowerCase()));
  if (body.stage === "msg_code") {
    if (!(await humanOk(env, body.ts, ip))) return json({ error: "human" }, 403, origin);
    const used = await peek(env, "emails", now);
    if (used !== null && used >= DAILY_EMAIL_BUDGET) {
      if ((await bump(env, "alert:budget", now)) === 1) await alertOwner(env, "Lead with FX: contact form paused for today", "About " + used + " emails have been sent today, close to Brevo's 300 a day. The contact form is paused until tomorrow (UTC) so quiz reports and lead alerts still get through. Visitors are told to email you instead.");
      return json({ error: "busy" }, 503, origin);
    }
    if (((await peek(env, who, now)) || 0) >= MSG_PER_PERSON) return json({ error: "limit" }, 429, origin);
    if (((await bump(env, "code:" + who, now)) || 0) > CODES_PER_PERSON) return json({ error: "limit" }, 429, origin);
    const code = newCode(), exp = now + CODE_TTL_MS;
    const tok = exp + "." + (await codeSig(env, m, code, exp));
    if (dry) return json({ ok: true, dry: true, code, tok }, 200, origin);
    const html = wrap('<h1 style="font-size:22px;color:#12294D;margin:8px 0 10px">Your code: ' + code + '</h1><p style="margin:0;font-size:15px;line-height:1.6;color:#4a5568">Hi ' + esc(m.name) + ", enter this code on leadwithfx.com to confirm your email address and send your message. It works for 10 minutes.</p>" +
      '<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#6b7280">If you did not ask for this, ignore this email and nothing will be sent.</p>');
    const text = "Your code: " + code + "\n\nEnter it on leadwithfx.com to confirm your email address and send your message. It works for 10 minutes.\nIf you did not ask for this, ignore this email and nothing will be sent.";
    const r = await deliver(env, "smtp/email", { sender, replyTo: { email: "leadwithfx@gmail.com", name: "Freddie Xavier" }, to: [{ email: m.email, name: m.name }], subject: "Your code to send a message: " + code, htmlContent: html, textContent: text });
    if (r === "failed") return json({ error: "send" }, 502, origin);
    return json({ ok: true, tok }, 200, origin);
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const [exp, sig] = String(body.tok || "").split(".");
  if (!/^\d{6}$/.test(code) || !exp || !sig || !(Number(exp) > now)) return json({ error: "code" }, 403, origin);
  if (sig !== (await codeSig(env, m, code, exp))) return json({ error: "code" }, 403, origin);
  if (((await peek(env, who, now)) || 0) >= MSG_PER_PERSON) return json({ error: "limit" }, 429, origin);
  const subject = "Message from " + m.name + " via leadwithfx.com";
  if (dry) return json({ ok: true, dry: true, subject }, 200, origin);
  const mine = await deliver(env, "smtp/email", { sender, replyTo: { email: m.email, name: m.name }, to, subject,
    htmlContent: wrap('<h1 style="font-size:20px;color:#12294D;margin:8px 0 10px">' + esc(m.name) + " (" + esc(m.email) + ')</h1><p style="margin:0 0 12px;font-size:12px;color:#6b7280">Email address confirmed with a code. Reply to this email to answer.</p><p style="margin:0;font-size:15px;line-height:1.6;color:#4a5568">' + para(m.message) + "</p>"),
    textContent: m.name + " <" + m.email + ">\nEmail address confirmed with a code. Reply to this email to answer.\n\n" + m.message });
  const theirs = await deliver(env, "smtp/email", { sender, replyTo: { email: "leadwithfx@gmail.com", name: "Freddie Xavier" }, to: [{ email: m.email, name: m.name }], subject: "I got your message",
    htmlContent: wrap('<h1 style="font-size:20px;color:#12294D;margin:8px 0 10px">Thanks ' + esc(m.name) + ', I got your message</h1><p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#4a5568">I&rsquo;ll reply as soon as I see it, but please allow up to 72 hours.</p><p style="margin:0;font-size:14px;line-height:1.6;color:#6b7280"><b>Your message</b><br>' + para(m.message) + "</p>"),
    textContent: "Thanks " + m.name + ", I got your message.\nI'll reply as soon as I see it, but please allow up to 72 hours.\n\nYour message:\n" + m.message });
  if (mine !== "failed") await bump(env, who, now);
  if (mine === "failed" || theirs === "failed") return json({ error: "send" }, 502, origin);
  return json({ ok: true, ...(mine === "queued" || theirs === "queued" ? { queued: true } : {}) }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return json({ error: "method" }, 405, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: "origin" }, 403, origin);

    const ip = request.headers.get("CF-Connecting-IP") || "";
    if (env.LIMITER) {
      try { const { success } = await env.LIMITER.limit({ key: ip || origin }); if (!success) return json({ error: "slow" }, 429, origin); } catch { /* limiter unavailable: carry on */ }
    }
    const len = Number(request.headers.get("content-length") || 0);
    if (len > MAX_BODY) return json({ error: "size" }, 413, origin);
    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return json({ error: "size" }, 413, origin);
      body = JSON.parse(raw);
    } catch { return json({ error: "json" }, 400, origin); }
    if (body && body.stage === "subscribe") return subscribe(env, body, ip, origin);
    if (body && (body.stage === "msg_code" || body.stage === "msg_send")) return contact(env, body, ip, origin);
    const req = validateRequest(body);
    if (!req) return json({ error: "request" }, 400, origin);
    if (req.stage === "request") {
      if (!(await tokenOk(env, req.email, req.tok))) return json({ error: "human" }, 403, origin);
    } else if (!(await humanOk(env, body.ts, ip))) return json({ error: "human" }, 403, origin);

    const a = analyse(req.nums);
    const today = new Date().toISOString().slice(0, 10);
    const wants = req.stage === "request";
    const attrs = { FIRSTNAME: req.name, BAND: a.band.title, PROFILE: PROFILE[req.nums[0] - 1], COACHED_BEFORE: COACHED[req.nums[1] - 1], HELPED_BEFORE: HELPED[req.nums[2] - 1], LOWEST_THEME: a.low.n, CONSENT_DATE: today, STAGE: "Requested full report and call" };
    const rows = [["Name", req.name], ["Email", req.email], ["Result", a.band.title], ["Profile", attrs.PROFILE], ["Coaching before", attrs.COACHED_BEFORE], ["What helped before", attrs.HELPED_BEFORE], ["Lowest theme", a.low.n], ["Status", wants ? "Ticked: wants the full report and a call, and agreed Freddie can contact them (" + today + ")" : "Result only: has not asked for a call yet"]];
    const lead = '<table cellpadding="6" style="font-family:Arial,sans-serif;font-size:14px;margin-bottom:12px">' + rows.map((r) => "<tr><td><b>" + r[0] + "</b></td><td>" + esc(r[1]) + "</td></tr>").join("") + "</table>";
    const rowsText = rows.map((r) => r[0] + ": " + r[1]).join("\n");
    const sender = { name: "Freddie at Lead with FX", email: env.FROM_EMAIL };
    const to = [{ email: env.ALERT_EMAIL || "leadwithfx@gmail.com" }];
    const dry = env.DRY_RUN === "1" || !env.BREVO_API_KEY;

    if (wants) {
      const subject = "Wants full report and call: " + req.name + ", " + a.band.title;
      if (dry) return json({ ok: true, dry: true, subject, stage: "request" }, 200, origin);
      const mine = await deliver(env, "smtp/email", { sender, replyTo: { email: req.email, name: req.name }, to, subject,
        htmlContent: lead + '<p style="font-family:Arial,sans-serif;font-size:14px">The full report was in the earlier "New lead" email for this person.</p>', textContent: rowsText + "\n\nThe full report was in the earlier New lead email for this person." });
      if (mine === "failed") return json({ error: "send" }, 502, origin);
      // Saving the contact is retried too, so a lead is not lost from the pipeline if Brevo has a bad moment.
      await deliver(env, "contacts", { email: req.email, attributes: attrs, listIds: env.BREVO_LIST_ID ? [Number(env.BREVO_LIST_ID)] : [], updateEnabled: true });
      return json({ ok: true }, 200, origin);
    }

    const report = buildReport(req.name, req.nums, a);
    const ownerCopy = buildReport(req.name, req.nums, a, true);
    const tok = await makeToken(env, req.email);
    if (dry) return json({ ok: true, dry: true, subject: report.subject, html: report.html, text: report.text, tok }, 200, origin);

    // Each email is delivered (or queued for retry) on its own, so a retry never sends the other one twice.
    const mine = await deliver(env, "smtp/email", { sender, replyTo: { email: req.email, name: req.name }, to,
      subject: "New lead: " + req.name + ", " + a.band.title, htmlContent: lead + ownerCopy.html, textContent: rowsText + "\n\n" + ownerCopy.text });
    const theirs = await deliver(env, "smtp/email", { sender, replyTo: { email: "leadwithfx@gmail.com", name: "Freddie Xavier" },
      to: [{ email: req.email, name: req.name }], subject: report.subject, htmlContent: report.html, textContent: report.text });
    if (mine === "failed" || theirs === "failed") return json({ error: "send" }, 502, origin);
    return json({ ok: true, tok, ...(mine === "queued" || theirs === "queued" ? { queued: true } : {}) }, 200, origin);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(processOutbox(env).then((r) => log("outbox_run", r)).then(() => watch(env)).then((r) => log("watch_run", r)));
  },
};
