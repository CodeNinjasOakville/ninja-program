// Rewards owed without coins, and certificates in two steps: printed (PDF saved) then given (handed out).
import { check, finish } from "./helpers.mjs";
import { openDatabase, closeDatabase, conn } from "../js/core/db.js";
import { handleRequest } from "../js/api/index.js";

const call = (method, url, body) => handleRequest(method, url, body);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function fails(promise) { try { await promise; return null; } catch (e) { return e.message; } }
const owed = async (name) => (await call("GET", "/api/rewards/summary")).rows.find((r) => r.name === name) || null;

openDatabase(null);
// White -> Orange = 2 levels: 10 Ninja Bucks, White + Yellow certificates.
await call("POST", "/api/belts", { name: "Mia Lee", old_belt: "White", new_belt: "Orange" });
// White -> Yellow then Yellow -> Orange: 10 Ninja Bucks too (the case where small coins used to get stuck).
await call("POST", "/api/belts", { name: "Sam Park", old_belt: "White", new_belt: "Yellow" });
await call("POST", "/api/belts", { name: "Sam Park", old_belt: "Yellow", new_belt: "Orange" });

// ---- no more coins
let mia = await owed("Mia Lee");
check("Rewards owed has no coin columns", !("large_coins_remaining" in mia) && !("small_coins_remaining" in mia), mia);
check("Mia is owed 10 Ninja Bucks", mia.ninja_bucks_remaining === 10, mia);
const summary = await call("GET", "/api/rewards/summary");
check("overall totals have no coins", !("large_coins" in summary.overall) && !("small_coins" in summary.overall), summary.overall);

// Give Ninja Bucks a few at a time: any amount up to what is owed works.
await call("POST", "/api/rewards/give", { names: ["Sam Park"], ninja_bucks: 7 });
let sam = await owed("Sam Park");
check("after 7 of 10 Ninja Bucks, 3 are owed", sam.ninja_bucks_remaining === 3, sam);
await call("POST", "/api/rewards/give", { names: ["Sam Park"], ninja_bucks: 3 });
sam = await owed("Sam Park");
check("the last 3 can be given", sam.ninja_bucks_remaining === 0, sam);
check("more than owed is refused",
  /only 0 remain/.test(await fails(call("POST", "/api/rewards/give", { names: ["Sam Park"], ninja_bucks: 1 })) || ""));
check("coin amounts are ignored, so nothing is given",
  (await fails(call("POST", "/api/rewards/give", { names: ["Mia Lee"], small_coins: 2 }))) === "No reward amounts were entered.");

// Old coin receipts stay in the history but change nothing.
conn.run("INSERT INTO receipts (date, name, reward_type, amount, details, entry_type) VALUES ('2026-01-01', 'Mia Lee', 'Small Coin', 4, '', 'Reward Given')");
mia = await owed("Mia Lee");
check("old Small Coin receipts don't change Ninja Bucks owed", mia.ninja_bucks_remaining === 10, mia);
check("old coin receipts are still listed in Rewards given",
  (await call("GET", "/api/rewards/history")).some((r) => r.reward_type === "Small Coin"));

// ---- certificates: printed is not given
check("two certificates to print for Mia",
  same((await call("GET", "/api/certificates/outstanding")).filter((c) => c.name === "Mia Lee").map((c) => c.belt), ["White", "Yellow"]));
const pdf = await call("POST", "/api/certificates/generate", { name: "Mia Lee", belts: ["White", "Yellow"] });
check("PDF made", pdf.count === 2 && pdf.bytes && pdf.bytes.length > 0);
check("printed ones leave the 'to print' list",
  !(await call("GET", "/api/certificates/outstanding")).some((c) => c.name === "Mia Lee"));
mia = await owed("Mia Lee");
check("printed certificates are still owed", mia.certificates_remaining === 2 && mia.certificates_printed === 2, mia);
let printed = await call("GET", "/api/certificates/printed");
check("both are waiting to be handed out", same(printed.map((c) => [c.name, c.belt]), [["Mia Lee", "White"], ["Mia Lee", "Yellow"]]), printed);
check("history says printed, not given",
  (await call("GET", "/api/rewards/history")).filter((r) => r.name === "Mia Lee" && /Certificate/.test(r.reward_type))
    .every((r) => r.reward_type === "Certificate Printed"));

// Mark one as handed out.
await call("POST", "/api/certificates/given", { items: [{ name: "Mia Lee", belt: "White" }] });
mia = await owed("Mia Lee");
check("one given, one still owed (printed)", mia.certificates_remaining === 1 && mia.certificates_printed === 1, mia);
printed = await call("GET", "/api/certificates/printed");
check("only Yellow still waiting", same(printed.map((c) => c.belt), ["Yellow"]), printed);
check("marking given needs a certificate", !!(await fails(call("POST", "/api/certificates/given", { items: [] }))));

// Give the other through Give Rewards: it is matched to the printed Yellow one.
await call("POST", "/api/rewards/give", { names: ["Mia Lee"], certificates: 1 });
mia = await owed("Mia Lee");
check("all Mia's certificates given", !mia || mia.certificates_remaining === 0, mia);
check("nothing waiting any more", (await call("GET", "/api/certificates/printed")).length === 0);
const given = (await call("GET", "/api/rewards/history")).filter((r) => r.name === "Mia Lee" && r.reward_type === "Certificate");
check("given certificates name their belt", same(given.map((r) => r.details).sort(), ["White Belt Certificate", "Yellow Belt Certificate"]), given);

// Giving a certificate that was never printed takes it off the 'to print' list too.
await call("POST", "/api/rewards/give", { names: ["Sam Park"], certificates: 1 });
check("Sam's White certificate is no longer to print",
  same((await call("GET", "/api/certificates/outstanding")).filter((c) => c.name === "Sam Park").map((c) => c.belt), ["Yellow"]));

// Certificates printed before this change were saved as "Certificate" and still count as given.
conn.run("INSERT INTO receipts (date, name, reward_type, amount, details, entry_type) VALUES ('2026-01-01', 'Sam Park', 'Certificate', 1, 'Yellow Belt Certificate', 'Certificate Printed')");
sam = await owed("Sam Park");
check("old printed certificates still count as given", !sam || sam.certificates_remaining === 0, sam);

// Remove ALL certificate records clears printed ones too.
await call("POST", "/api/certificates/generate", { name: "Sam Park", belts: ["Yellow"] });
const cleared = await call("POST", "/api/rewards/history/clear-certificates");
check("clear removes printed and given certificate records", cleared.deleted === 7 &&
  !(await call("GET", "/api/rewards/history")).some((r) => /Certificate/.test(r.reward_type)), cleared);

closeDatabase();
finish("Certificates + rewards without coins");
