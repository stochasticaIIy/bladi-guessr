import { parseBoard, type Board } from "./leaderboard";

/**
 * JSONBin storage for the shared leaderboard.
 *
 * Server-only by construction: it reads `JSONBIN_MASTER_KEY`, which must never
 * reach a browser bundle. Everything the player sees goes through
 * `app/api/leaderboard/route.ts`.
 *
 * The master key can read *and* write every bin on the account, so the only
 * place it may appear is this file (via the environment) — never in a client
 * component, never in `NEXT_PUBLIC_*`.
 */
const BIN_ID = (process.env.JSONBIN_BIN_ID ?? "").trim();
const MASTER_KEY = (process.env.JSONBIN_MASTER_KEY ?? "").trim();

export const leaderboardConfigured = BIN_ID.length > 0 && MASTER_KEY.length > 0;

const API = "https://api.jsonbin.io/v3/b";
const TIMEOUT_MS = 6_000;
/**
 * Short server-side cache so the intro screen and the summary screen do not
 * each spend a free-tier request. JSONBin's free plan allows 10k calls/month;
 * one finished game costs two (read + write).
 */
const CACHE_TTL_MS = 20_000;

let cache: { board: Board; at: number } | null = null;

function headers(): Record<string, string> {
  return {
    "X-Master-Key": MASTER_KEY,
    "Content-Type": "application/json",
    // Return the record itself instead of `{ record, metadata }`.
    "X-Bin-Meta": "false",
  };
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API}/${BIN_ID}${path}`, {
      ...init,
      headers: headers(),
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function readBoard(): Promise<Board> {
  if (!leaderboardConfigured) throw new Error("leaderboard_not_configured");
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.board;

  const response = await request("/latest");
  if (!response.ok) throw new Error(`jsonbin_read_${response.status}`);

  const board = parseBoard(await response.json());
  cache = { board, at: Date.now() };
  return board;
}

export async function writeBoard(board: Board): Promise<void> {
  if (!leaderboardConfigured) throw new Error("leaderboard_not_configured");

  const response = await request("", {
    method: "PUT",
    body: JSON.stringify({ ...board, updatedAt: Date.now() }),
  });
  // A failed write must not leave the browser reading a board it no longer has.
  cache = null;
  if (!response.ok) throw new Error(`jsonbin_write_${response.status}`);
}

