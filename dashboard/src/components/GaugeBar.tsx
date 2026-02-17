import { getStatusColor } from '../utils/format';

interface GaugeBarProps {
  label: string;
  value: number;
  max?: number;
  unit?: string;
  showPercent?: boolean;
  thresholds?: { warn: number; error: number };
}

export function GaugeBar({
  label,
  value,
  max = 100,
  unit = '%',
  showPercent = true,
  thresholds = { warn: 70, error: 90 },
}: GaugeBarProps) {
  const percent = Math.min((value / max) * 100, 100);
  const color = getStatusColor(percent, thresholds);

  // ASCII-style bar characters
  const barWidth = 20;
  const filled = Math.round((percent / 100) * barWidth);
  const empty = barWidth - filled;
  const asciiBar = '█'.repeat(filled) + '░'.repeat(empty);

  return (
    <div className="space-y-1">
      {/* Label and Value */}
      <div className="flex justify-between items-baseline text-sm">
        <span className="text-terminal-dim uppercase tracking-wide text-xs">{label}</span>
        <span
          className="font-bold tabular-nums"
          style={{ color, textShadow: `0 0 8px ${color}40` }}
        >
          {showPercent ? `${percent.toFixed(1)}${unit}` : `${value.toFixed(1)}${unit}`}
        </span>
      </div>

      {/* Visual Bar */}
      <div className="relative h-4 bg-terminal-dark border border-terminal-border overflow-hidden">
        {/* Filled portion */}
        <div
          className="absolute inset-y-0 left-0 transition-all duration-300 ease-out"
          style={{
            width: `${percent}%`,
            background: `linear-gradient(90deg, ${color}40, ${color})`,
            boxShadow: `0 0 10px ${color}60, inset 0 0 10px ${color}30`,
          }}
        />
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent 9px, var(--color-terminal-border) 9px, var(--color-terminal-border) 10px)`,
          }}
        />
      </div>

      {/* ASCII Bar (hidden on small screens) */}
      <div
        className="hidden sm:block text-xs font-mono tracking-tighter"
        style={{ color }}
      >
        [{asciiBar}]
      </div>
    </div>
  );
}
