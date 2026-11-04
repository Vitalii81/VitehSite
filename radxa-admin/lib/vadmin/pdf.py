"""The engineering-portfolio PDF, written with the standard library only (the Radxa has no Chrome and no network).
`build_portfolio_pdf` lays the portfolio data (the same data the web page /portfolio/ shows) out on dark A4 pages: a cover and the sections in order.
It is deliberately simpler than the Chrome-made factory PDFs (assets/portfolio/*.pdf, tools/make-portfolio.mjs): one column of cards instead of the
designed two-column spreads. build.py uses it only when the draft changes something the PDF shows; an untouched draft ships the factory files.
Fonts: DejaVu Sans (regular + bold, lib/vadmin/fonts/), subset into the file, so Ukrainian, German and English text is real, selectable text.
Images: JPEG as is, PNG (RGB, gray, palette) without re-encoding; WebP/AVIF/PNG-with-alpha cannot be decoded without extra packages and are left out."""
import os
import re
import struct
import zlib

FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
MM = 72.0 / 25.4
PAGE_W, PAGE_H = 210 * MM, 297 * MM
MARGIN_X, MARGIN_TOP, MARGIN_BOTTOM = 15 * MM, 30 * MM, 20 * MM
BG, PANEL, INK, MUTED, ACC, LINE = (0x0b, 0x14, 0x24), (0x12, 0x20, 0x3a), (0xe9, 0xee, 0xf7), (0xa6, 0xb4, 0xcb), (0x4f, 0xd1, 0xe8), (0x26, 0x38, 0x5c)


# ---------- TrueType: metrics and subsetting ----------

