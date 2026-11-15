import { cookies } from "next/headers";

/**
 * A long-lived, random per-browser id.
 *
 * It exists so the shared leaderboard keeps exactly one row per player (their
 * personal best) without asking anyone to create an account. The value is a
 * random UUID and is never shown to other players: it acts as the capability to
 * rename that row, nothing more. Scores are not stored here — they are
 * recomputed by the server from the signed game cookie.
 */
const COOKIE_NAME = "bladi_player";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readPlayerId(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  return value && UUID.test(value) ? value : null;
}

/** Returns the existing id, or issues one. Always call this before a write. */
export async function ensurePlayerId(secure: boolean): Promise<string> {
  const existing = await readPlayerId();
  if (existing) return existing;

  const id = crypto.randomUUID();
  const store = await cookies();
  store.set(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return id;
}
