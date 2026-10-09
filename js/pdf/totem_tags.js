// Totem tags - port of totem_tags.py. A grid of bordered tags (3 x 6 per US-Letter page),
// each with the ninja logo (assets/unnamed.png) and the Ninja's name.

import { loadAsset } from "../lib/assets.js";

const INCH = 72;
const COLUMNS = 3;
const ROWS_PER_PAGE = 6;
const MARGIN = 0.6 * INCH;
const CELL_WIDTH = 1.9685 * INCH;
const CELL_HEIGHT = 0.787402 * INCH;
const PAGE = [612, 792]; // letter, portrait

export async function generateTotemTagsPdf(names) {
  const cleaned = (names || []).map((n) => String(n).trim()).filter(Boolean);
  if (!cleaned.length) throw new Error("No names to print.");

  const { PDFDocument, StandardFonts, rgb } = globalThis.PDFLib;
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const logo = await out.embedPng(await loadAsset("assets/unnamed.png"));

  const ink = rgb(0x1c / 255, 0x22 / 255, 0x33 / 255);
  const border = rgb(0x33 / 255, 0x33 / 255, 0x33 / 255);
  const perPage = COLUMNS * ROWS_PER_PAGE;
  const logoBox = CELL_HEIGHT * 0.72;

  // Logo scaled to fit its square box, centred (keeps proportions).
  const scale = Math.min(logoBox / logo.width, logoBox / logo.height);
  const logoW = logo.width * scale;
  const logoH = logo.height * scale;

  for (let start = 0; start < cleaned.length; start += perPage) {
    const page = out.addPage(PAGE);
    cleaned.slice(start, start + perPage).forEach((name, i) => {
      const x = MARGIN + (i % COLUMNS) * CELL_WIDTH;
      const y = PAGE[1] - MARGIN - (Math.floor(i / COLUMNS) + 1) * CELL_HEIGHT;

      page.drawRectangle({ x, y, width: CELL_WIDTH, height: CELL_HEIGHT, borderColor: border, borderWidth: 1 });

      const logoX = x + 8;
      const logoY = y + (CELL_HEIGHT - logoBox) / 2;
      page.drawImage(logo, { x: logoX + (logoBox - logoW) / 2, y: logoY + (logoBox - logoH) / 2, width: logoW, height: logoH });

      let text = "";
      for (const ch of name) { try { font.encodeText(ch); text += ch; } catch (_) { text += "?"; } }
      page.drawText(text, { x: logoX + logoBox + 10, y: y + CELL_HEIGHT / 2 - 5, size: 15, font, color: ink });
    });
  }

  return { bytes: await out.save(), filename: "Ninja Totem Tags.pdf", count: cleaned.length };
}