class Font:
    def __init__(self, name, filename):
        with open(os.path.join(FONT_DIR, filename), "rb") as fh:
            self.data = fh.read()
        self.name = name
        self.tables = {}
        count = struct.unpack(">H", self.data[4:6])[0]
        for i in range(count):
            tag, _, off, length = struct.unpack(">4sIII", self.data[12 + 16 * i:28 + 16 * i])
            self.tables[tag.decode("latin-1")] = (off, length)
        t = self.table
        head, hhea, maxp = t("head"), t("hhea"), t("maxp")
        self.upem = struct.unpack(">H", head[18:20])[0]
        self.loca_long = struct.unpack(">h", head[50:52])[0] == 1
        self.bbox = struct.unpack(">hhhh", head[36:44])
        self.ascent, self.descent = struct.unpack(">hh", hhea[4:8])
        self.n_glyphs = struct.unpack(">H", maxp[4:6])[0]
        n_hm = struct.unpack(">H", hhea[34:36])[0]
        hmtx = t("hmtx")
        self.adv = [struct.unpack(">H", hmtx[4 * min(g, n_hm - 1):4 * min(g, n_hm - 1) + 2])[0] for g in range(self.n_glyphs)]
        self.cmap = self._cmap(t("cmap"))
        self.used = {}           # glyph id -> unicode char

    def table(self, tag):
        off, length = self.tables[tag]
        return self.data[off:off + length]

    @staticmethod
    def _cmap(raw):
        n = struct.unpack(">H", raw[2:4])[0]
        best = None
        for i in range(n):
            pid, eid, off = struct.unpack(">HHI", raw[4 + 8 * i:12 + 8 * i])
            if (pid, eid) in ((3, 10), (0, 4)) and struct.unpack(">H", raw[off:off + 2])[0] == 12:
                best = off
            elif (pid, eid) in ((3, 1), (0, 3), (0, 1)) and best is None and struct.unpack(">H", raw[off:off + 2])[0] == 4:
                best = off
        out = {}
        if best is None:
            return out
        fmt = struct.unpack(">H", raw[best:best + 2])[0]
        if fmt == 12:
            groups = struct.unpack(">I", raw[best + 12:best + 16])[0]
            for g in range(groups):
                s, e, gid = struct.unpack(">III", raw[best + 16 + 12 * g:best + 28 + 12 * g])
                for c in range(s, min(e, s + 0xffff) + 1):
                    out[c] = gid + c - s
            return out
        seg = struct.unpack(">H", raw[best + 6:best + 8])[0] // 2
        ends = struct.unpack(">%dH" % seg, raw[best + 14:best + 14 + 2 * seg])
        base = best + 16 + 2 * seg
        starts = struct.unpack(">%dH" % seg, raw[base:base + 2 * seg])
        deltas = struct.unpack(">%dh" % seg, raw[base + 2 * seg:base + 4 * seg])
        ro_pos = base + 4 * seg
        ranges = struct.unpack(">%dH" % seg, raw[ro_pos:ro_pos + 2 * seg])
        for i in range(seg):
            for c in range(starts[i], ends[i] + 1):
                if c == 0xffff:
                    continue
                if ranges[i] == 0:
                    gid = (c + deltas[i]) & 0xffff
                else:
                    p = ro_pos + 2 * i + ranges[i] + 2 * (c - starts[i])
                    gid = struct.unpack(">H", raw[p:p + 2])[0]
                    gid = (gid + deltas[i]) & 0xffff if gid else 0
                if gid:
                    out[c] = gid
        return out

    def gid(self, ch):
        return self.cmap.get(ord(ch), self.cmap.get(0x20, 0) if ch in "\t ​" else 0)

    def width(self, text, size):
        return sum(self.adv[self.gid(c)] for c in text) * size / float(self.upem)

    def encode(self, text):
        out = []
        for c in text:
            g = self.gid(c)
            self.used.setdefault(g, c)
            out.append("%04X" % g)
        return "<%s>" % "".join(out)

    def subset(self):
        """A TrueType file that keeps only the used glyphs (glyph ids stay the same, the others become empty)."""
        loca_raw, glyf = self.table("loca"), self.table("glyf")
        n = self.n_glyphs
        offs = struct.unpack(">%dI" % (n + 1), loca_raw[:4 * (n + 1)]) if self.loca_long else tuple(2 * v for v in struct.unpack(">%dH" % (n + 1), loca_raw[:2 * (n + 1)]))
        keep, todo = set([0]), list(self.used) + [0]
        while todo:
            g = todo.pop()
            if g in keep and g != 0 and g not in self.used:
                continue
            keep.add(g)
            body = glyf[offs[g]:offs[g + 1]]
            if len(body) >= 10 and struct.unpack(">h", body[:2])[0] < 0:          # composite: its components are needed too
                p = 10
                while True:
                    flags, comp = struct.unpack(">HH", body[p:p + 4])
                    p += 4 + (4 if flags & 1 else 2) + (2 if flags & 8 else 4 if flags & 0x40 else 8 if flags & 0x80 else 0)
                    if comp not in keep:
                        keep.add(comp)
                        todo.append(comp)
                    if not flags & 0x20:
                        break
        new_glyf, new_loca = bytearray(), []
        for g in range(n):
            new_loca.append(len(new_glyf))
            if g in keep:
                body = glyf[offs[g]:offs[g + 1]]
                new_glyf += body + b"\0" * (-len(body) % 4)
        new_loca.append(len(new_glyf))
        head = bytearray(self.table("head"))
        head[8:12] = b"\0\0\0\0"                                                   # checkSumAdjustment: readers do not verify it
        head[50:52] = struct.pack(">h", 1)
        parts = {"head": bytes(head), "hhea": self.table("hhea"), "maxp": self.table("maxp"), "hmtx": self.table("hmtx"),
                 "loca": struct.pack(">%dI" % len(new_loca), *new_loca), "glyf": bytes(new_glyf)}
        for opt in ("cvt ", "fpgm", "prep"):
            if opt in self.tables:
                parts[opt] = self.table(opt)
        tags = sorted(parts)
        out = bytearray(struct.pack(">IHHHH", 0x00010000, len(tags), 0, 0, 0))
        pos = 12 + 16 * len(tags)
        body = bytearray()
        for tag in tags:
            raw = parts[tag]
            padded = raw + b"\0" * (-len(raw) % 4)
            csum = sum(struct.unpack(">%dI" % (len(padded) // 4), padded)) & 0xffffffff
            out += struct.pack(">4sIII", tag.encode("latin-1"), csum, pos + len(body), len(raw))
            body += padded
        return bytes(out + body)


# ---------- images ----------

def read_image(data):
    """(kind, width, height, components, payload) for a JPEG or a simple PNG, or None when the format cannot be embedded without decoding."""
    if data[:3] == b"\xff\xd8\xff":
        p = 2
        while p + 4 < len(data):
            if data[p] != 0xff:
                p += 1
                continue
            marker = data[p + 1]
            if marker in (0xd8, 0x01) or 0xd0 <= marker <= 0xd7 or marker == 0xff:
                p += 1 if marker == 0xff else 2
                continue
            seglen = struct.unpack(">H", data[p + 2:p + 4])[0]
            if marker in (0xc0, 0xc1, 0xc2):
                h, w, comps = struct.unpack(">HHB", data[p + 5:p + 10])
                return ("jpeg", w, h, comps, data) if comps in (1, 3) else None
            p += 2 + seglen
        return None
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        p, idat, plte, ihdr = 8, [], None, None
        while p + 8 <= len(data):
            length, ctype = struct.unpack(">I4s", data[p:p + 8])
            body = data[p + 8:p + 8 + length]
            if ctype == b"IHDR":
                ihdr = struct.unpack(">IIBBBBB", body)
            elif ctype == b"PLTE":
                plte = body
            elif ctype == b"IDAT":
                idat.append(body)
            elif ctype == b"tRNS":
                return None
            p += 12 + length
        if not ihdr or ihdr[2] != 8 or ihdr[6] != 0 or ihdr[3] not in (0, 2, 3):
            return None
        w, h, _, ctype, _, _, _ = ihdr
        comps = {0: 1, 2: 3, 3: 1}[ctype]
        return ("png", w, h, comps, (b"".join(idat), plte if ctype == 3 else None))
    return None


# ---------- document ----------

def esc_pdf(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def num(v):
    return ("%.2f" % v).rstrip("0").rstrip(".")


class Doc:
    def __init__(self, title):
        self.title = title
        self.fonts = {"R": Font("R", "DejaVuSans.ttf"), "B": Font("B", "DejaVuSans-Bold.ttf")}
        self.pages = []                  # one list of operator strings per page
        self.images = []                 # [(kind, w, h, comps, payload)]
        self.image_ids = {}
        self.texts = []                  # everything drawn as text, for tests
        self.new_page()

    @property
    def ops(self):
        return self.pages[-1]

    def new_page(self):
        self.pages.append([])
        self.rect(0, 0, PAGE_W, PAGE_H, BG)
        self.rect(0, PAGE_H - 1.2 * MM, PAGE_W, 1.2 * MM, ACC)

    def rect(self, x, y, w, h, color, ops=None):
        (ops if ops is not None else self.ops).append("%s rg %s %s %s %s re f" % (" ".join(num(c / 255.0) for c in color), num(x), num(y), num(w), num(h)))

    def text(self, x, y, s, size, color=INK, bold=False, ops=None):
        font = self.fonts["B" if bold else "R"]
        self.texts.append(s)
        (ops if ops is not None else self.ops).append("BT /%s %s Tf %s rg %s %s Td %s Tj ET" % (font.name, num(size), " ".join(num(c / 255.0) for c in color), num(x), num(y), font.encode(s)))

    def wrap(self, s, size, width, bold=False):
        font = self.fonts["B" if bold else "R"]
        lines = []
        for para in str(s).replace("\r", "").split("\n"):
            cur = ""
            for word in para.split():
                while font.width(word, size) > width and len(word) > 1:        # a word wider than the line is broken
                    k = len(word)
                    while k > 1 and font.width(word[:k], size) > width:
                        k -= 1
                    if cur:
                        lines.append(cur)
                        cur = ""
                    lines.append(word[:k])
                    word = word[k:]
                trial = word if not cur else cur + " " + word
                if cur and font.width(trial, size) > width:
                    lines.append(cur)
                    cur = word
                else:
                    cur = trial
            lines.append(cur)
        return lines

    def image(self, data, x, y, w, h, fit="contain", ops=None):
        """Draws the picture inside the box (x, y = bottom left). Returns False when the format cannot be embedded."""
        info = read_image(data)
        if not info:
            return False
        key = id(data)
        if key not in self.image_ids:
            self.image_ids[key] = len(self.images)
            self.images.append(info)
        idx = self.image_ids[key]
        iw, ih = info[1], info[2]
        scale = (max if fit == "cover" else min)(w / float(iw), h / float(ih))
        dw, dh = iw * scale, ih * scale
        dx, dy = x + (w - dw) / 2.0, y + (h - dh) / 2.0
        (ops if ops is not None else self.ops).append("q %s %s %s %s re W n %s 0 0 %s %s %s cm /Im%d Do Q" % (num(x), num(y), num(w), num(h), num(dw), num(dh), num(dx), num(dy), idx))
        return True

    # ----- serialisation -----
    def render(self, footer=None):
        total = len(self.pages)
        if footer:
            for i, ops in enumerate(self.pages):
                if i == 0 and footer.get("skip_first"):
                    continue
                y = MARGIN_BOTTOM - 8 * MM
                self.rect(MARGIN_X, y + 4.2 * MM, PAGE_W - 2 * MARGIN_X, 0.25, LINE, ops)
                self.text(MARGIN_X, y, footer["left"], 7, MUTED, ops=ops)
                label = "%02d / %02d" % (i + 1, total)
                self.text(PAGE_W - MARGIN_X - self.fonts["R"].width(label, 7), y, label, 7, MUTED, ops=ops)
        objs = []                                                   # object n is objs[n - 1]; strings or bytes

        def add(body):
            objs.append(body)
            return len(objs)

        def stream(dictionary, payload, compress=True):
            raw = zlib.compress(payload, 9) if compress else payload
            head = "%s /Length %d%s" % (dictionary, len(raw), " /Filter /FlateDecode" if compress else "")
            return ("<< %s >>\nstream\n" % head).encode("latin-1") + raw + b"\nendstream"

        catalog, pages_id = add(None), add(None)
        font_ids = {}
        for tag, font in self.fonts.items():
            sub = font.subset()
            ff = add(stream("/Length1 %d" % len(sub), sub))
            desc = add(("<< /Type /FontDescriptor /FontName /%s /Flags 4 /FontBBox [%d %d %d %d] /ItalicAngle 0 /Ascent %d /Descent %d /CapHeight %d /StemV 80 /FontFile2 %d 0 R >>"
                        % (self._basename(font), tuple(v * 1000 // font.upem for v in font.bbox)[0], font.bbox[1] * 1000 // font.upem, font.bbox[2] * 1000 // font.upem, font.bbox[3] * 1000 // font.upem,
                           font.ascent * 1000 // font.upem, font.descent * 1000 // font.upem, font.ascent * 1000 // font.upem, ff)).encode("latin-1"))
            widths = " ".join("%d [%d]" % (g, font.adv[g] * 1000 // font.upem) for g in sorted(font.used))
            bf = "".join("<%04X> <%s>\n" % (g, "".join("%04X" % u for u in struct.unpack(">%dH" % (len(ch.encode("utf-16-be")) // 2), ch.encode("utf-16-be")))) for g, ch in sorted(font.used.items()) if g)
            cmap = ("/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def\n"
                    "1 begincodespacerange <0000> <FFFF> endcodespacerange\n%d beginbfchar\n%sendbfchar\nendcmap CMapName currentdict /CMap defineresource pop end end" % (max(len(font.used) - (1 if 0 in font.used else 0), 0), bf))
            tou = add(stream("", cmap.encode("latin-1"), True))
            cid = add(("<< /Type /Font /Subtype /CIDFontType2 /BaseFont /%s /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor %d 0 R /DW 600 /W [%s] /CIDToGIDMap /Identity >>"
                       % (self._basename(font), desc, widths)).encode("latin-1"))
            font_ids[tag] = add(("<< /Type /Font /Subtype /Type0 /BaseFont /%s /Encoding /Identity-H /DescendantFonts [%d 0 R] /ToUnicode %d 0 R >>" % (self._basename(font), cid, tou)).encode("latin-1"))
        image_ids = []
        for kind, w, h, comps, payload in self.images:
            cs = "/DeviceGray" if comps == 1 else "/DeviceRGB"
            if kind == "jpeg":
                image_ids.append(add(("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n" % (w, h, cs, len(payload))).encode("latin-1") + payload + b"\nendstream"))
            else:
                idat, plte = payload
                if plte:
                    cs = "[/Indexed /DeviceRGB %d <%s>]" % (len(plte) // 3 - 1, plte.hex())
                image_ids.append(add(("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors %d /BitsPerComponent 8 /Columns %d >> /Length %d >>\nstream\n"
                                      % (w, h, cs, comps, w, len(idat))).encode("latin-1") + idat + b"\nendstream"))
        res = "<< /Font << %s >> /XObject << %s >> >>" % (" ".join("/%s %d 0 R" % (t, i) for t, i in font_ids.items()), " ".join("/Im%d %d 0 R" % (i, n) for i, n in enumerate(image_ids)))
        kids = []
        for ops in self.pages:
            content = add(stream("", "\n".join(ops).encode("latin-1")))
            kids.append(add(("<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %s %s] /Resources %s /Contents %d 0 R >>" % (pages_id, num(PAGE_W), num(PAGE_H), res, content)).encode("latin-1")))
        info = add(("<< /Title <%s> /Producer (ViTeh admin) >>" % ("FEFF" + self.title.encode("utf-16-be").hex().upper())).encode("latin-1"))
        objs[catalog - 1] = ("<< /Type /Catalog /Pages %d 0 R >>" % pages_id).encode("latin-1")
        objs[pages_id - 1] = ("<< /Type /Pages /Kids [%s] /Count %d >>" % (" ".join("%d 0 R" % k for k in kids), len(kids))).encode("latin-1")
        out = bytearray(b"%PDF-1.5\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for i, body in enumerate(objs):
            offsets.append(len(out))
            out += ("%d 0 obj\n" % (i + 1)).encode("latin-1") + body + b"\nendobj\n"
        xref = len(out)
        out += ("xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)).encode("latin-1")
        for o in offsets:
            out += ("%010d 00000 n \n" % o).encode("latin-1")
        out += ("trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, catalog, info, xref)).encode("latin-1")
        return bytes(out)

    @staticmethod
    def _basename(font):
        return "DejaVuSans-Bold" if font.name == "B" else "DejaVuSans"
