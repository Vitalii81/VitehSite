// Pure HTML renderer of the engineering portfolio, shared by the web page (assets/portfolio-page.js) and the PDF build (tools/make-portfolio.mjs).
// Content: site.portfolioPage in data/site.json (every text is {uk, en, de}; editable in the admin). No DOM access here, everything is escaped.
import { projectSlots } from "./portfolio.js";

export const LANGS = ["uk", "en", "de"];
const IMG = "/assets/portfolio/img/";
export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** i18n value in the chosen language; an empty translation falls back to English so a half-translated section never shows holes. */
export const tr = (v, lang) => (v && typeof v === "object" ? (v[lang] || v.en || Object.values(v).find(Boolean) || "") : v ?? "");
const IMG_RE = /^[a-z0-9-]+$/;

/** `p` (only in the on-page editor, never on the public page) is the site.json path of this block; every text then carries data-p="<path>" so the editor can bind it. */
function block(b, lang, ui, p) {
  const t = (v) => esc(tr(v, lang));
  const at = (sub) => (p ? ` data-p="${p}.${sub}"` : "");
  const sp = (sub, v) => (p ? `<span${at(sub)}>${t(v)}</span>` : t(v));
  switch (b.t) {
    case "p": return `<p${at("text")}>${t(b.text)}</p>`;
    case "h3": return `<h3${at("text")}>${t(b.text)}</h3>`;
    case "h4": return `<h4${at("text")}>${t(b.text)}</h4>`;
    case "note": return `<p class="note"${at("text")}>${t(b.text)}</p>`;
    case "focus": return `<p class="focus"><b${at("label")}>${t(b.label)}</b> ${sp("text", b.text)}</p>`;
    case "list": return `<ul class="roles">${(b.items || []).map((i, k) => `<li${at(`items.${k}`)}>${t(i)}</li>`).join("")}</ul>`;
    case "caps": return `<dl class="caps">${(b.items || []).map((i, k) => `<dt${at(`items.${k}.k`)}>${t(i.k)}</dt><dd${at(`items.${k}.v`)}>${t(i.v)}</dd>`).join("")}</dl>`;
    case "fig": return IMG_RE.test(b.img || "") ? `<figure class="${b.wide ? "wide" : ""}${b.small ? " small" : ""}"><img src="${IMG}${b.img}.jpg" alt="${t(b.caption)}" loading="lazy"><figcaption${at("caption")}>${t(b.caption)}</figcaption></figure>` : "";
    case "card": return `<div class="card${b.hi ? " hi" : ""}"><h4${at("title")}>${t(b.title)}</h4>${(b.text || []).map((x, i) => `<p${i && b.hi ? ' class="muted"' : ""}${at(`text.${i}`)}>${t(x)}</p>`).join("")}${b.skills ? `<p class="skills">${esc(tr(ui?.skills, lang))} · ${sp("skills", b.skills)}</p>` : ""}</div>`;
    case "two": return `<div class="two"><div>${(b.left || []).map((x, k) => block(x, lang, ui, p && `${p}.left.${k}`)).join("")}</div><div>${(b.right || []).map((x, k) => block(x, lang, ui, p && `${p}.right.${k}`)).join("")}</div></div>`;
    case "grid2": return `<div class="grid2">${(b.items || []).map((cell, i) => `<div>${cell.map((x, j) => block(x, lang, ui, p && `${p}.items.${i}.${j}`)).join("")}</div>`).join("")}</div>`;
    case "webrow": return `<div class="webrow">${(b.items || []).map((x, i) => block(x, lang, ui, p && `${p}.items.${i}`)).join("")}</div>`;
    default: return "";
  }
}
export const blocksHtml = (blocks, lang, ui, base = null) => (blocks || []).map((b, j) => block(b, lang, ui, base && `${base}.${j}`)).join("");

export function servicesHtml(section, site, lang) {
  const cards = site.services.items.map((s) => `<div class="card"><h4>${esc(tr(s.title, lang))}</h4><p>${esc(tr(s.text, lang))}</p><p class="skills">${esc(s.points.map((p) => tr(p, lang)).join(" · "))}</p></div>`).join("");
  return `<div class="svc">${cards}</div><p class="note">${esc(tr(section.note, lang))}</p>`;
}

