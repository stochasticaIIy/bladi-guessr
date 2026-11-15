import { normaliseSeed } from "./challenge";
import { DEFAULT_MODE, isGameMode, type GameMode } from "./modes";

/**
 * Shared leaderboard: model, validation and the "personal best" merge.
 *
 * Two boards live in one JSONBin document:
 *   - `scores`: the global board, one row per player (their best game ever);
 *   - `challenges`: one small board per shared link, so friends who played the
 *     same rounds can be compared against each other.
 *
 * Kept free of `fetch` and `next/headers` so the rules can be unit-tested and
 * so nothing here can accidentally pull the JSONBin key into a client bundle.
 */

/** Shown to players. Long enough for a full Moroccan name, short enough for a phone row. */
export const MAX_NAME_LENGTH = 16;
/** Rows shown on screen. */
export const BOARD_SIZE = 10;
/** Rows kept in the bin. Old, low scores are dropped so the document stays small. */
export const MAX_ENTRIES = 100;
/** Kept per shared challenge. */
export const CHALLENGE_ENTRIES = 25;
/** How many recent challenge links keep their board (JSONBin bins cap at 100 KB). */
export const MAX_CHALLENGES = 10;

export type ScoreEntry = {
  /** Random per-browser id. Never sent to other players: it is a capability. */
  id: string;
  name: string;
  score: number;
  /** Maximum achievable score in the game that produced this row. */
  max: number;
  rounds: number;
  at: number;
};

export type Challenge = {
  seed: string;
  /** Street and photo links can share a seed, so boards are scoped by both. */
  mode: GameMode;
  createdAt: number;
  scores: ScoreEntry[];
};

export type Board = {
  v: 2;
  game: "bladi";
  updatedAt: number;
  scores: ScoreEntry[];
  challenges: Challenge[];
};

export type PublicEntry = {
  rank: number;
  name: string;
  score: number;
  max: number;
  rounds: number;
  at: number;
  /** True for the entry owned by the player asking. */
  you: boolean;
};

export type PublicBoard = {
  entries: PublicEntry[];
  you: PublicEntry | null;
  total: number;
};

export type Submission = {
  id: string;
  name: string;
  score: number;
  max: number;
  rounds: number;
  at: number;
};

const PLAYER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Control and bidirectional-override characters: invisible, and usable to fake
 * a name. Zero-width joiners (U+200C/U+200D) stay: they hold emoji sequences
 * and Arabic/Persian letter joins together.
 */
const UNSAFE_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * Normalises a name typed by a player.
 *
 * Returns `null` for anything unusable, otherwise a trimmed, single-spaced,
 * 16-character-at-most name. Emoji and Arabic letters are counted as one
 * character each, so an emoji name is not cut in half mid-sequence.
 */
export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(UNSAFE_CHARS, "").replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return null;
  return truncate(cleaned, MAX_NAME_LENGTH);
}

/**
 * Cuts by visible character, not by UTF-16 code unit, so an emoji name never
 * ends in half a flag or a dangling zero-width joiner. `Intl.Segmenter` is the
 * only API that knows about grapheme clusters; older runtimes fall back to
 * code points, which is still better than slicing bytes.
 */
function truncate(value: string, limit: number): string {
  type Segmenter = new () => { segment(input: string): Iterable<{ segment: string }> };
  const SegmenterCtor = (Intl as unknown as { Segmenter?: Segmenter }).Segmenter;

  if (!SegmenterCtor) return Array.from(value).slice(0, limit).join("");

  let result = "";
  let count = 0;
  for (const { segment } of new SegmenterCtor().segment(value)) {
    if (count === limit) break;
    result += segment;
    count += 1;
  }
  return result;
}

export function emptyBoard(now = Date.now()): Board {
  return { v: 2, game: "bladi", updatedAt: now, scores: [], challenges: [] };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isInteger = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function toEntry(value: unknown): ScoreEntry | null {
  if (!isObject(value)) return null;
  const { id, name, score, max, rounds, at } = value;
  if (typeof id !== "string" || !PLAYER_ID.test(id)) return null;
  const cleaned = cleanName(name);
  if (!cleaned) return null;
  if (!isInteger(max, 1, 1_000_000)) return null;
  if (!isInteger(score, 0, max)) return null;
  if (!isInteger(rounds, 1, 100)) return null;
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return null;
  return { id, name: cleaned, score, max, rounds, at };
}

/** Drops broken rows, keeps one row per player, then ranks and caps. */
function toEntries(value: unknown, cap: number): ScoreEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: ScoreEntry[] = [];
  for (const raw of value) {
    const entry = toEntry(raw);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  return sortEntries(entries).slice(0, cap);
}

function toChallenge(value: unknown, now: number): Challenge | null {
  if (!isObject(value)) return null;
  const seed = normaliseSeed(value.seed);
  if (!seed) return null;
  return {
    seed,
    // Boards written before photo mode existed are street boards.
    mode: isGameMode(value.mode) ? value.mode : DEFAULT_MODE,
    createdAt: typeof value.createdAt === "number" && value.createdAt > 0 ? value.createdAt : now,
    scores: toEntries(value.scores, CHALLENGE_ENTRIES),
  };
}

/**
 * Reads whatever is in the bin.
 *
 * A bin that is empty, written by an older version, or hand-edited must never
 * crash the game: unknown shapes become an empty board, and broken rows are
 * dropped instead of invalidating the whole document.
 */
export function parseBoard(record: unknown, now = Date.now()): Board {
  const source = isObject(record) && "record" in record ? record.record : record;
  if (!isObject(source)) return emptyBoard(now);

  const challenges: Challenge[] = [];
  const seen = new Set<string>();
  if (Array.isArray(source.challenges)) {
    for (const raw of source.challenges) {
      const challenge = toChallenge(raw, now);
      const key = challenge ? `${challenge.mode}:${challenge.seed}` : null;
      if (!challenge || !key || seen.has(key)) continue;
      seen.add(key);
      challenges.push(challenge);
    }
  }

  return {
    v: 2,
    game: "bladi",
    updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : now,
    scores: toEntries(source.scores, MAX_ENTRIES),
    challenges: challenges
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_CHALLENGES),
  };
}

