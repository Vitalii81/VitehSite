#!/usr/bin/env python3
"""Generates assets/assistant-avatars.js (the looks of the site assistant). The AI core entry is kept as it is in the file; the people are drawn here.
Every person shares one drawing system (layered skin shading, lidded eyes with highlights, filled brows, shaped lips, clothing with seams and folds),
only colours, hair and accessories differ. Parts: av-body, av-armL, av-armR, av-head (av-eyes, av-mouth, av-dots), as the animations expect.
Gradient ids use letters only (the widget renames them per copy).
Usage: python3 tools/make-avatars.py   (from the repository root; commit the result)."""
import json, os, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "assets", "assistant-avatars.js")
DOTS = '<g class="av-dots"><circle cx="46" cy="9" r="2.2"/><circle cx="60" cy="9" r="2.2"/><circle cx="74" cy="9" r="2.2"/></g>'
FACE = 'M60 20C46 20 37.5 31 37.5 45.5c0 11.5 4.6 22 12 27.5 3.6 2.8 7.6 5 10.5 5s6.9-2.2 10.5-5c7.4-5.5 12-16 12-27.5C82.5 31 74 20 60 20z'


def grad(i, kind, stops, extra=""):
    st = "".join(f'<stop offset="{o}" stop-color="{c}"{"" if a is None else f" stop-opacity=\"{a}\""}/>' for o, c, a in stops)
    return f'<{kind}Gradient id="{i}" {extra}>{st}</{kind}Gradient>'


def defs(p, skin, deep, cloth, cloth2, hair, hair2, iris):
    return ("<defs>"
            + grad(p + "f", "radial", [(0, skin, None), (.7, skin, None), (1, deep, None)], 'cx=".4" cy=".3" r=".8"')
            + grad(p + "s", "linear", [(0, skin, None), (1, deep, None)], 'x1="0" y1="0" x2="0" y2="1"')
            + grad(p + "j", "linear", [(0, cloth, None), (1, cloth2, None)], 'x1="0" y1="0" x2="1" y2="1"')
            + grad(p + "h", "linear", [(0, hair, None), (1, hair2, None)], 'x1="0" y1="0" x2="1" y2="1"')
            + grad(p + "i", "radial", [(0, iris[0], None), (.75, iris[1], None), (1, iris[2], None)], 'cx=".5" cy=".4" r=".6"')
            + grad(p + "l", "linear", [(0, "#fff", .5), (1, "#fff", 0)], 'x1="0" y1="0" x2="0" y2="1"')
            + grad(p + "m", "radial", [(0, deep, 0), (.62, deep, 0), (1, deep, .42)], 'cx=".5" cy=".45" r=".62"')
            + grad(p + "k", "linear", [(0, "#000", 0), (1, "#000", .3)], 'x1="0" y1="0" x2="0" y2="1"')
            + "</defs>")


def hand(p, x, flip, tone):
    th = ('<rect x="6.2" y="1" width="3.2" height="8" rx="1.6" transform="rotate(28 6 5)"/>' if flip
          else '<rect x="-9.4" y="1" width="3.2" height="8" rx="1.6" transform="rotate(-28 -6 5)"/>')
    return (f'<g class="av-hand" transform="translate({x} 78) scale(.95)" fill="url(#{p}s)" stroke="{tone}" stroke-width=".6"><rect x="-6" y="-2" width="12" height="11" rx="4"/>'
            '<rect x="-6" y="-10" width="2.8" height="10" rx="1.4"/><rect x="-2.9" y="-12.5" width="2.8" height="12.5" rx="1.4"/><rect x=".2" y="-12" width="2.8" height="12" rx="1.4"/>'
            f'<rect x="3.3" y="-9.5" width="2.8" height="9.5" rx="1.4"/>{th}</g>')


