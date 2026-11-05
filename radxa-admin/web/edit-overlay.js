"use strict";
// "Edit on the page": runs ONLY on the page built by the admin API action `edit-page` (never in a published package).
// The site's own assets/app.js renders the page from the embedded data; this file adds controls on top of it:
// text editing in place, section/card switches, image and 3D-model pickers, section order. All changes go into the draft
// through the same `save` action as the admin (revision check, 409 on a conflict). Publishing stays in the admin.
// No innerHTML anywhere: every value is inserted as text.
(() => {
  const C = window.VEdit;
  const bootNode = document.getElementById("ve-boot");
  if (!C || !bootNode) return;
  const boot = JSON.parse(bootNode.textContent);
  const API = boot.api;
  const S = { draft: boot.draft, rev: boot.rev, dirty: false, saving: null, timer: null, state: "saved", message: "", conflict: false, problems: [], typing: false };
  const BIND = new WeakMap();
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const lang = () => document.documentElement.lang;
  const env = () => ({ draft: S.draft, editable: boot.editable, factoryServices: boot.factory.services, factoryGallery: boot.factoryGallery, factoryProducts: boot.factoryProducts, editablePlain: boot.editablePlain });
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* storage may be blocked */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
  };

  const h = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "checked") node.checked = !!v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return node;
  };

  /* ---------- API ---------- */
  async function call(action, { method = "GET", body, raw, query = "" } = {}) {
    const init = { method, credentials: "same-origin", headers: { "X-Vadmin": "1" } };
    if (raw !== undefined) { init.body = raw; init.headers["Content-Type"] = "application/octet-stream"; }
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }
    const response = await fetch(`${API}?action=${action}${query}`, init);
    const data = await response.json().catch(() => ({ ok: false, error: "bad_response", message: "Сервер повернув неочікувану відповідь" }));
    if (!response.ok) throw Object.assign(new Error(data.message || data.error || `HTTP ${response.status}`), { data, status: response.status });
    return data;
  }

  /* ---------- saving ---------- */
  function setState(state, message = "") {
    S.state = state;
    S.message = message;
    paintBar();
  }

  function markDirty() {
    if (S.conflict) return;
    S.dirty = true;
    setState("dirty");
    clearTimeout(S.timer);
    S.timer = setTimeout(save, 1200);
  }

  async function save() {
    clearTimeout(S.timer);
    if (S.saving) return S.saving;
    if (!S.dirty || S.conflict) return;
    S.dirty = false;
    setState("saving");
    S.saving = call("save", { method: "POST", body: { rev: S.rev, draft: S.draft } }).then((r) => {
      S.rev = r.rev;
      S.draft.rev = r.rev;
      setState(S.dirty ? "dirty" : "saved");
      refreshProblems();
    }).catch((e) => {
      S.dirty = true;
      if (e.data?.error === "conflict") { S.conflict = true; setState("conflict", e.message); }
      else if (e.status === 401) setState("error", "Сесія завершилась: відкрийте адмінку, увійдіть і поверніться сюди");
      else setState("error", e.message);
    }).finally(() => {
      S.saving = null;
      if (S.dirty && !S.conflict && S.state !== "error") S.timer = setTimeout(save, 300);
    });
    return S.saving;
  }

  async function refreshProblems() {        // the build would refuse e.g. a switched-off section that the page still links to
    try { S.problems = (await call("check")).problems || []; } catch { S.problems = []; }
    paintBar();
  }

  const flush = async () => { document.activeElement?.blur?.(); if (S.dirty) await save(); await S.saving; return !S.dirty && !S.conflict; };

  function reloadKeepingPlace() {
    store.set("ve.scroll", String(Math.round(window.scrollY)));
    location.reload();
  }

  window.addEventListener("beforeunload", (e) => { if (S.dirty || S.saving || S.typing) { e.preventDefault(); e.returnValue = ""; } });

  /* ---------- the bottom bar ---------- */
  const bar = h("div", { class: "ve-ui ve-toolbar", role: "region", "aria-label": "Режим редагування" });
  const shownState = () => C.saveIndicator(S);                 // typing counts as unsaved even before the field is left
  const stateLabel = { saved: "Збережено", dirty: "Є зміни…", saving: "Зберігаю…", error: "Помилка", conflict: "Конфлікт" };

  function paintBar() {
    const problem = S.problems[0];
    bar.replaceChildren(...[
      h("strong", { class: "ve-title" }, boot.page === "portfolio" ? "Редагування: портфоліо" : "Редагування"),
      h("span", { class: `ve-state ve-${shownState()}`, role: "status" }, stateLabel[shownState()] + (S.message ? `: ${S.message}` : "")),
      S.conflict ? h("button", { class: "ve-btn", type: "button", onclick: () => location.reload() }, "Оновити сторінку") : h("button", { class: "ve-btn", type: "button", onclick: () => { document.activeElement?.blur?.(); save(); } }, "Зберегти"),
      h("button", { class: "ve-btn", type: "button", onclick: otherTexts }, "Інші тексти…"),
      boot.page === "portfolio" ? h("a", { class: "ve-btn ve-link", href: pageUrl("home"), onclick: (e) => { e.preventDefault(); gotoPage(e.currentTarget.href); } }, "← Головна")
        : h("a", { class: "ve-btn ve-link", href: pageUrl("portfolio"), onclick: (e) => { e.preventDefault(); gotoPage(e.currentTarget.href); } }, "Портфоліо →"),
      !boot.gallery ? h("span", { class: "ve-note" }, "3D вимкнено в чернетці: моделі не потраплять у збірку") : null,
      problem ? h("span", { class: "ve-note ve-warn", title: S.problems.map((p) => `${p.where}: ${p.message}`).join("\n") }, `Збірка не пройде: ${problem.message}`) : null,
      h("a", { class: "ve-btn ve-link", href: boot.adminUrl, onclick: async (e) => { e.preventDefault(); if (await flush()) location.href = boot.adminUrl; } }, "До адмінки (зібрати й опублікувати)"),
    ].filter(Boolean));
  }

  /* ---------- text editing ---------- */
  const MODE = (() => { const probe = document.createElement("div"); probe.contentEditable = "plaintext-only"; return probe.contentEditable === "plaintext-only" ? "plaintext-only" : "true"; })();

  function textHost(el) {                   // an element with an icon next to its text: only the text is editable
    if (!el.children.length) return el;
    const existing = $(":scope > .ve-t", el);
    if (existing) return existing;
    for (const node of [...el.childNodes].reverse()) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
        const span = h("span", { class: "ve-t" });
        node.replaceWith(span);
        span.append(node);
        return span;
      }
    }
    return null;
  }

  function attach(el, desc) {
    if (!el) return;
    const binding = C.bindingFor(desc, env());
    if (!binding) return;
    const node = textHost(el);
    if (!node) return;
    BIND.set(node, binding);
    node.classList.add("ve-editable");
    node.setAttribute("contenteditable", MODE);
    node.setAttribute("spellcheck", "false");
    node.setAttribute("data-ve-key", binding.key);
    if (document.activeElement !== node) {
      const want = C.readText(binding, env(), lang());
      if (node.textContent !== want) node.textContent = want;
    }
  }

  function bindTexts() {
    $$("[data-i18n]").forEach((el) => { if (!el.closest(".skip-link, .ve-ui")) attach(el, { i18n: el.dataset.i18n }); });
    $$("#heroBadges li").forEach((li, i) => attach(li, { card: "heroBadges", index: i }));
    $$("#trustList li").forEach((li, i) => attach(li, { card: "trust", index: i }));
    $$("#serviceGrid .card[data-s]").forEach((card) => {
      const index = Number(card.dataset.s);
      attach($("h3", card), { card: "services", index, field: "title" });
      attach($(":scope > p", card), { card: "services", index, field: "text" });
      $$(".check-list li", card).forEach((li, point) => attach(li.querySelector(":scope > span") || li, { card: "services", index, point }));
    });
    $$("#aiFeatures li").forEach((li, index) => { attach($("h3", li), { card: "ai", index, field: "title" }); attach($("p", li), { card: "ai", index, field: "text" }); });
    $$("#processSteps li").forEach((li, index) => { attach($("h3", li), { card: "process", index, field: "title" }); attach($("p", li), { card: "process", index, field: "text" }); });
    $$("#pricingGrid .price-card").forEach((card, index) => {
      attach($("h3", card), { card: "pricing", index, field: "title" });
      attach($(":scope > p", card), { card: "pricing", index, field: "text" });
      attach($(".ribbon", card), { card: "price", field: "ribbon" });
      attach($(".price-tag", card), { card: "price", field: "price" });
      attach($("a.btn", card), { card: "price", field: "cta" });
      $$(".check-list li", card).forEach((li, point) => attach(li, { card: "pricing", index, point }));
    });
    $$("#faqList details").forEach((d, index) => {
      d.open = true;                        // answers are editable only while visible
      attach($("summary", d), { card: "faq", index, field: "q" });
      attach($(".answer", d), { card: "faq", index, field: "a" });
    });
    $$("#contactDetails li").forEach((li, index) => attach($("small", li), { card: "contact", index, field: "label" }));
    attach($("#archiveTitle"), { i18n: "work.archive.title" });          // the project gallery "Замовні розробки" (data/portfolio.json)
    attach($("#archiveLead"), { i18n: "work.archive.lead" });
    $$("#archiveGrid .archive-card[data-slug]").forEach((card) => {
      const slug = card.dataset.slug;
      attach($(".product-link", card), { i18n: "work.request" });                 // site texts only: the card's own text, years, tags and pictures are the portfolio's (edited there)
      const cat = boot.archiveCategories.indexOf(boot.factoryGallery[slug]?.category);
      if (cat >= 0) attach($(".product-meta .tag:not(.status)", card), { i18n: `work.archive.categories.${cat}.label` });
    });
    $$("#stackGrid .stack-group").forEach((group, gi) => {
      attach($("h3", group), { i18n: `stack.groups.${gi}.title` });
      $$("li", group).forEach((li, ii) => attach(li, { plain: `stack.groups.${gi}.items.${ii}` }));
    });
    $$("#contactDetails li").forEach((li, di) => {
      const path = `contact.details.${di}.value`;
      attach($("a, .val", li), Object.prototype.hasOwnProperty.call(boot.editable, path) ? { i18n: path } : { plain: path });
      attach($(".demo-badge", li), { i18n: "contact.demoBadge" });
    });
    $$("#productGrid .product-card[data-id]").forEach((card) => {
      const id = card.dataset.id;
      attach($("h3", card), { card: "products", id, field: "title" });
      attach($(".product-body > p", card), { card: "products", id, field: "summary" });
      attach($(".tag.status", card), { card: "products", id, field: "status" });
      $$(".chips .chip", card).forEach((chip, index) => attach(chip, { card: "tag", id, index }));
      attach($(".product-link", card), { i18n: "work.request" });
      const cat = boot.categories.findIndex((c) => c.id === C.categoryOf(S.draft, id, boot.factoryProducts));
      if (cat >= 0) attach($(".product-meta .tag:not(.status)", card), { i18n: `work.categories.${cat}.label` });
    });
  }

  function commit(node) {
    const binding = BIND.get(node);
    if (!binding) return;
    const stored = C.writeText(binding, env(), lang(), node.textContent);
    const shown = C.readText(binding, env(), lang());
    $$(`[data-ve-key="${CSS.escape(binding.key)}"]`).forEach((n) => { if (n.textContent !== shown) n.textContent = shown; });      // the same text may appear twice (e.g. the menu button)
    if (stored !== null) markDirty();
  }

  document.addEventListener("focusin", (e) => { const n = e.target.closest?.(".ve-editable"); if (n) n.dataset.veOrig = n.textContent; });
  document.addEventListener("input", (e) => { if (e.target.closest?.(".ve-editable") && !S.typing) { S.typing = true; paintBar(); } });   // "Збережено" must not show while text is being typed
  document.addEventListener("focusout", (e) => { const n = e.target.closest?.(".ve-editable"); if (n) { S.typing = false; commit(n); delete n.dataset.veOrig; paintBar(); } });
  document.addEventListener("keydown", (e) => {
    const n = e.target.closest?.(".ve-editable");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); n?.blur(); save(); return; }
    if (!n) return;
    if (e.key === "Enter") { e.preventDefault(); n.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); n.textContent = n.dataset.veOrig ?? n.textContent; n.blur(); }
    else if (e.key === " ") e.stopPropagation();       // a space inside <summary> must type a space, not toggle the answer
  }, true);

  // The page must not navigate away: links stay put, in-page anchors scroll (the <base> tag would otherwise send them to "/#...").
  document.addEventListener("click", (e) => {
    const target = e.target;
    if (target.closest?.(".ve-ui")) return;
    if (target.closest?.("summary, label")) e.preventDefault();
    const link = target.closest?.("a");
    if (!link) return;
    e.preventDefault();
    const href = link.getAttribute("href") || "";
    if (href.startsWith("#")) (href.length > 1 ? document.getElementById(href.slice(1)) : document.body)?.scrollIntoView({ behavior: "smooth" });
  }, true);
  document.addEventListener("submit", (e) => e.preventDefault(), true);        // the contact form is only shown, never sent from here

  /* ---------- switches, order, media ---------- */
  function setOff(node, off) { node.classList.toggle("ve-off", off); }

  function sectionNode(id) {
    return id === "hero" ? $("section.hero") : id === "trust" ? $("section.trust") : document.getElementById(id);
  }

  function pickMedia(target, kind) {
    return pickerDialog(kind, C.mediaRef(S.draft, target), target.type === "gallerySlot").then(async (ref) => {
      if (ref === null) return;
      C.setMedia(S.draft, target, ref);
      markDirty();
      if (await flush()) reloadKeepingPlace();
    });
  }

  function switchBox(label, target, node) {
    return h("label", { class: "ve-switch", title: "Показувати на сайті" },
      h("input", { type: "checkbox", checked: !C.isOff(S.draft, target), "aria-label": label, onchange: (e) => { C.setEnabled(S.draft, target, e.target.checked); setOff(node, !e.target.checked); markDirty(); } }),
      h("span", {}, label));
  }

  /** The control strip of a section or card. `spec` = {key, fallback} adds the hover/focus/long-press preview and an eye button (preview-tip.js). */
  const barOf = (node, spec, ...kids) => {
    $$(":scope > .ve-bar", node).forEach((b) => b.remove());
    node.classList.add("ve-host");
    const bar = h("div", { class: "ve-ui ve-bar" }, kids.filter(Boolean));
    if (spec && window.VPreview) { VPreview.attach(bar, spec.key, spec.fallback); bar.append(VPreview.eyeButton(bar, spec.key, spec.fallback)); }
    node.append(bar);
  };

  function bindSections() {
    const order = C.effectiveOrder(S.draft);
    for (const id of ["hero", "trust", ...C.MOVABLE]) {
      const node = sectionNode(id);
      if (!node) continue;
      const target = { type: "section", id };
      setOff(node, C.isOff(S.draft, target));
      const at = order.indexOf(id);
      const move = (dir, label) => h("button", {
        class: "ve-btn ve-icon", type: "button", "aria-label": `${label}: ${boot.labels[id] || id}`, title: label, disabled: at < 0 || (dir < 0 ? at === 0 : at === order.length - 1) || null,
        onclick: async () => { if (C.moveSection(S.draft, id, dir)) { markDirty(); if (await flush()) reloadKeepingPlace(); } },
      }, dir < 0 ? "▲" : "▼");
      barOf(node, { key: `section:${id}`, fallback: { title: boot.labels[id] || id } },
        h("span", { class: "ve-name" }, boot.labels[id] || id),
        switchBox("Показувати", target, node),
        id === "hero" ? h("button", { class: "ve-btn", type: "button", onclick: () => pickMedia({ type: "hero" }, "image") }, "Зображення…") : null,
        at >= 0 ? move(-1, "Вгору") : null, at >= 0 ? move(1, "Вниз") : null);
    }
  }

  function bindCards() {
    $$("#serviceGrid .card[data-s]").forEach((card) => {
      const id = C.serviceId(S.draft, Number(card.dataset.s), boot.factory.services);
      if (!id) return;
      const target = { type: "service", id };
      setOff(card, C.isOff(S.draft, target));
      barOf(card, { key: `service:${id.startsWith("x-") ? "custom" : id}`, fallback: { title: $("h3", card)?.textContent.trim() } }, switchBox("Показувати", target, card), h("button", { class: "ve-btn", type: "button", onclick: () => pickMedia({ type: "serviceModel", id }, "model") }, "3D…"));
    });
    $$("#productGrid .product-card[data-id]").forEach((card) => {
      const id = card.dataset.id;
      const target = { type: "project", id };
      setOff(card, C.isOff(S.draft, target));
      barOf(card, { key: `project:${boot.factory.projects.includes(id) ? id : "custom"}`, fallback: { title: $("h3", card)?.textContent.trim() } }, switchBox("Показувати", target, card),
        h("select", { class: "ve-btn", "aria-label": "Категорія картки", title: "Категорія", onchange: async (e) => { C.setCategory(S.draft, id, e.target.value, boot.factoryProducts); markDirty(); if (await flush()) reloadKeepingPlace(); } },
          boot.categories.map((c) => h("option", { value: c.id, selected: c.id === C.categoryOf(S.draft, id, boot.factoryProducts) }, c.label?.[lang()] || c.label?.en || c.id))),
        h("button", { class: "ve-btn", type: "button", onclick: () => pickMedia({ type: "projectImage", id }, "image") }, "Фото…"),
        h("button", { class: "ve-btn", type: "button", onclick: () => pickMedia({ type: "projectModel", id }, "model") }, "3D…"));
    });
  }

  const pageUrl = (page, hash = "") => `${API}?action=edit-page&page=${page}&lang=${lang()}${hash}`;
  const gotoPage = async (url) => { if (await flush()) location.href = url; };
  /** HOME page: the gallery cards only SELECT portfolio items (draft.site.gallery): show/hide and order on the home page. Content is edited in the portfolio. */
  function bindGallery() {
    const shown = boot.homeBase.filter((slug) => $(`#archiveGrid .archive-card[data-slug="${CSS.escape(slug)}"]`));
    $$("#archiveGrid .archive-card[data-slug]").forEach((card) => {
      const slug = card.dataset.slug;
      const target = { type: "gallery", id: slug };
      setOff(card, C.isOff(S.draft, target));
      card.classList.add("ve-pad");
      const at = shown.indexOf(slug);
      const move = (dir, label) => h("button", {
        class: "ve-btn ve-icon", type: "button", "aria-label": `${label}: ${$("h3", card)?.textContent.trim() || slug}`, title: label,
        disabled: at < 0 || (dir < 0 ? at === 0 : at === shown.length - 1) || null,
        onclick: async () => { if (C.moveGallery(S.draft, slug, dir, boot.homeBase, boot.homeBase, "home")) { markDirty(); if (await flush()) reloadKeepingPlace(); } },
      }, dir < 0 ? "▲" : "▼");
      barOf(card, { key: "site:gallery", fallback: { title: $("h3", card)?.textContent.trim() } }, switchBox("На головній", target, card),
        h("a", { class: "ve-btn", href: pageUrl("portfolio", `#${slug}`), title: "Текст, фото й порядок цієї картки редагуються в портфоліо", onclick: (e) => { e.preventDefault(); gotoPage(e.currentTarget.href); } }, "У портфоліо…"),
        at >= 0 ? move(-1, "Вгору") : null, at >= 0 ? move(1, "Вниз") : null);
    });
    $$("#archiveGrid img[src*='/assets/u/']").forEach(fixUploadSrc);
  }

  function fixUploadSrc(img) {            // an uploaded picture is served by the admin's file action, not by a public path
    const m = /\/assets\/u\/([0-9a-f]{16})\./.exec(img.getAttribute("src"));
    if (m) img.setAttribute("src", `${API}?action=file&id=${m[1]}`);
  }

  /** PORTFOLIO page (/portfolio/): the portfolio's own content: texts (data-p), items (switch, order, pictures, title/summary/years/tags), sections (switch). */
  function bindPortfolio() {
    $$("#ppMain [data-p], #ppBar [data-p]").forEach((el) => attach(el, { i18n: el.dataset.p }));
    const cards = $$("#ppMain .arch[data-slug]");
    const all = boot.galleryOrder;
    const order = (S.draft.portfolio.order?.length === all.length ? S.draft.portfolio.order : all).filter((slug) => cards.some((c) => c.dataset.slug === slug));
    cards.forEach((card) => {
      const slug = card.dataset.slug;
      const target = { type: "portfolio", id: slug };
      setOff(card, C.isOff(S.draft, target));
      card.classList.add("ve-pad");
      attach($('[data-f="title"]', card), { card: "gallery", slug, field: "title" });
      attach($('[data-f="summary"]', card), { card: "gallery", slug, field: "summary" });
      attach($('[data-f="years"]', card), { card: "galleryYears", slug });
      $$('[data-f="tag"]', card).forEach((el) => attach(el, { card: "galleryTag", slug, index: Number(el.dataset.i) }));
      const at = order.indexOf(slug);
      const move = (dir, label) => h("button", {
        class: "ve-btn ve-icon", type: "button", "aria-label": `${label}: ${$('[data-f="title"]', card)?.textContent.trim() || slug}`, title: label,
        disabled: at < 0 || (dir < 0 ? at === 0 : at === order.length - 1) || null,
        onclick: async () => { if (C.moveGallery(S.draft, slug, dir, all, all, "portfolio")) { markDirty(); if (await flush()) reloadKeepingPlace(); } },
      }, dir < 0 ? "▲" : "▼");
      const slots = boot.factoryGallery[slug]?.slots || [];
      barOf(card, { key: "portfolio:item", fallback: { title: $('[data-f="title"]', card)?.textContent.trim() } }, switchBox("У портфоліо", target, card),
        ...slots.map((key, i) => h("button", { class: "ve-btn", type: "button", title: `Фото ${i + 1}: ${key}`, "aria-label": `Фото ${i + 1}`, onclick: () => pickMedia({ type: "gallerySlot", id: key }, "image") }, `🖼${i + 1}`)),
        at >= 0 ? move(-1, "Вгору") : null, at >= 0 ? move(1, "Вниз") : null);
    });
    $$("#ppMain img").forEach(fixUploadSrc);
    $$("#ppMain section[data-sec]").forEach((sec) => {
      const target = { type: "ppsection", id: sec.dataset.sec };
      setOff(sec, C.isOff(S.draft, target));
      const title = boot.portfolioSections.find((x) => x.id === sec.dataset.sec)?.title;
      barOf(sec, { key: "portfolio:section", fallback: { title: title?.[lang()] || title?.en || sec.dataset.sec } }, h("span", { class: "ve-name" }, sec.dataset.sec), switchBox("У портфоліо й PDF", target, sec));
    });
    if (location.hash.length > 1 && !bindPortfolio.focused) {
      bindPortfolio.focused = true;
      document.querySelector(`#ppMain .arch[data-slug="${CSS.escape(location.hash.slice(1))}"]`)?.scrollIntoView({ block: "center" });
    }
  }

  /* ---------- texts that cannot be edited in place ---------- */
  // Filter buttons (a click filters), <option>s of the form, the "3D" badge, the skip link, ARIA/theme labels and the page title/description are not editable where they sit.
  const OTHER = /^(?:ui\.|meta\.|nav\.|work\.(?:all|categories\.\d+\.label|archive\.(?:all|categories\.\d+\.label))$|contact\.form\.(?:types|attachErrors)\.)/;
  function otherTexts() {
    const dlg = h("dialog", { class: "ve-ui ve-dialog", "aria-label": "Інші тексти" });
    const rows = Object.keys(boot.editable).filter((path) => OTHER.test(path)).map((path) => {
      const b = C.bindingFor({ i18n: path }, env());
      return h("label", { class: "ve-field" }, h("span", { class: "ve-note" }, path),
        h("input", { type: "text", value: C.readText(b, env(), lang()), onchange: (e) => { if (C.writeText(b, env(), lang(), e.target.value) !== null) markDirty(); } }));
    });
    dlg.append(h("h3", {}, "Інші тексти"), h("p", { class: "ve-note" }, `Мова: ${lang().toUpperCase()}. Підписи фільтрів, пункти списку форми, позначка 3D, інтерфейсні підписи, назва й опис сторінки.`),
      h("div", { class: "ve-fields" }, rows), h("div", { class: "ve-row" }, h("button", { class: "ve-btn", type: "button", onclick: () => dlg.close() }, "Готово")));
    dlg.addEventListener("close", async () => { dlg.remove(); if (S.dirty && await flush()) reloadKeepingPlace(); });
    document.body.append(dlg);
    dlg.showModal();
  }

  /* ---------- the picker dialog ---------- */
  function pickerDialog(kind, current, uploadsOnly) {
    return new Promise((resolve) => {
      let result = null;
      const dlg = h("dialog", { class: "ve-ui ve-dialog", "aria-label": kind === "image" ? "Вибір зображення" : "Вибір 3D-моделі" });
      const grid = h("div", { class: "ve-grid" });
      const msg = h("p", { class: "ve-note ve-warn", hidden: true, role: "alert" });
      const pick = (ref) => { result = ref; dlg.close(); };
      const paint = () => grid.replaceChildren(
        h("button", { class: "ve-tile", type: "button", onclick: () => pick("") }, h("span", { class: "ve-thumb" }, "—"), h("span", {}, "Заводський варіант")),
        ...C.pickerItems(kind, boot, uploadsOnly).map((item) => h("button", { class: `ve-tile${item.ref === current ? " ve-sel" : ""}`, type: "button", onclick: () => pick(item.ref) },
          kind === "image" ? h("img", { class: "ve-thumb", src: C.imageSrc(item.ref, API), alt: "" }) : h("span", { class: "ve-thumb" }, "3D"), h("span", {}, item.label))));
      const input = h("input", { type: "file", accept: kind === "image" ? "image/jpeg,image/png,image/webp,image/avif" : ".glb,model/gltf-binary", "aria-label": "Завантажити новий файл" });
      input.addEventListener("change", async () => {
        const file = input.files[0];
        if (!file) return;
        msg.hidden = true;
        try {
          const r = await call("upload", { method: "POST", raw: file, query: `&name=${encodeURIComponent(file.name)}` });
          boot.uploads = r.uploads;
          pick(r.item.ref);
        } catch (e) { msg.textContent = e.message; msg.hidden = false; }
      });
      dlg.append(h("h3", {}, kind === "image" ? "Оберіть зображення" : "Оберіть 3D-модель (.glb)"),
        h("p", { class: "ve-note" }, kind === "image" ? "JPEG, PNG, WebP або AVIF до 5 МБ. SVG не приймається." : "Один файл glTF Binary (.glb) до 8 МБ, дані вбудовані у файл."),
        h("label", { class: "ve-upload" }, h("span", {}, "Завантажити новий файл"), input), msg, grid,
        h("div", { class: "ve-row" }, h("button", { class: "ve-btn", type: "button", onclick: () => dlg.close() }, "Скасувати")));
      dlg.addEventListener("close", () => { dlg.remove(); resolve(result); });
      paint();
      document.body.append(dlg);
      dlg.showModal();
    });
  }

  /* ---------- wiring ---------- */
  let queued = false;
  function refresh() {
    queued = false;
    bindTexts();
    bindSections();
    bindCards();
    if (boot.page === "portfolio") bindPortfolio(); else bindGallery();
  }
  const schedule = () => { if (!queued) { queued = true; queueMicrotask(refresh); } };

  document.body.append(bar);
  paintBar();
  document.addEventListener("viteh:render", schedule);
  for (const sel of ["#productGrid", "#serviceGrid", "#archiveGrid"]) {            // the category filter re-creates the project cards without a render event
    const grid = $(sel);
    if (grid) new MutationObserver(schedule).observe(grid, { childList: true });
  }
  if (boot.page === "portfolio") { const main = $("#ppMain"); if (main) new MutationObserver(schedule).observe(main, { childList: true }); schedule(); }
  if (window.vitehRender) refresh();
  refreshProblems();
  const y = Number(store.get("ve.scroll"));
  if (y > 0) { store.del("ve.scroll"); requestAnimationFrame(() => window.scrollTo(0, y)); }
})();
