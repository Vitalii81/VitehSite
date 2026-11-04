// deploy-from-radxa.sh with a fake ssh (runs the Radxa CLI locally) and a fake deploy script.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const have = ["sh", "python3", "tar"].every((t) => spawnSync("sh", ["-c", `command -v ${t}`]).status === 0);
const t = (name, fn) => test(name, { skip: !have && "sh/python3/tar not available" }, fn);

function world() {
  const dir = mkdtempSync(join(tmpdir(), "vadmin-deploy-"));
  const data = join(dir, "data"), bin = join(dir, "bin");
  mkdirSync(bin); mkdirSync(join(data, "secret"), { recursive: true });
  const env = { ...process.env, VADMIN_ROOT: join(data, "staging"), VADMIN_SECRET: join(data, "secret"), VADMIN_SRC: repo, PATH: `${bin}:${process.env.PATH}` };
  writeFileSync(join(bin, "ssh"), '#!/bin/sh\n# fake ssh: ignore every option and the host, run the remote command locally\nfor last; do :; done\nexec sh -c "$last"\n'); chmodSync(join(bin, "ssh"), 0o755);
  writeFileSync(join(dir, "deploy-worker.sh"), `#!/bin/sh\n[ "$1" = "--source" ] || exit 9\nls "$2" > "${dir}/deployed.txt"\ntest -f "$2/index.html" || exit 8\n`); chmodSync(join(dir, "deploy-worker.sh"), 0o755);
  const cli = (...args) => spawnSync("python3", [join(repo, "radxa-admin/vadmin-cli.py"), ...args], { env, encoding: "utf8" });
  const build = cli("build");
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const id = readdirSync(join(data, "staging/builds")).find((n) => /^\d{8}-\d{6}-[0-9a-f]{8}$/.test(n));
  const deploy = (...args) => spawnSync("sh", [join(repo, "radxa-admin/deploy-from-radxa.sh"), ...args], {
    env: { ...env, RADXA_SSH: "fake@radxa", RADXA_KEY: "/nonexistent", DEPLOY_SCRIPT: join(dir, "deploy-worker.sh"), REMOTE_CLI: `python3 ${join(repo, "radxa-admin/vadmin-cli.py")}`, REMOTE_ENV: "TZ=UTC" }, encoding: "utf8", cwd: dir,
  });
  return { dir, data, id, cli, deploy };
}

t("deploy-from-radxa: downloads, verifies, deploys and marks the build as published", () => {
  const w = world();
  const r = w.deploy(w.id);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK: \d+ files match the manifest/);
  assert.ok(readFileSync(join(w.dir, "deployed.txt"), "utf8").includes("index.html"));
  const state = JSON.parse(readFileSync(join(w.data, "staging/state.json"), "utf8"));
  assert.equal(state.published, w.id);
  rmSync(w.dir, { recursive: true, force: true });
});

t("deploy-from-radxa: without an id it takes the latest built package", () => {
  const w = world();
  const r = w.deploy();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`Using the latest built package: ${w.id}`));
  rmSync(w.dir, { recursive: true, force: true });
});

t("deploy-from-radxa: a tampered package is refused and nothing is deployed or marked", () => {
  const w = world();
  writeFileSync(join(w.data, "staging/builds", w.id, "site/index.html"), "<html>tampered</html>");
  const r = w.deploy(w.id);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /Verification FAILED/);
  assert.ok(!existsSync(join(w.dir, "deployed.txt")), "deploy script was not called");
  const state = JSON.parse(readFileSync(join(w.data, "staging/state.json"), "utf8"));
  assert.notEqual(state.published, w.id);
  rmSync(w.dir, { recursive: true, force: true });
});

t("deploy-from-radxa: a bad id or an unknown build is refused", () => {
  const w = world();
  assert.notEqual(w.deploy("../../etc").status, 0);
  assert.notEqual(w.deploy("20200101-000000-deadbeef").status, 0);
  assert.ok(!existsSync(join(w.dir, "deployed.txt")));
  rmSync(w.dir, { recursive: true, force: true });
});

t("deploy-from-radxa: --dry-run verifies but does not deploy", () => {
  const w = world();
  const r = w.deploy(w.id, "--dry-run");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!existsSync(join(w.dir, "deployed.txt")));
  rmSync(w.dir, { recursive: true, force: true });
});
