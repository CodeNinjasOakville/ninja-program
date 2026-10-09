// The encrypted vault: everything that touches keys and ciphertext lives here.
// No DOM, no storage - so it can be tested and reasoned about on its own.
//
// DESIGN
//   data key (DK)     random 256-bit AES key. Encrypts the SQLite database image.
//   password wrap     DK encrypted under a key derived from the password (PBKDF2-SHA256, 1,000,000 iterations).
//   recovery wrap     DK encrypted under a key derived from the 160-bit recovery key (HKDF-SHA256).
//   => changing the password only re-wraps DK; the database is not re-encrypted,
//      and either the password OR the recovery key can open the vault.
//
// All encryption is AES-256-GCM (authenticated: tampering is detected).
// The same vault object is what's kept in IndexedDB and what's written to a backup file.
//
// To change algorithms later, bump VERSION and keep a branch for older versions in unlock().
// To make password guessing slower, raise DEFAULT_ITERATIONS: existing vaults are upgraded
// automatically the next time their owner logs in (see needsUpgrade()).

export const FORMAT = "ninja-vault";
export const VERSION = 1;
export const DEFAULT_ITERATIONS = 1000000;
export const MIN_ITERATIONS = 100000;     // anything lower in a file is refused
export const MAX_ITERATIONS = 20000000;   // a hostile file can't make the browser spin forever
export const MIN_PASSWORD_LENGTH = 12;
export const KDF_NAME = "PBKDF2-SHA256";

const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const AAD = {
  password: "ninja-vault/v1/dk-by-password",
  recovery: "ninja-vault/v1/dk-by-recovery",
  data: "ninja-vault/v1/database",
};

const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

export class VaultError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // "BAD_CREDENTIAL" | "CORRUPT" | "FORMAT" | "WEAK"
  }
}

