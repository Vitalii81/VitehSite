"use strict";

const FALLBACK_LANG = "en";
const ICON_BASE = "assets/icons.svg#i-";

const state = { lang: FALLBACK_LANG, category: "all", site: null, products: [] };

/* ---------- helpers ---------- */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const tr = (value, lang = state.lang) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value[lang] ?? value[FALLBACK_LANG] ?? Object.values(value)[0] ?? "";
  }
  return value ?? "";
};

const getPath = (object, path) => path.split(".").reduce((current, key) => current?.[key], object);

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage may be blocked */ } },
};

/** Tiny DOM builder: h("div", {class: "x"}, child, "text"). Uses textContent only, so no HTML injection. */
const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
};

const svgIcon = (name, cls = "ico") => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", ICON_BASE + name);
  svg.append(use);
  return svg;
};

const loadJson = async (path) => {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
};

const mount = (selector, ...nodes) => {
  const target = $(selector);
  if (!target) return null;
  target.replaceChildren(...nodes.flat());
  return target;
};

/* ---------- language ---------- */
const supported = () => state.site.languages.map((language) => language.code);

const detectLanguage = () => {
  const codes = supported();
  const fromUrl = new URLSearchParams(location.search).get("lang");
  if (codes.includes(fromUrl)) return fromUrl;
  const saved = store.get("viteh.lang");
  if (codes.includes(saved)) return saved;
  for (const candidate of navigator.languages || [navigator.language]) {
    const short = (candidate || "").slice(0, 2).toLowerCase();
    if (codes.includes(short)) return short;
  }
  return FALLBACK_LANG;
};

const setLanguage = (lang, { persist = true } = {}) => {
  state.lang = lang;
  document.documentElement.lang = lang;
  if (persist) {
    store.set("viteh.lang", lang);
    const url = new URL(location.href);
    url.searchParams.set("lang", lang);
    history.replaceState(null, "", url);
  }
  render();
};

/* ---------- theme ---------- */
const currentTheme = () => document.documentElement.dataset.theme
  || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

const updateThemeButton = () => {
  const button = $("#themeToggle");
  if (!button || !state.site) return;
  const dark = currentTheme() === "dark";
  button.setAttribute("aria-label", tr(dark ? state.site.ui.themeToLight : state.site.ui.themeToDark));
};

const toggleTheme = () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  store.set("viteh.theme", next);
  updateThemeButton();
};

/* ---------- renderers ---------- */
const renderTranslations = () => {
  $$("[data-i18n]").forEach((node) => {
    const value = getPath(state.site, node.dataset.i18n);
    if (value !== undefined) node.textContent = tr(value);
  });
};

const renderLanguageSwitch = () => {
  const container = $("#langSwitch");
  if (!container) return;
  container.setAttribute("aria-label", tr(state.site.ui.language));
  container.replaceChildren(...state.site.languages.map((language) => h("button", {
    type: "button",
    lang: language.code,
    title: language.label,
    "aria-label": language.label,
    "aria-pressed": String(language.code === state.lang),
    onclick: () => setLanguage(language.code),
  }, language.short)));
};

const renderHero = () => {
  const { hero } = state.site;
  mount("#heroBadges", hero.badges.map((badge) => h("li", {}, svgIcon("check"), tr(badge))));
  const image = $("#heroImage");
  if (image) image.alt = tr(hero.imageAlt);
};

const renderTrust = () => {
  mount("#trustList", state.site.trust.items.map((item) => h("li", {}, svgIcon("check"), tr(item))));
};