def arms(p, tone, cuff="#f4f6f5"):
    def one(cls, x, flip):
        # a rect, not a stroked line: a gradient on a zero-width box paints nothing (the arm looked like a thread)
        return (f'<g class="{cls}"><rect x="{x - 6.5}" y="90" width="13" height="26" rx="5.500" fill="url(#{p}j)"/>'
                f'<rect x="{x - 4}" y="92" width="2.600" height="22" rx="1.300" fill="#fff" opacity=".13"/>'
                f'<rect x="{x - 7.200}" y="87.500" width="14.400" height="6" rx="2.400" fill="{cuff}"/>{hand(p, x, flip, tone)}</g>')
    return one("av-armL", 20, True) + one("av-armR", 100, False)


def eye(p, cx, n, lash, lid, deep):
    x0, x1 = cx - 5.2, cx + 5.2
    s = (f'<clipPath id="{p}c{"ab"[n]}"><path d="M{x0} 47.7Q{cx} 43.3 {x1} 47.7Q{cx} 50.6 {x0} 47.7z"/></clipPath>'
         f'<ellipse cx="{cx}" cy="46.6" rx="8" ry="5" fill="{deep}" opacity=".09"/>'
         f'<path d="M{x0} 47.7Q{cx} 43.3 {x1} 47.7Q{cx} 50.6 {x0} 47.7z" fill="#f7f4ef"/>'
         f'<g clip-path="url(#{p}c{"ab"[n]})"><circle cx="{cx}" cy="47.1" r="3" fill="url(#{p}i)"/><circle cx="{cx}" cy="47.1" r="1.25" fill="#0d0908"/>'
         f'<circle cx="{cx + 1}" cy="46.2" r=".85" fill="#fff"/><circle cx="{cx - 1.1}" cy="48.2" r=".4" fill="#fff" opacity=".7"/>'
         f'<path d="M{x0} 47.7Q{cx} 43.3 {x1} 47.7V43H{x0}z" fill="#000" opacity=".16"/></g>'
         f'<path d="M{x0 - .3} 47.9Q{cx} 42.9 {x1 + .3} 47.9" fill="none" stroke="{lid}" stroke-width="1.35" stroke-linecap="round"/>'
         f'<path d="M{x0 + .8} 44.6Q{cx} 41.1 {x1 - .8} 44.6" fill="none" stroke="{deep}" stroke-opacity=".35" stroke-width=".7" stroke-linecap="round"/>'
         f'<path d="M{cx - 3.6} 49.6Q{cx} 51 {cx + 3.6} 49.6" fill="none" stroke="{deep}" stroke-opacity=".3" stroke-width=".6" stroke-linecap="round"/>')
    if lash:
        o = -1 if n == 0 else 1
        s += (f'<path d="M{(x0 if n == 0 else x1)} 47.4q{o * -1.6}-.4 {o * -2.4}.7M{(x0 if n == 0 else x1) + o * .8} 45.8q{o * -1.4}-.8 {o * -2.1}-.1" '
              f'stroke="{lid}" stroke-width=".9" stroke-linecap="round" fill="none"/>')
    return s


def brows(color, thick=1.0, y=0):
    t = thick
    return (f'<path d="M43.2 {42.6 + y}Q48 {38.6 + y} 55.4 {39.6 + y}L55.2 {41.4 + y - .3 * t}Q48.6 {40.6 + y} 44 {43.8 + y}z" fill="{color}"/>'
            f'<path d="M76.8 {42.6 + y}Q72 {38.6 + y} 64.6 {39.6 + y}L64.8 {41.4 + y - .3 * t}Q71.4 {40.6 + y} 76 {43.8 + y}z" fill="{color}"/>')


def nose(deep):
    return (f'<path d="M58.4 45.5Q57.3 53 55.8 57" fill="none" stroke="{deep}" stroke-opacity=".28" stroke-width="1" stroke-linecap="round"/>'
            f'<path d="M61.7 46Q62 52 63.4 56.6" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="1.2" stroke-linecap="round"/>'
            f'<path d="M55.6 58.4q1.9 2 4.4.8q2.5 1.200 4.4-.8" fill="none" stroke="{deep}" stroke-opacity=".5" stroke-width="1" stroke-linecap="round"/>'
            f'<ellipse cx="60" cy="56" rx="2" ry="1.3" fill="#fff" opacity=".16"/>'
            f'<ellipse cx="56.2" cy="58.8" rx="1" ry=".6" fill="{deep}" opacity=".35"/><ellipse cx="63.8" cy="58.8" rx="1" ry=".6" fill="{deep}" opacity=".35"/>')


