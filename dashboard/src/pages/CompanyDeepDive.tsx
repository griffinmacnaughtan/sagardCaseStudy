import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  fetchMetricsByMode,
  getCompanyRecords,
  getUniqueQuarters,
  computeQoQChange,
  formatValue,
  getCurrencySymbol,
  getCompanyCurrency,
  quarterSortKey,
  formatValueShort,
  getPdfUrl,
  computeRunway,
  runwayBand,
} from '../lib/data';
import { useDataMode } from '../lib/mode';
import type { MetricRecord, MetricName } from '../lib/types';
import { ALL_METRICS, METRIC_LABELS } from '../lib/types';
import QoQIndicator from '../components/QoQIndicator';
import EmptyLiveState from '../components/EmptyLiveState';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

export default function CompanyDeepDive() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusMetric = searchParams.get('metric') as MetricName | null;
  const [allRecords, setAllRecords] = useState<MetricRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState<MetricRecord | null>(null);
  const [pdfToast, setPdfToast] = useState(false);
  const [highlightMetric, setHighlightMetric] = useState<MetricName | null>(null);
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { mode } = useDataMode();

  const companyName = decodeURIComponent(name || '');

  useEffect(() => {
    setLoading(true);
    fetchMetricsByMode(mode)
      .then((data) => {
        setAllRecords(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [mode]);

  // Deep-link from Portfolio Insights: /company/X?metric=revenue → scroll to the revenue chart,
  // pre-select the latest record in the source-tracing panel, and briefly ring the chart so the
  // analyst's eye lands where it should.
  useEffect(() => {
    if (!focusMetric || allRecords.length === 0) return;
    const latestRec = allRecords
      .filter((r) => r.company === companyName && r.metric === focusMetric && r.value !== null)
      .sort((a, b) => quarterSortKey(b.quarter) - quarterSortKey(a.quarter))[0];
    if (latestRec) setSelectedRecord(latestRec);

    setHighlightMetric(focusMetric);
    // Defer scroll until after layout settles
    const t = setTimeout(() => {
      const el = chartRefs.current[focusMetric];
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    // Fade the ring after 2.5s so it doesn't become permanent visual noise
    const ringTimer = setTimeout(() => setHighlightMetric(null), 2500);
    return () => {
      clearTimeout(t);
      clearTimeout(ringTimer);
    };
  }, [focusMetric, allRecords, companyName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-secondary">Loading...</div>
      </div>
    );
  }

  const companyRecords = getCompanyRecords(allRecords, companyName);
  if (companyRecords.length === 0) {
    // Live mode + no records at all → not "company missing", just "no live data".
    // Route through the shared empty state so the message matches the other pages.
    if (mode === 'live' && allRecords.length === 0) {
      return <EmptyLiveState subject="Company data" />;
    }
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-text-secondary">No data found for "{companyName}"</div>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-accent text-white rounded text-sm font-medium"
        >
          Back to Portfolio
        </button>
      </div>
    );
  }

  const currency = getCompanyCurrency(allRecords, companyName);
  const currSym = getCurrencySymbol(currency);
  const quarters = getUniqueQuarters(companyRecords);
  const availableMetrics = [...new Set(companyRecords.map((r) => r.metric))] as MetricName[];
  const orderedMetrics = ALL_METRICS.filter((m) => availableMetrics.includes(m));

  // Build time-series data for each metric
  const buildChartData = (metric: MetricName) => {
    return quarters
      .map((q) => {
        const rec = companyRecords.find((r) => r.quarter === q && r.metric === metric);
        return {
          quarter: q,
          value: rec?.value ?? null,
          record: rec ?? null,
        };
      })
      .sort((a, b) => quarterSortKey(a.quarter) - quarterSortKey(b.quarter));
  };

  // Completeness heatmap data
  const completenessData = quarters.map((q) => {
    const qRecords = companyRecords.filter((r) => r.quarter === q);
    return {
      quarter: q,
      metrics: ALL_METRICS.map((m) => ({
        metric: m,
        hasData: qRecords.some((r) => r.metric === m && r.value !== null),
        status: qRecords.find((r) => r.metric === m)?.status ?? 'missing',
      })),
    };
  });

  const CHART_COLOR = '#58a6ff';
  const formatYAxis = (value: number, metric: MetricName) => {
    const rec = companyRecords.find((r) => r.metric === metric);
    const unit = rec?.unit ?? '';
    if (unit === '%') return `${value}%`;
    if (unit === 'M') return `${currSym}${value}M`;
    if (metric === 'headcount') return value.toString();
    return value.toString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="text-text-secondary hover:text-text-primary text-sm"
        >
          {'\u2190'} Portfolio
        </button>
        <div className="w-px h-5 bg-border" />
        <div>
          <h1 className="text-xl font-semibold text-text-primary flex items-center gap-3">
            {companyName}
            {companyRecords.some((r) => r._demo) && (
              <span
                className="text-[10px] px-2 py-0.5 rounded bg-accent/20 text-accent font-bold tracking-wider"
                title="Sample data - not from the provided PDF set"
              >
                DEMO
              </span>
            )}
            {currency !== 'USD' && (
              <span className="text-xs px-2 py-0.5 rounded bg-warning-dim text-warning font-medium">
                {currency}
              </span>
            )}
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {quarters.length} quarters | {orderedMetrics.length} metrics tracked
          </p>
        </div>
      </div>

      {/* Metric Summary Cards (8 extracted + 1 derived Runway) */}
      <div className="grid grid-cols-4 gap-3">
        {orderedMetrics.map((metric) => {
          const qoq = computeQoQChange(allRecords, companyName, metric);
          const latestRec = companyRecords
            .filter((r) => r.metric === metric && r.value !== null)
            .sort((a, b) => quarterSortKey(b.quarter) - quarterSortKey(a.quarter))[0];

          return (
            <div
              key={metric}
              className="bg-bg-panel border border-border rounded-lg p-3 cursor-pointer hover:border-accent/50 transition-colors"
              onClick={() => latestRec && setSelectedRecord(latestRec)}
            >
              <div className="text-xs text-text-secondary uppercase tracking-wider font-medium">
                {METRIC_LABELS[metric]}
              </div>
              <div className="text-lg font-semibold text-text-primary mt-1">
                {latestRec ? formatValue(latestRec) : '\u2014'}
              </div>
              <QoQIndicator label={qoq.label} isImproving={qoq.isImproving} />
            </div>
          );
        })}
        {/* Derived: Months of cash remaining. Shown only when cash + burn are
            both present for the latest quarter; computed as cash / |burn|. */}
        {(() => {
          const latestQ = quarters[quarters.length - 1];
          const latestRecs = companyRecords.filter((r) => r.quarter === latestQ);
          const runway = computeRunway(latestRecs, companyName, latestQ);
          const band = runwayBand(runway);
          if (runway === null) return null;
          const toneBorder =
            band === 'critical'
              ? 'border-error/60'
              : band === 'caution'
                ? 'border-warning/60'
                : 'border-success/50';
          const toneText =
            band === 'critical'
              ? 'text-error'
              : band === 'caution'
                ? 'text-warning'
                : 'text-success';
          return (
            <div
              className={`bg-bg-panel border rounded-lg p-3 ${toneBorder}`}
              title="Derived: cash / |monthly burn|. Not an extracted metric - computed from Cash and Burn for the latest quarter."
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary uppercase tracking-wider font-medium">
                  Runway
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted font-bold tracking-wider">
                  DERIVED
                </span>
              </div>
              <div className={`text-lg font-semibold mt-1 ${toneText}`}>
                {runway.toFixed(1)} mo
              </div>
              <div className="text-[11px] text-text-muted">at current burn · {latestQ}</div>
            </div>
          );
        })()}
      </div>

      {/* Charts + Source Tracing */}
      <div className="grid grid-cols-[1fr_360px] gap-6">
        {/* Time Series Charts */}
        <div className="space-y-4">
          {orderedMetrics.map((metric) => {
            const chartData = buildChartData(metric);
            const hasData = chartData.some((d) => d.value !== null);
            if (!hasData) return null;

            const isFocused = highlightMetric === metric;
            return (
              <div
                key={metric}
                ref={(el) => {
                  chartRefs.current[metric] = el;
                }}
                className={`bg-bg-panel border rounded-lg p-4 transition-colors ${
                  isFocused ? 'border-accent ring-2 ring-accent/40' : 'border-border'
                }`}
              >
                <h3 className="text-xs text-text-secondary uppercase tracking-wider font-medium mb-3">
                  {METRIC_LABELS[metric]}
                </h3>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart
                    data={chartData}
                    margin={{ top: 5, right: 20, bottom: 5, left: 10 }}
                  >
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
                      tickFormatter={(v: number) => formatYAxis(v, metric)}
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
                      formatter={((val: number) => {
                        const rec = companyRecords.find((r) => r.metric === metric);
                        return [
                          formatValueShort(val, rec?.unit ?? '', currency),
                          METRIC_LABELS[metric],
                        ];
                      }) as never}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={CHART_COLOR}
                      strokeWidth={2}
                      dot={{
                        fill: CHART_COLOR,
                        stroke: '#0d1117',
                        strokeWidth: 2,
                        r: 5,
                        cursor: 'pointer',
                      }}
                      activeDot={{
                        fill: '#fff',
                        stroke: CHART_COLOR,
                        strokeWidth: 2,
                        r: 7,
                        cursor: 'pointer',
                        onClick: ((_e: unknown, payload: unknown) => {
                          const p = payload as { payload?: { record?: MetricRecord } };
                          if (p?.payload?.record) {
                            setSelectedRecord(p.payload.record);
                          }
                        }) as never,
                      }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Source Tracing Panel */}
          <div className="bg-bg-panel border border-border rounded-lg p-4 sticky top-20">
            <h3 className="text-xs text-text-secondary uppercase tracking-wider font-medium mb-3">
              Source Tracing
            </h3>
            {selectedRecord ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2 text-text-primary font-medium">
                  {METRIC_LABELS[selectedRecord.metric as MetricName]} - {selectedRecord.quarter}
                </div>
                <div className="space-y-2">
                  <DetailRow label="Display Value" value={formatValue(selectedRecord)} />
                  <DetailRow label="Raw Value" value={selectedRecord.raw_value} />
                  <DetailRow label="Raw Label" value={selectedRecord.raw_label} />
                  <DetailRow label="Source" value={selectedRecord.source} />
                  <DetailRow label="Source File" value={selectedRecord.source_file} />
                  <DetailRow label="Currency" value={selectedRecord.currency} />
                  <DetailRow
                    label="Status"
                    value={selectedRecord.status}
                    statusColor={
                      selectedRecord.status === 'extracted'
                        ? 'text-success'
                        : selectedRecord.status === 'warned'
                          ? 'text-warning'
                          : 'text-error'
                    }
                  />
                  {selectedRecord.source_page && (
                    <DetailRow label="Page" value={`p. ${selectedRecord.source_page}`} />
                  )}
                  {selectedRecord.notes && <DetailRow label="Notes" value={selectedRecord.notes} />}
                  {selectedRecord.warnings.length > 0 && (
                    <div className="mt-2 p-2 bg-error-dim rounded text-xs text-error">
                      {selectedRecord.warnings.map((w, i) => (
                        <div key={i}>{w.detail || w.type}</div>
                      ))}
                    </div>
                  )}
                  {selectedRecord.source_file && (
                    <button
                      onClick={() => {
                        // Synthetic WealthSimple records have no PDF on disk -
                        // show the toast instead of letting the browser 404.
                        if (selectedRecord._demo) {
                          setPdfToast(true);
                          setTimeout(() => setPdfToast(false), 2500);
                          return;
                        }
                        const url = getPdfUrl(
                          selectedRecord.source_file,
                          mode,
                          selectedRecord.source_page,
                          selectedRecord.raw_value,
                        );
                        window.open(url, '_blank', 'noopener,noreferrer');
                      }}
                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-bg-hover text-text-muted text-xs rounded font-medium hover:text-text-secondary transition-colors"
                      title={
                        selectedRecord.source_page
                          ? `Opens ${selectedRecord.source_file} at page ${selectedRecord.source_page} and searches for "${selectedRecord.raw_value}"`
                          : `Opens ${selectedRecord.source_file}`
                      }
                    >
                      View Source PDF
                      {selectedRecord.source_page ? ` (p. ${selectedRecord.source_page})` : ''} {'\u2197'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm text-text-muted py-8 text-center">
                Click a data point or metric card to see its source tracing
              </div>
            )}
          </div>

          {/* Completeness Heatmap */}
          <div className="bg-bg-panel border border-border rounded-lg p-4">
            <h3 className="text-xs text-text-secondary uppercase tracking-wider font-medium mb-3">
              Data Completeness
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left py-1 pr-2 text-text-muted" />
                    {completenessData.map((q) => (
                      <th
                        key={q.quarter}
                        className="text-center py-1 px-1 text-text-muted font-normal whitespace-nowrap"
                      >
                        {q.quarter}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ALL_METRICS.map((metric) => (
                    <tr key={metric}>
                      <td className="py-1 pr-2 text-text-secondary whitespace-nowrap">
                        {METRIC_LABELS[metric]}
                      </td>
                      {completenessData.map((q) => {
                        const cell = q.metrics.find((m) => m.metric === metric);
                        let bg = 'bg-bg-primary';
                        if (cell?.hasData) {
                          bg =
                            cell.status === 'extracted'
                              ? 'bg-success/30'
                              : cell.status === 'warned'
                                ? 'bg-warning/30'
                                : 'bg-error/30';
                        }
                        return (
                          <td key={q.quarter} className="py-1 px-1">
                            <div className={`w-full h-5 rounded ${bg}`} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs text-text-muted">
              <span className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-success/30" /> Extracted
              </span>
              <span className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-warning/30" /> Warned
              </span>
              <span className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-bg-primary" /> Missing
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* PDF unavailable toast - only fires for synthetic (DEMO-tagged) records */}
      {pdfToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-bg-panel border border-border rounded-lg shadow-lg text-sm text-text-secondary animate-in fade-in slide-in-from-bottom-2">
          No PDF for this record - it's synthetic demo data, not from the provided PDF set
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  statusColor,
}: {
  label: string;
  value: string;
  statusColor?: string;
}) {
  return (
    <div className="flex justify-between items-start gap-2">
      <span className="text-text-muted shrink-0">{label}</span>
      <span className={`text-right ${statusColor || 'text-text-primary'} break-all`}>{value}</span>
    </div>
  );
}
