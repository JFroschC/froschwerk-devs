import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { codexExecArgs } from "./codex-cli.mjs";
import { commandInvocation, runtimeEnvironment } from "./runtime-env.mjs";

const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const workspaceArg = valueFor("--workspace");
const expectedUser = String(process.env.FROSCH_AGENT_USERNAME ?? "FroschAgent").toLowerCase();
const username = String(process.env.USERNAME ?? "").toLowerCase();

if (!workspaceArg) throw new Error("Usage: node scripts/verify-codex-write.mjs --workspace <workspace>");
if (username !== expectedUser) throw new Error(`Schreibprobe darf nur unter ${process.env.FROSCH_AGENT_USERNAME ?? "FroschAgent"} laufen, aktuell: ${process.env.USERNAME ?? "unbekannt"}.`);

const workspace = resolve(workspaceArg);
const probeName = ".froschwerk-codex-write-probe.txt";
const probePath = join(workspace, probeName);
const marker = `codex-write-confirmed:${Date.now()}`;
if (existsSync(probePath)) throw new Error(`${probeName} existiert bereits; Probe nicht gestartet, damit keine vorhandene Datei überschrieben wird.`);

writeFileSync(probePath, "Harness prepared this harmless write probe.\n", { encoding: "utf8", flag: "wx" });
const prompt = `Controlled write-permission check only. In ${basename(workspace)}, edit exactly ${probeName} and append this line verbatim: ${marker}\nDo not read, change, create, or delete any other file. Reply briefly after saving the file.`;
const commandArgs = codexExecArgs({
  workspace,
  model: process.env.DEVELOPER_CODEX_MODEL ?? "gpt-5.6-terra",
  reasoningEffort: process.env.DEVELOPER_CODEX_REASONING_EFFORT ?? "medium",
  serviceTier: process.env.DEVELOPER_CODEX_SERVICE_TIER ?? "default",
  sandbox: "workspace-write",
  json: true,
  skipGitRepoCheck: !existsSync(join(workspace, ".git")),
  ignoreRules: true,
});

let result;
let persistedBeforeCleanup = false;
let cleanupError;
try {
  result = await new Promise((resolve, reject) => {
    const invocation = commandInvocation(process.platform === "win32" ? "codex.cmd" : "codex", commandArgs);
    const child = spawn(invocation.command, invocation.args, {
      cwd: workspace, env: runtimeEnvironment(workspace), stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(prompt);
  });
  persistedBeforeCleanup = result.code === 0 && existsSync(probePath) && readFileSync(probePath, "utf8").includes(marker);
} finally {
  try { if (existsSync(probePath)) rmSync(probePath); } catch (error) { cleanupError = `Probe-Datei wurde geändert, konnte aber nicht entfernt werden: ${error instanceof Error ? error.message : String(error)}`; }
}
if (cleanupError) throw new Error(cleanupError);
if (!persistedBeforeCleanup) throw new Error(`Codex-Schreibprobe fehlgeschlagen (Exit-Code ${result.code ?? "unbekannt"}). ${result.stderr.trim()}`);
console.log(JSON.stringify({ ok: true, user: process.env.USERNAME, workspace, sandbox: "workspace-write", persistedBeforeCleanup, cleanedUp: !existsSync(probePath) }));
