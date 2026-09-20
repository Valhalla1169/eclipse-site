import { describe, expect, it } from "vitest";
import { cleanCampaignName, cleanDisplayName, friendlyError, inviteStatus, isUuid, normalizeCode, normalizeEmail } from "../../public/js/util.js";

describe("isUuid", () => {
  it("accepts a real uuid and rejects everything else", () => {
    expect(isUuid("10000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("abc")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid("x".repeat(36))).toBe(false);
  });
});

describe("normalizeCode", () => {
  it("trims and upper-cases", () => expect(normalizeCode("  harden1 ")).toBe("HARDEN1"));
  it("accepts a full 30-character invite code", () => expect(normalizeCode("abcdef0123456789abcdef012345ab")).toBe("ABCDEF0123456789ABCDEF012345AB"));
  it("rejects too short, too long, punctuation and markup", () => {
    expect(normalizeCode("abc")).toBeNull();
    expect(normalizeCode("A".repeat(33))).toBeNull();
    expect(normalizeCode("ABC-123")).toBeNull();
    expect(normalizeCode("<script>alert(1)</script>")).toBeNull();
  });
  it("treats null and undefined as invalid", () => {
    expect(normalizeCode(null)).toBeNull();
    expect(normalizeCode(undefined)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lower-cases and trims", () => expect(normalizeEmail("  Me@Example.COM ")).toBe("me@example.com"));
  it("rejects a missing @ and embedded spaces", () => {
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizeEmail("a b@c.de")).toBeNull();
  });
});

describe("names", () => {
  it("collapses whitespace in a display name", () => expect(cleanDisplayName("  Dana   Voss ")).toBe("Dana Voss"));
  it("enforces the display-name limits (1 to 40)", () => {
    expect(cleanDisplayName("   ")).toBeNull();
    expect(cleanDisplayName("x".repeat(41))).toBeNull();
    expect(cleanDisplayName("x".repeat(40))).toHaveLength(40);
  });
  it("enforces the campaign-name limits (1 to 80)", () => {
    expect(cleanCampaignName("x".repeat(80))).not.toBeNull();
    expect(cleanCampaignName("x".repeat(81))).toBeNull();
  });
});

describe("friendlyError", () => {
  it("maps the database's messages to plain language", () => {
    expect(friendlyError(new Error("invalid invite code"))).toMatch(/not valid/);
    expect(friendlyError(new Error("you run this campaign"))).toMatch(/You are the DM/);
    expect(friendlyError(new Error("only the DM of this campaign can create invites"))).toMatch(/Only the DM/);
    expect(friendlyError(new Error("invite not found, already revoked, or not yours"))).toMatch(/already be revoked/);
    expect(friendlyError({ message: "permission denied for table campaigns" })).toMatch(/access/);
  });
  it("maps rate limits, closed sign-up and network failures", () => {
    expect(friendlyError({ status: 429, message: "x" })).toMatch(/Too many/);
    expect(friendlyError(new Error("Signups not allowed for otp"))).toMatch(/closed/);
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/reach the server/);
  });
  it("never leaks the raw message of an unrecognised error", () => {
    expect(friendlyError(new Error("relation public.secret_table does not exist"))).not.toMatch(/secret_table/);
  });
});

describe("inviteStatus", () => {
  const future = () => new Date(Date.now() + 3600e3).toISOString();
  const base = { revoked_at: null, use_count: 0, max_uses: 2 };
  it("is active while unused, unexpired and unrevoked", () => expect(inviteStatus({ ...base, expires_at: future() })).toBe("active"));
  it("is revoked, which wins over every other state", () => expect(inviteStatus({ ...base, revoked_at: "2026-01-01", use_count: 2, expires_at: future() })).toBe("revoked"));
  it("is used up at max_uses", () => expect(inviteStatus({ ...base, use_count: 2, expires_at: future() })).toBe("used up"));
  it("is expired once its time has passed", () => expect(inviteStatus({ ...base, expires_at: new Date(Date.now() - 1000).toISOString() })).toBe("expired"));
  it("takes an injected clock", () => {
    const invite = { ...base, max_uses: 1, expires_at: "2026-01-02T00:00:00Z" };
    expect(inviteStatus(invite, Date.parse("2026-01-01T00:00:00Z"))).toBe("active");
    expect(inviteStatus(invite, Date.parse("2026-01-03T00:00:00Z"))).toBe("expired");
  });
});
