import { normaliseSeed, seededRandom } from "./challenge";
import { haversineKm, type LatLng } from "./geo";
import { getLocation, allLocations, locationCount, requireLocation } from "./locations";
import { panoramaSourceUrl } from "./mapillary";
import { DEFAULT_MODE, GAME_MODES, isGameMode, type GameMode } from "./modes";
import { allPanoramas, getPanorama, panoramaCount, requirePanorama } from "./panoramas";
import { MAX_ROUND_SCORE, scoreForDistance, sumScores, TOTAL_ROUNDS } from "./scoring";

/**
 * Two ways to play the same five-round game:
 *   - `street`: a Mapillary 360° capture you can walk down the road (dense
 *     detail, but only where contributors have driven);
 *   - `photos`: a still photo from Wikimedia Commons (anywhere in Morocco,
 *     including places no car has ever photographed).
 *
 * Everything below is mode-aware; scores, rounds and cookie storage stay the
 * same shape so the two modes share one API and one leaderboard.
 */
export { DEFAULT_MODE, GAME_MODES, isGameMode };
export type { GameMode };

export type AnswerCredit = {
  label: string;
  url: string;
  licence: string;
};

export type Answer = {
  city: string;
  region: string;
  lat: number;
  lng: number;
  /** What the reveal card links to and credits. */
  credit: AnswerCredit;
};

export type GuessRecord = {
  roundId: string;
  guess: LatLng;
  distanceKm: number;
  score: number;
};

export type GameState = {
  v: 3;
  id: string;
  mode: GameMode;
  roundIds: string[];
  guesses: GuessRecord[];
  /** Rounds swapped out because the imagery would not load. */
  skipped: string[];
  /** Seed of the shared challenge this game belongs to, for `/c/<seed>` links. */
  challenge?: string;
  createdAt: number;
};

export type PublicRoundCredit = {
  /** Author shown while the photo is on screen. Never the source URL: the file
   *  page would spell out the place name. */
  label: string;
  licence: string;
};

export type PublicRound = {
  index: number;
  /** Mapillary image id, street mode only. */
  imageId: string | null;
  /** Public photo path, photos mode only. */
  photo: string | null;
  /** Attribution for a still photo (CC licences require it). */
  credit: PublicRoundCredit | null;
};

export type RoundResult = {
  roundIndex: number;
  totalRounds: number;
  distanceKm: number;
  score: number;
  answer: Answer;
  totalScore: number;
  finished: boolean;
  nextRound: PublicRound | null;
  summary: Summary | null;
};

/** The whole game state as the browser is allowed to see it. */
export type PublicGame = {
  active: boolean;
  finished: boolean;
  mode: GameMode;
  totalRounds: number;
  roundIndex: number | null;
  imageId: string | null;
  photo: string | null;
  /** Public attribution for a still photo, shown while it is on screen. */
  credit: PublicRoundCredit | null;
  score: number;
  summary: Summary | null;
  /** Seed of the shared challenge being played, if the game came from a link. */
  challenge: string | null;
};

export type Summary = {
  totalScore: number;
  maxTotal: number;
  mode: GameMode;
  rounds: Array<{
    city: string;
    region: string;
    distanceKm: number;
    score: number;
  }>;
};

/** A broken panorama or photo can be swapped, but not farmed. */
export const MAX_SKIPS = 5;

type RoundInfo = {
  id: string;
  city: string;
  region: string;
  lat: number;
  lng: number;
  imageId: string | null;
  photo: string | null;
  credit: AnswerCredit;
};

function roundInfo(mode: GameMode, id: string): RoundInfo {
  if (mode === "photos") {
    const location = requireLocation(id);
    return {
      id: location.id,
      city: location.name,
      region: location.region,
      lat: location.lat,
      lng: location.lng,
      imageId: null,
      photo: location.photo,
      credit: {
        label: location.photoCredit.author,
        url: location.photoCredit.source,
        licence: location.photoCredit.licence,
      },
    };
  }

  const panorama = requirePanorama(id);
  return {
    id: panorama.id,
    city: panorama.city,
    region: panorama.region,
    lat: panorama.lat,
    lng: panorama.lng,
    imageId: panorama.imageId,
    photo: null,
    credit: {
      label: panorama.creator ?? "Mapillary",
      url: panoramaSourceUrl(panorama.imageId),
      licence: "CC BY-SA 4.0",
    },
  };
}

export function roundCount(mode: GameMode): number {
  return mode === "photos" ? locationCount : panoramaCount;
}

export function isRoundId(mode: GameMode, id: string): boolean {
  return mode === "photos" ? getLocation(id) !== undefined : getPanorama(id) !== undefined;
}

function publicRound(state: GameState, index: number): PublicRound {
  const round = roundInfo(state.mode, state.roundIds[index] as string);
  return {
    index,
    imageId: round.imageId,
    photo: round.photo,
    credit:
      state.mode === "photos"
        ? { label: round.credit.label, licence: round.credit.licence }
        : null,
  };
}

