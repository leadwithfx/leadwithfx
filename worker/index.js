// Cloudflare Worker for the Clarity Report.
// Receives answer numbers plus a first name and email, writes the report, emails it once,
// and (only if the person opted in) adds them to the pipeline and alerts the owner.
// Free-text never reaches the AI: only the answer numbers do.
//
// Secrets and variables (Cloudflare > Worker > Settings):
//   ANTHROPIC_API_KEY (secret)   BREVO_API_KEY (secret)
//   FROM_EMAIL (a sender verified in Brevo, e.g. hello@leadwithfx.com)
//   ALERT_EMAIL (where lead alerts go)   BREVO_LIST_ID (number, the pipeline list)
//   Optional: MODEL, DRY_RUN=1 (builds the report but sends nothing)

const ALLOWED_ORIGINS = ["https://leadwithfx.com", "https://www.leadwithfx.com"];
const BOOK_URL = "https://calendly.com/freddie-rx";
const ASSESS_URL = "https://www.viacharacter.org/account/register";

const SYSTEM = `You write a short, warm, plain-English reflection for someone who has just completed a ten-question career "Clarity Check".
You are given their answers as question and chosen option pairs. The first two items say who they are and whether they have worked with a coach before.
Rules:
- 90 to 120 words, two short paragraphs, no headings, no bullet points, no emojis.
- Paragraph 1: name what looks strong, then the main gap you can see, using only what their answers show.
- Paragraph 2: end with one reflective question for them to think about.
- Do not give instructions, advice, diagnoses, guarantees or predictions.
- Do not mention coaching services, a coach, Freddie, prices or booking.
- Do not invent facts about their job, employer or life beyond the answers.
- Use "you". Plain language. Australian spelling.`;

const QUESTIONS = [{"q":"Which best describes you?","o":["Tech leader or manager","Career changer","Early-career professional","Something else"]},{"q":"Have you worked with a coach before?","o":["No, this would be my first time","Once or twice","Yes, several times"]},{"q":"How clear are you on your next role or move?","o":["I have no real idea","A few options, but nothing feels right","I have a direction, but I'm not sure it's the right one","I know exactly what I want next"]},{"q":"When you face an important career decision, you usually…","o":["Put it off","Go round in circles","Weigh it up, then decide with some doubt","Decide with confidence and act"]},{"q":"How well do the people who matter know the value you bring?","o":["Hardly at all","Some of them","Most of them, but not the key decision makers","Clearly, including the key decision makers"]},{"q":"Do you have a plan with dates for your next 90 days?","o":["No plan","A rough idea in my head","A written plan, but I'm not following it","A written plan I'm working through"]},{"q":"Who holds you accountable for your growth?","o":["Nobody","I only check in with myself","Someone occasionally","Someone regularly, and it works"]},{"q":"How would you describe your momentum right now?","o":["Stuck","Slow and stop-start","Steady, but not going where I want","Moving, and building speed"]},{"q":"How well do you know the gap between where you are and the next level?","o":["I have no idea what it takes","I have a vague sense","I know some of the gaps, but haven't confirmed them","I know exactly what to build next"]},{"q":"How much of your time goes on what matters most for your growth?","o":["Almost none, I'm in firefighting mode","A little, when I can find the time","About half","Most of it, and I protect that time"]},{"q":"How confident are you influencing senior stakeholders?","o":["I avoid it","I do it, but it feels uncomfortable","Fairly confident in familiar situations","Confident, even in high-stakes rooms"]},{"q":"Who speaks up for you when you're not in the room?","o":["Nobody","One or two people, rarely","A few people, but not senior ones","Several senior sponsors who advocate for me"]}];

