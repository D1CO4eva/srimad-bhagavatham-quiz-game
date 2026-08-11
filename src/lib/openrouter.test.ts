import { afterEach, describe, expect, it, vi } from "vitest";
import { completeChat, OpenRouterError } from "@/lib/openrouter";

describe("completeChat", () => {
  const originalKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  it("throws when OPENROUTER_API_KEY is not set", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(completeChat("openai/gpt-4o-mini", [])).rejects.toThrow(OpenRouterError);
  });

  it("returns the assistant message's content on success", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })
      )
    );

    const content = await completeChat("openai/gpt-4o-mini", [{ role: "user", content: "hi" }]);
    expect(content).toBe('{"ok":true}');
  });

  it("throws OpenRouterError on a non-2xx response", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("server error", { status: 500 })));

    await expect(completeChat("openai/gpt-4o-mini", [])).rejects.toThrow(OpenRouterError);
  });

  it("throws OpenRouterError when the response has no message content", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })));

    await expect(completeChat("openai/gpt-4o-mini", [])).rejects.toThrow(OpenRouterError);
  });
});
