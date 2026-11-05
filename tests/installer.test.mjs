// Tests of radxa-admin/install-on-radxa.sh against a fake uhttpd service and a fake curl (no real server is touched). Needs `sh`, `awk`, `sed`, python3.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const haveTools = ["sh", "awk", "sed", "python3"].every((t) => spawnSync("sh", ["-c", `command -v ${t}`]).status === 0);

const FAKE_SERVICE = `#!/bin/sh
# fake /etc/init.d/vadmin: enable/restart/stop switch the fake "admin-on" state; flags simulate failures
F="$FAKE"
echo "$1" >> "$F/service.log"
case "$1" in
  restart|start) [ -f "$F/fail-start" ] && exit 1; touch "$F/admin-on"; [ -f "$F/hijack-after-install" ] && touch "$F/hijacked"; exit 0 ;;
  stop) rm -f "$F/admin-on" "$F/hijacked"; exit 0 ;;
esac
exit 0
`;

const FAKE_CURL = `#!/bin/sh
# fake curl: portal / admin / preview answers depend on files in $FAKE
F="$FAKE"; url=""; want_code=0
for a in "$@"; do case "$a" in http*) url="$a" ;; -w) want_code=1 ;; esac; done
code=200; body=""
case "$url" in
  http://127.0.0.1:18082/cgi-bin/vadmin-api*) if [ -f "$F/admin-on" ]; then code=401; body='{"ok":false}'; else code=000; fi ;;
  http://127.0.0.1:18082/*) if [ -f "$F/admin-on" ]; then code=200; body='<title>ViTeh admin</title>'; else code=000; fi ;;
  http://127.0.0.1:18083/*) if [ -f "$F/admin-on" ]; then code=404; body='nope'; else code=000; fi ;;
  *) if [ -f "$F/hijacked" ]; then body="HIJACKED"; else body="main portal $(cat "$F/portal-extra" 2>/dev/null)"; fi ;;
esac
if [ "$want_code" = 1 ]; then printf '%s' "$code"; else printf '%s' "$body"; fi
`;

function world(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vadmin-inst-"));
  const fake = join(dir, "fake"), root = join(dir, "root"), bin = join(dir, "bin");
  for (const d of [fake, root, bin, join(root, "srv/fwportal")]) mkdirSync(d, { recursive: true });
  writeFileSync(join(bin, "curl"), FAKE_CURL); chmodSync(join(bin, "curl"), 0o755);
  writeFileSync(join(bin, "uhttpd"), "#!/bin/sh\nexit 0\n"); chmodSync(join(bin, "uhttpd"), 0o755);
  writeFileSync(join(bin, "vadmin-service"), FAKE_SERVICE); chmodSync(join(bin, "vadmin-service"), 0o755);
  for (const flag of opts.flags || []) writeFileSync(join(fake, flag), "");
  // the "copied radxa-admin/ folder": code + site files (as push-to-radxa.sh lays them out)
  const pkg = join(dir, "pkg");
  mkdirSync(join(pkg, "radxa-admin"), { recursive: true });
  for (const part of ["cgi", "lib", "web", "catalog"]) cpSync(join(repo, "radxa-admin", part), join(pkg, "radxa-admin", part), { recursive: true, filter: (src) => !src.includes("__pycache__") });
  for (const f of ["vadmin-cli.py", "install-on-radxa.sh"]) cpSync(join(repo, "radxa-admin", f), join(pkg, "radxa-admin", f));
  for (const part of ["assets", "data"]) cpSync(join(repo, part), join(pkg, "radxa-admin", "site", part), { recursive: true });
  for (const f of ["index.html", "impressum.html", "datenschutz.html", "robots.txt"]) cpSync(join(repo, f), join(pkg, "radxa-admin", "site", f));
  return { dir, fake, root, bin, script: join(pkg, "radxa-admin", "install-on-radxa.sh"), initd: join(root, "etc/init.d/vadmin") };
}

