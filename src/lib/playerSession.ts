/**
 * Client-persisted {playerId, nickname} per PIN so a refresh, a dropped
 * connection, or navigating back to /join for a game already joined
 * re-associates with the existing Player record instead of creating a
 * duplicate (Story 7.1).
 */
type PlayerSession = { playerId: string; nickname: string };

function storageKey(pin: string): string {
  return `quiz-player:${pin}`;
}

export function savePlayerSession(pin: string, session: PlayerSession): void {
  window.sessionStorage.setItem(storageKey(pin), JSON.stringify(session));
}

export function getPlayerSession(pin: string): PlayerSession | null {
  const raw = window.sessionStorage.getItem(storageKey(pin));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.playerId === "string" && typeof parsed?.nickname === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
