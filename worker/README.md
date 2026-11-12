# Clarity Check AI summary: setup

The site is static, so the AI call goes through a tiny Cloudflare Worker that keeps your API key secret.
The Worker accepts only answer numbers (never free text) and only from leadwithfx.com.

## One-time setup (about 20 minutes)
1. **Anthropic API key.** Create an account at console.anthropic.com, add a small credit balance, and set a **monthly spend limit** (for example $10). Create an API key.
2. **Cloudflare Worker.** Create a free account at cloudflare.com. Workers & Pages > Create > Worker. Name it e.g. `clarity-summary`. Edit code, paste in `worker/index.js`, Deploy.
3. **Secret.** Worker > Settings > Variables and Secrets > add secret `ANTHROPIC_API_KEY` = your key. (Optional variable `MODEL` to change the model.)
4. **Rate limit.** In Cloudflare, add a rate-limiting rule for the Worker route (for example 10 requests per minute per IP) so nobody can run up your costs.
5. **Switch it on.** Copy the Worker URL (https://clarity-summary.<you>.workers.dev) and put it in `quiz.html` as `AI_ENDPOINT`. Commit and push.

## Checks
- `node worker/test.mjs` runs the Worker's validation tests locally.
- The summary box only appears if the Worker answers; otherwise the quiz works exactly as before.
- If you change the quiz questions or options, update `QUESTIONS` in `worker/index.js` to match.
