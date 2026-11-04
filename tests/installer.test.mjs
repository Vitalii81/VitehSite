// Tests of radxa-admin/install-on-radxa.sh against a fake nginx and a fake curl (no real server is touched). Needs `sh`, `awk`, `sed`, python3.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const haveTools = ["sh", "awk", "sed", "python3"].every((t) => spawnSync("sh", ["-c", `command -v ${t}`]).status === 0);

const MAIN_CONF = `user nobody;
events {}
http {
    include mime.types;
    server {
        listen 80;
        server_name _;
        location / { return 200 "main portal"; }
        location /api/mail { return 200 "mail"; }
    }
    server {
        listen 8080;
        location / { return 200 "second"; }
    }
}
`;

const FAKE_NGINX = `#!/bin/sh
# fake nginx: -T prints the config, -t validates, -s reload applies the "state" of the fake world
F="$FAKE"
conf="$F/etc/nginx/nginx.conf"
all() { cat "$conf"; [ -d "$F/etc/nginx/conf.d" ] && cat "$F"/etc/nginx/conf.d/*.conf 2>/dev/null; }
case "$1" in
  -T) echo "# configuration file $conf:"; all
      [ -f "$F/no-cgi" ] || echo "    fastcgi_pass unix:/run/fcgiwrap.socket;"
      [ -f "$F/confd" ] && echo "    include $F/etc/nginx/conf.d/*.conf;"
      exit 0 ;;
  -t) [ -f "$F/fail-test" ] && all | grep -q "viteh-admin" && { echo "nginx: [emerg] fake failure" >&2; exit 1; }
      [ "$(all | tr -cd '{' | wc -c)" = "$(all | tr -cd '}' | wc -c)" ] || { echo "unbalanced braces" >&2; exit 1; }
      exit 0 ;;
  -s) echo reload >> "$F/reload.log"
      if all | grep -q "viteh-admin (managed"; then
        touch "$F/admin-on"; [ -f "$F/hijack-after-install" ] && touch "$F/hijacked"
      else rm -f "$F/admin-on" "$F/hijacked"; fi
      exit 0 ;;
esac
exit 0
`;

const FAKE_CURL = `#!/bin/sh
# fake curl: portal / admin / preview answers depend on files in $FAKE
F="$FAKE"; url=""; want_code=0
for a in "$@"; do case "$a" in http*) url="$a" ;; -w) want_code=1 ;; esac; done
code=200; body=""
case "$url" in
  http://127.0.0.1:*/vadmin-api*) if [ -f "$F/admin-on" ]; then code=401; body='{"ok":false}'; else code=000; fi ;;
  http://127.0.0.1:18082/*) if [ -f "$F/admin-on" ]; then code=200; body='<title>ViTeh admin</title>'; else code=000; fi ;;
  http://127.0.0.1:18081/*) if [ -f "$F/admin-on" ]; then code=404; body='nope'; else code=000; fi ;;
  *) if [ -f "$F/hijacked" ]; then body="HIJACKED"; else body="main portal $(cat "$F/portal-extra" 2>/dev/null)"; fi ;;
esac
if [ "$want_code" = 1 ]; then printf '%s' "$code"; else printf '%s' "$body"; fi
`;

