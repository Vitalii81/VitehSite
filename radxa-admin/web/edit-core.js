"use strict";
// Pure logic of the "edit on the page" overlay: where a text on the page lives in the draft, and how a change is written into it.
// No DOM here, so `node --test` can run it (tests/edit-core.test.mjs). The browser gets the same code as window.VEdit.
// Everything the server accepts is re-checked by schema.sanitize; this file only has to produce a draft of the right shape.
(function (root, make) {
  const api = make();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VEdit = api;
})(typeof self !== "undefined" ? self : this, function () {
  const LANGS = ["uk", "en", "de"];
  const MOVABLE = ["services", "ai", "process", "work", "stack", "pricing", "faq", "contact"];
  const MAX = { text: 2000, serviceTitle: 80, serviceText: 300, servicePoint: 80, projectTitle: 80, projectSummary: 300, projectStatus: 40, galleryTitle: 80, gallerySummary: 600, galleryYears: 20 };

  const isIndex = (n) => Number.isInteger(n) && n >= 0 && n < 1000;
  const one = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").trim();      // Enter commits an edit, so texts are one line

  /** Where a node's text lives in site.json, or null. `desc` is built by the overlay from the DOM:
   *  {i18n: "hero.lead"}  or  {card: "services", index: 2, field: "title"|"text", point: 1}. */
  function sitePath(desc) {
    if (!desc) return null;
    if (typeof desc.i18n === "string") return /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(desc.i18n) ? desc.i18n : null;
    const { card, index, field, point } = desc;
    if (card === "price") return field === "ribbon" ? "pricing.featured" : field === "price" ? "pricing.price" : field === "cta" ? "nav.cta" : null;
    if (!isIndex(index)) return null;
    const hasPoint = point !== undefined && point !== null;
    if (hasPoint && !isIndex(point)) return null;
    switch (card) {
      case "heroBadges": return `hero.badges.${index}`;
      case "trust": return `trust.items.${index}`;
      case "services": return hasPoint ? `services.items.${index}.points.${point}` : ["title", "text"].includes(field) ? `services.items.${index}.${field}` : null;
      case "ai": return ["title", "text"].includes(field) ? `ai.features.${index}.${field}` : null;
      case "process": return ["title", "text"].includes(field) ? `process.steps.${index}.${field}` : null;
      case "pricing": return hasPoint ? `pricing.models.${index}.points.${point}` : ["title", "text"].includes(field) ? `pricing.models.${index}.${field}` : null;
      case "faq": return ["q", "a"].includes(field) ? `faq.items.${index}.${field}` : null;
      case "contact": return ["label", "value"].includes(field) ? `contact.details.${index}.${field}` : null;
      default: return null;
    }
  }

  const extraServices = (draft) => draft.extra?.services || [];
  const extraProjects = (draft) => draft.extra?.projects || [];

  const own = (obj, key) => !!obj && typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key);
  const PLAIN_PATH = /^(?:stack\.groups\.\d{1,2}\.items\.\d{1,2}|contact\.details\.\d{1,2}\.value)$/;
  const SINGLE = ["plain", "tag", "galleryTag", "galleryYears"];           // bindings whose value has no translation
  const GALLERY_FIELDS = { title: MAX.galleryTitle, summary: MAX.gallerySummary };
  const gallery = (draft) => (draft.portfolio ||= { disabled: [], order: [], items: {} });

  /** env = {draft, editable, factoryServices, factoryGallery}. Returns a binding {kind, key, ...} or null when the text cannot be edited here
   *  (not in the draft's schema, a plain string, or a factory project card whose text is not part of the draft). */
  function bindingFor(desc, env) {
    if (desc && desc.card === "products") {
      if (!["title", "summary", "status"].includes(desc.field)) return null;
      if (extraProjects(env.draft).some((p) => p.id === desc.id)) return { kind: "extraProject", id: desc.id, field: desc.field, key: `project:${desc.id}:${desc.field}` };
      if (own(env.factoryProducts, desc.id)) return { kind: "productText", id: desc.id, field: desc.field, key: `product:${desc.id}:${desc.field}` };      // a factory card: overrides live in draft.products
      return null;
    }
    if (desc && typeof desc.plain === "string") {           // a visible string without translation: stack items, e-mail, phone
      return PLAIN_PATH.test(desc.plain) && own(env.editablePlain, desc.plain) ? { kind: "plain", path: desc.plain, key: `plain:${desc.plain}` } : null;
    }
    if (desc && desc.card === "tag" && isIndex(desc.index) && (extraProjects(env.draft).some((p) => p.id === desc.id) || own(env.factoryProducts, desc.id))) return { kind: "tag", id: desc.id, index: desc.index, key: `tag:${desc.id}:${desc.index}` };
    if (desc && desc.card === "galleryTag" && isIndex(desc.index) && own(env.factoryGallery, desc.slug)) return { kind: "galleryTag", slug: desc.slug, index: desc.index, key: `gtag:${desc.slug}:${desc.index}` };
    if (desc && desc.card === "galleryYears" && own(env.factoryGallery, desc.slug)) return { kind: "galleryYears", slug: desc.slug, key: `gyears:${desc.slug}` };
    if (desc && desc.card === "gallery") {           // a card of the project gallery "Замовні розробки" (data/portfolio.json, kept in draft.portfolio)
      if (!Object.prototype.hasOwnProperty.call(GALLERY_FIELDS, desc.field) || !env.factoryGallery?.[desc.slug]) return null;
      return { kind: "gallery", slug: desc.slug, field: desc.field, key: `gallery:${desc.slug}:${desc.field}` };
    }
    const path = sitePath(desc);
    if (!path) return null;
    const m = /^services\.items\.(\d+)\.(title|text|points\.(\d+))$/.exec(path);
    if (m && Number(m[1]) >= env.factoryServices) {                         // cards after the factory ones are the owner's own services
      const svc = extraServices(env.draft)[Number(m[1]) - env.factoryServices];
      if (!svc) return null;
      const point = m[3] === undefined ? null : Number(m[3]);
      if (point !== null && !svc.points?.[point]) return null;
      return { kind: "extraService", id: svc.id, field: point === null ? m[2] : "points", point, key: `service:${svc.id}:${m[2]}` };
    }
    return Object.prototype.hasOwnProperty.call(env.editable, path) ? { kind: "text", path, key: `text:${path}` } : null;
  }

  function holder(binding, env) {            // the {uk,en,de} object a binding points at (may be undefined)
    const { draft } = env;
    if (binding.kind === "text") return draft.texts?.[binding.path] || env.editable[binding.path];
    if (binding.kind === "productText") return draft.products?.[binding.id]?.[binding.field] || env.factoryProducts?.[binding.id]?.[binding.field];
    if (binding.kind === "gallery") return draft.portfolio?.items?.[binding.slug]?.[binding.field] || env.factoryGallery?.[binding.slug]?.[binding.field];
    if (binding.kind === "extraService") {
      const svc = extraServices(draft).find((s) => s.id === binding.id);
      return binding.field === "points" ? svc?.points?.[binding.point] : svc?.[binding.field];
    }
    return extraProjects(draft).find((p) => p.id === binding.id)?.[binding.field];
  }

  function singleValue(b, env) {            // the string behind a binding without translation
    const { draft } = env;
    if (b.kind === "plain") return draft.plain?.[b.path] ?? env.editablePlain[b.path] ?? "";
    if (b.kind === "tag") return tagList(b, env)[b.index] ?? "";
    if (b.kind === "galleryTag") return (draft.portfolio?.items?.[b.slug]?.tags || env.factoryGallery[b.slug].tags || [])[b.index] ?? "";
    return draft.portfolio?.items?.[b.slug]?.years ?? env.factoryGallery[b.slug].years ?? "";
  }
  function tagList(b, env) {
    const extra = extraProjects(env.draft).find((p) => p.id === b.id);
    return extra ? extra.tags || [] : env.draft.products?.[b.id]?.tags || env.factoryProducts[b.id].tags || [];
  }
  const readText = (binding, env, lang) => (SINGLE.includes(binding.kind) ? singleValue(binding, env) : holder(binding, env)?.[lang] ?? "");

  function maxLength(binding) {
    if (binding.kind === "text") return MAX.text;
    if (binding.kind === "gallery") return GALLERY_FIELDS[binding.field];
    if (binding.kind === "plain") return 120;
    if (binding.kind === "tag" || binding.kind === "galleryTag") return 24;
    if (binding.kind === "galleryYears") return MAX.galleryYears;
    if (binding.kind === "productText") return binding.field === "title" ? MAX.projectTitle : binding.field === "summary" ? MAX.projectSummary : MAX.projectStatus;
    if (binding.kind === "extraService") return binding.field === "title" ? MAX.serviceTitle : binding.field === "text" ? MAX.serviceText : MAX.servicePoint;
    return binding.field === "title" ? MAX.projectTitle : binding.field === "summary" ? MAX.projectSummary : MAX.projectStatus;
  }

  /** Writes `value` for one language into the draft. Returns the stored (trimmed, capped) text, or null when nothing changed. */
  function writeText(binding, env, lang, value) {
    if (!LANGS.includes(lang)) return null;
    const next = one(value).slice(0, maxLength(binding));
    if (one(readText(binding, env, lang)) === next) return null;
    if (SINGLE.includes(binding.kind)) {
      if (!next && binding.kind !== "galleryYears") return null;          // an emptied tag or value is not saved (remove it in the admin)
      const { draft } = env;
      if (binding.kind === "plain") {
        draft.plain ||= {};
        if (next === env.editablePlain[binding.path]) delete draft.plain[binding.path]; else draft.plain[binding.path] = next;
      } else if (binding.kind === "tag") {
        const list = tagList(binding, env).slice();
        list[binding.index] = next;
        const extra = extraProjects(draft).find((p) => p.id === binding.id);
        if (extra) extra.tags = list;
        else { draft.products ||= {}; draft.products[binding.id] = { ...(draft.products[binding.id] || {}), tags: list }; }
      } else if (binding.kind === "galleryTag") {
        const items = gallery(draft).items;
        const list = (items[binding.slug]?.tags || env.factoryGallery[binding.slug].tags || []).slice();
        list[binding.index] = next;
        items[binding.slug] = { ...(items[binding.slug] || {}), tags: list };
      } else {
        const items = gallery(draft).items;
        items[binding.slug] = { ...(items[binding.slug] || {}), years: next };
      }
      return next;
    }
    if (binding.kind === "productText") {
      env.draft.products ||= {};
      const cur = env.draft.products[binding.id] || {};
      const base = cur[binding.field] || { ...env.factoryProducts[binding.id][binding.field] };
      env.draft.products[binding.id] = { ...cur, [binding.field]: { ...base, [lang]: next } };
    } else if (binding.kind === "gallery") {
      const items = gallery(env.draft).items;
      const base = items[binding.slug]?.[binding.field] || { ...env.factoryGallery[binding.slug][binding.field] };
      items[binding.slug] = { ...(items[binding.slug] || {}), [binding.field]: { ...base, [lang]: next } };
    } else if (binding.kind === "text") {
      env.draft.texts ||= {};
      const base = env.draft.texts[binding.path] || { ...env.editable[binding.path] };
      env.draft.texts[binding.path] = { ...base, [lang]: next };
    } else {
      const target = holder(binding, env);
      if (!target) return null;
      target[lang] = next;
    }
    return next;
  }

  /* ---------- switches ---------- */
  // target: {type: "section"|"service"|"project"|"gallery", id}
  function isOff(draft, target) {
    if (target.type === "section") return draft.sections?.[target.id] === false;
    if (target.type === "gallery") return (draft.portfolio?.disabled || []).includes(target.id);
    const list = draft.disabled?.[target.type === "service" ? "services" : "projects"] || [];
    return list.includes(target.id);
  }

  function setEnabled(draft, target, on) {
    if (target.type === "section") {
      draft.sections ||= {};
      draft.sections[target.id] = !!on;
      return;
    }
    if (target.type === "gallery") {
      const g = gallery(draft);
      g.disabled = on ? g.disabled.filter((x) => x !== target.id) : [...g.disabled.filter((x) => x !== target.id), target.id];
      return;
    }
    draft.disabled ||= {};
    const key = target.type === "service" ? "services" : "projects";
    const rest = (draft.disabled[key] || []).filter((x) => x !== target.id);
    draft.disabled[key] = on ? rest : [...rest, target.id];
  }

  /** The service id of the card with index i: "s<i>" for factory cards, the "x-..." id of the owner's own ones after them. */
  function serviceId(draft, index, factoryServices) {
    return index < factoryServices ? `s${index}` : extraServices(draft)[index - factoryServices]?.id || null;
  }

  /* ---------- save indicator ---------- */
  /** What the bar's status chip shows. `typing`: a text field has been changed but not left yet (the change is committed on blur), `dirty`: committed
   *  but not saved, `saving`: a request is in flight. Typing and unsaved changes always win over "saved", so the chip never claims "Збережено"
   *  while there is text the server does not have; error and conflict are sticky until the next save. */
  function saveIndicator({ state, dirty, typing }) {
    if (state === "error" || state === "conflict") return state;
    if (typing || dirty) return "dirty";
    return state === "saving" ? "saving" : "saved";
  }

  /* ---------- order ---------- */
  const effectiveOrder = (draft) => (Array.isArray(draft.order) && draft.order.length === MOVABLE.length ? draft.order : MOVABLE.slice());

  /** Moves a movable section one step up (-1) or down (+1). An order equal to the factory one is stored as [] (the build then matches the factory page). */
  function moveSection(draft, id, dir) {
    const order = effectiveOrder(draft).slice();
    const at = order.indexOf(id);
    const to = at + (dir < 0 ? -1 : 1);
    if (at < 0 || to < 0 || to >= order.length) return false;
    [order[at], order[to]] = [order[to], order[at]];
    draft.order = order.every((x, i) => x === MOVABLE[i]) ? [] : order;
    return true;
  }

  /** Moves a gallery project one step among the VISIBLE ones (`all` = every factory slug in factory order, `visible` = those the home page shows;
   *  projects only the portfolio page shows keep their places). An order equal to the factory one is stored as []. */
  function moveGallery(draft, slug, dir, all, visible) {
    const g = gallery(draft);
    const order = (g.order?.length === all.length ? g.order : all).slice();
    const shown = order.filter((x) => visible.includes(x));
    const at = shown.indexOf(slug);
    const other = shown[at + (dir < 0 ? -1 : 1)];
    if (at < 0 || other === undefined) return false;
    const a = order.indexOf(slug), b = order.indexOf(other);
    [order[a], order[b]] = [order[b], order[a]];
    g.order = order.every((x, i) => x === all[i]) ? [] : order;
    return true;
  }

  /** The category of a project card (factory cards keep it in draft.products, the owner's own cards in extra.projects). */
  const categoryOf = (draft, id, factoryProducts) => extraProjects(draft).find((p) => p.id === id)?.category || draft.products?.[id]?.category || factoryProducts?.[id]?.category || "";
  function setCategory(draft, id, category, factoryProducts) {
    const extra = extraProjects(draft).find((p) => p.id === id);
    if (extra) { extra.category = category; return; }
    draft.products ||= {};
    draft.products[id] = { ...(draft.products[id] || {}), category };
    if (factoryProducts?.[id]?.category === category) delete draft.products[id].category;
  }

  /* ---------- images and models ---------- */
  // target: {type: "hero"} | {type: "projectImage"|"projectModel"|"serviceModel", id} | {type: "gallerySlot", id: "<slug>/<slot>"}. An empty ref goes back to the factory file.
  function setMedia(draft, target, ref) {
    draft.images ||= {};
    const put = (key, id) => {
      draft.images[key] ||= {};
      if (ref) draft.images[key][id] = ref; else delete draft.images[key][id];
    };
    if (target.type === "hero") draft.images.hero = ref || "";
    else if (target.type === "projectImage") put("projects", target.id);
    else if (target.type === "projectModel") put("models", target.id);
    else if (target.type === "gallerySlot") put("portfolio", target.id);
    else if (target.type === "serviceModel") {
      const own = extraServices(draft).find((s) => s.id === target.id);
      if (own) own.model = ref || "";
      else put("serviceModels", target.id);
    }
  }

  const mediaRef = (draft, target) => {
    const im = draft.images || {};
    if (target.type === "hero") return im.hero || "";
    if (target.type === "projectImage") return im.projects?.[target.id] || "";
    if (target.type === "projectModel") return im.models?.[target.id] || "";
    if (target.type === "gallerySlot") return im.portfolio?.[target.id] || "";
    return im.serviceModels?.[target.id] || extraServices(draft).find((s) => s.id === target.id)?.model || "";
  };

  /** What the picker offers: factory pictures (images only) and the owner's uploads of the right kind, newest first as the server lists them. */
  function pickerItems(kind, boot, uploadsOnly) {         // gallery slots take the owner's uploads only (the server refuses factory files there)
    const uploads = (boot.uploads || []).filter((u) => u.kind === kind).map((u) => ({ ref: u.ref, label: u.name || u.ref, upload: true }));
    const factory = kind === "image" && !uploadsOnly ? (boot.factoryImages || []).map((ref) => ({ ref, label: ref.replace(/^assets\//, ""), upload: false })) : [];
    return [...factory, ...uploads];
  }

  const imageSrc = (ref, api) => (ref.startsWith("u:") ? `${api}?action=file&id=${ref.slice(2)}` : `/${ref}`);

  return { LANGS, MOVABLE, MAX, one, sitePath, bindingFor, readText, writeText, maxLength, isOff, setEnabled, serviceId, effectiveOrder, moveSection, moveGallery, categoryOf, setCategory, saveIndicator, setMedia, mediaRef, pickerItems, imageSrc };
});
