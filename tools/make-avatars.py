#!/usr/bin/env python3
"""Generates assets/assistant-avatars.js (the looks of the site assistant). The AI core entry is kept as it is in the file; the people are drawn here.
Usage: python3 tools/make-avatars.py   (run from the repository root, then commit the result)."""
import json, os, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "assets", "assistant-avatars.js")
DOTS = '<g class="av-dots"><circle cx="46" cy="9" r="2.2"/><circle cx="60" cy="9" r="2.2"/><circle cx="74" cy="9" r="2.2"/></g>'


def defs(p, skin, skin_d, cloth, cloth_d, hair, hair_d):
    return (f'<defs><radialGradient id="{p}f" cx=".42" cy=".34" r=".75"><stop offset="0" stop-color="{skin}"/><stop offset="1" stop-color="{skin_d}"/></radialGradient>'
            f'<linearGradient id="{p}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{skin}"/><stop offset="1" stop-color="{skin_d}"/></linearGradient>'
            f'<linearGradient id="{p}j" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{cloth}"/><stop offset="1" stop-color="{cloth_d}"/></linearGradient>'
            f'<linearGradient id="{p}h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{hair}"/><stop offset="1" stop-color="{hair_d}"/></linearGradient></defs>')


def hand(p, x, flip):
    th = ('<rect x="6.2" y="1" width="3.2" height="8" rx="1.6" transform="rotate(28 6 5)"/>' if flip
          else '<rect x="-9.4" y="1" width="3.2" height="8" rx="1.6" transform="rotate(-28 -6 5)"/>')
    return (f'<g class="av-hand" transform="translate({x} 78) scale(.95)" fill="url(#{p}s)" stroke="#0000002a" stroke-width=".6"><rect x="-6" y="-2" width="12" height="11" rx="4"/>'
            '<rect x="-6" y="-10" width="2.8" height="10" rx="1.4"/><rect x="-2.9" y="-12.5" width="2.8" height="12.5" rx="1.4"/><rect x=".2" y="-12" width="2.8" height="12" rx="1.4"/>'
            f'<rect x="3.3" y="-9.5" width="2.8" height="9.5" rx="1.4"/>{th}</g>')


def arms(p, cuff="#f4f6f5"):
    def one(cls, x, flip):
        return (f'<g class="{cls}"><path d="M{x} 130V92" fill="none" stroke="url(#{p}j)" stroke-width="13"/>'
                f'<rect x="{x - 6.5}" y="88" width="13" height="5" rx="2" fill="{cuff}"/>{hand(p, x, flip)}</g>')
    return one("av-armL", 20, True) + one("av-armR", 100, False)


# slimmer, more natural face: narrower jaw and chin
FACE = 'M60 20C46 20 37.5 31 37.5 45.5c0 11.5 4.6 22 12 27.5 3.6 2.8 7.6 5 10.5 5s6.9-2.2 10.5-5c7.4-5.5 12-16 12-27.5C82.5 31 74 20 60 20z'


def eye(cx, iris, lash):
    x0 = cx - 4.8
    s = (f'<path d="M{x0} 47.6q4.8-5 9.6 0q-4.8 3.8-9.6 0z" fill="#fbfbf8"/><circle cx="{cx}" cy="47.2" r="2.5" fill="{iris}"/><circle cx="{cx}" cy="47.2" r="1.1" fill="#120c0a"/>'
         f'<circle cx="{cx + .8}" cy="46.4" r=".7" fill="#fff"/><path d="M{x0 - .4} 47.6q5.2-5.6 10.4 0" fill="none" stroke="#2a1b17" stroke-width="1.4" stroke-linecap="round"/>')
    if lash:
        s += f'<path d="M{x0 - .2} 46.8q-1.2-.2-2 .6" stroke="#2a1b17" stroke-width="1" stroke-linecap="round" fill="none"/>'
    return s


def head(p, brow, iris, lash=False, lip="#b9605a", lip2="#cf7a70", noseshade="#a56a4c", glasses=False):
    g = ('<g fill="none" stroke="#1c1f24" stroke-width="1.5"><rect x="42.4" y="41.4" width="15.2" height="11.6" rx="4.4"/><rect x="62.4" y="41.4" width="15.2" height="11.6" rx="4.4"/><path d="M57.6 46.4q2.4-1.6 4.8 0"/>'
         '<path d="M42.4 45l-5-1.6M77.6 45l5-1.6" stroke-linecap="round"/></g>') if glasses else ''
    return (f'<path d="{FACE}" fill="url(#{p}f)"/>'
            f'<ellipse cx="37.4" cy="51" rx="2.8" ry="5" fill="url(#{p}s)"/><ellipse cx="82.6" cy="51" rx="2.8" ry="5" fill="url(#{p}s)"/>'
            '<ellipse cx="46" cy="59.5" rx="5" ry="3" fill="#e8847a" opacity=".14"/><ellipse cx="74" cy="59.5" rx="5" ry="3" fill="#e8847a" opacity=".14"/>'
            f'<g class="av-eyes">{eye(50, iris, lash)}{eye(70, iris, lash)}</g>'
            f'<path d="M44.4 41.4q5-3 10.4-1.2M65.2 40.2q5.4-1.8 10.4 1.2" fill="none" stroke="{brow}" stroke-width="2" stroke-linecap="round"/>'
            f'<path d="M60.5 48.5q-2.2 7-.6 9.2 2.4 1.6 4.4-.2" fill="none" stroke="{noseshade}" stroke-width="1.2" stroke-linecap="round" opacity=".5"/>'
            f'<g class="av-mouth"><path d="M53.4 65q3.2-2.2 6.6-.7 3.4-1.5 6.6.7-6.6 2.8-13.2 0z" fill="{lip}"/><path d="M54.2 65.4q5.8 5.4 11.6 0-5.8 1.8-11.6 0z" fill="{lip2}"/></g>' + g)


