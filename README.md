# ViTeh Site

Lightweight multilingual static website for `viteh.org`: software and electronic-device
development (light to medium complexity) and AI-agent integration.

No build step, no external requests (no CDN, fonts, analytics or cookies) — GDPR-friendly by design.

## Contact form

The form posts JSON to `/api/contact` on the same origin. The Worker in `worker/` checks the fields (length limits, e-mail syntax,
consent, a hidden honeypot field, a minimum fill time, the `Origin` header) and sends a plain-text mail through Cloudflare Email Routing
(`send_email` binding `MAIL`, which can only send to the verified destination address) with the visitor's address as `Reply-To`.
Up to 3 documents (5 MB each, 10 MB in total; PDF, images, Word, Excel, text) can be attached: the form then posts multipart/form-data, the Worker checks the extension AND the first bytes of each file, sends them as attachments of the letter and puts them into the queue on the Radxa (documents first, the description last).
No password or API key is involved. Only `/api/*` runs the Worker (`assets.run_worker_first`); everything else is static.
Tests: `node --test worker/contact.test.mjs`. Deploy: `viteh-site/deploy-worker.sh` of the Server repository.

This site is independent from NanoKVM and from the OTA file server.

- `viteh.org` is the public showcase.
- `fw.viteh.org` is the technical firmware/file delivery endpoint for devices.

## Structure

| Path | Purpose |
| --- | --- |
| `index.html` | One-page site: hero, services, AI agents, process, projects, stack, engagement, FAQ, contact |
| `impressum.html`, `datenschutz.html` | Legal pages (templates — fill in the `[...]` placeholders) |
| `data/site.json` | All interface text (`uk`, `en`, `de`), services, FAQ, contact details |
| `data/products.json` | Project cards (demo content) |
| `assets/styles.css` | Design tokens, light/dark themes, responsive layout |
| `assets/app.js` | Rendering, language switch, theme toggle, contact form submit, SEO meta |
| `worker/index.mjs`, `worker/contact.mjs` | Cloudflare Worker code for `POST /api/contact` (validation + mail); `worker/contact.test.mjs` = tests |
| `assets/*.svg`, `og-image.png` | Illustrations, icons, favicon, social preview |

## Design

Calm teal/indigo palette with automatic light and dark theme (follows the system, manual toggle is
remembered). Language is chosen from `?lang=`, then the saved choice, then the browser language, then English.

## Languages

The initial languages are:

- `uk` Ukrainian
- `en` English
- `de` German

Interface text lives in `data/site.json` (each text is an object `{ "uk": ..., "en": ..., "de": ... }`).
Product text lives in `data/products.json`.

To add another language:

1. Add a language entry to `data/site.json`:
   ```json
   { "code": "pl", "label": "Polski" }
   ```
2. Add `pl` text to every translated object in `data/site.json` and add a `short` code (e.g. `PL`).
3. Add `pl` text to product fields in `data/products.json`.

## Products

Add product cards in `data/products.json`.
Each card supports translated `title`, `summary`, `status`, plus `category`, `image`, and `tags`.

## Local Preview

Because the site loads JSON with `fetch`, run it through a local web server:

```sh
python3 -m http.server 8088
```

Open `http://localhost:8088/`.

## Deploy to Cloudflare Pages

`deploy.sh` publishes only the public site (`index.html`, `assets/`, and
`data/`) to an existing Cloudflare Pages project. It deliberately does not
publish this README, the deployment script, or any local notes.

One-time Cloudflare setup:

1. In **Workers & Pages**, find the old Pages project and note its project
   name. If it no longer exists, create a new Direct Upload Pages project.
2. In the Pages project, attach `viteh.org` as its custom domain. The hostname
   must no longer be routed to the Radxa Tunnel, otherwise the Tunnel wins and
   this Pages deployment will not be visible at `viteh.org`.

Then run the script. On its first interactive run it asks for the Pages project
name, then prints a Cloudflare OAuth device-login URL and code. Open it in any
browser, log in, and approve access. Wrangler saves the OAuth credentials in
the operating-system keychain; the only value stored by this project is the
Pages project name in `~/.config/viteh-site/cloudflare-pages.env`. Do not copy
that file into Git:

```sh
cd /home/unixevo/Documents/Server/viteh-site
./deploy.sh
```

Use a preview deployment before production when changing photos or copy:

```sh
./deploy.sh --preview image-refresh
```

Cloudflare prints the resulting `*.pages.dev` URL. After reviewing it, run
`./deploy.sh` without `--preview` to publish production.

The script downloads and runs Wrangler 4 through `npx`, so it needs Node.js,
npm, and an Internet connection but does not require a global installation. On
Linux, secure OAuth storage needs `secret-tool` from the `libsecret-tools`
package; Wrangler will state this if it is missing.

## Before going live

- Replace the demo email/phone in `data/site.json` and fill in the `[...]` placeholders in `legal` (Impressum / Datenschutz).
- The contact form is a demo and sends nothing. Connect it to email, Telegram or a small backend when ready.
- Example projects in `data/products.json` are demo content; replace them with real case studies.
- Content is rendered by JavaScript. For stronger SEO, consider pre-rendering per language at build time.
