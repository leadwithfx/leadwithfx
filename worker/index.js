// Cloudflare Worker for the Clarity Report.
// Receives answer numbers plus a first name and email. Step 1 ("result") emails the full report to the owner and a confirmation to the visitor.
// Step 2 ("request", only if the visitor ticks the box) alerts the owner and adds them to the pipeline.
// Free-text never reaches the AI: only the answer numbers do.
//
// Secrets and variables (Cloudflare > Worker > Settings):
//   ANTHROPIC_API_KEY (secret)   BREVO_API_KEY (secret)
//   FROM_EMAIL (a sender verified in Brevo, e.g. hello@leadwithfx.com)
//   ALERT_EMAIL (where lead alerts go)   BREVO_LIST_ID (number, the pipeline list)
//   Optional: MODEL, DRY_RUN=1 (builds the report but sends nothing)
//   Abuse protection (each is optional and switches on when set):
//     TURNSTILE_SECRET (secret)  Cloudflare Turnstile secret key: requires a human check token from the quiz page
//     LIMITER (rate limit binding)  per-visitor limit, e.g. 3 requests per 60 seconds; see README

const ALLOWED_ORIGINS = ["https://leadwithfx.com", "https://www.leadwithfx.com"];
const BOOK_URL = "https://calendly.com/freddie-rx";
const ASSESS_URL = "https://www.viacharacter.org/account/register";

const SYSTEM = `You write a short, warm, plain-English reflection for someone who has just completed a five-question career "Clarity Check".
You are given their answers as question and chosen option pairs. The first three items say who they are, whether they have worked with a coach before, and what has helped them get unstuck before.
Rules:
- 90 to 120 words, two short paragraphs, no headings, no bullet points, no emojis.
- Paragraph 1: name what looks strong, then the main gap you can see, using only what their answers show.
- Paragraph 2: end with one reflective question for them to think about.
- Do not give instructions, advice, diagnoses, guarantees or predictions.
- Do not mention coaching services, a coach, Freddie, prices or booking.
- Do not invent facts about their job, employer or life beyond the answers.
- Use "you". Plain language. Australian spelling.`;

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
    return { n: t.n, frac, label: frac < 0.34 ? "Early" : frac < 0.67 ? "Building" : "Strong", plan: t.plan };
  });
  let low = themes[0], high = themes[0];
  themes.forEach((t) => { if (t.frac < low.frac) low = t; if (t.frac > high.frac) high = t; });
  return { score, band, themes, low, high };
}

export function fallbackReflection(a) {
  return "Your answers point to " + a.high.n.toLowerCase() + " as your strongest theme right now, and " + a.low.n.toLowerCase() +
    " as the one with the most room to grow.\n\nA question to sit with: what would be different in 90 days if " + a.low.n.toLowerCase() + " moved up one level?";
}

const PROFILE = QUESTIONS[0].o, COACHED = QUESTIONS[1].o, HELPED = QUESTIONS[2].o;

export function buildReport(name, nums, a, reflection, aiWritten) {
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
    '<h1 style="font-size:22px;color:#12294D;margin:8px 0 10px">Clarity Report for ' + first + "</h1>" +
    '<p style="margin:0;font-size:15px;line-height:1.6;color:#4a5568"><b style="color:#12294D">' + a.band.title + ".</b> " + a.band.body + "</p>" +
    '<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#4a5568"><b style="color:#12294D">Your next step.</b> ' + a.band.step + "</p>" +
    sec("Your five themes", '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">' + bars + "</table>") +
    sec("A closer look at your answers", reflHtml + (aiWritten ? '<p style="margin:6px 0 0;font-size:12px;color:#6b7280">Written by AI from your answers only. It is not from Freddie, and it is not advice.</p>' : "")) +
    sec("Your 90-day starter plan: " + a.low.n, plan) +
    sec("Using your strengths", '<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#4a5568">Take this free strengths assessment (about 15 minutes). It is run by an independent organisation, not by me. When you have your top strengths, look for the one that could lift your lowest theme, ' + a.low.n.toLowerCase() + ", and bring them to our intro call.</p>" + btn(ASSESS_URL, "Take the assessment")) +
    '<p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#6b7280">Prepared from the answers this person shared on leadwithfx.com, to go through together on the intro call. This is a reflection tool, not an assessment or a diagnosis.</p>' +
    "</div></div>";
  const text = ["Clarity Report for " + name, "", a.band.title + ". " + a.band.body, "Your next step. " + a.band.step, "",
    "YOUR FIVE THEMES", ...a.themes.map((t) => t.n + ": " + t.label), "",
    "A CLOSER LOOK AT YOUR ANSWERS", reflection + (aiWritten ? "\n(Written by AI from your answers only. It is not from Freddie, and it is not advice.)" : ""), "",
    "YOUR 90-DAY STARTER PLAN: " + a.low.n.toUpperCase(), ...a.low.plan.map((p, i) => (i + 1) + ". " + p), "",
    "USING YOUR STRENGTHS", "Take this free strengths assessment (about 15 minutes), run by an independent organisation, not by me: " + ASSESS_URL, "",
    "Prepared from the answers this person shared on leadwithfx.com, to go through together on the intro call."].join("\n");
  return { subject: "Clarity Report for " + name, html, text };
}

