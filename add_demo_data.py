"""Add WealthSimple sample company to demo data (not real extraction output).

Also copies the canonical pipeline artifacts into dashboard/public/data/ so
demo mode serves the *actual* files the pipeline produces (byte-identical),
not a reconstruction - that's the whole point of "demo = snapshot of a real
run." The CSV in particular is what an analyst would hand to someone else;
serving anything but the pipeline's own output would be lying about provenance.
"""
import json
import shutil
from pathlib import Path

data = json.load(open("output/portfolio_metrics.json"))

# Plausible page locations for each metric in a typical quarterly deck -
# cosmetic only (the _demo guard short-circuits the PDF open), but keeps the
# schema consistent with the real records and renders a "p. N" in the UI.
_DEMO_METRIC_PAGES = {
    "revenue": 2, "arr": 2, "gross_margin": 3, "net_retention": 3,
    "churn": 4, "headcount": 5, "cash": 4, "burn": 4,
}


def rec(quarter, metric, value, unit, raw_value, raw_label, notes="", source_file=None):
    if source_file is None:
        q_parts = quarter.replace(" ", "_")
        source_file = f"WealthSimple_{q_parts}.pdf"
    return {
        "company": "WealthSimple",
        "quarter": quarter,
        "metric": metric,
        "value": value,
        "unit": unit,
        "currency": "CAD",
        "raw_value": raw_value,
        "raw_label": raw_label,
        "source": "table",
        "status": "extracted",
        "warnings": [],
        "notes": notes,
        "source_file": source_file,
        "source_page": _DEMO_METRIC_PAGES.get(metric),
        # Flag picked up by the dashboard to render a DEMO badge next to the company row.
        "_demo": True,
    }

