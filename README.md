# Portfolio Metrics Extraction - Sagard FDE Technical Challenge

Griffin MacNaughtan, April 2026

A POC script that reads a folder of portfolio company PDFs, extracts a consistent set of eight financial and operating metrics from varying report formats, and produces review-ready CSV, JSON, and audit-log output.

## Quick start

```bash
pip install -r requirements.txt

# A demo API key is shipped in .env (isolated and rate-limited).

python poc.py ./pdfs                         # folder of reports
python poc.py ./pdfs/NovaCloud_Q2_2025.pdf   # single file
```

Outputs are written to `./output/`.

A sample run on the 25-PDF provided sample dataset is already included in `./output/` - you can inspect `portfolio_metrics.json`, `portfolio_metrics.csv`, and `extraction_log.json` directly without running anything. Re-running `poc.py` will overwrite these files.

## The problem

A Sagard analyst comparing portfolio performance without automated tools has to open each quarterly PDF, find the same handful of metrics under different names, and retype them into a spreadsheet. The metrics exist and are machine-readable - they are just scattered across tables, prose commentary, and footnotes, under labels that drift company-to-company and sometimes quarter-to-quarter within the same company.

This is the "crawl" phase of automating that task: prove the extraction works on a representative sample, with a design that points cleanly at what a production version looks like.

## Initial Approach

The first instinct on a problem like this is table extraction plus keyword matching - `pdfplumber` in python pulls tables cleanly and "Revenue" or "ARR" as search terms gets you most of the way on a well-behaved report. I spent time on that path before it fell apart on three noticable cases in the sample:

- **NovaCloud renames "Net Revenue" to "Recognized Revenue" between Q4 and Q1.** Keyword matching works until a company rewrites its own chart of accounts, and maintaining a hand-curated alias list per company per quarter is the manual work this tool is supposed to replace.
- **Several companies report gross margin only in prose.** "We held gross margin steady at 72% despite input cost pressure" is machine-readable but not table-readable - a structural extractor doesn't know that sentence exists.
- **The Portfolio Snapshot puts four companies on a single page.** Any logic that assumes one company per file would need a second parser for this document, and the structure is different enough that it's almost a separate problem.

All three pointed at the same conclusion being that the hard part is semantic. An LLM handles them naturally with the right prompt, and the parts of the job that are structural - filename parsing, currency symbols, numeric format - are still better off as regex. These are more explicit and help reduce token costs. That split is what the final pipeline uses. I ended up going with Claude Opus 4.6 through the Claude API, as it's what I find performs best overall in enterprise at work, and it's the only premium llm subscription I'm currently paying for.

I briefly considered a hybrid (table extractor for the easy numbers, LLM only as a fallback for the misses) and rejected it as things were getting out of scope.

The metrics list narrowed the same way. I started broader - EBITDA, CAC, LTV, etc - and cut anything that wasn't widely present in the sample. A mostly-empty column in the output is useless, and every added metric is more surface area in the prompt for the model to get confused on. The eight that survived are the ones that I was able to fill across most of the portfolio.

As for outputs, I started with JSON only - it's the easiest thing to plug into a dashboard down the line. Added the CSV pivot after the first real run, when I realized the people actually reading this aren't engineers - they open things in Excel, and long-format JSON is the wrong shape for scanning a portfolio on one screen. The extraction log came out of the same run, when I wanted to see what grounding was dropping and realised I had no way to look.

## What it does

After some ideation, I settled on eight relevant metrics to extract and five stages to map out this process.

| Metric | Why it is included |
|---|---|
| Revenue | Universal top-line |
| ARR | Separates recurring-revenue quality from transactional |
| Gross Margin | Unit economics |
| Net Retention | Existing-customer expansion signal |
| Churn | Early risk indicator |
| Headcount | Biggest cost driver, scale proxy |
| Cash | Liquidity |
| Burn (monthly) | Paired with cash, gives runway without having to compute it |

### Process