def neck(p):
    return f'<path d="M52.5 70v17q7.5 7 15 0V70z" fill="url(#{p}s)"/><path d="M52.5 79q7.5 5 15 0v-6q-7.5 4-15 0z" fill="#6e4429" opacity=".28"/>'


def wrap_head(inner):          # whole head a little smaller than before: better proportions against the shoulders
    return f'<g class="av-head"><g transform="translate(60 72) scale(.92) translate(-60 -72)">{inner}</g>{DOTS}</g>'


def person(p, d, back="", body="", front="", extra="", **kw):
    return d + back + body + arms(p) + wrap_head(neck(p) + head(p, **kw) + extra + front)


# ---- consultant (woman)
p = "cf"
cf = person(p, defs(p, "#f8d9c2", "#e6b392", "#2f4b5a", "#1b2f3a", "#6a3d2c", "#33190f"),
  back=f'<path d="M37 44C31 16 52 8 62 9c14 1 27 10 21 36 2 20 6 40-4 52H45c-10-12-6-32-8-53z" fill="url(#{p}h)"/>',
  body=(f'<g class="av-body"><path d="M12 120c0-19 14-30 32-34l16 11 16-11c18 4 32 15 32 34z" fill="url(#{p}j)"/>'
        '<path d="M45 86l15 20 15-20-6-3-9 10-9-10z" fill="#f6efe6"/><path d="M44 86l16 22-9 12M76 86L60 108l9 12" fill="none" stroke="#46687a" stroke-width="2" stroke-linejoin="round"/>'
        '<path d="M49 93q11 13 22 0" fill="none" stroke="#d9b36a" stroke-width="1.1"/><circle cx="60" cy="100.5" r="1.7" fill="#d9b36a"/></g>'),
  front=(f'<path d="M37.5 46c-1-16 8-27 22.5-27 14.5 0 23.5 9 22.5 26-4-8-9-13-16-15-9 5-20 6-29 16z" fill="url(#{p}h)"/>'
         '<path d="M41 31q9-8 22-7M46 27q7-4 14-4" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity=".22"/>'
         f'<path d="M38 55c-3 14-1 28 4 36l-5-1c-6-12-6-26-3-40zM82 55c3 14 1 28-4 36l5-1c6-12 6-26 3-40z" fill="url(#{p}h)"/>'),
  brow="#4a2a20", iris="#6b4a2f", lash=True, lip="#b85a5a", lip2="#cf7a76")

# ---- consultant (man)
p = "cm"
cm = person(p, defs(p, "#edc6a2", "#d49d76", "#2a3d5c", "#16233a", "#2e2622", "#14100e"),
  body=(f'<g class="av-body"><path d="M12 120c0-19 14-30 32-34l16 11 16-11c18 4 32 15 32 34z" fill="url(#{p}j)"/><path d="M45 86l15 16 15-16-6-4-9 8-9-8z" fill="#f6f7f9"/>'
        '<path d="M44 86l16 18-9 16M76 86L60 104l9 16" fill="none" stroke="#3b5478" stroke-width="2" stroke-linejoin="round"/>'
        '<path d="M57 97h6l1.8 4-3.400 3.400-3.400-3.400z" fill="var(--accent-strong)"/><path d="M57.4 104.6h5.2l2.4 15H55z" fill="var(--accent)"/><circle cx="74" cy="104" r="1.7" fill="var(--accent)"/></g>'),
  extra='<path d="M46 66c3 9 8 13 14 13s11-4 14-13c-2 5-7 9-14 9s-12-4-14-9z" fill="#3a2b24" opacity=".2"/>',
  front=(f'<path d="M36.5 46c-4-19 6-32 23.5-32 18 0 27 12 23 32-2-8-5-13-10-16-10 4-22 3-30-1-3 4-5 10-7 17z" fill="url(#{p}h)"/>'
         '<path d="M45 22q9-5 19-3M51 18q6-2 12-1" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".18"/>'),
  brow="#2b221d", iris="#4a3a2c", lip="#aa5a52", lip2="#c27068")

