"""Knowledge base of the site assistant. Generated at build time from the MERGED site (what visitors really see: disabled sections, services and
projects are already gone) plus the facts of data/assistant-kb.json with the owner's overrides. Only records with public === true are written.
The result goes to `api/_private/assistant.json` of the package: the Worker handles every /api/* request first, so this file is never served to browsers."""
from .core import LANGS

PRIVATE_PATH = "api/_private/assistant.json"
UI_KEYS = ("busy", "unavailable", "rate", "tooLong", "error")


def pick(value, lang):
    value = value if isinstance(value, dict) else {}
    return (value.get(lang) or value.get("en") or value.get("uk") or "").strip()


def i18n_out(value):
    return {lang: pick(value, lang) for lang in LANGS}


def facts(draft, ctx):
    """Factory facts with overrides, then the owner's extra facts; each as {id, public, topic, text}. `public` is True only when explicitly so."""
    out = []
    for base in ctx.assistant_kb:
        if not isinstance(base, dict) or not isinstance(base.get("id"), str):
            continue
        over = draft["assistant"]["facts"].get(base["id"], {})
        out.append({"id": base["id"], "public": over.get("public", base.get("public")) is True,
                    "topic": over.get("topic", base.get("topic")), "text": over.get("text", base.get("text"))})
    for item in draft["assistant"]["extra"]:
        out.append({"id": item["id"], "public": item["public"] is True, "topic": item["topic"], "text": item["text"]})
    return out


def cards(draft, site, products):
    """The cards the assistant may offer to show: {id, kind, title}. Ids are the whole contract between the model, the Worker and the page."""
    out = []
    if draft["sections"].get("services", True):
        out += [{"id": "service:%d" % i, "kind": "service", "title": i18n_out(it.get("title"))} for i, it in enumerate(site["services"]["items"])]
    if draft["sections"].get("work", True):
        out += [{"id": "project:%s" % p["id"], "kind": "project", "title": i18n_out(p.get("title"))} for p in products]
    if draft["widgets"].get("portfolioLink", True):
        out.append({"id": "portfolio", "kind": "portfolio", "title": i18n_out(site["ui"].get("assistant", {}).get("portfolioCard"))})
    return out


def site_records(draft, site, products):
    """Public site content as records {id, topic, text} per language, built only from sections that are switched on."""
    recs = []
    on = lambda sid: draft["sections"].get(sid, True)

    def add(rid, topic, text):
        recs.append({"id": rid, "topic": i18n_out(topic), "text": i18n_out(text)})

    def join(parts):
        return {lang: " ".join(x for x in (pick(p, lang) for p in parts) if x) for lang in LANGS}

    if on("services"):
        for i, it in enumerate(site["services"]["items"]):
            add("service:%d" % i, it.get("title"), join([it.get("text")] + list(it.get("points") or [])))
    if on("ai"):
        for i, f in enumerate(site.get("ai", {}).get("features", [])):
            add("ai:%d" % i, f.get("title"), f.get("text"))
    if on("process"):
        for i, st in enumerate(site.get("process", {}).get("steps", [])):
            add("process:%d" % i, {l: "%s %d: %s" % (pick(site["nav"].get("process"), l) if isinstance(site.get("nav"), dict) and "process" in site["nav"] else "", i + 1, pick(st.get("title"), l)) for l in LANGS}, st.get("text"))
    if on("pricing"):
        for i, m in enumerate(site.get("pricing", {}).get("models", [])):
            add("pricing:%d" % i, m.get("title"), join([m.get("text")] + list(m.get("points") or [])))
    if on("faq"):
        for i, q in enumerate(site.get("faq", {}).get("items", [])):
            add("faq:%d" % i, q.get("q"), q.get("a"))
    if on("work"):
        for p in products:
            add("project:%s" % p["id"], p.get("title"), join([p.get("summary")]))
    return recs


def build_kb(draft, ctx, site, products):
    ass = draft["assistant"]
    card_list = cards(draft, site, products)
    public_facts = [f for f in facts(draft, ctx) if f["public"]]
    return {
        "version": 1,
        "hidden": list(ass["hidden"]),
        "ui": {key: i18n_out(site["ui"]["assistant"].get(key)) for key in UI_KEYS},
        "cards": card_list,
        "records": site_records(draft, site, products) + [{"id": "fact:" + f["id"], "topic": i18n_out(f["topic"]), "text": i18n_out(f["text"])} for f in public_facts],
    }
