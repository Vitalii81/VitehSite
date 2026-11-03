# ViTeh Site

Lightweight multilingual static showcase for `viteh.org`.

This site is independent from NanoKVM and from the OTA file server.
Keep the responsibilities separate:

- `viteh.org` is the public showcase for products, offers, contacts, and future marketing pages.
- `fw.viteh.org` is the technical firmware/file delivery endpoint that devices can use to pull update files.

## Languages

The initial languages are:

- `uk` Ukrainian
- `en` English
- `de` German

Interface text lives in `data/site.json` under `i18n`.
Product text lives in `data/products.json`.

To add another language:

1. Add a language entry to `data/site.json`:
   ```json
   { "code": "pl", "label": "Polski" }
   ```
2. Add `pl` text to every translated object in `data/site.json`.
3. Add `pl` text to product fields in `data/products.json`.

## Products

Add product cards in `data/products.json`.
Each card supports translated `title`, `summary`, `status`, and `price`.

## Local Preview

Because the site loads JSON with `fetch`, run it through a local web server:

```powershell
cd viteh-site
python -m http.server 8088
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
