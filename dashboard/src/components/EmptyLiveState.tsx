import { useNavigate } from 'react-router-dom';
import { useDataMode } from '../lib/mode';

/**
 * Shown on Portfolio / Audit Trail / Company pages when LIVE mode is active
 * but no extraction has been run. Clear about *why* it's empty - this mode
 * reflects real pipeline output, and there isn't any yet - and offers the
 * two obvious next actions (run extraction, or flip back to demo).
 */
interface Props {
  /** "Portfolio data", "Audit trail", etc. - keeps the copy scoped to the page. */
  subject?: string;
}

export default function EmptyLiveState({ subject = 'Live data' }: Props) {
  const navigate = useNavigate();
  const { setMode } = useDataMode();

  return (
    <div className="flex flex-col items-center justify-center py-24 px-6">
      <div className="max-w-md text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-success/40 bg-success/10 text-[10px] font-bold tracking-wider text-success">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          LIVE MODE
        </div>
        <h2 className="text-lg font-semibold text-text-primary">
          No {subject.toLowerCase()} yet
        </h2>
        <p className="text-sm text-text-secondary">
          Live mode reflects the output of the extraction pipeline. Run it against a folder of
          PDF reports to populate this view - or switch back to demo mode to explore the baked
          sample portfolio.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => navigate('/live')}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-colors"
          >
            Run Extraction {'\u2192'}
          </button>
          <button
            onClick={() => setMode('demo')}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            Switch to Demo
          </button>
        </div>
      </div>
    </div>
  );
}
