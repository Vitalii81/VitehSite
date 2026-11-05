"use strict";
// ViTeh admin UI. Plain DOM, no dependencies, no innerHTML: every value is inserted as text.
// The draft lives in memory, is saved (debounced) with its revision number, and the server re-sanitises everything it receives.

const API = "/cgi-bin/vadmin-api";
const LANGS = ["uk", "en", "de"];
const S = { draft: null, catalog: null, status: null, uploads: [], builds: [], view: { name: "sections" }, save: "saved", timer: null, saving: null, conflict: false };

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "value") node.value = v;
    else if (k === "checked") node.checked = !!v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return node;
};
const uid = (prefix = "") => prefix + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
const clone = (v) => JSON.parse(JSON.stringify(v));
const uk = (v) => (v && (v.uk || v.en || v.de)) || "";
const filled = (v) => LANGS.some((l) => (v?.[l] || "").trim());
const partial = (v) => filled(v) && LANGS.some((l) => !(v?.[l] || "").trim());

async function api(action, { method = "GET", body, raw, headers = {}, query = "" } = {}) {
  const init = { method, headers: { "X-Vadmin": "1", ...headers }, credentials: "same-origin" };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }
  const response = await fetch(`${API}?action=${action}${query}`, init);
  const data = await response.json().catch(() => ({ ok: false, error: "bad_response", message: "Сервер повернув неочікувану відповідь" }));
  if (response.status === 401 && action !== "login") { showLogin(); throw Object.assign(new Error("auth"), { handled: true }); }
  if (!response.ok) throw Object.assign(new Error(data.message || data.error), { data, status: response.status });
  return data;
}

function toast(text, kind = "ok", ms = 4000) {
  const node = h("div", { class: `msg ${kind} toast`, role: "status" }, text);
  document.body.append(node);
  setTimeout(() => node.remove(), ms);
}
const fail = (e) => { if (!e.handled) toast(e.message || "Помилка", "err", 7000); };

/* ---------- saving ---------- */
function touch() {
  S.save = "dirty";
  updateChips();
  clearTimeout(S.timer);
  S.timer = setTimeout(save, 700);
}

async function save() {
  clearTimeout(S.timer);
  if (S.save !== "dirty") return S.saving;
  S.save = "saving";
  updateChips();
  S.saving = api("save", { method: "POST", body: { draft: S.draft, rev: S.draft.rev } }).then((r) => {
    S.draft.rev = r.rev;
    if (S.save === "saving") S.save = "saved";
    return refreshStatus();
  }).catch((e) => {
    S.save = "error";
    if (e.data?.error === "conflict") { S.conflict = true; toast("Чернетку змінено в іншій вкладці. Оновіть сторінку (F5).", "err", 12000); } else fail(e);
  }).finally(updateChips);
  return S.saving;
}

async function refreshStatus() {
  const r = await api("status");
  S.status = r.status; S.builds = r.builds;
  updateChips();
}

window.addEventListener("beforeunload", (e) => { if (S.save === "dirty" || S.save === "saving") { e.preventDefault(); e.returnValue = ""; } });

/* ---------- login ---------- */
function showLogin(message) {
  const input = h("input", { type: "password", autocomplete: "current-password", id: "pass", "aria-label": "Фраза входу" });
  const box = h("div", { class: "msg err", hidden: true });
  const form = h("form", { class: "login", onsubmit: async (e) => {
    e.preventDefault();
    box.hidden = true;
    try { await api("login", { method: "POST", body: { passphrase: input.value } }); input.value = ""; start(); }
    catch (err) { box.textContent = err.message; box.hidden = false; }
  } }, h("h1", {}, "ViTeh · адмінка"), h("p", { class: "muted" }, "Приватний доступ. Введіть фразу входу."), input, box,
  h("button", { class: "btn primary", type: "submit" }, "Увійти"));
  if (message) { box.textContent = message; box.hidden = false; }
  $("#app").replaceChildren(form);
  input.focus();
}

/* ---------- shell ---------- */
const NAV = [
  ["Головна сторінка", [["sections", "Розділи"], ["services", "Послуги"], ["ideas", "Каталог ідей"], ["projects", "Картки проєктів"], ["home-blocks", "Додаткові розділи"], ["widgets", "Віджети й ефекти"]]],
  ["Портфоліо", [["portfolio", "Елементи портфоліо"], ["portfolio-page", "Сторінка й PDF: розділи, тексти"]]],
  ["Вміст", [["texts", "Тексти (uk/en/de)"], ["pages", "Сторінки"], ["forms", "Форми"], ["files", "Файли"]]],
  ["Помічник", [["assistant", "Бот-помічник: база знань і фільтр"]]],
  ["Випуск", [["builds", "Версії й публікація"]]],
];

function updateChips() {
  const box = $("#chips");
  if (!box || !S.status) return;
  const saveText = { saved: "Збережено", dirty: "Є незбережені зміни…", saving: "Зберігаю…", error: "Помилка збереження" }[S.save];
  const st = S.status;
  box.replaceChildren(
    h("span", { class: `chip ${S.save === "error" ? "err" : S.save === "saved" ? "" : "warn"}` }, `Чернетка: ${saveText}`),
    h("span", { class: `chip ${st.built && st.changedSinceBuild ? "warn" : ""}` }, st.built ? `Зібрано: ${st.built}${st.changedSinceBuild ? " (є зміни після збірки)" : ""}` : "Ще не зібрано"),
    h("span", { class: "chip" }, st.published ? `Опубліковано: ${st.published}` : "Опубліковано: —"),
  );
  const build = $("#btn-build"); if (build) build.disabled = S.conflict;
  const prev = $("#btn-preview"); if (prev) { prev.href = st.built ? st.previewUrl : "#"; prev.toggleAttribute("aria-disabled", !st.built); }
}

function shell() {
  const side = h("nav", { class: "side", "aria-label": "Розділи адмінки" }, NAV.map(([title, items]) => [h("h2", {}, title), items.map(([id, label]) => h("button", {
    type: "button", "data-view": id, onclick: () => go(id),
  }, label))]));
  $("#app").replaceChildren(
    h("header", { class: "top" }, h("h1", {}, "ViTeh · адмінка"), h("div", { class: "chips", id: "chips" }),
      h("div", { class: "actions" },
        h("a", { class: "btn", id: "btn-preview", target: "_blank", rel: "noopener", href: "#", onclick: (e) => { if (!S.status.built) { e.preventDefault(); toast("Спершу зберіть пакет", "warn"); } } }, "Перегляд"),
        h("a", { class: "btn", id: "btn-edit", target: "_blank", rel: "noopener", href: `${API}?action=edit-page`, title: "Та сама головна сторінка з елементами керування: тексти, розділи, картки, зображення, порядок",
          onclick: async (e) => { if (S.save === "saved") return; e.preventDefault(); await save(); window.open(e.currentTarget.href, "_blank", "noopener"); } }, "Редагувати на сторінці"),
        h("button", { class: "btn primary", id: "btn-build", type: "button", onclick: buildNow }, "Зібрати пакет"),
        h("button", { class: "btn", type: "button", onclick: () => go("builds") }, "Відкотити…"),
        h("button", { class: "btn", type: "button", onclick: async () => { await save(); try { await api("logout", { method: "POST", body: {} }); } catch { /* ignore */ } showLogin(); } }, "Вийти"))),
    h("div", { class: "layout" }, side, h("main", { class: "main", id: "main", tabindex: "-1" })));
  updateChips();
}