/** Inline emphasis for card texts, built as DOM nodes (never HTML): **key** = strong accent, ~~minor~~ = muted, {{aspect}} = chip. */
const RICH = /\*\*(.+?)\*\*|~~(.+?)~~|\{\{(.+?)\}\}/g;
const rich = (text) => {
  const out = [];
  let pos = 0;
  for (const m of String(text).matchAll(RICH)) {
    if (m.index > pos) out.push(text.slice(pos, m.index));
    out.push(m[1] != null ? h("strong", { class: "em" }, m[1]) : m[2] != null ? h("span", { class: "minor" }, m[2]) : h("span", { class: "tag" }, m[3]));
    pos = m.index + m[0].length;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
};

/* illustrative scenes for service cards without a 3D model (static markup, drawn with the theme's accent colours) */
const SCENES = {"shield": "<rect class=\"f l\" x=\"70\" y=\"30\" width=\"110\" height=\"140\" rx=\"10\"/><path class=\"l\" d=\"M88 62h50M88 84h72M88 106h60M88 128h40\"/><circle class=\"d\" cx=\"88\" cy=\"62\" r=\"0\"/><path class=\"l\" d=\"M84 62l5 5 9-10\" transform=\"translate(-6 0)\"/><circle class=\"f l\" cx=\"190\" cy=\"118\" r=\"34\"/><path class=\"l\" d=\"M214 142l30 30\" stroke-width=\"7\"/><path class=\"l\" d=\"M176 118l10 10 20-22\"/><path class=\"f l\" d=\"M222 38l30 10v26c0 18-12 30-30 38-18-8-30-20-30-38V48z\"/><path class=\"l\" d=\"M210 72l9 9 16-18\"/>", "globe": "<rect class=\"f l\" x=\"40\" y=\"28\" width=\"220\" height=\"144\" rx=\"12\"/><path class=\"l\" d=\"M40 54h220\"/><circle class=\"d\" cx=\"56\" cy=\"41\" r=\"4\"/><circle class=\"d\" cx=\"70\" cy=\"41\" r=\"4\"/><circle class=\"d\" cx=\"84\" cy=\"41\" r=\"4\"/><rect class=\"l\" x=\"104\" y=\"34\" width=\"120\" height=\"14\" rx=\"7\"/><rect class=\"m\" x=\"58\" y=\"68\" width=\"110\" height=\"14\" rx=\"4\"/><rect class=\"m\" x=\"58\" y=\"90\" width=\"80\" height=\"8\" rx=\"4\"/><rect class=\"d\" x=\"58\" y=\"108\" width=\"48\" height=\"16\" rx=\"8\"/><rect class=\"l f\" x=\"188\" y=\"68\" width=\"54\" height=\"56\" rx=\"8\"/><circle class=\"l\" cx=\"215\" cy=\"90\" r=\"12\"/><path class=\"l\" d=\"M203 90h24M215 78c-6 8-6 16 0 24M215 78c6 8 6 16 0 24\"/><rect class=\"l\" x=\"58\" y=\"136\" width=\"52\" height=\"24\" rx=\"6\"/><rect class=\"l\" x=\"124\" y=\"136\" width=\"52\" height=\"24\" rx=\"6\"/><rect class=\"l\" x=\"190\" y=\"136\" width=\"52\" height=\"24\" rx=\"6\"/><path class=\"d\" d=\"M232 120l16 34-8 1-6 9z\" transform=\"translate(6 12)\"/>", "code": "<rect class=\"f l\" x=\"100\" y=\"14\" width=\"100\" height=\"172\" rx=\"16\"/><rect class=\"l\" x=\"108\" y=\"30\" width=\"84\" height=\"132\" rx=\"6\"/><path class=\"l\" d=\"M138 22h24\"/><rect class=\"d\" x=\"116\" y=\"40\" width=\"68\" height=\"14\" rx=\"4\"/><rect class=\"m\" x=\"116\" y=\"62\" width=\"32\" height=\"32\" rx=\"6\"/><rect class=\"m\" x=\"152\" y=\"62\" width=\"32\" height=\"32\" rx=\"6\"/><rect class=\"m\" x=\"116\" y=\"100\" width=\"68\" height=\"10\" rx=\"4\"/><rect class=\"m\" x=\"116\" y=\"116\" width=\"50\" height=\"10\" rx=\"4\"/><circle class=\"d\" cx=\"150\" cy=\"148\" r=\"8\"/><path class=\"l\" d=\"M222 70l-14 14 14 14M238 70l14 14-14 14\" transform=\"translate(4 -6)\"/><path class=\"l\" d=\"M62 60l-12 12 12 12M78 60l12 12-12 12\" transform=\"translate(-8 0)\"/><circle class=\"f l\" cx=\"62\" cy=\"140\" r=\"18\"/><path class=\"l\" d=\"M54 140l6 6 11-12\"/>", "chat": "<path class=\"f l\" d=\"M40 38h140a12 12 0 0 1 12 12v50a12 12 0 0 1-12 12h-82l-24 20v-20H40a12 12 0 0 1-12-12V50a12 12 0 0 1 12-12z\" transform=\"translate(6 0)\"/><path class=\"l\" d=\"M60 62h96M60 82h64\"/><path class=\"d\" d=\"M222 96h-60a12 12 0 0 0-12 12v26a12 12 0 0 0 12 12h30l22 16v-16h8a12 12 0 0 0 12-12v-26a12 12 0 0 0-12-12z\" transform=\"translate(30 0) scale(0.88) translate(26 14)\"/><rect class=\"f l\" x=\"42\" y=\"130\" width=\"26\" height=\"40\" rx=\"13\"/><path class=\"l\" d=\"M32 152a23 23 0 0 0 46 0M55 175v10M44 185h22\"/>", "agent": "<rect class=\"f l\" x=\"104\" y=\"24\" width=\"92\" height=\"40\" rx=\"8\"/><rect class=\"f l\" x=\"104\" y=\"72\" width=\"92\" height=\"40\" rx=\"8\"/><rect class=\"f l\" x=\"104\" y=\"120\" width=\"92\" height=\"40\" rx=\"8\"/><circle class=\"d\" cx=\"120\" cy=\"44\" r=\"4\"/><circle class=\"d\" cx=\"134\" cy=\"44\" r=\"4\"/><circle class=\"d\" cx=\"120\" cy=\"92\" r=\"4\"/><circle class=\"d\" cx=\"134\" cy=\"92\" r=\"4\"/><circle class=\"d\" cx=\"120\" cy=\"140\" r=\"4\"/><circle class=\"d\" cx=\"134\" cy=\"140\" r=\"4\"/><path class=\"l\" d=\"M158 44h24M158 92h24M158 140h24\"/><path class=\"l\" d=\"M104 92H80M196 92h24M150 160v16M150 176H60M150 176h90\"/><rect class=\"f l\" x=\"34\" y=\"72\" width=\"46\" height=\"40\" rx=\"6\"/><path class=\"l\" d=\"M34 80l23 16 23-16\"/><circle class=\"f l\" cx=\"244\" cy=\"92\" r=\"24\"/><path class=\"l\" d=\"M220 92h48M244 68c-12 14-12 34 0 48M244 68c12 14 12 34 0 48\"/><rect class=\"f l\" x=\"36\" y=\"150\" width=\"30\" height=\"40\" rx=\"4\" transform=\"translate(0 -8)\"/><path class=\"l\" d=\"M42 150h18M42 160h18M42 170h12\"/><rect class=\"f l\" x=\"226\" y=\"150\" width=\"30\" height=\"40\" rx=\"4\" transform=\"translate(0 -8)\"/><path class=\"l\" d=\"M232 150h18M232 160h18M232 170h12\"/>"};
const sceneSvg = (name) => {
  const markup = SCENES[name];
  if (!markup) return null;
  const doc = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" class="scene" aria-hidden="true">' + markup + "</svg>", "image/svg+xml");
  return document.importNode(doc.documentElement, true);
};

const renderServices = () => {
  mount("#serviceGrid", state.site.services.items.map((item, index) => h("article", { class: "card reveal", "data-s": String(index) },
    h("div", { class: "card-icon" }, (!item.model && sceneSvg(item.icon)) || svgIcon(item.icon)),
    h("h3", {}, tr(item.title)),
    h("p", {}, rich(tr(item.text))),
    h("ul", { class: "check-list" }, item.points.map((point) => h("li", {}, svgIcon("check"), h("span", {}, rich(tr(point)))))),
  )));
};

const renderAi = () => {
  const icons = ["globe", "shield", "lock", "chip"];
  mount("#aiFeatures", state.site.ai.features.map((feature, index) => h("li", {},
    h("span", { class: "dot" }, svgIcon(icons[index % icons.length])),
    h("div", {}, h("h3", {}, tr(feature.title)), h("p", {}, tr(feature.text))),
  )));
  const diagram = $("#aiDiagram");
  if (diagram) diagram.alt = tr(state.site.ai.diagramAlt);
};

const renderProcess = () => {
  mount("#processSteps", state.site.process.steps.map((step, index) => h("li", { class: "reveal" },
    h("div", { class: "num", "aria-hidden": "true" }, String(index + 1)),
    h("h3", {}, tr(step.title)),
    h("p", {}, tr(step.text)),
  )));
};

const renderFilters = () => {
  const categories = [{ id: "all", label: state.site.work.all }, ...state.site.work.categories];
  mount("#categoryFilters", categories.map((category) => h("button", {
    type: "button",
    class: `filter${state.category === category.id ? " active" : ""}`,
    "aria-pressed": String(state.category === category.id),
    onclick: () => { state.category = category.id; renderFilters(); renderProducts(); announceGallery(); },
  }, tr(category.label))));
};

const renderProducts = () => {
  const { work } = state.site;
  const onlyModels = $("#productGrid")?.dataset.onlyModels === "1";      // generated "3D gallery" blocks list only products with a model
  const pool = onlyModels ? state.products.filter((p) => p.model) : state.products;
  const visible = state.category === "all" ? pool : pool.filter((p) => p.category === state.category);
  mount("#productGrid", visible.map((product) => {
    const category = work.categories.find((c) => c.id === product.category);
    return h("article", { class: "product-card", "data-id": product.id },
      h("img", { src: product.image, alt: "", width: 480, height: 320, loading: "lazy" }),
      h("div", { class: "product-body" },
        h("div", { class: "product-meta" },
          h("span", { class: "tag" }, tr(category?.label ?? product.category)),
          h("span", { class: "tag status" }, tr(product.status)),
        ),
        h("h3", {}, tr(product.title)),
        h("p", {}, tr(product.summary)),
        h("div", { class: "chips" }, product.tags.map((tag) => h("span", { class: "chip" }, tag))),
        h("a", { class: "product-link", href: "#contact" }, tr(work.request), svgIcon("arrow")),
      ),
    );
  }));
};

/** Hook for assets/gallery3d.js (optional enhancement): announces products and services after the cards are in the DOM. */
const announceGallery = () => {
  const detail = { products: state.products, services: state.site.services?.items || [], lang: state.lang, ui: state.site.ui };
  window.vitehGalleryData = detail;
  document.dispatchEvent(new CustomEvent("viteh:products", { detail }));
};

const renderStack = () => {
  mount("#stackGrid", state.site.stack.groups.map((group) => h("div", { class: "stack-group reveal" },
    h("h3", {}, tr(group.title)),
    h("ul", {}, group.items.map((item) => h("li", {}, item))),
  )));
};

const renderPricing = () => {
  const { pricing } = state.site;
  mount("#pricingGrid", pricing.models.map((model) => h("article", { class: `price-card reveal${model.featured ? " featured" : ""}` },
    model.featured ? h("span", { class: "ribbon" }, tr(pricing.featured)) : null,
    h("h3", {}, tr(model.title)),
    h("p", {}, tr(model.text)),
    h("div", { class: "price-tag" }, tr(pricing.price)),
    h("ul", { class: "check-list" }, model.points.map((point) => h("li", {}, svgIcon("check"), tr(point)))),
    h("a", { class: `btn ${model.featured ? "primary" : "ghost"}`, href: "#contact" }, tr(state.site.nav.cta), svgIcon("arrow")),
  )));
};

const renderFaq = () => {
  mount("#faqList", state.site.faq.items.map((item) => h("details", { class: "reveal" },
    h("summary", {}, tr(item.q)),
    h("div", { class: "answer" }, tr(item.a)),
  )));
};

const renderContact = () => {
  const { contact } = state.site;
  mount("#contactDetails", contact.details.map((detail) => {
    const value = tr(detail.value);
    const valueNode = detail.href ? h("a", { href: detail.href }, value) : h("span", { class: "val" }, value);
    return h("li", {},
      h("span", { class: "dot" }, svgIcon(detail.icon)),
      h("div", {}, h("small", {}, tr(detail.label)), valueNode,
        detail.demo ? h("span", { class: "demo-badge" }, tr(contact.demoBadge)) : null),
    );
  }));
  const select = $("#f-type");
  if (select) {
    const previous = select.selectedIndex;
    select.replaceChildren(...contact.form.types.map((type, index) => h("option", { value: String(index) }, tr(type))));
    select.selectedIndex = Math.max(previous, 0);
  }
  const message = $("#f-msg");
  if (message) message.placeholder = tr(contact.form.messagePh);
};

const renderLegal = () => {
  const root = document.documentElement;
  if (root.dataset.page !== "legal") return;
  const section = state.site.legal[root.dataset.legal];
  const title = $("#legalTitle");
  if (title) title.textContent = tr(section.title);
  mount("#legalBody", section.sections.map((block) => h("section", {},
    h("h2", {}, tr(block.h)),
    h("p", {}, tr(block.p)),
  )));
  document.title = `${tr(section.title)} — ViTeh`;
};

/* ---------- generated pages (built by radxa-admin) ---------- */
const renderPageHead = () => {
  const root = document.documentElement;
  if (root.dataset.page !== "page") return;
  try {
    const title = tr(JSON.parse(root.dataset.title || "{}"));
    if (title) document.title = `${title} — ViTeh`;
    const desc = tr(JSON.parse(root.dataset.desc || "{}"));
    if (desc) setMeta('meta[name="description"]', "content", desc);
  } catch { /* keep the static title */ }
  $$("img[data-alt]").forEach((image) => { try { image.alt = tr(JSON.parse(image.dataset.alt)); } catch { /* keep default */ } });
};

/* ---------- SEO / head ---------- */
const setMeta = (selector, attr, value) => { const node = $(selector); if (node) node.setAttribute(attr, value); };

const renderHead = () => {
  if (document.documentElement.dataset.page !== "home") return;
  const { meta, brand } = state.site;
  const title = tr(meta.title);
  const description = tr(meta.description);
  document.title = title;
  setMeta('meta[name="description"]', "content", description);
  setMeta('meta[property="og:title"]', "content", title);
  setMeta('meta[property="og:description"]', "content", description);

  let ld = $("#ld-json");
  if (!ld) { ld = h("script", { type: "application/ld+json", id: "ld-json" }); document.head.append(ld); }
  ld.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: brand.name,
    url: brand.url,
    description,
    inLanguage: state.lang,
    knowsAbout: ["Software development", "Embedded systems", "Electronics design", "AI agents", "IoT"],
  });
};

