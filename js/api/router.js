// A tiny in-browser replacement for the Flask server: the frontend still calls
// "/api/..." paths, but they are answered here instead of over the network.
//
// To add a feature: write a handler in a file under js/api/ and register it with
// route("GET", "/api/thing/:id", ({ params, query, body, file }) => { ...return data... }).
// Throw new ApiError("message", 400) for user-facing errors.

import { takeDirty } from "../core/db.js";
import { ApiError } from "../lib/util.js";

const routes = [];
let changeListener = () => {};

/** Called after any request that changed the database (used to trigger a sync). */
export function onDataChanged(fn) { changeListener = fn; }

export function route(method, pattern, handler) {
  // :id = whole number, :key = any text segment
  const source = pattern
    .replace(/:id\b/g, "(\\d+)")
    .replace(/:key\b/g, "([^/]+)");
  routes.push({ method, regex: new RegExp("^" + source + "$"), names: [...pattern.matchAll(/:(id|key)\b/g)].map((m) => m[1]), handler });
}

export async function handleRequest(method, url, body, file) {
  const [path, queryString = ""] = String(url).split("?");
  const query = Object.fromEntries(new URLSearchParams(queryString));

  for (const r of routes) {
    if (r.method !== method) continue;
    const match = r.regex.exec(path);
    if (!match) continue;

    const params = {};
    r.names.forEach((name, i) => {
      const raw = decodeURIComponent(match[i + 1]);
      params[name] = name === "id" ? parseInt(raw, 10) : raw;
    });

    try {
      const result = await r.handler({ params, query, body: body || {}, file });
      if (takeDirty()) changeListener();
      return result;
    } catch (error) {
      if (takeDirty()) changeListener(); // keep whatever was written before the error
      if (error instanceof ApiError) throw error;
      throw new ApiError(error && error.message ? error.message : "Something went wrong.", 500);
    }
  }
  throw new ApiError("Not found.", 404);
}
