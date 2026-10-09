// Tiny DOM helper used by the lock screen, dialogs and Security tab.
// Text is always set with textContent (never innerHTML), so names or file contents
// can never be interpreted as HTML.
//
//   h("button", { class: "btn-primary", onclick: fn }, "Save")
//   h("div", { class: "row" }, [h("span", {}, "a"), "plain text"])

export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key === "text") node.textContent = value;
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
  return node;
}

/** Let the browser paint (e.g. a "Working..." message) before a slow step such as key derivation. */
export const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30)));

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const downloadText = (text, filename, type = "text/plain") => downloadBlob(new Blob([text], { type }), filename);

export function readFileBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsArrayBuffer(file);
  });
}

export const readFileText = (file) => file.text();

export function fileDate(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function formatWhen(value) {
  if (!value) return "never";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