function go(name, arg) {
  S.view = { name, arg };
  document.querySelectorAll(".side button").forEach((b) => { if (b.dataset.view === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  const main = $("#main");
  main.replaceChildren();
  (VIEWS[name] || VIEWS.sections)(main, arg);
  main.scrollTo?.(0, 0); window.scrollTo(0, 0);
}
const rerender = () => go(S.view.name, S.view.arg);

/* ---------- reusable editors ---------- */
const head = (title, lead) => [h("h2", {}, title), lead ? h("p", { class: "lead" }, lead) : null].filter(Boolean);
/** Hover / focus / long-press preview (preview-tip.js) on `node`, plus an eye button for touch and keyboard users. Returns the button to place in the row. */
const preview = (node, key, fallback) => { VPreview.attach(node, key, fallback); return VPreview.eyeButton(node, key, fallback); };
/** The top row of a card: the given controls and the eye button; the whole row is the hover/focus target (not the card, whose fields would pop it up while typing). */
const cardHead = (key, fallback, ...controls) => { const row = h("div", { class: "row between" }); row.append(...controls.flat(), preview(row, key, fallback)); return row; };
const toggle = (label, checked, onchange, extra) => h("label", { class: "switch" }, h("input", { type: "checkbox", checked, onchange: (e) => { onchange(e.target.checked); touch(); } }), label, extra);

function i18nField(obj, key, { multiline = false, max = 400, label } = {}) {
  obj[key] ||= { uk: "", en: "", de: "" };
  const value = obj[key];
  const wrap = h("div", { class: "field" });
  const rows = h("div", { class: "langs" });
  const paint = () => {
    rows.querySelectorAll(".lang-row").forEach((r) => r.classList.toggle("empty", filled(value) && !(value[r.dataset.lang] || "").trim()));
    note.textContent = partial(value) ? "⚠ не всі мови заповнені: порожні мови покажуть англійський або інший наявний текст" : "";
  };
  const note = h("span", { class: "partial" });
  for (const lang of LANGS) {
    const control = multiline
      ? h("textarea", { maxlength: max, "aria-label": `${label || key} (${lang})`, value: value[lang] || "" })
      : h("input", { type: "text", maxlength: max, "aria-label": `${label || key} (${lang})`, value: value[lang] || "" });
    control.addEventListener("input", () => { value[lang] = control.value; paint(); touch(); });
    rows.append(h("div", { class: "lang-row", "data-lang": lang }, h("b", {}, lang), control));
  }
  wrap.append(...[label ? h("label", {}, label) : null, rows, note].filter(Boolean));
  paint();
  return wrap;
}

const textField = (obj, key, label, max = 200) => h("div", { class: "field" }, label ? h("label", {}, label) : null,
  h("input", { type: "text", maxlength: max, value: obj[key] || "", oninput: (e) => { obj[key] = e.target.value; touch(); } }));

function imageUrl(ref) {
  if (!ref) return "";
  if (ref.startsWith("u:")) return `${API}?action=file&id=${ref.slice(2)}`;
  return `/site-assets/${ref.replace(/^assets\//, "")}`;
}

function imageField(obj, key, label, kind = "image") {
  const holder = h("div", { class: "row" });
  const paint = () => {
    const ref = obj[key] || "";
    holder.replaceChildren(...[
      kind === "image" && ref ? h("img", { class: "thumb", src: imageUrl(ref), alt: "" }) : null,
      h("span", { class: "muted mono" }, ref ? (ref.startsWith("u:") ? (S.uploads.find((u) => u.ref === ref)?.name || ref) : ref) : (kind === "model" ? "заводська модель або немає" : "не вибрано")),
      h("button", { class: "btn small", type: "button", onclick: async () => { const r = await pickFile(kind, ref); if (r !== null) { obj[key] = r; touch(); paint(); } } }, "Обрати…"),
      ref ? h("button", { class: "btn small", type: "button", onclick: () => { obj[key] = ""; touch(); paint(); } }, "Прибрати") : null].filter(Boolean));
  };
  paint();
  return h("div", { class: "field" }, label ? h("label", {}, label) : null, holder);
}

function pickFile(kind, current) {
  return new Promise((resolve) => {
    const dlg = h("dialog", { "aria-label": "Вибір файлу" });
    let result = null;
    const grid = h("div", { class: "grid" });
    const msg = h("div", { class: "msg err", hidden: true });
    const pick = (ref) => { result = ref; dlg.close(); };
    const paint = () => {
      grid.replaceChildren(
        h("button", { class: "tile", type: "button", onclick: () => pick("") }, h("span", { class: "muted" }, "—"), "Без файлу"),
        ...(kind === "image" ? S.catalog.factoryImages.map((ref) => h("button", { class: `tile${ref === current ? " sel" : ""}`, type: "button", onclick: () => pick(ref) },
          h("img", { class: "thumb", src: imageUrl(ref), alt: "" }), h("span", { class: "mono" }, ref.replace("assets/", "")))) : []),
        ...S.uploads.filter((u) => u.kind === kind).map((u) => h("button", { class: `tile${u.ref === current ? " sel" : ""}`, type: "button", onclick: () => pick(u.ref) },
          kind === "image" ? h("img", { class: "thumb", src: imageUrl(u.ref), alt: "" }) : h("span", { class: "thumb", style: "display:grid;place-items:center" }, "3D"), h("span", { class: "mono" }, u.name))));
    };
    const file = h("input", { type: "file", accept: kind === "image" ? "image/jpeg,image/png,image/webp,image/avif" : ".glb,model/gltf-binary", onchange: async () => {
      msg.hidden = true;
      if (!file.files[0]) return;
      try { const r = await uploadFile(file.files[0]); pick(r.item.ref); } catch (e) { msg.textContent = e.message; msg.hidden = false; }
    } });
    dlg.append(h("h3", {}, kind === "image" ? "Оберіть зображення" : "Оберіть 3D-модель (.glb)"),
      h("p", { class: "muted" }, kind === "image" ? "JPEG, PNG, WebP або AVIF до 5 МБ. SVG не приймається." : "Один файл glTF Binary (.glb) до 8 МБ, дані вбудовані в файл."),
      h("div", { class: "field" }, h("label", {}, "Завантажити новий файл"), file), msg, grid,
      h("div", { class: "row", style: "margin-top:14px" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Скасувати")));
    dlg.addEventListener("close", () => { dlg.remove(); resolve(result); });
    paint();
    document.body.append(dlg);
    dlg.showModal();
  });
}

async function uploadFile(file) {
  const r = await api("upload", { method: "POST", raw: file, query: `&name=${encodeURIComponent(file.name)}`, headers: { "Content-Type": "application/octet-stream" } });
  S.uploads = r.uploads;
  await VTwin.attach(file, r.item, (query, blob) => api("upload", { method: "POST", raw: blob, query, headers: { "Content-Type": "application/octet-stream" } }));      // JPEG twin of a WebP (PDF only)
  return r;
}

/* ---------- block editor (pages and extra home sections) ---------- */
function newBlock(type) {
  return { id: uid("b-"), type, enabled: true, anchor: "", fields: clone(S.catalog.blocks[type].example) };
}

function fieldEditor(spec, values) {
  const label = uk(spec.label) + (spec.required ? " *" : "");
  switch (spec.type) {
    case "text": return i18nField(values, spec.key, { max: spec.max || 200, label });
    case "longtext": return i18nField(values, spec.key, { multiline: true, max: spec.max || 800, label });
    case "plain": return textField(values, spec.key, label, spec.max || 200);
    case "bool": return h("div", { class: "field" }, toggle(uk(spec.label), !!values[spec.key], (v) => { values[spec.key] = v; }));
    case "select": return h("div", { class: "field" }, h("label", {}, label), h("select", { onchange: (e) => { values[spec.key] = e.target.value; touch(); } },
      spec.options.map((o) => h("option", { value: o, selected: values[spec.key] === o }, spec.key === "icon" ? o : ({ right: "праворуч", left: "ліворуч", line: "лінія", space: "відступ", dots: "крапки" }[o] || o)))));
    case "image": return imageField(values, spec.key, label);
    case "link": {
      values[spec.key] ||= { text: { uk: "", en: "", de: "" }, href: "" };
      return h("div", { class: "field" }, h("label", {}, label), h("div", { class: "sub" },
        i18nField(values[spec.key], "text", { max: 60, label: "Текст кнопки" }),
        textField(values[spec.key], "href", "Адреса (/s/сторінка/, #якір, https://…, mailto:…)", 300)));
    }
    case "form": return h("div", { class: "field" }, h("label", {}, label), h("select", { onchange: (e) => { values[spec.key] = e.target.value; touch(); } },
      h("option", { value: "" }, "— оберіть форму —"), Object.entries(S.draft.forms).map(([id, f]) => h("option", { value: id, selected: values[spec.key] === id }, uk(f.title) || id))));
    case "list": return listEditor(spec, values);
    default: return null;
  }
}

function listEditor(spec, values) {
  const items = (values[spec.key] ||= []);
  const box = h("div", { class: "field" }, h("label", {}, uk(spec.label) + (spec.required ? " *" : "")));
  const body = h("div", { class: "stack" });
  const paint = () => {
    body.replaceChildren(...items.map((item, i) => h("div", { class: "card" },
      h("div", { class: "block-head" }, h("span", { class: "title" }, `#${i + 1}`),
        h("button", { class: "btn small", type: "button", disabled: i === 0, "aria-label": "Вгору", onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; touch(); paint(); } }, "↑"),
        h("button", { class: "btn small", type: "button", disabled: i === items.length - 1, "aria-label": "Вниз", onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; touch(); paint(); } }, "↓"),
        h("button", { class: "btn small danger", type: "button", onclick: () => { items.splice(i, 1); touch(); paint(); } }, "Видалити")),
      h("div", { class: "block-body" }, spec.fields.map((f) => fieldEditor(f, item))))),
    items.length < (spec.max || 20) ? h("button", { class: "btn small", type: "button", onclick: () => { items.push(blankItem(spec.fields)); touch(); paint(); } }, "+ Додати елемент") : null);
  };
  paint();
  box.append(body);
  return box;
}

function blankItem(fields) {
  const o = {};
  for (const f of fields) o[f.key] = f.type === "list" ? [] : f.type === "bool" ? false : f.type === "link" ? { text: { uk: "", en: "", de: "" }, href: "" } : ["text", "longtext"].includes(f.type) ? { uk: "", en: "", de: "" } : f.type === "select" ? f.options[0] : "";
  return o;
}

function blockEditor(blocks, { onChange } = {}) {
  const wrap = h("div", { class: "stack" });
  const open = new Set();
  let dragged = null;
  const paint = () => {
    wrap.replaceChildren(...blocks.map((b, i) => {
      const spec = S.catalog.blocks[b.type];
      const card = h("div", { class: `card${b.enabled ? "" : " off"}`, draggable: "true" });
      card.addEventListener("dragstart", (e) => { dragged = i; e.dataTransfer.effectAllowed = "move"; });
      card.addEventListener("dragover", (e) => { if (dragged !== null) { e.preventDefault(); card.classList.add("drop-before"); } });
      card.addEventListener("dragleave", () => card.classList.remove("drop-before"));
      card.addEventListener("drop", (e) => { e.preventDefault(); card.classList.remove("drop-before"); if (dragged !== null && dragged !== i) { const [m] = blocks.splice(dragged, 1); blocks.splice(i, 0, m); dragged = null; touch(); paint(); } });
      card.addEventListener("dragend", () => { dragged = null; });
      const move = (d) => () => { const j = i + d; [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; touch(); paint(); };
      const isOpen = open.has(b.id);
      const headRow = h("div", { class: "block-head" });
      headRow.append(
        h("span", { class: "title", onclick: () => { isOpen ? open.delete(b.id) : open.add(b.id); paint(); } }, `${isOpen ? "▾" : "▸"} ${uk(spec.label)}`, h("span", { class: "muted" }, ` — ${blockSummary(b, spec)}`)),
        toggle("Увімкнено", b.enabled, (v) => { b.enabled = v; paint(); }),
        h("button", { class: "btn small", type: "button", disabled: i === 0, "aria-label": "Блок вгору", onclick: move(-1) }, "↑"),
        h("button", { class: "btn small", type: "button", disabled: i === blocks.length - 1, "aria-label": "Блок вниз", onclick: move(1) }, "↓"),
        h("button", { class: "btn small", type: "button", onclick: () => { const c = clone(b); c.id = uid("b-"); blocks.splice(i + 1, 0, c); touch(); paint(); } }, "Дублювати"),
        h("button", { class: "btn small danger", type: "button", onclick: () => { if (confirm("Видалити блок?")) { blocks.splice(i, 1); touch(); paint(); } } }, "Видалити"),
        preview(headRow, `block:${b.type}`, { title: uk(spec.label) }));
      card.append(headRow);
      if (isOpen) {
        card.append(h("div", { class: "block-body" }, spec.fields.map((f) => fieldEditor(f, b.fields)),
          textField(b, "anchor", "Якір (необов'язково, a-z, 0-9, «-»): на нього можна вести посилання як #якір", 40)));
      }
      return card;
    }), addBlockControl(blocks, paint, open));
    onChange?.();
  };
  paint();
  return wrap;
}

function blockSummary(b, spec) {
  const first = spec.fields.find((f) => ["text", "longtext"].includes(f.type));
  const text = first ? uk(b.fields[first.key]) : "";
  return text.length > 60 ? text.slice(0, 57) + "…" : (text || "без назви");
}

function addBlockControl(blocks, paint, open) {
  const select = h("select", { "aria-label": "Тип блока" }, Object.entries(S.catalog.blocks).map(([type, spec]) => h("option", { value: type }, uk(spec.label))));
  const row = h("div", { class: "row" });
  const key = () => `block:${select.value}`;
  VPreview.attach(select, key, {});         // the pop-up follows the selected type; the eye button shows it on touch screens and from the keyboard
  select.addEventListener("change", () => { if (VPreview.isOpen()) VPreview.hide(); });
  row.append(select, VPreview.eyeButton(select, key, {}, "тип блока"), h("button", { class: "btn", type: "button", onclick: () => {
    const b = newBlock(select.value); blocks.push(b); open.add(b.id); touch(); paint();
  } }, "+ Додати блок"));
  return row;
}

/* ---------- views ---------- */
/* The assistant's avatar choices: previews use the site's own files (/site-assets/assistant-avatars.js and assistant.css), so they are exactly what visitors see. */
const ASSET_V = (() => { try { return new URL(document.currentScript.src).searchParams.get("v") || ""; } catch { return ""; } })();          // the install stamp of admin.js: a new URL per install, so Cloudflare and the browser never serve stale site files
const siteAsset = (name) => `/site-assets/${name}${ASSET_V ? `?v=${encodeURIComponent(ASSET_V)}` : ""}`;
let avatarAssets = null;
const loadAvatarAssets = () => avatarAssets ||= new Promise((resolve) => {
  const css = h("link", { rel: "stylesheet", href: siteAsset("assistant.css") });
  const js = h("script", { src: siteAsset("assistant-avatars.js") });
  js.addEventListener("load", () => resolve(true)); js.addEventListener("error", () => resolve(false));
  document.head.append(css, js);
});
/* The nine states of the full set: [name, own file name, the basic pose it falls back to]. */
const NINE_STATES = [["idle", "idle", null], ["greeting", "greeting", "wave"], ["talking", "talking", "talk"], ["listening", "listening", "nod"], ["thinking", "thinking", "think"],
  ["happy", "happy", "wave"], ["respect", "respect", "nod"], ["presenting", "presenting", "present"], ["goodbye", "goodbye", "wave"]];   // a pack may also use the six basic file names (wave, nod, think, talk, present)
const avatarPicker = (A) => {
  const box = h("div", { class: "avatar-grid" });
  const fill = () => {
    const set = window.VITEH_AVATARS;
    if (!set) { box.replaceChildren(h("p", { class: "muted" }, "Не вдалося завантажити аватари (файл site-assets/assistant-avatars.js).")); return; }
    box.replaceChildren(...set.order.map((id) => {
      const holder = h("div", { class: "avatar-preview" });
      const uid = "p" + id.replace(/[^a-z]/g, "");
      holder.innerHTML = '<svg class="asst-av" viewBox="0 0 120 120" aria-hidden="true">' + set.items[id].svg.replace(/id="([a-z]+)"/g, `id="$1${uid}"`).replace(/url\(#([a-z]+)\)/g, `url(#$1${uid})`) + "</svg>";   // static markup shipped with the site
      const svg = holder.firstChild;
      const choose = () => { A.avatar = id; touch(); fill(); };
      return h("button", { type: "button", class: "avatar-card" + (A.avatar === id ? " on" : ""), "aria-pressed": String(A.avatar === id), onclick: choose,
        onmouseenter: () => svg.setAttribute("data-mood", "wave"), onmouseleave: () => svg.setAttribute("data-mood", "idle") }, holder, h("span", {}, set.items[id].name.uk));
    }));
  };
  loadAvatarAssets().then(fill);
  const mine = h("div", { class: "avatar-custom" });
  const frameUrl = (ref) => `${API}?action=file&id=${encodeURIComponent(String(ref).slice(2))}`;
  const paintMine = () => {
    const list = (A.customAvatars ||= []);
    const input = h("input", { type: "file", accept: ".zip,image/png,image/jpeg,image/webp,image/avif", hidden: true });
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const r = await api("avatar-upload", { method: "POST", raw: file, query: `&name=${encodeURIComponent(file.name)}`, headers: { "Content-Type": "application/octet-stream" } });
        S.uploads = r.uploads;
        list.push(...r.avatars);                                               // an import ADDS: nothing already in the library is replaced
        A.avatar = "custom-" + r.avatars[0].id;
        touch(); fill(); paintMine();
        toast("Додано аватарів: " + r.avatars.length + " (" + r.avatars.map((c) => c.name).join(", ") + "). Перший обрано");
      } catch (e) { fail(e); }
    });
    const card = (c) => {
      const id = "custom-" + c.id, on = A.avatar === id, frames = c.frames;
      const strip = h("div", { class: "row", style: "gap:6px;margin-top:6px" }, ...NINE_STATES.map(([state, own, base]) => {
        const ref = frames[own] || frames[base] || frames.idle;                      // the widget does the same: own picture, else the basic pose, else idle
        const mine = frames[own] || (base && frames[base]);
        return h("figure", { style: "margin:0;text-align:center" + (mine ? "" : ";opacity:.5"), title: mine ? state : state + " = " + (frames[base] ? base : "idle") },
          h("img", { src: frameUrl(ref), alt: state, style: "width:48px;height:48px;object-fit:cover;object-position:50% 12%;border-radius:10px;background:#dff3ee" }),
          h("figcaption", { class: "muted", style: "font-size:11px" }, state));
      }));
      const visemes = Object.keys(frames).filter((k) => k.startsWith("viseme_")).map((k) => k.slice(7));
      return h("div", { class: "card", style: "margin-top:8px" + (on ? ";outline:2px solid var(--accent)" : "") },
        h("div", { class: "row", style: "align-items:center;gap:8px" },
          h("input", { type: "text", value: c.name, maxlength: "40", "aria-label": "Назва аватара", style: "flex:1;min-width:120px", oninput: (e) => { c.name = e.target.value; touch(); } }),
          h("select", { "aria-label": "Голос озвучення", onchange: (e) => { c.voice = e.target.value; touch(); } }, ...[["female", "голос жіночий"], ["male", "голос чоловічий"]].map(([v, l]) => h("option", { value: v, selected: c.voice === v }, l))),
          h("button", { class: `btn${on ? " primary" : ""}`, type: "button", onclick: () => { A.avatar = id; touch(); fill(); paintMine(); } }, on ? "Обрано" : "Обрати"),
          h("button", { class: "btn", type: "button", onclick: () => {
            if (!confirm(`Видалити аватар «${c.name}»? Файли лишаються серед завантажень.`)) return;
            A.customAvatars = list.filter((x) => x !== c);
            if (on) A.avatar = "consultant-f";
            touch(); fill(); paintMine();
          } }, "Видалити")),
        strip,
        visemes.length || frames.mouth_open ? h("p", { class: "muted", style: "margin:6px 0 0" }, (visemes.length ? "Форми рота під час мовлення: " + visemes.join(", ") + ". " : "") + (frames.mouth_open ? "Є шар відкритого рота." : "")) : null);
    };
    mine.replaceChildren(
      h("h3", { style: "margin:14px 0 6px" }, "Мої аватари"),
      h("p", { class: "muted" }, "Кожен імпорт додає нові аватари до списку, нічого не замінюючи. Одна картинка (PNG, JPEG, WebP, AVIF; SVG не приймається) або ZIP з картинками на стани: idle, greeting, talking, listening, thinking, happy, respect, presenting, goodbye (або старі короткі назви wave, nod, think, talk, present) і за бажанням форми рота viseme_closed, viseme_narrow, viseme_round, viseme_open, viseme_wide чи один шар mouth_open. Потрібен лише idle: стан без власної картинки бере найближчу (напівпрозорі на картках). ZIP з папками male і female дає одразу два аватари. На сайті аватар у заокругленій рамці, сама рамка не рухається."),
      h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => input.click() }, "Додати файл або ZIP"), input),
      ...(list.length ? list.map(card) : [h("p", { class: "muted" }, "Власних аватарів ще немає.")]));
  };
  paintMine();
  return h("div", { class: "card" }, h("p", { class: "muted" }, "Вигляд помічника на сайті: кнопка в кутку і шапка чату. Усі варіанти рухаються однаково (привітання, кивок, думає, говорить). Наведіть курсор, щоб побачити привітання. Зміна потрапить на сайт після збірки й публікації (вибір готового вигляду можна застосувати кнопкою нижче без публікації)."), box, mine);
};

const VIEWS = {
  sections(main) {
    main.append(...head("Розділи головної сторінки", "Вимкнений розділ не потрапляє в HTML публічного сайту."));
    for (const s of S.catalog.sections) {
      const on = S.draft.sections[s.id] !== false;
      const card = h("div", { class: `card${on ? "" : " off"}` });
      card.append(cardHead(`section:${s.id}`, { title: s.label }, toggle(s.label, on, (v) => { S.draft.sections[s.id] = v; card.classList.toggle("off", !v); })));
      if (s.id === "hero") card.append(h("div", { style: "margin-top:10px" }, imageField(S.draft.images, "hero", "Картинка першого екрана (замість ілюстрації)")));
      main.append(card);
    }
  },

  services(main) {
    main.append(...head("Послуги", "Вмикайте й вимикайте послуги, додавайте власні з шаблону. Тексти заводських послуг редагуються в розділі «Тексти»."));
    for (const s of S.catalog.factory.services) {
      S.draft.images.serviceModels ||= {};
      S.draft.images.serviceModels[s.id] ??= "";
      const card = h("div", { class: "card" });
      card.append(cardHead(`service:${s.id}`, { title: uk(s.title), text: uk(s.text) }, toggle(`${uk(s.title)}`, !S.draft.disabled.services.includes(s.id), (v) => setDisabled("services", s.id, !v))),
        h("div", { style: "margin-top:10px" }, imageField(S.draft.images.serviceModels, s.id, s.model ? "Замінити 3D-модель послуги (.glb)" : "Додати 3D-модель послуги (.glb)", "model")));
      main.append(card);
    }
    S.draft.extra.services.forEach((s, i) => {
      const card = h("div", { class: "card" });
      main.append(card);
      card.append(cardHead("service:custom", { title: uk(s.title) || "Нова послуга" },
        toggle(uk(s.title) || "Нова послуга", !S.draft.disabled.services.includes(s.id), (v) => setDisabled("services", s.id, !v)),
        h("button", { class: "btn small danger", type: "button", onclick: () => { if (confirm("Видалити послугу?")) { S.draft.extra.services.splice(i, 1); touch(); rerender(); } } }, "Видалити")),
      h("div", { class: "block-body", style: "margin-top:12px" },
        h("div", { class: "field" }, h("label", {}, "Іконка"), h("select", { onchange: (e) => { s.icon = e.target.value; touch(); } }, S.catalog.icons.map((x) => h("option", { value: x, selected: s.icon === x }, x)))),
        i18nField(s, "title", { max: 80, label: "Назва" }), i18nField(s, "text", { multiline: true, max: 300, label: "Опис" }),
        imageField(s, "model", "3D-модель послуги (.glb)", "model"),
        h("div", { class: "field" }, h("label", {}, "Пункти (до 6)"), ...[0, 1, 2, 3, 4, 5].map((n) => i18nField(s.points, n, { max: 80, label: `Пункт ${n + 1}` })))));
    });
    main.append(templateButton("service", "Додати послугу з шаблону"));
  },

  async ideas(main) {
    main.append(...head("Каталог ідей послуг", "Готові картки на основі аналізу ринку (docs/market-needs-2026.md). Кнопка додає картку в чернетку ВИМКНЕНОЮ: вона не потрапить на сайт, доки ви самі її не ввімкнете в розділі «Послуги». Каталог ніколи не публікується."));
    let data;
    try { await save(); data = await api("ideas"); } catch (e) { fail(e); return; }
    const marks = (v) => String(v || "").replace(/\*\*|~~|\{\{|\}\}/g, "");
    const have = new Set(data.added.map((t) => uk(t)));
    for (const it of data.items) {
      const c = it.card, added = have.has(c.title.uk);
      const card = h("div", { class: "card", "data-idea": it.id });
      card.append(
        h("div", { class: "row between" }, h("strong", {}, `${it.need}. ${uk(c.title)}`), h("span", { class: "chip" }, `Готовність: ${data.readiness[it.readiness]}`)),
        h("p", {}, marks(c.text.uk)),
        h("ul", {}, c.points.map((p) => h("li", {}, marks(uk(p))))),
        h("p", { class: "lead" }, `EN: ${marks(c.title.en)} · DE: ${marks(c.title.de)} · іконка: ${c.icon}`),
        it.sources.length ? h("p", { class: "lead" }, "Джерела: ", it.sources.map((s, i) => [i ? " · " : "", h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title)])) : h("p", { class: "lead" }, "Джерел немає: це оцінка (див. документ аналізу)."),
        h("button", { class: "btn small", type: "button", disabled: added, onclick: async () => {
          await save();
          try {
            const r = await api("idea-add", { method: "POST", body: { id: it.id, rev: S.draft.rev } });
            S.draft = r.draft; S.save = "saved"; updateChips();
            toast("Додано в чернетку вимкненою. Увімкніть у розділі «Послуги»");
            rerender();
          } catch (e) { fail(e); }
        } }, added ? "Вже в чернетці" : "Додати в чернетку"));
      main.append(card);
    }
    if (!data.items.length) main.append(h("p", { class: "lead" }, "Каталог порожній або файл не знайдено."));
  },

  portfolio(main) {
    main.append(...head("Елементи портфоліо", "Єдине місце, де редагуються картки портфоліо: тексти трьома мовами, роки, теги, фото, порядок і вмикання. З цих даних збираються сторінка /portfolio/ і PDF. Головна лише вибирає, які з цих карток показати (розділ «Картки проєктів»). Вимкнена тут картка зникає звідусіль. Фото обирайте з завантажених файлів (JPEG, PNG або WebP)."));
    const g = gallerySettings();
    const all = S.catalog.factory.gallery;
    const bySlug = Object.fromEntries(all.map((x) => [x.slug, x]));
    const order = (g.order.length === all.length ? g.order : all.map((x) => x.slug)).filter((slug) => bySlug[slug]);
    const move = (slug, dir) => {
      const at = order.indexOf(slug), to = at + dir;
      if (to < 0 || to >= order.length) return;
      [order[at], order[to]] = [order[to], order[at]];
      g.order = order.slice(); touch(); rerender();
    };
    order.forEach((slug, at) => {
      const f = bySlug[slug];
      const on = !g.disabled.includes(slug);
      const ov = (g.items[slug] ||= {});
      ov.title ||= { ...f.title }; ov.summary ||= { ...f.summary };
      ov.years ??= f.years || ""; ov.tags ||= [...(f.tags || [])];
      const card = h("div", { class: `card${on ? "" : " off"}` }, cardHead("portfolio:item", { title: uk(ov.title), text: uk(ov.summary) },
        toggle(`${uk(ov.title)}${f.portfolioOnly ? " (лише портфоліо й PDF)" : ""}`, on, (v) => { g.disabled = g.disabled.filter((x) => x !== slug); if (!v) g.disabled.push(slug); card.classList.toggle("off", !v); }),
        h("button", { class: "btn small", type: "button", "aria-label": `Вгору: ${uk(ov.title)}`, title: "Вгору", disabled: at === 0 || null, onclick: () => move(slug, -1) }, "▲"),
        h("button", { class: "btn small", type: "button", "aria-label": `Вниз: ${uk(ov.title)}`, title: "Вниз", disabled: at === order.length - 1 || null, onclick: () => move(slug, 1) }, "▼")));
      card.append(h("div", { class: "block-body", style: "margin-top:12px" },
        i18nField(ov, "title", { max: 80, label: "Назва" }), i18nField(ov, "summary", { multiline: true, max: 600, label: "Опис" }),
        h("div", { class: "field" }, h("label", {}, "Роки"), h("input", { type: "text", maxlength: 20, value: ov.years, oninput: (e) => { ov.years = e.target.value; touch(); } })),
        h("div", { class: "field" }, h("label", {}, "Теги через кому (до 8)"), h("input", { type: "text", value: ov.tags.join(", "), oninput: (e) => { ov.tags = e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8); touch(); } })),
        ...f.slots.map((sl, i) => h("div", { class: "block-body" },
          imageField(g.images, sl.key, `Фото ${i + 1} (${sl.key}${g.images[sl.key] ? "" : sl.status === "final" ? ", заводське фото" : ", ще немає фото"})`, "image"),
          i18nField(g.alts, sl.key, { max: 200, label: "Alt-текст фото" })))));
      main.append(card);
    });
  },

  "portfolio-page"(main) {
    main.append(...head("Сторінка й PDF: розділи й тексти", "Розділи сторінки /portfolio/ і PDF: вмикайте й вимикайте. Тексти кожного розділу трьома мовами редагуються нижче. Усе це зберігається в портфоліо й не залежить від головної."));
    const g = gallerySettings();
    for (const s of S.catalog.factory.portfolio) {
      const on = !g.disabledSections.includes(s.id);
      const card = h("div", { class: `card${on ? "" : " off"}` }, cardHead("portfolio:section", { title: uk(s.title) },
        toggle(`${uk(s.title)} (${s.id})`, on, (v) => { g.disabledSections = g.disabledSections.filter((x) => x !== s.id); if (!v) g.disabledSections.push(s.id); card.classList.toggle("off", !v); })));
      main.append(card);
    }
    main.append(h("h2", { style: "margin-top:22px" }, "Тексти сторінки"));
    const groups = Object.keys(S.catalog.portfolioTexts);
    const sel = h("select", { "aria-label": "Група текстів портфоліо" }, groups.map((k) => h("option", { value: k }, k)));
    const list = h("div", { class: "stack" });
    const paint = () => list.replaceChildren(...Object.entries(S.catalog.portfolioTexts[sel.value]).slice(0, 80).map(([path, factory]) => {
      const holder = { v: g.texts[path] ? { ...g.texts[path] } : { ...factory } };
      const card = h("div", { class: "card" }, h("div", { class: "row between" }, h("span", { class: "mono muted" }, path),
        h("button", { class: "btn small", type: "button", onclick: () => { delete g.texts[path]; touch(); paint(); } }, "До заводського")));
      const field = i18nField(holder, "v", { multiline: (factory.en || factory.uk || "").length > 70, max: 2000 });
      field.addEventListener("input", () => { g.texts[path] = { ...holder.v }; touch(); });
      card.append(field);
      return card;
    }));
    sel.addEventListener("change", paint);
    main.append(h("div", { class: "row" }, h("div", { class: "grow" }, sel)), list);
    paint();
  },

  projects(main) {
    main.append(...head("Картки проєктів", "Фото й 3D-моделі підставляються без правки коду. Модель з'являється лише якщо 3D-галерею ввімкнено у «Віджетах»."));
    const rows = [...S.catalog.factory.projects.map((p) => ({ ...p, extra: false })), ...S.draft.extra.projects.map((p) => ({ id: p.id, title: p.title, extra: true, ref: p }))];
    for (const p of rows) {
      const on = !S.draft.disabled.projects.includes(p.id);
      const card = h("div", { class: `card${on ? "" : " off"}` }, cardHead(p.extra ? "project:custom" : `project:${p.id}`, { title: uk(p.title) || "Новий проєкт", text: p.extra ? "" : uk(p.summary) },
        toggle(uk(p.title) || "Новий проєкт", on, (v) => { setDisabled("projects", p.id, !v); card.classList.toggle("off", !v); }),
        p.extra ? h("button", { class: "btn small danger", type: "button", onclick: () => { if (confirm("Видалити картку?")) { S.draft.extra.projects.splice(S.draft.extra.projects.indexOf(p.ref), 1); touch(); rerender(); } } }, "Видалити") : null));
      const body = h("div", { class: "block-body", style: "margin-top:12px" });
      if (p.extra) {
        body.append(
          h("div", { class: "field" }, h("label", {}, "Категорія"), h("select", { onchange: (e) => { p.ref.category = e.target.value; touch(); } }, S.catalog.factory.categories.map((c) => h("option", { value: c.id, selected: p.ref.category === c.id }, uk(c.label))))),
          i18nField(p.ref, "title", { max: 80, label: "Назва" }), i18nField(p.ref, "summary", { multiline: true, max: 300, label: "Опис" }), i18nField(p.ref, "status", { max: 40, label: "Статус" }),
          h("div", { class: "field" }, h("label", {}, "Теги через кому"), h("input", { type: "text", value: p.ref.tags.join(", "), oninput: (e) => { p.ref.tags = e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8); touch(); } })),
          imageField(p.ref, "image", "Фото / ілюстрація"), imageField(p.ref, "model", "3D-модель (.glb)", "model"));
      } else {
        S.draft.images.projects[p.id] ??= ""; S.draft.images.models[p.id] ??= "";
        S.draft.products ||= {};
        const ov = (S.draft.products[p.id] ||= {});            // text overrides of the factory card, seeded with the factory values (equal values are dropped by the server)
        ov.title ||= { ...p.title }; ov.summary ||= { ...p.summary }; ov.status ||= { ...p.status }; ov.tags ||= [...(p.tags || [])]; ov.category ||= p.category;
        body.append(
          h("div", { class: "field" }, h("label", {}, "Категорія"), h("select", { onchange: (e) => { ov.category = e.target.value; touch(); } }, S.catalog.factory.categories.map((c) => h("option", { value: c.id, selected: ov.category === c.id }, uk(c.label))))),
          i18nField(ov, "title", { max: 80, label: "Назва" }), i18nField(ov, "summary", { multiline: true, max: 300, label: "Опис" }), i18nField(ov, "status", { max: 40, label: "Статус" }),
          h("div", { class: "field" }, h("label", {}, "Теги через кому"), h("input", { type: "text", value: ov.tags.join(", "), oninput: (e) => { ov.tags = e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8); touch(); } })));
        body.append(imageField(S.draft.images.projects, p.id, "Замінити фото / ілюстрацію"), imageField(S.draft.images.models, p.id, "Замінити 3D-модель (.glb)", "model"));
      }
      card.append(body);
      main.append(card);
    }
    main.append(templateButton("project", "Додати картку проєкту з шаблону"));
    // the home page's gallery "Замовні розробки": only a SELECTION of portfolio items (draft.site.gallery); their content is edited in «Елементи портфоліо»
    const sg = ((S.draft.site ||= {}).gallery ||= { hidden: [], order: [] });
    sg.hidden ||= []; sg.order ||= [];
    const pg = gallerySettings();
    const eligible = S.catalog.factory.gallery.filter((x) => !x.portfolioOnly && !pg.disabled.includes(x.slug));
    const base = (pg.order.length ? pg.order : S.catalog.factory.gallery.map((x) => x.slug)).filter((slug) => eligible.some((x) => x.slug === slug));
    const list = (sg.order.length ? [...sg.order.filter((slug) => base.includes(slug)), ...base.filter((slug) => !sg.order.includes(slug))] : base);
    main.append(h("h2", { style: "margin-top:22px" }, "Галерея «Замовні розробки» на головній"),
      h("p", { class: "lead" }, "Тут лише вибір карток портфоліо для головної: показати чи сховати й порядок. Тексти й фото беруться з портфоліо, сторінка /portfolio/ і PDF від цього вибору не залежать."));
    list.forEach((slug, at) => {
      const f = eligible.find((x) => x.slug === slug);
      const ov = pg.items[slug] || {};
      const title = uk(ov.title) || uk(f.title);
      const on = !sg.hidden.includes(slug);
      const move = (dir) => { const to = at + dir; if (to < 0 || to >= list.length) return; const next = list.slice(); [next[at], next[to]] = [next[to], next[at]]; sg.order = next; touch(); rerender(); };
      const card = h("div", { class: `card${on ? "" : " off"}` }, cardHead("site:gallery", { title, text: uk(ov.summary) || uk(f.summary) },
        toggle(title, on, (v) => { sg.hidden = sg.hidden.filter((x) => x !== slug); if (!v) sg.hidden.push(slug); card.classList.toggle("off", !v); }),
        h("button", { class: "btn small", type: "button", "aria-label": `Вгору: ${title}`, disabled: at === 0 || null, onclick: () => move(-1) }, "▲"),
        h("button", { class: "btn small", type: "button", "aria-label": `Вниз: ${title}`, disabled: at === list.length - 1 || null, onclick: () => move(1) }, "▼"),
        h("button", { class: "btn small", type: "button", onclick: () => go("portfolio") }, "Змінити в портфоліо")));
      main.append(card);
    });
  },

  "home-blocks"(main) {
    main.append(...head("Додаткові розділи головної", "Блоки, додані з шаблонів або з бібліотеки, з'являються на головній перед розділом контактів."));
    main.append(blockEditor(S.draft.extra.home));
    main.append(h("div", { class: "row" }, ...Object.entries(S.catalog.templates.sections).map(([id, label]) => templateButton("section", `Розділ із шаблону: ${uk(label)}`, id))));
  },

  assistant(main) {
    const A = (S.draft.assistant ||= { enabled: false, avatar: "consultant-f", hidden: [], facts: {}, extra: [] });
    A.avatar ||= "consultant-f";
    main.append(...head("Бот-помічник для клієнтів", "Окрема від редагування сайту вкладка. Бот відповідає лише з бази знань: тексти сайту (що зараз ввімкнено в чернетці) + факти нижче. Запис без позначки «публічний» у відповіді не потрапляє."));
    main.append(h("div", { class: "card" }, toggle("Показувати чат на сайті (за замовчуванням вимкнено)", A.enabled === true, (v) => { A.enabled = v; }),
      h("p", { class: "muted" }, "Вимкнено: у HTML нічого не додається і файли бота не потрапляють у пакет. Увімкнено: потрібні секрет ASSISTANT_BACKENDS у Worker і запущений llama-server (див. docs/assistant-llama-server.md). Без бекендів бот чесно скаже, що недоступний, і запропонує форму контакту.")));

    main.append(h("h2", { style: "margin-top:22px" }, "Аватар помічника"), avatarPicker(A));
    main.append(h("div", { class: "row" },
      h("button", { class: "btn", type: "button", onclick: async () => { try { await save(); await api("apply-settings", { method: "POST", body: {} }); toast("Аватар застосовано на сайті без публікації (кілька секунд)"); } catch (e) { fail(e); } } }, "Застосувати аватар зараз"),
      h("span", { class: "muted" }, "Живий параметр: сайт візьме його сам, збірка й публікація не потрібні. Решта змін чернетки без публікації на сайті не з'являться.")));
    main.append(h("h2", { style: "margin-top:22px" }, "Заводські факти (data/assistant-kb.json)"));
    for (const f of S.catalog.assistantFacts || []) {
      A.facts[f.id] ||= { public: f.public === true, topic: clone(f.topic), text: clone(f.text) };
      const item = A.facts[f.id];
      const reset = h("button", { class: "btn small", type: "button", onclick: () => { delete A.facts[f.id]; touch(); rerender(); } }, "Скинути до заводського");
      main.append(h("div", { class: "card" }, h("div", { class: "row between" }, toggle("Публічний (може потрапити у відповідь)", item.public === true, (v) => { item.public = v; }), reset),
        i18nField(item, "topic", { max: 120, label: "Тема" }), i18nField(item, "text", { multiline: true, max: 1200, label: "Текст" })));
    }

    main.append(h("h2", { style: "margin-top:22px" }, "Ваші факти"));
    A.extra.forEach((item, i) => main.append(h("div", { class: "card" },
      h("div", { class: "row between" }, toggle("Публічний (може потрапити у відповідь)", item.public === true, (v) => { item.public = v; }),
        h("button", { class: "btn small", type: "button", onclick: () => { A.extra.splice(i, 1); touch(); rerender(); } }, "Видалити")),
      i18nField(item, "topic", { max: 120, label: "Тема" }), i18nField(item, "text", { multiline: true, max: 1200, label: "Текст" }))));
    main.append(h("button", { class: "btn", type: "button", onclick: () => { A.extra.push({ id: uid("x-"), public: false, topic: { uk: "", en: "", de: "" }, text: { uk: "", en: "", de: "" } }); touch(); rerender(); } }, "Додати факт"));

    main.append(h("h2", { style: "margin-top:22px" }, "Приховані слова"));
    main.append(h("div", { class: "card" },
      h("p", { class: "muted" }, "Одне слово чи фраза на рядок (до 60 символів, до 60 рядків). Фільтр прибирає ці слова з кожної відповіді бота, навіть якщо модель їх напише. Ключі, токени, IP-адреси, внутрішні хости, шляхи й адреси приватних репозиторіїв фільтр прибирає завжди."),
      h("textarea", { rows: "6", "aria-label": "Приховані слова", value: (A.hidden || []).join("\n"), oninput: (e) => { A.hidden = e.target.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 60); touch(); } })));
  },
  widgets(main) {
    main.append(...head("Віджети й візуальні ефекти"));
    for (const w of S.catalog.widgets) main.append(h("div", { class: "card" }, cardHead(`widget:${w.id}`, { title: w.label }, toggle(w.label, S.draft.widgets[w.id] !== false, (v) => { S.draft.widgets[w.id] = v; }))));
    main.append(h("h2", { style: "margin-top:22px" }, "Ефекти"));
    for (const e of S.catalog.effects) main.append(h("div", { class: "card" }, cardHead(`effect:${e.id}`, { title: e.label }, toggle(e.label, S.draft.effects[e.id] !== false, (v) => { S.draft.effects[e.id] = v; }))));
  },

  texts(main) {
    main.append(...head("Тексти трьома мовами", "Змінений текст зберігається поверх заводського; порожня мова показує іншу наявну. Позначка ⚠ — не всі мови заповнені."));
    const groups = Object.keys(S.catalog.texts);
    const sel = h("select", { "aria-label": "Група текстів" }, groups.map((g) => h("option", { value: g }, g)));
    const search = h("input", { type: "text", placeholder: "Пошук за текстом або ключем…", "aria-label": "Пошук" });
    const list = h("div", { class: "stack" });
    const paint = () => {
      const q = search.value.trim().toLowerCase();
      const rows = Object.entries(S.catalog.texts[sel.value]).filter(([path, v]) => !q || path.toLowerCase().includes(q) || LANGS.some((l) => (S.draft.texts[path]?.[l] ?? v[l] ?? "").toLowerCase().includes(q)));
      list.replaceChildren(...rows.slice(0, 80).map(([path, factory]) => {
        const holder = { v: S.draft.texts[path] ? { ...S.draft.texts[path] } : { ...factory } };
        const card = h("div", { class: "card" }, h("div", { class: "row between" }, h("span", { class: "mono muted" }, path),
          h("button", { class: "btn small", type: "button", onclick: () => { delete S.draft.texts[path]; touch(); paint(); } }, "До заводського")));
        const field = i18nField(holder, "v", { multiline: (factory.en || factory.uk || "").length > 70, max: 2000 });
        field.addEventListener("input", () => { S.draft.texts[path] = { ...holder.v }; touch(); });
        card.append(field);
        return card;
      }), ...(rows.length > 80 ? [h("p", { class: "muted" }, `Показано 80 із ${rows.length}: уточніть пошук.`)] : []));
    };
    sel.addEventListener("change", paint); search.addEventListener("input", paint);
    main.append(h("div", { class: "row" }, h("div", { class: "grow" }, sel), h("div", { class: "grow" }, search)), list);
    paint();
    // values without translation: e-mail, phone, technology names (draft.plain)
    S.draft.plain ||= {};
    main.append(h("h2", { style: "margin-top:22px" }, "Значення без перекладу"), h("p", { class: "lead" }, "Пошта, телефон і назви технологій. Змінена пошта чи телефон оновлює й посилання за ними; справжній номер прибирає позначку «демо»."),
      ...Object.entries(S.catalog.plain || {}).map(([path, factory]) => h("div", { class: "field" }, h("label", {}, path),
        h("input", { type: "text", maxlength: 120, value: S.draft.plain[path] ?? factory, "aria-label": path, oninput: (e) => { const v = e.target.value.trim(); if (v && v !== factory) S.draft.plain[path] = v; else delete S.draft.plain[path]; touch(); } }))));
  },

  pages(main) {
    main.append(...head("Сторінки", "Нова сторінка створюється із шаблону й отримує адресу /s/<адреса>/. Адреса: a-z, 0-9 та «-»."));
    if (!S.draft.pages.length) main.append(h("p", { class: "muted" }, "Сторінок ще немає."));
    S.draft.pages.forEach((p, i) => main.append(h("div", { class: `card${p.enabled ? "" : " off"}` }, h("div", { class: "row between" },
      h("div", {}, h("strong", {}, uk(p.title) || "(без назви)"), h("span", { class: "mono muted" }, `  /s/${p.slug}/`)),
      h("div", { class: "row" }, toggle("Увімкнено", p.enabled, (v) => { p.enabled = v; rerender(); }), toggle("У меню", p.inNav, (v) => { p.inNav = v; }),
        h("button", { class: "btn small", type: "button", onclick: () => go("page", p.id) }, "Редагувати"),
        h("button", { class: "btn small danger", type: "button", onclick: () => { if (confirm("Видалити сторінку?")) { S.draft.pages.splice(i, 1); touch(); rerender(); } } }, "Видалити"))))));
    main.append(h("h2", { style: "margin-top:22px" }, "Нова сторінка з шаблону"), h("div", { class: "row" },
      ...Object.entries(S.catalog.templates.pages).map(([id, label]) => templateButton("page", uk(label), id, (newId) => go("page", newId)))));
  },

  page(main, id) {
    const p = S.draft.pages.find((x) => x.id === id);
    if (!p) return go("pages");
    main.append(h("button", { class: "btn small", type: "button", onclick: () => go("pages") }, "← До списку"), ...head(uk(p.title) || "Сторінка"));
    main.append(h("div", { class: "card" }, h("div", { class: "block-body" },
      h("div", { class: "field" }, h("label", {}, "Адреса (/s/…/)"), h("input", { type: "text", maxlength: 48, value: p.slug, oninput: (e) => { p.slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""); e.target.value = p.slug; touch(); } })),
      i18nField(p, "title", { max: 120, label: "Назва (меню, заголовок вкладки)" }), i18nField(p, "description", { multiline: true, max: 300, label: "Опис для пошуку" }),
      h("div", { class: "row" }, toggle("Увімкнено", p.enabled, (v) => { p.enabled = v; }), toggle("Показувати в меню", p.inNav, (v) => { p.inNav = v; })))));
    main.append(h("h2", { style: "margin-top:22px" }, "Блоки"), blockEditor(p.blocks));
  },

  forms(main) {
    main.append(...head("Форми", "Форми з цього розділу вставляються блоком «Форма» й надсилаються на /api/form. Стандартна форма контактів на головній не змінюється (її тексти — у «Текстах»)."));
    const ids = Object.keys(S.draft.forms);
    if (!ids.length) main.append(h("p", { class: "muted" }, "Власних форм ще немає."));
    for (const id of ids) main.append(formCard(id, S.draft.forms[id]));
    main.append(h("h2", { style: "margin-top:22px" }, "Нова форма з шаблону"), h("div", { class: "row" },
      ...Object.entries(S.catalog.templates.forms).map(([tid, label]) => templateButton("form", uk(label), tid))));
  },

  async files(main) {
    main.append(...head("Файли", "Зображення (JPEG/PNG/WebP/AVIF до 5 МБ) і 3D-моделі .glb (до 8 МБ). Невикористані файли зникають автоматично за добу; використані в чернетці чи збірках видалити не можна."));
    const msg = h("div", { class: "msg err", hidden: true });
    const input = h("input", { type: "file", multiple: true, accept: "image/jpeg,image/png,image/webp,image/avif,.glb", onchange: async () => {
      const problems = [];
      for (const f of input.files) { try { await uploadFile(f); } catch (e) { problems.push(`${f.name}: ${e.message}`); } }
      rerender();                                     // redraws the list; the messages are shown in the fresh view
      const fresh = $(".main .msg.err");
      if (fresh && problems.length) { fresh.textContent = problems.join(" · "); fresh.hidden = false; }
    } });
    main.append(h("div", { class: "card" }, h("div", { class: "field" }, h("label", {}, "Завантажити"), input), msg));
    const grid = h("div", { class: "grid" });
    for (const u of S.uploads) grid.append(h("div", { class: "tile" }, u.kind === "image" ? h("img", { class: "thumb", src: imageUrl(u.ref), alt: "" }) : h("span", { class: "thumb", style: "display:grid;place-items:center" }, "3D"),
      h("span", { class: "mono" }, u.name), h("span", { class: "muted" }, `${(u.size / 1048576).toFixed(2)} МБ`),
      h("button", { class: "btn small danger", type: "button", onclick: async () => { try { const r = await api("delete-upload", { method: "POST", body: { id: u.id } }); S.uploads = r.uploads; rerender(); } catch (e) { fail(e); } } }, "Видалити")));
    main.append(S.uploads.length ? grid : h("p", { class: "muted" }, "Файлів ще немає."));
  },

  builds(main) {
    main.append(...head("Версії й публікація", "Зберігаються 20 останніх збірок. «Відкотити чернетку» повертає редактор до стану цієї збірки; публікацію виконує агент на основному ПК."));
    const st = S.status;
    if (st.built) main.append(publishBox(st.built));
    const table = h("table", {}, h("thead", {}, h("tr", {}, ["Версія", "Файлів", "Розмір", "Стан", ""].map((t) => h("th", {}, t)))));
    const tb = h("tbody");
    for (const b of S.builds) tb.append(h("tr", {}, h("td", { class: "mono" }, b.id), h("td", {}, String(b.files)), h("td", {}, `${(b.bytes / 1048576).toFixed(2)} МБ`),
      h("td", {}, [b.current ? "поточна" : "", b.published ? "опублікована" : ""].filter(Boolean).join(", ") || "—"),
      h("td", { class: "row" },
        h("button", { class: "btn small", type: "button", onclick: async () => { try { const r = await api("preview", { method: "POST", body: { id: b.id } }); S.status = r.status; window.open(r.status.previewUrl, "_blank", "noopener"); await refreshStatus(); rerender(); } catch (e) { fail(e); } } }, "Перегляд"),
        h("button", { class: "btn small", type: "button", onclick: () => rollback(b.id) }, "Відкотити чернетку"),
        h("button", { class: "btn small", type: "button", disabled: b.published && !st.changedSinceBuild ? true : null, onclick: () => publish(b.id) }, b.published ? "Опубліковано" : "Опублікувати"))));
    table.append(tb);
    main.append(S.builds.length ? h("div", { class: "card", style: "overflow-x:auto" }, table) : h("p", { class: "muted" }, "Збірок ще немає. Натисніть «Зібрати пакет»."));
  },
};