/** Cards of the project archive. `slotUrlOf(entry)` may return a URL (final picture, or a marked placeholder in draft PDFs) or null; `mark` adds the PLACEHOLDER label. */
export function archiveCards(projects, site, manifest, lang, { preview = false, pending = null, ve = false } = {}) {
  const cats = Object.fromEntries(site.work.archive.categories.map((c) => [c.id, tr(c.label, lang)]));
  return projects.map((p) => {
    const shots = projectSlots(p, manifest, { preview }).slice(0, 3);
    if (pending) for (const s of (p.slots || [])) { const m = manifest.find((x) => x.slug === p.slug && x.slot === s); if (m && m.status !== "final") pending.push(`${m.slug}/${m.slot}`); }
    const figs = shots.map(({ entry, url, placeholder }) => `<figure class="${placeholder ? "ph" : ""}" style="flex:${(entry.ratio.split(":")[0] / entry.ratio.split(":")[1]).toFixed(2)} 1 0"><img src="/${esc(url)}" alt="${esc(tr(entry.alt, lang))}" loading="lazy">${placeholder ? "<figcaption>PLACEHOLDER</figcaption>" : ""}</figure>`).join("");
    const cat = esc(cats[p.category] || p.category);
    if (ve) {                                                       // the on-page editor of the portfolio: every field is a marked element
      const tags = (p.tags || []).map((x, i) => `<span data-f="tag" data-i="${i}">${esc(x)}</span>`).join(" · ");
      return `<div class="card arch" data-slug="${esc(p.slug)}"><p class="skills">${cat}${p.years ? ` · <span data-f="years">${esc(p.years)}</span>` : ""}</p><h4 data-f="title">${esc(tr(p.title, lang))}</h4>${figs ? `<div class="shots">${figs}</div>` : ""}<p data-f="summary">${esc(tr(p.summary, lang))}</p><p class="skills">${tags}</p></div>`;
    }
    return `<div class="card arch"><p class="skills">${esc([cats[p.category] || p.category, p.years].filter(Boolean).join(" · "))}</p><h4>${esc(tr(p.title, lang))}</h4>${figs ? `<div class="shots">${figs}</div>` : ""}<p>${esc(tr(p.summary, lang))}</p><p class="skills">${esc((p.tags || []).join(" · "))}</p></div>`;
  });
}

/** Sections in order as [{id, kicker, title, lead, body}]; the archive is split into groups of `perPage` cards (the PDF needs that, the web page uses one group). */
export function sectionsFor(page, site, projects, manifest, lang, { perPage = 0, preview = false, pending = null, disabled = [], ve = false } = {}) {
  const out = [];
  for (const [si, s] of page.sections.entries()) {
    if (disabled.includes(s.id)) continue;
    const head = { id: s.id, kicker: tr(s.kicker, lang), title: tr(s.title, lang), lead: tr(s.lead, lang), ...(ve ? { path: `portfolioPage.sections.${si}` } : {}) };
    if (s.type === "blocks") out.push({ ...head, body: blocksHtml(s.blocks, lang, page.ui, ve ? `portfolioPage.sections.${si}.blocks` : null) });
    else if (s.type === "services") out.push({ ...head, body: servicesHtml(s, site, lang) });
    else if (s.type === "archive") {
      const cards = archiveCards(projects, site, manifest, lang, { preview, pending, ve });
      const lead = head.lead || tr(site.work.archive.lead, lang);
      const size = perPage || cards.length || 1;
      for (let i = 0; i < cards.length; i += size) {
        out.push({ ...head, id: i ? `${s.id}-${i / size + 1}` : s.id, title: i ? `${head.title}, ${tr(s.cont, lang)}` : head.title, lead: i ? tr(s.more, lang) : lead,
          body: `<div class="svc arch-grid">${cards.slice(i, i + size).join("")}</div>${i + size >= cards.length ? `<p class="note"${ve ? ` data-p="portfolioPage.sections.${si}.note"` : ""}>${esc(tr(s.note, lang))}</p>` : ""}` });
      }
    }
  }
  return out;
}
