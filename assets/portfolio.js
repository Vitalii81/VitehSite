// Project archive 2022-2025 inside the "Projects" section. Data: data/portfolio.json (projects) and data/portfolio-images.json (image slots).
// A slot is shown only when its manifest status is "final". A "placeholder" slot never reaches visitors: it is skipped, unless the page is opened
// with ?slots (draft preview) AND the generated placeholder file exists (tools/portfolio/placeholders/, never deployed), then it carries a visible label.
const SLOT_RE = /^assets\/(?:portfolio\/[a-z0-9-]+\/[a-z0-9-]+|u\/[\w.-]+)\.(?:webp|jpe?g|png)$/;
const RATIO_RE = /^(\d{1,2}):(\d{1,2})$/;

/** URL to show for one manifest entry, or null. */
export function slotUrl(entry, { preview = false } = {}) {
  if (!entry || !SLOT_RE.test(entry.file || "")) return null;
  if (entry.status === "final") return entry.file;
  if (entry.status === "placeholder" && preview) return `tools/portfolio/placeholders/${entry.slug}/${entry.slot}.webp`;
  return null;
}

/** [{entry, url, placeholder}] for the slots a project lists, in the project's order. */
export function projectSlots(project, manifest, opts = {}) {
  const bySlot = new Map((manifest || []).filter((m) => m.slug === project.slug).map((m) => [m.slot, m]));
  return (project.slots || []).map((s) => bySlot.get(s)).filter(Boolean)
    .map((entry) => ({ entry, url: slotUrl(entry, opts), placeholder: entry.status !== "final" })).filter((x) => x.url);
}

export const ratioOf = (entry) => { const m = RATIO_RE.exec(entry?.ratio || ""); return m ? `${m[1]} / ${m[2]}` : "4 / 3"; };
export const filterProjects = (projects, category) => (category === "all" ? projects : projects.filter((p) => p.category === category));

const tr = (v, lang) => (v && typeof v === "object" ? v[lang] ?? v.en ?? Object.values(v)[0] ?? "" : v ?? "");
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};

const ui = { projects: null, manifest: null, category: "all", detail: null };
const preview = () => /[?&]slots(?:[=&]|$)/.test(location.search);

function paint() {
  const host = document.getElementById("archiveGrid");
  const { site, lang } = ui.detail || {};
  const cfg = site?.work?.archive;
  if (!host || !cfg || !ui.projects?.length) return;
  const root = document.getElementById("archive");
  root?.removeAttribute("hidden");
  const cats = [{ id: "all", label: cfg.all }, ...cfg.categories];
  const filters = document.getElementById("archiveFilters");
  filters?.replaceChildren(...cats.map((c) => h("button", { type: "button", class: `filter${ui.category === c.id ? " active" : ""}`, "aria-pressed": String(ui.category === c.id) }, tr(c.label, lang))));
  filters?.querySelectorAll("button").forEach((b, i) => b.addEventListener("click", () => { ui.category = cats[i].id; paint(); }));
  for (const [id, key] of [["archiveTitle", "title"], ["archiveLead", "lead"]]) { const el = document.getElementById(id); if (el) el.textContent = tr(cfg[key], lang); }
  host.replaceChildren(...filterProjects(ui.projects, ui.category).map((p) => {
    const slots = projectSlots(p, ui.manifest, { preview: preview() });
    const cat = cfg.categories.find((c) => c.id === p.category);
    return h("article", { class: "product-card archive-card", "data-slug": p.slug },
      slots.length ? h("div", { class: `archive-shots n${Math.min(slots.length, 3)}` }, slots.slice(0, 3).map(({ entry, url, placeholder }) =>
        h("figure", { style: `aspect-ratio:${ratioOf(entry)}` }, h("img", { src: url, alt: tr(entry.alt, lang), loading: "lazy" }), placeholder ? h("figcaption", { class: "ph-mark" }, "PLACEHOLDER") : null))) : null,
      h("div", { class: "product-body" },
        h("div", { class: "product-meta" }, h("span", { class: "tag" }, tr(cat?.label ?? p.category, lang)), p.years ? h("span", { class: "tag status" }, p.years) : null),
        h("h3", {}, tr(p.title, lang)), h("p", {}, tr(p.summary, lang)),
        h("div", { class: "chips" }, (p.tags || []).map((t) => h("span", { class: "chip" }, t)))));
  }));
}

async function boot() {
  const get = async (p) => { const r = await fetch(p, { cache: "no-cache" }); if (!r.ok) throw new Error(p); return r.json(); };
  try {
    const [data, manifest] = await Promise.all([get("/data/portfolio.json"), get("/data/portfolio-images.json")]);
    ui.projects = data.projects; ui.manifest = manifest;
  } catch { return; }                                   // no archive data: the subsection stays hidden
  if (window.vitehRender) { ui.detail = window.vitehRender; paint(); }
}
if (typeof document !== "undefined") {
  document.addEventListener("viteh:render", (e) => { ui.detail = e.detail; paint(); });
  boot();
}
