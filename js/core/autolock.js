// Locks the app after a period with no clicks or typing, and when the device wakes up
// after being away longer than that. Locking = save, forget the key, reload the page
// (the reload also clears the screen's contents from memory).

import { prefs } from "./storage.js";

export const AUTOLOCK_CHOICES = [
  { minutes: 5, label: "After 5 minutes" },
  { minutes: 15, label: "After 15 minutes" },
  { minutes: 30, label: "After 30 minutes" },
  { minutes: 60, label: "After 1 hour" },
  { minutes: 0, label: "Never (not recommended)" },
];

export const DEFAULT_AUTOLOCK_MINUTES = 15;

export function getAutolockMinutes() {
  const v = Number(prefs.get("autolockMinutes", DEFAULT_AUTOLOCK_MINUTES));
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_AUTOLOCK_MINUTES;
}

export function setAutolockMinutes(minutes) {
  prefs.set("autolockMinutes", Number(minutes));
}

/** Starts watching for inactivity. Returns a function that stops watching. */
export function startAutoLock(lockFn, { now = () => Date.now() } = {}) {
  let lastActivity = now();
  let fired = false;

  const bump = () => { lastActivity = now(); };
  const events = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"];
  events.forEach((name) => window.addEventListener(name, bump, { capture: true, passive: true }));

  function check() {
    const minutes = getAutolockMinutes();
    if (fired || minutes <= 0) return;
    if (now() - lastActivity >= minutes * 60 * 1000) {
      fired = true;
      lockFn();
    }
  }
  const timer = setInterval(check, 1000);
  const onVisible = () => { if (!document.hidden) check(); };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    clearInterval(timer);
    events.forEach((name) => window.removeEventListener(name, bump, { capture: true }));
    document.removeEventListener("visibilitychange", onVisible);
  };
}
