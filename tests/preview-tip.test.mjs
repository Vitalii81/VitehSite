// Pure logic of the admin hover preview (radxa-admin/web/preview-tip.js): where the pop-up goes and which words it shows.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import P from "../radxa-admin/web/preview-tip.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });
const inside = (pos, size, view, margin = P.MARGIN) => pos.left >= margin && pos.top >= margin && pos.left + size.width <= view.width - margin && pos.top + size.height <= view.height - margin;

test("prefers below the item, then above, then right, then left", () => {
  const size = { width: 300, height: 200 }, view = { width: 1280, height: 800 };
  assert.deepEqual(P.place(rect(100, 100, 400, 40), size, view), { side: "bottom", left: 100, top: 150 });
  assert.equal(P.place(rect(100, 620, 400, 40), size, view).side, "top");                           // no room below
  assert.equal(P.place(rect(100, 620, 400, 40), size, view).top, 620 - P.GAP - 200);
  assert.equal(P.place(rect(100, 150, 400, 200), size, { width: 1280, height: 480 }).side, "right");  // neither below nor above fits: beside
  assert.equal(P.place(rect(900, 150, 360, 200), size, { width: 1280, height: 480 }).side, "left");
});

test("the pop-up never leaves the screen: desktop, 390 px phone, tiny and oversized cases", () => {
  const size = { width: 340, height: 260 };
  for (const view of [{ width: 1280, height: 800 }, { width: 390, height: 780 }, { width: 390, height: 500 }, { width: 360, height: 640 }]) {
    for (const anchor of [rect(0, 0, 100, 30), rect(view.width - 100, 0, 100, 30), rect(0, view.height - 30, 100, 30), rect(view.width - 100, view.height - 30, 100, 30), rect(8, view.height / 2, view.width - 16, 44), rect(view.width / 2, view.height / 2, 80, 30)]) {
      const pos = P.place(anchor, size, view);
      assert.ok(inside(pos, size, view), `${JSON.stringify(view)} ${JSON.stringify(anchor)} -> ${JSON.stringify(pos)}`);
    }
  }
  const huge = P.place(rect(10, 10, 50, 20), { width: 900, height: 900 }, { width: 390, height: 700 });   // bigger than the screen: pinned to the top-left margin
  assert.deepEqual([huge.left, huge.top], [P.MARGIN, P.MARGIN]);
});

test("on a phone the pop-up sits under a full-width list item and keeps its left edge on screen", () => {
  const size = { width: 340, height: 250 }, view = { width: 390, height: 780 };
  const pos = P.place(rect(16, 200, 358, 56), size, view);
  assert.equal(pos.side, "bottom");
  assert.equal(pos.left, 16);
  assert.equal(P.place(rect(300, 200, 80, 40), size, view).left, view.width - size.width - P.MARGIN);   // right-aligned eye button: shifted left, not cut off
});

test("describe: the item's own name wins for the title, the manifest's words for the explanation", () => {
  const manifest = { "section:faq": { title: "FAQ", text: "Explains.", image: "previews/section-faq.webp" }, "service:s0": { image: "previews/service-s0.webp" }, "effect:reveal": { title: "Reveal", text: "t", demo: "reveal" } };
  assert.deepEqual(P.describe(manifest, "section:faq"), { title: "FAQ", text: "Explains.", image: "previews/section-faq.webp", demo: "" });
  assert.deepEqual(P.describe(manifest, "service:s0", { title: "Software", text: "Own text" }), { title: "Software", text: "Own text", image: "previews/service-s0.webp", demo: "" });
  assert.equal(P.describe(manifest, "section:faq", { title: "Запитання й відповіді" }).title, "Запитання й відповіді");
  assert.equal(P.describe(manifest, "effect:reveal").demo, "reveal");
  assert.deepEqual(P.describe(null, "nope", { title: "x" }), { title: "x", text: "", image: "", demo: "" });
  assert.deepEqual(P.describe({}, "constructor"), { title: "", text: "", image: "", demo: "" });    // keys are not looked up on the prototype
});

test("a touch that moves is a scroll, not a long press", () => {
  assert.equal(P.holdMoved(2, 3), false);
  assert.equal(P.holdMoved(0, 14), true);
  assert.equal(P.keyOf("block", "text_image"), "block:text_image");
  assert.ok(P.LONG_PRESS >= 400 && P.HOVER_DELAY < P.LONG_PRESS);
});

test("the shipped manifest only holds keys of the form kind:id and relative picture paths", () => {
  const manifest = JSON.parse(readFileSync(join(root, "radxa-admin/web/previews/manifest.json"), "utf8"));
  for (const [key, entry] of Object.entries(manifest)) {
    assert.match(key, /^(section|service|project|block|effect|widget):[A-Za-z0-9_-]+$/);
    if (entry.image) assert.match(entry.image, /^previews\/[A-Za-z0-9_-]+\.webp$/);
  }
});

test("themedImage: the dark picture is the light one with a -dark suffix, and back", () => {
  assert.equal(P.themedImage("previews/service-s10.webp", false), "previews/service-s10.webp");
  assert.equal(P.themedImage("previews/service-s10.webp", true), "previews/service-s10-dark.webp");
  assert.equal(P.themedImage("previews/service-s10-dark.webp", true), "previews/service-s10-dark.webp");
  assert.equal(P.themedImage("previews/service-s10-dark.webp", false), "previews/service-s10.webp");
  assert.equal(P.themedImage("", true), "");
});

test("isDark: the page's own choice (html[data-theme]) wins over the system", () => {
  const doc = (theme) => ({ documentElement: { dataset: theme ? { theme } : {} } });
  const system = (dark) => function () { return { matches: dark }; };
  assert.equal(P.isDark(doc("dark"), system(false)), true);
  assert.equal(P.isDark(doc("light"), system(true)), false);
  assert.equal(P.isDark(doc(""), system(true)), true);
  assert.equal(P.isDark(doc(""), system(false)), false);
  assert.equal(P.isDark(doc(""), undefined), false);
});
