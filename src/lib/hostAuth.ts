import crypto from "node:crypto";

export const HOST_SESSION_COOKIE = "host_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set.");
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function createHostSessionCookieValue(): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `host.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function isValidHostSession(value: string | undefined | null): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [scope, expiresAtStr, signature] = parts;
  if (scope !== "host" || !expiresAtStr || !signature) return false;

  const expected = sign(`${scope}.${expiresAtStr}`);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (signatureBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(signatureBuf, expectedBuf)) {
    return false;
  }

  return Number(expiresAtStr) > Date.now();
}

export function isCorrectPasscode(passcode: string): boolean {
  const expected = process.env.HOST_PASSCODE;
  if (!expected) throw new Error("HOST_PASSCODE is not set.");

  const a = Buffer.from(passcode);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
