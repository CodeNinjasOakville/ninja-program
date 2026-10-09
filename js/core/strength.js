// Friendly password advice shown while typing: it nudges people towards long passphrases.
// (The hard minimum length is checked in js/sync/login.js.)
export function passwordAdvice(password) {
  const pw = String(password || "");
  if (!pw) return { level: 0, label: "", message: "" };

  const words = pw.split(/[\s\-_.,]+/).filter((w) => w.length >= 3);
  const distinct = new Set(pw).size;

  if (pw.length < 12 || distinct < 6) {
    return { level: 1, label: "Too short", message: "Use at least 12 characters." };
  }
  if (pw.length >= 20 || (words.length >= 4 && pw.length >= 16)) {
    return { level: 3, label: "Strong", message: "Good - long passphrases are hard to guess." };
  }
  if (pw.length >= 16 || words.length >= 3) {
    return { level: 2, label: "Okay", message: "Better: four or more random words, e.g. \"copper-lantern-orbit-maple\"." };
  }
  return { level: 2, label: "Okay", message: "Longer is stronger. Try four random words joined together." };
}
