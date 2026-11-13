# Clarity Report: setup

The site is static, so the report is built and emailed by a small Cloudflare Worker (`worker/index.js`).
It accepts only answer numbers, a first name, an email and two consent flags, and only from leadwithfx.com.
Until you set `REPORT_ENDPOINT` in `quiz.html`, the form runs in **test mode** and sends nothing.

## What it does
1. Validates the request (consent to the report is required; a hidden honeypot field blocks simple bots).
2. Scores the answers into the overall result and five themes (Clarity, Visibility, Accountability, Momentum, Influence) and picks the lowest theme for the 90-day plan.
3. Asks Anthropic for a short reflection from the answer numbers only (never the name or email). If that fails, a plain built-in reflection is used instead.
4. Emails the report once, through Brevo.
5. Only if the visitor ticked "Freddie can contact me personally": adds them to your Brevo list with their result, profile, coaching history, lowest theme, consent date and stage, and emails you a lead alert. If they did not tick it, nothing is kept.

## One-time setup (about 45 minutes)
1. **Anthropic API key.** console.anthropic.com: add a small credit balance, set a monthly spend limit (for example $10), create a key.
2. **Brevo account** (brevo.com, free plan; check current limits).
   - Senders, Domains and Dedicated IPs > Domains > add leadwithfx.com and **authenticate it**: Brevo shows a few DNS records (SPF, DKIM, DMARC). Add them at GoDaddy (DNS > Add), the same place as the A records. Wait for Brevo to show the domain as verified.
   - Create a sender such as hello@leadwithfx.com. (Do not use a Gmail address: it will be rejected or land in spam.)
   - Contacts > Settings > Contact attributes: create text attributes `FIRSTNAME`, `BAND`, `PROFILE`, `COACHED_BEFORE`, `LOWEST_THEME`, `CONSENT_DATE`, `STAGE`.
   - Contacts > Lists: create a list called "Pipeline" and note its numeric ID.
   - SMTP and API > API keys: create a key.
3. **Cloudflare Worker.** cloudflare.com (free): Workers & Pages > Create > Worker, name it `clarity-report`, paste in `worker/index.js`, Deploy.
4. **Secrets and variables** (Worker > Settings > Variables and Secrets):
   - secrets: `ANTHROPIC_API_KEY`, `BREVO_API_KEY`
   - variables: `FROM_EMAIL` (the verified sender), `ALERT_EMAIL` (where lead alerts go), `BREVO_LIST_ID` (the Pipeline list ID)
   - optional: `MODEL`; `DRY_RUN=1` to build reports without sending anything while you test.
5. **Rate limit.** Add a rate-limiting rule on the Worker route (for example 10 requests per minute per IP).
6. **Switch it on.** Put the Worker URL in `quiz.html` as `REPORT_ENDPOINT`, commit, push. Send yourself a test report first.

## Checks
- `node worker/test.mjs` runs 23 local tests (validation, scoring, escaping, consent paths, failure handling). They use a mocked network, so they do not prove the live Brevo or Anthropic calls: do the test report in step 6.
- If you change the quiz questions or options, update `QUESTIONS` in `worker/index.js` to match, and the `THEMES` question numbers if the order changes.
- Follow-ups to pipeline contacts should be one to one, from you, with a line on how to stop hearing from you. Check final wording with your adviser.