const THEMES = [
  { n: "Clarity", q: [1, 2, 7], plan: [
    "Write one sentence on the role or move you want next, and why it matters to you.",
    "List the three biggest gaps between you and it, then ask someone who has been there which one matters most.",
    "Set a date to decide, and put it in your calendar." ] },
  { n: "Visibility", q: [3, 10], plan: [
    "List the five people who most shape your next step, and what each of them knows about your work.",
    "Share one recent result with a senior person this month.",
    "Ask someone you trust what you are known for, and whether that matches what you want to be known for." ] },
  { n: "Accountability", q: [4, 5], plan: [
    "Pick one growth goal for the next 90 days and write it down with a date.",
    "Book a standing monthly check-in with someone who will be straight with you.",
    "Review your progress at day 30, day 60 and day 90." ] },
  { n: "Momentum", q: [6, 8], plan: [
    "Block two hours a week in your calendar for your growth, and protect them.",
    "Each week, do the one task that moves you most before anything else.",
    "At the end of each month, write down one thing you finished." ] },
  { n: "Influence", q: [9], plan: [
    "Before your next senior meeting, write the one point you want them to leave with.",
    "Ask a senior stakeholder for 15 minutes to understand their priorities.",
    "Afterwards, note what landed and what didn't." ] },
];
const BANDS = [
  { max: 18, title: "Light the path", body: "Right now the main thing missing is clarity. You have the experience and the tools, but too many thoughts and options are competing, so it's hard to see the way forward.", step: "Start by getting a candid look at where you are, what's working and what's in the way. That makes the next move much easier to choose." },
  { max: 30, title: "Take the step", body: "You can already see some of the path. What holds you back now is choosing the next move and committing to it, rather than waiting until everything feels certain.", step: "Pick one focused move, decide when you'll do it, and use practical tools you can apply in your next meeting, not next quarter." },
  { max: 40, title: "Keep moving", body: "You have clarity and momentum. The risk now is drifting, or plateauing without noticing, because nobody is checking your direction.", step: "Add regular check-ins and honest accountability, and plan for the next level before you need it." },
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
  return { nums, name, email, contact: body.consent_contact === true };
}