def mouth(p, lip, lip2, deep):
    return (f'<g class="av-mouth"><path d="M53 65.2Q56.4 62.6 60 64Q63.6 62.6 67 65.2Q63.6 66.5 60 66.3Q56.4 66.5 53 65.2z" fill="{lip}"/>'
            f'<path d="M54 65.8Q60 72 66 65.8Q60 67.4 54 65.8z" fill="{lip2}"/>'
            f'<path d="M57.4 68.2Q60 69.4 62.6 68.2" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width=".9" stroke-linecap="round"/>'
            f'<path d="M53.2 65.4Q60 67.4 66.8 65.4" fill="none" stroke="{deep}" stroke-opacity=".6" stroke-width=".7" stroke-linecap="round"/></g>'
            f'<path d="M60 70.5q0 2 0 2.2" stroke="{deep}" stroke-opacity="0" fill="none"/>')


def face_shading(p, deep, blush):
    return (f'<path d="{FACE}" fill="url(#{p}m)"/>'
            f'<ellipse cx="45.500" cy="58.500" rx="5.500" ry="3.200" fill="{blush}" opacity=".2"/><ellipse cx="74.500" cy="58.500" rx="5.500" ry="3.200" fill="{blush}" opacity=".2"/>'
            f'<ellipse cx="52" cy="34" rx="9" ry="5" fill="#fff" opacity=".1"/><ellipse cx="60" cy="74.500" rx="4" ry="1.800" fill="#fff" opacity=".08"/>'
            f'<path d="M50.500 77.500q9.500 4.600 19 0q-9.500 1.800-19 0z" fill="{deep}" opacity=".22"/>')


def ears(p, deep, ring=None):
    s = (f'<ellipse cx="37.400" cy="51" rx="2.900" ry="5.200" fill="url(#{p}s)"/><ellipse cx="82.600" cy="51" rx="2.900" ry="5.200" fill="url(#{p}s)"/>'
         f'<path d="M37 48.500q-1.400 2.500 0 5M83 48.500q1.400 2.500 0 5" stroke="{deep}" stroke-opacity=".4" stroke-width=".8" fill="none" stroke-linecap="round"/>')
    if ring:
        s += f'<circle cx="37.300" cy="56.800" r="1.700" fill="{ring}"/><circle cx="82.700" cy="56.800" r="1.700" fill="{ring}"/>'
    return s


def neck(p, deep):
    return (f'<path d="M52 70v17q8 7.500 16 0V70z" fill="url(#{p}s)"/>'
            f'<path d="M52 77q8 6 16 0v-7q-8 5-16 0z" fill="{deep}" opacity=".4"/>')


def glasses(color="#1b1f26"):
    return (f'<g fill="none" stroke="{color}" stroke-width="1.5"><rect x="42" y="41.200" width="16" height="11.800" rx="4.600"/><rect x="62" y="41.200" width="16" height="11.800" rx="4.600"/>'
            f'<path d="M58 46.300q2-1.600 4 0"/><path d="M42 45l-4.600-1.600M78 45l4.600-1.600" stroke-linecap="round"/></g>'
            '<path d="M44 43.500l5-1.200M64 43.500l5-1.200" stroke="#fff" stroke-opacity=".35" stroke-width="1" stroke-linecap="round"/>')


