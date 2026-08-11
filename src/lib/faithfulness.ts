/**
 * Scores whether a generated quiz question is actually supported by the
 * course-note text it was supposed to be grounded in, using autoevals'
 * (https://github.com/braintrustdata/autoevals) RAGAS-style Faithfulness
 * metric — an LLM-as-judge check for whether the claim's assertions appear
 * in the source, not just whether they sound plausible. Points at
 * OpenRouter (OpenAI-compatible) so the judge call uses the same key/budget
 * as generation itself.
 */

import OpenAI from "openai";
import { Faithfulness } from "autoevals";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set.");
    client = new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });
  }
  return client;
}

/**
 * Returns a 0-1 faithfulness score, or null when there's nothing to check
 * (no source text for this scope) or the judge call itself failed — a
 * validator outage shouldn't silently drop an otherwise-valid question, so
 * callers should treat null as "skip this check" rather than "failed it."
 */
export async function scoreFaithfulness(claim: string, sourceText: string, judgeModel: string): Promise<number | null> {
  if (!sourceText.trim()) return null;

  try {
    const result = await Faithfulness({
      output: claim,
      context: sourceText,
      model: judgeModel,
      client: getClient(),
    });
    return typeof result.score === "number" ? result.score : null;
  } catch {
    return null;
  }
}
