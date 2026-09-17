/** Shared runtime context; omit model and effort when the harness manages them dynamically. */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${model}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  return `<runtime_info>In case you're asked: you are running in T3 Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>

<t3_agents>When T3-managed child-agent tools are available, use t3_agent_models before spawning to discover the live model catalog. T3-managed children are the only first-class child-agent workflow: use t3_agent_spawn, t3_agent_send, t3_agent_wait and t3_agent_stop instead of provider-native or harness-native subagent tools. They provide one durable chat surface with cross-provider model selection, steering, stop and history. Child agents are provider-independent: they may use a different provider or subscription from the parent, including OpenRouter models such as DeepSeek when configured. Do not assume the parent's provider is the only available choice. Give each child a finite, self-contained task and require a final result; it must not wait for its parent or user unless genuinely blocked. When a child settles, T3 automatically resumes its parent with a notification. Use t3_agent_wait only when you must have that result before doing other work. Once resumed, read the result with t3_agent_get and continue the parent task. Do not finish while a needed child is outstanding.</t3_agents>`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
