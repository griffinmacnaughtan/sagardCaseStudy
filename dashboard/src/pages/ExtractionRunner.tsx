import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchStatus, triggerExtraction, uploadPdfs, isStaticMode } from '../lib/data';
import { useDataMode } from '../lib/mode';
import type { StatusResponse } from '../lib/types';

export default function ExtractionRunner() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState('');
  const [justCompleted, setJustCompleted] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const wasRunningRef = useRef(false);
  const navigate = useNavigate();
  const { mode, setMode } = useDataMode();

  const loadStatus = useCallback(() => {
    fetchStatus()
      .then((s) => {
        setStatus(s);
        if (!folder && s.pdf_folder) setFolder(s.pdf_folder);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [folder]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Poll while running
  useEffect(() => {
    if (!status?.running) return;
    const interval = setInterval(loadStatus, 2000);
    return () => clearInterval(interval);
  }, [status?.running, loadStatus]);

  // Detect the running→done transition: auto-flip to live mode + surface a
  // banner pointing the user at their freshly-extracted data. This is the
  // seam between "extraction complete" and "looking at results" - without
  // it the dashboard would silently keep showing the demo snapshot.
  useEffect(() => {
    const nowRunning = status?.running ?? false;
    if (wasRunningRef.current && !nowRunning && (status?.has_data ?? false) && !status?.error) {
      setMode('live');
      setJustCompleted(true);
    }
    wasRunningRef.current = nowRunning;
  }, [status?.running, status?.has_data, status?.error, setMode]);

  const handleExtract = async () => {
    setTriggering(true);
    setError(null);
    try {
      await triggerExtraction(folder || undefined);
      setTimeout(loadStatus, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger extraction');
    } finally {
      setTriggering(false);
    }
  };

  // Native OS file picker: user selects one or more PDFs, we upload them to the
  // backend's ./uploads/ folder, then populate the folder path. Works cross-platform
  // because <input type="file"> opens the OS-native dialog on both Windows and macOS.
  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) =>
      f.name.toLowerCase().endsWith('.pdf'),
    );
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadPdfs(files);
      setFolder(res.folder);
      setUploadedFiles(res.files);
      // Refresh status so the "PDFs Available" counter reflects the new batch
      setTimeout(loadStatus, 300);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      // Reset input so selecting the same file again still triggers onChange
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-secondary">Loading status...</div>
      </div>
    );
  }

  const isRunning = status?.running ?? false;
  const hasData = status?.has_data ?? false;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Live Extraction</h1>
        <p className="text-sm text-text-secondary mt-1">
          Run the AI-powered metric extraction pipeline on portfolio PDF reports
        </p>
      </div>

      {/* Post-run banner: extraction just finished, dashboard has been flipped to live mode */}
      {justCompleted && (
        <div className="bg-success/10 border border-success/40 rounded-lg px-4 py-3 flex items-start gap-3">
          <div className="w-2 h-2 rounded-full bg-success mt-1.5 shrink-0" />
          <div className="flex-1 text-sm text-text-primary">
            <div className="font-medium">Extraction complete - dashboard switched to LIVE mode.</div>
            <div className="text-xs text-text-secondary mt-0.5">
              Portfolio / Audit Trail now reflect the data from your PDFs. Toggle back to DEMO in the header at any time.
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => navigate('/')}
              className="px-3 py-1.5 text-xs font-medium bg-success text-white rounded hover:opacity-90"
            >
              View Portfolio {'\u2192'}
            </button>
            <button
              onClick={() => setJustCompleted(false)}
              className="text-text-muted hover:text-text-primary text-xs px-1"
              title="Dismiss"
            >
              {'\u2715'}
            </button>
          </div>
        </div>
      )}

      {/* Mode-mismatch hint: extraction has run (has_data) but dashboard is on demo.
          Easy to miss - surface the flip here so the runner stays useful. */}
      {!justCompleted && (status?.has_data ?? false) && mode === 'demo' && !isRunning && (
        <div className="bg-accent/10 border border-accent/30 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-sm text-text-secondary">
            Live extraction data is available, but the dashboard is currently in <span className="text-accent font-semibold">DEMO</span> mode.
          </div>
          <button
            onClick={() => {
              setMode('live');
              navigate('/');
            }}
            className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded hover:opacity-90 shrink-0"
          >
            Switch to Live
          </button>
        </div>
      )}

      {/* Status Card */}
      <div className="bg-bg-panel border border-border rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm text-text-secondary uppercase tracking-wider font-medium">
            Pipeline Status
          </h3>
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isRunning
                  ? 'bg-warning animate-pulse'
                  : hasData
                    ? 'bg-success'
                    : 'bg-text-muted'
              }`}
            />
            <span className="text-sm text-text-primary">
              {isRunning ? 'Running...' : hasData ? 'Ready' : 'No data'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-text-muted">Last Run</div>
            <div className="text-sm text-text-primary mt-0.5">
              {status?.last_run
                ? new Date(status.last_run).toLocaleString()
                : 'Never'}
            </div>
          </div>
          <div>
            <div className="text-xs text-text-muted">PDFs Available</div>
            <div className="text-sm text-text-primary mt-0.5">
              {status?.pdf_count ?? 'Unknown'}
            </div>
          </div>
        </div>

        {status?.error && (
          <div className="p-3 bg-error-dim rounded-lg text-sm text-error">
            <div className="font-medium mb-1">Error</div>
            <pre className="text-xs whitespace-pre-wrap font-mono">{status.error}</pre>
          </div>
        )}

        {error && (
          <div className="p-3 bg-error-dim rounded-lg text-sm text-error">{error}</div>
        )}
      </div>

      {/* PDF Source: file picker (primary) + folder path (power-user fallback) */}
      {!isStaticMode && (
        <div className="bg-bg-panel border border-border rounded-lg p-6 space-y-4">
          <h3 className="text-sm text-text-secondary uppercase tracking-wider font-medium">
            PDF Source
          </h3>

          {/* Hidden native file input - accept multiple PDFs, opens OS-native dialog
              on Windows (Explorer) and macOS (Finder) */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={handleFilePick}
            className="hidden"
          />

          <div className="flex items-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isRunning || uploading}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isRunning || uploading
                  ? 'bg-border text-text-muted cursor-not-allowed'
                  : 'bg-accent text-white hover:bg-accent/90'
              }`}
            >
              {uploading ? 'Uploading...' : 'Select PDFs'}
            </button>
            <span className="text-xs text-text-muted">
              {uploadedFiles.length > 0
                ? `${uploadedFiles.length} PDF${uploadedFiles.length === 1 ? '' : 's'} staged`
                : 'Opens a native file dialog · multi-select supported'}
            </span>
          </div>

          {uploadedFiles.length > 0 && (
            <div className="text-xs text-text-secondary bg-bg-primary border border-border rounded p-2.5 max-h-32 overflow-y-auto font-mono">
              {uploadedFiles.map((n) => (
                <div key={n} className="truncate">{n}</div>
              ))}
            </div>
          )}

          {/* Advanced: direct folder path. Useful when the PDFs already live on disk
              and copying them through an upload would be wasteful. */}
          <details className="group">
            <summary className="cursor-pointer text-xs text-text-muted hover:text-text-secondary select-none">
              Or enter a folder path directly
            </summary>
            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="Path to folder containing PDF reports"
                disabled={isRunning}
                className="w-full px-3 py-2 bg-bg-primary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
              />
              <p className="text-xs text-text-muted">
                Absolute path. The pipeline scans this folder for *.pdf files.
              </p>
            </div>
          </details>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleExtract}
          disabled={isRunning || triggering || isStaticMode}
          className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            isRunning || triggering || isStaticMode
              ? 'bg-border text-text-muted cursor-not-allowed'
              : 'bg-accent text-white hover:bg-accent/90'
          }`}
          title={isStaticMode ? 'Extraction requires the Python backend (run locally)' : undefined}
        >
          {isStaticMode
            ? 'Requires Local Backend'
            : isRunning
              ? 'Extraction in Progress...'
              : triggering
                ? 'Starting...'
                : 'Run Extraction'}
        </button>
        {hasData && (
          <>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-2.5 rounded-lg text-sm font-medium border border-border text-text-primary hover:bg-bg-hover transition-colors"
            >
              View Portfolio
            </button>
            <button
              onClick={() => navigate('/audit')}
              className="px-6 py-2.5 rounded-lg text-sm font-medium border border-border text-text-secondary hover:bg-bg-hover transition-colors"
            >
              View Audit Trail
            </button>
          </>
        )}
      </div>

      {/* Pipeline Description - wording kept in lockstep with the case-study deck
          (sagard_fde_griffin.pptx) so what a reviewer reads here matches the slides. */}
      <div className="bg-bg-panel border border-border rounded-lg p-6">
        <h3 className="text-sm text-text-secondary uppercase tracking-wider font-medium mb-4">
          Process
        </h3>
        <div className="space-y-3">
          {[
            {
              stage: '1',
              title: 'Discover',
              desc: 'Walks the folder, parses Company_Q2_2025.pdf-style filenames for a period hint, flags portfolio snapshots.',
            },
            {
              stage: '2',
              title: 'Text extraction',
              desc: 'pdfplumber pulls text out of each PDF. The sample reports are text-based and clean, so no OCR needed (see assumptions).',
            },
            {
              stage: '3',
              title: 'Semantic parse',
              desc: 'Sends each document to Claude with a structured prompt that defines the eight target metrics, their common aliases, the output schema, and domain rules (prefer totals over components, prefer operating cash over restricted, distinguish monthly from quarterly burn). The model returns JSON.',
            },
            {
              stage: '4',
              title: 'Validate and normalise',
              desc: 'Substring-grounds every returned number against the source PDF, resolves entity aliases, parses raw strings into numeric + unit for CSV output, normalises burn to a monthly rate, and deduplicates standalone reports against portfolio snapshots with cross-validation when both agree.',
            },
            {
              stage: '5',
              title: 'Output',
              desc: 'Writes a wide-format CSV pivot for human review, a long-format JSON with full metadata for downstream systems, and an extraction log with per-file warnings.',
            },
          ].map((step) => (
            <div key={step.stage} className="flex items-start gap-3">
              <div className="w-6 h-6 rounded bg-accent-dim text-accent text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                {step.stage}
              </div>
              <div>
                <div className="text-sm text-text-primary font-medium">{step.title}</div>
                <div className="text-xs text-text-secondary">{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
