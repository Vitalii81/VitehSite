"use strict";
// JPEG twin of a WebP upload. The admin's PDF writer has no WebP decoder (standard library only), so right after a WebP is uploaded the browser
// draws it on a white canvas (max 1600 px on the long side) and sends a JPEG next to it (`upload&twin=<id of the WebP>`). The server uses the twin
// for the generated portfolio PDF only; it is never published as a page asset. Any failure is silent: the picture still shows on the web
// and the PDF simply leaves it out, as before. Used by admin.js and edit-overlay.js (window.VTwin).
(() => {
  const MAX_SIDE = 1600;
  async function make(file) {
    if (!file || file.type !== "image/webp" || typeof createImageBitmap !== "function") return null;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";                                  // transparency becomes white (JPEG has no alpha)
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    } catch { return null; } finally { bitmap?.close?.(); }
  }
  /** post(query, blob) uploads raw bytes; `item` is the WebP upload the server just stored. Never throws. */
  async function attach(file, item, post) {
    try {
      const blob = await make(file);
      if (blob && item?.id) await post(`&twin=${encodeURIComponent(item.id)}&name=${encodeURIComponent(file.name.replace(/\.\w+$/, "") + ".jpg")}`, blob);
    } catch { /* the twin is optional */ }
  }
  window.VTwin = { make, attach };
})();
