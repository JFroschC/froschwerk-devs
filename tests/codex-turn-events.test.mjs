import assert from "node:assert/strict";
import test from "node:test";
import { createCodexTurnTracker } from "../scripts/codex-turn-events.mjs";

test("detects turn.completed across split JSONL chunks exactly once", () => {
  const tracker = createCodexTurnTracker();
  assert.equal(tracker.write('{"type":"item.completed"}\n{"type":"turn.'), false);
  assert.equal(tracker.write('completed","usage":{"total_tokens":42}}\n'), true);
  assert.equal(tracker.write('{"type":"turn.completed"}\n'), false);
});

test("ignores diagnostics and non-completion events", () => {
  const tracker = createCodexTurnTracker();
  assert.equal(tracker.write('warning\n{"type":"turn.started"}\n'), false);
});
