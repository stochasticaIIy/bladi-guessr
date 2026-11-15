import { NextResponse } from "next/server";
import { applyGuess, isFinished } from "@/lib/game";
import { isValidLatLng } from "@/lib/geo";
import { isSecureRequest, readGameState, writeGameState } from "@/lib/session";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: noStore });
  }

  if (!isValidLatLng(body)) {
    return NextResponse.json({ error: "invalid_coordinates" }, { status: 400, headers: noStore });
  }

  const state = await readGameState();
  if (!state) {
    return NextResponse.json({ error: "no_game" }, { status: 409, headers: noStore });
  }
  if (isFinished(state)) {
    return NextResponse.json({ error: "game_finished" }, { status: 409, headers: noStore });
  }

  const { state: nextState, result } = applyGuess(state, { lat: body.lat, lng: body.lng });
  await writeGameState(nextState, isSecureRequest(request));

  return NextResponse.json(result, { headers: noStore });
}
