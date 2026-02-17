import { memo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface ChartDataPoint {
  [key: string]: string | number;
  time: string;
  index: number;
}

interface MetricsChartProps {
  data: ChartDataPoint[];
  dataKey: string;
  label: string;
  color: string;
  unit?: string;
  domain?: [number, number];
}

export const MetricsChart = memo(function MetricsChart({
  data,
  dataKey,
  label,
  color,
  unit = '%',
  domain = [0, 100],
}: MetricsChartProps) {
  const latestValue = data.length > 0 ? data[data.length - 1][dataKey] : null;

  return (
    <div className="border border-terminal-border bg-terminal-panel/30 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div
          className="w-3 h-3"
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
        />
        <span className="text-terminal-text font-semibold text-sm uppercase tracking-wider">
          {label}
        </span>
        {latestValue !== null && typeof latestValue === 'number' && (
          <span
            className="ml-auto text-lg font-bold tabular-nums"
            style={{ color, textShadow: `0 0 10px ${color}60` }}
          >
            {latestValue.toFixed(1)}{unit}
          </span>
        )}
      </div>

      {/* Chart */}
      <div className="h-32">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-terminal-dim text-sm">
            AWAITING DATA...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id={`gradient-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-terminal-border)"
                strokeOpacity={0.5}
              />
              <XAxis
                dataKey="index"
                tick={{ fill: 'var(--color-terminal-dim)', fontSize: 10 }}
                axisLine={{ stroke: 'var(--color-terminal-border)' }}
                tickLine={{ stroke: 'var(--color-terminal-border)' }}
                interval="preserveStartEnd"
                tickFormatter={() => ''}
              />
              <YAxis
                domain={domain}
                tick={{ fill: 'var(--color-terminal-dim)', fontSize: 10 }}
                axisLine={{ stroke: 'var(--color-terminal-border)' }}
                tickLine={{ stroke: 'var(--color-terminal-border)' }}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-terminal-panel)',
                  border: '1px solid var(--color-terminal-border)',
                  borderRadius: 0,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                }}
                labelStyle={{ color: 'var(--color-terminal-dim)' }}
                itemStyle={{ color }}
                formatter={(value: number | undefined) => {
                  if (value === undefined) return ['N/A', label];
                  return [`${value.toFixed(2)}${unit}`, label];
                }}
                labelFormatter={(_, payload) =>
                  payload?.[0]?.payload?.time || ''
                }
              />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                fill={`url(#gradient-${dataKey})`}
                style={{ filter: `drop-shadow(0 0 4px ${color})` }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
});
