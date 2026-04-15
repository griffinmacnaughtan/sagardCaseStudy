interface KPICardProps {
  label: string;
  value: string;
  subtext?: string;
  accentColor?: string;
  /** Optional QoQ delta - pass the numeric change and label (e.g. "+4.2%"); color auto-keyed */
  delta?: { value: number; label: string; higherIsBetter?: boolean } | null;
}

export default function KPICard({
  label,
  value,
  subtext,
  accentColor = 'bg-accent',
  delta,
}: KPICardProps) {
  const higherIsBetter = delta?.higherIsBetter ?? true;
  const improving = delta ? (higherIsBetter ? delta.value > 0 : delta.value < 0) : null;
  const deltaColor =
    delta && delta.value === 0
      ? 'text-text-muted'
      : improving === true
        ? 'text-success'
        : improving === false
          ? 'text-error'
          : 'text-text-muted';

  return (
    <div className="bg-bg-panel border border-border rounded-lg p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${accentColor}`} />
        <span className="text-xs text-text-secondary uppercase tracking-wider font-medium">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <div className="text-2xl font-semibold text-text-primary">{value}</div>
        {delta && (
          <div className={`text-xs font-medium ${deltaColor}`}>{delta.label}</div>
        )}
      </div>
      {subtext && <div className="text-xs text-text-muted">{subtext}</div>}
    </div>
  );
}
