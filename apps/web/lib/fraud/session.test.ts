import { describe, expect, it } from "vitest";

import { LINK_TTL_HOURS, linkExpiresAt, linkState, SESSION_MINUTES, sessionEndsAt } from "./session";

const ISSUED = new Date("2026-09-26T12:00:00.000Z");
const EXPIRES = new Date(ISSUED.getTime() + 24 * 3600_000);
const STARTED = new Date("2026-09-26T15:00:00.000Z");
const DEADLINE = new Date(STARTED.getTime() + 40 * 60_000);
const ms = (d: Date, delta: number) => new Date(d.getTime() + delta);

describe("constants", () => {
  it("defaults to a 40-minute session and a 24-hour link", () => {
    expect(SESSION_MINUTES).toBe(40);
    expect(LINK_TTL_HOURS).toBe(24);
    expect(linkExpiresAt(ISSUED)).toEqual(EXPIRES);
  });
});

describe("sessionEndsAt", () => {
  it("is used_at + SESSION_MINUTES, or null before Start", () => {
    expect(sessionEndsAt({ used_at: STARTED.toISOString() })).toEqual(DEADLINE);
    expect(sessionEndsAt({ used_at: "2026-09-26T15:00:00+00:00" })).toEqual(DEADLINE);
    expect(sessionEndsAt({ used_at: null })).toBeNull();
  });
});

describe("linkState", () => {
  const notStarted = { expires_at: EXPIRES.toISOString(), used_at: null, submitted: false };
  const started = { expires_at: EXPIRES.toISOString(), used_at: STARTED.toISOString(), submitted: false };

  it("is ready before expires_at and link_expired exactly at it", () => {
    expect(linkState(notStarted, ISSUED)).toBe("ready");
    expect(linkState(notStarted, ms(EXPIRES, -1))).toBe("ready");
    expect(linkState(notStarted, EXPIRES)).toBe("link_expired");
    expect(linkState(notStarted, ms(EXPIRES, 1))).toBe("link_expired");
  });

  it("is active before the deadline and session_expired exactly at it", () => {
    expect(linkState(started, STARTED)).toBe("active");
    expect(linkState(started, ms(DEADLINE, -1))).toBe("active");
    expect(linkState(started, DEADLINE)).toBe("session_expired");
    expect(linkState(started, ms(DEADLINE, 1))).toBe("session_expired");
  });

  it("keeps a session active past expires_at when started before it", () => {
    const late = { ...started, used_at: ms(EXPIRES, -60_000).toISOString() };
    expect(linkState(late, ms(EXPIRES, 60_000))).toBe("active");
  });

  it("reports submitted regardless of time", () => {
    expect(linkState({ ...started, submitted: true }, STARTED)).toBe("submitted");
    expect(linkState({ ...notStarted, submitted: true }, ms(EXPIRES, 1))).toBe("submitted");
  });
});
