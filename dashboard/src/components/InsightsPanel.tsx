import { useNavigate } from 'react-router-dom';
import type { Insight } from '../lib/data';

interface InsightsPanelProps {
  insights: Insight[];
}

export default function InsightsPanel({ insights }: InsightsPanelProps) {
  const navigate = useNavigate();

  const getIcon = (type: Insight['type']) => {
    switch (type) {
      case 'positive':
        return { bg: 'bg-success-dim', text: 'text-success', icon: '\u25b2' };
      case 'negative':
        return { bg: 'bg-error-dim', text: 'text-error', icon: '\u25bc' };
      default:
        return { bg: 'bg-accent-dim', text: 'text-accent', icon: '\u25cf' };
    }
  };

  const goToCompany = (insight: Insight) => {
    if (!insight.linkedCompany) return;
    const base = `/company/${encodeURIComponent(insight.linkedCompany)}`;
    const url = insight.linkedMetric ? `${base}?metric=${insight.linkedMetric}` : base;
    navigate(url);
  };

  return (
    <div className="bg-bg-panel border border-border rounded-lg p-4">
      <h3 className="text-xs text-text-secondary uppercase tracking-wider font-medium mb-3">
        Portfolio Insights
      </h3>
      <div className="space-y-2">
        {insights.map((insight, i) => {
          const style = getIcon(insight.type);
          const clickable = Boolean(insight.linkedCompany);

          const body = (
            <>
              <div
                className={`w-6 h-6 rounded flex items-center justify-center text-xs shrink-0 ${style.bg} ${style.text}`}
              >
                {style.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text-primary font-medium flex items-center gap-1.5">
                  {insight.title}
                  {clickable && (
                    <span className="text-text-muted group-hover:text-accent transition-colors text-xs">
                      {'\u2192'}
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-secondary mt-0.5">{insight.detail}</div>
              </div>
            </>
          );

          if (clickable) {
            return (
              <button
                key={i}
                onClick={() => goToCompany(insight)}
                className="group w-full flex items-start gap-3 text-left -mx-2 px-2 py-1.5 rounded hover:bg-bg-hover transition-colors cursor-pointer"
                title={`Drill into ${insight.linkedCompany}`}
              >
                {body}
              </button>
            );
          }

          return (
            <div key={i} className="flex items-start gap-3 -mx-2 px-2 py-1.5">
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
