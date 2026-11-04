// Ninja and family records, and how every sheet links to them.
//
//  families  one row per paying customer (parent): name, email, phone
//  ninjas    one row per child: name, belt, family_uid
//  Every other sheet has a ninja_uid column that points at the child it is about:
//    active_ninjas (one row per weekly class), belt_entries, receipts, jr_notes, leads.
//
// The Ninja record is the source of truth for a child's name and belt. The copies of the name
// (and, on classes, the belt) kept on the other sheets are refreshed by linkEverything(), so
// renaming a Ninja renames them on the Belts tab, Reward History and JR notes too.
//
// uids are made here, in the browser, from the name (or email), e.g. "n-mia-lee" or
// "f-parent-example-com". Two teammates who create the same record at the same moment
// therefore make the same uid, and the shared database keeps a single row.

import { nameKey } from "./belt_match.js";

const str = (v) => (v == null ? "" : String(v));

// "(905) 555-1234", "905.555.1234" and "+1 905 555 1234" all become "9055551234".
export function phoneKey(value) {
  let digits = str(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length >= 7 ? digits : "";
}

export function emailKey(value) {
  const email = str(value).trim().toLowerCase();
  return email.includes("@") ? email : "";
}

export const firstName = (name) => nameKey(name).split(" ")[0] || "";

function slug(text) {
  return str(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

/** A uid not used yet in `table`: prefix + slug(base), then -2, -3... */
function freshUid(conn, table, prefix, base) {
  const root = prefix + (slug(base) || "x");
  let uid = root;
  for (let n = 2; conn.get(`SELECT 1 AS x FROM ${table} WHERE uid = ?`, [uid]); n++) uid = `${root}-${n}`;
  return uid;
}

// ------------------------------------------------------------------ families

export function getFamily(conn, uid) {
  return uid ? conn.get("SELECT * FROM families WHERE uid = ?", [uid]) || null : null;
}

/** The family with this email (first) or phone number, or null. */
export function findFamily(conn, { email, phone }) {
  const e = emailKey(email), p = phoneKey(phone);
  if (!e && !p) return null;
  const all = conn.all("SELECT * FROM families ORDER BY created_at, uid");
  return (e && all.find((f) => emailKey(f.email) === e)) || (p && all.find((f) => phoneKey(f.phone) === p)) || null;
}

/**
 * The uid of the family with this email/phone, made if there isn't one. Blank details on an existing
 * family are filled in; details already there are not overwritten (use updateFamily for that).
 * Returns null when nothing at all is known about the family.
 */
export function findOrCreateFamily(conn, details) {
  const name = str(details.name).trim(), email = str(details.email).trim(), phone = str(details.phone).trim();
  if (!name && !emailKey(email) && !phoneKey(phone)) return null;
  const found = findFamily(conn, { email, phone });
  if (found) {
    const fill = { name: found.name || name, email: found.email || email, phone: found.phone || phone };
    if (fill.name !== str(found.name) || fill.email !== str(found.email) || fill.phone !== str(found.phone)) {
      conn.run("UPDATE families SET name = ?, email = ?, phone = ? WHERE uid = ?", [fill.name, fill.email, fill.phone, found.uid]);
    }
    return found.uid;
  }
  const uid = freshUid(conn, "families", "f-", emailKey(email) || phoneKey(phone) || name);
  conn.run("INSERT INTO families (uid, name, email, phone) VALUES (?, ?, ?, ?)", [uid, name, email, phone]);
  return uid;
}

export function updateFamily(conn, uid, details) {
  const f = getFamily(conn, uid);
  if (!f) return;
  const next = ["name", "email", "phone"].map((k) => (k in details ? str(details[k]).trim() : str(f[k])));
  conn.run("UPDATE families SET name = ?, email = ?, phone = ? WHERE uid = ?", [...next, uid]);
}

// ------------------------------------------------------------------ ninjas

export function getNinja(conn, uid) {
  return uid ? conn.get("SELECT * FROM ninjas WHERE uid = ?", [uid]) || null : null;
}

/** Every Ninja whose name matches (ignoring case and spacing). */
export function ninjasNamed(conn, name) {
  const key = nameKey(name);
  if (!key) return [];
  return conn.all("SELECT * FROM ninjas ORDER BY created_at, uid").filter((n) => nameKey(n.name) === key);
}

/** The Ninja with this name, made if there isn't one. Returns the uid. */
export function ensureNinja(conn, name, { belt = "", family_uid = null } = {}) {
  const clean = str(name).trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("A Ninja needs a name.");
  const existing = ninjasNamed(conn, clean);
  if (existing.length) {
    const n = existing[0];
    if (family_uid && !n.family_uid) conn.run("UPDATE ninjas SET family_uid = ? WHERE uid = ?", [family_uid, n.uid]);
    if (belt && !n.belt) setNinjaBelt(conn, n.uid, belt);
    return n.uid;
  }
  const uid = freshUid(conn, "ninjas", "n-", clean);
  conn.run("INSERT INTO ninjas (uid, name, belt, family_uid, notes) VALUES (?, ?, ?, ?, '')", [uid, clean, str(belt).trim(), family_uid]);
  return uid;
}

/** Puts the belt on the Ninja and on every one of their classes. */
export function setNinjaBelt(conn, uid, belt) {
  const b = str(belt).trim();
  conn.run("UPDATE ninjas SET belt = ? WHERE uid = ? AND coalesce(belt, '') <> ?", [b, uid, b]);
  conn.run("UPDATE active_ninjas SET belt = ? WHERE ninja_uid = ? AND coalesce(belt, '') <> ?", [b, uid, b]);
}

/** Renames the Ninja; the copies of the name on every linked sheet follow. */
export function renameNinja(conn, uid, name) {
  const clean = str(name).trim().replace(/\s+/g, " ");
  if (!clean) return;
  conn.run("UPDATE ninjas SET name = ? WHERE uid = ? AND name <> ?", [clean, uid, clean]);
  for (const table of NAMED_SHEETS) {
    conn.run(`UPDATE ${table} SET name = ? WHERE ninja_uid = ? AND name <> ?`, [clean, uid, clean]);
  }
}

// Sheets that keep a copy of the Ninja's name in a "name" column.
const NAMED_SHEETS = ["active_ninjas", "belt_entries", "receipts", "jr_notes"];

// ------------------------------------------------------------------ keeping links right

/**
 * Makes sure every sheet points at the right Ninja. Safe to run any number of times; it only
 * writes when something is out of step, and every browser reaches the same answer.
 *  - Every class belongs to a Ninja (one is made for a name seen for the first time).
 *  - Classes carry the Ninja's current name and belt.
 *  - Belts / rewards / JR notes rows with no link are linked when exactly one Ninja has that name;
 *    linked rows carry the Ninja's current name.
 *  - Leads are linked to the Ninja they became (same name, or same family email/phone + first name).
 */
export function linkEverything(conn) {
  const ninjas = conn.all("SELECT * FROM ninjas ORDER BY created_at, uid");
  const byUid = new Map(ninjas.map((n) => [n.uid, n]));
  const byKey = new Map(); // nameKey -> Ninja, or null when two Ninjas share the name
  const remember = (n) => {
    const key = nameKey(n.name);
    if (key) byKey.set(key, byKey.has(key) ? null : n);
  };
  ninjas.forEach(remember);

  // 1. Classes
  const classes = conn.all("SELECT id, name, belt, ninja_uid FROM active_ninjas ORDER BY id");
  for (const row of classes) {
    let n = byUid.get(row.ninja_uid);
    if (!n) {
      const key = nameKey(row.name);
      if (!key) continue;
      n = byKey.get(key) || ninjas.find((x) => nameKey(x.name) === key);
      if (!n) {
        const uid = freshUid(conn, "ninjas", "n-", key);
        n = { uid, name: str(row.name).trim().replace(/\s+/g, " "), belt: "", family_uid: null };
        conn.run("INSERT INTO ninjas (uid, name, belt, family_uid, notes) VALUES (?, ?, '', NULL, '')", [uid, n.name]);
        ninjas.push(n); byUid.set(uid, n); remember(n);
      }
      conn.run("UPDATE active_ninjas SET ninja_uid = ? WHERE id = ?", [n.uid, row.id]);
      // A belt typed on an older class row is kept when the Ninja has none yet.
      if (!n.belt && str(row.belt).trim()) {
        n.belt = str(row.belt).trim();
        conn.run("UPDATE ninjas SET belt = ? WHERE uid = ?", [n.belt, n.uid]);
      }
    }
    if (row.name !== n.name || str(row.belt) !== str(n.belt)) {
      conn.run("UPDATE active_ninjas SET name = ?, belt = ? WHERE id = ?", [n.name, str(n.belt), row.id]);
    }
  }

  // 2. Belts, rewards and JR notes
  for (const table of ["belt_entries", "receipts", "jr_notes"]) {
    for (const row of conn.all(`SELECT id, name, ninja_uid FROM ${table}`)) {
      let n = byUid.get(row.ninja_uid);
      if (!n && !row.ninja_uid) {
        n = byKey.get(nameKey(row.name));
        if (!n) continue;
        conn.run(`UPDATE ${table} SET ninja_uid = ? WHERE id = ?`, [n.uid, row.id]);
      }
      if (n && row.name !== n.name) conn.run(`UPDATE ${table} SET name = ? WHERE id = ?`, [n.name, row.id]);
    }
  }

  // 3. Leads
  const leads = conn.all("SELECT id, ninja_name, email, phone_number FROM leads WHERE ninja_uid IS NULL OR ninja_uid = ''");
  if (leads.length) {
    const families = new Map(conn.all("SELECT * FROM families").map((f) => [f.uid, f]));
    for (const lead of leads) {
      const n = leadMatch(lead, ninjas, byKey, families);
      if (n) conn.run("UPDATE leads SET ninja_uid = ? WHERE id = ?", [n.uid, lead.id]);
    }
  }
}

/** The Ninja a lead turned into, or null. */
export function leadMatch(lead, ninjas, byKey, families) {
  const e = emailKey(lead.email), p = phoneKey(lead.phone_number);
  const contactOf = (n) => families.get(n.family_uid) || null;
  const sameContact = (f) => !!f && ((e && emailKey(f.email) === e) || (p && phoneKey(f.phone) === p));
  const differentContact = (f) => !!f && (e || p) && (emailKey(f.email) || phoneKey(f.phone)) && !sameContact(f);

  const named = byKey.get(nameKey(lead.ninja_name));
  if (named && !differentContact(contactOf(named))) return named;
  const first = firstName(lead.ninja_name);
  if (!first || (!e && !p)) return null;
  const hits = ninjas.filter((n) => firstName(n.name) === first && sameContact(contactOf(n)));
  return hits.length === 1 ? hits[0] : null;
}
