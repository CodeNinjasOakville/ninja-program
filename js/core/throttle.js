// A speed bump on repeated wrong passwords: after 3 misses the unlock screen makes you wait,
// and the wait doubles with every further miss (30s, 1m, 2m ... up to 15m).
//
// HONEST LIMIT: this lives in the browser, so someone with developer tools could clear it.
// It stops casual guessing and fat-fingering; the real protection against guessing is the slow
// password key derivation plus a long password (see SECURITY.md).

import { prefs } from "./storage.js";

const FREE_TRIES = 3;
const BASE_SECONDS = 30;
const MAX_SECONDS = 15 * 60;

function read() {
  try {
    const v = JSON.parse(prefs.get("throttle", "{}"));
    return { fails: Number(v.fails) || 0, until: Number(v.until) || 0 };
  } catch (_) {
    return { fails: 0, until: 0 };
  }
}

/** Seconds left to wait (0 = go ahead). */
export function waitSeconds(now = Date.now()) {
  const { until } = read();
  return Math.max(0, Math.ceil((until - now) / 1000));
}

export function recordFailure(now = Date.now()) {
  const state = read();
  state.fails += 1;
  if (state.fails >= FREE_TRIES) {
    const seconds = Math.min(MAX_SECONDS, BASE_SECONDS * 2 ** (state.fails - FREE_TRIES));
    state.until = now + seconds * 1000;
  }
  prefs.set("throttle", JSON.stringify(state));
  return { fails: state.fails, wait: waitSeconds(now) };
}

export function reset() {
  prefs.remove("throttle");
}

export function triesBeforeWait() {
  return Math.max(0, FREE_TRIES - read().fails);
}
