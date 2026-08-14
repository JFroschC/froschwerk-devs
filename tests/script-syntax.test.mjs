import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));

test("every executable Harness script is syntactically valid", () => {
  for (const file of readdirSync(new URL("../scripts/", import.meta.url)).filter((name) => name.endsWith(".mjs"))) {
    const result = spawnSync(process.execPath, ["--check", `scripts/${file}`], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, `${file}:\n${result.stderr || result.stdout}`);
  }
});
