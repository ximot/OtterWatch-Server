import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { MultiAgentDataPoint } from '../utils/dataTransform';
import { getAgentColor } from '../utils/chartColors';

interface HistoryChartProps {
  data: MultiAgentDataPoint[];
  agentIds: string[];
  agentNames: Map<string, string>; // agentId -> hostname
  label: string;
  unit: string;
  onPointClick?: (timestamp: number) => void;
  selectedTimestamp?: number | null;
}

export function HistoryChart({
  data,
  agentIds,
  agentNames,
  label,
  unit,
  onPointClick,
  selectedTimestamp,
}: HistoryChartProps) {
  if (data.length === 0) {
    return (
      <div className="border border-terminal-border bg-terminal-panel/30 p-4 h-64 flex items-center justify-center">
        <span className="text-terminal-dim text-sm">No data available</span>
      </div>
    );
  }

  // Find the data point closest to selectedTimestamp
  const selectedIndex = selectedTimestamp
    ? data.findIndex((d) => d.timestamp === selectedTimestamp)
    : -1;

  return (
    <div className="border border-terminal-border bg-terminal-panel/30 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-terminal-text">{label}</h3>
        <span className="text-xs text-terminal-dim">
          {data.length} points
        </span>
      </div>

      {/* Chart */}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            onClick={(e) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const payload = (e as any)?.activePayload?.[0]?.payload;
              if (payload && onPointClick) {
                onPointClick(payload.timestamp);
              }
            }}
            style={{ cursor: onPointClick ? 'pointer' : 'default' }}
          >
            <XAxis
              dataKey="time"
              tick={{ fill: 'var(--color-terminal-dim)', fontSize: 10 }}
              axisLine={{ stroke: 'var(--color-terminal-border)' }}
              tickLine={{ stroke: 'var(--color-terminal-border)' }}
              interval="preserveStartEnd"
              minTickGap={50}
            />
            <YAxis
              tick={{ fill: 'var(--color-terminal-dim)', fontSize: 10 }}
              axisLine={{ stroke: 'var(--color-terminal-border)' }}
              tickLine={{ stroke: 'var(--color-terminal-border)' }}
              domain={unit === '%' ? [0, 100] : ['auto', 'auto']}
              width={40}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-terminal-dark)',
                border: '1px solid var(--color-terminal-border)',
                fontSize: '11px',
              }}
              labelStyle={{ color: 'var(--color-terminal-text)' }}
              formatter={(value: number | undefined, name) => {
                if (value === undefined) return ['-', String(name)];
                const nameStr = String(name);
                return [
                  `${value.toFixed(1)}${unit}`,
                  agentNames.get(nameStr) || nameStr.slice(0, 8),
                ];
              }}
            />

            {/* Selected timestamp indicator */}
            {selectedTimestamp && selectedIndex >= 0 && (
              <ReferenceLine
                x={data[selectedIndex]?.time}
                stroke="var(--color-amber)"
                strokeWidth={2}
                strokeDasharray="3 3"
              />
            )}

            {/* One line per agent */}
            {agentIds.map((agentId, index) => (
              <Line
                key={agentId}
                type="monotone"
                dataKey={agentId}
                stroke={getAgentColor(index)}
                strokeWidth={1.5}
                dot={false}
                activeDot={{
                  r: 6,
                  fill: getAgentColor(index),
                  stroke: 'var(--color-terminal-dark)',
                  strokeWidth: 2,
                  cursor: 'pointer',
                  onClick: (_: unknown, payload: { payload?: MultiAgentDataPoint }) => {
                    if (payload?.payload?.timestamp && onPointClick) {
                      onPointClick(payload.payload.timestamp);
                    }
                  },
                }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      {agentIds.length > 1 && (
        <div className="flex flex-wrap gap-3 mt-2 pt-2 border-t border-terminal-border">
          {agentIds.map((agentId, index) => (
            <div key={agentId} className="flex items-center gap-1.5">
              <span
                className="w-3 h-0.5"
                style={{ backgroundColor: getAgentColor(index) }}
              />
              <span className="text-xs text-terminal-dim">
                {agentNames.get(agentId) || agentId.slice(0, 8)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Click hint */}
      {onPointClick && (
        <div className="text-[10px] text-terminal-dim mt-2 text-center">
          Hover and click on a data point to view processes at that time
        </div>
      )}
    </div>
  );
}
