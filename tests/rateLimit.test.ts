import { describe, expect, it } from "vitest";
import { checkRateLimit, clientKey } from "@/lib/rateLimit";

describe("checkRateLimit", () => {
  it("blocks after the limit and resets after the window", () => {
    const key = "test-" + Math.random();
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) expect(checkRateLimit(key, 5, t).ok).toBe(true);
    const blocked = checkRateLimit(key, 5, t + 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(59);
    expect(checkRateLimit(key, 5, t + 60_000).ok).toBe(true);
  });

  it("is disabled with a limit of 0", () => {
    for (let i = 0; i < 100; i++) expect(checkRateLimit("unlimited", 0).ok).toBe(true);
  });
});

describe("clientKey", () => {
  it("uses the first forwarded address", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
    expect(clientKey(new Headers())).toBe("local");
  });
});
