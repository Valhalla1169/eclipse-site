// The one "are you sure?" dialog. Native <dialog>: focus moves in and back, Escape cancels.
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

// Resolves true for the button named confirmLabel ("Remove player"), false for Cancel
// or Escape. A second question while one is open is answered false.
export function confirmAction(message, confirmLabel) {
  ensureDialog();
  if (dialog.open) return Promise.resolve(false);
  messageEl.textContent = message;
  confirmButton.textContent = confirmLabel;
  return new Promise((resolve) => {
    settle = resolve;
    dialog.returnValue = "";
    dialog.showModal();
  });
}