function run(w, args = [], env = {}) {
  const r = spawnSync("sh", [w.script, "--admin-port", "18082", "--preview-port", "18083", ...args], {
    env: { PATH: `${w.bin}:${process.env.PATH}`, FAKE: w.fake, INSTALL_ROOT: w.root, UHTTPD_BIN: join(w.bin, "uhttpd"), VADMIN_SERVICE_CMD: join(w.bin, "vadmin-service"), HOME: w.dir, ...env },
    encoding: "utf8", timeout: 60000,
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
const done = (w) => rmSync(w.dir, { recursive: true, force: true });
const t = (name, fn) => test(name, { skip: !haveTools && "sh/awk/sed/python3 not available" }, fn);
const ADMIN = (w, p = "") => join(w.root, "srv/fwportal/admin", p);
const STAGE = (w, p = "") => join(w.root, "srv/fwportal/staging/viteh-site", p);
function statMode(p) { return spawnSync("sh", ["-c", `stat -c %a "${p}"`]).stdout.toString().trim(); }

t("installer: installs the code, a docroot with the CGI wrapper and a procd service with two uhttpd instances", () => {
  const w = world();
  const r = run(w, ["--probe", "http://127.0.0.1/"]);
  assert.equal(r.code, 0, r.out);
  const init = readFileSync(w.initd, "utf8");
  assert.ok(init.startsWith("#!/bin/sh /etc/rc.common") && init.includes("USE_PROCD=1"));
  assert.ok(init.includes("-h /srv/fwportal/admin/docroot") && init.includes("-x /cgi-bin"), "admin instance with CGI");
  assert.ok(init.includes("-h /srv/fwportal/staging/viteh-site/preview"), "preview instance");
  assert.ok(init.includes("-p 127.0.0.1:18082") && init.includes("-p 127.0.0.1:18083"));
  assert.ok(!/-p\s+(0\.0\.0\.0|\[::\]|:)/.test(init), "never a wildcard listen");
  assert.equal(init.split("-x /cgi-bin").length - 1, 1, "only the admin instance runs CGI");
  assert.ok(existsSync(ADMIN(w, "cgi/vadmin.py")) && existsSync(STAGE(w, "src/index.html")));
  assert.ok(existsSync(ADMIN(w, "docroot/index.html")) && existsSync(ADMIN(w, "docroot/site-assets")), "static files and editor assets in the docroot");
  for (const f of ["assets/app.js", "assets/styles.css", "edit-core.js", "edit-overlay.js", "edit-overlay.css"]) assert.ok(existsSync(ADMIN(w, `docroot/${f}`)), `${f} is served for the on-page editor`);
  assert.equal(statMode(ADMIN(w, "docroot/cgi-bin/vadmin-api")), "755");
  assert.equal(statMode(join(w.root, "srv/fwportal/admin-secret")), "700");
  assert.ok(readFileSync(join(w.fake, "service.log"), "utf8").includes("restart"));
  done(w);
});

t("installer: the CGI wrapper runs the admin API (401/503 without a login) with the right environment", () => {
  const w = world();
  assert.equal(run(w).code, 0);
  const wrapper0 = readFileSync(ADMIN(w, "docroot/cgi-bin/vadmin-api"), "utf8");
  const local = join(w.dir, "wrapper-local.sh");   // the paths are absolute on the Radxa: point them into the scratch tree
  writeFileSync(local, wrapper0.replaceAll("'/srv/", `'${w.root}/srv/`)); chmodSync(local, 0o755);
  const r = spawnSync(local, [], {
    env: { PATH: process.env.PATH, REQUEST_METHOD: "GET", QUERY_STRING: "action=status", HTTP_HOST: "radxa:18082" }, encoding: "utf8", timeout: 20000,
  });
  assert.match(r.stdout, /^Status: (401 Unauthorized|503 Service Unavailable)\r\n/, r.stdout + r.stderr);
  const wrapper = readFileSync(ADMIN(w, "docroot/cgi-bin/vadmin-api"), "utf8");
  assert.ok(wrapper.includes("VADMIN_ROOT='/srv/fwportal/staging/viteh-site'") && wrapper.includes("VADMIN_PREVIEW_PORT='18083'"));
  done(w);
});

t("installer: a service that fails to start is rolled back (service and init script removed)", () => {
  const w = world({ flags: ["fail-start"] });
  const r = run(w);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /service start failed/);
  assert.match(r.out, /rolling back/);
  assert.ok(!existsSync(w.initd), "init script removed");
  assert.match(readFileSync(join(w.fake, "service.log"), "utf8"), /stop/);
  done(w);
});

t("installer: a main portal that answers differently after the start triggers the automatic rollback", () => {
  const w = world({ flags: ["hijack-after-install"] });
  const r = run(w);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /main portal .*body changed/);
  assert.match(r.out, /rolling back/);
  assert.ok(!existsSync(w.initd));
  assert.match(r.out, /answers as before/, "the portal was re-checked after the rollback");
  done(w);
});

t("installer: refuses a public listen address and changes nothing", () => {
  const w = world();
  const r = run(w, ["--listen", "8.8.8.8"]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /refusing to listen on 8\.8\.8\.8/);
  assert.ok(!existsSync(w.initd) && !existsSync(ADMIN(w)));
  done(w);
});

t("installer: accepts loopback, LAN and Tailscale addresses", () => {
  const w = world();
  const r = run(w, ["--listen", "127.0.0.1", "--listen", "192.168.1.20", "--listen", "100.101.102.103"]);
  assert.equal(r.code, 0, r.out);
  const init = readFileSync(w.initd, "utf8");
  for (const ip of ["127.0.0.1", "192.168.1.20", "100.101.102.103"]) assert.ok(init.includes(`-p ${ip}:18082`) && init.includes(`-p ${ip}:18083`), ip);
  done(w);
});

t("installer: no uhttpd means no change", () => {
  const w = world();
  const r = run(w, [], { UHTTPD_BIN: join(w.dir, "nope") });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /uhttpd not found/);
  assert.ok(!existsSync(ADMIN(w)) && !existsSync(w.initd));
  done(w);
});

