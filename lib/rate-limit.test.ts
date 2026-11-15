import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit inside the window", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000 });
    expect(limiter.take("a", 0).ok).toBe(true);
    expect(limiter.take("a", 100).ok).toBe(true);
    expect(limiter.take("a", 200).ok).toBe(false);
  });

  it("keeps keys independent", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    expect(limiter.take("a", 0).ok).toBe(true);
    expect(limiter.take("b", 0).ok).toBe(true);
  });

  it("frees a slot once the oldest hit leaves the window", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    expect(limiter.take("a", 0).ok).toBe(true);
    const blocked = limiter.take("a", 400);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterMs).toBe(600);
    expect(limiter.take("a", 1_000).ok).toBe(true);
  });

  it("reports how long to wait", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 5_000 });
    limiter.take("a", 1_000);
    limiter.take("a", 2_000);
    const blocked = limiter.take("a", 2_500);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterMs).toBe(3_500);
  });
});
