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
  const ve = document.documentElement.hasAttribute("data-ve");          // set only by the admin's on-page editor: marks every text with its data path
  const dp = (path) => (ve ? ` data-p="portfolioPage.${path}"` : "");
  document.documentElement.lang = lang;
  document.title = t(ui.title);
  document.querySelector('meta[name="description"]')?.setAttribute("content", t(ui.description));
  const bar = document.getElementById("ppBar");
  bar.innerHTML = `<a class="pp-back" href="../?lang=${lang}"${dp("ui.back")}>${esc(t(ui.back))}</a><span class="pp-actions"><span class="pp-lang" role="group" aria-label="Language">${LANGS.map((l) => `<button type="button" data-lang="${l}" aria-pressed="${l === lang}">${l.toUpperCase()}</button>`).join("")}</span><a class="pp-btn" href="../assets/portfolio/${PDF[lang]}" type="application/pdf" download${dp("ui.pdf")}>${esc(t(ui.pdf))}</a><button class="pp-btn" type="button" id="ppPrint"${dp("ui.print")}>${esc(t(ui.print))}</button></span>`;
  bar.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => { lang = b.dataset.lang; store.set("viteh.lang", lang); const u = new URL(location.href); u.searchParams.set("lang", lang); history.replaceState(null, "", u); paint(); }));
  document.getElementById("ppPrint")?.addEventListener("click", () => window.print());
  const c = page.cover;
  const sections = sectionsFor(page, site, projects, manifest, lang, { ve });
  document.getElementById("ppMain").innerHTML = `<header class="pp-cover"><p class="kicker"${dp("ui.year")}>${esc(t(ui.year))}</p><h1${dp("cover.name")}>${esc(t(c.name))}</h1><p${dp("cover.roles")}>${esc(t(c.roles))}</p><p${dp("cover.text")}>${esc(t(c.text))}</p></header>`
    + sections.map((s) => `<section class="pp-sec" id="${esc(s.id)}"${ve ? ` data-sec="${esc(s.id)}"` : ""}><p class="kicker"${s.path ? ` data-p="${s.path}.kicker"` : ""}>${esc(s.kicker)}</p><h2${s.path ? ` data-p="${s.path}.title"` : ""}>${esc(s.title)}</h2>${s.lead ? `<p class="lead"${s.leadPath ? ` data-p="${s.leadPath}"` : ""}>${esc(s.lead)}</p>` : ""}${s.body}</section>`).join("");
}

(async () => {
  try {
    const [site, { projects }, manifest] = await Promise.all([get("/data/site.json"), get("/data/portfolio.json"), get("/data/portfolio-images.json")]);
    data = { site, projects, manifest };
    paint();
  } catch (e) { console.error(e); document.getElementById("ppMain").textContent = "The portfolio could not be loaded. / Не вдалося завантажити портфоліо. / Das Portfolio konnte nicht geladen werden."; }
})();
