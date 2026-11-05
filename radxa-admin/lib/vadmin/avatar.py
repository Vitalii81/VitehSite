"""The owner's own assistant avatar: one picture, or a ZIP with a picture per mood (idle, wave, nod, think, talk, present).
Every picture goes through the normal upload checks (type from the first bytes, size, no SVG), so a ZIP is only a way to bring several at once.
The draft keeps {mood: "u:<id>"}; the build copies the used uploads into the package and tells the widget where they are."""
import io
import os
import re
import zipfile

from . import uploads
from .core import ApiError

from .schema import CUSTOM_MOODS as MOODS

MAX_ENTRIES = 40
MAX_PICKED = len(MOODS)
MAX_TOTAL = 20 * 1024 * 1024
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".avif")


def mood_of(name):
    """idle.png, Talk.webp, avatar-wave.jpg -> the mood named by the file; None when the name says nothing."""
    stem = os.path.splitext(os.path.basename(name))[0].lower()
    for mood in MOODS:
        if stem == mood or re.search(r"(^|[^a-z])%s($|[^a-z])" % mood, stem):
            return mood
    return None


def pick(files):
    """files: [(name, bytes)] in archive order -> {mood: bytes}. The first picture without a mood name (or the first at all) becomes idle."""
    chosen, unnamed = {}, []
    for name, data in files:
        mood = mood_of(name)
        if mood and mood not in chosen:
            chosen[mood] = data
        elif not mood:
            unnamed.append(data)
    if "idle" not in chosen:
        spare = unnamed[0] if unnamed else (next(iter(chosen.values())) if chosen else None)
        if spare is None:
            raise ApiError("no_images", "В архіві немає зображень PNG, JPEG, WebP чи AVIF")
        chosen["idle"] = spare
    return chosen


def unzip(data):
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ApiError("bad_zip", "Це не ZIP-архів або він пошкоджений")
    infos = [i for i in z.infolist() if not i.is_dir() and "__MACOSX" not in i.filename and not os.path.basename(i.filename).startswith(".")]
    if len(infos) > MAX_ENTRIES:
        raise ApiError("zip_big", "В архіві забагато файлів (до %d)" % MAX_ENTRIES)
    out, total = [], 0
    for info in infos:
        if not info.filename.lower().endswith(IMAGE_EXT):
            continue
        total += info.file_size
        if info.file_size > uploads.IMAGE_MAX or total > MAX_TOTAL:
            raise ApiError("zip_big", "Зображення в архіві завеликі: до %d МБ кожне, разом до 20 МБ" % (uploads.IMAGE_MAX // (1024 * 1024)))
        out.append((info.filename, z.read(info)))               # file_size is checked above; reading is bounded by it
    return out


def store(paths, data, filename):
    """Stores the pictures as uploads and returns {mood: "u:<id>"}."""
    if data[:2] == b"PK":
        files = unzip(data)
    else:
        files = [(filename or "idle", data)]
    frames = pick(files)
    return {mood: uploads.store(paths, blob, "avatar-%s" % mood)["ref"] for mood, blob in frames.items()}
