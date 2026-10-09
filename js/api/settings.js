import { conn } from "../core/db.js";
import { route } from "./router.js";
import { ApiError } from "../lib/util.js";

route("GET", "/api/settings", () => {
  const out = {};
  for (const row of conn.all("SELECT key, value FROM settings")) out[row.key] = JSON.parse(row.value);
  return out;
});

route("PUT", "/api/settings/:key", ({ params, body }) => {
  if (!Array.isArray(body.values)) throw new ApiError("values must be a list of strings");
  const values = body.values.map((v) => String(v).trim()).filter(Boolean);
  conn.run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [params.key, JSON.stringify(values)]
  );
  return { ok: true, values };
});
