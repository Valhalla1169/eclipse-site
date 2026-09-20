import { describe, expect, it } from "vitest";
import { matchRoute } from "../../public/js/router.js";

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
