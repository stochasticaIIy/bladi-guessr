import { describe, expect, it } from "vitest";
import { allLocations } from "./locations";
import { allPanoramas } from "./panoramas";
import { encodeState, decodeState, MAX_COOKIE_BYTES } from "./session-core";
import { MAX_SKIPS, type GameState } from "./game";
import { MAX_ROUND_SCORE } from "./scoring";

const ids = allPanoramas.slice(0, 3).map((panorama) => panorama.id);
const photoIds = allLocations.slice(0, 3).map((location) => location.id);
const far = allPanoramas.find((panorama) => panorama.lat < 25)!;

const state: GameState = {
  v: 3,
  id: "round-trip",
  mode: "street",
  roundIds: ids,
  guesses: [],
  skipped: [],
  createdAt: 1_700_000_000_000,
};

const photoState: GameState = {
  ...state,
  id: "photo-round-trip",
  mode: "photos",
  roundIds: photoIds,
};

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

describe("game cookie", () => {
  it("round-trips a street state", async () => {
    const token = await encodeState(state);
    const decoded = await decodeState(token);
    expect(decoded).toEqual(state);
  });

  it("round-trips a photo state", async () => {
    const token = await encodeState(photoState);
    const decoded = await decodeState(token);
    expect(decoded).toEqual(photoState);
    expect(decoded?.mode).toBe("photos");
  });

  it("round-trips a shared challenge", async () => {
    const token = await encodeState({ ...state, challenge: "share123" });
    expect((await decodeState(token))?.challenge).toBe("share123");
  });

  it("keeps the payload out of plain sight", () => {
    expect(Buffer.from(state.id).toString("base64url")).not.toContain("round-trip");
  });

  it("rejects a modified payload", async () => {
    const token = await encodeState(state);
    const [payload, signature] = token.split(".");

    const forged = b64({ ...state, roundIds: ids.slice(0, 1) });
    expect(forged).not.toBe(payload);
    expect(await decodeState(`${forged}.${signature}`)).toBeNull();

    expect(await decodeState(`${payload}.${signature!.slice(0, -2)}AA`)).toBeNull();
  });

  it("rejects a signature made with another secret", async () => {
    const payload = b64(state);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("some-other-secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = Buffer.from(
      new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))),
    ).toString("base64url");
    expect(await decodeState(`${payload}.${signature}`)).toBeNull();
  });

  it("rejects missing, malformed and oversized values", async () => {
    expect(await decodeState(undefined)).toBeNull();
    expect(await decodeState(null)).toBeNull();
    expect(await decodeState("")).toBeNull();
    expect(await decodeState("nodot")).toBeNull();
    expect(await decodeState("a.b")).toBeNull();
    expect(await decodeState(`${{ x: "x".repeat(MAX_COOKIE_BYTES + 10) }}.AAAA`)).toBeNull();
  });

  it("rejects structurally invalid states even when correctly signed", async () => {
    const bad = [
      { ...state, v: 2 }, // the panorama-era format must not be accepted
      { ...state, mode: "video" },
      { ...state, mode: undefined },
      { ...state, roundIds: [] },
      { ...state, roundIds: [ids[0], ids[0]] }, // duplicate rounds
      { ...state, roundIds: [1, 2, 3] },
      { ...state, roundIds: ["not-a-round"] },
      { ...state, roundIds: [photoIds[0]] }, // a photo in a street game
      { ...photoState, roundIds: [ids[0]] }, // a panorama in a photo game
      { ...state, guesses: "nope" },
      { ...state, skipped: "nope" },
      { ...state, skipped: ["not-a-round"] },
      { ...state, skipped: [ids[0]] }, // skipping a round that is still in play
      { ...state, skipped: Array.from({ length: MAX_SKIPS + 1 }, () => far.id) },
      { ...state, guesses: [{ roundId: ids[0], guess: { lat: 200, lng: 0 }, distanceKm: 1, score: 1 }] },
      { ...state, challenge: "not a seed" }, // a link seed must stay URL-safe
      { ...state, challenge: "ab" },
      { ...state, challenge: 42 },
    ];
    for (const candidate of bad) {
      const token = await encodeState(candidate as GameState);
      expect(await decodeState(token)).toBeNull();
    }
  });

  it("rejects more guesses than rounds", async () => {
    const guess = { roundId: ids[0], guess: { lat: 31, lng: -7 }, distanceKm: 0, score: 1 };
    const token = await encodeState({ ...state, roundIds: [ids[0]!], guesses: [guess, guess] });
    expect(await decodeState(token)).toBeNull();
  });

  it("refuses a guess recorded against a different round", async () => {
    // The first guess must belong to roundIds[0], never to another round.
    const token = await encodeState({
      ...state,
      guesses: [{ roundId: ids[1], guess: { lat: 31, lng: -7 }, distanceKm: 0, score: 5000 }],
    });
    expect(await decodeState(token)).toBeNull();
  });

  it("recomputes the score instead of trusting the cookie", async () => {
    // A hand-written payload that claims a perfect score from 1,000 km away.
    const token = await encodeState({
      ...state,
      roundIds: [ids[0]!],
      guesses: [
        {
          roundId: ids[0]!,
          guess: { lat: 20.5, lng: -17.0 },
          distanceKm: 0,
          score: MAX_ROUND_SCORE,
        },
      ],
    });
    const decoded = await decodeState(token);
    expect(decoded).not.toBeNull();
    const guess = decoded!.guesses[0]!;
    expect(guess.distanceKm).toBeGreaterThan(500);
    expect(guess.score).toBeLessThan(MAX_ROUND_SCORE / 2);
  });

  it("recomputes photo scores the same way", async () => {
    const token = await encodeState({
      ...photoState,
      roundIds: [photoIds[0]!],
      guesses: [
        {
          roundId: photoIds[0]!,
          guess: { lat: 20.5, lng: -17.0 },
          distanceKm: 0,
          score: MAX_ROUND_SCORE,
        },
      ],
    });
    const decoded = await decodeState(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.guesses[0]!.score).toBeLessThan(MAX_ROUND_SCORE / 2);
  });
});
