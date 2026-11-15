/**
 * Shared challenge links.
 *
 * A challenge is just a short, URL-safe seed. Every player who opens
 * `/c/<seed>` has the same five panoramas dealt to them, so scores are
 * comparable. The seed is not a score: the server still deals and scores
 * everything, and the browser never receives coordinates.
 *
 * Client-safe: no data imports, no secrets, no dataset.
 */
import { DEFAULT_MODE, type GameMode } from "./modes";

const SEED_PATTERN = /^[a-z0-9]{4,16}$/;

/** How many characters a freshly generated link carries (36^8 ≈ 2.8e12 seeds). */
const SEED_LENGTH = 8;

/**
 * Accepts what a URL can contain and returns the canonical seed, or `null`.
 *
 * Case is folded and no other normalisation happens: `abc-123` is rejected
 * rather than silently becoming `abc123`, so two different links can never
 * point at the same challenge.
 */
export function normaliseSeed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const seed = value.trim().toLowerCase();
  return SEED_PATTERN.test(seed) ? seed : null;
}

export function newSeed(random: () => number = Math.random): string {
  let seed = "";
  while (seed.length < SEED_LENGTH) {
    seed += Math.floor(random() * 36).toString(36);
  }
  return seed;
}

/** Street is the default, so its links stay as short as they always were. */
export function challengePath(seed: string, mode: GameMode = DEFAULT_MODE): string {
  return mode === DEFAULT_MODE ? `/c/${seed}` : `/c/${seed}?m=${mode}`;
}

/**
 * Deterministic pseudo-random source (mulberry32, seeded by an FNV-1a hash).
 *
 * The seam only needs to shuffle a few hundred panorama ids the same way on
 * every server, so speed and repeatability matter, cryptographic strength does
 * not: knowing the seed gives nothing that the page does not already show.
 */
export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
