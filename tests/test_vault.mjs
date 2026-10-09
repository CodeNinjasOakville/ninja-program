// Encryption layer: create / unlock / wrong password / recovery / change password /
// tamper detection / backup file round-trip / session saving.
import { check, finish } from "./helpers.mjs";
import * as V from "../js/core/vault.js";
import { memoryStorage } from "../js/core/storage.js";
import { Session } from "../js/core/session.js";
import { openDatabase, conn, closeDatabase } from "../js/core/db.js";

const ITER = { iterations: 100000 }; // fast for tests; the app default is 600,000
const rejects = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const data = new TextEncoder().encode("SQLite format 3\u0000 hello world".padEnd(200, "x"));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// --- recovery key text round-trip
const rk = V.generateRecoveryKey();
check("recovery key format", /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/.test(rk.text), rk.text);
check("recovery key parses back", same(V.parseRecoveryKey(rk.text), rk.bytes));
check("recovery key forgives spaces/lowercase", same(V.parseRecoveryKey(" " + rk.text.toLowerCase().replaceAll("-", " ") + " "), rk.bytes));
check("bad recovery key rejected", (await rejects(() => V.parseRecoveryKey("ABCD-1234"))) instanceof V.VaultError);

// --- create + unlock
check("weak password refused", (await rejects(() => V.createVault("short", data, ITER)))?.code === "WEAK");
const { vault, recoveryKey } = await V.createVault("correct horse battery", data, ITER);
check("vault validates", !!V.validateVault(vault));
check("no plaintext in vault", !JSON.stringify(vault).includes("hello world") && !JSON.stringify(vault).includes("SQLite"));
let opened = await V.unlock(vault, { password: "correct horse battery" });
check("password unlocks", same(opened.dbBytes, data));
check("wrong password rejected", (await rejects(() => V.unlock(vault, { password: "wrong horse battery" })))?.code === "BAD_CREDENTIAL");
opened = await V.unlock(vault, { recoveryKey });
check("recovery key unlocks", same(opened.dbBytes, data));
const other = V.generateRecoveryKey().text;
check("wrong recovery key rejected", (await rejects(() => V.unlock(vault, { recoveryKey: other })))?.code === "BAD_CREDENTIAL");
check("unicode password normalised", !!(await V.createVault("pässwörd-länger-12", data, ITER)));

// --- tamper detection
const bad = structuredClone(vault);
bad.data.ct = bad.data.ct.slice(0, -8) + (bad.data.ct.slice(-8) === "AAAAAAAA" ? "BBBBBBBB" : "AAAAAAAA");
check("tampered data detected", (await rejects(() => V.unlock(bad, { password: "correct horse battery" })))?.code === "CORRUPT");
const bad2 = structuredClone(vault); bad2.wrapPassword.ct = bad2.wrapPassword.ct.replace(/^./, (c) => (c === "A" ? "B" : "A"));
check("tampered key wrap detected", (await rejects(() => V.unlock(bad2, { password: "correct horse battery" })))?.code === "BAD_CREDENTIAL");
check("garbage file rejected", (await rejects(() => V.parseVaultFile("not json")))?.code === "FORMAT");
check("wrong format rejected", (await rejects(() => V.parseVaultFile('{"format":"x"}')))?.code === "FORMAT");
check("low iteration count rejected", (await rejects(() => V.validateVault({ ...vault, kdf: { ...vault.kdf, iterations: 1 } })))?.code === "FORMAT");

// --- saving new data keeps both credentials working; nonce changes each time
const data2 = new TextEncoder().encode("SQLite format 3\u0000 second".padEnd(200, "y"));
const v2 = await V.withData(vault, opened.dk, data2);
check("fresh nonce per save", v2.data.iv !== vault.data.iv);
check("new data readable via password", same((await V.unlock(v2, { password: "correct horse battery" })).dbBytes, data2));
check("new data readable via recovery", same((await V.unlock(v2, { recoveryKey })).dbBytes, data2));

// --- change password
const cp = await V.changePassword(v2, { password: "correct horse battery" }, "a brand new passphrase", ITER);
check("old password no longer works", (await rejects(() => V.unlock(cp.vault, { password: "correct horse battery" })))?.code === "BAD_CREDENTIAL");
check("new password works", same((await V.unlock(cp.vault, { password: "a brand new passphrase" })).dbBytes, data2));
check("recovery key still works after password change", same((await V.unlock(cp.vault, { recoveryKey })).dbBytes, data2));
check("change needs the old password", (await rejects(() => V.changePassword(v2, { password: "nope nope nope nope" }, "another long passphrase")))?.code === "BAD_CREDENTIAL");

// --- forgot password: recovery key sets new password and rotates the recovery key
const rec = await V.changePassword(cp.vault, { recoveryKey }, "set via recovery key!", { rotateRecovery: true, iterations: 100000 });
check("recovery reset gives new key", !!rec.recoveryKey && rec.recoveryKey !== recoveryKey);
check("password after recovery works", same((await V.unlock(rec.vault, { password: "set via recovery key!" })).dbBytes, data2));
check("old recovery key is retired", (await rejects(() => V.unlock(rec.vault, { recoveryKey })))?.code === "BAD_CREDENTIAL");
check("new recovery key works", same((await V.unlock(rec.vault, { recoveryKey: rec.recoveryKey })).dbBytes, data2));

// --- rotate recovery key (needs password)
const rot = await V.rotateRecoveryKey(rec.vault, "set via recovery key!");
check("rotated key differs and works", rot.recoveryKey !== rec.recoveryKey && same((await V.unlock(rot.vault, { recoveryKey: rot.recoveryKey })).dbBytes, data2));
check("rotate needs password", (await rejects(() => V.rotateRecoveryKey(rec.vault, "wrong wrong wrong!")))?.code === "BAD_CREDENTIAL");

// --- backup file round-trip
const file = V.serializeVault(rot.vault);
check("backup file parses + unlocks", same((await V.unlock(V.parseVaultFile(file), { password: "set via recovery key!" })).dbBytes, data2));

// --- Session: save, reload from storage, previous-copy fallback, backup text
const storage = memoryStorage();
const session = new Session(storage);
openDatabase(null);
const created = await V.createVault("session test password", (await import("../js/core/db.js")).exportDatabase(), ITER);
await session.begin(created.vault, created.dk, (await import("../js/core/db.js")).exportDatabase());
conn.run("INSERT INTO belt_entries (name, old_belt, new_belt) VALUES (?,?,?)", ["Saved Ninja", "White", "Yellow"]);
const states = []; session.onStatus((s) => states.push(s));
session.scheduleSave(); await session.saveNow();
check("session reports pending -> saved", states.includes("pending") && states.at(-1) === "saved", states);
const stored = await session.loadStoredVault();
const reopened = await V.unlock(stored.vault, { password: "session test password" });
openDatabase(reopened.dbBytes);
check("saved row survives a lock/unlock cycle", conn.get("SELECT name FROM belt_entries")?.name === "Saved Ninja");
// corrupt the latest copy -> falls back to the previous one
await storage.setMany([["vault", { format: "ninja-vault", broken: true }]]);
const fb = await session.loadStoredVault();
check("falls back to previous copy if latest is damaged", fb && fb.recoveredFromPrevious === true);
const text = await session.backupText();
check("backup text is a valid vault", !!V.parseVaultFile(text));
await session.close(); closeDatabase();
check("session forgets the key on close", session.dk === null && session.vault === null);

finish("vault & session");
