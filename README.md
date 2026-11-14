# Lead with FX

Static website for leadwithfx.com. No build step: open `index.html` in a browser to preview.

## Files
- `index.html` home page. `quiz.html` Clarity Check. `insights.html` article list (new posts start from `insights/TEMPLATE.html`). `privacy.html` privacy policy.
- `styles.css` all styling. Brand colours are CSS variables at the top.
- `nav.js` mobile menu.
- `worker/` Cloudflare Worker that sends the Clarity Report. See `worker/README.md`.
- `CNAME`, `.nojekyll`, `robots.txt`, `sitemap.xml` hosting and search files.

## Before going live with new features
- Clarity Report: set `REPORT_ENDPOINT` in `quiz.html` to the Worker address. While it is empty, visitors see the full result on screen and no report form. Once set, the screen shows a partly redacted report and visitors can share their answers; the full report goes to you for the intro call. Add `?test=1` to the quiz address to preview the form without sending anything.
- Testimonials: once you have real quotes, remove `hidden` from `<section class="proof">` in `index.html`.
- Insights: add the link back to the top nav in every page once the first post is published.

## Hosting (GitHub Pages)
Deploys from the `main` branch, root folder. Custom domain leadwithfx.com. Tick "Enforce HTTPS" in repo Settings > Pages.

DNS at the registrar:
- A `@` 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
- CNAME `www` leadwithfx.github.io

Remove any registrar parking page or forwarding. DNS can take minutes to a few hours.

## Copying and AI protection
- `robots.txt` blocks known AI training and scraping bots; `noai, noimageai` robots tags and a `tdm-reservation` notice (`.well-known/tdmrep.json`) are on every page. These are requests: well-behaved bots obey them, bad ones don't.
- `terms.html` states that the content can't be copied or used for AI training. Have an adviser read it, alongside the privacy page.
- Quiz and Worker protection (spend limit, Turnstile, rate limit): see `worker/README.md`.

## Writing an Insights post

1. Copy `content/insights/_example.md` to a new file, e.g. `content/insights/getting-unstuck.md`.
2. Fill in the front matter (`title`, `date` as YYYY-MM-DD, `summary`, optional `tags`) and write in Markdown. Remove `draft: true` to publish.
3. Run `node scripts/build-insights.mjs`, then commit the generated files. CI fails if the output is stale.

The build creates the post page, the list and search box on `insights.html`, `insights/search-index.json` and the sitemap entry. Search runs in the browser; nothing about a visitor's search leaves the page.

## Adding a testimonial

1. Get the client's written permission to use their words, and agree how to describe them (for example "Engineering manager, fintech"). Leave out names and employers unless they agree.
2. In `index.html`, replace the three placeholder cards in the `proof` section with real quotes, then remove the `hidden` attribute from that section.
3. CI fails if the section is visible while any `[PLACEHOLDER]` or "coming soon" text remains.
