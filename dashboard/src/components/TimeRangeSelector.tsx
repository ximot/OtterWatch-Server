import { useState } from 'react';

export type TimeRangePreset = '1h' | '6h' | '24h' | '7d' | '30d' | 'custom';

export interface TimeRange {
  from: Date;
  to: Date;
  preset: TimeRangePreset;
}

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

const PRESETS: { key: TimeRangePreset; label: string; hours: number }[] = [
  { key: '1h', label: '1H', hours: 1 },
  { key: '6h', label: '6H', hours: 6 },
  { key: '24h', label: '24H', hours: 24 },
  { key: '7d', label: '7D', hours: 24 * 7 },
  { key: '30d', label: '30D', hours: 24 * 30 },
];

export function getTimeRangeFromPreset(preset: TimeRangePreset): TimeRange {
  const to = new Date();
  const from = new Date();

  switch (preset) {
    case '1h':
      from.setHours(from.getHours() - 1);
      break;
    case '6h':
      from.setHours(from.getHours() - 6);
      break;
    case '24h':
      from.setHours(from.getHours() - 24);
      break;
    case '7d':
      from.setDate(from.getDate() - 7);
      break;
    case '30d':
      from.setDate(from.getDate() - 30);
      break;
    default:
      from.setHours(from.getHours() - 24);
  }

  return { from, to, preset };
}

function formatDateTimeLocal(date: Date): string {
  return date.toISOString().slice(0, 16);
}

export function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  const [customFrom, setCustomFrom] = useState(formatDateTimeLocal(value.from));
  const [customTo, setCustomTo] = useState(formatDateTimeLocal(value.to));

  const handlePresetClick = (preset: TimeRangePreset) => {
    onChange(getTimeRangeFromPreset(preset));
  };

  const handleApplyCustom = () => {
    const from = new Date(customFrom);
    const to = new Date(customTo);

    if (from >= to) {
      return; // Invalid range
    }

    onChange({ from, to, preset: 'custom' });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Preset buttons */}
      <div className="flex gap-1">
        {PRESETS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handlePresetClick(key)}
            className={`px-3 py-1.5 text-xs font-mono border transition-colors ${
              value.preset === key
                ? 'border-phosphor text-phosphor bg-phosphor/10'
                : 'border-terminal-border text-terminal-dim hover:text-terminal-text hover:border-terminal-text'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Separator */}
      <span className="text-terminal-dim px-2">|</span>

      {/* Custom date range */}
      <div className="flex items-center gap-2">
        <span className="text-terminal-dim text-xs">From:</span>
        <input
          type="datetime-local"
          value={customFrom}
          onChange={(e) => setCustomFrom(e.target.value)}
          className="px-2 py-1 text-xs bg-terminal-dark border border-terminal-border text-terminal-text focus:border-phosphor focus:outline-none"
        />

        <span className="text-terminal-dim text-xs">To:</span>
        <input
          type="datetime-local"
          value={customTo}
          onChange={(e) => setCustomTo(e.target.value)}
          className="px-2 py-1 text-xs bg-terminal-dark border border-terminal-border text-terminal-text focus:border-phosphor focus:outline-none"
        />

        <button
          onClick={handleApplyCustom}
          className={`px-3 py-1.5 text-xs font-mono border transition-colors ${
            value.preset === 'custom'
              ? 'border-phosphor text-phosphor bg-phosphor/10'
              : 'border-terminal-border text-terminal-dim hover:text-terminal-text hover:border-terminal-text'
          }`}
        >
          APPLY
        </button>
      </div>
    </div>
  );
}
