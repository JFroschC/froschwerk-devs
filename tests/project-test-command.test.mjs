import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveProjectTestCommand } from "../scripts/project-test-command.mjs";

test("configured project test commands take precedence", () => {
  const result = resolveProjectTestCommand({ testCommand: "pnpm test" }, tmpdir());
  assert.deepEqual(result, { command: "pnpm test", source: "configured" });
});

test("configured npm tests use the package script directly", () => {
  const workspace = mkdtempSync(join(tmpdir(), "harness-test-command-"));
  try {
    writeFileSync(join(workspace, "package.json"), JSON.stringify({ scripts: { test: "node --test tests/**/*.test.js" } }));
    assert.deepEqual(resolveProjectTestCommand({ testCommand: "npm test" }, workspace), { command: "node --test tests/**/*.test.js", source: "configured" });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("the harness discovers an npm test script when no command is configured", () => {
  const workspace = mkdtempSync(join(tmpdir(), "harness-test-command-"));
  try {
    writeFileSync(join(workspace, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    assert.deepEqual(resolveProjectTestCommand({ testCommand: "" }, workspace), { command: "node --test", source: "package-script" });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("the harness reports no command only when neither configuration nor package script exists", () => {
  const workspace = mkdtempSync(join(tmpdir(), "harness-test-command-"));
  try {
    assert.deepEqual(resolveProjectTestCommand({ testCommand: "" }, workspace), { command: "", source: "missing" });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
