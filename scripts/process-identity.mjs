import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";

function unixIdentity(processId) {
  try {
    // Field 22 is Linux' monotonic process start time. It makes a reused PID
    // distinguishable without trusting a process name or command line.
    const stat = readFileSync(`/proc/${processId}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    return fields[19] ? `unix:${processId}:${fields[19]}` : undefined;
  } catch {
    return undefined;
  }
}

function windowsIdentity(processId) {
  const command = `(Get-Process -Id ${Number(processId)} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
  const createdAt = String(result.stdout ?? "").trim();
  return result.status === 0 && createdAt ? `win:${processId}:${createdAt}` : undefined;
}

export function processIdentity(processId) {
  if (!Number.isSafeInteger(Number(processId)) || Number(processId) <= 0) return undefined;
  return process.platform === "win32" ? windowsIdentity(processId) : unixIdentity(processId);
}

export function inspectProcess(processId, expectedIdentity) {
  const identity = processIdentity(processId);
  if (!identity) return { state: "missing" };
  if (expectedIdentity && expectedIdentity !== identity) return { state: "reused", identity };
  // Older rows without an identity cannot safely be force-killed after a
  // restart. They are released as lost, never by targeting a naked PID.
  if (!expectedIdentity) return { state: "unverified", identity };
  return { state: "alive", identity };
}

export function requestProcessStop(processId, { force = false } = {}) {
  if (!processId) return false;
  if (process.platform === "win32") {
    const args = ["/pid", String(processId), "/t"];
    if (force) args.push("/f");
    spawn("taskkill", args, { windowsHide: true, stdio: "ignore" }).unref();
    return true;
  }
  try {
    process.kill(Number(processId), force ? "SIGKILL" : "SIGTERM");
    return true;
  } catch {
    return false;
  }
}
