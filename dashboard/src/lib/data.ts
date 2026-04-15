import type { MetricRecord, MetricName, LogEntry, StatusResponse } from './types';
import { METRIC_LABELS, METRIC_HIGHER_IS_BETTER } from './types';
import type { DataMode } from './mode';

// In dev mode, proxy through Vite to the FastAPI backend.
// In production (GitHub Pages / static host), there is no backend to hit -
// LIVE mode returns empty so the UI can show an honest "run extraction to populate"
// empty state instead of silently echoing the demo snapshot. The DEMO/LIVE toggle
// then represents a real data-source difference rather than a cosmetic switch.
const isDev = import.meta.env.DEV;

// ---------- Static Data (Demo mode - always reads baked JSON) ----------

const STATIC_BASE = `${import.meta.env.BASE_URL}data`;

export async function fetchDemoMetrics(): Promise<MetricRecord[]> {
  const res = await fetch(`${STATIC_BASE}/metrics.json`);
  if (!res.ok) throw new Error(`Failed to fetch demo metrics: ${res.status}`);
  return res.json();
}

export async function fetchDemoLog(): Promise<LogEntry[]> {
  const res = await fetch(`${STATIC_BASE}/log.json`);
  if (!res.ok) throw new Error(`Failed to fetch demo log: ${res.status}`);
  return res.json();
}

// ---------- API Fetchers (Live mode - hits FastAPI backend) ----------
// In a static deploy these short-circuit to empty. The rendering pages key off
// `mode === 'live' && records.length === 0` to show the dedicated empty state.

export async function fetchMetrics(): Promise<MetricRecord[]> {
  if (!isDev) return [];
  const res = await fetch('/api/metrics');
  if (!res.ok) throw new Error(`Failed to fetch metrics: ${res.status}`);
  return res.json();
}

export async function fetchLog(): Promise<LogEntry[]> {
  if (!isDev) return [];
  const res = await fetch('/api/log');
  if (!res.ok) throw new Error(`Failed to fetch log: ${res.status}`);
  return res.json();
}

export async function fetchStatus(): Promise<StatusResponse> {
  if (!isDev) {
    // No backend to poll in a static deploy; return a benign "idle / no data" shape
    // so the ExtractionRunner page renders without a fetch error.
    return {
      running: false,
      last_run: null,
      error: null,
      has_data: false,
      pdf_count: 0,
      pdf_folder: '',
    };
  }
  const res = await fetch('/api/status');
  if (!res.ok) throw new Error(`Failed to fetch status: ${res.status}`);
  return res.json();
}

// ---------- Mode-aware dispatchers ----------
// Demo → baked static JSON (works with zero backend).
// Live → FastAPI endpoints (requires api.py running locally; GitHub Pages can't reach it).
//
// Keeping these thin wrappers means every consumer (pages, hooks) gets one import
// and the mode decision is made in exactly one place.

export function fetchMetricsByMode(mode: DataMode): Promise<MetricRecord[]> {
  return mode === 'live' ? fetchMetrics() : fetchDemoMetrics();
}

export function fetchLogByMode(mode: DataMode): Promise<LogEntry[]> {
  return mode === 'live' ? fetchLog() : fetchDemoLog();
}

export async function triggerExtraction(folder?: string): Promise<{ status: string }> {
  if (!isDev) return { status: 'static_mode' };
  const res = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(folder ? { folder } : {}),
  });
  if (!res.ok) throw new Error(`Failed to trigger extraction: ${res.status}`);
  return res.json();
}

/** Upload PDFs via the native browser file picker. Backend saves them to ./uploads/
 *  (wiping the prior batch) and returns the folder path. The caller then feeds that
 *  path to triggerExtraction() - keeping "upload" and "extract" as two explicit
 *  steps so the user can see what was staged before kicking off a long-running run. */
