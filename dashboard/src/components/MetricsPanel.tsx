import { useState, useMemo } from 'react';
import type { Agent, Metrics, SwapProcessList } from '../types/api';
import { GaugeBar } from './GaugeBar';
import { MetricsChart } from './MetricsChart';
import { formatBytes } from '../utils/format';
import { getAgentSwapProcesses } from '../hooks/useApi';

interface MetricsPanelProps {
  agent: Agent | null;
  metrics: Metrics | null;
  history: Metrics[];
  loading: boolean;
}

function SwapProcessesModal({
  agent,
  swapData,
  loading,
  error,
  onClose,
}: {
  agent: Agent;
  swapData: SwapProcessList | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="border border-terminal-border bg-terminal-panel p-6 max-w-3xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-amber">
            Swap Usage: {agent.hostname}
          </h3>
          <button
            onClick={onClose}
            className="px-2 py-1 text-terminal-dim hover:text-terminal-text"
          >
            ✕
          </button>
        </div>

        {loading && (
          <div className="text-terminal-dim animate-pulse py-8 text-center">
            Retrieving swap process list from agent...
          </div>
        )}

        {error && (
          <div className="text-error py-4">
            {error}
          </div>
        )}

        {swapData && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="p-3 border border-amber/50 bg-amber/10">
              <div className="flex items-center justify-between">
                <span className="text-amber">Total swap used by processes:</span>
                <span className="text-xl font-bold text-amber">
                  {(swapData.total_swap_kib / 1024).toFixed(1)} MB
                </span>
              </div>
              <div className="text-xs text-terminal-dim mt-1">
                {swapData.processes.length} process{swapData.processes.length !== 1 ? 'es' : ''} using swap
              </div>
            </div>

            {/* Process list */}
            {swapData.processes.length === 0 ? (
              <div className="text-ok text-center py-4">
                No processes are currently using swap memory.
              </div>
            ) : (
              <div className="border border-terminal-border">
                {/* Header */}
                <div className="grid grid-cols-[80px_120px_1fr_80px] gap-2 p-2 border-b border-terminal-border bg-terminal-dark/50 text-xs text-terminal-dim uppercase">
                  <div>PID</div>
                  <div>Name</div>
                  <div>Command</div>
                  <div className="text-right">Swap</div>
                </div>

                {/* Rows */}
                <div className="max-h-[400px] overflow-y-auto">
                  {swapData.processes.map((proc, idx) => (
                    <div
                      key={idx}
                      className={`grid grid-cols-[80px_120px_1fr_80px] gap-2 p-2 text-xs ${
                        idx % 2 === 0 ? 'bg-terminal-dark/20' : ''
                      }`}
                    >
                      <div className="text-terminal-dim font-mono">{proc.pid}</div>
                      <div className="text-terminal-text font-semibold truncate" title={proc.name}>
                        {proc.name}
                      </div>
                      <div className="text-terminal-dim truncate" title={proc.cmdline || '-'}>
                        {proc.cmdline || '-'}
                      </div>
                      <div className="text-right text-amber font-mono">
                        {proc.swap_kib >= 1024
                          ? `${(proc.swap_kib / 1024).toFixed(1)}M`
                          : `${proc.swap_kib}K`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-terminal-border text-terminal-text hover:bg-terminal-border/30"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}

export function MetricsPanel({ agent, metrics, history, loading }: MetricsPanelProps) {
  const [swapViewer, setSwapViewer] = useState<{
    swapData: SwapProcessList | null;
    loading: boolean;
    error: string | null;
  } | null>(null);

  async function handleGetSwapProcesses() {
    if (!agent || !agent.is_online) return;

    setSwapViewer({
      swapData: null,
      loading: true,
      error: null,
    });

    try {
      const swapData = await getAgentSwapProcesses(agent.id);
      setSwapViewer({
        swapData,
        loading: false,
        error: null,
      });
    } catch (e) {
      setSwapViewer(prev => prev ? {
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to get swap processes',
      } : null);
    }
  }
  if (!agent) {
    return (
      <div className="h-full flex items-center justify-center border border-terminal-border bg-terminal-panel/20">
        <div className="text-center p-8">
          <pre className="text-phosphor-dim text-4xl mb-4">{'<>'}</pre>
          <div className="text-terminal-dim">
            SELECT AN AGENT TO VIEW METRICS
          </div>
        </div>
      </div>
    );
  }

  const memoryUsedPercent = metrics
    ? (metrics.memory_used_kib / metrics.memory_total_kib) * 100
    : 0;

  const swapUsedPercent = metrics && metrics.swap_total_kib > 0
    ? ((metrics.swap_total_kib - metrics.swap_free_kib) / metrics.swap_total_kib) * 100
    : 0;

  // Memoize chart data transformations to prevent re-renders
  const chartData = useMemo(() => {
    return history.map((m, i) => ({
      ...m,
      index: i,
      time: new Date(m.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      memory_percent: (m.memory_used_kib / m.memory_total_kib) * 100,
      swap_percent: m.swap_total_kib > 0
        ? ((m.swap_total_kib - m.swap_free_kib) / m.swap_total_kib) * 100
        : 0,
    }));
  }, [history]);

  return (
    <div className="h-full overflow-y-auto">
      {/* Swap Processes Modal */}
      {swapViewer && (
        <SwapProcessesModal
          agent={agent}
          swapData={swapViewer.swapData}
          loading={swapViewer.loading}
          error={swapViewer.error}
          onClose={() => setSwapViewer(null)}
        />
      )}

      {/* Agent Info Header */}
      <div className="border border-terminal-border bg-terminal-panel/50 p-4 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div
                className={`w-3 h-3 rounded-full ${agent.is_online ? 'bg-ok' : 'bg-error'}`}
                style={{
                  boxShadow: agent.is_online
                    ? '0 0 8px var(--color-ok), 0 0 16px var(--color-ok)'
                    : '0 0 8px var(--color-error)',
                }}
              />
              <h2
                className="text-xl font-bold text-phosphor"
                style={{ textShadow: '0 0 10px var(--color-phosphor-glow)' }}
              >
                {agent.hostname}
              </h2>
              <span className={`text-xs px-2 py-0.5 border ${
                agent.is_online
                  ? 'border-ok/50 text-ok bg-ok/10'
                  : 'border-error/50 text-error bg-error/10'
              }`}>
                {agent.is_online ? 'ONLINE' : 'OFFLINE'}
              </span>
              {agent.agent_group && (
                <span className="text-xs px-2 py-0.5 border border-info/50 text-info bg-info/10">
                  {agent.agent_group}
                </span>
              )}
            </div>
            <div className="text-sm text-terminal-dim space-y-1">
              <div><span className="text-terminal-text">OS:</span> {agent.os_name}</div>
              <div><span className="text-terminal-text">KERNEL:</span> {agent.kernel_version}</div>
              <div><span className="text-terminal-text">CPU:</span> {agent.cpu_name} ({agent.cpu_cores} cores)</div>
            </div>
          </div>
          <div className="text-right text-xs">
            <div className="text-terminal-dim">AGENT ID</div>
            <div className="text-amber font-mono text-[10px]">{agent.id}</div>
            <div className="text-terminal-dim mt-2">VERSION</div>
            <div className="text-terminal-text">{agent.agent_version}</div>
          </div>
        </div>
      </div>

      {loading && !metrics ? (
        <div className="text-center py-12 text-terminal-dim">
          <div className="animate-pulse text-lg">LOADING METRICS...</div>
        </div>
      ) : (
        <>
          {/* Current Metrics Gauges */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div className="border border-terminal-border bg-terminal-panel/30 p-4">
              <GaugeBar
                label="CPU Usage"
                value={metrics?.cpu_usage ?? 0}
                thresholds={{ warn: 70, error: 90 }}
              />
            </div>
            <div className="border border-terminal-border bg-terminal-panel/30 p-4">
              <GaugeBar
                label="CPU I/O Wait"
                value={metrics?.cpu_io_wait ?? 0}
                thresholds={{ warn: 20, error: 50 }}
              />
            </div>
            <div className="border border-terminal-border bg-terminal-panel/30 p-4">
              <GaugeBar
                label="Memory"
                value={memoryUsedPercent}
                thresholds={{ warn: 80, error: 95 }}
              />
              {metrics && (
                <div className="text-xs text-terminal-dim mt-2">
                  {formatBytes(metrics.memory_used_kib)} / {formatBytes(metrics.memory_total_kib)}
                </div>
              )}
            </div>
            <div className="border border-terminal-border bg-terminal-panel/30 p-4">
              <GaugeBar
                label="Swap"
                value={swapUsedPercent}
                thresholds={{ warn: 50, error: 80 }}
              />
              {metrics && metrics.swap_total_kib > 0 && (
                <div className="text-xs text-terminal-dim mt-2 flex items-center justify-between">
                  <span>{formatBytes(metrics.swap_total_kib - metrics.swap_free_kib)} / {formatBytes(metrics.swap_total_kib)}</span>
                  <button
                    onClick={handleGetSwapProcesses}
                    disabled={!agent.is_online}
                    title={agent.is_online ? "View processes using swap" : "Agent offline"}
                    className="px-2 py-0.5 text-[10px] border border-amber/50 text-amber hover:bg-amber/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    DETAILS
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Time Series Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MetricsChart
              data={chartData}
              dataKey="cpu_usage"
              label="CPU Usage"
              color="var(--color-ok)"
              unit="%"
            />
            <MetricsChart
              data={chartData}
              dataKey="cpu_io_wait"
              label="CPU I/O Wait"
              color="var(--color-amber)"
              unit="%"
            />
            <MetricsChart
              data={chartData}
              dataKey="memory_percent"
              label="Memory Usage"
              color="var(--color-info)"
              unit="%"
            />
            <MetricsChart
              data={chartData}
              dataKey="swap_percent"
              label="Swap Usage"
              color="var(--color-error)"
              unit="%"
            />
          </div>
        </>
      )}
    </div>
  );
}
