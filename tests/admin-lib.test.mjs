// Runs the Python unit tests of the Radxa admin library inside `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const have = spawnSync("python3", ["--version"]).status === 0;

test("radxa-admin library (python3 -m unittest)", { skip: !have && "python3 not available", timeout: 600000 }, () => {
  const r = spawnSync("python3", ["-m", "unittest", "discover", "-s", join(repo, "radxa-admin/tests"), "-v"], { encoding: "utf8", cwd: repo });
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 0, out.split("\n").slice(-60).join("\n"));
  assert.match(out, /Ran \d+ tests?/);
});
