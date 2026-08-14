export function classifyProjectTestResult({ code, timedOut = false, spawnError = false }) {
  if (spawnError) return "blocked";
  // Once the configured project test command has started, not terminating is
  // itself a failed test outcome (typically a leaked server/socket/worker).
  // Treating it as infrastructure would suppress the developer follow-up.
  if (timedOut) return "failed";
  return code === 0 ? "succeeded" : "failed";
}

function reportStatus(value) {
  return value === "passed" ? "passed" : value === "blocked" ? "blocked" : "failed";
}

function isCentralTestDeferral(value) {
  const text = typeof value === "string"
    ? value
    : `${String(value?.name ?? "")} ${String(value?.details ?? "")}`;
  return /(?:zentral|central|harness|automatisch)[\s\S]{0,160}(?:testlauf|test)|(?:testlauf|test)[\s\S]{0,160}(?:zentral|central|harness|automatisch)|gem(?:aess|\u00e4\u00df) arbeitsregel nicht selbst gestartet/i.test(text);
}

export function reconcileTesterResult(report, testResultStatus) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  if (testResultStatus === "failed") return { status: "failed", checks };
  if (testResultStatus !== "succeeded") return { status: "blocked", checks };

  const staticStatus = reportStatus(report?.status);
  if (staticStatus !== "blocked") return { status: staticStatus, checks };

  const blockedChecks = checks.filter((check) => check?.status === "blocked");
  const centralTestWasTheOnlyBlock = blockedChecks.length > 0
    ? blockedChecks.every(isCentralTestDeferral)
    : isCentralTestDeferral(report?.summary);
  if (!centralTestWasTheOnlyBlock) return { status: "blocked", checks };

  return {
    status: "passed",
    checks: checks.map((check) => check?.status === "blocked" && isCentralTestDeferral(check)
      ? { ...check, status: "passed", details: `${String(check.details ?? "")} Durch den erfolgreichen zentralen Harness-Testlauf bestaetigt.`.trim() }
      : check),
  };
}

export function projectTestFailureExcerpt(logs, maxLength = 6_000) {
  const text = String(logs ?? "").trim();
  if (!text) return "Der Testprozess endete mit einem Fehler, aber ohne Ausgabe.";
  const marker = text.search(/(?:^|\n).*(?:failing tests|fehlgeschlagene tests)\s*:/i);
  const summary = text.split(/\r?\n/).filter((line) => /(?:^|\s)(?:tests|pass|fail|duration_ms)\s+\d+/i.test(line)).slice(-6).join("\n");
  const failures = marker >= 0 ? text.slice(marker).trim() : text.slice(-maxLength);
  const excerpt = [summary, failures].filter(Boolean).join("\n\n");
  return excerpt.length > maxLength ? `${excerpt.slice(0, maxLength)}\n[Fehlerauszug gekürzt; vollständige Ausgabe steht im Testbericht.]` : excerpt;
}