/** draft.portfolio with every list present (the sanitiser re-checks everything on save). */
function gallerySettings() {
  const g = (S.draft.portfolio ||= {});
  g.disabled ||= []; g.order ||= []; g.items ||= {}; g.images ||= {}; g.alts ||= {}; g.disabledSections ||= []; g.texts ||= {};
  return g;
}

function setDisabled(kind, id, off) {
  const list = S.draft.disabled[kind];
  const at = list.indexOf(id);
  if (off && at < 0) list.push(id);
  if (!off && at >= 0) list.splice(at, 1);
  touch();
}

function templateButton(kind, label, id = "", then) {
  return h("button", { class: "btn", type: "button", onclick: async () => {
    await save();
    try {
      const r = await api("template", { method: "POST", body: { kind, id, rev: S.draft.rev } });
      S.draft = r.draft; S.save = "saved"; updateChips();
      toast("Додано з шаблону");
      then ? then(r.newId) : rerender();
    } catch (e) { fail(e); }
  } }, `+ ${label}`);
}

function formCard(id, form) {
  const card = h("div", { class: "card" });
  const body = h("div", { class: "block-body", style: "margin-top:12px" });
  const paint = () => {
    body.replaceChildren(i18nField(form, "title", { max: 120, label: "Назва форми" }), i18nField(form, "intro", { multiline: true, max: 400, label: "Вступний текст" }),
      h("div", { class: "field" }, h("label", {}, "Поля"), ...form.fields.map((f, i) => h("div", { class: "card" },
        h("div", { class: "block-head" }, h("span", { class: "title mono" }, f.key),
          h("button", { class: "btn small", type: "button", disabled: i === 0, "aria-label": "Поле вгору", onclick: () => { [form.fields[i - 1], form.fields[i]] = [form.fields[i], form.fields[i - 1]]; touch(); paint(); } }, "↑"),
          h("button", { class: "btn small", type: "button", disabled: i === form.fields.length - 1, "aria-label": "Поле вниз", onclick: () => { [form.fields[i + 1], form.fields[i]] = [form.fields[i], form.fields[i + 1]]; touch(); paint(); } }, "↓"),
          h("button", { class: "btn small danger", type: "button", onclick: () => { form.fields.splice(i, 1); touch(); paint(); } }, "Видалити")),
        h("div", { class: "block-body" },
          h("div", { class: "row" },
            h("div", { class: "field grow" }, h("label", {}, "Ключ (a-z, 0-9, _)"), h("input", { type: "text", maxlength: 24, value: f.key, oninput: (e) => { f.key = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""); e.target.value = f.key; touch(); } })),
            h("div", { class: "field grow" }, h("label", {}, "Тип"), h("select", { onchange: (e) => { f.type = e.target.value; if (f.type === "select") f.options ||= []; touch(); paint(); } },
              [["text", "Рядок"], ["email", "Email"], ["tel", "Телефон"], ["textarea", "Довгий текст"], ["select", "Список"], ["checkbox", "Прапорець"]].map(([v, l]) => h("option", { value: v, selected: f.type === v }, l)))),
            toggle("Обов'язкове", f.required, (v) => { f.required = v; })),
          i18nField(f, "label", { max: 120, label: "Підпис" }),
          f.type === "select" ? h("div", { class: "field" }, h("label", {}, "Варіанти"), ...(f.options ||= []).map((o, n) => h("div", { class: "card" }, i18nField(f.options, n, { max: 80, label: `Варіант ${n + 1}` }),
            h("button", { class: "btn small danger", type: "button", onclick: () => { f.options.splice(n, 1); touch(); paint(); } }, "Видалити варіант"))),
            h("button", { class: "btn small", type: "button", onclick: () => { f.options.push({ uk: "", en: "", de: "" }); touch(); paint(); } }, "+ Варіант")) : null))),
        form.fields.length < 20 ? h("button", { class: "btn small", type: "button", onclick: () => { form.fields.push({ key: "field" + (form.fields.length + 1), type: "text", label: { uk: "", en: "", de: "" }, required: false, max: 200 }); touch(); paint(); } }, "+ Поле") : null),
      h("div", { class: "row" }, toggle("Потрібна згода на обробку даних", form.consentRequired, (v) => { form.consentRequired = v; })),
      i18nField(form, "consent", { max: 300, label: "Текст згоди" }), i18nField(form, "submit", { max: 40, label: "Текст кнопки" }), i18nField(form, "success", { max: 300, label: "Повідомлення про успіх" }));
  };
  paint();
  card.append(h("div", { class: "row between" }, h("strong", {}, `${uk(form.title) || id} `, h("span", { class: "mono muted" }, `(${id})`)),
    h("button", { class: "btn small danger", type: "button", onclick: () => { if (confirm("Видалити форму? Блоки, що на неї посилаються, треба буде виправити.")) { delete S.draft.forms[id]; touch(); rerender(); } } }, "Видалити")), body);
  return card;
}