// ---------- encoding helpers ----------
export function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// ---------- key derivation ----------
async function keyFromPassword(password, salt, iterations) {
  const base = await subtle().importKey("raw", enc.encode(String(password).normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

async function keyFromRecovery(recoveryBytes, salt) {
  const base = await subtle().importKey("raw", recoveryBytes, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: enc.encode("ninja-recovery-v1") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

async function seal(key, plain, aad) {
  const iv = random(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, plain));
  return { iv: toB64(iv), ct: toB64(ct) };
}

async function unseal(key, sealed, aad) {
  return new Uint8Array(await subtle().decrypt(
    { name: "AES-GCM", iv: fromB64(sealed.iv), additionalData: enc.encode(aad) }, key, fromB64(sealed.ct)
  ));
}

const importDk = (raw) => subtle().importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

// ---------- recovery key text ----------
export function generateRecoveryKey() {
  const bytes = random(20); // 160 bits
  let bits = 0, value = 0, chars = "";
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { chars += KEY_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return { bytes, text: chars.match(/.{4}/g).join("-") };
}

export function parseRecoveryKey(text) {
  const chars = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (chars.length !== 32 || [...chars].some((c) => !KEY_ALPHABET.includes(c))) {
    throw new VaultError("That recovery key doesn't look right. It has 8 groups of 4 letters/numbers.", "BAD_CREDENTIAL");
  }
  const out = new Uint8Array(20);
  let bits = 0, value = 0, n = 0;
  for (const c of chars) {
    value = (value << 5) | KEY_ALPHABET.indexOf(c); bits += 5;
    if (bits >= 8) { out[n++] = (value >>> (bits - 8)) & 255; bits -= 8; }
  }
  return out;
}

/** Hard rules a password must meet. (js/core/strength.js gives friendlier advice on top of this.) */
export function checkPasswordStrength(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new VaultError(`Use at least ${MIN_PASSWORD_LENGTH} characters - a few random words works well.`, "WEAK");
  }
  if (new Set(password).size < 6) {
    throw new VaultError("That password repeats too much. Try a few unrelated words instead.", "WEAK");
  }
}

// ---------- creating / changing ----------
async function buildWraps(raw, { password, recovery, iterations }) {
  const salt = random(16);
  const wrapPassword = await seal(await keyFromPassword(password, salt, iterations), raw, AAD.password);
  const out = { kdf: { name: KDF_NAME, iterations, salt: toB64(salt) }, wrapPassword };
  if (recovery) {
    const rsalt = random(16);
    out.recoverySalt = toB64(rsalt);
    out.wrapRecovery = await seal(await keyFromRecovery(recovery.bytes, rsalt), raw, AAD.recovery);
  }
  return out;
}

/** New vault around a database image. Returns the vault, the recovery key text (show ONCE) and the open key. */
export async function createVault(password, dbBytes, { iterations = DEFAULT_ITERATIONS } = {}) {
  checkPasswordStrength(password);
  const raw = random(32);
  const recovery = generateRecoveryKey();
  const dk = await importDk(raw);
  const vault = {
    format: FORMAT, version: VERSION,
    ...(await buildWraps(raw, { password, recovery, iterations })),
    data: await seal(dk, dbBytes, AAD.data),
    savedAt: new Date().toISOString(),
  };
  raw.fill(0);
  return { vault, dk, recoveryKey: recovery.text };
}

export function validateVault(v) {
  const sealedOk = (s) => s && typeof s.iv === "string" && typeof s.ct === "string";
  if (!v || v.format !== FORMAT) throw new VaultError("That isn't a Ninja Program backup file.", "FORMAT");
  if (v.version !== VERSION) throw new VaultError("That backup was made by a newer version of the app. Update the app first.", "FORMAT");
  if (!v.kdf || v.kdf.name !== KDF_NAME || !Number.isInteger(v.kdf.iterations) || v.kdf.iterations < MIN_ITERATIONS
      || v.kdf.iterations > MAX_ITERATIONS || typeof v.kdf.salt !== "string"
      || !sealedOk(v.wrapPassword) || !sealedOk(v.wrapRecovery) || typeof v.recoverySalt !== "string" || !sealedOk(v.data)) {
    throw new VaultError("That backup file is damaged or incomplete.", "FORMAT");
  }
  return v;
}

/** True if this vault was made with weaker settings than the current default (upgrade after login). */
export function needsUpgrade(vault) {
  return vault.kdf.iterations < DEFAULT_ITERATIONS;
}

/** credential = { password } or { recoveryKey } -> raw data key bytes. */
async function unwrapRaw(vault, credential) {
  validateVault(vault);
  try {
    if (credential.password !== undefined) {
      const key = await keyFromPassword(credential.password, fromB64(vault.kdf.salt), vault.kdf.iterations);
      return await unseal(key, vault.wrapPassword, AAD.password);
    }
    const key = await keyFromRecovery(parseRecoveryKey(credential.recoveryKey), fromB64(vault.recoverySalt));
    return await unseal(key, vault.wrapRecovery, AAD.recovery);
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError(
      credential.password !== undefined ? "Incorrect password." : "That recovery key is not correct for this data.",
      "BAD_CREDENTIAL"
    );
  }
}

/** Opens the vault. Returns { dk, dbBytes }. */
export async function unlock(vault, credential) {
  const raw = await unwrapRaw(vault, credential);
  const dk = await importDk(raw);
  raw.fill(0);
  try {
    return { dk, dbBytes: await unseal(dk, vault.data, AAD.data) };
  } catch (_) {
    throw new VaultError("The saved data could not be decrypted - it may be damaged.", "CORRUPT");
  }
}

/** Re-encrypts a new database image with the same key (wraps unchanged). */
export async function withData(vault, dk, dbBytes) {
  return { ...vault, data: await seal(dk, dbBytes, AAD.data), savedAt: new Date().toISOString() };
}

/**
 * Sets a new password (proving the old credential), and optionally a new recovery key.
 * Returns { vault, recoveryKey? }. The data itself is not re-encrypted.
 */
export async function changePassword(vault, credential, newPassword, { rotateRecovery = false, iterations } = {}) {
  checkPasswordStrength(newPassword);
  const raw = await unwrapRaw(vault, credential);
  const recovery = rotateRecovery ? generateRecoveryKey() : null;
  const wraps = await buildWraps(raw, { password: newPassword, recovery, iterations: iterations || DEFAULT_ITERATIONS });
  raw.fill(0);
  const next = { ...vault, kdf: wraps.kdf, wrapPassword: wraps.wrapPassword, savedAt: new Date().toISOString() };
  if (recovery) { next.recoverySalt = wraps.recoverySalt; next.wrapRecovery = wraps.wrapRecovery; }
  return { vault: next, recoveryKey: recovery ? recovery.text : undefined };
}

/** New recovery key (old one stops working). Requires the password. */
export async function rotateRecoveryKey(vault, password) {
  const raw = await unwrapRaw(vault, { password });
  const recovery = generateRecoveryKey();
  const rsalt = random(16);
  const wrapRecovery = await seal(await keyFromRecovery(recovery.bytes, rsalt), raw, AAD.recovery);
  raw.fill(0);
  return { vault: { ...vault, recoverySalt: toB64(rsalt), wrapRecovery, savedAt: new Date().toISOString() }, recoveryKey: recovery.text };
}

/** Checks a password without changing anything (used to re-confirm before sensitive actions). */
export async function verifyPassword(vault, password) {
  const raw = await unwrapRaw(vault, { password });
  raw.fill(0);
  return true;
}

// ---------- backup files ----------
export const serializeVault = (vault) => JSON.stringify(vault);

export function parseVaultFile(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (_) { throw new VaultError("That isn't a Ninja Program backup file.", "FORMAT"); }
  return validateVault(obj);
}
