export function codexExecArgs({ workspace, model, reasoningEffort = "medium", serviceTier = "default", sandbox = "workspace-write", json = false, skipGitRepoCheck = false, ignoreRules = false, approveForMe = true }) {
  return [
    "--config", `service_tier=${JSON.stringify(serviceTier)}`,
    "--config", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`,
    "exec",
    ...(ignoreRules ? ["--ignore-rules"] : []),
    ...(skipGitRepoCheck ? ["--skip-git-repo-check"] : []),
    "--cd", String(workspace),
    "--add-dir", String(workspace),
    "--ephemeral",
    ...(json ? ["--json"] : []),
    "--model", model,
    ...(approveForMe && sandbox === "workspace-write" ? ["--approve-for-me"] : ["--sandbox", sandbox]),
    "-",
  ];
}

export function codexExitDiagnostic(code, stderr = "") {
  if (code !== 2) return `Exit code ${code}`;
  const detail = String(stderr).trim();
  return `CODEX_CLI_ARGUMENT_ERROR: Codex rejected the command line (exit code 2). The ticket was returned to a startable state; no product failure was inferred.${detail ? `\n\nCodex diagnostic:\n${detail}` : ""}`;
}

export function shouldAutoStartTester({ developerSucceeded, taskInReview, autoProcessEnabled }) {
  return Boolean(developerSucceeded && taskInReview && autoProcessEnabled);
}
