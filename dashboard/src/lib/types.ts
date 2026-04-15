/** A single metric record from portfolio_metrics.json */
export interface MetricRecord {
  company: string;
  quarter: string;
  metric: MetricName;
  value: number | null;
  unit: string;
  currency: string;
  raw_value: string;
  raw_label: string;
  source: string;
  status: string;
  warnings: Warning[];
  notes: string;
  source_file: string;
  /** 1-indexed page in source_file where the metric was located. Backfilled
   *  by add_source_pages.py (scored match of numeric tokens + label words).
   *  Null/undefined for synthetic records or when location couldn't be pinned. */
  source_page?: number | null;
  /** Demo-only synthetic record - not produced by real extraction. Shown with a DEMO badge in the UI. */
  _demo?: boolean;
}

export interface Warning {
  type: string;
  detail: string;
}

export type MetricName =
  | 'revenue'
  | 'arr'
  | 'gross_margin'
  | 'net_retention'
  | 'churn'
  | 'headcount'
  | 'cash'
  | 'burn';

export const ALL_METRICS: MetricName[] = [
  'revenue',
  'arr',
  'gross_margin',
  'net_retention',
  'churn',
  'headcount',
  'cash',
  'burn',
];

export const METRIC_LABELS: Record<MetricName, string> = {
  revenue: 'Revenue',
  arr: 'ARR',
  gross_margin: 'Gross Margin',
  net_retention: 'Net Retention',
  churn: 'Churn',
  headcount: 'Headcount',
  cash: 'Cash',
  burn: 'Burn (mo.)',
};

/** Whether a higher value is "better" for color-coding QoQ changes */
export const METRIC_HIGHER_IS_BETTER: Record<MetricName, boolean> = {
  revenue: true,
  arr: true,
  gross_margin: true,
  net_retention: true,
  churn: false,
  headcount: true,
  cash: true,
  burn: false, // less negative burn is better, but burn is negative
};

/** Extraction log entry */
export interface LogEntry {
  filename: string;
  status: string;
  companies?: string[];
  metrics_extracted: number;
  metrics_dropped?: number;
  metrics_list?: string[];
  validation_warnings?: string[];
  /** Demo-only synthetic entry - not produced by real extraction runs */
  _demo?: boolean;
}

/** API status response */
export interface StatusResponse {
  running: boolean;
  last_run: string | null;
  error: string | null;
  has_data: boolean;
  pdf_count?: number;
  pdf_folder?: string;
}
