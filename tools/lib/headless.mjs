// Minimal headless Chrome driver over the DevTools protocol (node's built-in WebSocket, no npm packages), shared by the portfolio tools.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function launchChrome({ chrome: chromeArg = null } = {}) {
  const candidates = [chromeArg, process.env.CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/pw-browsers/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
  const chrome = candidates.find((p) => existsSync(p));
  if (!chrome) throw new Error("No Chrome/Chromium found. Pass --chrome /path or set CHROME.");
  const profile = mkdtempSync(join(tmpdir(), "viteh-tool-"));
  const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", "--no-sandbox", "--disable-extensions", "--hide-scrollbars", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = ""; const t = setTimeout(() => reject(new Error("Chrome did not start")), 20000);
    proc.stderr.on("data", (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); resolve(m[1]); } });
    proc.on("exit", () => reject(new Error("Chrome exited early")));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { const { res, rej } = waiting.get(m.id); waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; waiting.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  /** Runs an async expression in the page and returns its JSON-able value. */
  const evaluate = async (expression) => {
    const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "page error");
    return r.result.value;
  };
  const close = () => { try { ws.close(); } catch {} proc.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  return { cdp, evaluate, close };
}

/** Pixel size of a ratio such as "3:2" for a given width. */
export function sizeFor(ratio, width = 800) {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(ratio || "");
  if (!m) throw new Error(`bad ratio ${ratio}`);
  return [width, Math.round((width * Number(m[2])) / Number(m[1]))];
}
