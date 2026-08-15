import { formatPercent } from './formatters';

export type ResourceTone = 'oxygen' | 'food' | 'equipment' | 'battery';

interface ResourceBarProps {
  readonly icon: string;
  readonly label: string;
  readonly value: number;
  readonly tone: ResourceTone;
  readonly compact?: boolean;
}

export function ResourceBar({
  icon,
  label,
  value,
  tone,
  compact = false,
}: ResourceBarProps) {
  const normalized = Math.min(100, Math.max(0, value));
  const formatted = formatPercent(normalized);

  return (
    <div className={`resource-row${compact ? ' resource-row--compact' : ''}`}>
      <div className="resource-row__label">
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
        <output>{formatted}</output>
      </div>
      <div
        className={`resource-bar resource-bar--${tone}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(normalized)}
        aria-valuetext={formatted}
      >
        <span style={{ width: `${normalized}%` }} />
      </div>
    </div>
  );
}
