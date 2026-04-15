# Automating Metric Extraction from Quarterly Reports
## Sagard Case Study - Griffin MacNaughtan, April 2026

<img width="2240" height="1299" alt="image" src="https://github.com/user-attachments/assets/b514ead3-95d5-44e1-b75b-7d2af256b4ba" />

Extracts eight standardised financial metrics (revenue, ARR, gross margin, net retention, churn, headcount, cash, burn) from portfolio-company quarterly PDF reports and surfaces them in a dashboard.

## What's here

- **`poc.py`** - extraction pipeline. Reads PDFs, calls Claude with a structured prompt, validates every returned number against the source, normalises currencies/units, deduplicates standalone reports against portfolio snapshots, writes CSV + JSON.
- **`api.py`** - thin FastAPI server wrapping the pipeline. Exposes `/metrics`, `/log`, `/status`, `/csv`, `/pdf/{filename}`, `/upload`, `/extract`.
- **`add_demo_data.py`** - copies canonical pipeline artifacts into `dashboard/public/data/` so DEMO mode works on a static deploy, and injects a synthetic CAD company (WealthSimple) to demonstrate wider timeline trends for an ideal case.
- **`dashboard/`** - React + TypeScript + Vite + Tailwind frontend (Recharts for visualisations). Four screens: Portfolio Overview, Company Deep Dive, Audit Trail, Live Extraction.
- **`output/`** - pipeline artifacts: `portfolio_metrics.json`, `portfolio_metrics.csv`, `extraction_log.json`.
- **`pdfs/`** - 25 synthetic quarterly reports used as the sample set.
- **`sagard_fde_griffin.pptx`** - case-study deck.

## Quick start

```bash
# 1. Install
pip install -r requirements.txt
cd dashboard && npm install && cd ..

# 2. Set API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# 3. Run pipeline once to populate output/
python poc.py pdfs
python add_demo_data.py

# 4. Start backend + frontend (two terminals)
python api.py                  # http://localhost:8000
cd dashboard && npm run dev    # http://localhost:5173
```

## DEMO vs LIVE mode

Header toggle in the dashboard.
- **DEMO** - reads baked artifacts from `dashboard/public/data/`. Works without the backend.
- **LIVE** - hits the FastAPI server. Empty until you run extraction from the Live Extraction screen.

## Key design choices

- **Hallucination guard** - every extracted numeric value is substring-verified against the source PDF text. Anything that fails grounding is dropped with a warning in the audit log.
- **Entity aliases** - explicit alias map handles rebrands (FleetLink / Apex Freight) and casing/whitespace drift.
- **Deduplication** - portfolio-snapshot rows are cross-validated against standalone reports; agreement boosts confidence, disagreement surfaces in warnings.
- **Source tracing** - Claude returns a `source_page`; fallback heuristic scores pages by numeric tokens + label words. "View Source PDF" opens at that page with the value highlighted.
- **Currency awareness** - USD, GBP, CAD kept native; aggregates clearly labelled as USD-only rather than silently FX-converting.

## Requirements

- Python 3.11+ with `anthropic`, `pdfplumber`, `pandas`, `fastapi`, `uvicorn`, `python-multipart`, `python-dotenv`
- Node 18+ for the dashboard
- `ANTHROPIC_API_KEY` env var for extraction (not needed for DEMO mode)
