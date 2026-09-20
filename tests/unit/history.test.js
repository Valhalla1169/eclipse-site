import { describe, expect, it } from "vitest";
import { reasonLabel } from "../../public/js/history.js";

describe("reasonLabel", () => {
  it("says what each copy was kept before", () => {
    expect(reasonLabel("edit")).toBe("Kept before an edit");
    expect(reasonLabel("schema_change")).toBe("Kept before a rules update");
    expect(reasonLabel("restore")).toBe("Kept before an earlier version was put back");
    expect(reasonLabel("delete")).toBe("Kept before the sheet was removed");
  });
  it("has a plain answer for a reason it does not know", () => {
    expect(reasonLabel("something new")).toBe("An earlier version");
  });
});
