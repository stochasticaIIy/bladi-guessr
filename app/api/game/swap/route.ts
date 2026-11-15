import { NextResponse } from "next/server";
import { MAX_SKIPS, isFinished, swapCurrentRound } from "@/lib/game";
import { isSecureRequest, readGameState, writeGameState } from "@/lib/session";

const noStore = { "Cache-Control": "no-store" };

/**
 * Swaps the current panorama for another one without scoring the round.
 *
 * Mapillary captures are community uploads and occasionally disappear; without
 * this a deleted image would leave the player on a dead round they cannot end.
 * It never reveals where the round is, so it cannot be used as a hint.
 */
export async function POST(request: Request) {
  const state = await readGameState();
  if (!state) {
    return NextResponse.json({ error: "no_game" }, { status: 409, headers: noStore });
  }

  // A finished game has nothing to swap, which is a different answer from
  // "you have run out of swaps" and must not be reported as a rate limit.
  if (isFinished(state)) {
    return NextResponse.json({ error: "game_finished" }, { status: 409, headers: noStore });
  }

  const swapped = swapCurrentRound(state);
  if (!swapped) {
    return NextResponse.json(
      { error: "cannot_swap", maxSkips: MAX_SKIPS },
      { status: 429, headers: noStore },
    );
  }

  await writeGameState(swapped.state, isSecureRequest(request));
  return NextResponse.json(swapped.round, { headers: noStore });
}