def body_suit(p, cloth_line, shirt, tie=None, lapel="#fff", chain=None):
    s = (f'<g class="av-body"><path d="M10 120c0-20 15-31 34-35l16 12 16-12c19 4 34 15 34 35z" fill="url(#{p}j)"/>'
         f'<path d="M10 120c0-20 15-31 34-35l16 12v23z" fill="#fff" opacity=".06"/>'
         f'<path d="M44 85l16 12 16-12" fill="none" stroke="#000" stroke-opacity=".2" stroke-width="1"/>'
         f'<path d="M45.500 86l14.500 21 14.500-21-5-2.500-9.500 9-9.500-9z" fill="{shirt}"/>'
         f'<path d="M45.500 86l14.500 21 14.500-21" fill="none" stroke="#000" stroke-opacity=".12" stroke-width=".8"/>'
         f'<path d="M43 85.500l16.500 23.500-8 11M77 85.500L60.500 109l8 11" fill="none" stroke="{cloth_line}" stroke-width="2" stroke-linejoin="round"/>'
         f'<path d="M30 102q4 8 3 18M90 102q-4 8-3 18" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="1.2" stroke-linecap="round"/>'
         f'<ellipse cx="60" cy="90.500" rx="9" ry="3.500" fill="#000" opacity=".18"/>')
    if tie:
        s += (f'<path d="M57.200 97.500h5.600l1.800 3.800-4.600 3.800-4.600-3.800z" fill="{tie}"/><path d="M57.600 105h4.800l2.600 15H55z" fill="{tie}"/>'
              '<path d="M60 100v18" stroke="#000" stroke-opacity=".18" stroke-width=".8"/><path d="M57.500 98l2.500 2 2.500-2" stroke="#fff" stroke-opacity=".25" fill="none" stroke-width=".7"/>')
    if chain:
        s += f'<path d="M49 93q11 13 22 0" fill="none" stroke="{chain}" stroke-width="1.1"/><circle cx="60" cy="101.500" r="1.800" fill="{chain}"/><circle cx="59.400" cy="101" r=".6" fill="#fff" opacity=".7"/>'
    return s + "</g>"


def wrap_head(inner):
    return f'<g class="av-head"><g transform="translate(60 72) scale(.92) translate(-60 -72)">{inner}</g>{DOTS}</g>'


def person(p, palette, *, back="", body, hair_front="", extra="", brow="#2b1b14", iris=("#9a7a52", "#6a4a2a", "#2b1a0e"), lash=False,
           lip="#b9605a", lip2="#cf7a70", ring=None, glass=False, thick=1.0, blush="#e8847a", brow_y=0):
    skin, deep = palette["skin"], palette["deep"]
    d = defs(p, skin, deep, palette["cloth"], palette["cloth2"], palette["hair"], palette["hair2"], iris)
    head = (back + neck(p, deep) + ears(p, deep, ring) + f'<path d="{FACE}" fill="url(#{p}f)"/>' + face_shading(p, deep, blush)
            + f'<g class="av-eyes">{eye(p, 50, 0, lash, "#2a1b17", deep)}{eye(p, 70, 1, lash, "#2a1b17", deep)}</g>'
            + brows(brow, thick, brow_y) + nose(deep) + mouth(p, lip, lip2, deep) + extra + (glasses() if glass else "") + hair_front)
    return d + arms(p, deep) + body + wrap_head(head)          # arms first: the sleeve comes out from behind the torso, not floating beside it


def back_body(p, palette):
    return ""


# ------------------------------------------------------------------ the people
def consultant_f():
    p = "cf"
    pal = dict(skin="#f6d5bd", deep="#d9a583", cloth="#2d4a5a", cloth2="#182c38", hair="#7a4330", hair2="#3a1c11")
    back = (f'<path d="M36 46C30 17 52 7 62 8c15 1 28 11 22 38 3 22 7 42-5 54Q61.500 106 44 100c-12-12-8-32-8-54z" fill="url(#{p}h)"/>'
            '<path d="M40 60c-2 14 0 28 6 38M80 60c2 14 0 28-6 38" stroke="#000" stroke-opacity=".18" stroke-width="2" fill="none" stroke-linecap="round"/>')
    front = (f'<path d="M37.500 46c-1.500-17 8-28 22.500-28s24 10 22.500 27c-4-8-9-13.500-17-15.500-8 4.500-19 6-28 16.500z" fill="url(#{p}h)"/>'
             f'<path d="M37.800 47c-3 14-1 29 4 38l-5.500-1c-6-12-6-27-2-41zM82.200 47c3 14 1 29-4 38l5.500-1c6-12 6-27 2-41z" fill="url(#{p}h)"/>'
             '<path d="M42 30q9-9 22-7M47 26q8-5 15-4M52 31q10-4 18 1" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".28"/>'
             '<path d="M38.500 56c-1.500 10 0 20 3 27M81.500 56c1.500 10 0 20-3 27" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".16"/>'
             '<path d="M41 33q4 6 11 8" fill="none" stroke="#000" stroke-opacity=".15" stroke-width="1.200" stroke-linecap="round"/>')
    return person(p, pal, back=back, body=body_suit(p, "#48697b", "#f6efe6", chain="#d9b36a"), hair_front=front, brow="#4a2a20",
                  iris=("#8a6a43", "#5c3f22", "#26170b"), lash=True, lip="#b45a5a", lip2="#cf7c78", ring="#d9b36a", thick=.9)


