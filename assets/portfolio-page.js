// Web version of the engineering portfolio. Content: data/portfolio-page.json (shared with the PDF build, tools/make-portfolio.mjs); services come from
// data/site.json and the 2022-2025 archive from data/portfolio.json + data/portfolio-images.json. Pictures: only "final" slots; placeholders are never shown.
import { projectSlots } from "./portfolio.js";

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, v === true ? "" : v);
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const get = async (p) => { const r = await fetch(p, { cache: "no-cache" }); if (!r.ok) throw new Error(p); return r.json(); };
const en = (v) => (v && typeof v === "object" ? v.en ?? Object.values(v)[0] ?? "" : v ?? "");

/** Static blocks come from the repository's own JSON (not from visitors), so they may carry the simple markup of the PDF. */
const section = (p, body) => el("section", { class: "pp-sec" }, el("p", { class: "kicker" }, p.kicker), el("h2", {}, p.title), p.lead ? el("p", { class: "lead" }, p.lead) : null, body);

function servicesBody(p, site) {
  const wrap = el("div", { class: "svc" });
  for (const s of site.services.items) wrap.append(el("div", { class: "card" }, el("h4", {}, en(s.title)), el("p", {}, en(s.text)), el("p", { class: "skills" }, s.points.map(en).join(" · "))));
  return el("div", {}, wrap, el("p", { class: "note" }, p.note));
}

function archiveBody(p, site, projects, manifest) {
  const cats = Object.fromEntries(site.work.archive.categories.map((c) => [c.id, en(c.label)]));
  const wrap = el("div", { class: "svc arch-grid" });
  for (const pr of projects) {
    const shots = projectSlots(pr, manifest).slice(0, 3);
    wrap.append(el("div", { class: "card arch" }, el("p", { class: "skills" }, [cats[pr.category] || pr.category, pr.years].filter(Boolean).join(" · ")), el("h4", {}, en(pr.title)),
      shots.length ? el("div", { class: "shots" }, shots.map(({ entry, url }) => el("figure", { style: `flex:${(entry.ratio.split(":")[0] / entry.ratio.split(":")[1]).toFixed(2)} 1 0` }, el("img", { src: `/${url}`, alt: en(entry.alt), loading: "lazy" })))) : null,
      el("p", {}, en(pr.summary)), el("p", { class: "skills" }, pr.tags.join(" · "))));
  }
  return el("div", {}, wrap, el("p", { class: "note" }, p.note));
}

async function main() {
  const host = document.getElementById("ppMain");
  const [page, site, { projects }, manifest] = await Promise.all([get("/data/portfolio-page.json"), get("/data/site.json"), get("/data/portfolio.json"), get("/data/portfolio-images.json")]);
  host.replaceChildren(el("header", { class: "pp-cover" }, el("p", { class: "kicker" }, "ENGINEERING PORTFOLIO / 2026"), el("h1", {}, "Vitalii Krutikov"),
    el("p", {}, "Embedded Systems Engineer · Hardware & PCB Designer · Software Developer"), el("p", {}, "From circuit design and firmware to production-oriented prototypes, desktop tools, websites, Android apps and connected systems.")));
  for (const p of page.pages) {
    if (p.type === "services") host.append(section(p, servicesBody(p, site)));
    else if (p.type === "archive") host.append(section({ ...p, lead: en(site.work.archive.lead) }, archiveBody(p, site, projects, manifest)));
    else { const body = el("div", {}); body.innerHTML = p.html; host.append(section(p, body)); }
  }
  document.getElementById("ppPrint")?.addEventListener("click", () => window.print());
}
main().catch((e) => { console.error(e); document.getElementById("ppMain")?.append(el("p", {}, "The portfolio could not be loaded. Please use the PDF version.")); });
