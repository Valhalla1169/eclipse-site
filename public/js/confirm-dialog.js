// A shared "are you sure?" dialog, so every place that used to ask with
// window.confirm looks and acts the same: labelled for a screen reader, focus
// moves in when it opens and back when it closes, Escape cancels, and the button
// that proceeds names the action instead of a bare "OK" (all native <dialog>
// behaviour, the same as sheet/dialogs.js).
import { h } from "./dom.js";

let dialog = null;
let messageEl = null;
let confirmButton = null;
let settle = null;

function ensureDialog() {
  if (dialog) return;
  messageEl = h("p", { id: "confirm-message" });
  confirmButton = h("button", { class: "btn btn-primary", type: "button" });
  const cancelButton = h("button", { class: "btn btn-quiet", type: "button" }, "Cancel");
  dialog = h(
    "dialog",
    { class: "confirm-dialog", "aria-labelledby": "confirm-message" },
    messageEl,
    h("div", { class: "actions" }, confirmButton, cancelButton),
  );
  confirmButton.addEventListener("click", () => dialog.close("confirm"));
  cancelButton.addEventListener("click", () => dialog.close("cancel"));
  dialog.addEventListener("close", () => settle(dialog.returnValue === "confirm"));
  document.body.append(dialog);
}

// message: the question, plain text. confirmLabel: what the button that proceeds
// says (for example "Leave page", "Remove player"), so the dialog always names
// what it does. Resolves to true for that button, false for Cancel or Escape.
export function confirmAction(message, confirmLabel) {
  ensureDialog();
  messageEl.textContent = message;
  confirmButton.textContent = confirmLabel;
  return new Promise((resolve) => {
    settle = resolve;
    dialog.returnValue = "";
    dialog.showModal();
  });
}