export async function uploadPdfs(
  files: File[],
): Promise<{ folder: string; count: number; files: string[] }> {
  if (!isDev) throw new Error('Upload requires the local backend (not available on static hosts)');
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

/**
 * URL for a source PDF. Mode-aware and location-aware:
 *  - Demo: baked PDFs in public/pdfs/ (served by Vite/static host, no backend needed).
 *  - Live: FastAPI /pdf/{filename} streams from the folder the user extracted against.
 *
 * If `page` or `search` are provided, appends a PDF open-parameters fragment
 * (`#page=N&search=TERM`) so Chromium-based viewers jump straight to the page
 * and highlight the extracted value. Other browsers ignore unknown params
 * and still land on the correct file - graceful degradation.
 *
 * Synthetic records (WealthSimple in demo) have no PDF on disk; callers should
 * check `record._demo` first and show the toast instead of producing a 404.
 */
export function getPdfUrl(
  filename: string,
  mode: DataMode = 'demo',
  page?: number | null,
  search?: string | null,
): string {
  const base =
    mode === 'live'
      ? `/api/pdf/${encodeURIComponent(filename)}`
      : `${import.meta.env.BASE_URL}pdfs/${encodeURIComponent(filename)}`;

  const frag: string[] = [];
  if (page && page > 0) frag.push(`page=${page}`);
  // Strip currency/unit symbols so the viewer's plain-text search actually matches
  // what's rendered in the PDF (e.g. "$8.4M" -> "8.4"). We keep digits + decimal.
  if (search) {
    const cleaned = search.replace(/[^\d.]/g, '').trim();
    if (cleaned) frag.push(`search=${encodeURIComponent(cleaned)}`);
  }
  return frag.length ? `${base}#${frag.join('&')}` : base;
}

/**
 * URL to the canonical pivot CSV. Mode-aware so the "Download CSV" button
 * always hits something that exists:
 *  - Demo: baked copy of output/portfolio_metrics.csv in public/data/
 *          (no backend required; works on static hosts like GitHub Pages).
 *  - Live: FastAPI /csv endpoint streams output/portfolio_metrics.csv
 *          directly - whatever the last live extraction produced.
 */
export function getCsvUrl(mode: DataMode = 'demo'): string {
  if (mode === 'live') return '/api/csv';
  return `${STATIC_BASE}/metrics.csv`;
}

export const isStaticMode = !isDev;

// ---------- Quarter Utilities ----------

export function parseQuarter(q: string): { quarter: number; year: number } {
  const match = q.match(/Q(\d)\s+(\d{4})/);
  if (!match) return { quarter: 0, year: 0 };
  return { quarter: parseInt(match[1]), year: parseInt(match[2]) };
}

export function quarterSortKey(q: string): number {
  const { quarter, year } = parseQuarter(q);
  return year * 4 + quarter;
}

export function sortQuarters(quarters: string[]): string[] {
  return [...quarters].sort((a, b) => quarterSortKey(a) - quarterSortKey(b));
}

// ---------- Grouping ----------

export function groupByCompany(records: MetricRecord[]): Map<string, MetricRecord[]> {
  const map = new Map<string, MetricRecord[]>();
  for (const r of records) {
    if (!map.has(r.company)) map.set(r.company, []);
    map.get(r.company)!.push(r);
  }
  return map;
}

export function groupByQuarter(records: MetricRecord[]): Map<string, MetricRecord[]> {
  const map = new Map<string, MetricRecord[]>();
  for (const r of records) {
    if (!map.has(r.quarter)) map.set(r.quarter, []);
    map.get(r.quarter)!.push(r);
  }
  return map;
}

export function getUniqueCompanies(records: MetricRecord[]): string[] {
  return [...new Set(records.map((r) => r.company))].sort();
}

export function getUniqueQuarters(records: MetricRecord[]): string[] {
  return sortQuarters([...new Set(records.map((r) => r.quarter))]);
}

export function getLatestQuarter(records: MetricRecord[]): string {
  const quarters = getUniqueQuarters(records);
  return quarters[quarters.length - 1] || '';
}

export function getCompanyRecords(records: MetricRecord[], company: string): MetricRecord[] {
  return records.filter((r) => r.company === company);
}

export function getCompanyLatestMetrics(
  records: MetricRecord[],
  company: string
): MetricRecord[] {
  const companyRecords = getCompanyRecords(records, company);
  const latestQ = getLatestQuarter(companyRecords);
  return companyRecords.filter((r) => r.quarter === latestQ);
}

// ---------- QoQ Computation ----------

export interface QoQResult {
  current: number | null;
  previous: number | null;
  change: number | null;
  isImproving: boolean | null;
  label: string;
}

export function computeQoQChange(
  records: MetricRecord[],
  company: string,
  metric: MetricName
): QoQResult {
  const metricRecords = records
    .filter((r) => r.company === company && r.metric === metric && r.value !== null)
    .sort((a, b) => quarterSortKey(a.quarter) - quarterSortKey(b.quarter));

  if (metricRecords.length < 2) {
    const current = metricRecords.length === 1 ? metricRecords[0].value : null;
    return { current, previous: null, change: null, isImproving: null, label: '' };
  }

  const curr = metricRecords[metricRecords.length - 1];
  const prev = metricRecords[metricRecords.length - 2];

  if (curr.value === null || prev.value === null) {
    return { current: curr.value, previous: prev.value, change: null, isImproving: null, label: '' };
  }

  const unit = curr.unit;
  let change: number;
  let label: string;

  if (unit === '%') {
    // For percentages, compute absolute difference in percentage points
    change = curr.value - prev.value;
    label = `${change >= 0 ? '+' : ''}${change.toFixed(1)}pp`;
  } else if (prev.value !== 0) {
    change = ((curr.value - prev.value) / Math.abs(prev.value)) * 100;
    label = `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
  } else {
    change = 0;
    label = 'n/a';
  }

  const higherIsBetter = METRIC_HIGHER_IS_BETTER[metric];
  // For burn (negative values), less negative = improving
  let isImproving: boolean;
  if (metric === 'burn') {
    isImproving = curr.value > prev.value; // less negative is better
  } else {
    isImproving = higherIsBetter ? change > 0 : change < 0;
  }

  return { current: curr.value, previous: prev.value, change, isImproving, label };
}

// ---------- Value Formatting ----------

export function getCurrencySymbol(currency: string): string {
  switch (currency) {
    case 'GBP':
      return '\u00a3';
    case 'EUR':
      return '\u20ac';
    case 'CAD':
      return 'C$';
    default:
      return '$';
  }
}

export function formatValue(record: MetricRecord): string {
  if (record.value === null) return '\u2014';

  const { value, unit, currency, metric } = record;
  const sym = getCurrencySymbol(currency);

  if (unit === '%') {
    return `${value}%`;
  }
  if (unit === 'bps') {
    return `${value} bps`;
  }
  if (unit === 'M' || unit === 'B' || unit === 'k') {
    const absVal = Math.abs(value);
    const formatted = absVal % 1 === 0 ? absVal.toFixed(0) : absVal.toFixed(1);
    const prefix = value < 0 ? `(${sym}${formatted}${unit})` : `${sym}${formatted}${unit}`;
    return prefix;
  }
  if (metric === 'headcount') {
    return Math.round(value).toLocaleString();
  }
  // Fallback for plain numbers
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }
  return value.toFixed(1);
}

export function formatValueShort(value: number | null, unit: string, currency: string): string {
  if (value === null) return '\u2014';
  const sym = getCurrencySymbol(currency);

  if (unit === '%') return `${value}%`;
  if (unit === 'M' || unit === 'B' || unit === 'k') {
    const absVal = Math.abs(value);
    const formatted = absVal % 1 === 0 ? absVal.toFixed(0) : absVal.toFixed(1);
    return value < 0 ? `(${sym}${formatted}${unit})` : `${sym}${formatted}${unit}`;
  }
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(1);
}

// ---------- Derived metrics ----------

/** Months of cash remaining = cash / |monthly burn|.
 *  Both values are implicitly same-currency (single company, single PDF).
 *  Burn is stored negative (outflow); runway is only meaningful when burn < 0.
 *  Returns null if either input is missing or the company is cash-flow positive
 *  (burn >= 0 → infinite runway, not a number we want to display). */
export function computeRunway(
  records: MetricRecord[],
  company: string,
  quarter: string,
): number | null {
  const cashRec = records.find(
    (r) => r.company === company && r.quarter === quarter && r.metric === 'cash' && r.value !== null,
  );
  const burnRec = records.find(
    (r) => r.company === company && r.quarter === quarter && r.metric === 'burn' && r.value !== null,
  );
  if (!cashRec || !burnRec) return null;
  const cash = cashRec.value!;
  const burn = burnRec.value!;
  // Both must be in millions (unit='M') to divide cleanly. Mixed units are possible
  // in theory (cash in M, burn in k) but every record in the sample set is 'M'.
  if (cashRec.unit !== burnRec.unit) return null;
  if (burn >= 0) return null; // cash-flow positive - no runway concept
  return cash / Math.abs(burn);
}

/** Runway risk band for color-coding. Thresholds match standard VC convention:
 *  <6 mo = critical (need to act), <12 mo = caution (plan ahead), else = healthy. */
export function runwayBand(months: number | null): 'critical' | 'caution' | 'healthy' | null {
  if (months === null) return null;
  if (months < 6) return 'critical';
  if (months < 12) return 'caution';
  return 'healthy';
}

/** Revenue dip detection: flags any QoQ revenue decline beyond `thresholdPct`
 *  (default 3%). Separate from the insight-generator threshold (>5%) so the
 *  inline row badge fires one tier earlier - analysts want to see softening
 *  before it hits the "Attention Needed" panel. */
export function hasRevenueDip(
  records: MetricRecord[],
  company: string,
  thresholdPct = 3,
): { dipped: boolean; changePct: number | null; label: string } {
  const qoq = computeQoQChange(records, company, 'revenue');
  if (qoq.change === null) return { dipped: false, changePct: null, label: '' };
  return {
    dipped: qoq.change < -thresholdPct,
    changePct: qoq.change,
    label: qoq.label,
  };
}

// ---------- Insights Generator ----------

export interface Insight {
  type: 'positive' | 'negative' | 'neutral';
  title: string;
  detail: string;
  /** If set, InsightsPanel renders this card as clickable and routes to /company/{name} */
  linkedCompany?: string;
  /** If set alongside linkedCompany, deep-links to the chart/metric on the company page */
  linkedMetric?: MetricName;
}

export function generateInsights(records: MetricRecord[], quarter?: string): Insight[] {
  const insights: Insight[] = [];
  const companies = getUniqueCompanies(records);
  const targetQ = quarter || getLatestQuarter(records);
  const targetRecords = records.filter((r) => r.quarter === targetQ && r.status !== 'dropped');

  // Scope QoQ computations to records up through the target quarter so the filter
  // actually affects insight generation (otherwise "latest QoQ" would always win).
  const targetKey = quarterSortKey(targetQ);
  const scopedRecords = records.filter((r) => quarterSortKey(r.quarter) <= targetKey);

  // ---------- ATTENTION NEEDED (red) ----------

  // Revenue declining > 5% QoQ
  for (const company of companies) {
    const qoq = computeQoQChange(scopedRecords, company, 'revenue');
    if (qoq.change !== null && qoq.change < -5) {
      insights.push({
        type: 'negative',
        title: 'Revenue declining',
        detail: `${company} ${qoq.label} QoQ - investigate cause`,
        linkedCompany: company,
        linkedMetric: 'revenue',
      });
    }
  }

  // Churn rising > 0.5pp QoQ (inverse of "improving")
  for (const company of companies) {
    const qoq = computeQoQChange(scopedRecords, company, 'churn');
    if (qoq.change !== null && qoq.change > 0.5) {
      insights.push({
        type: 'negative',
        title: 'Churn rising',
        detail: `${company} +${qoq.change.toFixed(1)}pp QoQ - retention risk`,
        linkedCompany: company,
        linkedMetric: 'churn',
      });
    }
  }

  // Short runway (<6 months of cash remaining at current burn rate)
  for (const company of companies) {
    const runway = computeRunway(targetRecords, company, targetQ);
    if (runway !== null && runway < 6) {
      insights.push({
        type: 'negative',
        title: 'Short runway',
        detail: `${company} has ${runway.toFixed(1)} months of cash at current burn`,
        linkedCompany: company,
        linkedMetric: 'cash',
      });
    }
  }

  // Burn accelerating (becoming more negative by >20% QoQ)
  for (const company of companies) {
    const qoq = computeQoQChange(scopedRecords, company, 'burn');
    // burn is negative; "more negative" means current < previous
    if (
      qoq.current !== null &&
      qoq.previous !== null &&
      qoq.current < qoq.previous &&
      qoq.previous < 0 &&
      Math.abs(qoq.current / qoq.previous - 1) > 0.2
    ) {
      insights.push({
        type: 'negative',
        title: 'Burn accelerating',
        detail: `${company} monthly burn widened materially QoQ`,
        linkedCompany: company,
        linkedMetric: 'burn',
      });
    }
  }

  // ---------- OUTPERFORMERS (green) ----------

  // Top revenue grower (only if >5% to be noteworthy)
  let bestRevenueGrowth = { company: '', change: -Infinity, label: '' };
  for (const company of companies) {
    const qoq = computeQoQChange(scopedRecords, company, 'revenue');
    if (qoq.change !== null && qoq.change > bestRevenueGrowth.change) {
      bestRevenueGrowth = { company, change: qoq.change, label: qoq.label };
    }
  }
  if (bestRevenueGrowth.company && bestRevenueGrowth.change > 5) {
    insights.push({
      type: 'positive',
      title: 'Fastest grower',
      detail: `${bestRevenueGrowth.company} at ${bestRevenueGrowth.label} QoQ`,
      linkedCompany: bestRevenueGrowth.company,
      linkedMetric: 'revenue',
    });
  }

  // NRR >= 110% - if single leader, link directly; if multiple, link to the top one
  const nrrRecords = targetRecords
    .filter((r) => r.metric === 'net_retention' && r.value !== null && (r.value ?? 0) >= 110)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (nrrRecords.length > 0) {
    const names = nrrRecords.map((r) => `${r.company} (${r.value}%)`).join(', ');
    insights.push({
      type: 'positive',
      title: 'Expansion leaders (NRR ≥110%)',
      detail: names,
      linkedCompany: nrrRecords[0].company,
      linkedMetric: 'net_retention',
    });
  }

  // ---------- CONTEXT (neutral) ----------

  // Revenue concentration: top company as % of USD portfolio
  const usdRevRecs = targetRecords.filter(
    (r) => r.metric === 'revenue' && r.currency === 'USD' && r.unit === 'M' && r.value !== null
  );
  if (usdRevRecs.length >= 2) {
    const total = usdRevRecs.reduce((s, r) => s + (r.value ?? 0), 0);
    const top = usdRevRecs.reduce((a, b) => ((a.value ?? 0) > (b.value ?? 0) ? a : b));
    const pct = total > 0 ? ((top.value ?? 0) / total) * 100 : 0;
    if (pct > 25) {
      insights.push({
        type: pct > 40 ? 'negative' : 'neutral',
        title: 'Concentration risk',
        detail: `${top.company} = ${pct.toFixed(0)}% of USD revenue`,
        linkedCompany: top.company,
        linkedMetric: 'revenue',
      });
    }
  }

  // Coverage: how complete is the sample for this quarter?
  const metricsCovered = new Set(targetRecords.map((r) => r.metric)).size;
  const reporters = new Set(targetRecords.map((r) => r.company)).size;
  if (reporters > 0) {
    insights.push({
      type: 'neutral',
      title: `${targetQ} coverage`,
      detail: `${reporters} of ${companies.length} companies reporting, ${metricsCovered}/8 metrics`,
    });
  }

  return insights;
}

// ---------- Metric Display Helpers ----------

export function getMetricLabel(metric: MetricName): string {
  return METRIC_LABELS[metric] || metric;
}

export function getCompanyCurrency(records: MetricRecord[], company: string): string {
  const rec = records.find((r) => r.company === company);
  return rec?.currency ?? 'USD';
}

// Consistent colors per company for multi-line charts
export const COMPANY_COLORS: Record<string, string> = {
  'NovaCloud': '#58a6ff',
  'LendBridge': '#3fb950',
  'FleetLink / Apex Freight': '#d29922',
  'MediSight': '#f778ba',
  'CarbonTrack': '#79c0ff',
  'ConstructIQ': '#a5d6ff',
  'ClearPay': '#7ee787',
  'PeopleFlow': '#ffa657',
  'TalentVault': '#d2a8ff',
  'WealthSimple': '#f47068',
};

export function getCompanyColor(company: string): string {
  return COMPANY_COLORS[company] ?? '#8b949e';
}

// Build portfolio-level aggregates over time (USD only, to avoid mixing currencies)
export function getPortfolioTimeSeries(
  records: MetricRecord[],
  metric: MetricName
): { quarter: string; value: number; count: number }[] {
  const quarters = getUniqueQuarters(records);
  return quarters.map((q) => {
    const qRecords = records.filter(
      (r) =>
        r.quarter === q &&
        r.metric === metric &&
        r.value !== null &&
        r.status !== 'dropped' &&
        r.currency === 'USD'
    );
    const total = qRecords.reduce((sum, r) => sum + (r.value ?? 0), 0);
    return { quarter: q, value: total, count: qRecords.length };
  });
}
