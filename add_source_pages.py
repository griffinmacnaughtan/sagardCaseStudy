"""Backfill `source_page` into portfolio_metrics.json + dashboard demo JSON.

The extraction pipeline (poc.py) concatenates all PDF pages before handing
them to the LLM, which is great for cross-page context but means the page
number is never persisted. For "View Source PDF" to open the viewer at the
exact page where a metric was found (rather than page 1), we need to
reverse-lookup each record post-hoc.

Strategy per record:
  1. Extract numeric tokens from raw_value (e.g. "$8.4M" -> ["8.4"]).
  2. Extract content words from raw_label (e.g. "Recognized Revenue").
  3. Score each page: +1 per numeric token present, +2 per label word.
  4. Return the highest-scoring page (earliest on ties).

Labels matter because raw numbers alone ("78", "142") collide across pages;
combining the label with the value is what gets us to the right page.

Runs standalone (no API key needed). Idempotent - rerun whenever the base
extraction output changes.
"""
import json
import re
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).parent
OUTPUT_JSON = ROOT / "output" / "portfolio_metrics.json"
PDF_DIR = ROOT / "pdfs"
DASHBOARD_JSON = ROOT / "dashboard" / "public" / "data" / "metrics.json"

# Very short / noisy label words that shouldn't contribute to scoring -
# they match too often and bias toward the first page they appear on.
STOPWORDS = {
    "the", "and", "for", "with", "from", "total", "net", "gross",
    "rate", "amount", "value", "period", "quarter", "ltm", "ttm",
}


def find_source_page(pdf_path: Path, raw_value: str, raw_label: str) -> int | None:
    """Return the 1-indexed page that most likely contains this record."""
    if not raw_value:
        return None

    # Numeric tokens: "$8.4M" -> ["8.4"]; "($0.75M)" -> ["0.75"]; "142" -> ["142"]
    nums = re.findall(r"\d+(?:\.\d+)?", raw_value.replace(",", ""))
    if not nums:
        return None

    # Label content words (length >= 4, not in stopwords)
    label_words = [
        w.lower()
        for w in re.findall(r"[A-Za-z]+", raw_label or "")
        if len(w) >= 4 and w.lower() not in STOPWORDS
    ]

    try:
        with pdfplumber.open(pdf_path) as pdf:
            best: tuple[int, int] | None = None  # (score, page_1indexed)
            for i, page in enumerate(pdf.pages):
                text = page.extract_text() or ""
                if not text:
                    continue
                text_clean = re.sub(r"[,\s]", "", text)
                text_lower = text.lower()

                num_hits = sum(1 for n in nums if n in text_clean)
                if num_hits == 0:
                    continue

                label_hits = sum(1 for w in label_words if w in text_lower)
                score = num_hits + label_hits * 2

                if best is None or score > best[0]:
                    best = (score, i + 1)

            return best[1] if best else None
    except Exception as e:
        print(f"  [WARN] couldn't open {pdf_path.name}: {e}")
        return None


def backfill(records: list[dict], pdf_dir: Path) -> tuple[int, int]:
    """Add source_page to each record in-place. Returns (filled, missed)."""
    filled = missed = 0
    # Cache per (source_file, raw_value, raw_label) to avoid re-scanning the
    # same PDF for the same value (common when the same metric repeats).
    cache: dict[tuple[str, str, str], int | None] = {}

    for r in records:
        src = r.get("source_file")
        if not src:
            continue
        pdf_path = pdf_dir / src
        if not pdf_path.exists():
            # Synthetic demo records (WealthSimple) - no PDF on disk.
            continue

        key = (src, r.get("raw_value", ""), r.get("raw_label", ""))
        if key not in cache:
            cache[key] = find_source_page(pdf_path, r.get("raw_value", ""), r.get("raw_label", ""))

        page = cache[key]
        if page is not None:
            r["source_page"] = page
            filled += 1
        else:
            missed += 1

    return filled, missed


def main():
    if not OUTPUT_JSON.exists():
        print(f"ERROR: {OUTPUT_JSON} not found. Run poc.py first.")
        return

    print(f"[1] Loading {OUTPUT_JSON}")
    records = json.loads(OUTPUT_JSON.read_text())
    print(f"    {len(records)} records")

    print(f"[2] Scanning PDFs in {PDF_DIR}")
    filled, missed = backfill(records, PDF_DIR)
    print(f"    Filled source_page on {filled} records ({missed} couldn't be located)")

    print(f"[3] Writing back to {OUTPUT_JSON}")
    OUTPUT_JSON.write_text(json.dumps(records, indent=2, default=str))

    # Rebuild the dashboard demo JSON so the UI sees source_page.
    # Preserves any existing _demo records (WealthSimple) and their
    # hand-authored source_page values if present.
    if DASHBOARD_JSON.exists():
        print(f"[4] Merging into {DASHBOARD_JSON}")
        demo = json.loads(DASHBOARD_JSON.read_text())
        demo_extras = [r for r in demo if r.get("_demo")]
        merged = records + demo_extras
        DASHBOARD_JSON.write_text(json.dumps(merged, indent=2, default=str))
        print(f"    {len(merged)} records ({len(records)} real + {len(demo_extras)} demo)")
    else:
        print(f"[4] {DASHBOARD_JSON} not found - skipping dashboard refresh")


if __name__ == "__main__":
    main()
