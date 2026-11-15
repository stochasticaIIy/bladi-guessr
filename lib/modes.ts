/**
 * Game modes.
 *
 * Deliberately tiny and free of imports: both the browser (mode switch, board
 * titles) and the server (dealing, session) need this vocabulary, and pulling
 * the datasets into a client bundle would leak every answer.
 */
export const GAME_MODES = ["street", "photos"] as const;
export type GameMode = (typeof GAME_MODES)[number];
export const DEFAULT_MODE: GameMode = "street";

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === "string" && (GAME_MODES as readonly string[]).includes(value);
}
