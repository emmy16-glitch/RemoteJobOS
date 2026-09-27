import { config } from "./config.js";

export async function groqJson<T>(system: string, prompt: string): Promise<T | null> {
  if (!config.groqApiKey) return null;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.groqApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.groqModel,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) throw new Error(`Groq returned ${response.status}: ${await response.text()}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  return content ? (JSON.parse(content) as T) : null;
}