# 5 quarters, all 8 metrics - a compelling fintech growth story
ws = [
    # Q2 2024
    rec("Q2 2024", "revenue", 22.1, "M", "C$22.1M", "Net Revenue", "Includes transaction fees, subscription revenue, and interchange"),
    rec("Q2 2024", "arr", 88.4, "M", "C$88.4M", "Annual Recurring Revenue"),
    rec("Q2 2024", "gross_margin", 62.0, "%", "62%", "Gross Margin"),
    rec("Q2 2024", "net_retention", 108.0, "%", "108%", "Net Dollar Retention (LTM)", "LTM basis"),
    rec("Q2 2024", "churn", 4.2, "%", "4.2%", "Logo Churn (LTM)", "LTM basis"),
    rec("Q2 2024", "headcount", 890.0, "", "890", "Total Headcount"),
    rec("Q2 2024", "cash", 145.0, "M", "C$145M", "Cash & Equivalents", "Excludes client assets under administration"),
    rec("Q2 2024", "burn", -2.1, "M", "(C$2.1M)", "Monthly Net Burn", "Monthly figure"),
    # Q3 2024
    rec("Q3 2024", "revenue", 24.8, "M", "C$24.8M", "Net Revenue"),
    rec("Q3 2024", "arr", 96.2, "M", "C$96.2M", "Annual Recurring Revenue"),
    rec("Q3 2024", "gross_margin", 64.0, "%", "64%", "Gross Margin"),
    rec("Q3 2024", "net_retention", 111.0, "%", "111%", "Net Dollar Retention (LTM)", "LTM basis"),
    rec("Q3 2024", "churn", 3.8, "%", "3.8%", "Logo Churn (LTM)"),
    rec("Q3 2024", "headcount", 920.0, "", "920", "Total Headcount"),
    rec("Q3 2024", "cash", 138.0, "M", "C$138M", "Cash & Equivalents"),
    rec("Q3 2024", "burn", -1.8, "M", "(C$1.8M)", "Monthly Net Burn", "Monthly figure"),
    # Q4 2024
    rec("Q4 2024", "revenue", 27.5, "M", "C$27.5M", "Net Revenue"),
    rec("Q4 2024", "arr", 105.8, "M", "C$105.8M", "Annual Recurring Revenue"),
    rec("Q4 2024", "gross_margin", 66.5, "%", "66.5%", "Gross Margin"),
    rec("Q4 2024", "net_retention", 114.0, "%", "114%", "Net Dollar Retention (LTM)", "LTM basis"),
    rec("Q4 2024", "churn", 3.5, "%", "3.5%", "Logo Churn (LTM)"),
    rec("Q4 2024", "headcount", 955.0, "", "955", "Total Headcount"),
    rec("Q4 2024", "cash", 132.0, "M", "C$132M", "Cash & Equivalents"),
    rec("Q4 2024", "burn", -1.4, "M", "(C$1.4M)", "Monthly Net Burn", "Monthly figure; approaching breakeven"),
    # Q1 2025
    rec("Q1 2025", "revenue", 30.2, "M", "C$30.2M", "Net Revenue"),
    rec("Q1 2025", "arr", 118.4, "M", "C$118.4M", "Annual Recurring Revenue"),
    rec("Q1 2025", "gross_margin", 68.0, "%", "68%", "Gross Margin", "Improved from infrastructure cost optimization"),
    rec("Q1 2025", "net_retention", 116.0, "%", "116%", "Net Dollar Retention (LTM)", "LTM basis"),
    rec("Q1 2025", "churn", 3.1, "%", "3.1%", "Logo Churn (LTM)"),
    rec("Q1 2025", "headcount", 985.0, "", "985", "Total Headcount"),
    rec("Q1 2025", "cash", 128.0, "M", "C$128M", "Cash & Equivalents"),
    rec("Q1 2025", "burn", -0.9, "M", "(C$0.9M)", "Monthly Net Burn", "Monthly figure; near cash-flow breakeven"),
    # Q2 2025
    rec("Q2 2025", "revenue", 33.6, "M", "C$33.6M", "Net Revenue"),
    rec("Q2 2025", "arr", 131.0, "M", "C$131M", "Annual Recurring Revenue"),
    rec("Q2 2025", "gross_margin", 70.0, "%", "70%", "Gross Margin"),
    rec("Q2 2025", "net_retention", 118.0, "%", "118%", "Net Dollar Retention (LTM)", "LTM basis"),
    rec("Q2 2025", "churn", 2.8, "%", "2.8%", "Logo Churn (LTM)"),
    rec("Q2 2025", "headcount", 1020.0, "", "1,020", "Total Headcount"),
    rec("Q2 2025", "cash", 126.0, "M", "C$126M", "Cash & Equivalents"),
    rec("Q2 2025", "burn", -0.3, "M", "(C$0.3M)", "Monthly Net Burn", "Monthly figure; approaching profitability"),
]

demo_data = data + ws
Path("dashboard/public/data/metrics.json").write_text(json.dumps(demo_data, indent=2))
print(f"Demo data: {len(demo_data)} records ({len(data)} original + {len(ws)} WealthSimple)")

# ---------- Copy canonical pipeline CSV ----------
# The demo surface should serve the *real* pipeline output, not a reconstruction.
# WealthSimple intentionally isn't in the CSV (it's synthetic demo data shown in
# the JSON with a DEMO badge; the CSV is the honest pipeline artifact from the
# 25 provided PDFs). An analyst downloading this gets exactly what the extractor
# produced on the real portfolio - provenance preserved.
src_csv = Path("output/portfolio_metrics.csv")
dst_csv = Path("dashboard/public/data/metrics.csv")
if src_csv.exists():
    shutil.copyfile(src_csv, dst_csv)
    print(f"Demo CSV:  {dst_csv} (copied from {src_csv}, {dst_csv.stat().st_size} bytes)")
else:
    print(f"WARNING: {src_csv} not found - run poc.py first to produce the pipeline CSV")

