# Lead with FX

Static website for leadwithfx.com. No build step: open `index.html` in a browser to preview.

## Files
- `index.html` home page. `quiz.html` Clarity Check. `insights.html` article list (new posts start from `insights/TEMPLATE.html`). `privacy.html` privacy policy.
- `styles.css` all styling. Brand colours are CSS variables at the top.
- `nav.js` mobile menu.
- `worker/` Cloudflare Worker that sends the Clarity Report. See `worker/README.md`.
- `CNAME`, `.nojekyll`, `robots.txt`, `sitemap.xml` hosting and search files.

## Before going live with new features
- Clarity Report: set `REPORT_ENDPOINT` in `quiz.html` to the Worker address. While it is empty, visitors see the full result on screen and no report form. Add `?test=1` to the quiz address to preview the form without sending anything.
- Testimonials: once you have real quotes, remove `hidden` from `<section class="proof">` in `index.html`.
- Insights: add the link back to the top nav in every page once the first post is published.

## Hosting (GitHub Pages)
Deploys from the `main` branch, root folder. Custom domain leadwithfx.com. Tick "Enforce HTTPS" in repo Settings > Pages.

DNS at the registrar:
- A `@` 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
- CNAME `www` leadwithfx.github.io

Remove any registrar parking page or forwarding. DNS can take minutes to a few hours.
