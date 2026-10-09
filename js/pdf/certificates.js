// Certificate PDFs - port of certificates.py using pdf-lib (window.PDFLib).
//
// Built from assets/certificate_template.pdf (one page per belt, {{NAME}} / {{DATE}}
// placeholders). For each certificate the belt's page is reused, the placeholder text
// is covered and the Ninja's name + date are drawn in the same spot, size and colour.
//
// Where the placeholders sit is read from data/certificate_layout.json. That file was
// produced from the template by tools/extract_layout.py - re-run it if you change the
// template design. Belts with no page in the template get a plain generated certificate.

import { loadAsset, loadJson } from "../lib/assets.js";
import { todayCertificateDate } from "../lib/util.js";

const BELT_COLORS = {
  white: "#FFFFFF", yellow: "#F5C518", orange: "#F07C1D", green: "#3EA043",
  blue: "#2C6FE0", purple: "#7B3FE4", brown: "#6B4226", red: "#D0342C",
  black: "#1A1A1A", bronze: "#8C5A2B", silver: "#B7B9BB", platinum: "#B7C4C8",
  gold: "#D4AF37",
};
const INK = "#1c2233";
const MUTED = "#6b7280";
const ACCENT = "#3b5bdb";
const INCH = 72;

let templateCache = null;

async function loadTemplate() {
  if (templateCache) return templateCache;
  try {
    const [bytes, layout] = await Promise.all([
      loadAsset("assets/certificate_template.pdf"),
      loadJson("data/certificate_layout.json"),
    ]);
    templateCache = { bytes, pages: layout.pages || {} };
  } catch (error) {
    templateCache = { bytes: null, pages: {} }; // everything falls back to plain certificates
  }
  return templateCache;
}

export function clearTemplateCache() { templateCache = null; }