/** Highest score first; on a tie the earlier run wins. */
function sortEntries(entries: ScoreEntry[]): ScoreEntry[] {
  return [...entries].sort((a, b) => b.score - a.score || a.at - b.at);
}

/**
 * Merges one player's result into a set of rows.
 *
 * A player has exactly one row per board: their personal best. Replaying keeps
 * the higher score, and changing your name never costs you your place.
 */
function upsertEntry(entries: ScoreEntry[], submission: Submission, cap: number): ScoreEntry[] {
  const existing = entries.find((entry) => entry.id === submission.id);

  const merged: ScoreEntry = !existing
    ? { ...submission }
    : existing.score > submission.score
      ? { ...existing, name: submission.name }
      : {
          ...submission,
          // Keep the time of the run that actually set the best score.
          at: existing.score === submission.score ? existing.at : submission.at,
        };

  const others = entries.filter((entry) => entry.id !== submission.id);
  return sortEntries([...others, merged]).slice(0, cap);
}

/** Merges a finished game into the global board. */
export function submitScore(board: Board, submission: Submission, now = Date.now()): Board {
  return {
    ...board,
    updatedAt: now,
    scores: upsertEntry(board.scores, submission, MAX_ENTRIES),
  };
}

/**
 * Merges a finished game into a challenge board, creating it on first play.
 * The touched challenge moves to the front so the oldest board is evicted first.
 */
export function submitChallengeScore(
  board: Board,
  seed: string,
  mode: GameMode,
  submission: Submission,
  now = Date.now(),
): Board {
  const existing = board.challenges.find(
    (challenge) => challenge.seed === seed && challenge.mode === mode,
  );
  const challenge: Challenge = {
    seed,
    mode,
    createdAt: existing?.createdAt ?? now,
    scores: upsertEntry(existing?.scores ?? [], submission, CHALLENGE_ENTRIES),
  };

  return {
    ...board,
    updatedAt: now,
    challenges: [
      challenge,
      ...board.challenges.filter(
        (entry) => !(entry.seed === seed && entry.mode === mode),
      ),
    ].slice(0, MAX_CHALLENGES),
  };
}

/** True when two boards hold the same results, so the bin does not need a write. */
export function sameContent(a: Board, b: Board): boolean {
  return JSON.stringify(a.scores) === JSON.stringify(b.scores) &&
    JSON.stringify(a.challenges) === JSON.stringify(b.challenges);
}

/**
 * The view a browser gets: ranks, and the player's own row marked.
 *
 * Deliberately drops `id` — it is the only thing that lets someone overwrite
 * another player's name.
 */
export function publicEntries(
  entries: ScoreEntry[],
  viewerId: string | null,
  limit = BOARD_SIZE,
): PublicBoard {
  const ranked = sortEntries(entries);
  const visible = ranked.slice(0, limit).map((entry, index) => ({
    rank: index + 1,
    name: entry.name,
    score: entry.score,
    max: entry.max,
    rounds: entry.rounds,
    at: entry.at,
    you: viewerId !== null && entry.id === viewerId,
  }));

  const ownIndex = viewerId === null ? -1 : ranked.findIndex((entry) => entry.id === viewerId);
  const own = ownIndex === -1 ? null : ranked[ownIndex];

  return {
    entries: visible,
    you: own
      ? {
          rank: ownIndex + 1,
          name: own.name,
          score: own.score,
          max: own.max,
          rounds: own.rounds,
          at: own.at,
          you: true,
        }
      : null,
    total: ranked.length,
  };
}

export function publicBoard(board: Board, viewerId: string | null, limit = BOARD_SIZE): PublicBoard {
  return publicEntries(board.scores, viewerId, limit);
}

/** The board of one shared link; empty (not null) before anyone has played it. */
export function publicChallenge(
  board: Board,
  seed: string,
  mode: GameMode,
  viewerId: string | null,
  limit = BOARD_SIZE,
): PublicBoard {
  const challenge = board.challenges.find(
    (entry) => entry.seed === seed && entry.mode === mode,
  );
  return publicEntries(challenge?.scores ?? [], viewerId, limit);
}