export function analyse(nums) {
  const score = nums.slice(2).reduce((a, b) => a + b, 0);
  const band = BANDS.find((b) => score <= b.max) || BANDS[BANDS.length - 1];
  const themes = THEMES.map((t) => {
    const vals = t.q.map((k) => nums[k + 1]);
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

const PROFILE = QUESTIONS[0].o, COACHED = QUESTIONS[1].o;

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
    '<h1 style="font-size:22px;color:#12294D;margin:8px 0 10px">Hi ' + first + ", here's your Clarity Report</h1>" +
    '<p style="margin:0;font-size:15px;line-height:1.6;color:#4a5568"><b style="color:#12294D">' + a.band.title + ".</b> " + a.band.body + "</p>" +
    '<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#4a5568"><b style="color:#12294D">Your next step.</b> ' + a.band.step + "</p>" +
    sec("Your five themes", '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">' + bars + "</table>") +
    sec("A closer look at your answers", reflHtml + (aiWritten ? '<p style="margin:6px 0 0;font-size:12px;color:#6b7280">Written by AI from your answers only. It is not from Freddie, and it is not advice.</p>' : "")) +
    sec("Your 90-day starter plan: " + a.low.n, plan) +
    sec("Using your strengths", '<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#4a5568">Take this free strengths assessment (about 15 minutes). It is run by an independent organisation, not by me. When you have your top strengths, look for the one that could lift your lowest theme, ' + a.low.n.toLowerCase() + ", and bring them to our intro call.</p>" + btn(ASSESS_URL, "Take the assessment")) +
    '<div style="margin-top:22px">' + btn(BOOK_URL, "Book a free intro call") + "</div>" +
    '<p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#6b7280">You got this one-off email because you asked for your report on leadwithfx.com. This is a reflection tool, not an assessment or a diagnosis. Freddie Xavier, Lead with FX, leadwithfx@gmail.com</p>' +
    "</div></div>";
  const text = ["Hi " + name + ", here's your Clarity Report", "", a.band.title + ". " + a.band.body, "Your next step. " + a.band.step, "",
    "YOUR FIVE THEMES", ...a.themes.map((t) => t.n + ": " + t.label), "",
    "A CLOSER LOOK AT YOUR ANSWERS", reflection + (aiWritten ? "\n(Written by AI from your answers only. It is not from Freddie, and it is not advice.)" : ""), "",
    "YOUR 90-DAY STARTER PLAN: " + a.low.n.toUpperCase(), ...a.low.plan.map((p, i) => (i + 1) + ". " + p), "",
    "USING YOUR STRENGTHS", "Take this free strengths assessment (about 15 minutes), run by an independent organisation, not by me: " + ASSESS_URL, "",
    "Book a free intro call: " + BOOK_URL, "",
    "You got this one-off email because you asked for your report on leadwithfx.com. Freddie Xavier, Lead with FX, leadwithfx@gmail.com"].join("\n");
  return { subject: "Your Clarity Report, " + name, html, text };
}

async function aiReflection(env, nums) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const userText = nums.map((n, i) => (i === 0 ? "Who they are" : i === 1 ? "Coaching history" : "Q" + (i - 1)) + ": " + QUESTIONS[i].q + " -> " + QUESTIONS[i].o[n - 1]).join("\n");
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return json({ error: "method" }, 405, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: "origin" }, 403, origin);

    let body;
    try { body = await request.json(); } catch { return json({ error: "json" }, 400, origin); }
    const req = validateRequest(body);
    if (!req) return json({ error: "request" }, 400, origin);

    const a = analyse(req.nums);
    const ai = await aiReflection(env, req.nums);
    const report = buildReport(req.name, req.nums, a, ai || fallbackReflection(a), !!ai);

    if (env.DRY_RUN === "1" || !env.BREVO_API_KEY) {
      return json({ ok: true, dry: true, subject: report.subject, html: report.html, text: report.text, lead: req.contact }, 200, origin);
    }

    const sender = { name: "Freddie at Lead with FX", email: env.FROM_EMAIL };
    const sent = await brevo(env, "smtp/email", {
      sender, replyTo: { email: "leadwithfx@gmail.com", name: "Freddie Xavier" },
      to: [{ email: req.email, name: req.name }],
      subject: report.subject, htmlContent: report.html, textContent: report.text,
    });
    if (!sent.ok) return json({ error: "send" }, 502, origin);

    if (req.contact) {
      const today = new Date().toISOString().slice(0, 10);
      const attrs = { FIRSTNAME: req.name, BAND: a.band.title, PROFILE: PROFILE[req.nums[0] - 1], COACHED_BEFORE: COACHED[req.nums[1] - 1], LOWEST_THEME: a.low.n, CONSENT_DATE: today, STAGE: "Report sent" };
      try {
        await brevo(env, "contacts", { email: req.email, attributes: attrs, listIds: env.BREVO_LIST_ID ? [Number(env.BREVO_LIST_ID)] : [], updateEnabled: true });
        if (env.ALERT_EMAIL) {
          const rows = [["Name", req.name], ["Email", req.email], ["Result", a.band.title], ["Profile", attrs.PROFILE], ["Coaching before", attrs.COACHED_BEFORE], ["Lowest theme", a.low.n], ["Consent", "Ticked: Freddie can contact me personally (" + today + ")"], ["Stage", "Report sent"]];
          await brevo(env, "smtp/email", {
            sender, to: [{ email: env.ALERT_EMAIL }],
            subject: "New lead: " + req.name + ", " + a.band.title,
            htmlContent: '<table cellpadding="6" style="font-family:Arial,sans-serif;font-size:14px">' + rows.map((r) => "<tr><td><b>" + r[0] + "</b></td><td>" + esc(r[1]) + "</td></tr>").join("") + "</table>",
            textContent: rows.map((r) => r[0] + ": " + r[1]).join("\n"),
          });
        }
      } catch { /* the report was already sent; pipeline errors must not break the visitor's flow */ }
    }
    return json({ ok: true }, 200, origin);
  },
};
