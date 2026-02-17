import type { Metrics, DiskMetrics, NetworkMetrics } from '../types/api';

/**
 * Data point for multi-agent chart
 * Time is the x-axis, and each agent has its own value
 */
export interface MultiAgentDataPoint {
  time: string;
  timestamp: number;
  [agentId: string]: string | number; // values for each agent
}

/**
 * Merge metrics from multiple agents into chart-ready format
 * Groups by time and creates columns for each agent
 */
export function mergeMetricsForChart(
  metricsMap: Map<string, Metrics[]>,
  valueKey: keyof Metrics
): MultiAgentDataPoint[] {
  // Collect all unique timestamps
  const timeMap = new Map<number, MultiAgentDataPoint>();

  for (const [agentId, metrics] of metricsMap) {
    for (const m of metrics) {
      const timestamp = new Date(m.time).getTime();
      const timeStr = new Date(m.time).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      });

      if (!timeMap.has(timestamp)) {
        timeMap.set(timestamp, { time: timeStr, timestamp });
      }

      const point = timeMap.get(timestamp)!;
      const value = m[valueKey];
      if (typeof value === 'number') {
        point[agentId] = value;
      }
    }
  }

  // Sort by timestamp
  const sorted = Array.from(timeMap.values()).sort(
    (a, b) => a.timestamp - b.timestamp
  );

  return sorted;
}

/**
 * Calculate memory percentage for merging
 */
export function mergeMemoryPercentForChart(
  metricsMap: Map<string, Metrics[]>
): MultiAgentDataPoint[] {
  const timeMap = new Map<number, MultiAgentDataPoint>();

  for (const [agentId, metrics] of metricsMap) {
    for (const m of metrics) {
      const timestamp = new Date(m.time).getTime();
      const timeStr = new Date(m.time).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      });

      if (!timeMap.has(timestamp)) {
        timeMap.set(timestamp, { time: timeStr, timestamp });
      }

      const point = timeMap.get(timestamp)!;
      point[agentId] = (m.memory_used_kib / m.memory_total_kib) * 100;
    }
  }

  return Array.from(timeMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Calculate swap percentage for merging
 */
export function mergeSwapPercentForChart(
  metricsMap: Map<string, Metrics[]>
): MultiAgentDataPoint[] {
  const timeMap = new Map<number, MultiAgentDataPoint>();

  for (const [agentId, metrics] of metricsMap) {
    for (const m of metrics) {
      const timestamp = new Date(m.time).getTime();
      const timeStr = new Date(m.time).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      });

      if (!timeMap.has(timestamp)) {
        timeMap.set(timestamp, { time: timeStr, timestamp });
      }

      const point = timeMap.get(timestamp)!;
      if (m.swap_total_kib > 0) {
        point[agentId] =
          ((m.swap_total_kib - m.swap_free_kib) / m.swap_total_kib) * 100;
      } else {
        point[agentId] = 0;
      }
    }
  }

  return Array.from(timeMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Downsample data for better chart performance
 * Uses LTTB (Largest Triangle Three Buckets) inspired approach
 */
export function downsampleData<T extends { timestamp: number }>(
  data: T[],
  targetPoints: number
): T[] {
  if (data.length <= targetPoints) {
    return data;
  }

  const sampled: T[] = [];
  const bucketSize = Math.floor(data.length / targetPoints);

  // Always include first point
  sampled.push(data[0]);

  // Sample middle points
  for (let i = 1; i < targetPoints - 1; i++) {
    const start = i * bucketSize;
    const end = Math.min(start + bucketSize, data.length);

    // Take point closest to bucket center
    const mid = Math.floor((start + end) / 2);
    sampled.push(data[mid]);
  }

  // Always include last point
  sampled.push(data[data.length - 1]);

  return sampled;
}

/**
 * Group disk metrics by device for tabbed display
 */
export function groupDiskMetricsByDevice(
  metrics: DiskMetrics[]
): Map<string, DiskMetrics[]> {
  const grouped = new Map<string, DiskMetrics[]>();

  for (const m of metrics) {
    if (!grouped.has(m.device)) {
      grouped.set(m.device, []);
    }
    grouped.get(m.device)!.push(m);
  }

  // Sort each device's metrics by time
  for (const deviceMetrics of grouped.values()) {
    deviceMetrics.sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
    );
  }

  return grouped;
}

/**
 * Group network metrics by interface for tabbed display
 */
export function groupNetworkMetricsByInterface(
  metrics: NetworkMetrics[]
): Map<string, NetworkMetrics[]> {
  const grouped = new Map<string, NetworkMetrics[]>();

  for (const m of metrics) {
    if (!grouped.has(m.interface_name)) {
      grouped.set(m.interface_name, []);
    }
    grouped.get(m.interface_name)!.push(m);
  }

  // Sort each interface's metrics by time
  for (const interfaceMetrics of grouped.values()) {
    interfaceMetrics.sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
    );
  }

  return grouped;
}

/**
 * Calculate disk I/O rate (ops per second) from cumulative values
 */
export function calculateDiskIORate(metrics: DiskMetrics[]): Array<{
  time: string;
  timestamp: number;
  read_ops_per_sec: number;
  write_ops_per_sec: number;
}> {
  if (metrics.length < 2) return [];

  const result: Array<{
    time: string;
    timestamp: number;
    read_ops_per_sec: number;
    write_ops_per_sec: number;
  }> = [];

  for (let i = 1; i < metrics.length; i++) {
    const prev = metrics[i - 1];
    const curr = metrics[i];
    const prevTime = new Date(prev.time).getTime();
    const currTime = new Date(curr.time).getTime();
    const deltaSeconds = (currTime - prevTime) / 1000;

    if (deltaSeconds > 0) {
      result.push({
        time: new Date(curr.time).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        timestamp: currTime,
        read_ops_per_sec: Math.max(0, (curr.read_ops - prev.read_ops) / deltaSeconds),
        write_ops_per_sec: Math.max(0, (curr.write_ops - prev.write_ops) / deltaSeconds),
      });
    }
  }

  return result;
}

/**
 * Calculate network throughput rate (bytes per second) from cumulative values
 */
export function calculateNetworkRate(metrics: NetworkMetrics[]): Array<{
  time: string;
  timestamp: number;
  rx_bytes_per_sec: number;
  tx_bytes_per_sec: number;
}> {
  if (metrics.length < 2) return [];

  const result: Array<{
    time: string;
    timestamp: number;
    rx_bytes_per_sec: number;
    tx_bytes_per_sec: number;
  }> = [];

  for (let i = 1; i < metrics.length; i++) {
    const prev = metrics[i - 1];
    const curr = metrics[i];
    const prevTime = new Date(prev.time).getTime();
    const currTime = new Date(curr.time).getTime();
    const deltaSeconds = (currTime - prevTime) / 1000;

    if (deltaSeconds > 0) {
      result.push({
        time: new Date(curr.time).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        timestamp: currTime,
        rx_bytes_per_sec: Math.max(
          0,
          (curr.bytes_received - prev.bytes_received) / deltaSeconds
        ),
        tx_bytes_per_sec: Math.max(
          0,
          (curr.bytes_transmitted - prev.bytes_transmitted) / deltaSeconds
        ),
      });
    }
  }

  return result;
}
