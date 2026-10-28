// A printable list of which belt each totem tag goes on: the Ninja's name exactly as it is on the
// tag, their belt and a colour swatch, in the same order as the tag sheets (left to right, then down).

import { tagName } from "./totem_tags.js";

const PAGE = [612, 792]; // letter, portrait
const MARGIN = 54;
const ROW = 22;
const TAGS_PER_SHEET = 18; // 3 x 6, see totem_tags.js

// Swatch colours for the usual belts; anything else gets an outlined empty box.
const BELT_COLOURS = {
  white: [1, 1, 1], yellow: [0.98, 0.84, 0.1], orange: [0.96, 0.55, 0.12], green: [0.2, 0.62, 0.3],
  blue: [0.2, 0.42, 0.85], purple: [0.5, 0.3, 0.7], brown: [0.48, 0.3, 0.16], red: [0.82, 0.16, 0.16],
  black: [0.08, 0.08, 0.08], bronze: [0.72, 0.45, 0.2], silver: [0.75, 0.75, 0.78],
  platinum: [0.86, 0.87, 0.9], gold: [0.85, 0.68, 0.13],
};

/**
 * rows: [{name, belt}] in the order to print. Returns {bytes, filename, count}.
 * tagSheets: true (after printing tags) adds a "Tag sheet N" heading every 18 names to match the paper.
 */
export async function generateBeltSheetPdf(rows, { date = "", tagSheets = true, title = "Totem Tag Belts" } = {}) {
  const list = (rows || []).filter((r) => String(r.name || "").trim());
  if (!list.length) throw new Error("No names to print.");

  const { PDFDocument, StandardFonts, rgb } = globalThis.PDFLib;
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0x1c / 255, 0x22 / 255, 0x33 / 255);
  const muted = rgb(0.42, 0.45, 0.5);
  const line = rgb(0.85, 0.87, 0.9);
  const safe = (f, text) => {
    let s = "";
    for (const ch of String(text)) { try { f.encodeText(ch); s += ch; } catch (_) { s += "?"; } }
    return s;
  };

  // Belt counts for the summary line, in the order belts are listed.
  const counts = new Map();
  for (const r of list) counts.set(r.belt || "", (counts.get(r.belt || "") || 0) + 1);
  const summary = [...counts].filter(([b]) => b).map(([b, n]) => `${b}: ${n}`);
  if (counts.get("")) summary.push(`Not recorded: ${counts.get("")}`);

  const colX = { num: MARGIN, name: MARGIN + 34, swatch: MARGIN + 290, belt: MARGIN + 310 };
  let page = null;
  let y = 0;
  let pageNo = 0;

  const newPage = () => {
    page = out.addPage(PAGE);
    pageNo += 1;
    y = PAGE[1] - MARGIN;
    if (pageNo === 1) {
      page.drawText(safe(bold, title), { x: MARGIN, y: y - 18, size: 20, font: bold, color: ink });
      if (date) page.drawText(safe(font, date), { x: PAGE[0] - MARGIN - font.widthOfTextAtSize(date, 11), y: y - 16, size: 11, font, color: muted });
      y -= 40;
      const sumText = safe(font, summary.join("   ·   "));
      page.drawText(sumText, { x: MARGIN, y, size: 10.5, font, color: muted, maxWidth: PAGE[0] - 2 * MARGIN });
      y -= 26;
    }
    page.drawText("#", { x: colX.num, y, size: 10, font: bold, color: muted });
    page.drawText(tagSheets ? "NAME ON TAG" : "NINJA", { x: colX.name, y, size: 10, font: bold, color: muted });
    page.drawText("BELT", { x: colX.swatch, y, size: 10, font: bold, color: muted });
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE[0] - MARGIN, y }, thickness: 1, color: line });
  };

  newPage();
  list.forEach((r, i) => {
    // A small heading where each printed tag sheet starts, so the list lines up with the paper.
    const sheetStart = tagSheets && i % TAGS_PER_SHEET === 0 && list.length > TAGS_PER_SHEET;
    const needed = ROW + (sheetStart ? ROW : 0);
    if (y - needed < MARGIN) newPage();
    if (sheetStart) {
      y -= ROW;
      page.drawText(`Tag sheet ${i / TAGS_PER_SHEET + 1}`, { x: MARGIN, y: y + 6, size: 11, font: bold, color: ink });
    }
    y -= ROW;
    const textY = y + 7;
    page.drawText(String(i + 1), { x: colX.num, y: textY, size: 12, font, color: muted });
    page.drawText(safe(font, tagName(r.name)), { x: colX.name, y: textY, size: 12, font, color: ink });

    const belt = String(r.belt || "").trim();
    const colour = BELT_COLOURS[belt.toLowerCase()];
    if (belt) {
      page.drawRectangle({
        x: colX.swatch, y: textY - 2, width: 12, height: 12,
        color: colour ? rgb(...colour) : undefined, borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 0.75,
      });
    }
    page.drawText(safe(belt ? bold : font, belt || "Not recorded"), { x: colX.belt, y: textY, size: 12, font: belt ? bold : font, color: belt ? ink : muted });
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE[0] - MARGIN, y }, thickness: 0.5, color: line });
  });

  return { bytes: await out.save(), filename: `${title}.pdf`, count: list.length };
}
