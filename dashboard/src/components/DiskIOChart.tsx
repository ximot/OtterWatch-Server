import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { DiskMetrics } from '../types/api';
import {
  groupDiskMetricsByDevice,
  calculateDiskIORate,
} from '../utils/dataTransform';

interface DiskIOChartProps {
  metrics: DiskMetrics[];
}

export function DiskIOChart({ metrics }: DiskIOChartProps) {
  const grouped = groupDiskMetricsByDevice(metrics);
  const devices = Array.from(grouped.keys());
  const [selectedDevice, setSelectedDevice] = useState<string | null>(
    devices[0] || null
  );

  if (metrics.length === 0 || devices.length === 0) {
    return (
      <div className="border border-terminal-border bg-terminal-panel/30 p-4 h-72 flex items-center justify-center">
        <span className="text-terminal-dim text-sm">No disk I/O data available</span>
      </div>
    );
  }

  const deviceMetrics = selectedDevice ? grouped.get(selectedDevice) || [] : [];
  const rateData = calculateDiskIORate(deviceMetrics);

  return (
    <div className="border border-terminal-border bg-terminal-panel/30 p-4">
      {/* Header with device tabs */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-terminal-text">Disk I/O</h3>
        <div className="flex gap-1">
          {devices.map((device) => (
            <button
              key={device}
              onClick={() => setSelectedDevice(device)}
              className={`px-2 py-1 text-xs border transition-colors ${
                selectedDevice === device
                  ? 'border-phosphor text-phosphor bg-phosphor/10'
                  : 'border-terminal-border text-terminal-dim hover:text-terminal-text'
              }`}
            >
              {device}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-52">
        {rateData.length < 2 ? (
          <div className="h-full flex items-center justify-center text-terminal-dim text-sm">
            Not enough data points for rate calculation
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rateData}>
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
                width={50}
                tickFormatter={(value) => `${value.toFixed(0)}`}
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
                  return [
                    `${value.toFixed(1)} ops/s`,
                    name === 'read_ops_per_sec' ? 'Read' : 'Write',
                  ];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: '10px' }}
                formatter={(value) =>
                  value === 'read_ops_per_sec' ? 'Read ops/s' : 'Write ops/s'
                }
              />
              <Line
                type="monotone"
                dataKey="read_ops_per_sec"
                stroke="var(--color-info)"
                strokeWidth={1.5}
                dot={false}
                name="read_ops_per_sec"
              />
              <Line
                type="monotone"
                dataKey="write_ops_per_sec"
                stroke="var(--color-amber)"
                strokeWidth={1.5}
                dot={false}
                name="write_ops_per_sec"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
