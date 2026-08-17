import { firestore } from "@/lib/firestore";

const MAX_ATTEMPTS = 50;

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "quiz";
}

/** Generates a slug not currently held by any quiz, appending -2, -3, ... on collision. */
export async function generateUniqueSlug(title: string): Promise<string> {
  const base = slugify(title);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await firestore.collection("quizzes").where("slug", "==", candidate).limit(1).get();
    if (existing.empty) return candidate;
  }
  throw new Error("Could not generate a unique slug after multiple attempts.");
}
