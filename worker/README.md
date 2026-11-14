# Clarity Report: setup

The site is static, so the report is built and emailed to Freddie (not the visitor) by a small Cloudflare Worker, in two steps (`worker/index.js`).
It accepts only answer numbers, a first name, an email and two consent flags, and only from leadwithfx.com.
Until you set `REPORT_ENDPOINT` in `quiz.html`, the form runs in **test mode** and sends nothing.

## What it does
1. Validates the request (consent to the report is required; a hidden honeypot field blocks simple bots).
2. Scores the answers into the overall result and five themes (Clarity, Visibility, Accountability, Momentum, Influence) and picks the lowest theme for the 90-day plan.
3. Builds the reflection from fixed wording chosen by the answers (same answers, same words). No AI service is used.
4. Step 1 (`stage: result`): emails the report to the visitor (only a real address receives it) and a copy to `ALERT_EMAIL`, and returns a one-hour token. Step 2 (`stage: request`, only if the visitor ticks the box): checks the token, emails an alert, and saves the contact to the Brevo list.
5. Only if the visitor ticked "Freddie can contact me personally": adds them to your Brevo list with their result, profile, coaching history, lowest theme, consent date and stage, and emails you a lead alert. If they did not tick it, nothing is kept.

## One-time setup (about 45 minutes)
2. **Brevo account** (brevo.com, free plan; check current limits).
   - Senders, Domains and Dedicated IPs > Domains > add leadwithfx.com and **authenticate it**: Brevo shows a few DNS records (SPF, DKIM, DMARC). Add them at GoDaddy (DNS > Add), the same place as the A records. Wait for Brevo to show the domain as verified.
   - Create a sender such as hello@leadwithfx.com. (Do not use a Gmail address: it will be rejected or land in spam.)
   - Contacts > Settings > Contact attributes: create text attributes `FIRSTNAME`, `BAND`, `PROFILE`, `COACHED_BEFORE`, `HELPED_BEFORE`, `LOWEST_THEME`, `CONSENT_DATE`, `STAGE`.
   - Contacts > Lists: create a list called "Pipeline" and note its numeric ID.
   - SMTP and API > API keys: create a key.
3. **Cloudflare Worker.** cloudflare.com (free): Workers & Pages > Create > Worker, name it `clarity-report`, paste in `worker/index.js`, Deploy.
4. **Secrets and variables** (Worker > Settings > Variables and Secrets):
   - secrets: `BREVO_API_KEY`, `TURNSTILE_SECRET`
   - variables: `FROM_EMAIL` (the verified sender), `ALERT_EMAIL` (where lead alerts go), `BREVO_LIST_ID` (the Pipeline list ID)
   - optional: `DRY_RUN=1` to build reports without sending anything while you test.
5. **Abuse protection.** Cloudflare's dashboard rate-limit rules need your domain on Cloudflare, and yours is at GoDaddy, so skip them. Your protections are Brevo's free cap of 300 emails a day, the Worker's check that requests come from leadwithfx.com, and a hidden bot trap in the form. If junk sign-ups appear, add Cloudflare Turnstile (a free CAPTCHA).
6. **Switch it on.** Put the Worker URL in `quiz.html` as `REPORT_ENDPOINT`, commit, push. Send yourself a test report first.

## Checks
- `node worker/test.mjs` runs 42 local checks (validation, scoring, escaping, tokens, consent paths, failure handling). They use a mocked network, so they do not prove the live Brevo calls: do the real test after going live.
- If you change the quiz questions or options, update `QUESTIONS` in `worker/index.js` to match, and the `THEMES` question numbers if the order changes.
- Follow-ups to pipeline contacts should be one to one, from you, with a line on how to stop hearing from you. Check final wording with your adviser.

## Protecting the Worker from abuse
The Worker already checks the site address (origin), caps the request size at 4 KB, validates every answer, and has a hidden honeypot field. Three more layers switch on when you set them up (nothing breaks if you skip them):

2. **Cloudflare Turnstile** (free human check):
   - Cloudflare dashboard > Turnstile > Add widget. Hostname `leadwithfx.com`, mode Managed (invisible when possible).
   - Copy the **site key** into `TURNSTILE_SITEKEY` near the top of the script in `quiz.html` (it is public).
   - Add the **secret key** to the Worker as a secret named `TURNSTILE_SECRET`.
   - Until both are set, the check is off.
