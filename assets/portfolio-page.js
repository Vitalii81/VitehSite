// Web version of the engineering portfolio in the language chosen on the site (?lang=, saved choice, browser language).
// Content: site.portfolioPage in data/site.json (editable in the admin); the archive 2022-2025 comes from data/portfolio.json + data/portfolio-images.json.
import { LANGS, esc, sectionsFor, tr } from "./portfolio-render.js";

const get = async (p) => { const r = await fetch(p, { cache: "no-cache" }); if (!r.ok) throw new Error(p); return r.json(); };
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* blocked */ } } };
const PDF = { en: "Vitalii_Krutikov_Engineering_Portfolio_2026.pdf", uk: "Vitalii_Krutikov_Engineering_Portfolio_2026_uk.pdf", de: "Vitalii_Krutikov_Engineering_Portfolio_2026_de.pdf" };

function detect() {
  const fromUrl = new URLSearchParams(location.search).get("lang");
  if (LANGS.includes(fromUrl)) return fromUrl;
  const saved = store.get("viteh.lang");
  if (LANGS.includes(saved)) return saved;
  for (const c of navigator.languages || [navigator.language]) { const s = (c || "").slice(0, 2).toLowerCase(); if (LANGS.includes(s)) return s; }
  return "en";
}

let data = null, lang = detect();

function paint() {
  const { site, projects, manifest } = data, page = site.portfolioPage, ui = page.ui, t = (v) => tr(v, lang);
  document.documentElement.lang = lang;
  document.title = t(ui.title);
  document.querySelector('meta[name="description"]')?.setAttribute("content", t(ui.description));
  const bar = document.getElementById("ppBar");
  bar.innerHTML = `<a class="pp-back" href="../?lang=${lang}">${esc(t(ui.back))}</a><span class="pp-actions"><span class="pp-lang" role="group" aria-label="Language">${LANGS.map((l) => `<button type="button" data-lang="${l}" aria-pressed="${l === lang}">${l.toUpperCase()}</button>`).join("")}</span><a class="pp-btn" href="../assets/portfolio/${PDF[lang]}" type="application/pdf" download>${esc(t(ui.pdf))}</a><button class="pp-btn" type="button" id="ppPrint">${esc(t(ui.print))}</button></span>`;
  bar.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => { lang = b.dataset.lang; store.set("viteh.lang", lang); const u = new URL(location.href); u.searchParams.set("lang", lang); history.replaceState(null, "", u); paint(); }));
  document.getElementById("ppPrint")?.addEventListener("click", () => window.print());
  const c = page.cover;
  const sections = sectionsFor(page, site, projects, manifest, lang);
  document.getElementById("ppMain").innerHTML = `<header class="pp-cover"><p class="kicker">${esc(t(ui.year))}</p><h1>${esc(t(c.name))}</h1><p>${esc(t(c.roles))}</p><p>${esc(t(c.text))}</p></header>`
    + sections.map((s) => `<section class="pp-sec" id="${esc(s.id)}"><p class="kicker">${esc(s.kicker)}</p><h2>${esc(s.title)}</h2>${s.lead ? `<p class="lead">${esc(s.lead)}</p>` : ""}${s.body}</section>`).join("");
}

(async () => {
  try {
    const [site, { projects }, manifest] = await Promise.all([get("/data/site.json"), get("/data/portfolio.json"), get("/data/portfolio-images.json")]);
    data = { site, projects, manifest };
    paint();
  } catch (e) { console.error(e); document.getElementById("ppMain").textContent = "The portfolio could not be loaded. / Не вдалося завантажити портфоліо. / Das Portfolio konnte nicht geladen werden."; }
})();