t("installer: --dry-run changes nothing and shows the service script", () => {
  const w = world();
  const r = run(w, ["--dry-run"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /would write .*init\.d\/vadmin/);
  assert.match(r.out, /procd_open_instance admin/);
  assert.ok(!existsSync(ADMIN(w)) && !existsSync(w.initd) && !existsSync(join(w.fake, "service.log")));
  done(w);
});

t("installer: --uninstall stops and removes the service, keeps the data", () => {
  const w = world();
  assert.equal(run(w).code, 0);
  writeFileSync(STAGE(w, "draft.json"), "{}");
  const r = run(w, ["--uninstall"]);
  assert.equal(r.code, 0, r.out);
  assert.ok(!existsSync(w.initd));
  assert.ok(existsSync(STAGE(w, "draft.json")), "draft kept without --purge-data");
  assert.ok(existsSync(ADMIN(w, "cgi/vadmin.py")), "code kept without --purge-code");
  done(w);
});

t("installer: --update-code refreshes the code, docroot and site files without touching the service or the draft", () => {
  const w = world();
  assert.equal(run(w).code, 0);
  const init = readFileSync(w.initd, "utf8");
  const calls = readFileSync(join(w.fake, "service.log"), "utf8");
  writeFileSync(STAGE(w, "draft.json"), '{"rev":7}');
  writeFileSync(ADMIN(w, "docroot/stale.txt"), "x");
  const r = run(w, ["--update-code"]);
  assert.equal(r.code, 0, r.out);
  assert.equal(readFileSync(w.initd, "utf8"), init);
  assert.equal(readFileSync(join(w.fake, "service.log"), "utf8"), calls, "no service call");
  assert.equal(readFileSync(STAGE(w, "draft.json"), "utf8"), '{"rev":7}');
  assert.ok(!existsSync(ADMIN(w, "docroot/stale.txt")) && existsSync(ADMIN(w, "docroot/cgi-bin/vadmin-api")));
  assert.match(readFileSync(ADMIN(w, "docroot/cgi-bin/vadmin-api"), "utf8"), /VADMIN_PREVIEW_PORT='18083'/, "ports from the install are kept");
  done(w);
});

t("installer: does not mention nginx, the reserve, mail, files, bridge or the system cgi-bin", () => {
  const w = world();
  assert.equal(run(w).code, 0);
  const init = readFileSync(w.initd, "utf8");
  for (const forbidden of ["nginx", "/api/mail", "/api/files", "/api/bridge", "reserve", "/www"]) assert.ok(!init.includes(forbidden), forbidden);
  done(w);
});
