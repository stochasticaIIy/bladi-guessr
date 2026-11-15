import { NextResponse } from "next/server";
import { normaliseSeed } from "@/lib/challenge";
import {
  DEFAULT_MODE,
  currentRound,
  isFinished,
  isGameMode,
  summarize,
  totalScore,
  type GameMode,
  type PublicGame,
} from "@/lib/game";
import {
  clearGameState,
  isSecureRequest,
  newGameState,
  readGameState,
  writeGameState,
} from "@/lib/session";

const noStore = { "Cache-Control": "no-store" };

function toPublicGame(state: Awaited<ReturnType<typeof readGameState>>): PublicGame {
  if (!state) {
    return {
      active: false,
      finished: false,
      mode: DEFAULT_MODE,
      totalRounds: 0,
      roundIndex: null,
      imageId: null,
      photo: null,
      credit: null,
      score: 0,
      summary: null,
      challenge: null,
    };
  }
  const finished = isFinished(state);
  const round = currentRound(state);
  return {
    active: true,
    finished,
    mode: state.mode,
    totalRounds: state.roundIds.length,
    roundIndex: round ? round.index : null,
    imageId: round ? round.imageId : null,
    photo: round ? round.photo : null,
    credit: round ? round.credit : null,
    score: totalScore(state),
    summary: finished ? summarize(state) : null,
    challenge: state.challenge ?? null,
  };
}

/** Resume whatever the current cookie holds (a refresh must not lose progress). */
export async function GET() {
  const state = await readGameState();
  return NextResponse.json(toPublicGame(state), { headers: noStore });
}

export async function POST(request: Request) {
  // A shared link passes its seed here; without one this is a normal random game.
  const text = await request.text();
  let challenge: string | null = null;
  let mode: GameMode = DEFAULT_MODE;

  if (text.trim().length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: noStore });
    }

    const raw = (body as { challenge?: unknown } | null)?.challenge;
    if (raw !== undefined && raw !== null) {
      challenge = normaliseSeed(raw);
      if (!challenge) {
        return NextResponse.json({ error: "invalid_challenge" }, { status: 400, headers: noStore });
      }
    }

    const requestedMode = (body as { mode?: unknown } | null)?.mode;
    if (requestedMode !== undefined && requestedMode !== null) {
      if (!isGameMode(requestedMode)) {
        return NextResponse.json({ error: "invalid_mode" }, { status: 400, headers: noStore });
      }
      mode = requestedMode;
    }
  }

  const state = newGameState(Date.now(), challenge, mode);
  await writeGameState(state, isSecureRequest(request));
  return NextResponse.json(toPublicGame(state), { headers: noStore });
}

/** Abandon the current game. */
export async function DELETE() {
  await clearGameState();
  return NextResponse.json({ ok: true }, { headers: noStore });
}
