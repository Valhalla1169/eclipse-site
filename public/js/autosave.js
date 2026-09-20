// Debounced saving with retry. It knows nothing about sheets or Supabase: it calls
// `save()`, which resolves to { status: "saved" | "conflict" | "blocked", ... } or
// throws when the network fails, and reports its state to `onState`.
//
// States: saved, dirty (waiting to save), saving, error (will retry), conflict and
// blocked (stopped until the caller calls resume()).
const STOPPED = new Set(["conflict", "blocked"]);
const UNSAVED = new Set(["dirty", "saving", "error", "conflict", "blocked"]);

export function createAutosave({
  save,
  onState = () => {},
  delay = 1500,
  maxWait = 10000,
  retryDelays = [5000, 15000, 30000, 60000],
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  let state = "saved";
  let timer = null;
  let firstEditAt = 0;
  let inFlight = null;
  let editedWhileSaving = false;
  let failures = 0;

  const enter = (next, detail) => {
    state = next;
    onState(next, detail);
  };
  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const later = (ms) => {
    cancel();
    timer = setTimer(run, ms);
  };

  async function run() {
    timer = null;
    if (inFlight) return inFlight;
    enter("saving");
    editedWhileSaving = false;
    inFlight = (async () => {
      try {
        const result = await save();
        if (result.status === "saved") {
          failures = 0;
          if (editedWhileSaving) {
            firstEditAt = now();
            enter("dirty");
            later(delay);
          } else enter("saved", result);
        } else enter(result.status, result);
      } catch (error) {
        failures += 1;
        enter("error", error);
        later(retryDelays[Math.min(failures, retryDelays.length) - 1]);
      }
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return {
    get state() {
      return state;
    },
    hasUnsavedChanges: () => UNSAVED.has(state),
    // Call after every change to the sheet.
    edit() {
      if (STOPPED.has(state)) return;
      if (state === "saved") firstEditAt = now();
      if (inFlight) {
        editedWhileSaving = true;
        return;
      }
      enter("dirty");
      later(Math.min(delay, Math.max(0, maxWait - (now() - firstEditAt))));
    },
    // Saves now if anything is waiting. Resolves when the attempt ends.
    async flush() {
      if (inFlight) await inFlight;
      if (state === "dirty" || state === "error") {
        cancel();
        await run();
      }
    },
    // After a conflict or a blocked save is settled, saving starts again.
    // Pass edited: true when the sheet still holds changes that were never saved.
    resume({ edited = false } = {}) {
      cancel();
      failures = 0;
      enter("saved");
      if (edited) this.edit();
    },
    stop: cancel,
  };
}
