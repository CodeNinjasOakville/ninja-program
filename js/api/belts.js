import { conn } from "../core/db.js";
import { route } from "./router.js";
import { bulkDelete, insertAll, readUpload, searchClause } from "./common.js";
import { ApiError, nonBlankLines, pyStr, splitBulkLine } from "../lib/util.js";
import { readDicts } from "../lib/csv.js";
import { getCurrentBelts } from "../lib/rewards.js";

function insertBelt(data) {
  const name = pyStr(data.name).trim();
  if (!name) throw new ApiError("Name is required.");
  conn.run("INSERT INTO belt_entries (name, old_belt, new_belt) VALUES (?, ?, ?)", [
    name, pyStr(data.old_belt).trim(), pyStr(data.new_belt).trim(),
  ]);
}

route("GET", "/api/belts", ({ query }) => {
  const search = (query.q || "").trim();
  if (search) {
    const { where, params } = searchClause(["name", "old_belt", "new_belt", "created_at"], search);
    return conn.all(`SELECT * FROM belt_entries WHERE ${where} ORDER BY id DESC`, params);
  }
  return conn.all("SELECT * FROM belt_entries ORDER BY id DESC");
});

route("POST", "/api/belts", ({ body }) => {
  insertBelt(body);
  return { ok: true };
});

// Body: {names: [...]} -> the belt each of those Ninjas is on now ("" when no belt entry exists),
// in the same order. Used to say which belt each totem tag goes on.
route("POST", "/api/belts/current", ({ body }) => {
  const current = getCurrentBelts(conn);
  return (body.names || []).map((n) => {
    const name = pyStr(n).trim();
    return { name, belt: current.get(name.toLowerCase()) || "" };
  });
});

route("POST", "/api/belts/bulk", ({ body }) => {
  const lines = nonBlankLines(body.text);
  if (!lines.length) throw new ApiError("No entries were provided.");
  const entries = lines.map((line) => {
    const p = splitBulkLine(line);
    return {
      name: p.length > 0 ? p[0].trim() : "",
      old_belt: p.length > 1 ? p[1].trim() : "",
      new_belt: p.length > 2 ? p[2].trim() : "",
    };
  });
  return insertAll(entries, insertBelt, (i) => `Line ${i + 1}`);
});

// Expects Name, Old Belt, New Belt columns (any extra columns are ignored).
route("POST", "/api/belts/import", async ({ file }) => {
  const raw = await readUpload(file);
  const { fieldnames, records } = readDicts(raw);
  if (!fieldnames) throw new ApiError("CSV has no header row.");

  const headerMap = {};
  for (const header of fieldnames) {
    const key = String(header || "").trim().toLowerCase();
    if (key === "name") headerMap[header] = "name";
    else if (key === "old belt") headerMap[header] = "old_belt";
    else if (key === "new belt") headerMap[header] = "new_belt";
  }
  if (!Object.values(headerMap).includes("name")) {
    throw new ApiError('Could not find a "Name" column in the CSV header.');
  }

  const entries = records.map((rec) =>
    Object.fromEntries(Object.entries(headerMap).map(([header, field]) => [field, pyStr(rec[header]).trim()]))
  );
  return insertAll(entries, insertBelt, (i) => `Row ${i + 2}`);
});

route("PUT", "/api/belts/:id", ({ params, body }) => {
  const existing = conn.get("SELECT * FROM belt_entries WHERE id = ?", [params.id]);
  if (!existing) throw new ApiError("That entry no longer exists.", 404);

  const name = pyStr("name" in body ? body.name : existing.name).trim();
  if (!name) throw new ApiError("Name is required.");
  const oldBelt = pyStr("old_belt" in body ? body.old_belt : existing.old_belt).trim();
  const newBelt = pyStr("new_belt" in body ? body.new_belt : existing.new_belt).trim();

  conn.run("UPDATE belt_entries SET name = ?, old_belt = ?, new_belt = ? WHERE id = ?", [name, oldBelt, newBelt, params.id]);
  return { ok: true };
});

route("DELETE", "/api/belts/:id", ({ params }) => {
  conn.run("DELETE FROM belt_entries WHERE id = ?", [params.id]);
  return { ok: true };
});

route("POST", "/api/belts/bulk-delete", ({ body }) => bulkDelete("belt_entries", body));