export function currentRound(state: GameState): PublicRound | null {
  if (isFinished(state)) return null;
  return publicRound(state, state.guesses.length);
}

export function isFinished(state: GameState): boolean {
  return state.guesses.length >= state.roundIds.length;
}

export function totalScore(state: GameState): number {
  return sumScores(state.guesses.map((guess) => guess.score));
}

export function summarize(state: GameState): Summary {
  return {
    totalScore: totalScore(state),
    maxTotal: MAX_ROUND_SCORE * state.roundIds.length,
    mode: state.mode,
    rounds: state.guesses.map((guess) => {
      const round = roundInfo(state.mode, guess.roundId);
      return {
        city: round.city,
        region: round.region,
        distanceKm: guess.distanceKm,
        score: guess.score,
      };
    }),
  };
}

/** Records one guess against the current round and reports the answer. */
export function applyGuess(
  state: GameState,
  guess: LatLng,
): { state: GameState; result: RoundResult } {
  if (isFinished(state)) throw new Error("Game already finished");

  const roundIndex = state.guesses.length;
  const round = roundInfo(state.mode, state.roundIds[roundIndex] as string);
  const distanceKm = haversineKm(guess, { lat: round.lat, lng: round.lng });
  const score = scoreForDistance(distanceKm);

  const nextState: GameState = {
    ...state,
    guesses: [...state.guesses, { roundId: round.id, guess, distanceKm, score }],
  };
  const finished = isFinished(nextState);

  return {
    state: nextState,
    result: {
      roundIndex,
      totalRounds: state.roundIds.length,
      distanceKm,
      score,
      answer: {
        city: round.city,
        region: round.region,
        lat: round.lat,
        lng: round.lng,
        credit: round.credit,
      },
      totalScore: totalScore(nextState),
      finished,
      nextRound: finished ? null : publicRound(nextState, nextState.guesses.length),
      summary: finished ? summarize(nextState) : null,
    },
  };
}

/**
 * Swaps the current round for another one, without scoring it.
 * Used only when the imagery cannot be served, so a deleted capture or a broken
 * photo never leaves the player stuck.
 */
export function swapCurrentRound(
  state: GameState,
  random: () => number = Math.random,
): { state: GameState; round: PublicRound } | null {
  if (isFinished(state)) return null;

  const index = state.guesses.length;
  const current = state.roundIds[index] as string;
  if (state.skipped.length >= MAX_SKIPS) return null;

  const used = new Set([...state.roundIds, ...state.skipped]);
  const [replacement] = dealOrder(state.mode, random).filter((id) => !used.has(id));
  if (!replacement) return null;
  const roundIds = [...state.roundIds];
  roundIds[index] = replacement;

  const nextState: GameState = {
    ...state,
    roundIds,
    skipped: [...state.skipped, current],
  };
  return { state: nextState, round: publicRound(nextState, index) };
}

/**
 * All rounds in deal order, shuffled.
 *
 * Street rounds are only worth playing if the player can walk from them, so
 * panoramas with neighbours are dealt first and isolated 360° spheres are kept
 * as a last resort. Every photo is equally playable.
 */
function dealOrder(mode: GameMode, random: () => number): string[] {
  const ids =
    mode === "photos"
      ? allLocations.map((location) => location.id)
      : allPanoramas.map((panorama) => panorama.id);

  for (let i = ids.length - 1; i > 0; i--) {
    const swapIndex = Math.floor(random() * (i + 1));
    [ids[i], ids[swapIndex]] = [ids[swapIndex] as string, ids[i] as string];
  }

  if (mode === "photos") return ids;

  const walkable: string[] = [];
  const isolated: string[] = [];
  for (const id of ids) {
    if ((requirePanorama(id).neighbourhood ?? 1) > 1) walkable.push(id);
    else isolated.push(id);
  }
  return [...walkable, ...isolated];
}

/** Picks `count` distinct rounds. `random` is injectable so tests are stable. */
export function pickRoundIds(
  mode: GameMode,
  count: number = TOTAL_ROUNDS,
  random: () => number = Math.random,
): string[] {
  const wanted = Math.min(Math.max(count, 1), roundCount(mode));
  return dealOrder(mode, random).slice(0, wanted);
}

/**
 * The five rounds a shared challenge deals.
 *
 * Pure function of the seed and the mode, so every player who opens the same
 * link gets the same rounds in the same order — that is what makes their scores
 * comparable.
 */
export function challengeRoundIds(mode: GameMode, seed: string): string[] {
  return pickRoundIds(mode, TOTAL_ROUNDS, seededRandom(seed));
}

export function createGameState(
  id: string,
  now = Date.now(),
  challenge?: string | null,
  mode: GameMode = DEFAULT_MODE,
): GameState {
  const seed = challenge ? normaliseSeed(challenge) : null;
  return {
    v: 3,
    id,
    mode,
    roundIds: seed ? challengeRoundIds(mode, seed) : pickRoundIds(mode),
    guesses: [],
    skipped: [],
    ...(seed ? { challenge: seed } : {}),
    createdAt: now,
  };
}