# ---- engineer with a headset
p = "en"
en = person(p, defs(p, "#f1cdae", "#dba885", "#1f8f78", "#145e51", "#6e4a2e", "#2d1d10"),
  body=(f'<g class="av-body"><path d="M12 120c0-19 14-30 32-34l16 9 16-9c18 4 32 15 32 34z" fill="url(#{p}j)"/>'
        '<path d="M46 86q14 13 28 0l4 6q-18 15-36 0z" fill="#0f4d42" opacity=".55"/><path d="M53 94v10M67 94v10" stroke="#e8f6f1" stroke-width="1.8" stroke-linecap="round"/></g>'),
  front=(f'<path d="M37 47c-5-19 5-32 23-32 18 0 28 12 23 32-1-8-3-12-8-15-6 5-13 3-19 0-8 2-14 6-16 12-1 1-2 2-3 3z" fill="url(#{p}h)"/>'
         '<path d="M36 47c-1-17 9-29 24-29s25 12 24 29" fill="none" stroke="#1d2a33" stroke-width="3.2" stroke-linecap="round"/>'
         '<rect x="31.5" y="44" width="8.500" height="15" rx="4.200" fill="#223039"/><rect x="80" y="44" width="8.500" height="15" rx="4.200" fill="#223039"/>'
         '<rect x="33" y="46" width="2" height="11" rx="1" fill="var(--accent)" opacity=".8"/><rect x="85" y="46" width="2" height="11" rx="1" fill="var(--accent)" opacity=".8"/>'
         '<path d="M84.500 58q0 12-18 15" fill="none" stroke="#223039" stroke-width="2.300" stroke-linecap="round"/><ellipse cx="64.500" cy="73.500" rx="4" ry="2.500" fill="#1d2a33"/>'),
  brow="#4a3320", iris="#3d5560", lip="#b45f58", lip2="#cc7a70")

# ---- expert: dark skin, short natural hair, glasses, charcoal suit with an accent pocket square
p = "ex"
ex = person(p, defs(p, "#9a6544", "#6f4429", "#38414d", "#1e242d", "#1c1512", "#0b0807"),
  body=(f'<g class="av-body"><path d="M12 120c0-19 14-30 32-34l16 11 16-11c18 4 32 15 32 34z" fill="url(#{p}j)"/><path d="M45 86l15 15 15-15-6-4-9 8-9-8z" fill="#f4f6f8"/>'
        '<path d="M44 86l16 17-9 17M76 86L60 103l9 17" fill="none" stroke="#56606e" stroke-width="2" stroke-linejoin="round"/>'
        '<path d="M58 96.500h4l1.500 3.200-3.500 3-3.500-3z" fill="#1c2733"/><path d="M58 102h4l2 18h-8z" fill="#22303f"/>'
        '<path d="M80 100l7-1.500 1 6-7.500 1z" fill="var(--accent)"/></g>'),
  extra='<path d="M46 67c3 8 8 12 14 12s11-4 14-12c-2 4-7 7-14 7s-12-3-14-7z" fill="#0b0807" opacity=".35"/>',
  front=(f'<path d="M37 45c-3-17 6-27 23-27s26 10 23 27c-2-6-5-10-9-12-9 3-19 3-28 0-4 2-7 6-9 12z" fill="url(#{p}h)"/>'
         '<path d="M44 26q8-4 16-4M62 22q8 0 14 5" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".12"/>'),
  brow="#120c0a", iris="#2a1a12", lip="#7a3f3a", lip2="#8f4d46", noseshade="#4d2c1c", glasses=True)

src = open(OUT, encoding="utf-8").read()
core = json.loads(re.search(r'"core": \{ name: \{[^}]*\}, svg: (".*?") \},\n  \},', src, re.S).group(1))
av = {"consultant-f": ("Консультантка", "Consultant (she)", "Beraterin", cf), "consultant-m": ("Консультант", "Consultant (he)", "Berater", cm),
      "expert": ("Експерт", "Expert", "Experte", ex), "engineer": ("Інженер на звʼязку", "Engineer on call", "Ingenieur am Draht", en), "core": ("Ядро ШІ", "AI core", "KI-Kern", core)}
out = ("// Avatars of the site assistant: one entry per look, all with the same parts so one set of animations moves each (groups av-body, av-armL, av-armR, av-head, av-eyes, av-mouth).\n"
       "// Shared by the widget (assistant.js) and the admin preview. Static markup only. Generated by tools/make-avatars.py (the AI core entry is kept as it is).\n")
out += "window.VITEH_AVATARS = {\n  order: " + json.dumps(list(av)) + ",\n  items: {\n"
for k, (u, e, d, svg) in av.items():
    out += f'    {json.dumps(k)}: {{ name: {{ uk: {json.dumps(u, ensure_ascii=False)}, en: {json.dumps(e)}, de: {json.dumps(d)} }}, svg: {json.dumps(svg, ensure_ascii=False)} }},\n'
out += "  },\n};\n"
open(OUT, "w", encoding="utf-8").write(out)
print("ok", list(av))