function world(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vadmin-inst-"));
  const fake = join(dir, "fake"), root = join(dir, "root"), bin = join(dir, "bin");
  for (const d of [join(fake, "etc/nginx"), root, bin, join(root, "srv/fwportal")]) mkdirSync(d, { recursive: true });
  writeFileSync(join(fake, "etc/nginx/nginx.conf"), MAIN_CONF);
  writeFileSync(join(bin, "nginx"), FAKE_NGINX); chmodSync(join(bin, "nginx"), 0o755);
  writeFileSync(join(bin, "curl"), FAKE_CURL); chmodSync(join(bin, "curl"), 0o755);
  if (opts.confd) { mkdirSync(join(fake, "etc/nginx/conf.d")); writeFileSync(join(fake, "confd"), ""); }
  for (const flag of opts.flags || []) writeFileSync(join(fake, flag), "");
  // the "copied radxa-admin/" folder: code + site files (as push-to-radxa.sh lays them out)
  const pkg = join(dir, "pkg");
  mkdirSync(join(pkg, "radxa-admin"), { recursive: true });
  for (const part of ["cgi", "lib", "web"]) cpSync(join(repo, "radxa-admin", part), join(pkg, "radxa-admin", part), { recursive: true });
  for (const f of ["vadmin-cli.py", "install-on-radxa.sh"]) cpSync(join(repo, "radxa-admin", f), join(pkg, "radxa-admin", f));
  for (const part of ["assets", "data"]) cpSync(join(repo, part), join(pkg, "radxa-admin", "site", part), { recursive: true });
  for (const f of ["index.html", "impressum.html", "datenschutz.html", "robots.txt"]) cpSync(join(repo, f), join(pkg, "radxa-admin", "site", f));
  return { dir, fake, root, bin, script: join(pkg, "radxa-admin", "install-on-radxa.sh"), conf: join(fake, "etc/nginx/nginx.conf") };
}

function run(w, args = [], env = {}) {
  const r = spawnSync("sh", [w.script, "--admin-port", "18082", "--preview-port", "18081", ...args], {
    env: { PATH: `${w.bin}:${process.env.PATH}`, FAKE: w.fake, INSTALL_ROOT: w.root, NGINX_CONF: w.conf, NGINX_BIN: join(w.bin, "nginx"), SKIP_RELOAD: "0", HOME: w.dir, ...env },
    encoding: "utf8", timeout: 60000,
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
const done = (w) => rmSync(w.dir, { recursive: true, force: true });
const t = (name, fn) => test(name, { skip: !haveTools && "sh/awk/sed/python3 not available" }, fn);

t("installer: inserts the blocks AFTER the main server block, backs up the config, installs the code", () => {
  const w = world();
  const r = run(w, ["--probe", "http://127.0.0.1/"]);
  assert.equal(r.code, 0, r.out);
  const conf = readFileSync(w.conf, "utf8");
  const main = conf.indexOf('return 200 "main portal"'), block = conf.indexOf("viteh-admin (managed"), second = conf.indexOf('return 200 "second"');
  assert.ok(main > 0 && block > main && block < second, "the managed block sits right after the first server block, before the second");
  assert.ok(conf.includes("listen 127.0.0.1:18082;") && conf.includes("listen 127.0.0.1:18081;"));
  assert.ok(!/listen\s+(0\.0\.0\.0|\*|\[::\])/.test(conf.slice(block)), "never a wildcard listen");
  assert.ok(conf.includes("fastcgi_pass unix:/run/fcgiwrap.socket;"), "reuses the existing CGI socket");
  assert.ok(readdirSync(dirname(w.conf)).some((f) => f.startsWith("nginx.conf.vadmin-backup-")), "backup file exists");
  assert.ok(existsSync(join(w.root, "srv/fwportal/admin/cgi/vadmin.py")) && existsSync(join(w.root, "srv/fwportal/staging/viteh-site/src/index.html")));
  assert.equal((statSync700(join(w.root, "srv/fwportal/admin-secret"))), "700");
  done(w);
});
function statSync700(p) { return (spawnSync("sh", ["-c", `stat -c %a "${p}"`]).stdout.toString().trim()); }

t("installer: with conf.d the main config stays byte-identical", () => {
  const w = world({ confd: true });
  const before = readFileSync(w.conf, "utf8");
  const r = run(w);
  assert.equal(r.code, 0, r.out);
  assert.equal(readFileSync(w.conf, "utf8"), before);
  assert.ok(readFileSync(join(w.fake, "etc/nginx/conf.d/viteh-admin.conf"), "utf8").includes("server {"));
  done(w);
});

t("installer: nginx -t failing after the change restores the original config", () => {
  const w = world({ flags: ["fail-test"] });
  const before = readFileSync(w.conf, "utf8");
  const r = run(w);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /nginx -t failed/);
  assert.equal(readFileSync(w.conf, "utf8"), before, "config restored");
  done(w);
});

t("installer: a main portal that answers differently after the reload triggers the automatic rollback", () => {
  const w = world({ flags: ["hijack-after-install"] });
  const before = readFileSync(w.conf, "utf8");
  const r = run(w);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /main portal .*body changed/);
  assert.match(r.out, /rolling back/);
  assert.equal(readFileSync(w.conf, "utf8"), before, "config restored");
  assert.match(r.out, /answers as before/, "the portal was re-checked after the rollback");
  done(w);
});

t("installer: refuses a public listen address and changes nothing", () => {
  const w = world();
  const before = readFileSync(w.conf, "utf8");
  const r = run(w, ["--listen", "8.8.8.8"]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /refusing to listen on 8\.8\.8\.8/);
  assert.equal(readFileSync(w.conf, "utf8"), before);
  done(w);
});

t("installer: accepts loopback, LAN and Tailscale addresses", () => {
  const w = world();
  const r = run(w, ["--listen", "127.0.0.1", "--listen", "192.168.1.20", "--listen", "100.101.102.103"]);
  assert.equal(r.code, 0, r.out);
  const conf = readFileSync(w.conf, "utf8");
  for (const ip of ["127.0.0.1", "192.168.1.20", "100.101.102.103"]) assert.ok(conf.includes(`listen ${ip}:18082;`), ip);
  done(w);
});

t("installer: no CGI mechanism means no change", () => {
  const w = world({ flags: ["no-cgi"] });
  const before = readFileSync(w.conf, "utf8");
  const r = run(w);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /no CGI mechanism found/);
  assert.equal(readFileSync(w.conf, "utf8"), before);
  assert.ok(!existsSync(join(w.root, "srv/fwportal/admin/cgi")), "no code installed either");
  done(w);
});

