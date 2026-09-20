import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave } from "../../public/js/autosave.js";

const setup = (results, options = {}) => {
  const states = [];
  const save = vi.fn(async () => {
    const next = results.shift();
    if (next instanceof Error) throw next;
    return next || { status: "saved" };
  });
  const autosave = createAutosave({ save, onState: (state) => states.push(state), ...options });
  return { autosave, save, states };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("autosave", () => {
  it("waits for a pause in typing, then saves once", async () => {
    const { autosave, save, states } = setup([]);
    autosave.edit();
    await vi.advanceTimersByTimeAsync(1000);
    autosave.edit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["dirty", "dirty", "saving", "saved"]);
  });

  it("saves even while the person keeps typing, after the longest wait", async () => {
    const { autosave, save } = setup([]);
    for (let i = 0; i < 20; i += 1) {
      autosave.edit();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(save).toHaveBeenCalled();
  });

  it("saves again when something changed during a save", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const { autosave, save } = setup([]);
    save.mockImplementationOnce(async () => {
      await gate;
      return { status: "saved" };
    });
    autosave.edit();
    await vi.advanceTimersByTimeAsync(1500);
    expect(autosave.state).toBe("saving");
    autosave.edit();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.state).toBe("dirty");
    await vi.advanceTimersByTimeAsync(1500);
    expect(save).toHaveBeenCalledTimes(2);
    expect(autosave.state).toBe("saved");
  });

  it("keeps the changes and retries with growing pauses when the network fails", async () => {
    const { autosave, save } = setup([new Error("offline"), new Error("offline")]);
    autosave.edit();
    await vi.advanceTimersByTimeAsync(1500);
    expect(autosave.state).toBe("error");
    expect(autosave.hasUnsavedChanges()).toBe(true);
    await vi.advanceTimersByTimeAsync(4999);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(autosave.state).toBe("error");
    await vi.advanceTimersByTimeAsync(15000);
    expect(save).toHaveBeenCalledTimes(3);
    expect(autosave.state).toBe("saved");
    expect(autosave.hasUnsavedChanges()).toBe(false);
  });

  it("stops on a conflict and does not save again until resumed", async () => {
    const current = { updated_at: "later" };
    const { autosave, save } = setup([{ status: "conflict", current }]);
    autosave.edit();
    await vi.advanceTimersByTimeAsync(1500);
    expect(autosave.state).toBe("conflict");
    autosave.edit();
    await vi.advanceTimersByTimeAsync(60000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.hasUnsavedChanges()).toBe(true);
    autosave.resume({ edited: true });
    await vi.advanceTimersByTimeAsync(1500);
    expect(save).toHaveBeenCalledTimes(2);
    expect(autosave.state).toBe("saved");
  });

  it("stops when the database refuses the write", async () => {
    const { autosave, save } = setup([{ status: "blocked" }]);
    autosave.edit();
    await vi.advanceTimersByTimeAsync(1500);
    expect(autosave.state).toBe("blocked");
    await vi.advanceTimersByTimeAsync(120000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush saves at once, and does nothing when nothing changed", async () => {
    const { autosave, save } = setup([]);
    await autosave.flush();
    expect(save).not.toHaveBeenCalled();
    autosave.edit();
    await autosave.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.state).toBe("saved");
  });
});
