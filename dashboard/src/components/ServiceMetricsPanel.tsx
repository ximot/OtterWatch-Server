import type { ServiceSummary, ServiceMetrics } from '../types/api';
import { GaugeBar } from './GaugeBar';

interface ServiceMetricsPanelProps {
  services: ServiceSummary[];
  metricsMap: Map<string, ServiceMetrics>;
  loading: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function getDataSourceLabel(dataSource: number): string {
  switch (dataSource) {
    case 1: return 'cgroup v2';
    case 2: return 'cgroup v1';
    case 3: return 'procfs';
    default: return 'unknown';
  }
}

function getPluginIcon(pluginType: string): string {
  switch (pluginType.toLowerCase()) {
    case 'nginx': return '🌐';
    case 'tomcat': return '☕';
    case 'self': return '🦦';
    case 'docker': return '🐳';
    case 'podman': return '🦭';
    default: return '📦';
  }
}

function ServiceCard({
  service,
  metrics,
}: {
  service: ServiceSummary;
  metrics: ServiceMetrics | undefined;
}) {
  const isRunning = metrics?.is_running ?? service.is_running;
  const cpuPercent = metrics?.cpu_percent ?? 0;
  const memoryBytes = metrics?.memory_current_bytes ?? 0;
  const processCount = metrics?.process_count ?? 0;
  const threadCount = metrics?.thread_count ?? 0;

  return (
    <div className="border border-terminal-border bg-terminal-panel/50 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{getPluginIcon(service.plugin_type)}</span>
          <span className="font-mono text-phosphor font-medium">
            {service.service_name}
          </span>
          <span className="text-xs text-terminal-dim">
            [{service.plugin_type}]
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning ? (
            <span className="flex items-center gap-1 text-xs">
              <span className="w-2 h-2 rounded-full bg-ok animate-pulse" />
              <span className="text-ok">RUNNING</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs">
              <span className="w-2 h-2 rounded-full bg-error" />
              <span className="text-error">STOPPED</span>
            </span>
          )}
        </div>
      </div>

      {metrics ? (
        <>
          {/* CPU & Memory Gauges */}
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <GaugeBar
                label="CPU"
                value={cpuPercent}
                max={100}
                thresholds={{ warn: 50, error: 80 }}
              />
            </div>
            <div>
              <div className="text-xs text-terminal-dim mb-1 uppercase tracking-wide">Memory</div>
              <div className="font-mono text-sm text-terminal-text">
                {formatBytes(memoryBytes)}
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-terminal-dim">Processes</div>
              <div className="font-mono text-phosphor">{processCount}</div>
            </div>
            <div>
              <div className="text-terminal-dim">Threads</div>
              <div className="font-mono text-phosphor">{threadCount}</div>
            </div>
            <div>
              <div className="text-terminal-dim">Disk Read</div>
              <div className="font-mono text-info">{formatBytes(metrics.disk_read_bytes)}</div>
            </div>
            <div>
              <div className="text-terminal-dim">Disk Write</div>
              <div className="font-mono text-warning">{formatBytes(metrics.disk_write_bytes)}</div>
            </div>
          </div>

          {/* Network I/O */}
          {(metrics.net_rx_bytes > 0 || metrics.net_tx_bytes > 0) && (
            <div className="mt-3 pt-3 border-t border-terminal-border/50 grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-terminal-dim">Net RX</div>
                <div className="font-mono text-info">{formatBytes(metrics.net_rx_bytes)}</div>
              </div>
              <div>
                <div className="text-terminal-dim">Net TX</div>
                <div className="font-mono text-warning">{formatBytes(metrics.net_tx_bytes)}</div>
              </div>
            </div>
          )}

          {/* Data Source */}
          <div className="mt-3 pt-3 border-t border-terminal-border/50 flex justify-between text-xs text-terminal-dim">
            <span>Source: {getDataSourceLabel(metrics.data_source)}</span>
            <span>Last: {new Date(metrics.time).toLocaleTimeString()}</span>
          </div>
        </>
      ) : (
        <div className="text-center py-4 text-terminal-dim text-sm">
          No metrics available
        </div>
      )}
    </div>
  );
}

export function ServiceMetricsPanel({
  services,
  metricsMap,
  loading,
}: ServiceMetricsPanelProps) {
  if (loading && services.length === 0) {
    return (
      <div className="border border-terminal-border bg-terminal-panel">
        <div className="border-b border-terminal-border px-4 py-2 bg-terminal-panel/50">
          <span className="text-phosphor font-medium">▸ SERVICES</span>
        </div>
        <div className="p-8 text-center">
          <div className="text-terminal-dim animate-pulse">Loading services...</div>
        </div>
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="border border-terminal-border bg-terminal-panel">
        <div className="border-b border-terminal-border px-4 py-2 bg-terminal-panel/50">
          <span className="text-phosphor font-medium">▸ SERVICES</span>
        </div>
        <div className="p-8 text-center">
          <div className="text-terminal-dim text-sm">
            No monitored services
          </div>
          <div className="text-terminal-dim/70 text-xs mt-2">
            Enable plugins in agent settings.toml to monitor services like nginx, tomcat, etc.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-terminal-border bg-terminal-panel">
      <div className="border-b border-terminal-border px-4 py-2 bg-terminal-panel/50 flex items-center justify-between">
        <span className="text-phosphor font-medium">▸ SERVICES</span>
        <span className="text-xs text-terminal-dim">
          {services.filter(s => s.is_running).length}/{services.length} running
        </span>
      </div>
      <div className="p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((service) => (
          <ServiceCard
            key={service.service_name}
            service={service}
            metrics={metricsMap.get(service.service_name)}
          />
        ))}
      </div>
    </div>
  );
}
