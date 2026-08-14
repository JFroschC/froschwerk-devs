import { spawn } from "node:child_process";
import { checkRuntime } from "./runtime-check.mjs";
import { runtimeEnvironment } from "./runtime-env.mjs";

const env = runtimeEnvironment(process.cwd(), {
  ...process.env,
  HARNESS_API_PORT: process.env.HARNESS_API_PORT ?? "3001",
});

const startupRuntime = checkRuntime("", { probeProviders: true, requiredProvider: "codex" });
console.log(`[harness] Laufzeitcheck: ${startupRuntime.ok ? "OK" : "FEHLER"}`);
console.log(`[harness] Benutzer: ${startupRuntime.user.username}`);
console.log(`[harness] CODEX_HOME: ${startupRuntime.codexHome.path} (${startupRuntime.codexHome.directory.writable ? "beschreibbar" : "NICHT beschreibbar"})`);
for (const message of startupRuntime.messages) console.error(`[harness] ${message}`);
if (!startupRuntime.ok) process.exit(1);

let stopping = false;
let api;
let web;
const restartTimers = new Set();

function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  else child.kill("SIGTERM");
}

function scheduleRestart(label, start) {
  if (stopping) return;
  console.error(`[harness] ${label} wurde unerwartet beendet; Neustart in 1 Sekunde.`);
  const timer = setTimeout(() => {
    restartTimers.delete(timer);
    if (!stopping) start();
  }, 1_000);
  restartTimers.add(timer);
}

function supervise(label, command, args, assign) {
  const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit", env });
  assign(child);
  let handled = false;
  const failed = (detail) => {
    if (handled || stopping) return;
    handled = true;
    scheduleRestart(`${label}${detail ? ` (${detail})` : ""}`, () => supervise(label, command, args, assign));
  };
  child.once("error", (error) => failed(error.message));
  child.once("exit", (code, signal) => failed(`Code ${code ?? "unbekannt"}${signal ? `, ${signal}` : ""}`));
  return child;
}

function startApi() {
  return supervise("API", process.execPath, ["--experimental-strip-types", "scripts/api-server.mjs"], (child) => { api = child; });
}

function startWeb() {
  return supervise("Web-Server", process.execPath, ["node_modules/vinext/dist/cli.js", "dev", ...process.argv.slice(2)], (child) => { web = child; });
}

startApi();
startWeb();

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const timer of restartTimers) clearTimeout(timer);
  restartTimers.clear();
  terminateProcessTree(api);
  terminateProcessTree(web);
  process.exitCode = code;
  setTimeout(() => process.exit(code), 5_000).unref();
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
process.on("uncaughtException", (error) => { console.error("[harness] Unbehandelter Supervisorfehler", error); stop(1); });
process.on("unhandledRejection", (error) => { console.error("[harness] Unbehandelte Promise-Ablehnung", error); stop(1); });
