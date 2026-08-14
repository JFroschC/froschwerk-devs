function numberFrom(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function walk(value, result) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, result);
    return;
  }
  const source = value;
  const input = numberFrom(source.input_tokens ?? source.prompt_tokens ?? source.inputTokens ?? source.promptTokens);
  const output = numberFrom(source.output_tokens ?? source.completion_tokens ?? source.outputTokens ?? source.completionTokens);
  const total = numberFrom(source.total_tokens ?? source.totalTokens);
  if (input !== undefined) result.inputTokens = Math.max(result.inputTokens ?? 0, input);
  if (output !== undefined) result.outputTokens = Math.max(result.outputTokens ?? 0, output);
  if (total !== undefined) result.totalTokens = Math.max(result.totalTokens ?? 0, total);
  for (const child of Object.values(source)) walk(child, result);
}

export function extractUsage(text) {
  const result = {};
  for (const line of String(text ?? "").split(/\r?\n/).filter(Boolean)) {
    try { walk(JSON.parse(line), result); } catch { /* plain text or non-JSON CLI output */ }
  }
  if (result.totalTokens === undefined && result.inputTokens !== undefined && result.outputTokens !== undefined) result.totalTokens = result.inputTokens + result.outputTokens;
  return result;
}
