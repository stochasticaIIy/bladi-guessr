import { cookies } from "next/headers";
import { createGameState, type GameMode, type GameState } from "./game";
import { encodeState, decodeState } from "./session-core";

/**
 * Game state is kept in a signed HttpOnly cookie instead of a database:
 * no infra to run, works on serverless, survives a page refresh, and the
 * browser can never read the round answers out of it.
 */
const COOKIE_NAME = "bladi_game";
const MAX_AGE_SECONDS = 60 * 60 * 2;

export async function readGameState(): Promise<GameState | null> {
  const store = await cookies();
  return decodeState(store.get(COOKIE_NAME)?.value);
}

export async function writeGameState(state: GameState, secure: boolean): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, await encodeState(state), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearGameState(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export function newGameState(
  now = Date.now(),
  challenge?: string | null,
  mode: GameMode = "street",
): GameState {
  return createGameState(crypto.randomUUID(), now, challenge, mode);
}

/** Cookies are only marked Secure when the request actually came over HTTPS. */
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]?.trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}
