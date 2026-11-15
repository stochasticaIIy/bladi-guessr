import { describe, expect, it } from "vitest";
import {
  MAX_ROUND_SCORE,
  PERFECT_RADIUS_KM,
  scoreForDistance,
  sumScores,
  TOTAL_ROUNDS,
  MAX_TOTAL_SCORE,
} from "./scoring";

describe("scoreForDistance", () => {
  it("gives full points inside the perfect radius", () => {
    expect(scoreForDistance(0)).toBe(MAX_ROUND_SCORE);
    expect(scoreForDistance(PERFECT_RADIUS_KM)).toBe(MAX_ROUND_SCORE);
  });

  it("matches the documented curve", () => {
    // Values from the comment block in scoring.ts.
    expect(scoreForDistance(10)).toBe(4811);
    expect(scoreForDistance(25)).toBe(4542);
    expect(scoreForDistance(50)).toBe(4125);
    expect(scoreForDistance(100)).toBe(3404);
    expect(scoreForDistance(250)).toBe(1912);
    expect(scoreForDistance(500)).toBe(731);
    expect(scoreForDistance(800)).toBe(231);
    expect(scoreForDistance(1300)).toBe(34);
  });

  it("decreases monotonically and never goes below zero", () => {
    let previous = MAX_ROUND_SCORE;
    for (let km = 0; km <= 3000; km += 7) {
      const score = scoreForDistance(km);
      expect(score).toBeLessThanOrEqual(previous);
      expect(score).toBeGreaterThanOrEqual(0);
      previous = score;
    }
    expect(scoreForDistance(5000)).toBe(0);
  });

  it("rejects nonsense input", () => {
    expect(scoreForDistance(-5)).toBe(0);
    expect(scoreForDistance(Number.NaN)).toBe(0);
    expect(scoreForDistance(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("sums rounds", () => {
    expect(sumScores([])).toBe(0);
    expect(sumScores([5000, 4500, 10])).toBe(9510);
    expect(MAX_TOTAL_SCORE).toBe(MAX_ROUND_SCORE * TOTAL_ROUNDS);
  });
});
