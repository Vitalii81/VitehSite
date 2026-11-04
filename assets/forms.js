"use strict";
// Forms created in the admin (<form data-vform>): validate, post to /api/form, show a status. No dependencies.
// The Worker checks the submission again against the published /forms.json; nothing here is trusted.
(() => {
  const lang = () => document.documentElement.lang || "en";
  const pick = (map) => (map && (map[lang()] || map.en || map.uk)) || "";
  const shownAt = Date.now();

  const translate = () => {
    document.querySelectorAll("option[data-i18n-opt]").forEach((o) => { try { o.textContent = pick(JSON.parse(o.dataset.i18nOpt)); } catch { /* keep English */ } });
    document.querySelectorAll("img[data-alt]").forEach((i) => { try { i.alt = pick(JSON.parse(i.dataset.alt)); } catch { /* keep default */ } });
  };
  translate();
  new MutationObserver(translate).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  document.querySelectorAll("form[data-vform]").forEach((form) => {
    const status = form.querySelector(".form-status");
    const button = form.querySelector("button[type=submit]");
    let messages = {};
    try { messages = JSON.parse(form.dataset.msg || "{}"); } catch { /* defaults below */ }
    const say = (kind, key) => { status.className = `form-status ${kind}`; status.textContent = pick(messages[key]); };
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (button.disabled) return;
      if (!form.checkValidity()) { form.reportValidity?.(); return say("err", "required"); }
      const values = {};
      for (const el of form.elements) {
        if (!el.name || ["hp", "consent"].includes(el.name) || el.type === "submit") continue;
        values[el.name] = el.type === "checkbox" ? el.checked : el.value;
      }
      const body = { form: form.dataset.vform, values, consent: !!form.elements.consent?.checked, lang: lang(), hp: form.elements.hp?.value || "", t: shownAt };
      button.disabled = true;
      try {
        const response = await fetch("/api/form", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (response.ok) { say("ok", "ok"); form.reset(); } else say("err", response.status === 400 ? "required" : "error");
      } catch { say("err", "error"); } finally { button.disabled = false; }
    });
  });
})();
