import { describe, expect, it } from "vitest";
import { challengePath, newSeed, normaliseSeed, seededRandom } from "./challenge";

describe("normaliseSeed", () => {
  it("accepts URL-safe seeds and folds case", () => {
    expect(normaliseSeed("abc123")).toBe("abc123");
    expect(normaliseSeed("  AB12  ")).toBe("ab12");
    expect(normaliseSeed("a".repeat(16))).toBe("a".repeat(16));
  });

  it("rejects anything that is not a plain seed", () => {
    for (const value of [
      "abc", // too short
      "a".repeat(17), // too long
      "abc-123",
      "abc 123",
      "éééé",
      "",
      null,
      42,
      {},
    ]) {
      expect(normaliseSeed(value)).toBeNull();
    }
  });
});

describe("newSeed", () => {
  it("produces a usable seed", () => {
    const seed = newSeed();
    expect(seed).toHaveLength(8);
    expect(normaliseSeed(seed)).toBe(seed);
  });

  it("is reproducible from an injected random source", () => {
    const fixed = () => 0.5;
    expect(newSeed(fixed)).toBe(newSeed(fixed));
    expect(newSeed(() => 0.1)).not.toBe(newSeed(() => 0.9));
  });
});

describe("seededRandom", () => {
  it("repeats the same sequence for the same seed", () => {
    const a = seededRandom("abc123");
    const b = seededRandom("abc123");
    const left = Array.from({ length: 50 }, () => a());
    const right = Array.from({ length: 50 }, () => b());
    expect(left).toEqual(right);
  });

  it("gives different seeds different sequences", () => {
    const a = Array.from({ length: 20 }, seededRandom("aaaa11"));
    const b = Array.from({ length: 20 }, seededRandom("aaaa12"));
    expect(a).not.toEqual(b);
  });

  it("stays inside [0, 1)", () => {
    const random = seededRandom("morocco");
    for (let index = 0; index < 500; index++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("challengePath", () => {
  it("builds the shareable path", () => {
    expect(challengePath("abc123")).toBe("/c/abc123");
    expect(challengePath("abc123", "street")).toBe("/c/abc123");
  });

  it("carries the mode for non-default modes", () => {
    expect(challengePath("abc123", "photos")).toBe("/c/abc123?m=photos");
  });
});