function hex(PDFLib, value) {
  const n = parseInt(value.slice(1), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// pdf-lib's built-in fonts only cover Latin-1; replace anything else instead of failing.
function safeText(font, text) {
  let out = "";
  for (const ch of String(text).replace(/[\r\n\t]+/g, " ")) {
    try { font.encodeText(ch); out += ch; } catch (_) { out += "?"; }
  }
  return out;
}

// pdf-lib's own width helper includes kerning, but the text is drawn without it, which would
// shift centred text. Summing per-character widths matches how it is actually drawn
// (and how the original ReportLab version measured it).
function textWidth(font, text, size) {
  let total = 0;
  for (const ch of text) total += font.widthOfTextAtSize(ch, size);
  return total;
}

function centered(page, font, text, size, cx, y, color) {
  const t = safeText(font, text);
  page.drawText(t, { x: cx - textWidth(font, t, size) / 2, y, size, font, color });
}

function roundedRect(page, x, yBottom, w, h, r, color) {
  const path = `M ${r},0 H ${w - r} Q ${w},0 ${w},${r} V ${h - r} Q ${w},${h} ${w - r},${h} ` +
               `H ${r} Q 0,${h} 0,${h - r} V ${r} Q 0,0 ${r},0 Z`;
  page.drawSvgPath(path, { x, y: yBottom + h, color, borderWidth: 0 });
}

// ---- plain fallback certificate (used when the template has no page for a belt) ----
function drawPlain(PDFLib, page, fonts, name, belt, formattedDate) {
  const { width, height } = page.getSize();
  const beltColor = hex(PDFLib, BELT_COLORS[belt.toLowerCase()] || ACCENT);
  const margin = 0.5 * INCH;

  page.drawRectangle({ x: margin, y: margin, width: width - 2 * margin, height: height - 2 * margin,
    borderColor: hex(PDFLib, ACCENT), borderWidth: 3 });
  page.drawRectangle({ x: margin + 10, y: margin + 10, width: width - 2 * margin - 20, height: height - 2 * margin - 20,
    borderColor: beltColor, borderWidth: 1 });

  const barW = 2.2 * INCH;
  roundedRect(page, (width - barW) / 2, height - 2.15 * INCH, barW, 0.22 * INCH, 4, beltColor);

  const cx = width / 2;
  centered(page, fonts.bold, "CERTIFICATE OF ACHIEVEMENT", 30, cx, height - 1.55 * INCH, hex(PDFLib, INK));
  centered(page, fonts.regular, "Ninja Program", 14, cx, height - 1.9 * INCH, hex(PDFLib, MUTED));
  centered(page, fonts.regular, "This certificate is proudly presented to", 13, cx, height - 2.9 * INCH, hex(PDFLib, MUTED));
  centered(page, fonts.bold, name, 34, cx, height - 3.5 * INCH, hex(PDFLib, INK));
  centered(page, fonts.regular, "for earning the", 13, cx, height - 4.15 * INCH, hex(PDFLib, MUTED));
  centered(page, fonts.bold, `${belt.toUpperCase()} BELT`, 26, cx, height - 4.65 * INCH,
    belt.toLowerCase() !== "white" ? beltColor : hex(PDFLib, INK));

  centered(page, fonts.bold, formattedDate, 12, cx, margin + 0.55 * INCH, hex(PDFLib, INK));
  centered(page, fonts.regular, "Date Awarded", 10, cx, margin + 0.35 * INCH, hex(PDFLib, MUTED));

  const lineY = margin + 0.9 * INCH;
  const lineW = 2.2 * INCH;
  page.drawLine({ start: { x: cx - lineW / 2, y: lineY }, end: { x: cx + lineW / 2, y: lineY },
    thickness: 0.75, color: hex(PDFLib, MUTED) });
  centered(page, fonts.regular, "Instructor Signature", 9, cx, lineY - 12, hex(PDFLib, MUTED));
}

// ---- template certificate: cover the placeholders, draw the real text ----
function drawOverlay(PDFLib, page, layout, font, name, formattedDate) {
  const { rgb } = PDFLib;
  const n = layout.name, d = layout.date, box = layout.box;
  const white = rgb(1, 1, 1);
  const col = (c) => rgb(c[0], c[1], c[2]);

  let patchX0, patchX1, patchY0, patchY1, centerX, maxWidth;
  if (box) {
    patchX0 = Math.max(n.x0 - 4, box.x0 + 1.8);
    patchX1 = Math.min(n.x1 + 4, box.x1 - 1.8);
    // Braces hang below the text box; clear down to just inside the border.
    patchY0 = Math.max(n.bottom - 0.5 * n.size, box.y0 + 1.8);
    patchY1 = Math.min(n.top + 1, box.y1 - 1.8);
    centerX = (box.x0 + box.x1) / 2;
    maxWidth = (box.x1 - box.x0) - 30;
  } else {
    patchX0 = n.x0 - 4; patchX1 = n.x1 + 4;
    patchY0 = n.bottom - 0.25 * n.size; patchY1 = n.top + 1;
    centerX = (n.x0 + n.x1) / 2;
    maxWidth = (n.x1 - n.x0) * 1.6;
  }
  page.drawRectangle({ x: patchX0, y: patchY0, width: patchX1 - patchX0, height: patchY1 - patchY0, color: white });

  const text = safeText(font, name);
  let size = n.size;
  while (size > 12 && textWidth(font, text, size) > maxWidth) size -= 0.5;
  page.drawText(text, { x: centerX - textWidth(font, text, size) / 2, y: n.baseline, size, font, color: col(n.color) });

  // Date: cover only the text, never the rule underneath it.
  const rule = d.floor;
  const dateFloor = rule ? rule.y1 + 0.3 : d.bottom - 0.15 * d.size;
  page.drawRectangle({ x: d.x0 - 3, y: dateFloor, width: (d.x1 - d.x0) + 6, height: d.top + 1 - dateFloor, color: white });
  if (rule && rule.color) {
    // The rule is very thin; redraw it on top so no viewer can clip it.
    page.drawRectangle({ x: rule.x0, y: rule.y0, width: rule.x1 - rule.x0, height: rule.y1 - rule.y0, color: col(rule.color) });
  }
  const dateText = safeText(font, formattedDate);
  page.drawText(dateText, {
    x: (d.x0 + d.x1) / 2 - textWidth(font, dateText, d.size) / 2,
    y: d.baseline, size: d.size, font, color: col(d.color),
  });
}

/**
 * items: [{ name, belt }]  ->  { bytes: Uint8Array, filename }
 * One certificate per page.
 */
export async function generateCertificatesPdf(items, now = new Date()) {
  if (!items || !items.length) throw new Error("No certificates to generate.");
  const PDFLib = globalThis.PDFLib;
  const { PDFDocument, StandardFonts } = PDFLib;

  const formattedDate = todayCertificateDate(now);
  const template = await loadTemplate();

  const out = await PDFDocument.create();
  const fonts = {
    bold: await out.embedFont(StandardFonts.HelveticaBold),
    regular: await out.embedFont(StandardFonts.Helvetica),
  };

  let templateDoc = null;
  const embedded = new Map(); // belt page index -> embedded page (shared, keeps the file small)

  for (const item of items) {
    const name = String(item.name).trim();
    const belt = String(item.belt).trim();
    const layout = template.pages[belt.toLowerCase()];

    if (layout && template.bytes) {
      if (!templateDoc) templateDoc = await PDFDocument.load(template.bytes);
      if (!embedded.has(layout.index)) {
        const [pageEmbed] = await out.embedPdf(templateDoc, [layout.index]);
        embedded.set(layout.index, pageEmbed);
      }
      const page = out.addPage([layout.width, layout.height]);
      page.drawPage(embedded.get(layout.index));
      drawOverlay(PDFLib, page, layout, fonts.bold, name, formattedDate);
    } else {
      const page = out.addPage([792, 612]); // landscape letter
      drawPlain(PDFLib, page, fonts, name, belt, formattedDate);
    }
  }

  return { bytes: await out.save(), filename: `Ninja Certificates - ${formattedDate}.pdf` };
}
