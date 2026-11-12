// Cloudflare Worker: writes a short reflection from Clarity Check answers.
// Receives ONLY answer numbers (never free text), so no personal details reach the AI.
// Secrets/vars to set in Cloudflare: ANTHROPIC_API_KEY (secret), optional MODEL.

const ALLOWED_ORIGINS = ["https://leadwithfx.com", "https://www.leadwithfx.com"];
const QUESTIONS = [{"q":"Which best describes you?","o":["Tech leader or manager","Career changer","Early-career professional","Something else"]},{"q":"How clear are you on your next role or move?","o":["I have no real idea","A few options, but nothing feels right","I have a direction, but I'm not sure it's the right one","I know exactly what I want next"]},{"q":"When you face an important career decision, you usually…","o":["Put it off","Go round in circles","Weigh it up, then decide with some doubt","Decide with confidence and act"]},{"q":"How well do the people who matter know the value you bring?","o":["Hardly at all","Some of them","Most of them, but not the key decision makers","Clearly, including the key decision makers"]},{"q":"Do you have a plan with dates for your next 90 days?","o":["No plan","A rough idea in my head","A written plan, but I'm not following it","A written plan I'm working through"]},{"q":"Who holds you accountable for your growth?","o":["Nobody","I only check in with myself","Someone occasionally","Someone regularly, and it works"]},{"q":"How would you describe your momentum right now?","o":["Stuck","Slow and stop-start","Steady, but not going where I want","Moving, and building speed"]},{"q":"How well do you know the gap between where you are and the next level?","o":["I have no idea what it takes","I have a vague sense","I know some of the gaps, but haven't confirmed them","I know exactly what to build next"]},{"q":"How much of your time goes on what matters most for your growth?","o":["Almost none, I'm in firefighting mode","A little, when I can find the time","About half","Most of it, and I protect that time"]},{"q":"How confident are you influencing senior stakeholders?","o":["I avoid it","I do it, but it feels uncomfortable","Fairly confident in familiar situations","Confident, even in high-stakes rooms"]},{"q":"Who speaks up for you when you're not in the room?","o":["Nobody","One or two people, rarely","A few people, but not senior ones","Several senior sponsors who advocate for me"]}];

const SYSTEM = `You write a short, warm, plain-English reflection for someone who has just completed a ten-question career "Clarity Check".
You are given their answers as question and chosen option pairs. The first item says who they are.
Rules:
- 90 to 120 words, two short paragraphs, no headings, no bullet points, no emojis.
- Paragraph 1: name what looks strong, then the main gap you can see, using only what their answers show.
- Paragraph 2: end with one reflective question for them to think about.
- Do not give instructions, advice, diagnoses, guarantees or predictions.
- Do not mention coaching services, a coach, Freddie, prices or booking.
- Do not invent facts about their job, employer or life beyond the answers.
- Use "you". Plain language. Australian spelling.`;

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

export function validate(body) {
  if (!body || !Array.isArray(body.a) || body.a.length !== QUESTIONS.length) return null;
  const out = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const n = body.a[i];
    if (!Number.isInteger(n) || n < 1 || n > QUESTIONS[i].o.length) return null;
    out.push({ q: QUESTIONS[i].q, a: QUESTIONS[i].o[n - 1] });
  }
  return out;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return json({ error: "method" }, 405, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: "origin" }, 403, origin);

    let body;
    try { body = await request.json(); } catch { return json({ error: "json" }, 400, origin); }
    const pairs = validate(body);
    if (!pairs) return json({ error: "answers" }, 400, origin);

    const userText = pairs.map((p, i) => (i === 0 ? "Who they are" : "Q" + i) + ": " + p.q + " -> " + p.a).join("\n");

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.MODEL || "claude-haiku-5-5",
        max_tokens: 350,
        system: SYSTEM,
        messages: [{ role: "user", content: userText }],
      }),
    });
    if (!r.ok) return json({ error: "upstream" }, 502, origin);
    const data = await r.json();
    const text = (data.content && data.content[0] && data.content[0].text || "").trim();
    if (!text) return json({ error: "empty" }, 502, origin);
    return json({ summary: text }, 200, origin);
  },
};
