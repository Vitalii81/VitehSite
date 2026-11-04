"""Minimal safe markup for long texts: paragraphs, **bold**, [text](url), and "- " lists. Everything else is escaped."""
import html
import re

from .schema import HREF_OK

LINK = re.compile(r"\[([^\]\n]{1,100})\]\(([^)\s]{1,300})\)")
BOLD = re.compile(r"\*\*([^*\n]{1,200})\*\*")


def esc(value):
    return html.escape(str(value), quote=True)


def _bold(escaped):
    return BOLD.sub(lambda m: "<strong>%s</strong>" % m.group(1), escaped)


def links_in(source):
    """URLs written as [text](url) inside a long text (for the link checker)."""
    return [m.group(2) for m in LINK.finditer(source or "")]


def inline(source):
    out, pos = [], 0
    for m in LINK.finditer(source):
        out.append(_bold(esc(source[pos:m.start()])))
        label, url = m.group(1), m.group(2)
        if HREF_OK.match(url):
            external = url.startswith(("http://", "https://"))
            out.append('<a href="%s"%s>%s</a>' % (esc(url), ' rel="noopener noreferrer"' if external else "", esc(label)))
        else:
            out.append(esc(m.group(0)))                       # an unsafe URL stays visible as plain text
        pos = m.end()
    out.append(_bold(esc(source[pos:])))
    return "".join(out)


def render_rich(source):
    source = (source or "").replace("\r\n", "\n").strip()
    if not source:
        return ""
    blocks = []
    for para in re.split(r"\n\s*\n", source):
        lines = [l.rstrip() for l in para.split("\n") if l.strip()]
        if lines and all(l.lstrip().startswith("- ") for l in lines):
            blocks.append("<ul>%s</ul>" % "".join("<li>%s</li>" % inline(l.lstrip()[2:]) for l in lines))
        else:
            blocks.append("<p>%s</p>" % "<br>".join(inline(l) for l in lines))
    return "".join(blocks)