# ---------- Demo log entries: showcase error-handling on WealthSimple ----------
# These are DEMO-ONLY - the real extraction log is clean (all 25 PDFs extracted
# without warnings). WealthSimple has a variety of realistic edge cases so the
# audit trail can demonstrate pipeline robustness.
log_data = json.load(open("output/extraction_log.json"))

ws_log = [
    # Clean extraction - all 8 metrics, no warnings
    {
        "filename": "WealthSimple_Q2_2024.pdf",
        "status": "extracted",
        "companies": ["WealthSimple Financial Corp."],
        "metrics_extracted": 8,
        "metrics_dropped": 0,
        "metrics_list": ["revenue", "arr", "gross_margin", "net_retention", "churn", "headcount", "cash", "burn"],
        "validation_warnings": [],
        "_demo": True,
    },
    # Warned: value extracted but grounding heuristic flagged a mismatch
    # (raw string in source wasn't an exact substring match; fuzzy-matched)
    {
        "filename": "WealthSimple_Q3_2024.pdf",
        "status": "warned",
        "companies": ["WealthSimple Financial Corp."],
        "metrics_extracted": 8,
        "metrics_dropped": 0,
        "metrics_list": ["revenue", "arr", "gross_margin", "net_retention", "churn", "headcount", "cash", "burn"],
        "validation_warnings": [
            "headcount: value '920' found via fuzzy match (raw label 'Total Employees' not in source); confidence lowered to medium",
        ],
        "_demo": True,
    },
    # Partial: one metric failed grounding and was dropped
    {
        "filename": "WealthSimple_Q4_2024.pdf",
        "status": "warned",
        "companies": ["WealthSimple Financial Corp."],
        "metrics_extracted": 8,
        "metrics_dropped": 1,
        "metrics_list": ["revenue", "arr", "gross_margin", "net_retention", "churn", "headcount", "cash", "burn"],
        "validation_warnings": [
            "net_retention: LLM returned '114%' but source text only contains '113.8%'; kept with rounding warning",
            "ltv_cac: metric extracted but dropped - no source grounding found (hallucination guard)",
        ],
        "_demo": True,
    },
    # Warned: currency ambiguity - pipeline defaulted to CAD based on filing context
    {
        "filename": "WealthSimple_Q1_2025.pdf",
        "status": "warned",
        "companies": ["WealthSimple Financial Corp."],
        "metrics_extracted": 8,
        "metrics_dropped": 0,
        "metrics_list": ["revenue", "arr", "gross_margin", "net_retention", "churn", "headcount", "cash", "burn"],
        "validation_warnings": [
            "currency inferred: symbol '$' appears without prefix; defaulted to CAD based on entity domicile (Toronto, ON)",
            "burn: sign convention ambiguous - source shows '(0.9)' treated as negative monthly burn",
        ],
        "_demo": True,
    },
    # Clean final quarter
    {
        "filename": "WealthSimple_Q2_2025.pdf",
        "status": "extracted",
        "companies": ["WealthSimple Financial Corp."],
        "metrics_extracted": 8,
        "metrics_dropped": 0,
        "metrics_list": ["revenue", "arr", "gross_margin", "net_retention", "churn", "headcount", "cash", "burn"],
        "validation_warnings": [],
        "_demo": True,
    },
    # Hard failure: corrupted/scanned PDF - no text extraction possible
    {
        "filename": "WealthSimple_BoardDeck_Q4_2024.pdf",
        "status": "no_result",
        "companies": [],
        "metrics_extracted": 0,
        "metrics_dropped": 0,
        "metrics_list": [],
        "validation_warnings": [
            "PDF text extraction returned empty - likely scanned/image-based; OCR fallback not enabled in this run",
        ],
        "_demo": True,
    },
]

demo_log = log_data + ws_log
Path("dashboard/public/data/log.json").write_text(json.dumps(demo_log, indent=2))
print(f"Demo log: {len(demo_log)} entries ({len(log_data)} real + {len(ws_log)} WealthSimple demo)")
