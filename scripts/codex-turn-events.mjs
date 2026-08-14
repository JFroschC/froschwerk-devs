export function createCodexTurnTracker() {
  let pending = "";
  let completed = false;

  return {
    write(chunk) {
      if (completed) return false;
      pending += String(chunk ?? "");
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          if (JSON.parse(line)?.type === "turn.completed") {
            completed = true;
            return true;
          }
        } catch {
          // Codex diagnostics can share stdout with the JSONL event stream.
        }
      }
      return false;
    },
  };
}
