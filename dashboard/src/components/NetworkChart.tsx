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
import type { NetworkMetrics } from '../types/api';
import {
  groupNetworkMetricsByInterface,
  calculateNetworkRate,
} from '../utils/dataTransform';
import { formatBytesRaw } from '../utils/format';

interface NetworkChartProps {
  metrics: NetworkMetrics[];
}

export function NetworkChart({ metrics }: NetworkChartProps) {
  const grouped = groupNetworkMetricsByInterface(metrics);
  const interfaces = Array.from(grouped.keys());
  const [selectedInterface, setSelectedInterface] = useState<string | null>(
    interfaces[0] || null
  );

  if (metrics.length === 0 || interfaces.length === 0) {
    return (
      <div className="border border-terminal-border bg-terminal-panel/30 p-4 h-72 flex items-center justify-center">
        <span className="text-terminal-dim text-sm">No network data available</span>
      </div>
    );
  }

  const interfaceMetrics = selectedInterface
    ? grouped.get(selectedInterface) || []
    : [];
  const rateData = calculateNetworkRate(interfaceMetrics);

  return (
    <div className="border border-terminal-border bg-terminal-panel/30 p-4">
      {/* Header with interface tabs */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-terminal-text">Network</h3>
        <div className="flex gap-1 flex-wrap">
          {interfaces.map((iface) => (
            <button
              key={iface}
              onClick={() => setSelectedInterface(iface)}
              className={`px-2 py-1 text-xs border transition-colors ${
                selectedInterface === iface
                  ? 'border-phosphor text-phosphor bg-phosphor/10'
                  : 'border-terminal-border text-terminal-dim hover:text-terminal-text'
              }`}
            >
              {iface}
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
                width={60}
                tickFormatter={(value) => formatBytesRaw(value) + '/s'}
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
                    `${formatBytesRaw(value)}/s`,
                    name === 'rx_bytes_per_sec' ? 'RX (Download)' : 'TX (Upload)',
                  ];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: '10px' }}
                formatter={(value) =>
                  value === 'rx_bytes_per_sec' ? 'RX (Download)' : 'TX (Upload)'
                }
              />
              <Line
                type="monotone"
                dataKey="rx_bytes_per_sec"
                stroke="var(--color-ok)"
                strokeWidth={1.5}
                dot={false}
                name="rx_bytes_per_sec"
              />
              <Line
                type="monotone"
                dataKey="tx_bytes_per_sec"
                stroke="var(--color-error)"
                strokeWidth={1.5}
                dot={false}
                name="tx_bytes_per_sec"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