t("installer: --dry-run changes nothing", () => {
  const w = world();
  const before = readFileSync(w.conf, "utf8");
  const r = run(w, ["--dry-run"]);
  assert.equal(r.code, 0, r.out);
  assert.equal(readFileSync(w.conf, "utf8"), before);
  assert.ok(!existsSync(join(w.root, "srv/fwportal/admin")));
  done(w);
});

t("installer: --uninstall removes the block, keeps the data, and the config returns to the original", () => {
  const w = world();
  const original = readFileSync(w.conf, "utf8");
  assert.equal(run(w).code, 0);
  mkdirSync(join(w.root, "srv/fwportal/staging/viteh-site/uploads"), { recursive: true });
  writeFileSync(join(w.root, "srv/fwportal/staging/viteh-site/draft.json"), "{}");
  const r = run(w, ["--uninstall"]);
  assert.equal(r.code, 0, r.out);
  assert.equal(readFileSync(w.conf, "utf8"), original);
  assert.ok(existsSync(join(w.root, "srv/fwportal/staging/viteh-site/draft.json")), "draft kept without --purge-data");
  done(w);
});

t("installer: --update-code refreshes the code and the site files without touching nginx or the draft", () => {
  const w = world();
  assert.equal(run(w).code, 0);
  const conf = readFileSync(w.conf, "utf8");
  writeFileSync(join(w.root, "srv/fwportal/staging/viteh-site/draft.json"), '{"rev":7}');
  const r = run(w, ["--update-code"]);
  assert.equal(r.code, 0, r.out);
  assert.equal(readFileSync(w.conf, "utf8"), conf);
  assert.equal(readFileSync(join(w.root, "srv/fwportal/staging/viteh-site/draft.json"), "utf8"), '{"rev":7}');
  done(w);
});

t("installer: never touches the reserve, mail, files, bridge or cgi-bin locations of the main config", () => {
  const w = world();
  assert.equal(run(w).code, 0);
  const conf = readFileSync(w.conf, "utf8");
  assert.ok(conf.includes('location /api/mail { return 200 "mail"; }'), "existing locations intact");
  const managed = conf.slice(conf.indexOf("viteh-admin (managed"), conf.indexOf("<<< viteh-admin"));
  for (const forbidden of ["/api/mail", "/api/files", "/api/bridge", "/cgi-bin", "reserve"]) assert.ok(!managed.includes(forbidden), forbidden);
  done(w);
});