def consultant_m():
    p = "cm"
    pal = dict(skin="#eec8a4", deep="#cf9a72", cloth="#2a3d5c", cloth2="#15223a", hair="#34281f", hair2="#120d0a")
    front = (f'<path d="M36.500 46c-4-19 6-32 23.500-32 18 0 27 12 23 32-2-8-5-13-10-16-10 4-22 3-30-1-3 4-5 10-7 17z" fill="url(#{p}h)"/>'
             '<path d="M45 22q9-5 19-3M51 18q6-2 12-1M40 30q3-5 8-8M56 21q8-1 14 2" fill="none" stroke="#fff" stroke-width="1.200" stroke-linecap="round" opacity=".2"/>'
             '<path d="M36.500 46c-.5-6 0-10 1.500-14M83.500 46c.5-6 0-10-1.500-14" fill="none" stroke="#000" stroke-width="3" opacity=".12"/>')
    stubble = '<path d="M46 66c3 10 8 14 14 14s11-4 14-14c-2 5-7 9-14 9s-12-4-14-9z" fill="#2b2018" opacity=".22"/><path d="M52 62.800q8-1.800 16 0" stroke="#2b2018" stroke-opacity=".12" stroke-width="1.500" fill="none"/>'
    return person(p, pal, body=body_suit(p, "#3b5478", "#f6f7f9", tie="var(--accent)"), hair_front=front, extra=stubble, brow="#2a2019",
                  iris=("#6c5238", "#46331f", "#1d130b"), lip="#a85a52", lip2="#bf6e66", thick=1.2)


def expert():
    p = "ex"
    pal = dict(skin="#9b6746", deep="#6b4129", cloth="#3b4450", cloth2="#1e242d", hair="#1d1612", hair2="#0a0706")
    front = (f'<path d="M36.500 44c-3.500-18 6-28 23.500-28s27 10 23.500 28c-1.500-6-4.500-10-8.500-12.500-9 3-19.500 3-29 0-4 2.500-7 6.500-9.500 12.500z" fill="url(#{p}h)"/>'
             '<path d="M44 25q8-4 16-4M62 21q8 0 14 5M38 36q1-6 5-10" fill="none" stroke="#fff" stroke-width="1.200" stroke-linecap="round" opacity=".14"/>')
    beard = ('<path d="M39.500 55c1 14 8 22 20.500 22s19.500-8 20.500-22c-1.500 6-4 10-8 12.500-3-2-6-3-12.500-3s-9.500 1-12.500 3c-4-2.500-6.500-6.500-8-12.500z" fill="#0f0a08" opacity=".78"/>'
             '<path d="M52 63.500q8-2.600 16 0" fill="none" stroke="#0f0a08" stroke-width="2.200" stroke-linecap="round" opacity=".8"/>')
    return person(p, pal, body=body_suit(p, "#5a6472", "#f4f6f8", tie="#1c2733", lapel="#fff").replace('<path d="M43', '<path d="M80 100l7-1.500 1 6-7.500 1z" fill="var(--accent)"/><path d="M43', 1),
                  hair_front=front, extra=beard, glass=True, brow="#120c0a", iris=("#6a4529", "#3e2713", "#150b05"), lip="#7a413a", lip2="#8f4f47", thick=1.3, blush="#b25c3f")


