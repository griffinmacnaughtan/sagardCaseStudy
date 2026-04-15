"""
Portfolio Metrics Extraction - Sagard FDE Technical Challenge

Griffin MacNaughtan, April 2026

Extracts key financial and operating metrics from portfolio company PDF
reports and organises them for cross-company review by investor teams.

Uses pdfplumber for text extraction and the Claude API for structured
metric extraction.

Usage:
    python poc.py <pdf_folder>               # process all PDFs in folder
    python poc.py <single_file.pdf>           # process a single PDF

Outputs (written to ./output/):
    portfolio_metrics.json   - long-format records with full metadata
    portfolio_metrics.csv    - wide-format pivot for spreadsheet review
    extraction_log.json      - per-PDF extraction log and warnings
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import anthropic
import pandas as pd
import pdfplumber
from dotenv import load_dotenv

# Load ANTHROPIC_API_KEY from a .env file sitting next to this script.
# A demo key is shipped in .env for reviewer convenience. It belongs to an
# isolated, rate-limited workspace.

load_dotenv(Path(__file__).parent / ".env")

OUTPUT_DIR = Path(__file__).parent / "output"

# The 8 metrics extracted. Chosen for relevance to a growth-stage portfolio
TARGET_METRICS = [
    "revenue",
    "arr",
    "gross_margin",
    "net_retention",
    "churn",
    "headcount",
    "cash",
    "burn",
]

# Entity resolution - only needed for the FleetLink/Apex Freight rebrand and
# cases where the LLM returns a legal name instead of the short name.
# The partial-match fallback in resolve_entity() handles minor variants
# (e.g. "NovaCloud Analytics Inc." still contains "novacloud").

ENTITY_ALIASES = {
    # Rebrand: FleetLink became Apex Freight in Q2 2025
    "apex freight solutions inc.": "FleetLink / Apex Freight",
    "apex freight solutions": "FleetLink / Apex Freight",
    "apex freight": "FleetLink / Apex Freight",
    "fleetlink logistics network": "FleetLink / Apex Freight",
    "fleetlink": "FleetLink / Apex Freight",
    # Short canonical names for legal-name variants
    "novacloud analytics": "NovaCloud",
    "lendbridge capital": "LendBridge",
    "medisight data platform": "MediSight",
    "carbontrack analytics": "CarbonTrack",
    "clearpay technologies": "ClearPay",
    "constructiq solutions": "ConstructIQ",
    "peopleflow hr systems": "PeopleFlow",
    "talentvault inc.": "TalentVault",
}

# This is the core of the extraction approach. The prompt defines the target
# metrics, their known aliases, and the output schema. The LLM acts as a
# semantic parser - it handles label normalisation, finds values in tables,
# and footnotes, and returns structured JSON.

EXTRACTION_PROMPT = """You are a financial data extraction assistant. Given a portfolio company's quarterly report, extract the following 8 metrics. Look in tables, prose commentary, AND footnotes.

The document is split into pages marked `[PAGE N]`. When you extract a value, record which page you found it on so reviewers can trace back to the source.

TARGET METRICS:
1. revenue - Quarterly recognised revenue. Look for: Recognized Revenue, Net Revenue, Quarterly Revenue, Total Recognized Revenue, Gross Transaction Revenue, Total Billings, Platform Revenue. If both component revenue and a total are reported, use the TOTAL.
2. arr - Annual Recurring Revenue at period end. Look for: ARR, Contracted ARR, Subscription ARR, Annual Recurring Revenue.
3. gross_margin - Gross Margin percentage.
4. net_retention - Net revenue/dollar retention rate. Look for: Net Dollar Retention, NRR, Net Revenue Retention, NDR, Net Pound Retention. Usually on LTM basis.
5. churn - Customer/logo churn or credit loss rate. Look for: Logo Churn, Net Charge-off Rate, Credit Loss Rate.
6. headcount - Total employees. Look for: Total Headcount, FTE, Headcount.
7. cash - Cash balance. Look for: Cash Balance, Cash & Equivalents. IMPORTANT: If the report separates restricted/segregated cash from available operating cash, use the AVAILABLE/OPERATING amount only.
8. burn - Net burn rate. Look for: Monthly Net Burn, Quarterly Net Burn, Monthly Cash Burn. Indicate whether the reported value is monthly or quarterly in the notes field.

