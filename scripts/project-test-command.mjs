import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function packageTestScript(workspace) {
  const packagePath = join(workspace, "package.json");
  if (!existsSync(packagePath)) return "";
  try {
    const value = JSON.parse(readFileSync(packagePath, "utf8"))?.scripts?.test;
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

export function resolveProjectTestCommand(project, workspace) {
  const configured = String(project?.testCommand ?? "").trim();
  const packageScript = packageTestScript(workspace);
  if (configured) {
    const invokesNpmTest = /^npm(?:\.cmd)?\s+(?:run\s+)?test$/i.test(configured);
    return { command: invokesNpmTest ? packageScript || configured : configured, source: "configured" };
  }

  if (packageScript) return { command: packageScript, source: "package-script" };
  return { command: "", source: "missing" };
}