def expert_f():
    p = "ef"
    pal = dict(skin="#a56b49", deep="#70442c", cloth="#7b3550", cloth2="#46182c", hair="#1a1210", hair2="#080505")
    back = (f'<g fill="url(#{p}h)"><circle cx="60" cy="25" r="25"/><circle cx="40" cy="36" r="13"/><circle cx="80" cy="36" r="13"/><circle cx="35" cy="54" r="9"/><circle cx="85" cy="54" r="9"/>'
            '<circle cx="46" cy="14" r="10"/><circle cx="74" cy="14" r="10"/></g>')
    front = (f'<path d="M38 46c-2.500-14 5-25 22-25s24.500 11 22 25c-1.500-8-4.500-13-10-16-8 3-16 3.500-24 0-5 3-8 8-10 16z" fill="url(#{p}h)"/>'
             '<g fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".14"><path d="M44 27q4-4 9-4M60 19q7 0 11 4M36 40q1-5 4-8"/></g>')
    return person(p, pal, back=back, body=body_suit(p, "#9a4f6c", "#f3ebe3", chain="#e0b860"), hair_front=front, brow="#140d0b", iris=("#7a4e2c", "#4a2c15", "#180c05"),
                  lash=True, lip="#8f3f4a", lip2="#a85660", ring="#e0b860", thick=.9, blush="#c0624a")


def engineer():
    p = "en"
    pal = dict(skin="#f2cfb0", deep="#d6a583", cloth="#1f8f78", cloth2="#135a4d", hair="#7a5232", hair2="#33200f")
    back = (f'<path d="M80 36c10 4 12 20 8 34 2 6 0 14-8 18-3-8-2-14 0-20z" fill="url(#{p}h)"/>'
            f'<path d="M40 36c-10 4-12 20-8 34-2 6 0 14 8 18 3-8 2-14 0-20z" fill="url(#{p}h)"/>')
    front = (f'<path d="M37 47c-5-19 5-31 23-31 18 0 28 12 23 31-1-8-3-12.500-8-15.500-6 5-13 3-19 0-8 2-14 6.500-16 12.500-1 1.500-2 2.500-3 3z" fill="url(#{p}h)"/>'
             '<path d="M46 24q8-5 17-2M40 33q3-6 8-8" fill="none" stroke="#fff" stroke-width="1.200" stroke-linecap="round" opacity=".22"/>'
             '<path d="M36 47c-1-17 9-29 24-29s25 12 24 29" fill="none" stroke="#1d2a33" stroke-width="3.200" stroke-linecap="round"/>'
             '<rect x="31" y="43.500" width="9" height="15.500" rx="4.300" fill="#223039"/><rect x="80" y="43.500" width="9" height="15.500" rx="4.300" fill="#223039"/>'
             '<rect x="33" y="46" width="2.200" height="11" rx="1.100" fill="var(--accent)" opacity=".85"/><rect x="85" y="46" width="2.200" height="11" rx="1.100" fill="var(--accent)" opacity=".85"/>'
             '<path d="M84.500 58.500q0 12-18 15" fill="none" stroke="#223039" stroke-width="2.300" stroke-linecap="round"/><ellipse cx="64.500" cy="73.500" rx="4.200" ry="2.600" fill="#1d2a33"/>'
             '<ellipse cx="63.600" cy="72.800" rx="1.500" ry=".8" fill="#fff" opacity=".25"/>')
    body = (f'<g class="av-body"><path d="M10 120c0-20 15-31 34-35l16 10 16-10c19 4 34 15 34 35z" fill="url(#{p}j)"/><path d="M10 120c0-20 15-31 34-35l16 10v25z" fill="#fff" opacity=".07"/>'
            '<path d="M46 86q14 13 28 0l4 6q-18 15-36 0z" fill="#0f4d42" opacity=".6"/><path d="M53 94v10M67 94v10" stroke="#e8f6f1" stroke-width="1.800" stroke-linecap="round"/>'
            '<path d="M30 102q4 8 3 18M90 102q-4 8-3 18" fill="none" stroke="#000" stroke-opacity=".14" stroke-width="1.200" stroke-linecap="round"/><rect x="26" y="108" width="12" height="6" rx="1.500" fill="#e8f6f1" opacity=".9"/>'
            '<ellipse cx="60" cy="90.500" rx="9" ry="3.500" fill="#000" opacity=".18"/></g>')
    return person(p, pal, back=back, body=body, hair_front=front, brow="#4a3320", iris=("#6f8a96", "#3d5560", "#142026"), lash=True, lip="#b45f58", lip2="#cc7a70", thick=.95)


