import assert from "node:assert/strict";
import test from "node:test";
import { classifyProjectTestResult, projectTestFailureExcerpt, reconcileTesterResult } from "../scripts/project-test-result.mjs";

test("assertions plus cleanup permission errors are failed, not blocked", () => {
  const logs = "TypeError: broken response\nError: EPERM, Permission denied";
  assert.equal(classifyProjectTestResult({ code: 1 }), "failed", logs);
});

test("only launch errors are infrastructure outcomes", () => {
  assert.equal(classifyProjectTestResult({ spawnError: true }), "blocked");
  assert.equal(classifyProjectTestResult({ code: 1, timedOut: true }), "failed");
  assert.equal(classifyProjectTestResult({ code: 0 }), "succeeded");
});

test("failure excerpts retain the actionable assertion", () => {
  const excerpt = projectTestFailureExcerpt("ℹ tests 121\nℹ pass 100\nℹ fail 21\n\n✖ failing tests:\nTypeError: broken response\nError: EPERM, Permission denied");
  assert.match(excerpt, /fail 21/);
  assert.match(excerpt, /TypeError: broken response/);
});

test("a successful central test resolves static blocks that only defer to the harness", () => {
  const result = reconcileTesterResult({
    status: "blocked",
    summary: "Der zentrale Testlauf wurde gemaess Arbeitsregel nicht selbst gestartet.",
    checks: [
      { name: "Statische Pruefung", status: "passed", details: "Korrekt." },
      { name: "Fehlgeschlagene Checks", status: "blocked", details: "Ohne den vom Harness auszufuehrenden zentralen Testlauf darf kein Erfolg behauptet werden." },
      { name: "Tester bestaetigt erneut", status: "blocked", details: "Die Bestaetigung haengt vom zentralen Harness-Testlauf ab." },
    ],
  }, "succeeded");

  assert.equal(result.status, "passed");
  assert.deepEqual(result.checks.map((check) => check.status), ["passed", "passed", "passed"]);
});

test("a successful central test does not hide a genuine static blocker", () => {
  const result = reconcileTesterResult({
    status: "blocked",
    summary: "Die Quelldateien konnten nicht gelesen werden.",
    checks: [{ name: "Quellcode", status: "blocked", details: "Zugriff verweigert." }],
  }, "succeeded");
  assert.equal(result.status, "blocked");
});

test("static product failures and central test failures remain failures", () => {
  assert.equal(reconcileTesterResult({ status: "failed", checks: [] }, "succeeded").status, "failed");
  assert.equal(reconcileTesterResult({ status: "passed", checks: [] }, "failed").status, "failed");
});