export function buildConfirmation(name) {
  const first = esc(name);
  const p = (t) => '<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#4a5568">' + t + "</p>";
  const html = '<div style="background:#FAF8F3;padding:24px 12px;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 26px">' +
    '<div style="font-size:12px;letter-spacing:.12em;color:#C9A227;font-weight:bold">LEAD WITH FX</div>' +
    '<h1 style="font-size:22px;color:#12294D;margin:8px 0 14px">Thanks, ' + first + "</h1>" +
    p("I have your Clarity Check answers and I'm preparing your full Clarity Report.") +
    p("The best next step is a free intro call. I'll share your report with you there, and we'll talk about what you're looking for and whether I can help.") +
    '<div style="margin:18px 0"><a href="' + BOOK_URL + '" style="display:inline-block;background:#C9A227;color:#12294D;font-weight:bold;font-size:14px;text-decoration:none;padding:12px 22px;border-radius:999px">Book a free intro call</a></div>' +
    '<p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#6b7280">You got this one-off email because you shared your Clarity Check answers on leadwithfx.com. Freddie Xavier, Lead with FX, leadwithfx@gmail.com</p>' +
    "</div></div>";
  const text = ["Thanks, " + name, "", "I have your Clarity Check answers and I'm preparing your full Clarity Report.", "",
    "The best next step is a free intro call. I'll share your report with you there, and we'll talk about what you're looking for and whether I can help.", "",
    "Book a free intro call: " + BOOK_URL, "",
    "You got this one-off email because you shared your Clarity Check answers on leadwithfx.com. Freddie Xavier, Lead with FX, leadwithfx@gmail.com"].join("\n");
  return { subject: "Thanks, " + name + ": let's book your intro call", html, text };
}

async function aiReflection(env, nums) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const userText = nums.map((n, i) => (i === 0 ? "Who they are" : i === 1 ? "Coaching history" : i === 2 ? "What has helped them get unstuck" : "Q" + (i - 2)) + ": " + QUESTIONS[i].q + " -> " + QUESTIONS[i].o[n - 1]).join("\n");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: env.MODEL || "claude-haiku-5-5", max_tokens: 350, system: SYSTEM, messages: [{ role: "user", content: userText }] }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const text = ((d.content && d.content[0] && d.content[0].text) || "").trim();
    return text.length > 20 && text.length < 1500 ? text : null;
  } catch { return null; } finally { clearTimeout(t); }
}

async function brevo(env, path, payload) {
  return fetch("https://api.brevo.com/v3/" + path, {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
}

const MAX_BODY = 4096;

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
      const mine = await brevo(env, "smtp/email", { sender, replyTo: { email: req.email, name: req.name }, to, subject,
        htmlContent: lead + '<p style="font-family:Arial,sans-serif;font-size:14px">The full report was in the earlier "New lead" email for this person.</p>', textContent: rowsText + "\n\nThe full report was in the earlier New lead email for this person." });
      if (!mine.ok) return json({ error: "send" }, 502, origin);
      try {
        await brevo(env, "contacts", { email: req.email, attributes: attrs, listIds: env.BREVO_LIST_ID ? [Number(env.BREVO_LIST_ID)] : [], updateEnabled: true });
      } catch { /* the request already reached Freddie */ }
      return json({ ok: true }, 200, origin);
    }

    const ai = await aiReflection(env, req.nums);
    const report = buildReport(req.name, req.nums, a, ai || fallbackReflection(a), !!ai);
    const confirm = buildConfirmation(req.name);
    const tok = await makeToken(env, req.email);
    if (dry) return json({ ok: true, dry: true, subject: report.subject, html: report.html, text: report.text, confirmation: confirm.html, tok }, 200, origin);

    const mine = await brevo(env, "smtp/email", { sender, replyTo: { email: req.email, name: req.name }, to,
      subject: "New lead: " + req.name + ", " + a.band.title, htmlContent: lead + report.html, textContent: rowsText + "\n\n" + report.text });
    if (!mine.ok) return json({ error: "send" }, 502, origin);
    try {
      await brevo(env, "smtp/email", { sender, replyTo: { email: "leadwithfx@gmail.com", name: "Freddie Xavier" },
        to: [{ email: req.email, name: req.name }], subject: confirm.subject, htmlContent: confirm.html, textContent: confirm.text });
    } catch { /* the lead already reached Freddie; the confirmation must not break the visitor's flow */ }
    return json({ ok: true, tok }, 200, origin);
  },
};