1. **Discover** - walks the folder, parses `Company_Q2_2025.pdf`-style filenames for a period hint, flags portfolio snapshots.
2. **Text extraction** - `pdfplumber` pulls text out of each PDF. The sample reports are text-based and clean, so no OCR needed (See assumptions).
3. **Semantic parse** - sends each document to Claude with a structured prompt that defines the eight target metrics, their common aliases, the output schema, and domain rules (prefer totals over components, prefer operating cash over restricted, distinguish monthly from quarterly burn). The model returns JSON.
4. **Validate and normalise** - substring-grounds every returned number against the source PDF, resolves entity aliases, parses raw strings into numeric + unit for CSV output, normalises burn to a monthly rate, and deduplicates standalone reports against portfolio snapshots with cross-validation when both agree.
5. **Output** - writes a wide-format CSV pivot for human review, a long-format JSON with full metadata for downstream systems, and an extraction log with per-file warnings.

## Key decisions / Justifications

**Metrics.** Revenue, ARR, gross margin, net retention, churn, headcount, cash, and burn. Between them they cover what I think a portfolio reviewer actually scans for: top line, recurring quality, unit economics, runway, scale. EBITDA is the obvious omission. I left it out because none of the 25 sample reports include it (these are growth-stage companies where burn matters more), and adding it later is an easy addition. Same goes for CAC and LTV.

**Burn normalised to monthly.** Companies report burn inconsistently - some quarterly, some monthly, some as "net cash used in operations." I convert everything to a monthly rate (quarterly figures divided by three) so burn is directly comparable across companies and directly divisible into cash for a runway number.

**LLM for semantic, regex for structural.** Following from the ideation above, Claude handles everything that depends on understanding the document - naming, aliasing, prose vs table, multi-company pages - and regex handles what it does well: filename parsing, currency symbols, numeric format.

**Needs to be deterministic and reproducible.** Temperature is set to 0 and the prompt is fixed per run, so the same PDF produces the same output across repeated runs - I verified this by re-running the full 25-file batch and diffing the outputs against the previous run.

**Cost and latency.** I was more focused on accuracy over speed and cost in this case due to the scope of the challenge. However, performance gains would need to be introduced post-POC (see next steps). Portfolio reports land quarterly and this isn't a real-time task, so latency isn't a major concern here. As for cost, a typical report in the sample is a few pages of text: call it ~5k input tokens including the prompt, ~1k output tokens for the structured JSON. Since cost isn't a binding constraint here, the script runs Opus (~15 dollars/M input, 75 dollars/M output) for maximum extraction quality, which works out to about 15 cents per pdf. A 100-company portfolio reporting quarterly is ~400 PDFs a year, or **~$60/year** in API spend.

**Grounding check on every value.** Before a value reaches the output, I pull the numeric tokens out of it and check that each one appears somewhere in the source PDF text. Anything that doesn't is dropped and written to the extraction log. 

**Fail-grounded values are kept but flagged.** When a value fails grounding it's retained in the main JSON with `status: "dropped"` and `value: null`, preserving the raw string and drop reason so a reviewer can audit what the model produced. The CSV pivot filters dropped records out of the data cells (a missing cell is obvious, a wrong cell isn't) but surfaces the drop reason in the single `warnings` column.

**Standalone over snapshot, with cross-validation or warning.** Four companies appear in both their own Q2 2025 standalone report and the Portfolio Snapshot. When that happens I keep the standalone (more detail) and compare it to the snapshot. Agreement adds a "cross-validated" note. Disagreement flips the record's status to `warned` and captures both raw values in the warning.

**Three outputs** JSON for future use in a dashboard, CSV for non-technical folks in Excel, and an extraction log for audit.

## What it found in the sample

Two cases worth calling out, both because they show up in the data and because they're the kind of thing a regex approach would silently get wrong:

- **Metrics hidden in commentary.** Several gross margins and headcount numbers live only in written paragraphs.. The prompt instructs the model to search prose and footnotes, as well as structured sections.
- **Restricted vs. operating cash.** ClearPay's balance sheet shows "Cash & Restricted Cash" at 38.4M, but only 32.2M is actually available (the rest is in segregated client accounts). The prompt tells the model to prefer operating cash, and the extraction notes the distinction.

## Validation

**Substring grounding** catches any value the model potentially hallucinated. On the 25-PDF sample nothing got dropped, which suggests Claude isn't fabricating numbers on clean text-based reports of this kind.

**Snapshot cross-validation** is opportunistic. When the same company-quarter-metric appears in both a standalone report and the portfolio snapshot, agreement is recorded as a "cross-validated" note on the record. Disagreement flips the record's status to `warned` and appends a `snapshot_disagreement` warning with both raw values, which surfaces in the CSV's warnings column.

