#!/usr/bin/env python3
"""Prints a sample home page: the factory page plus one example block of every type (anchored #pv-<type>), rendered by the
admin's own block renderer. `projects` and `gallery3d` blocks reuse the page-wide #productGrid, so each gets its own page
(argument = block type; the factory "Проєкти" section is switched off there) and the default page leaves them out. Used only by tools/make-admin-previews.mjs to photograph the block previews; nothing here ships."""
import os
import sys
import tempfile

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(REPO, "radxa-admin", "lib"))

from vadmin import build, core, render, schema   # noqa: E402


def main():
    root = tempfile.mkdtemp(prefix="vadmin-pv-")
    paths = core.Paths(root=root, secret=os.path.join(root, "secret"), src=REPO)
    paths.ensure()
    ctx = schema.Context(paths)
    draft = schema.empty_draft()
    schema.add_from_template(draft, "form", next(iter(ctx.templates["forms"])), ctx)
    forms = draft["forms"]
    pick = sys.argv[1] if len(sys.argv) > 1 else None
    if pick:
        draft["sections"]["work"] = False
    for kind, spec in ctx.blocks.items():
        if (pick and kind != pick) or (not pick and kind in ("projects", "gallery3d")):
            continue
        fields = dict(spec["example"])
        if kind == "form":
            fields["form"] = next(iter(forms))
        draft["extra"]["home"].append({"id": "b-" + kind, "type": kind, "enabled": True, "anchor": "pv-" + kind, "fields": fields})
    html = build.transform_home(build.read_text(os.path.join(REPO, "index.html")), draft, ctx, render.Assets(ctx), forms)
    sys.stdout.write(html)


main()
