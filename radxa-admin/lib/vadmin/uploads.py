"""Owner uploads: images (JPEG/PNG/WebP/AVIF, 5 MB) and binary glTF models (.glb, 8 MB).
The type comes from the file's first bytes, never from the name or the Content-Type; names are random; SVG is refused."""
import contextlib
import json
import os
import re
import secrets
import struct

from . import core, pdf
from .core import ApiError, read_json, write_json, stamp

IMAGE_MAX = 5 * 1024 * 1024
MODEL_MAX = 8 * 1024 * 1024
MAX_FILES = 200
MAX_TOTAL = 300 * 1024 * 1024


def sniff(data):
    """Returns (kind, ext) or raises ApiError."""
    if data[:3] == b"\xff\xd8\xff":
        return "image", "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image", "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image", "webp"
    if data[4:8] == b"ftyp" and data[8:12] in (b"avif", b"avis"):
        return "image", "avif"
    if data[:4] == b"glTF":
        return "model", "glb"
    head = data[:512].lstrip().lower()
    if head.startswith((b"<svg", b"<?xml")) or b"<svg" in head:
        raise ApiError("svg_refused", "SVG від користувача не приймається (можливі скрипти). Завантажте JPEG, PNG, WebP або AVIF")
    raise ApiError("bad_type", "Непідтримуваний формат. Дозволено JPEG, PNG, WebP, AVIF і .glb")


def check_glb(data):
    """A self-contained GLB 2.0: header length matches, the JSON chunk parses, no external buffers or images."""
    if len(data) < 20:
        raise ApiError("bad_glb", "Файл .glb пошкоджено")
    magic, version, length = struct.unpack("<4sII", data[:12])
    if version != 2 or length != len(data):
        raise ApiError("bad_glb", "Це не коректний glTF 2.0 (.glb): версія або довжина не збігаються")
    chunk_len, chunk_type = struct.unpack("<I4s", data[12:20])
    if chunk_type != b"JSON" or 20 + chunk_len > len(data):
        raise ApiError("bad_glb", "Файл .glb пошкоджено: немає JSON-секції")
    try:
        doc = json.loads(data[20:20 + chunk_len].decode("utf-8"))
    except ValueError:
        raise ApiError("bad_glb", "Файл .glb пошкоджено: JSON не читається")
    for entry in list(doc.get("buffers", [])) + list(doc.get("images", [])):
        uri = entry.get("uri")
        if uri and not uri.startswith("data:"):
            raise ApiError("glb_external", "Модель посилається на зовнішні файли. Експортуйте «glTF Binary (.glb)» з вбудованими даними")
    required = [e for e in doc.get("extensionsRequired", []) if e not in ("KHR_materials_unlit", "KHR_texture_transform", "KHR_mesh_quantization", "KHR_materials_emissive_strength",
                                                                          "KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu")]
    if required:
        raise ApiError("glb_ext", "Модель вимагає непідтримуваних розширень: %s" % ", ".join(required))


def label_of(name):
    name = os.path.basename(str(name or "file"))
    return re.sub(r"[^\w .()-]+", "", name, flags=re.U)[:60] or "file"


TWIN_MAX = 2 * 1024 * 1024


def check_twin(index, main_id, data):
    """A JPEG twin belongs to a WebP upload and exists for the PDF only (the standard library cannot decode WebP). It must be a JPEG the PDF writer can embed."""
    main = index.get("items", {}).get(main_id)
    if not main or main.get("kind") != "image" or not main.get("file", "").endswith(".webp"):
        raise ApiError("bad_twin", "JPEG-копія можлива лише для завантаженого WebP", 400)
    if data[:3] != b"\xff\xd8\xff" or len(data) > TWIN_MAX or pdf.read_image(data) is None:
        raise ApiError("bad_twin", "JPEG-копія для PDF має бути звичайним (baseline) JPEG до 2 МБ", 400)
    return main


def store(paths, data, filename, twin_of=None):
    """twin_of=<id of a WebP upload>: stores `data` as that upload's JPEG twin (replacing an older one); the twin has no listing entry of its own."""
    if twin_of:
        index = read_json(paths.uploads_index, {"items": {}}) or {"items": {}}
        main = check_twin(index, str(twin_of), data)
        old = index["items"].pop(main.get("twin") or "", None)
        if old:
            with contextlib.suppress(OSError):
                os.unlink(os.path.join(paths.uploads, old["file"]))
        uid = secrets.token_hex(8)
        os.makedirs(paths.uploads, exist_ok=True)
        with open(os.path.join(paths.uploads, uid + ".jpg"), "wb") as fh:
            fh.write(data)
        index["items"][uid] = {"file": uid + ".jpg", "kind": "image", "size": len(data), "name": label_of(filename), "created": stamp(), "twinOf": str(twin_of)}
        main["twin"] = uid
        write_json(paths.uploads_index, index)
        return dict(index["items"][uid], id=uid, ref="u:" + uid)
    kind, ext = sniff(data)
    limit = MODEL_MAX if kind == "model" else IMAGE_MAX
    if len(data) > limit:
        raise ApiError("too_large", "Файл завеликий: до %d МБ" % (limit // (1024 * 1024)), 413)
    if len(data) < 16:
        raise ApiError("empty", "Порожній файл")
    if kind == "model":
        check_glb(data)
    index = read_json(paths.uploads_index, {"items": {}}) or {"items": {}}
    items = index.setdefault("items", {})
    if len(items) >= MAX_FILES or sum(i.get("size", 0) for i in items.values()) + len(data) > MAX_TOTAL:
        raise ApiError("quota", "Досягнуто ліміт сховища файлів. Видаліть непотрібні у розділі «Файли»", 507)
    uid = secrets.token_hex(8)
    stored = "%s.%s" % (uid, ext)
    os.makedirs(paths.uploads, exist_ok=True)
    with open(os.path.join(paths.uploads, stored), "wb") as fh:
        fh.write(data)
    items[uid] = {"file": stored, "kind": kind, "size": len(data), "name": label_of(filename), "created": stamp()}
    write_json(paths.uploads_index, index)
    return dict(items[uid], id=uid, ref="u:" + uid)


def listing(paths):
    items = (read_json(paths.uploads_index, {"items": {}}) or {}).get("items", {})
    return [dict(v, id=k, ref="u:" + k) for k, v in sorted(items.items(), key=lambda kv: kv[1].get("created", ""), reverse=True) if not v.get("twinOf")]      # twins are hidden: they follow their WebP


def delete(paths, uid, referenced):
    if not re.match(r"^[0-9a-f]{16}$", uid or ""):
        raise ApiError("bad_id", "Некоректний ідентифікатор")
    if uid in referenced:
        raise ApiError("in_use", "Файл використовується в чернетці або в збірці (останні 20 версій)", 409)
    index = read_json(paths.uploads_index, {"items": {}}) or {"items": {}}
    item = index.get("items", {}).pop(uid, None)
    if not item or item.get("twinOf"):
        raise ApiError("no_file", "Файл не знайдено", 404)
    for gone in (item, index["items"].pop(item.get("twin") or "", None)):          # the JPEG twin goes with its WebP
        if gone:
            with contextlib.suppress(OSError):
                os.unlink(os.path.join(paths.uploads, gone["file"]))
    write_json(paths.uploads_index, index)
