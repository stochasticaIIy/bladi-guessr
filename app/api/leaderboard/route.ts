import { NextResponse } from "next/server";
import { normaliseSeed } from "@/lib/challenge";
import { isFinished, summarize } from "@/lib/game";
import { DEFAULT_MODE, isGameMode, type GameMode } from "@/lib/modes";
import {
  cleanName,
  publicBoard,
  publicChallenge,
  sameContent,
  submitChallengeScore,
  submitScore,
} from "@/lib/leaderboard";
import { leaderboardConfigured, readBoard, writeBoard } from "@/lib/jsonbin";
import { ensurePlayerId, readPlayerId } from "@/lib/player";
import { createRateLimiter } from "@/lib/rate-limit";
import { isSecureRequest, readGameState } from "@/lib/session";

/**
 * The shared leaderboard.
 *
 * The score is never accepted from the browser: it is recomputed from the
 * signed game cookie, and only a *finished* game can be submitted. What the
 * player does send is their name, which is sanitised and length-capped.
 *
 * `?c=<seed>&m=<mode>` reads the board of one shared link. A posted challenge
 * game also lands on that link's board, so friends who played the same rounds
 * can be compared against each other rather than against the whole world.
 * Boards are scoped by seed *and* mode: a photo link and a street link may
 * share a seed but never share standings.
 */
const noStore = { "Cache-Control": "no-store" };

/** One write per browser per 15 s; 40 writes/minute for the whole process. */
const perPlayer = createRateLimiter({ limit: 1, windowMs: 15_000 });
const perInstance = createRateLimiter({ limit: 40, windowMs: 60_000 });

const emptyView = { entries: [], you: null, total: 0 };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get("c");
  const challenge = raw === null ? null : normaliseSeed(raw);

  if (raw !== null && !challenge) {
    return NextResponse.json({ error: "invalid_challenge" }, { status: 400, headers: noStore });
  }

  const rawMode = params.get("m");
  if (rawMode !== null && !isGameMode(rawMode)) {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400, headers: noStore });
  }
  const mode: GameMode = isGameMode(rawMode) ? rawMode : DEFAULT_MODE;

  if (!leaderboardConfigured) {
    return NextResponse.json(
      { configured: false, available: false, challenge, mode, ...emptyView },
      { headers: noStore },
    );
  }

  try {
    const [board, playerId] = await Promise.all([readBoard(), readPlayerId()]);
    const view = challenge
      ? publicChallenge(board, challenge, mode, playerId)
      : publicBoard(board, playerId);
    return NextResponse.json(
      { configured: true, available: true, challenge, mode, ...view },
      { headers: noStore },
    );
  } catch (error) {
    console.error("[bladi] leaderboard read failed", error);
    return NextResponse.json(
      { configured: true, available: false, challenge, mode, ...emptyView },
      { headers: noStore },
    );
  }
}

export async function POST(request: Request) {
  if (!leaderboardConfigured) {
    return NextResponse.json(
      { error: "leaderboard_not_configured" },
      { status: 503, headers: noStore },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: noStore });
  }

  const name = cleanName((body as { name?: unknown } | null)?.name);
  if (!name) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400, headers: noStore });
  }

  const state = await readGameState();
  if (!state) {
    return NextResponse.json({ error: "no_game" }, { status: 409, headers: noStore });
  }
  // Only a completed game has a score worth ranking. In-progress games must not
  // be snapshotted and resubmitted as they improve.
  if (!isFinished(state)) {
    return NextResponse.json({ error: "game_not_finished" }, { status: 409, headers: noStore });
  }

  const playerId = await ensurePlayerId(isSecureRequest(request));
  const limited = perPlayer.take(playerId);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      {
        status: 429,
        headers: { ...noStore, "Retry-After": String(Math.ceil(limited.retryAfterMs / 1_000)) },
      },
    );
  }
  if (!perInstance.take("writes").ok) {
    return NextResponse.json({ error: "busy" }, { status: 503, headers: noStore });
  }

  const summary = summarize(state);
  const submission = {
    id: playerId,
    name,
    score: summary.totalScore,
    max: summary.maxTotal,
    rounds: summary.rounds.length,
    at: Date.now(),
  };

  try {
    const board = await readBoard();
    let next = submitScore(board, submission);
    if (state.challenge) {
      next = submitChallengeScore(next, state.challenge, state.mode, submission);
    }

    // Renaming with the same result, or re-submitting an unchanged game, costs
    // no write; that keeps the free-tier quota for actual plays.
    if (!sameContent(board, next)) await writeBoard(next);

    const scoped = state.challenge
      ? publicChallenge(next, state.challenge, state.mode, playerId)
      : publicBoard(next, playerId);

    return NextResponse.json(
      {
        configured: true,
        available: true,
        saved: true,
        challenge: state.challenge ?? null,
        mode: state.mode,
        ...scoped,
      },
      { headers: noStore },
    );
  } catch (error) {
    console.error("[bladi] leaderboard write failed", error);
    return NextResponse.json(
      { error: "leaderboard_unavailable" },
      { status: 503, headers: noStore },
    );
  }
}
