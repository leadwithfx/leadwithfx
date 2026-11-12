# Lead with FX

Static one-page website. No build step. Open `index.html` in a browser to preview.

## Files
- `index.html` the page
- `styles.css` all styling (colours are CSS variables at the top)
- `headshot.jpg` add your photo here (320 x 420 or similar portrait)
- `logo.png` optional, add your logo here

## Before you publish
1. Search `index.html` for `BOOKING_LINK` and replace it with your calendar link.
2. Replace the `[YOUR LOGO]` placeholders with your logo image (see the comment in the header).
3. Add `headshot.jpg` next to `index.html`.
4. Replace `[SUBURB / CBD / VENUE OPTIONS]` in the "In person" card.
5. Replace the three testimonial placeholders with real client quotes, or delete that section.

## Hosting
Works on any static host (GitHub Pages, Netlify, Cloudflare Pages, GoDaddy hosting).

## Publishing on leadwithfx.com (GitHub Pages)
1. Push these files to a GitHub repo (index.html at the root).
2. Repo Settings > Pages > deploy from branch (main, / root). Custom domain: leadwithfx.com. Tick "Enforce HTTPS" when available.
3. At your domain registrar, DNS:
   - A  @  185.199.108.153
   - A  @  185.199.109.153
   - A  @  185.199.110.153
   - A  @  185.199.111.153
   - CNAME  www  <your-github-username>.github.io
4. Remove any registrar "parking page" or forwarding on the domain. DNS can take minutes to a few hours.
