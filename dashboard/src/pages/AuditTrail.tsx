import { useEffect, useState } from 'react';
import { fetchLogByMode, getPdfUrl } from '../lib/data';
import { useDataMode } from '../lib/mode';
import type { DataMode } from '../lib/mode';
import type { LogEntry } from '../lib/types';
import { METRIC_LABELS } from '../lib/types';
import type { MetricName } from '../lib/types';
import EmptyLiveState from '../components/EmptyLiveState';

export default function AuditTrail() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [pdfToast, setPdfToast] = useState(false);
  const { mode } = useDataMode();

  useEffect(() => {
    setLoading(true);
    fetchLogByMode(mode)
      .then((data) => {
        setLog(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [mode]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-secondary">Loading audit trail...</div>
      </div>
    );
  }

  // Live mode with no log entries → extraction hasn't been run yet.
  if (log.length === 0 && mode === 'live') {
    return <EmptyLiveState subject="Audit trail" />;
  }

  const totalExtracted = log.reduce((sum, e) => sum + e.metrics_extracted, 0);
  const totalDropped = log.reduce((sum, e) => sum + (e.metrics_dropped || 0), 0);
  const totalFiles = log.length;
  const filesWithWarnings = log.filter(
    (e) => (e.validation_warnings?.length ?? 0) > 0
  ).length;
  const hasDemoEntries = log.some((e) => e._demo);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Extraction Audit Trail</h1>
        <p className="text-sm text-text-secondary mt-1">
          File-by-file extraction log with validation results
        </p>
      </div>

      {/* Demo-mode banner: clarifies that some entries are synthetic */}
      {hasDemoEntries && (
        <div className="bg-accent-dim border border-accent/30 rounded-lg px-4 py-3 flex items-start gap-3">
          <div className="mt-0.5 px-2 py-0.5 bg-accent text-white text-[10px] font-bold rounded tracking-wider shrink-0">
            DEMO
          </div>
          <div className="text-sm text-text-primary leading-relaxed">
            <span className="font-medium">Synthetic entries included for demonstration.</span>
            <span className="text-text-secondary">
              {' '}
              The real extraction run on the 25 provided PDFs completed cleanly (zero warnings). WealthSimple entries are
              labeled <span className="inline-block px-1.5 py-0.5 bg-accent/20 text-accent text-[10px] font-bold rounded tracking-wider mx-0.5">DEMO</span>
              below to showcase the pipeline's warning / grounding / failure-mode handling on edge cases. These do not appear in live mode.
            </span>
          </div>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Files Processed" value={totalFiles.toString()} />
        <StatCard label="Metrics Extracted" value={totalExtracted.toString()} color="text-success" />
        <StatCard label="Values Dropped" value={totalDropped.toString()} color="text-error" />
        <StatCard
          label="Files with Warnings"
          value={filesWithWarnings.toString()}
          color={filesWithWarnings > 0 ? 'text-warning' : 'text-success'}
        />
      </div>

      {/* Log Table */}
      <div className="bg-bg-panel border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs text-text-secondary font-medium uppercase tracking-wider">
                Source File
              </th>
              <th className="text-left px-4 py-3 text-xs text-text-secondary font-medium uppercase tracking-wider">
                Status
              </th>
              <th className="text-left px-4 py-3 text-xs text-text-secondary font-medium uppercase tracking-wider">
                Companies
              </th>
              <th className="text-right px-4 py-3 text-xs text-text-secondary font-medium uppercase tracking-wider">
                Extracted
              </th>
              <th className="text-right px-4 py-3 text-xs text-text-secondary font-medium uppercase tracking-wider">
                Dropped
              </th>
              <th className="text-center px-4 py-3 text-xs text-text-secondary font-medium uppercase tracking-wider">
                Expand
              </th>
            </tr>
          </thead>
          <tbody>
            {log.map((entry) => {
              const isExpanded = expandedRow === entry.filename;
              const hasWarnings = (entry.validation_warnings?.length ?? 0) > 0;

              return (
                <LogRow
                  key={entry.filename}
                  entry={entry}
                  isExpanded={isExpanded}
                  hasWarnings={hasWarnings}
                  mode={mode}
                  onToggle={() =>
                    setExpandedRow(isExpanded ? null : entry.filename)
                  }
                  onPdfUnavailable={() => {
                    setPdfToast(true);
                    setTimeout(() => setPdfToast(false), 2500);
                  }}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* PDF unavailable toast - only fires for synthetic (DEMO-tagged) entries */}
      {pdfToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-bg-panel border border-border rounded-lg shadow-lg text-sm text-text-secondary">
          No PDF for this entry - it's synthetic demo data, not from the provided PDF set
        </div>
      )}
    </div>
  );
}

function LogRow({
  entry,
  isExpanded,
  hasWarnings,
  mode,
  onToggle,
  onPdfUnavailable,
}: {
  entry: LogEntry;
  isExpanded: boolean;
  hasWarnings: boolean;
  mode: DataMode;
  onToggle: () => void;
  onPdfUnavailable: () => void;
}) {
  const statusColor =
    entry.status === 'extracted'
      ? 'text-success'
      : entry.status === 'no_result'
        ? 'text-error'
        : 'text-warning';

  return (
    <>
      <tr
        className={`border-b border-border/50 hover:bg-bg-hover transition-colors cursor-pointer ${
          isExpanded ? 'bg-bg-hover' : ''
        }`}
        onClick={onToggle}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-text-primary font-mono text-xs">{entry.filename}</span>
            {entry._demo && (
              <span className="px-1.5 py-0.5 bg-accent/20 text-accent text-[9px] font-bold rounded tracking-wider shrink-0">
                DEMO
              </span>
            )}
            {hasWarnings && (
              <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Synthetic entries have no PDF on disk - show the toast. Real entries
                // open the baked PDF from public/pdfs/ (or live backend in dev mode).
                if (entry._demo) {
                  onPdfUnavailable();
                  return;
                }
                window.open(getPdfUrl(entry.filename, mode), '_blank', 'noopener,noreferrer');
              }}
              className="text-text-muted text-[10px] hover:text-accent shrink-0 underline-offset-2 hover:underline"
              title={entry._demo ? 'Synthetic demo entry - no source PDF' : 'Open source PDF in a new tab'}
            >
              PDF {'\u2197'}
            </button>
          </div>
        </td>
        <td className="px-4 py-2.5">
          <span className={`text-xs font-medium ${statusColor}`}>
            {entry.status}
          </span>
        </td>
        <td className="px-4 py-2.5 text-text-secondary text-xs">
          {entry.companies?.join(', ') || '\u2014'}
        </td>
        <td className="text-right px-4 py-2.5 text-text-primary">
          {entry.metrics_extracted}
        </td>
        <td className="text-right px-4 py-2.5">
          <span className={entry.metrics_dropped ? 'text-error' : 'text-text-muted'}>
            {entry.metrics_dropped || 0}
          </span>
        </td>
        <td className="text-center px-4 py-2.5 text-text-muted">
          {isExpanded ? '\u25b4' : '\u25be'}
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-bg-hover/50">
          <td colSpan={6} className="px-4 py-3">
            <div className="space-y-3">
              {/* Metrics List */}
              {entry.metrics_list && entry.metrics_list.length > 0 && (
                <div>
                  <div className="text-xs text-text-secondary font-medium mb-1.5">
                    Metrics Extracted
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {entry.metrics_list.map((m, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 bg-accent-dim text-accent text-xs rounded font-mono"
                      >
                        {METRIC_LABELS[m as MetricName] || m}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Validation Warnings */}
              {entry.validation_warnings && entry.validation_warnings.length > 0 && (
                <div>
                  <div className="text-xs text-text-secondary font-medium mb-1.5">
                    Validation Warnings
                  </div>
                  <div className="space-y-1">
                    {entry.validation_warnings.map((w, i) => (
                      <div
                        key={i}
                        className="px-3 py-1.5 bg-warning-dim text-warning text-xs rounded font-mono"
                      >
                        {w}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No warnings message */}
              {(!entry.validation_warnings || entry.validation_warnings.length === 0) && (
                <div className="text-xs text-success flex items-center gap-1.5">
                  <span>{'\u2713'}</span>
                  All values verified against source text
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatCard({
  label,
  value,
  color = 'text-text-primary',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-bg-panel border border-border rounded-lg p-4">
      <div className="text-xs text-text-secondary uppercase tracking-wider font-medium">
        {label}
      </div>
      <div className={`text-2xl font-semibold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
