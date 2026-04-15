interface QoQIndicatorProps {
  label: string;
  isImproving: boolean | null;
}

export default function QoQIndicator({ label, isImproving }: QoQIndicatorProps) {
  if (isImproving === null || !label) {
    return <span className="text-text-muted text-xs">{'\u2014'}</span>;
  }

  const color = isImproving ? 'text-success' : 'text-error';
  const arrow = isImproving ? '\u25b2' : '\u25bc';

  return (
    <span className={`text-xs font-medium ${color}`}>
      {arrow} {label}
    </span>
  );
}
