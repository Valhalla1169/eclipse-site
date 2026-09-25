import { describe, expect, it, vi } from "vitest";
import { createLeaveGate, matchRoute } from "../../public/js/router.js";

const table = [
  { name: "home", pattern: "/" },
  { name: "join", pattern: "/join/:code" },
  { name: "play", pattern: "/campaign/:id/play" },
  { name: "dm", pattern: "/campaign/:id/dm" },
];

describe("matchRoute", () => {
  it("matches the root, and an empty path, as home", () => {
    expect(matchRoute("/", table)).toEqual({ name: "home", params: {} });
    expect(matchRoute("", table)).toEqual({ name: "home", params: {} });
  });

  it("captures :params", () => {
    expect(matchRoute("/join/ABC123", table)).toEqual({ name: "join", params: { code: "ABC123" } });
    expect(matchRoute("/campaign/1234/dm", table)).toEqual({ name: "dm", params: { id: "1234" } });
  });

  it("tells play from dm", () => {
    expect(matchRoute("/campaign/x/play", table).name).toBe("play");
    expect(matchRoute("/campaign/x/dm", table).name).toBe("dm");
  });

  it("ignores a trailing slash, a query string and a hash", () => {
    expect(matchRoute("/join/ABC123/", table).name).toBe("join");
    expect(matchRoute("/join/ABC123?x=1#y", table).params.code).toBe("ABC123");
  });

  it("percent-decodes params", () => {
    expect(matchRoute("/join/A%20B", table).params.code).toBe("A B");
  });

  it("returns null for unknown paths and wrong segment counts", () => {
    expect(matchRoute("/nope", table)).toBeNull();
    expect(matchRoute("/campaign/x", table)).toBeNull();
    expect(matchRoute("/join/a/b", table)).toBeNull();
  });

  it("returns null, rather than throwing, for a malformed percent-escape", () => {
    expect(matchRoute("/join/%E0%A4%A", table)).toBeNull();
  });
});

describe("the DM's sheet route", () => {
  const withSheet = [...table, { name: "dmsheet", pattern: "/campaign/:id/dm/:characterId" }];
  it("is told apart from the DM page", () => {
    expect(matchRoute("/campaign/c1/dm", withSheet).name).toBe("dm");
    expect(matchRoute("/campaign/c1/dm/ch9", withSheet)).toEqual({ name: "dmsheet", params: { id: "c1", characterId: "ch9" } });
  });
});

describe("createLeaveGate", () => {
  const gate = (check) => {
    const stay = vi.fn();
    return { leave: createLeaveGate({ check, stay }), stay };
  };

  it("moves when the check allows it", async () => {
    const { leave, stay } = gate(async () => true);
    const move = vi.fn();
    await leave(move);
    expect(move).toHaveBeenCalledTimes(1);
    expect(stay).not.toHaveBeenCalled();
  });

  it("stays when the check refuses", async () => {
    const { leave, stay } = gate(async () => false);
    const move = vi.fn();
    await leave(move);
    expect(move).not.toHaveBeenCalled();
    expect(stay).toHaveBeenCalledTimes(1);
  });

  it("gives its other arguments to the check", async () => {
    const check = vi.fn(async () => true);
    const { leave } = gate(check);
    await leave(() => {}, "Sign out and lose them?");
    expect(check).toHaveBeenCalledWith("Sign out and lose them?");
  });

  it("does nothing for a leave that starts while a check waits: one question, one move", async () => {
    let answer;
    const check = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { leave, stay } = gate(check);
    const first = vi.fn();
    const second = vi.fn();
    const waiting = leave(first);
    await leave(second);
    answer(true);
    await waiting;
    expect(check).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(stay).not.toHaveBeenCalled();
  });

  it("checks again once the last check has ended", async () => {
    const check = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { leave, stay } = gate(check);
    const move = vi.fn();
    await leave(move);
    await leave(move);
    expect(check).toHaveBeenCalledTimes(2);
    expect(stay).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledTimes(1);
  });

  it("lets a move leave again, as a redirect does", async () => {
    const { leave } = gate(async () => true);
    const redirect = vi.fn();
    await leave(() => leave(redirect));
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("opens again after a check that throws", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("no answer")).mockResolvedValueOnce(true);
    const { leave } = gate(check);
    const move = vi.fn();
    await expect(leave(move)).rejects.toThrow("no answer");
    await leave(move);
    expect(move).toHaveBeenCalledTimes(1);
  });
});
