import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchMetricsByMode,
  getUniqueCompanies,
  getUniqueQuarters,
  getLatestQuarter,
  quarterSortKey,
  computeQoQChange,
  formatValue,
  formatValueShort,
  generateInsights,
  getCompanyCurrency,
  getCompanyColor,
  getPortfolioTimeSeries,
  getCsvUrl,
  computeRunway,
  runwayBand,
  hasRevenueDip,
} from '../lib/data';
import { useDataMode } from '../lib/mode';
import type { MetricRecord, MetricName } from '../lib/types';
import { ALL_METRICS, METRIC_LABELS } from '../lib/types';
import KPICard from '../components/KPICard';
import QoQIndicator from '../components/QoQIndicator';
import InsightsPanel from '../components/InsightsPanel';
import EmptyLiveState from '../components/EmptyLiveState';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Legend,
  ScatterChart, Scatter, ZAxis, ReferenceLine,
} from 'recharts';

export default function PortfolioOverview() {
  const [records, setRecords] = useState<MetricRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedQuarter, setSelectedQuarter] = useState<string | null>(null);
  const [trendMetric, setTrendMetric] = useState<MetricName>('revenue');
  const navigate = useNavigate();
  const { mode } = useDataMode();

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchMetricsByMode(mode)
      .then((data) => {
        setRecords(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [mode]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-secondary">Loading portfolio data...</div>
      </div>
    );
  }

  if (error || records.length === 0) {
    // Empty + live mode → dedicated empty state explaining why (no extraction run yet).
    // Empty + demo mode → something's actually wrong with the baked data.
    if (mode === 'live' && !error) {
      return <EmptyLiveState subject="Portfolio data" />;
    }
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-text-secondary">
          {error || 'No data available. Run the extraction pipeline first.'}
        </div>
        <button
          onClick={() => navigate('/live')}
          className="px-4 py-2 bg-accent text-white rounded text-sm font-medium hover:opacity-90"
        >
          Go to Extraction
        </button>
      </div>
    );
  }

  const companies = getUniqueCompanies(records);
  const quarters = getUniqueQuarters(records);
  const latestQ = getLatestQuarter(records);
  const currentQ = selectedQuarter ?? latestQ;
  // Scope to records at-or-before the selected quarter so QoQ / trends reflect the point-in-time view
  const currentKey = quarterSortKey(currentQ);
  const scopedRecords = records.filter((r) => quarterSortKey(r.quarter) <= currentKey);
  const quarterRecords = records.filter((r) => r.quarter === currentQ && r.status !== 'dropped');
  const insights = generateInsights(records, currentQ);

  // ---------- KPI computations ----------
  // Persistent totals (shown in the page subtitle - don't change with quarter filter)
  const totalCompanies = companies.length;
  const totalRecords = records.filter((r) => r.status !== 'dropped').length;

  // Previous quarter for QoQ deltas on portfolio-level aggregates
  const sortedQs = [...quarters].sort((a, b) => quarterSortKey(a) - quarterSortKey(b));
  const currentIdx = sortedQs.indexOf(currentQ);
  const prevQ = currentIdx > 0 ? sortedQs[currentIdx - 1] : null;
  const prevQuarterRecords = prevQ
    ? records.filter((r) => r.quarter === prevQ && r.status !== 'dropped')
    : [];

  // Per-quarter KPIs
  const usdRevenueSum = quarterRecords
    .filter((r) => r.metric === 'revenue' && r.currency === 'USD' && r.value !== null && r.unit === 'M')
    .reduce((sum, r) => sum + (r.value ?? 0), 0);
  const usdReporterCount = quarterRecords.filter(
    (r) => r.metric === 'revenue' && r.currency === 'USD' && r.value !== null
  ).length;
  const prevUsdRevenueSum = prevQuarterRecords
    .filter((r) => r.metric === 'revenue' && r.currency === 'USD' && r.value !== null && r.unit === 'M')
    .reduce((sum, r) => sum + (r.value ?? 0), 0);
  const usdRevenueQoQ =
    prevQ && prevUsdRevenueSum > 0
      ? ((usdRevenueSum - prevUsdRevenueSum) / prevUsdRevenueSum) * 100
      : null;

  const avgGM = (() => {
    const gmVals = quarterRecords
      .filter((r) => r.metric === 'gross_margin' && r.value !== null)
      .map((r) => r.value!);
    return gmVals.length > 0 ? gmVals.reduce((a, b) => a + b, 0) / gmVals.length : 0;
  })();
  const prevAvgGM = (() => {
    const gmVals = prevQuarterRecords
      .filter((r) => r.metric === 'gross_margin' && r.value !== null)
      .map((r) => r.value!);
    return gmVals.length > 0 ? gmVals.reduce((a, b) => a + b, 0) / gmVals.length : 0;
  })();
  const avgGMQoQ = prevQ && prevAvgGM > 0 ? avgGM - prevAvgGM : null; // percentage points

  // Reporting coverage this quarter (distinct companies with any value)
  const reportingCompanies = new Set(
    quarterRecords.filter((r) => r.value !== null).map((r) => r.company)
  ).size;
  const quarterDataPoints = quarterRecords.filter((r) => r.value !== null).length;

  // Weighted-or-simple avg NRR for the quarter
  const nrrVals = quarterRecords
    .filter((r) => r.metric === 'net_retention' && r.value !== null)
    .map((r) => r.value!);
  const avgNRR = nrrVals.length > 0 ? nrrVals.reduce((a, b) => a + b, 0) / nrrVals.length : null;
  const prevNrrVals = prevQuarterRecords
    .filter((r) => r.metric === 'net_retention' && r.value !== null)
    .map((r) => r.value!);
  const prevAvgNRR =
    prevNrrVals.length > 0 ? prevNrrVals.reduce((a, b) => a + b, 0) / prevNrrVals.length : null;
  const nrrQoQ = prevAvgNRR !== null && avgNRR !== null ? avgNRR - prevAvgNRR : null;

  // ---- Cross-company trends (multi-line, metric-swappable) ----
  // Only include companies with 2+ quarters of the selected metric for trend visibility
  const companiesWithTrends = companies.filter((c) => {
    const recs = records.filter(
      (r) => r.company === c && r.metric === trendMetric && r.value !== null
    );
    return recs.length >= 2;
  });

  const trendData = quarters.map((q) => {
    const point: Record<string, string | number | null> = { quarter: q };
    for (const c of companiesWithTrends) {
      const rec = records.find(
        (r) => r.company === c && r.quarter === q && r.metric === trendMetric
      );
      point[c] = rec?.value ?? null;
    }
    return point;
  });

  // Currency-denominated metrics that don't share a common unit across reporters.
  // For these, we note the currency mix explicitly rather than silently plotting
  // GBP/CAD values on a $-scaled axis.
  const CURRENCY_METRICS: MetricName[] = ['revenue', 'arr', 'cash', 'burn'];
  const trendIsCurrency = CURRENCY_METRICS.includes(trendMetric);
  const trendCurrencies = trendIsCurrency
    ? Array.from(
        new Set(
          companiesWithTrends.map((c) => getCompanyCurrency(records, c))
        )
      ).sort()
    : [];

  // Representative record for axis-unit derivation (companies share same unit per metric
  // in our schema - e.g., all revenue is reported in 'M', all churn in '%')
  const trendUnit = (() => {
    const sample = records.find((r) => r.metric === trendMetric && r.value !== null);
    return sample?.unit ?? '';
  })();

  const formatTrendTick = (v: number) => {
    if (trendUnit === '%') return `${v}%`;
    if (trendUnit === 'M' || trendUnit === 'B' || trendUnit === 'k') {
      // Axis shows magnitude only; tooltip carries the currency symbol
      return `${v}${trendUnit}`;
    }
    if (trendMetric === 'headcount') return Math.round(v).toLocaleString();
    return v.toString();
  };

  // ---- Portfolio-level trendline (aggregated revenue in USD) ----
  const portfolioRevenue = getPortfolioTimeSeries(records, 'revenue');

  // ---- Scatter chart: revenue growth vs gross margin for the selected quarter ----
  const scatterData = companies
    .map((c) => {
      const qoq = computeQoQChange(scopedRecords, c, 'revenue');
      const gmRec = quarterRecords.find(
        (r) => r.company === c && r.metric === 'gross_margin' && r.value !== null
      );
      const revRec = quarterRecords.find(
        (r) => r.company === c && r.metric === 'revenue' && r.value !== null
      );
      if (!gmRec || !revRec) return null;
      return {
        company: c,
        grossMargin: gmRec.value!,
        revenueGrowth: qoq.change ?? 0,
        revenue: revRec.value ?? 1,
        hasGrowthData: qoq.change !== null,
        color: getCompanyColor(c),
      };
    })
    .filter(Boolean) as {
    company: string;
    grossMargin: number;
    revenueGrowth: number;
    revenue: number;
    hasGrowthData: boolean;
    color: string;
  }[];

  const avgGrossMargin = scatterData.length > 0
    ? scatterData.reduce((s, d) => s + d.grossMargin, 0) / scatterData.length
    : 70;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Portfolio Overview</h1>
          <p className="text-sm text-text-secondary mt-1">
            {currentQ} snapshot
            <span className="text-text-muted">
              {' '}· {totalCompanies} companies · {quarters.length} quarters ·{' '}
              {totalRecords} data points tracked
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted uppercase tracking-wider">As of</span>
          <select
            value={currentQ}
            onChange={(e) => setSelectedQuarter(e.target.value)}
            className="bg-bg-panel border border-border rounded px-2.5 py-1.5 text-sm text-text-primary font-mono focus:outline-none focus:border-accent cursor-pointer"
          >
            {[...quarters].reverse().map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Cards - all four reflect the selected quarter; QoQ deltas key the color */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard
          label="Revenue (USD)"
          value={`$${usdRevenueSum.toFixed(1)}M`}
          subtext={`${usdReporterCount} USD reporters · ${currentQ}`}
          accentColor="bg-success"
          delta={
            usdRevenueQoQ !== null
              ? {
                  value: usdRevenueQoQ,
                  label: `${usdRevenueQoQ >= 0 ? '+' : ''}${usdRevenueQoQ.toFixed(1)}% QoQ`,
                  higherIsBetter: true,
                }
              : null
          }
        />
        <KPICard
          label="Avg Gross Margin"
          value={`${avgGM.toFixed(1)}%`}
          subtext={currentQ}
          accentColor="bg-warning"
          delta={
            avgGMQoQ !== null
              ? {
                  value: avgGMQoQ,
                  label: `${avgGMQoQ >= 0 ? '+' : ''}${avgGMQoQ.toFixed(1)}pp QoQ`,
                  higherIsBetter: true,
                }
              : null
          }
        />
        <KPICard
          label="Avg Net Retention"
          value={avgNRR !== null ? `${avgNRR.toFixed(1)}%` : '\u2014'}
          subtext={`${nrrVals.length} of ${totalCompanies} reporting NRR`}
          accentColor="bg-accent"
          delta={
            nrrQoQ !== null
              ? {
                  value: nrrQoQ,
                  label: `${nrrQoQ >= 0 ? '+' : ''}${nrrQoQ.toFixed(1)}pp QoQ`,
                  higherIsBetter: true,
                }
              : null
          }
        />
        <KPICard
          label="Reporting This Quarter"
          value={`${reportingCompanies} / ${totalCompanies}`}
          subtext={`${quarterDataPoints} data points in ${currentQ}`}
          accentColor="bg-accent"
        />
      </div>

      {/* Main Content: Grid + Insights */}
      <div className="grid grid-cols-[1fr_320px] gap-6">
        {/* Company x Metric Grid */}
        <div className="bg-bg-panel border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-xs text-text-secondary uppercase tracking-wider font-medium">
              {currentQ} Company Metrics
            </h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-muted">Click a company for details</span>
              <a
                href={getCsvUrl(mode)}
                download="portfolio_metrics.csv"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text-primary bg-bg-hover hover:bg-bg-primary border border-border rounded transition-colors"
                title={
                  mode === 'live'
                    ? 'Download portfolio_metrics.csv - streamed live from the FastAPI backend'
                    : 'Download portfolio_metrics.csv - the canonical pipeline artifact (one row per company-quarter, display-formatted values, warnings aggregated)'
                }
              >
                {'\u2193'} CSV
              </a>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2.5 text-xs text-text-secondary font-medium uppercase tracking-wider sticky left-0 bg-bg-panel z-10">
                    Company
                  </th>
                  {ALL_METRICS.map((m) => (
                    <th
                      key={m}
                      className="text-right px-3 py-2.5 text-xs text-text-secondary font-medium uppercase tracking-wider whitespace-nowrap"
                    >
                      {METRIC_LABELS[m]}
                    </th>
                  ))}
                  <th
                    className="text-right px-3 py-2.5 text-xs text-text-secondary font-medium uppercase tracking-wider whitespace-nowrap border-l border-border/50"
                    title="Derived: cash / |monthly burn|. Not extracted - computed from the cash and burn columns."
                  >
                    <span className="inline-flex items-center gap-1.5">
                      Runway
                      <span className="text-[9px] px-1 py-0.5 rounded bg-accent/15 text-accent font-bold tracking-wider">
                        DERIVED
                      </span>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => {
                  const currency = getCompanyCurrency(records, company);
                  const isDemo = records.some((r) => r.company === company && r._demo);
                  const dip = hasRevenueDip(scopedRecords, company);
                  const runway = computeRunway(quarterRecords, company, currentQ);
                  const band = runwayBand(runway);
                  return (
                    <tr
                      key={company}
                      onClick={() => navigate(`/company/${encodeURIComponent(company)}`)}
                      className="group border-b border-border/50 hover:bg-bg-hover cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-2.5 font-medium text-text-primary whitespace-nowrap sticky left-0 bg-bg-panel group-hover:bg-bg-hover z-10 transition-colors">
                        <div className="flex items-center gap-2">
                          {company}
                          {isDemo && (
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-bold tracking-wider"
                              title="Sample data - not from the provided PDF set. Showcases pipeline handling of an additional currency (CAD) and error-mode edge cases in the audit trail."
                            >
                              DEMO
                            </span>
                          )}
                          {currency !== 'USD' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning-dim text-warning font-medium">
                              {currency}
                            </span>
                          )}
                          {/* Revenue dip flag - fires at >3% QoQ decline so it lights up
                              one tier earlier than the "Attention Needed" insight card. */}
                          {dip.dipped && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-error/15 text-error font-semibold"
                              title={`Revenue declined ${dip.label} QoQ - investigate cause`}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/company/${encodeURIComponent(company)}?metric=revenue`);
                              }}
                            >
                              <span className="w-1 h-1 rounded-full bg-error" />
                              Rev dip {dip.label}
                            </span>
                          )}
                        </div>
                      </td>
                      {ALL_METRICS.map((metric) => {
                        const rec = quarterRecords.find(
                          (r) => r.company === company && r.metric === metric
                        );
                        const qoq = computeQoQChange(scopedRecords, company, metric);
                        return (
                          <td key={metric} className="text-right px-3 py-2.5 whitespace-nowrap">
                            {rec && rec.value !== null ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <span className="text-text-primary">{formatValue(rec)}</span>
                                <QoQIndicator label={qoq.label} isImproving={qoq.isImproving} />
                              </div>
                            ) : (
                              <span className="text-text-muted">{'\u2014'}</span>
                            )}
                          </td>
                        );
                      })}
                      {/* Runway - derived, not extracted. Tone-colored by band so
                          critical-cash-position companies pop without reading the number. */}
                      <td className="text-right px-3 py-2.5 whitespace-nowrap border-l border-border/50">
                        {runway !== null ? (
                          <span
                            className={`inline-block text-sm font-semibold px-2 py-0.5 rounded ${
                              band === 'critical'
                                ? 'bg-error/15 text-error'
                                : band === 'caution'
                                  ? 'bg-warning/15 text-warning'
                                  : 'bg-success/10 text-success'
                            }`}
                            title={`Runway ≈ ${runway.toFixed(1)} months at current monthly burn`}
                          >
                            {runway.toFixed(1)}mo
                          </span>
                        ) : (
                          <span className="text-text-muted" title="Cash + burn both required; skipped when cash-flow positive or unit mismatch">
                            {'\u2014'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Insights Sidebar */}
        <InsightsPanel insights={insights} />
      </div>

      {/* Portfolio Trendlines + Revenue Growth vs Margin scatter */}
      <div className="grid grid-cols-2 gap-6">
        {/* Portfolio Revenue Over Time */}
        <div className="bg-bg-panel border border-border rounded-lg p-4">
          <h3 className="text-xs text-text-secondary uppercase tracking-wider font-medium mb-1">
            Portfolio Revenue Over Time (USD)
          </h3>
          <p className="text-xs text-text-muted mb-4">
            Aggregate quarterly revenue across USD-reporting companies
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={portfolioRevenue} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis
                dataKey="quarter"
                tick={{ fill: '#8b949e', fontSize: 11 }}
                axisLine={{ stroke: '#30363d' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#8b949e', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${v}M`}
                width={60}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  color: '#e6edf3',
                  fontSize: '12px',
                }}
                formatter={((val: number, _name: string, props: { payload: { count: number } }) => [
                  `$${val.toFixed(1)}M (${props.payload.count} companies)`,
                  'Revenue',
                ]) as never}
              />
              <Bar dataKey="value" fill="#58a6ff" fillOpacity={0.85} radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Revenue Growth vs Gross Margin */}
        <div className="bg-bg-panel border border-border rounded-lg p-4">
          <h3 className="text-xs text-text-secondary uppercase tracking-wider font-medium mb-1">
            Portfolio Positioning
          </h3>
          <p className="text-xs text-text-muted mb-4">
            Revenue growth (QoQ) vs. gross margin - bubble size = revenue
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis
                type="number"
                dataKey="grossMargin"
                name="Gross Margin"
                tick={{ fill: '#8b949e', fontSize: 11 }}
                axisLine={{ stroke: '#30363d' }}
                tickLine={false}
                tickFormatter={(v: number) => `${v}%`}
                label={{ value: 'Gross Margin', position: 'bottom', fill: '#8b949e', fontSize: 10, offset: -2 }}
              />
              <YAxis
                type="number"
                dataKey="revenueGrowth"
                name="Revenue Growth"
                tick={{ fill: '#8b949e', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
                width={50}
                label={{ value: 'Rev Growth QoQ', angle: -90, position: 'insideLeft', fill: '#8b949e', fontSize: 10, offset: 10 }}
              />
              <ZAxis type="number" dataKey="revenue" range={[40, 400]} />
              <ReferenceLine y={0} stroke="#30363d" strokeDasharray="3 3" />
              <ReferenceLine x={avgGrossMargin} stroke="#30363d" strokeDasharray="3 3" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  color: '#e6edf3',
                  fontSize: '12px',
                }}
                itemStyle={{ color: '#e6edf3' }}
                labelStyle={{ color: '#e6edf3', fontWeight: 500 }}
                formatter={((val: number, name: string) => {
                  if (name === 'Gross Margin') return [`${val}%`, name];
                  if (name === 'Revenue Growth') return [`${val > 0 ? '+' : ''}${val.toFixed(1)}%`, name];
                  return [val, name];
                }) as never}
                labelFormatter={((_label: unknown, payload: { payload?: { company?: string } }[]) =>
                  payload?.[0]?.payload?.company ?? ''
                ) as never}
              />
              <Scatter data={scatterData}>
                {scatterData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} fillOpacity={0.85} stroke={entry.color} strokeWidth={1} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {scatterData.map((d) => (
              <span key={d.company} className="flex items-center gap-1.5 text-xs text-text-primary">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                {d.company}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Cross-Company Trends - metric-swappable */}
      {companiesWithTrends.length > 0 && (
        <div className="bg-bg-panel border border-border rounded-lg p-4">
          <div className="flex items-start justify-between mb-4 gap-4">
            <div>
              <h3 className="text-xs text-text-secondary uppercase tracking-wider font-medium mb-1">
                {METRIC_LABELS[trendMetric]} Trends by Company
              </h3>
              <p className="text-xs text-text-muted">
                Quarterly {METRIC_LABELS[trendMetric].toLowerCase()} for companies with multi-quarter coverage
                {trendIsCurrency && trendCurrencies.length > 1 && (
                  <span className="ml-2 text-warning">
                    · Values in native currency ({trendCurrencies.join(', ')}) - not FX-normalized
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-text-muted uppercase tracking-wider">Metric</span>
              <select
                value={trendMetric}
                onChange={(e) => setTrendMetric(e.target.value as MetricName)}
                className="bg-bg-primary border border-border rounded px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent cursor-pointer"
              >
                {ALL_METRICS.map((m) => (
                  <option key={m} value={m}>
                    {METRIC_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={trendData} margin={{ top: 5, right: 30, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis
                dataKey="quarter"
                tick={{ fill: '#8b949e', fontSize: 11 }}
                axisLine={{ stroke: '#30363d' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#8b949e', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatTrendTick}
                width={70}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  color: '#e6edf3',
                  fontSize: '12px',
                }}
                itemStyle={{ color: '#e6edf3' }}
                labelStyle={{ color: '#e6edf3', fontWeight: 500 }}
                formatter={((val: number | null, name: string) => {
                  if (val === null) return ['-', name];
                  // Use a representative record for this company+metric to format correctly
                  const rec = records.find(
                    (r) => r.company === name && r.metric === trendMetric && r.value !== null
                  );
                  const currency = getCompanyCurrency(records, name);
                  const unit = rec?.unit ?? '';
                  return [formatValueShort(val, unit, currency), name];
                }) as never}
              />
              <Legend
                verticalAlign="bottom"
                iconType="line"
                wrapperStyle={{ fontSize: '11px', color: '#e6edf3', paddingTop: '8px' }}
              />
              {companiesWithTrends.map((c) => (
                <Line
                  key={c}
                  type="monotone"
                  dataKey={c}
                  stroke={getCompanyColor(c)}
                  strokeWidth={2}
                  dot={{ fill: getCompanyColor(c), stroke: '#0d1117', strokeWidth: 2, r: 4 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