/* ---------- interactions ---------- */
const setupHeader = () => {
  const topbar = $("#topbar") || $(".topbar");
  const toTop = $("#toTop");
  const onScroll = () => {
    topbar?.classList.toggle("scrolled", window.scrollY > 8);
    if (window.scrollY < 200) $$("#nav a.active").forEach((link) => link.classList.remove("active"));
    toTop?.classList.toggle("show", window.scrollY > 700);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const nav = $("#nav");
  const toggle = $("#menuToggle");
  if (!nav || !toggle) return;
  const setOpen = (open) => {
    nav.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => setOpen(!nav.classList.contains("open")));
  nav.addEventListener("click", (event) => { if (event.target.closest("a")) setOpen(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") setOpen(false); });
};

const setupScrollSpy = () => {
  const links = $$('#nav a[href^="#"]').filter((link) => !link.classList.contains("nav-cta"));
  if (!links.length || !("IntersectionObserver" in window)) return;
  const byId = new Map(links.map((link) => [link.getAttribute("href").slice(1), link]));
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((link) => link.classList.remove("active"));
      byId.get(entry.target.id)?.classList.add("active");
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  byId.forEach((_, id) => { const section = document.getElementById(id); if (section) observer.observe(section); });
};

let revealObserver = null;
const observeReveals = () => {
  const nodes = $$(".reveal:not(.in)");
  if (!("IntersectionObserver" in window)) { nodes.forEach((n) => n.classList.add("in")); return; }
  revealObserver ??= new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add("in"); revealObserver.unobserve(entry.target); }
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
  nodes.forEach((node) => revealObserver.observe(node));
};

const CONTACT_ENDPOINT = "/api/contact";
const FILE_RULES = { count: 3, each: 5 * 1024 * 1024, total: 10 * 1024 * 1024, ext: ["pdf", "png", "jpg", "jpeg", "webp", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "csv"] };
const prettySize = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

const setupForm = () => {
  const form = $("#contactForm");
  if (!form) return;
  const status = $("#formStatus");
  const button = form.querySelector("button[type=submit]");
  const input = $("#f-files");
  const list = $("#attachList");
  const attachError = $("#attachError");
  let picked = [];
  let shownAt = Date.now();      // the server refuses forms that came back faster than a human could fill them
  const say = (kind, key) => {
    status.className = `form-status ${kind}`;
    status.textContent = tr(state.site.contact.form[key]);
  };
  const attachProblem = (code) => {
    const text = state.site.contact.form.attachErrors[code];
    attachError.textContent = text ? tr(text) : "";
  };
  const renderPicked = () => {
    list.replaceChildren(...picked.map((file, index) => {
      const remove = h("button", { type: "button", "aria-label": tr(state.site.contact.form.attachRemove) }, "×");
      remove.addEventListener("click", () => { picked.splice(index, 1); attachProblem(""); renderPicked(); });
      return h("li", {}, h("span", { class: "name" }, file.name), h("span", { class: "size" }, prettySize(file.size)), remove);
    }));
  };
  input.addEventListener("change", () => {
    attachProblem("");
    for (const file of Array.from(input.files)) {
      const ext = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
      const total = picked.reduce((sum, f) => sum + f.size, 0) + file.size;
      let problem = "";
      if (picked.length >= FILE_RULES.count) problem = "too_many_files";
      else if (!FILE_RULES.ext.includes(ext)) problem = "file_type";
      else if (file.size === 0) problem = "empty_file";
      else if (file.size > FILE_RULES.each) problem = "file_too_large";
      else if (total > FILE_RULES.total) problem = "files_too_large";
      if (problem) { attachProblem(problem); continue; }
      picked.push(file);
    }
    input.value = "";                 // the same file can be picked again after it was removed
    renderPicked();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const data = new FormData(form);
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.get("email") || ""));
    const checks = {
      "f-name": String(data.get("name") || "").trim().length > 0,
      "f-email": emailOk,
      "f-msg": String(data.get("message") || "").trim().length > 0,
    };
    Object.entries(checks).forEach(([id, ok]) => $("#" + id).closest(".field").classList.toggle("invalid", !ok));
    if (!Object.values(checks).every(Boolean) || !data.get("consent")) return say("err", "required");

    const body = new FormData();
    for (const key of ["name", "email", "type", "message", "hp"]) body.append(key, String(data.get(key) || ""));
    body.append("consent", "true");
    body.append("lang", state.lang);
    body.append("t", String(shownAt));
    picked.forEach((file) => body.append("files", file, file.name));

    button.disabled = true;
    say("", "sending");
    try {
      const response = await fetch(CONTACT_ENDPOINT, { method: "POST", body });
      if (response.ok) {
        say("ok", "success");
        form.reset();
        picked = [];
        renderPicked();
        attachProblem("");
        shownAt = Date.now();
      } else {
        const code = (await response.json().catch(() => ({}))).error;
        if (state.site.contact.form.attachErrors[code]) { attachProblem(code); say("err", "error"); }
        else say("err", response.status === 400 ? "required" : "error");
      }
    } catch {
      say("err", "error");
    } finally {
      button.disabled = false;
    }
  });
};

/* ---------- main ---------- */
function render() {
  renderTranslations();
  renderLanguageSwitch();
  updateThemeButton();
  if (document.documentElement.dataset.page === "home") {
    renderHero(); renderTrust(); renderServices(); renderAi(); renderProcess();
    renderFilters(); renderProducts(); renderStack(); renderPricing(); renderFaq(); renderContact();
    observeReveals();
    announceGallery();
  } else if ($("#productGrid")) {
    renderFilters(); renderProducts();
    announceGallery();
  }
  if (document.documentElement.dataset.page === "page") observeReveals();
  renderLegal();
  renderPageHead();
  renderHead();
  window.vitehRender = { site: state.site, lang: state.lang };      // hook for assets/portfolio.js (optional enhancement)
  document.dispatchEvent(new CustomEvent("viteh:render", { detail: window.vitehRender }));
  const year = $("#year");
  if (year) year.textContent = String(new Date().getFullYear());
}

const init = async () => {
  document.documentElement.classList.add("js");
  const isHome = document.documentElement.dataset.page === "home";
  const needsProducts = isHome || !!$("#productGrid");               // generated pages may carry a project or 3D block
  const [site, products] = await Promise.all([
    loadJson("/data/site.json"),
    needsProducts ? loadJson("/data/products.json") : Promise.resolve([]),
  ]);
  state.site = site;
  state.products = products;
  state.lang = detectLanguage();
  document.documentElement.lang = state.lang;

  $("#themeToggle")?.addEventListener("click", toggleTheme);
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", updateThemeButton);
  setupHeader();
  if (isHome) { setupForm(); setupScrollSpy(); }
  render();
};

init().catch((error) => {
  console.error(error);
  const message = h("p", { class: "noscript" }, "ViTeh — could not load site data. / Не вдалося завантажити дані. / Daten konnten nicht geladen werden.");
  document.body.prepend(message);
  $$(".reveal").forEach((node) => node.classList.add("in"));
});
