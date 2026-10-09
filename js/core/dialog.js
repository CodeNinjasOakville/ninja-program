// Small modal dialogs (prompt / confirm / message) that reuse the app's modal styling.
//
//   const values = await askDialog({ title, message, fields: [{ id, label, type, ... }], confirmText, danger });
//   -> an object { id: value } or null if cancelled.

import { h } from "./dom.js";

let counter = 0;

export function askDialog({ title, message, fields = [], confirmText = "OK", cancelText = "Cancel", danger = false, note } = {}) {
  return new Promise((resolve) => {
    const overlay = h("div", { class: "modal-overlay open", role: "dialog", "aria-modal": "true" });
    const error = h("div", { class: "banner error", role: "alert" });
    const inputs = {};
    const id = ++counter;

    const form = h("form", { class: "dialog-form", novalidate: true });
    const fieldNodes = fields.map((f) => {
      const inputId = `dlg${id}_${f.id}`;
      const input = f.type === "select"
        ? h("select", { id: inputId }, (f.options || []).map((o) => h("option", { value: o.value }, o.label)))
        : h("input", {
            id: inputId, type: f.type || "text", autocomplete: f.autocomplete || "off",
            placeholder: f.placeholder, accept: f.accept, spellcheck: "false",
          });
      if (f.value !== undefined) input.value = f.value;
      inputs[f.id] = input;
      return h("div", { class: "field full" }, [
        h("label", { for: inputId }, f.label),
        f.hint ? h("div", { class: "hint" }, f.hint) : null,
        input,
      ]);
    });

    const cancel = h("button", { type: "button", class: "btn-secondary" }, cancelText);
    const ok = h("button", { type: "submit", class: danger ? "btn-danger" : "btn-primary" }, confirmText);

    form.append(
      h("h2", {}, title),
      message ? h("p", { class: "muted dialog-message" }, message) : null,
      note ? h("p", { class: "dialog-note" }, note) : null,
      error,
      ...fieldNodes,
      h("div", { class: "modal-actions" }, [cancel, ok])
    );
    overlay.appendChild(h("div", { class: "modal" }, [form]));

    const previouslyFocused = document.activeElement;
    function close(result) {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
      resolve(result);
    }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(null); } }

    cancel.addEventListener("click", () => close(null));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const values = {};
      for (const f of fields) {
        const input = inputs[f.id];
        values[f.id] = input.type === "file" ? (input.files[0] || null) : input.value;
        if (f.required && !values[f.id]) {
          error.textContent = `${f.label} is required.`;
          error.className = "banner error show";
          input.focus();
          return;
        }
      }
      close(values);
    });
    document.addEventListener("keydown", onKey, true);

    document.body.appendChild(overlay);
    const first = fields.length ? inputs[fields[0].id] : ok;
    first.focus();
  });
}

export function confirmDialog2(title, message, confirmText = "Confirm", danger = false) {
  return askDialog({ title, message, confirmText, danger }).then((v) => v !== null);
}

export function noticeDialog(title, message, buttonText = "OK") {
  return askDialog({ title, message, confirmText: buttonText, cancelText: "Close" }).then(() => undefined);
}
