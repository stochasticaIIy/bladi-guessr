import { normaliseSeed } from "./challenge";
import {
  MAX_SKIPS,
  isGameMode,
  isRoundId,
  roundCount,
  type GameState,
  type GuessRecord,
} from "./game";
import { haversineKm, isValidLatLng } from "./geo";
import { requireLocation } from "./locations";
import { requirePanorama } from "./panoramas";
import { scoreForDistance } from "./scoring";

/**
 * Serialisation + signing for the game cookie. Kept free of `next/headers` so
 * it can be unit-tested directly.
 */
const FALLBACK_SECRET = "bladi-guessr-dev-secret-set-GAME_SECRET-in-production";
const SECRET = process.env.GAME_SECRET || FALLBACK_SECRET;

if (process.env.NODE_ENV === "production" && !process.env.GAME_SECRET) {
  console.warn(
    "[bladi] GAME_SECRET is not set: falling back to the public development key. " +
      "Set GAME_SECRET before deploying, or game cookies can be forged.",
  );
}
export const MAX_COOKIE_BYTES = 3800;

const encoder = new TextEncoder();
let keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      "raw",
      encoder.encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  return keyPromise;
}

async function sign(payload: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await getKey(), encoder.encode(payload));
  return Buffer.from(new Uint8Array(signature)).toString("base64url");
}

async function isValidSignature(payload: string, signature: string): Promise<boolean> {
  try {
    const bytes = Buffer.from(signature, "base64url");
    if (bytes.length !== 32) return false;
    return await crypto.subtle.verify(
      "HMAC",
      await getKey(),
      new Uint8Array(bytes),
      encoder.encode(payload),
    );
  } catch {
    return false;
  }
}

function isKnownRoundId(value: unknown, mode: GameState["mode"]): value is string {
  return typeof value === "string" && isRoundId(mode, value);
}

/**
 * Turns a stored guess back into a record, recomputing the distance and score
 * from the round's coordinates. Even a correctly signed cookie can therefore
 * never carry an inflated score: the numbers are derived, never trusted.
 */
function rebuildGuess(
  value: unknown,
  roundId: string,
  mode: GameState["mode"],
): GuessRecord | null {
  if (!value || typeof value !== "object") return null;
  const guess = (value as Record<string, unknown>).guess;
  if (!isValidLatLng(guess)) return null;
  const round =
    mode === "photos" ? requireLocation(roundId) : requirePanorama(roundId);

  const distanceKm = haversineKm(guess, { lat: round.lat, lng: round.lng });
  return {
    roundId,
    guess: { lat: guess.lat, lng: guess.lng },
    distanceKm,
    score: scoreForDistance(distanceKm),
  };
}

/** Rejects anything that is not a well-formed game the server itself could have made. */
export function parseState(payload: string): GameState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const state = parsed as Record<string, unknown>;
  if (state.v !== 3 || typeof state.id !== "string") return null;
  if (!isGameMode(state.mode)) return null;
  if (!Array.isArray(state.roundIds)) return null;
  if (!Array.isArray(state.guesses)) return null;
  if (state.skipped !== undefined && !Array.isArray(state.skipped)) return null;

  const mode = state.mode;
  const roundIds = state.roundIds;
  // A game is a handful of rounds; anything larger means a forged blob.
  if (roundIds.length < 1 || roundIds.length > roundCount(mode)) return null;
  if (!roundIds.every((id) => isKnownRoundId(id, mode))) return null;
  if (new Set(roundIds).size !== roundIds.length) return null;
  if (state.guesses.length > roundIds.length) return null;

  const skipped = (state.skipped ?? []) as unknown[];
  if (skipped.length > MAX_SKIPS) return null;
  if (!skipped.every((id) => isKnownRoundId(id, mode))) return null;
  if (skipped.some((id) => roundIds.includes(id as string))) return null;

  // A shared challenge is a plain seed; anything else means a forged or
  // hand-edited blob, so the whole state is refused rather than downgraded.
  let challenge: string | null = null;
  if (state.challenge !== undefined && state.challenge !== null) {
    challenge = normaliseSeed(state.challenge);
    if (!challenge) return null;
  }

  const guesses: GuessRecord[] = [];
  for (let i = 0; i < state.guesses.length; i++) {
    const rebuilt = rebuildGuess(state.guesses[i], roundIds[i] as string, mode);
    // Each guess must belong to the round it was played on.
    if (!rebuilt) return null;
    const stored = state.guesses[i] as Record<string, unknown>;
    if (stored.roundId !== undefined && stored.roundId !== roundIds[i]) return null;
    guesses.push(rebuilt);
  }

  return {
    v: 3,
    id: state.id,
    mode,
    roundIds: roundIds as string[],
    guesses,
    skipped: skipped as string[],
    ...(challenge ? { challenge } : {}),
    createdAt: typeof state.createdAt === "number" ? state.createdAt : Date.now(),
  };
}

export async function encodeState(state: GameState): Promise<string> {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return `${payload}.${await sign(payload)}`;
}

export async function decodeState(token: string | undefined | null): Promise<GameState | null> {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!payload || payload.length > MAX_COOKIE_BYTES) return null;
  if (!(await isValidSignature(payload, signature))) return null;
  return parseState(Buffer.from(payload, "base64url").toString("utf8"));
}
