/**
 * Thin client for OpenRouter's OpenAI-compatible chat-completions endpoint.
 * No SDK — OpenRouter's API is a straight superset of the OpenAI schema, so
 * a single fetch call is simpler than pulling in a dependency for it.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 30_000;

export type ChatMessage = { role: "system" | "user"; content: string };

export class OpenRouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterError";
  }
}

/**
 * Sends one chat-completion request to the given model and returns the
 * assistant message's raw text content. Requests JSON-object output —
 * callers are still responsible for validating the shape of what comes
 * back, since "valid JSON" and "matches our schema" are different things.
 */
export async function completeChat(model: string, messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new OpenRouterError("OPENROUTER_API_KEY is not set.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter uses these purely for its own leaderboards/analytics.
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://bhagavatham-quiz-game",
        "X-Title": "Bhagavatam Quiz Live",
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new OpenRouterError(
      error instanceof Error && error.name === "AbortError"
        ? `OpenRouter request to ${model} timed out.`
        : `Could not reach OpenRouter: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new OpenRouterError(`OpenRouter returned HTTP ${response.status} for ${model}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new OpenRouterError(`OpenRouter returned no content for ${model}.`);
  return content;
}