/* ---------- build, publish, rollback ---------- */
function problemsDialog(problems) {
  const dlg = h("dialog", { "aria-label": "Помилки перевірки" }, h("h3", {}, `Пакет не зібрано: ${problems.length} ${problems.length === 1 ? "помилка" : "помилок"}`),
    h("ul", { class: "problems" }, problems.map((p) => h("li", {}, h("strong", {}, p.where), ": ", p.message))),
    h("div", { class: "row", style: "margin-top:14px" }, h("button", { class: "btn primary", type: "button", onclick: () => dlg.close() }, "Закрити")));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

/** The publish log, one coloured line each: OK green, warnings yellow, errors red, steps blue, the rest muted (an all-OK log needs no reading). */
const LOG_RULES = [
  ["dim", /post-quantum|store now, decrypt later|openssh\.com\/pq|may need to be upgraded/i],        // the known ssh notice, repeated on every connection: not worth a colour
  ["ok", /^\s*(ok|published|deployed|uploaded|✔|✓)\b|^reserve on the radxa updated/i],
  ["err", /^\s*(error|fail(ed)?|check|npm err|✖|✘)\b|\b(failed|cannot|refused|not found|enospc|denied|unsupported)\b|непідтримана|помилка/i],
  ["warn", /^\*\* |^\s*(warning|warn)\b|\bwarning\b|not updated/i],
  ["step", /^\s*(downloading|verifying|deploying|staged|building|starting|current version)\b/i],
];
function logView(text) {
  const lines = String(text).split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return h("pre", { class: "mono log" }, lines.map((line) => {
    const hit = LOG_RULES.find(([, re]) => re.test(line));
    return h("span", { class: `ln ${hit ? hit[0] : "dim"}` }, line || " ");
  }));
}

/** Where the deploy is, read from the log lines the agent sends while it works (the stages follow deploy-from-radxa.sh and wrangler). */
const DEPLOY_STAGES = [
  ["Завантаження пакета з Radxa", /downloading/i],
  ["Перевірка контрольних сум", /verifying|files match/i],
  ["Підготовка файлів", /deploying with|staged/i],
  ["Завантаження файлів у Cloudflare", /building list of assets|starting asset upload|uploaded \d|read \d+ files/i],
  ["Публікація Worker", /total upload|worker startup|deployed |current version|uploaded viteh/i],
  ["Фіксація версії", /marking .* as published|stored\./i],
];
const deployStage = (log) => DEPLOY_STAGES.reduce((at, [, re], i) => (re.test(String(log)) ? i : at), -1);
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

function deployProgress(d) {
  const stage = d.state === "queued" ? -1 : Math.max(0, deployStage(d.log));
  const pct = d.state === "queued" ? 4 : Math.round(((stage + 1) / (DEPLOY_STAGES.length + 1)) * 100);
  const since = d.state === "queued" ? d.requestedAt : (d.startedAt || d.requestedAt);
  const timer = h("span", { class: "muted mono" }, "");
  const tick = () => { timer.textContent = since ? clock(Date.now() / 1000 - since) : ""; };
  tick();
  const ticker = setInterval(() => { if (!timer.isConnected) clearInterval(ticker); else tick(); }, 1000);
  const text = d.state === "queued" ? (d.agentOnline ? "У черзі: агент зараз візьме публікацію" : "У черзі: чекаємо агента на основному ПК") : `Крок ${stage + 1} з ${DEPLOY_STAGES.length}: ${DEPLOY_STAGES[stage][0]}`;
  return h("div", { class: "deploy-progress", role: "status", "aria-live": "polite" },
    h("div", { class: "row" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("strong", {}, text), timer),
    h("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) }, h("div", { class: "bar-fill", style: `width:${pct}%` })));
}

function publishBox(id) {
  const d = S.status?.deploy || { state: "idle" };
  const mine = d.id === id;
  const busy = mine && (d.state === "queued" || d.state === "running");
  const label = { queued: "У черзі…", running: "Публікується…", ok: "Опубліковано", failed: "Помилка публікації" }[mine ? d.state : ""] || "";
  const stale = id === S.status?.built && S.status?.changedSinceBuild;
  const done = S.status?.published === id && !stale;                                   // this very package is already live and the draft has not moved on
  const btn = h("button", { class: "btn primary", type: "button", disabled: busy || done || null, onclick: () => publish(id) },
    busy ? "Публікується…" : done ? "Вже опубліковано" : "Опублікувати цю версію");
  const staleNote = stale && !busy ? h("p", { class: "chip warn" }, "У чернетці є зміни після цієї збірки: кнопка спершу збере свіжий пакет, а потім опублікує його.") : null;
  const note = !d.agentOnline && !busy ? h("p", { class: "muted" }, "Агент публікації на основному ПК зараз не на зв'язку: запит дочекається, поки його запустять (deploy-agent.sh).") : null;
  return h("div", { class: "card" }, h("strong", {}, `Опублікувати ${id}`),
    h("p", { class: "muted" }, "Кнопка ставить публікацію в чергу; ключі Cloudflare лишаються на основному ПК, де її виконує агент."),
    h("div", { class: "row" }, btn, label && !busy ? h("span", { class: d.state === "failed" ? "chip warn" : "chip" }, label) : null), busy ? deployProgress(d) : null, staleNote, note,
    mine && d.log ? logView(d.log) : null);
}

async function publish(id) {
  try {
    if (id === S.status?.built && S.status?.changedSinceBuild) {          // the draft moved on after this package was built: publishing it would ship the old site
      await save();
      toast("Є зміни після збірки: збираю свіжий пакет перед публікацією");
      const b = await api("build", { method: "POST", body: {} });
      S.status = b.status; S.builds = b.builds; updateChips();
      id = b.result.id;
    }
    const r = await api("deploy", { method: "POST", body: { id } }); S.status = r.status; toast("Публікацію поставлено в чергу"); watchDeploy(); rerender();
  } catch (e) {
    if (e.data?.problems) problemsDialog(e.data.problems); else fail(e);
  }
}

let deployTimer = null;
function watchDeploy() {
  clearInterval(deployTimer);
  deployTimer = setInterval(async () => {
    try { await refreshStatus(); } catch { return; }
    const st = S.status?.deploy?.state;
    if (st !== "queued" && st !== "running") {
      clearInterval(deployTimer);
      toast(st === "ok" ? "Опубліковано" : "Публікація не вдалася, дивіться журнал", st === "ok" ? undefined : "err", 8000);
    }
    if (S.view?.name === "builds") { const y = window.scrollY; rerender(); window.scrollTo(0, y); }          // progress and log move while it runs
  }, 2500);
}

async function buildNow() {
  await save();
  const button = $("#btn-build"); button.disabled = true; button.textContent = "Збираю…";
  try {
    const r = await api("build", { method: "POST", body: {} });
    S.status = r.status; S.builds = r.builds; updateChips();
    toast(`Збірку ${r.result.id} готово (${r.result.files} файлів). Перегляньте й натисніть «Опублікувати».`);
    go("builds");
  } catch (e) {
    if (e.data?.problems) problemsDialog(e.data.problems); else fail(e);
  } finally { button.disabled = false; button.textContent = "Зібрати пакет"; }
}

async function rollback(id) {
  if (!confirm("Повернути чернетку до стану цієї збірки? Поточні незібрані зміни буде замінено.")) return;
  try {
    const r = await api("rollback", { method: "POST", body: { id } });
    S.draft = r.draft; S.status = r.status; S.builds = r.builds; S.save = "saved"; updateChips();
    toast("Чернетку повернуто до вибраної версії");
    rerender();
  } catch (e) { fail(e); }
}

/* ---------- start ---------- */
async function start() {
  try {
    const r = await api("bootstrap");
    Object.assign(S, { draft: r.draft, catalog: r.catalog, status: r.status, uploads: r.uploads, builds: r.builds, save: "saved", conflict: false });
    shell();
    go(S.view.name, S.view.arg);
  } catch (e) { if (!e.handled) $("#app").replaceChildren(h("p", { class: "boot" }, `Не вдалося завантажити: ${e.message}`)); }
}

start();
