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
   - Contacts > Settings > Contact attributes: create text attributes `FIRSTNAME`, `BAND`, `PROFILE`, `COACHED_BEFORE`, `HELPED_BEFORE`, `LOWEST_THEME`, `CONSENT_DATE`, `STAGE`.
   - Contacts > Lists: create a list called "Pipeline" and note its numeric ID.
   - SMTP and API > API keys: create a key.
3. **Cloudflare Worker.** cloudflare.com (free): Workers & Pages > Create > Worker, name it `clarity-report`, paste in `worker/index.js`, Deploy.
4. **Secrets and variables** (Worker > Settings > Variables and Secrets):
   - secrets: `ANTHROPIC_API_KEY`, `BREVO_API_KEY`
   - variables: `FROM_EMAIL` (the verified sender), `ALERT_EMAIL` (where lead alerts go), `BREVO_LIST_ID` (the Pipeline list ID)
   - optional: `MODEL`; `DRY_RUN=1` to build reports without sending anything while you test.
5. **Abuse protection.** Cloudflare's dashboard rate-limit rules need your domain on Cloudflare, and yours is at GoDaddy, so skip them. Your protections are the Anthropic monthly spend limit, Brevo's free cap of 300 emails a day, the Worker's check that requests come from leadwithfx.com, and a hidden bot trap in the form. If junk sign-ups appear, add Cloudflare Turnstile (a free CAPTCHA).
6. **Switch it on.** Put the Worker URL in `quiz.html` as `REPORT_ENDPOINT`, commit, push. Send yourself a test report first.

## Checks
- `node worker/test.mjs` runs 23 local tests (validation, scoring, escaping, consent paths, failure handling). They use a mocked network, so they do not prove the live Brevo or Anthropic calls: do the test report in step 6.
- If you change the quiz questions or options, update `QUESTIONS` in `worker/index.js` to match, and the `THEMES` question numbers if the order changes.
- Follow-ups to pipeline contacts should be one to one, from you, with a line on how to stop hearing from you. Check final wording with your adviser.

## Protecting the Worker from abuse
The Worker already checks the site address (origin), caps the request size at 4 KB, validates every answer, and has a hidden honeypot field. Three more layers switch on when you set them up (nothing breaks if you skip them):

1. **Anthropic spend limit** (do this first): console.anthropic.com > Limits > set a monthly cap, for example $10. This is your worst-case cost.
2. **Cloudflare Turnstile** (free human check):
   - Cloudflare dashboard > Turnstile > Add widget. Hostname `leadwithfx.com`, mode Managed (invisible when possible).
   - Copy the **site key** into `TURNSTILE_SITEKEY` near the top of the script in `quiz.html` (it is public).
   - Add the **secret key** to the Worker as a secret named `TURNSTILE_SECRET`.
   - Until both are set, the check is off.
3. **Per-visitor limit** (Workers rate limiting): in the Worker's wrangler config or dashboard, add a Rate Limiting binding named `LIMITER`, for example 3 requests per 60 seconds. If you deploy by pasting code in the dashboard, add the binding under Settings > Bindings. Visitors who go over get a "please wait a minute" message.

Optional later: move DNS from GoDaddy to Cloudflare (free). That lets Cloudflare's bot protection, AI-crawler blocking and rate limits sit in front of the whole site.