3. **Per-visitor limit** (Workers rate limiting): in the Worker's wrangler config or dashboard, add a Rate Limiting binding named `LIMITER`, for example 3 requests per 60 seconds. If you deploy by pasting code in the dashboard, add the binding under Settings > Bindings. Visitors who go over get a "please wait a minute" message.

Optional later: move DNS from GoDaddy to Cloudflare (free). That lets Cloudflare's bot protection, AI-crawler blocking and rate limits sit in front of the whole site.


## Deploying (GitHub only, no pasting)

The Worker deploys from this repo through Cloudflare Workers Builds. One-time setup in Cloudflare: Workers > clarity-report > Settings > Builds > Connect to GitHub, repo `leadwithfx/leadwithfx`, root directory `worker`, build command `node test.mjs`, deploy command `npx wrangler deploy`. After that, any push to `main` that changes `worker/` runs the tests and deploys only if they pass.

- Plain settings (`FROM_EMAIL`, `ALERT_EMAIL`, `BREVO_LIST_ID`, `DRY_RUN`) and the `LIMITER` rate limit are set in `wrangler.jsonc`. Change them in GitHub, not in the dashboard.
- Secrets (`BREVO_API_KEY`, `TURNSTILE_SECRET`) stay in Cloudflare only.
- To go live, delete the `DRY_RUN` line in `wrangler.jsonc` and push.

## Reliable delivery (retry outbox)

If Brevo is down or slow, a failed send is not lost. The Worker saves just that one call in a small D1 table (`outbox`, database `clarity-outbox`), and a cron trigger retries it every 5 minutes with exponential backoff (1 min, 2, 4, ... capped at 1 hour). After 8 attempts it is marked `dead` and kept for 7 days so it can be replayed by hand, then purged. A permanent error (a 4xx other than 429) is never queued.

- Rows exist only while a send is failing and are deleted on success, so nothing is stored in normal operation.
- Each email is queued on its own, so a retry never sends the other email twice.
- Table definition: `schema.sql` (applied once). Binding and cron: `wrangler.jsonc`.
- Watch it in Workers Logs: `send_failed`, `outbox_queued`, `outbox_sent`, `outbox_dead`, `outbox_run`.
- Without the `DB` binding the Worker behaves as before (a failed send returns an error to the visitor).

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: Worker tests (including the outbox against a real SQL engine), site checks (`scripts/check-site.mjs`: links, metadata, alt text), accessibility (`scripts/a11y.mjs`, axe) and a Lighthouse budget (`lighthouserc.json`). To make them gates, turn on branch protection for `main` and require these four checks.


## "Drop me a message" (contact form)

The contact FAQ on the homepage has a form (`contact.js`). Step 1 (`msg_code`) checks the human check, then emails a 6-digit code to the visitor. Step 2 (`msg_send`) checks the code and only then emails the message to `ALERT_EMAIL`, with the visitor as reply-to, and sends the visitor a copy. Nothing is stored: the code is bound to the name, email and message by a signed token (HMAC with `TURNSTILE_SECRET`) that the page holds for 10 minutes. It needs `BREVO_API_KEY`, `FROM_EMAIL` and `TURNSTILE_SECRET`; if any is missing the Worker answers 503 and the page tells the visitor to email instead. The `LIMITER` rate limit applies to both steps. Messages are limited to 2,000 characters. To switch the form off, set `LIVE` to `false` at the top of `contact.js`.

### Daily limits, email budget and alerts

These use the existing D1 database (the Worker creates its `daily` table itself; see `schema.sql`). They do nothing if D1 is not connected.

- **Per person:** at most 2 completed messages and 5 code requests per email address per day (UTC). The address is kept only as a keyed hash, and counters are deleted after 3 days.
- **Email budget:** every email the Worker sends is counted. At 240 a day (Brevo's free plan allows 300) the contact form pauses with a "please email instead" message, and you get one alert. The Clarity Check is never paused. Change `DAILY_EMAIL_BUDGET` in `index.js` if you change Brevo plan.
- **Alerts** (run by the 5-minute cron, each sent to `ALERT_EMAIL`): an email the Worker gave up on (once a day while any are stuck); `leadwithfx.com` failing three checks in a row, about 15 minutes (once per outage); and the budget alert above.