def senior():
    p = "sr"
    pal = dict(skin="#efc9a8", deep="#c99870", cloth="#4a3b5c", cloth2="#261c34", hair="#d7d9dc", hair2="#8c9096")
    front = (f'<path d="M37 45c-3-18 7-29 23-29s26 11 23 29c-1.500-6-4-10-8-12.500-9 3-20 2.500-29-1-4 3-7 8-9 13.500z" fill="url(#{p}h)"/>'
             '<path d="M44 24q8-5 17-3M52 20q8-1 14 2M39 33q3-6 8-8" fill="none" stroke="#fff" stroke-width="1.300" stroke-linecap="round" opacity=".6"/>'
             '<path d="M37 45c-.5-6 0-10 1.500-14M83 45c.5-6 0-10-1.500-14" fill="none" stroke="#7b7f86" stroke-width="2" opacity=".35"/>')
    beard = ('<path d="M41 57c1 11 8 19 19 19s18-8 19-19c-1 4-3 8-6.500 10.500-2.800-1.800-6-2.800-12.500-2.800s-9.700 1-12.500 2.800C44 65 42 61 41 57z" fill="url(#srh)" opacity=".92"/>'
             '<path d="M51 64q9-3.600 18 0q-2 2-9 2.200T51 64z" fill="url(#srh)"/>')
    lines = '<path d="M45 38.500q5-1.500 10 0M65 38.500q5-1.500 10 0M42 57q1 3 3 5M78 57q-1 3-3 5" fill="none" stroke="#a87a58" stroke-opacity=".28" stroke-width=".7" stroke-linecap="round"/>'
    return person(p, pal, body=body_suit(p, "#6a5882", "#f3eff6", tie="#a8445a"), hair_front=front, extra=beard + lines, glass=True, brow="#9a9da3",
                  iris=("#6f8794", "#42606c", "#17262c"), lip="#a65f58", lip2="#bd756d", thick=1.4)


src = open(OUT, encoding="utf-8").read()
core = json.loads(re.search(r'"core": \{ name: \{[^}]*\}, svg: (".*?") \},\n  \},', src, re.S).group(1))
av = {
    "consultant-f": ("Консультантка", "Consultant (she)", "Beraterin", consultant_f()),
    "consultant-m": ("Консультант", "Consultant (he)", "Berater", consultant_m()),
    "expert": ("Експерт", "Expert", "Experte", expert()),
    "expert-f": ("Експертка", "Expert (she)", "Expertin", expert_f()),
    "engineer": ("Інженерка на звʼязку", "Engineer on call", "Ingenieurin am Draht", engineer()),
    "senior": ("Наставник", "Mentor", "Mentor", senior()),
    "core": ("Ядро ШІ", "AI core", "KI-Kern", core),
}
out = ("// Avatars of the site assistant: one entry per look, all with the same parts so one set of animations moves each (groups av-body, av-armL, av-armR, av-head, av-eyes, av-mouth).\n"
       "// Shared by the widget (assistant.js) and the admin preview. Static markup only. Generated by tools/make-avatars.py (the AI core entry is kept as it is).\n")
out += "window.VITEH_AVATARS = {\n  order: " + json.dumps(list(av)) + ",\n  items: {\n"
for k, (u, e, d, svg) in av.items():
    out += f'    {json.dumps(k)}: {{ name: {{ uk: {json.dumps(u, ensure_ascii=False)}, en: {json.dumps(e)}, de: {json.dumps(d)} }}, svg: {json.dumps(svg, ensure_ascii=False)} }},\n'
out += "  },\n};\n"
open(OUT, "w", encoding="utf-8").write(out)
print("ok", list(av))
