import test from "node:test";
import assert from "node:assert/strict";
import { cleanSettings, handleSettings } from "./settings.mjs";

const post = (body, token) => new Request("https://viteh.org/api/settings", { method: "POST", headers: token ? { authorization: "Bearer " + token } : {}, body: JSON.stringify(body) });

test("only known keys with valid values are kept", () => {
  assert.deepEqual(cleanSettings({ assistantAvatar: "expert", evil: "x" }), { assistantAvatar: "expert" });
  assert.deepEqual(cleanSettings({ assistantAvatar: "<script>" }), {});
  assert.deepEqual(cleanSettings(null), {});
});

test("writing needs the secret; reading is public", async () => {
  const env = { SETTINGS_TOKEN: "s3cret-token" };
  assert.equal((await handleSettings(post({ assistantAvatar: "expert" }), env)).status, 401);
  assert.equal((await handleSettings(post({ assistantAvatar: "expert" }, "wrong-token!"), env)).status, 401);
  assert.equal((await handleSettings(post({ assistantAvatar: "expert" }), {})).status, 401);
  assert.equal((await handleSettings(post({ assistantAvatar: "expert" }, "s3cret-token"), env)).status, 200);
  const got = await handleSettings(new Request("https://viteh.org/api/settings"), env);
  assert.deepEqual(await got.json(), { assistantAvatar: "expert" });
});