What neither check gives you is a precision/recall number. That requires a hand-labelled set, which becomes the basis of an eval suite the process can be re-run against on every prompt change, model swap, or code refactor.

What grounding does *not* catch:

- The model pairs the right number with the wrong metric (revenue reported as ARR).
- The model picks a number that happens to appear elsewhere in the document for an unrelated reason.
- The model reformats a value (`8,400,000` in the PDF vs `$8.4M` from the model). The validator tolerates common abbreviated variants and trailing-zero differences, but not every possible reformatting.

These concerns would need to be addressed post-POC.

## Assumptions

- **PDFs are text-based.** Scanned or image-only reports would need an OCR stage (Tesseract or a vision-capable model) before `pdfplumber`. That slots in as a preprocessor without touching any downstream logic.
- **USD unless the document says otherwise.** Currencies are tagged on every record and never silently mixed.
- **One company per standalone report, one quarter per report.** Portfolio snapshots are the exception and are handled explicitly.
- **FleetLink and Apex Freight are the same entity** (stated in the Q2 2025 report header).
- **Gross margin is extracted as-reported.** Companies define it differently; until there is a metric definitions registry, cross-company gross-margin comparisons are directional only.
- **No EBITDA, no CAC/LTV.** Neither appeared densely enough in the sample to be useful. Both are easy additions when they become relevant.
- **Entity alias table is tuned to the sample.** In production this moves into a per-portfolio config or into the prompt itself against a canonical company list.

## Data privacy

This POC sends PDF text to the public Anthropic API. Anthropic doesn't train on it by default, but it still leaves your network. For real portfolio reports it would need Legal and Compliance sign-off, and a different model.

A few production options, depending on the team's setup:

1. **AWS Bedrock with Claude**.
2. **Zero-retention enterprise agreement with Anthropic**.
3. **Self-hosted open model** (Llama 3 or Mixtral behind vLLM) - full sovereignty and a lower per-call cost, however benchmarking would be needed.


## What I'd build next

1. **Parallelise the LLM calls.** Sequential processing is fine at 25 files (around 7 seconds per pdf for a full run) but becomes the bottleneck as soon as the portfolio grows. The calls would be relatively easy to parallelize - wrapping the main loop in a `ThreadPoolExecutor` (5–8 workers, with retry-with-backoff on rate-limit errors) is a quick refactor for a substantial performance gain.

2. **Move away from the public API:** As mentioned above in the Data privacy section, AWS Bedrock is the fastest way or a self-hosted open model on prem is the most secure option, just depends on team infrastructure and standards.

3. **Reviewer dashboard:** A small internal app where investment teams can scan extractions in a sortable grid, see warnings and large quarter-over-quarter swings, and click any cell to jump straight to the source page in the PDF. This is also where the rest of the team's internal tools would naturally plug in.

4. **Cloud deployment:** The eventual production shape is event-driven, PDFs land in an S3 bucket (or wherever the firm stores reports), an upload triggers a Lambda or container job, the extraction runs, and the output writes to a database the dashboard reads from.

5. **Eval Suite:** Three to five reports where someone writes down the right answer for every metric by hand, re-run on every prompt or model change.

6. **Warned-values review queue.** Anything that fails grounding, disagrees with the snapshot, or trips a sanity rule (QoQ swing >20%, negative gross margin, ARR > revenue, burn > cash) gets routed to a person before it ends up in any downstream output.

7. **Metric definitions registry.** Different companies define gross margin different ways and right now I just take whatever they report. A small config file per company would let the dashboard make real cross-company comparisons.

8. **Response caching.** Cache LLM responses by file hash, prompt version, and model version.

## Outputs reference

| File | Purpose 
|---|---|
| `output/portfolio_metrics.json` | Long-format records with full metadata - company, quarter, value, unit, currency, raw label, source type, source file, notes, plus a `status` field (`extracted` / `warned` / `dropped`) and a structured `warnings` array on every record. Canonical format for downstream systems; consumers that only want clean data filter on `status == "extracted"`. |
| `output/portfolio_metrics.csv` | Company × metric pivot - opens in Excel, one page to scan the portfolio. A single `warnings` column on the right aggregates any flagged or dropped metrics for each company/quarter row. |
| `output/extraction_log.json` | Per-PDF run log: which file, which companies, extracted vs dropped counts, validation warnings. Run-level audit trail; per-record detail lives in `portfolio_metrics.json`. |
