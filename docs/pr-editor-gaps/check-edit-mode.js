const { chromium } = require("playwright");
const fs = require("fs");
const OUT = "/home/user/VitehSite/docs/pr-editor-gaps";
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const report = {};
  for (const [vw, vh] of [[1280, 900], [390, 844]]) for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, colorScheme: theme });
    await ctx.addInitScript((t) => { try { localStorage.setItem("viteh.theme", t); } catch (e) {} }, theme);
    const login = await ctx.request.post("http://127.0.0.1:8082/cgi-bin/vadmin-api?action=login", { headers: { Origin: "http://127.0.0.1:8082", "X-Vadmin": "1", "Content-Type": "application/json" }, data: { passphrase: "dev-only-passphrase-change-me" } });
    if (!login.ok()) throw new Error("login " + login.status() + await login.text());
    for (const page of ["home", "portfolio", "impressum", "datenschutz"]) {
      const p = await ctx.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(String(e)));
      await p.goto(`http://127.0.0.1:8082/cgi-bin/vadmin-api?action=edit-page&page=${page}&lang=uk`, { waitUntil: "networkidle" });
      await p.waitForTimeout(700);
      const bad = await p.evaluate(() => {
        const out = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n; (n = w.nextNode());) {
          const t = n.nodeValue.trim(); if (!t) continue;
          const el = n.parentElement;
          if (el.closest(".ve-editable, .ve-ui, script, style, noscript, svg, dialog, .skip-link, option")) continue;
          if (el.closest("#langSwitch, .pp-lang, .brand, #year, .footer-meta")) continue;          // EXEMPT: language names, wordmark, (c) year
          if (el.closest("#archiveGrid .archive-card")) continue;                                     // EXEMPT on home: the card's own content is the portfolio's (edited there)
          if (el.closest(".filters, .filter-bar, #productFilters, .g3d-badge, .g3d-cap")) continue;     // EXEMPT: filter buttons and 3D badge are in "Other texts"
          if (el.classList.contains("num") || el.closest("label[for=f-website], .hp, [aria-hidden=true]")) continue;                                                // EXEMPT: step numbers
          const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
          if (!r.width || !r.height || cs.visibility === "hidden" || cs.display === "none") continue;
          out.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${el.className} :: ${t.slice(0, 50)}`);
        }
        return out;
      });
      const key = `${page}-${vw}-${theme}`;
      report[key] = { bad: [...new Set(bad)], errors, editable: await p.locator(".ve-editable").count() };
      await p.screenshot({ path: `${OUT}/${page}-${vw}-${theme}.png`, fullPage: false });
      await p.close();
    }
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
})();