RULES:
- Return the raw value as it appears in the document (e.g. "$8.4M", "78%", "($0.75M)", "142")
- Include the exact label used in the document in raw_label
- Indicate source: "table", "commentary", or "footnote"
- Set source_page to the [PAGE N] number where the value actually appears. If the same value repeats on multiple pages (summary + detail table), pick the page with the primary table/line-item - the one an analyst would cite. Omit the field if you genuinely can't tell.
- The `period` field must be a calendar quarter in the exact form `QN YYYY` (e.g. "Q2 2025"). If a metric is reported on an LTM/TTM/YTD basis, put that in `notes` - do NOT prefix or suffix the period with LTM/TTM/YTD.
- If a metric is not present, omit it entirely. Do NOT guess or infer.
- For multi-company documents (e.g. a portfolio snapshot), return separate entries per company
- Note the reporting currency if it is not USD

Return ONLY valid JSON in this exact format:
{{"companies": [{{"company_name": "...", "reporting_period": "Q2 2025", "reporting_currency": "USD", "metrics": [{{"metric": "revenue", "value": "$8.4M", "raw_label": "Recognized Revenue (USD)", "source": "table", "source_page": 2, "period": "Q2 2025", "notes": ""}}]}}]}}

DOCUMENT TEXT:
---
{pdf_text}
---"""

# 1 - PDF Discovery

def discover_pdfs(folder: Path, single_file: Path = None) -> list[dict]:
    if single_file:
        files = [single_file]
    else:
        files = sorted(folder.glob("*.pdf"))

    pdfs = []
    for f in files:
        info = {"path": f, "filename": f.name}

        # Parse "CompanyName_Q2_2025.pdf" -> quarter, year
        match = re.match(r"^(.+?)_(Q[1-4])_(\d{4})\.pdf$", f.name)
        if match:
            info["file_period"] = f"{match.group(2)} {match.group(3)}"
        else:
            info["file_period"] = None

        info["is_snapshot"] = "Snapshot" in f.name
        pdfs.append(info)

    return pdfs

# 2 - Text Extraction from pdf using pdfplumber

def extract_text(pdf_path: Path) -> str:
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                pages.append(text)
    return "\n\n".join(pages)


def extract_pages(pdf_path: Path) -> list[str]:
    """Return per-page text so we can back-reference which page each metric
    came from. We still feed the concatenated text to the LLM (cross-page
    context matters), but we need this split to persist `source_page`."""
    out: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            out.append(page.extract_text() or "")
    return out


# Stopwords that shouldn't contribute to page-scoring - they're too common
# and bias the match toward whichever page happens to use them first.
_PAGE_LOOKUP_STOPWORDS = {
    "the", "and", "for", "with", "from", "total", "net", "gross",
    "rate", "amount", "value", "period", "quarter", "ltm", "ttm",
}


def locate_page(pages: list[str], raw_value: str, raw_label: str) -> int | None:
    """Return the 1-indexed page that best matches `raw_value` + `raw_label`.

    Scoring: +1 per numeric token present, +2 per label content word (len>=4,
    not a stopword). Numbers alone aren't enough - "78" collides across pages -
    so the label words are what disambiguate between candidates. Ties go to
    the earliest page (reports put totals up front)."""
    if not raw_value or not pages:
        return None
    nums = re.findall(r"\d+(?:\.\d+)?", raw_value.replace(",", ""))
    if not nums:
        return None
    label_words = [
        w.lower()
        for w in re.findall(r"[A-Za-z]+", raw_label or "")
        if len(w) >= 4 and w.lower() not in _PAGE_LOOKUP_STOPWORDS
    ]

    best: tuple[int, int] | None = None  # (score, page_1indexed)
    for i, text in enumerate(pages):
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

# 3 - LLM-Assisted Extraction. Claude API for semantic parsing

def extract_with_llm(pdf_text: str, client: anthropic.Anthropic) -> dict | None:
    prompt = EXTRACTION_PROMPT.format(pdf_text=pdf_text)

    try:
        message = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=4096,
            temperature=0,  # deterministic output for structured extraction
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as e:
        print(f" [ERROR] API call failed: {e}")
        return None

    try:
        response_text = message.content[0].text
    except (IndexError, AttributeError):
        print(" [ERROR] Unexpected API response format")
        return None

    # Parse JSON from response
    try:
        result = json.loads(response_text)
    except json.JSONDecodeError:
        # Try to extract JSON block if the model wrapped it in markdown
        json_match = re.search(r"\{.*\}", response_text, re.DOTALL)
        if json_match:
            result = json.loads(json_match.group())
        else:
            print(f" [ERROR] Failed to parse LLM response")
            return None

    return result

# 3b - Smoke Test (Check that each extracted value actually appears in the source PDF)
# Values that can't be verified are removed and added as "warning" values in 

def validate_extraction(llm_result: dict, source_text: str) -> tuple[list[str], int]:
    warnings = []
    dropped = 0
    text_clean = re.sub(r"[,\s]", "", source_text)

    def number_in_text(n: str) -> bool:
        # Accept the number and its trailing-zero variants: "8.4" / "8.40", "78" / "78.0"
        variants = {n}
        if "." in n:
            variants.add(n.rstrip("0").rstrip("."))
        else:
            variants.add(n + ".0")
        variants.add(n + "0")
        return any(v and v in text_clean for v in variants)

    for company in llm_result.get("companies", []):
        name = company.get("company_name", "")
        for m in company.get("metrics", []):
            raw = str(m.get("value", ""))
            # Pull all numeric tokens out of the value ("$8.4M" -> ["8.4"], "($0.75M)" -> ["0.75"])
            nums = re.findall(r"\d+(?:\.\d+)?", raw.replace(",", ""))

            if nums and all(number_in_text(n) for n in nums):
                m["_status"] = "extracted"
                m["_warnings"] = []
            else:
                m["_status"] = "dropped"
                m["_warnings"] = [{
                    "type": "grounding_failed",
                    "detail": f'value "{raw}" not found in source text',
                }]
                warnings.append(
                    f"  [WARN] {name} - {m.get('metric')}: \"{raw}\" not found in source text (kept with status=dropped)"
                )
                dropped += 1

    return warnings, dropped

# 4 - Normalisation & Entity Resolution (Maps to standard or canonical portfolio names)

def resolve_entity(name: str) -> str:
    lower = name.lower().strip()
    if lower in ENTITY_ALIASES:
        return ENTITY_ALIASES[lower]
    # Partial match for variants we haven't seen
    for alias, canonical in ENTITY_ALIASES.items():
        if alias in lower:
            return canonical
    return name

# Need numbers, not strings for work with csv
def parse_numeric(value_str: str) -> tuple[float | None, str]:
    if not value_str:
        return None, ""

    s = str(value_str).strip()

    # Strip outer parentheses for unit detection - handles "($0.75M)"
    s_inner = re.sub(r"^\((.+)\)$", r"\1", s).strip()

    unit = ""
    if s_inner.endswith("%"):
        unit = "%"
    elif "bps" in s_inner.lower():
        unit = "bps"
    elif s_inner.upper().endswith("B"):
        unit = "B"
    elif s_inner.upper().endswith("M"):
        unit = "M"
    elif s_inner.upper().endswith("K"):
        unit = "k"
    elif "months" in s_inner.lower():
        unit = "months"

    # Strip currency symbols, commas, units for numeric parsing
    cleaned = re.sub(r"[~$£€,]", "", s)
    cleaned = re.sub(r"(M|B|K|bps|months)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.replace("%", "").strip()

    # Handle parenthetical negatives: ($0.75) -> -0.75
    paren_match = re.match(r"^\((.+)\)$", cleaned)
    if paren_match:
        cleaned = "-" + paren_match.group(1)

    try:
        return float(cleaned), unit
    except (ValueError, TypeError):
        return None, ""


def normalize_burn_to_monthly(value: float, raw_label: str) -> tuple[float, str]:
    label_lower = (raw_label or "").lower()
    if "quarterly" in label_lower or ("quarter" in label_lower and "monthly" not in label_lower):
        return round(value / 3, 2), "converted from quarterly to monthly"
    return value, ""

# Converts raw results into normalized records, flattened into one row per metric for csv
def build_records(extraction_results: list[dict]) -> list[dict]:
    records = []

    for item in extraction_results:
        company = item["company"]
        currency = item["currency"]
        source_file = item["source_file"]
        pages = item.get("pages") or []

        for m in item["metrics"]:
            metric_name = m.get("metric", "")
            if metric_name not in TARGET_METRICS:
                continue

            raw_value = m.get("value", "")
            numeric, unit = parse_numeric(raw_value)
            notes = m.get("notes", "")
            status = m.get("_status", "extracted")
            warnings_for_record = list(m.get("_warnings", []))

            if status == "dropped":
                numeric = None

            # Normalise burn to monthly (only for values we trust)
            if metric_name == "burn" and numeric is not None:
                numeric, burn_note = normalize_burn_to_monthly(
                    numeric, m.get("raw_label", "")
                )
                if burn_note:
                    notes = f"{notes}; {burn_note}" if notes else burn_note
                # Ensure burn is negative (represents cash outflow)
                if numeric > 0:
                    numeric = -numeric

            # Page lookup: where in the PDF did this value come from? Enables
            # the dashboard's "View Source PDF" button to jump to the exact
            # page + search-highlight the raw value.
            #
            # Prefer the LLM's own source_page (it saw the [PAGE N] markers and
            # picked the primary citation) - fall back to the heuristic scorer
            # only when the LLM didn't return one or returned something invalid.
            source_page = None
            llm_page = m.get("source_page")
            if isinstance(llm_page, int) and 1 <= llm_page <= len(pages):
                source_page = llm_page
            elif pages:
                source_page = locate_page(pages, raw_value, m.get("raw_label", ""))

            # Normalise the period to a calendar quarter. LLMs occasionally decorate
            # LTM/TTM metrics with qualifiers (e.g. "LTM Q2 2025") - the LTM-ness
            # belongs in notes, not as a distinct quarter key, otherwise the quarter
            # filter would split that metric off its own company's timeline.
            raw_period = m.get("period", item.get("period", ""))
            q_match = re.search(r"Q[1-4]\s*\d{4}", raw_period or "")
            period = q_match.group(0).replace("  ", " ") if q_match else raw_period

            records.append({
                "company": company,
                "quarter": period,
                "metric": metric_name,
                "value": numeric,
                "unit": unit,
                "currency": currency,
                "raw_value": raw_value,
                "raw_label": m.get("raw_label", ""),
                "source": m.get("source", ""),
                "status": status,
                "warnings": warnings_for_record,
                "notes": notes,
                "source_file": source_file,
                "source_page": source_page,
            })

    return records

# When both standalone and snapshot values are present for the same company, 
# lean to the standalone as it will have more detail, or values can be cross validated if they are equivalent

def deduplicate_records(records: list[dict]) -> tuple[list[dict], int, int]:
    groups = defaultdict(list)
    for r in records:
        key = (r["company"], r["quarter"], r["metric"])
        groups[key].append(r)

    deduped = []
    cross_validated = 0
    warned = 0

    for key, group in groups.items():
        if len(group) == 1:
            deduped.append(group[0])
            continue

        standalone = [r for r in group if "Snapshot" not in r["source_file"]]
        snapshots = [r for r in group if "Snapshot" in r["source_file"]]

        if standalone:
            chosen = standalone[0]
            if snapshots:
                snap = snapshots[0]
                # Only compare when both sides have a parsed numeric value -
                # otherwise the grounding stage has already handled it.
                if chosen["value"] is not None and snap["value"] is not None:
                    if chosen["value"] == snap["value"]:
                        note = "cross-validated with Portfolio Snapshot"
                        chosen["notes"] = f"{chosen['notes']}; {note}" if chosen["notes"] else note
                        cross_validated += 1
                    else:
                        # Real disagreement. Keep the standalone (more detail)
                        # but flag it so a reviewer knows to look.
                        if chosen["status"] == "extracted":
                            chosen["status"] = "warned"
                            warned += 1
                        chosen["warnings"].append({
                            "type": "snapshot_disagreement",
                            "detail": (
                                f"standalone reports {chosen['raw_value']}; "
                                f"portfolio snapshot reports {snap['raw_value']}"
                            ),
                        })
            deduped.append(chosen)
        else:
            deduped.append(group[0])

    return deduped, cross_validated, warned

# 5 - Output

# Numeric values back to string for readable outputs
def format_display_value(row: dict) -> str:
    v, u, c = row.get("value"), row.get("unit", ""), row.get("currency", "USD")
    if v is None:
        return ""
    if u == "%":
        return f"{v}%"
    elif u in ("M", "B", "k"):
        prefix = f"{c} " if c != "USD" else "$"
        return f"{prefix}{v}{u}"
    elif u == "bps":
        return f"{v} bps"
    return str(v)


def write_outputs(records: list[dict], log_entries: list[dict]):
    OUTPUT_DIR.mkdir(exist_ok=True)

    # Long-format JSON (canonical output for future downstream use)
    json_path = OUTPUT_DIR / "portfolio_metrics.json"
    with open(json_path, "w") as f:
        json.dump(records, f, indent=2, default=str)
    print(f"\n  Written: {json_path}")

    # CSV
    if records:
        pivot_records = [r for r in records if r.get("status") != "dropped"]
        if pivot_records:
            df = pd.DataFrame(pivot_records)
            df["display"] = df.apply(format_display_value, axis=1)

            pivot = df.pivot_table(
                index=["company", "quarter"],
                columns="metric",
                values="display",
                aggfunc="first",
            )
            col_order = [c for c in TARGET_METRICS if c in pivot.columns]
            pivot = pivot[col_order].sort_index()

            # Aggregate warnings per (company, quarter) into a single column.
            # Sourced from ALL records including dropped ones, so a reviewer
            # sees grounding failures in the same place as kept-but-warned.
            warning_map: dict[tuple, list[str]] = {}
            for r in records:
                if r.get("warnings"):
                    key = (r["company"], r["quarter"])
                    parts = warning_map.setdefault(key, [])
                    for w in r["warnings"]:
                        detail = w.get("detail") or w.get("type", "")
                        parts.append(f"{r['metric']}: {detail}")

            pivot["warnings"] = [
                "; ".join(warning_map.get(idx, [])) for idx in pivot.index
            ]

            csv_path = OUTPUT_DIR / "portfolio_metrics.csv"
            pivot.to_csv(csv_path)
            print(f"  Written: {csv_path}")

    # Extraction log
    log_path = OUTPUT_DIR / "extraction_log.json"
    with open(log_path, "w") as f:
        json.dump(log_entries, f, indent=2)
    print(f"  Written: {log_path}")

# Summary for latest quarter
def print_summary(records: list[dict], cross_validated: int, warned: int):
    if not records:
        print("\n  No records extracted.")
        return

    df = pd.DataFrame(records)

    # Find the most recent quarter in the data
    def quarter_sort_key(q):
        parts = q.split()
        if len(parts) == 2 and parts[0].startswith("Q"):
            return (int(parts[1]), int(parts[0][1]))
        return (0, 0)

    quarters = sorted(df["quarter"].dropna().unique(), key=quarter_sort_key)
    if not quarters:
        print("\n  No quarterly data found.")
        return
    latest_q = quarters[-1]
    # Exclude dropped records - they're preserved in the JSON for audit but
    # shouldn't appear in the portfolio overview or inflate the value count.
    latest = df[(df["quarter"] == latest_q) & (df["status"] != "dropped")].copy()

    if latest.empty:
        print(f"\n  No data found for {latest_q}.")
        return

    latest["display"] = latest.apply(format_display_value, axis=1)

    pivot = latest.pivot_table(
        index="company", columns="metric", values="display", aggfunc="first",
    )
    col_order = [c for c in TARGET_METRICS if c in pivot.columns]
    pivot = pivot[col_order].sort_index().fillna("-")

    col_names = {
        "revenue": "Revenue", "arr": "ARR", "gross_margin": "Gross Margin",
        "net_retention": "Net Retention", "churn": "Churn",
        "headcount": "Headcount", "cash": "Cash", "burn": "Burn (mo.)",
    }
    pivot = pivot.rename(columns=col_names)

    print(f"\n{'=' * 100}")
    print(f"  PORTFOLIO OVERVIEW - {latest_q}")
    print(f"{'=' * 100}")
    print()
    print(pivot.to_string())
    print()
    print(f"  {len(latest['company'].unique())} companies  |  {len(latest)} values  |  {cross_validated} cross-validated  |  {warned} warned")
    non_usd = latest[latest["currency"] != "USD"][["company", "currency"]].drop_duplicates()
    if not non_usd.empty:
        notes = "; ".join(f"{r['company']} reports in {r['currency']}" for _, r in non_usd.iterrows())
        print(f"  Note: {notes}. All others in USD.")
    print(f"{'=' * 100}")

# Main Pipeline

def main():
    parser = argparse.ArgumentParser(
        description="Extract portfolio metrics from PDF reports."
    )
    parser.add_argument("pdf_folder", help="Path to folder containing PDF reports (or a single PDF file)")
    args = parser.parse_args()

    pdf_path = Path(args.pdf_folder)
    if not pdf_path.exists():
        print(f"Error: path not found: {pdf_path}")
        sys.exit(1)

    # 1 - Discover PDFs (supports single file or folder)
    print("\n[1] Discovering PDFs...")
    if pdf_path.is_file() and pdf_path.suffix.lower() == ".pdf":
        pdfs = discover_pdfs(pdf_path.parent, single_file=pdf_path)
    else:
        pdfs = discover_pdfs(pdf_path)
    print(f"  Found {len(pdfs)} report PDFs")
    for p in pdfs:
        tag = " [SNAPSHOT]" if p["is_snapshot"] else ""
        print(f"    {p['filename']}{tag}")

    # 2 - Extract text (concatenated + per-page; per-page feeds source_page lookup)
    print("\n[2] Extracting text from PDFs...")
    for p in pdfs:
        try:
            p["pages"] = extract_pages(p["path"])
            p["text"] = "\n\n".join(pg for pg in p["pages"] if pg)
            print(f"    {p['filename']}: {len(p['text']):,} chars, {len(p['pages'])} pages")
        except Exception as e:
            print(f"    {p['filename']}: FAILED ({e})")
            p["text"] = ""
            p["pages"] = []

    # 3 - LLM-assisted metric extraction
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("\n  Error: ANTHROPIC_API_KEY not set.")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key, max_retries=6)

    print("\n[3] Extracting metrics via LLM...")
    extraction_results = []
    log_entries = []

    def _process_pdf(p):
        """Extract and validate a single PDF. Returns (extraction_items, log_entry)."""
        filename = p["filename"]
        pages = p.get("pages", [])
        # Feed page-marked text to the LLM so it can return source_page per
        # metric directly (the clean fix - no heuristic scoring needed).
        # If per-page extraction wasn't available, fall back to the concatenated
        # blob - the post-hoc locate_page() heuristic still runs as a safety net.
        if pages:
            text = "\n\n".join(f"[PAGE {i+1}]\n{pg}" for i, pg in enumerate(pages) if pg)
        else:
            text = p.get("text", "")

        llm_result = extract_with_llm(text, client)
        if not llm_result:
            return [], {
                "filename": filename, "status": "no_result", "metrics_extracted": 0,
            }

        total_before = sum(len(c.get("metrics", [])) for c in llm_result.get("companies", []))
        validation_warnings, dropped = validate_extraction(llm_result, text)

        items = []
        for company_data in llm_result.get("companies", []):
            raw_name = company_data.get("company_name", "")
            company = resolve_entity(raw_name)
            currency = company_data.get("reporting_currency", "USD")
            period = company_data.get("reporting_period", p.get("file_period", ""))
            metrics = company_data.get("metrics", [])

            items.append({
                "company": company,
                "currency": currency,
                "period": period,
                "source_file": filename,
                "pages": p.get("pages", []),
                "metrics": metrics,
            })

        verified_count = total_before - dropped
        log_entry = {
            "filename": filename,
            "status": "extracted",
            "companies": [c.get("company_name") for c in llm_result.get("companies", [])],
            "metrics_extracted": verified_count,
            "metrics_dropped": dropped,
            "metrics_list": [
                m.get("metric")
                for c in llm_result.get("companies", [])
                for m in c.get("metrics", [])
            ],
            "validation_warnings": validation_warnings,
        }
        return items, log_entry

    # Process PDFs in parallel (I/O-bound LLM calls benefit from threading)
    max_workers = min(5, len(pdfs))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_process_pdf, p): p for p in pdfs}
        for future in as_completed(futures):
            p = futures[future]
            filename = p["filename"]
            try:
                items, log_entry = future.result()
                extraction_results.extend(items)
                log_entries.append(log_entry)
                count = log_entry.get("metrics_extracted", 0)
                dropped = log_entry.get("metrics_dropped", 0)
                status = "no data" if log_entry["status"] == "no_result" else f"{count} metrics"
                if dropped:
                    status += f" ({dropped} dropped)"
                print(f"    {filename}... {status}")
            except Exception as e:
                print(f"    {filename}... ERROR: {e}")
                log_entries.append({
                    "filename": filename, "status": "error", "metrics_extracted": 0,
                })

    # 4: Normalise, resolve entities, deduplicate
    print("\n[4] Normalising and deduplicating...")
    records = build_records(extraction_results)
    print(f"  {len(records)} raw records")
    records, cross_validated, warned = deduplicate_records(records)
    print(f"  {len(records)} after deduplication ({cross_validated} cross-validated, {warned} warned)")

    # 5: Write outputs
    print("\n[5] Writing outputs...")
    write_outputs(records, log_entries)

    # Summary
    print_summary(records, cross_validated, warned)

if __name__ == "__main__":
    main()
