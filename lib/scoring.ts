export const MAX_ROUND_SCORE = 5_000;
export const TOTAL_ROUNDS = 5;
export const MAX_TOTAL_SCORE = MAX_ROUND_SCORE * TOTAL_ROUNDS;

/**
 * Scoring curve.
 *
 * Points fall off exponentially with distance: score = 5000 · e^(−d / 260).
 * Morocco is ~1,300 km across, so the constants are tuned for that scale:
 *
 *   0 km → 5000    | 10 km → 4811  | 25 km → 4542
 *  50 km → 4125    | 100 km → 3404 | 250 km → 1912
 * 500 km → 731     | 800 km → 231  | 1300 km → 34
 *
 * A guess within PERFECT_RADIUS_KM is treated as exact so that clicking the
 * right town is not punished by a few hundred metres of map imprecision.
 */
export const PERFECT_RADIUS_KM = 1;
const DECAY_KM = 260;

export function scoreForDistance(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  if (distanceKm <= PERFECT_RADIUS_KM) return MAX_ROUND_SCORE;
  return Math.max(0, Math.round(MAX_ROUND_SCORE * Math.exp(-distanceKm / DECAY_KM)));
}

export function sumScores(scores: readonly number[]): number {
  return scores.reduce((total, score) => total + score, 0);
}
