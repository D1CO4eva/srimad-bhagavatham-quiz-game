/**
 * Client-persisted responseId per quiz slug so a refresh of /quiz/[slug]
 * re-shows the student's already-submitted result instead of a blank form.
 * Uses localStorage (not sessionStorage) since a student may reasonably
 * close the tab and come back later to check their score.
 */
function storageKey(slug: string): string {
  return `quiz-response:${slug}`;
}

export function saveQuizResponseId(slug: string, responseId: string): void {
  window.localStorage.setItem(storageKey(slug), responseId);
}

export function getQuizResponseId(slug: string): string | null {
  return window.localStorage.getItem(storageKey(slug));
}
