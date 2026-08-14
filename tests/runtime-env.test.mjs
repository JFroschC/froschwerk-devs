import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { runtimeEnvironment, withWorkspaceGitTrust } from "../scripts/runtime-env.mjs";

test("workspace trust is injected without changing global Git configuration", () => {
  const workspace = resolve("C:/Projects/Owned by another user");
  const env = withWorkspaceGitTrust(workspace, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.autocrlf", GIT_CONFIG_VALUE_0: "false" });
  assert.equal(env.GIT_CONFIG_COUNT, "2");
  assert.equal(env.GIT_CONFIG_KEY_0, "core.autocrlf");
  assert.equal(env.GIT_CONFIG_KEY_1, "safe.directory");
  assert.equal(env.GIT_CONFIG_VALUE_1, workspace.replace(/\\/g, "/"));
});

test("Windows child environments use the selected user's profile consistently", () => {
  const base = { USERPROFILE: "C:\\Users\\FroschAgent", HOME: "C:\\Users\\FroschiO", APPDATA: "C:\\missing", Path: "C:\\Windows" };
  const env = runtimeEnvironment("C:\\Workspace", base);
  if (process.platform === "win32") {
    assert.equal(env.HOME, "C:\\Users\\FroschAgent");
    assert.equal(env.CODEX_HOME, "C:\\Users\\FroschAgent\\.codex");
    assert.equal(env.PATH, "C:\\Windows");
    assert.equal(env.Path, undefined);
  }
  assert.equal(env.GIT_CONFIG_KEY_0, "safe.directory");
});
