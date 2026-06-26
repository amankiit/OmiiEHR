import env from "../config/env.js";

// Single call to Groq's OpenAI-compatible Chat Completions endpoint. Returns the
// assistant message (which may contain `tool_calls`). No SDK needed — Node's global
// fetch is enough, and staying on the raw HTTP shape keeps the provider swappable.
export const chatComplete = async ({ messages, tools }) => {
  const response = await fetch(`${env.agentBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.groqApiKey}`
    },
    body: JSON.stringify({
      model: env.agentModel,
      max_tokens: 1024,
      temperature: 0.2,
      // One tool call per turn keeps the human-in-the-loop confirmation flow simple
      // and deterministic.
      parallel_tool_calls: false,
      messages,
      ...(tools.length ? { tools, tool_choice: "auto" } : {})
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error("LLM returned no message");
  }
  return message;
};
