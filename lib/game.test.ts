import { describe, expect, it } from "vitest";
import { allLocations, getLocation, locationCount } from "./locations";
import { allPanoramas, getPanorama, panoramaCount } from "./panoramas";
import {
  MAX_SKIPS,
  applyGuess,
  challengeRoundIds,
  createGameState,
  currentRound,
  isFinished,
  pickRoundIds,
  summarize,
  swapCurrentRound,
  totalScore,
  type GameState,
  type GameMode,
} from "./game";
import { MAX_ROUND_SCORE, scoreForDistance, TOTAL_ROUNDS } from "./scoring";
import { haversineKm } from "./geo";

function gameFrom(ids: string[], mode: GameMode = "street"): GameState {
  return { v: 3, id: "test-game", mode, roundIds: ids, guesses: [], skipped: [], createdAt: 0 };
}

/** A deterministic "random" source so round picking is reproducible. */
function seeded(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

const CASABLANCA = allPanoramas.find((panorama) => panorama.city === "الدار البيضاء")!;
const DAKHLA = allPanoramas.find((panorama) => panorama.city === "الداخلة")!;
const CASABLANCA_PHOTO = getLocation("hassan-ii-mosque")!;
const DAKHLA_PHOTO = getLocation("dakhla-lagoon")!;

describe("panorama pool", () => {
  it("holds enough rounds for a full game", () => {
    expect(panoramaCount).toBeGreaterThanOrEqual(TOTAL_ROUNDS * 4);
  });

  it("only contains Moroccan coordinates", () => {
    for (const panorama of allPanoramas) {
      // Morocco incl. Western Sahara: roughly 20.5–36.2 N, 17.5–1 W.
      expect(panorama.lat).toBeGreaterThan(20.5);
      expect(panorama.lat).toBeLessThan(36.2);
      expect(panorama.lng).toBeGreaterThan(-17.5);
      expect(panorama.lng).toBeLessThan(-0.9);
    }
  });

  it("has a Mapillary image id and a city for every round", () => {
    for (const panorama of allPanoramas) {
      expect(panorama.imageId).toMatch(/^\d{6,25}$/);
      expect(panorama.city.length).toBeGreaterThan(0);
      expect(panorama.region.length).toBeGreaterThan(0);
      expect(panorama.neighbourhood).toBeGreaterThanOrEqual(1);
    }
  });

  it("gives some rounds walkable neighbours, which is the point of the mode", () => {
    expect(allPanoramas.filter((panorama) => panorama.neighbourhood > 1).length).toBeGreaterThan(10);
  });

  it("uses image ids that are unique across the pool", () => {
    const ids = allPanoramas.map((panorama) => panorama.imageId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("photo pool", () => {
  it("has enough photos for a full game", () => {
    expect(locationCount).toBeGreaterThanOrEqual(TOTAL_ROUNDS * 4);
  });

  it("reaches places all over the country, not just the cities with street coverage", () => {
    // Twelve administrative regions; the photos should touch most of them,
    // which is the point of the mode: no street capture required.
    expect(new Set(allLocations.map((location) => location.region)).size).toBeGreaterThanOrEqual(10);
  });

  it("keeps every photo inside Morocco", () => {
    for (const location of allLocations) {
      expect(location.lat).toBeGreaterThan(20.5);
      expect(location.lat).toBeLessThan(36.2);
      expect(location.lng).toBeGreaterThan(-17.5);
      expect(location.lng).toBeLessThan(-0.9);
    }
  });

  it("serves a hashed JPEG path and full attribution for every photo", () => {
    for (const location of allLocations) {
      expect(location.photo).toMatch(/^\/photos\/[0-9a-f]{12}\.jpg$/);
      expect(location.name.length).toBeGreaterThan(0);
      expect(location.region.length).toBeGreaterThan(0);
      expect(location.photoCredit.author.length).toBeGreaterThan(0);
      expect(location.photoCredit.licence.length).toBeGreaterThan(0);
      expect(location.photoCredit.source).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
    }
  });

  it("does not spell out the answer in the file path", () => {
    for (const location of allLocations) {
      expect(location.photo).not.toContain(location.id);
      expect(location.photo.toLowerCase()).not.toContain(
        location.name.toLowerCase().replace(/\s+/g, "-"),
      );
    }
  });

  it("uses unique ids and photos", () => {
    expect(new Set(allLocations.map((location) => location.id)).size).toBe(locationCount);
    expect(new Set(allLocations.map((location) => location.photo)).size).toBe(locationCount);
  });
});

describe("pickRoundIds", () => {
  it("picks distinct street ids", () => {
    const ids = pickRoundIds("street", TOTAL_ROUNDS, seeded(42));
    expect(ids).toHaveLength(TOTAL_ROUNDS);
    expect(new Set(ids).size).toBe(TOTAL_ROUNDS);
    expect(ids.every((id) => getPanorama(id) !== undefined)).toBe(true);
  });

  it("deals walkable street rounds before isolated ones", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const ids = pickRoundIds("street", TOTAL_ROUNDS, seeded(seed));
      for (const id of ids) {
        expect(getPanorama(id)!.neighbourhood).toBeGreaterThan(1);
      }
    }
  });

  it("picks distinct photo ids", () => {
    const ids = pickRoundIds("photos", TOTAL_ROUNDS, seeded(7));
    expect(ids).toHaveLength(TOTAL_ROUNDS);
    expect(new Set(ids).size).toBe(TOTAL_ROUNDS);
    expect(ids.every((id) => getLocation(id) !== undefined)).toBe(true);
  });

  it("never repeats a round within a deal, in either mode", () => {
    const random = seeded(7);
    for (let i = 0; i < 200; i++) {
      expect(new Set(pickRoundIds("street", TOTAL_ROUNDS, random)).size).toBe(TOTAL_ROUNDS);
      expect(new Set(pickRoundIds("photos", TOTAL_ROUNDS, random)).size).toBe(TOTAL_ROUNDS);
    }
  });

  it("cannot ask for more rounds than the pool holds", () => {
    const street = pickRoundIds("street", panoramaCount + 10, seeded(1));
    expect(street).toHaveLength(panoramaCount);
    const photos = pickRoundIds("photos", locationCount + 10, seeded(1));
    expect(photos).toHaveLength(locationCount);
  });
});

describe("createGameState", () => {
  it("deals a fresh five-round street game by default", () => {
    const state = createGameState("abc", 0);
    expect(state.v).toBe(3);
    expect(state.mode).toBe("street");
    expect(state.roundIds).toHaveLength(TOTAL_ROUNDS);
    expect(state.guesses).toEqual([]);
    expect(state.skipped).toEqual([]);
    expect(state.challenge).toBeUndefined();
  });

  it("deals a photo game when asked", () => {
    const state = createGameState("abc", 0, null, "photos");
    expect(state.mode).toBe("photos");
    expect(state.roundIds.every((id) => getLocation(id) !== undefined)).toBe(true);
  });
});

describe("shared challenges", () => {
  it("deals exactly the same street rounds to everyone who opens the link", () => {
    const first = createGameState("a", 0, "share123");
    const second = createGameState("b", 9_999, "SHARE123");
    expect(first.roundIds).toEqual(second.roundIds);
    expect(first.challenge).toBe("share123");
    expect(first.roundIds).toEqual(challengeRoundIds("street", "share123"));
  });

  it("deals exactly the same photo rounds to everyone who opens the link", () => {
    const first = createGameState("a", 0, "share123", "photos");
    const second = createGameState("b", 9_999, "share123", "photos");
    expect(first.mode).toBe("photos");
    expect(first.roundIds).toEqual(second.roundIds);
    expect(first.roundIds).toEqual(challengeRoundIds("photos", "share123"));
  });

  it("keeps the two modes' deals apart", () => {
    expect(challengeRoundIds("street", "share123")).not.toEqual(
      challengeRoundIds("photos", "share123"),
    );
  });

  it("gives different links different rounds", () => {
    expect(createGameState("a", 0, "share123").roundIds).not.toEqual(
      createGameState("b", 0, "share124").roundIds,
    );
  });

  it("keeps challenge street rounds walkable, like random games", () => {
    for (let index = 0; index < 20; index++) {
      const seed = `challenge${String(index).padStart(2, "0")}`.slice(0, 16);
      for (const id of challengeRoundIds("street", seed)) {
        expect(getPanorama(id)!.neighbourhood).toBeGreaterThan(1);
      }
    }
  });

  it("falls back to a random game when the seed is unusable", () => {
    const state = createGameState("a", 0, "not a seed");
    expect(state.challenge).toBeUndefined();
    expect(state.roundIds).toHaveLength(TOTAL_ROUNDS);
  });
});

describe("applyGuess", () => {
  const ids = [CASABLANCA.id, DAKHLA.id];
  const photoIds = [CASABLANCA_PHOTO.id, DAKHLA_PHOTO.id];

  it("scores an exact street guess as perfect and reveals the credit", () => {
    const { state, result } = applyGuess(gameFrom(ids), {
      lat: CASABLANCA.lat,
      lng: CASABLANCA.lng,
    });
    expect(result.score).toBe(MAX_ROUND_SCORE);
    expect(result.distanceKm).toBeCloseTo(0, 5);
    expect(result.answer.city).toBe(CASABLANCA.city);
    expect(result.answer.lat).toBe(CASABLANCA.lat);
    expect(result.answer.credit.url).toContain(CASABLANCA.imageId);
    expect(result.answer.credit.licence).toContain("CC BY-SA");
    expect(result.finished).toBe(false);
    expect(result.nextRound?.index).toBe(1);
    expect(result.nextRound?.imageId).toBe(DAKHLA.imageId);
    expect(result.nextRound?.photo).toBeNull();
    expect(state.guesses).toHaveLength(1);
  });

  it("scores an exact photo guess as perfect and reveals the photo credit", () => {
    const { result } = applyGuess(gameFrom(photoIds, "photos"), {
      lat: CASABLANCA_PHOTO.lat,
      lng: CASABLANCA_PHOTO.lng,
    });
    expect(result.score).toBe(MAX_ROUND_SCORE);
    expect(result.answer.city).toBe(CASABLANCA_PHOTO.name);
    expect(result.answer.credit.url).toBe(CASABLANCA_PHOTO.photoCredit.source);
    expect(result.answer.credit.label).toBe(CASABLANCA_PHOTO.photoCredit.author);
    expect(result.nextRound?.photo).toBe(DAKHLA_PHOTO.photo);
    expect(result.nextRound?.imageId).toBeNull();
    expect(result.nextRound?.credit?.label).toBe(DAKHLA_PHOTO.photoCredit.author);
  });

  it("scores a wrong guess by distance", () => {
    const guess = { lat: DAKHLA.lat, lng: DAKHLA.lng };
    const expectedDistance = haversineKm(guess, { lat: CASABLANCA.lat, lng: CASABLANCA.lng });
    const { result } = applyGuess(gameFrom(ids), guess);
    expect(result.distanceKm).toBeCloseTo(expectedDistance, 6);
    expect(result.score).toBe(scoreForDistance(expectedDistance));
    expect(result.score).toBeLessThan(MAX_ROUND_SCORE);
  });

  it("advances through rounds and finishes on the last one", () => {
    let state = gameFrom(photoIds, "photos");
    const first = applyGuess(state, { lat: 0, lng: 0 });
    state = first.state;
    expect(currentRound(state)?.index).toBe(1);

    const second = applyGuess(state, { lat: 0, lng: 0 });
    expect(second.result.finished).toBe(true);
    expect(second.result.nextRound).toBeNull();
    expect(second.result.summary).not.toBeNull();
    expect(second.result.summary?.rounds).toHaveLength(2);
    expect(second.result.summary?.maxTotal).toBe(MAX_ROUND_SCORE * 2);
    expect(second.result.summary?.mode).toBe("photos");
    expect(isFinished(second.state)).toBe(true);
    expect(currentRound(second.state)).toBeNull();
  });

  it("refuses to score a finished game twice", () => {
    let state = gameFrom([CASABLANCA.id]);
    state = applyGuess(state, { lat: CASABLANCA.lat, lng: CASABLANCA.lng }).state;
    expect(() => applyGuess(state, { lat: CASABLANCA.lat, lng: CASABLANCA.lng })).toThrow();
  });

  it("keeps the running total equal to the sum of rounds", () => {
    const { state } = applyGuess(gameFrom(ids), { lat: 20, lng: -10 });
    expect(totalScore(state)).toBe(state.guesses.reduce((sum, guess) => sum + guess.score, 0));
    expect(summarize(state).totalScore).toBe(totalScore(state));
  });

  it("never leaks coordinates to the browser with the round", () => {
    for (const mode of ["street", "photos"] as const) {
      const state = createGameState("a", 0, null, mode);
      const round = currentRound(state)!;
      const payload = JSON.stringify(round);
      const name =
        mode === "photos"
          ? getLocation(state.roundIds[0]!)!.name
          : getPanorama(state.roundIds[0]!)!.city;
      expect(round.index).toBe(0);
      expect(payload).not.toContain("lat");
      expect(payload).not.toContain("lng");
      expect(payload).not.toContain(name);
    }
  });
});

describe("swapCurrentRound", () => {
  const ids = [CASABLANCA.id, DAKHLA.id];
  const photoIds = [CASABLANCA_PHOTO.id, DAKHLA_PHOTO.id];

  it("replaces an unusable street panorama without scoring the round", () => {
    const state = gameFrom(ids);
    const swapped = swapCurrentRound(state, () => 0)!;
    expect(swapped.state.guesses).toHaveLength(0);
    expect(swapped.round.index).toBe(0);
    expect(swapped.state.roundIds[0]).not.toBe(CASABLANCA.id);
    expect(swapped.state.skipped).toEqual([CASABLANCA.id]);
    expect(currentRound(swapped.state)?.imageId).toBe(swapped.round.imageId);
  });

  it("replaces a broken photo with another photo, never a panorama", () => {
    const swapped = swapCurrentRound(gameFrom(photoIds, "photos"), () => 0)!;
    expect(swapped.round.photo).toBeTruthy();
    expect(swapped.round.imageId).toBeNull();
    expect(getLocation(swapped.state.roundIds[0]!)).toBeDefined();
    expect(swapped.state.skipped).toEqual([CASABLANCA_PHOTO.id]);
  });

  it("never swaps in a round already used in this game", () => {
    const swapped = swapCurrentRound(gameFrom(ids), () => 0)!;
    expect(swapped.state.roundIds[0]).not.toBe(DAKHLA.id);
    expect(swapped.state.roundIds[1]).toBe(DAKHLA.id);
    expect(new Set(swapped.state.roundIds).size).toBe(2);
  });

  it("stops after the skip budget", () => {
    let state = gameFrom(ids);
    let swaps = 0;
    for (let i = 0; i < MAX_SKIPS; i++) {
      const swapped = swapCurrentRound(state, () => 0);
      if (!swapped) break;
      state = swapped.state;
      swaps += 1;
    }
    expect(swaps).toBe(MAX_SKIPS);
    expect(swapCurrentRound(state, () => 0)).toBeNull();
  });

  it("does nothing once the game is finished", () => {
    let state = gameFrom([CASABLANCA.id]);
    state = applyGuess(state, { lat: 0, lng: 0 }).state;
    expect(swapCurrentRound(state)).toBeNull();
  });
});
