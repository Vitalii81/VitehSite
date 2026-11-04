"""Pictures for the PDF, standard library only: a PNG of any ordinary kind (gray, RGB, palette, with alpha, 8 or 16 bit, not interlaced) is decoded,
flattened onto white (transparency becomes white) and re-encoded as a baseline JPEG (4:2:0, quality ~85, longest side at most MAX_SIDE).
Used ONLY for the PDF build; the pictures of the web pages are never touched. WebP and AVIF cannot be decoded here (see pdf.read_image)."""
import math
import struct
import zlib

MAX_SIDE = 800
MAX_PIXELS = 6000000          # a bigger PNG would take minutes in pure Python on a small board: it is skipped
ZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]
DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
DC_VALS = list(range(12))
AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]
AC_VALS = [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
           0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
           0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
           0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
           0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
           0xf9, 0xfa]
Q_LUM = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
         49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99]
Q_CHR = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99] + [99] * 32


def decode_png(data):
    """(width, height, rgb_bytes) with transparency flattened onto white, or None when the file is not a plain non-interlaced PNG."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    p, idat, plte, trns, ihdr = 8, [], None, None, None
    while p + 8 <= len(data):
        length, ctype = struct.unpack(">I4s", data[p:p + 8])
        body = data[p + 8:p + 8 + length]
        if ctype == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", body)
        elif ctype == b"PLTE":
            plte = body
        elif ctype == b"tRNS":
            trns = body
        elif ctype == b"IDAT":
            idat.append(body)
        p += 12 + length
    if not ihdr:
        return None
    w, h, depth, ctype, _, _, interlace = ihdr
    if interlace or depth not in (8, 16) and ctype != 3 or w * h > MAX_PIXELS or w < 1 or h < 1:
        return None
    if ctype == 3 and depth != 8:
        return None                                                       # packed palette bits: rare, not worth the code
    chans = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(ctype)
    if chans is None:
        return None
    bpp = chans * (depth // 8)
    stride = w * bpp
    try:
        raw = zlib.decompress(b"".join(idat))
    except zlib.error:
        return None
    if len(raw) < (stride + 1) * h:
        return None
    rows, prev = [], bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]
        cur = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for i in range(bpp, stride):
                cur[i] = (cur[i] + cur[i - bpp]) & 255
        elif f == 2:
            cur = bytearray((a + b) & 255 for a, b in zip(cur, prev))
        elif f == 3:
            for i in range(stride):
                cur[i] = (cur[i] + (((cur[i - bpp] if i >= bpp else 0) + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = cur[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                cur[i] = (cur[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        elif f != 0:
            return None
        rows.append(cur)
        prev = cur
    step = depth // 8                                                      # 16 bit: keep the high byte
    out = bytearray(w * h * 3)
    o = 0
    for cur in rows:
        for x in range(w):
            i = x * bpp
            if ctype == 0:
                r = g = b = cur[i]
                a = 255 if not trns or struct.unpack(">H", trns[:2])[0] != (cur[i] if step == 1 else cur[i] << 8 | cur[i + 1]) else 0
            elif ctype == 2:
                r, g, b = cur[i], cur[i + step], cur[i + 2 * step]
                a = 255
            elif ctype == 3:
                k = cur[i]
                r, g, b = plte[3 * k:3 * k + 3] if plte and 3 * k + 3 <= len(plte) else (0, 0, 0)
                a = trns[k] if trns and k < len(trns) else 255
            elif ctype == 4:
                r = g = b = cur[i]
                a = cur[i + step]
            else:
                r, g, b, a = cur[i], cur[i + step], cur[i + 2 * step], cur[i + 3 * step]
            if a != 255:
                r, g, b = (r * a + 255 * (255 - a)) // 255, (g * a + 255 * (255 - a)) // 255, (b * a + 255 * (255 - a)) // 255
            out[o], out[o + 1], out[o + 2] = r, g, b
            o += 3
    return w, h, bytes(out)


def _huff(bits, vals):
    table, code, k = {}, 0, 0
    for length in range(1, 17):
        for _ in range(bits[length - 1]):
            table[vals[k]] = (code, length)
            code += 1
            k += 1
        code <<= 1
    return table


def _cos_matrix():
    return [[(math.sqrt(1.0 / 8) if u == 0 else math.sqrt(2.0 / 8)) * math.cos((2 * x + 1) * u * math.pi / 16) for x in range(8)] for u in range(8)]


def encode_jpeg(w, h, rgb, quality=85):
    """Baseline JPEG, 4:2:0, from an RGB byte string. The picture is first reduced (box average) so its longest side is at most MAX_SIDE."""
    n = max(1, int(math.ceil(max(w, h) / float(MAX_SIDE))))
    if n > 1:
        nw, nh = w // n, h // n
        small = bytearray(nw * nh * 3)
        for y in range(nh):
            for x in range(nw):
                acc = [0, 0, 0]
                for dy in range(n):
                    base = ((y * n + dy) * w + x * n) * 3
                    for dx in range(n):
                        j = base + dx * 3
                        acc[0] += rgb[j]
                        acc[1] += rgb[j + 1]
                        acc[2] += rgb[j + 2]
                d = n * n
                i = (y * nw + x) * 3
                small[i], small[i + 1], small[i + 2] = acc[0] // d, acc[1] // d, acc[2] // d
        w, h, rgb = nw, nh, bytes(small)
    scale = 5000 // quality if quality < 50 else 200 - quality * 2
    qt = lambda base: [min(255, max(1, (v * scale + 50) // 100)) for v in base]
    ql, qc = qt(Q_LUM), qt(Q_CHR)
    mw, mh = (w + 15) // 16 * 16, (h + 15) // 16 * 16
    ys = [[0.0] * mw for _ in range(mh)]
    cb = [[0.0] * (mw // 2) for _ in range(mh // 2)]
    cr = [[0.0] * (mw // 2) for _ in range(mh // 2)]
    full_cb = [[0.0] * mw for _ in range(mh)]
    full_cr = [[0.0] * mw for _ in range(mh)]
    for y in range(mh):
        yy = min(y, h - 1)
        for x in range(mw):
            i = (yy * w + min(x, w - 1)) * 3
            r, g, b = rgb[i], rgb[i + 1], rgb[i + 2]
            ys[y][x] = 0.299 * r + 0.587 * g + 0.114 * b - 128
            full_cb[y][x] = -0.168736 * r - 0.331264 * g + 0.5 * b
            full_cr[y][x] = 0.5 * r - 0.418688 * g - 0.081312 * b
    for y in range(mh // 2):
        for x in range(mw // 2):
            cb[y][x] = (full_cb[2 * y][2 * x] + full_cb[2 * y][2 * x + 1] + full_cb[2 * y + 1][2 * x] + full_cb[2 * y + 1][2 * x + 1]) / 4
            cr[y][x] = (full_cr[2 * y][2 * x] + full_cr[2 * y][2 * x + 1] + full_cr[2 * y + 1][2 * x] + full_cr[2 * y + 1][2 * x + 1]) / 4
    cm = _cos_matrix()
    dc_t, ac_t = _huff(DC_BITS, DC_VALS), _huff(AC_BITS, AC_VALS)
    bitbuf = [0, 0]
    out = bytearray()

    def put(code, length):
        bitbuf[0] = (bitbuf[0] << length) | code
        bitbuf[1] += length
        while bitbuf[1] >= 8:
            byte = (bitbuf[0] >> (bitbuf[1] - 8)) & 255
            out.append(byte)
            if byte == 255:
                out.append(0)
            bitbuf[1] -= 8
        bitbuf[0] &= (1 << bitbuf[1]) - 1

    def vli(v):
        a = abs(v)
        size = a.bit_length()
        return size, (v if v >= 0 else v + (1 << size) - 1) & ((1 << size) - 1)

    def block(plane, bx, by, q, last):
        tmp = [[sum(cm[u][x] * plane[by + y][bx + x] for x in range(8)) for u in range(8)] for y in range(8)]       # rows transformed
        co = [[sum(cm[v][y] * tmp[y][u] for y in range(8)) for u in range(8)] for v in range(8)]
        flat = [int(round(co[k // 8][k % 8] / q[k])) for k in ZZ]
        diff = flat[0] - last
        size, bits = vli(diff)
        put(*dc_t[size])
        if size:
            put(bits, size)
        run = 0
        for v in flat[1:]:
            if v == 0:
                run += 1
                continue
            while run > 15:
                put(*ac_t[0xf0])
                run -= 16
            size, bits = vli(v)
            put(*ac_t[(run << 4) | size])
            put(bits, size)
            run = 0
        if run:
            put(*ac_t[0])
        return flat[0]

    last = [0, 0, 0]
    for my in range(0, mh, 16):
        for mx in range(0, mw, 16):
            for by, bx in ((0, 0), (0, 8), (8, 0), (8, 8)):
                last[0] = block(ys, mx + bx, my + by, ql, last[0])
            last[1] = block(cb, mx // 2, my // 2, qc, last[1])
            last[2] = block(cr, mx // 2, my // 2, qc, last[2])
    put(0x7f, 7)                                                                  # pad the last byte with 1 bits
    seg = lambda marker, body: b"\xff" + bytes([marker]) + struct.pack(">H", len(body) + 2) + body
    head = b"\xff\xd8" + seg(0xdb, b"\x00" + bytes(ql[k] for k in ZZ)) + seg(0xdb, b"\x01" + bytes(qc[k] for k in ZZ))
    head += seg(0xc0, struct.pack(">BHHB", 8, h, w, 3) + b"\x01\x22\x00\x02\x11\x01\x03\x11\x01")
    head += seg(0xc4, b"\x00" + bytes(DC_BITS) + bytes(DC_VALS)) + seg(0xc4, b"\x10" + bytes(AC_BITS) + bytes(AC_VALS))
    head += seg(0xda, b"\x03\x01\x00\x02\x00\x03\x00\x00\x3f\x00")
    return bytes(head) + bytes(out) + b"\xff\xd9"


def png_to_jpeg(data):
    """JPEG bytes for a PNG that PDF cannot embed as it is (alpha, transparency, 16 bit), or None."""
    decoded = decode_png(data)
    return encode_jpeg(*decoded) if decoded else None
