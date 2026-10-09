"""
Re-reads assets/certificate_template.pdf and writes data/certificate_layout.json.

Run this ONLY when you replace the certificate template with a new design:

    pip install pdfplumber
    python tools/extract_layout.py

The template needs one page per belt, each with a "COMPLETION OF <COLOR> BELT."
line, a {{NAME}} placeholder inside a bordered box, and a {{DATE}} placeholder.
(This is the same detection the original Python app did on every run; the
browser version reads the saved result instead of re-analysing the PDF.)
"""

import io
import json
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "assets" / "certificate_template.pdf"
OUT = ROOT / "data" / "certificate_layout.json"

BELT_LINE_RE = re.compile(r"COMPLETION\s+OF\s+(.+?)\s+BELT", re.IGNORECASE)


def color_tuple(value, default):
    if isinstance(value, (list, tuple)) and len(value) == 3:
        return [float(v) for v in value]
    if isinstance(value, (list, tuple)) and len(value) == 1:
        return [float(value[0])] * 3
    return default


def find_placeholder(page, token):
    matches = page.search(re.escape(token), regex=True, case=False)
    if not matches:
        return None
    m = matches[0]
    chars = m.get("chars") or []
    first = chars[0] if chars else {}
    matrix = first.get("matrix")
    baseline = matrix[5] if matrix else page.height - m["bottom"] + 3
    return {
        "x0": m["x0"], "x1": m["x1"],
        "top": page.height - m["top"],
        "bottom": page.height - m["bottom"],
        "baseline": baseline,
        "size": first.get("size", 14),
        "color": color_tuple(first.get("non_stroking_color"), [0.13, 0.17, 0.31]),
    }


def find_name_box(page, info):
    if not info:
        return None
    cx = (info["x0"] + info["x1"]) / 2
    y_mid_top = page.height - (info["top"] + info["bottom"]) / 2
    for r in page.rects:
        if r["width"] > 200 and 25 < r["height"] < 120 \
                and r["x0"] < cx < r["x1"] and r["top"] < y_mid_top < r["bottom"]:
            return {"x0": r["x0"], "x1": r["x1"],
                    "y0": page.height - r["bottom"], "y1": page.height - r["top"]}
    return None


def find_line_below(page, info):
    text_bottom_pl = page.height - info["bottom"]
    cx = (info["x0"] + info["x1"]) / 2
    best = None
    for obj in list(page.images) + list(page.rects) + list(page.lines):
        height = obj.get("height", obj["bottom"] - obj["top"])
        if height <= 3 and obj["x0"] <= cx <= obj["x1"] and obj["width"] > 60 \
                and obj["top"] >= text_bottom_pl - 1:
            if best is None or obj["top"] < best["top"]:
                best = obj
    if best is None:
        return None
    color = best.get("non_stroking_color") if best.get("fill") else best.get("stroking_color")
    return {"x0": best["x0"], "x1": best["x1"],
            "y0": page.height - best["bottom"], "y1": page.height - best["top"],
            "color": color_tuple(color, None)}


def main():
    pages = {}
    with pdfplumber.open(io.BytesIO(TEMPLATE.read_bytes())) as pdf:
        for index, page in enumerate(pdf.pages):
            found = BELT_LINE_RE.search(page.extract_text() or "")
            if not found:
                continue
            belt_key = found.group(1).strip().lower()
            name_info = find_placeholder(page, "{{NAME}}")
            date_info = find_placeholder(page, "{{DATE}}")
            if not name_info or not date_info:
                continue
            date_info["floor"] = find_line_below(page, date_info)
            pages[belt_key] = {
                "index": index,
                "width": float(page.width), "height": float(page.height),
                "name": name_info, "date": date_info,
                "box": find_name_box(page, name_info),
            }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"pages": pages}, indent=2))
    print(f"Wrote {OUT} - belts found: {', '.join(pages) or 'none'}")
    if not pages:
        sys.exit("No belt pages were recognised in the template.")


if __name__ == "__main__":
    main()
