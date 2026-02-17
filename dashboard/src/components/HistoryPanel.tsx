import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Agent, Metrics, DiskMetrics, NetworkMetrics } from '../types/api';
import {
  TimeRangeSelector,
  getTimeRangeFromPreset,
  type TimeRange,
} from './TimeRangeSelector';
import { AgentSelector } from './AgentSelector';
import { HistoryChart } from './HistoryChart';
import { DiskIOChart } from './DiskIOChart';
import { NetworkChart } from './NetworkChart';
import { ProcessSnapshotViewer } from './ProcessSnapshotViewer';
import {
  getMultiAgentMetrics,
  getDiskMetrics,
  getNetworkMetrics,
} from '../hooks/useApi';
import {
  mergeMetricsForChart,
  mergeMemoryPercentForChart,
  mergeSwapPercentForChart,
  downsampleData,
} from '../utils/dataTransform';

interface HistoryPanelProps {
  agents: Agent[];
}

export function HistoryPanel({ agents }: HistoryPanelProps) {
  // State for time range
  const [timeRange, setTimeRange] = useState<TimeRange>(
    getTimeRangeFromPreset('1h')
  );

  // State for selected agents
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);

  // Data state
  const [metricsMap, setMetricsMap] = useState<Map<string, Metrics[]>>(
    new Map()
  );
  const [diskMetrics, setDiskMetrics] = useState<DiskMetrics[]>([]);
  const [networkMetrics, setNetworkMetrics] = useState<NetworkMetrics[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Process viewer state
  const [processViewer, setProcessViewer] = useState<{
    agent: Agent;
    timestamp: number;
  } | null>(null);

  // Selected timestamp for highlighting
  const [selectedTimestamp, setSelectedTimestamp] = useState<number | null>(
    null
  );

  // Create agent name lookup (memoized)
  const agentNames = useMemo(() => {
    const map = new Map<string, string>();
    agents.forEach((a) => map.set(a.id, a.hostname));
    return map;
  }, [agents]);

  // Fetch data when selection or time range changes
  const fetchData = useCallback(async () => {
    if (selectedAgentIds.length === 0) {
      setMetricsMap(new Map());
      setDiskMetrics([]);
      setNetworkMetrics([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch metrics for all selected agents
      const metrics = await getMultiAgentMetrics(
        selectedAgentIds,
        timeRange.from,
        timeRange.to
      );
      setMetricsMap(metrics);

      // For disk and network, only fetch for the first selected agent
      // (comparing disk/network across agents is less useful)
      const primaryAgentId = selectedAgentIds[0];
      const [disk, network] = await Promise.all([
        getDiskMetrics(primaryAgentId, timeRange.from, timeRange.to),
        getNetworkMetrics(primaryAgentId, timeRange.from, timeRange.to),
      ]);

      setDiskMetrics(disk);
      setNetworkMetrics(network);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [selectedAgentIds, timeRange.from, timeRange.to]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Prepare chart data (memoized to avoid recalculating on every render)
  const cpuData = useMemo(
    () => downsampleData(mergeMetricsForChart(metricsMap, 'cpu_usage'), 300),
    [metricsMap]
  );
  const cpuIoWaitData = useMemo(
    () => downsampleData(mergeMetricsForChart(metricsMap, 'cpu_io_wait'), 300),
    [metricsMap]
  );
  const memoryData = useMemo(
    () => downsampleData(mergeMemoryPercentForChart(metricsMap), 300),
    [metricsMap]
  );
  const swapData = useMemo(
    () => downsampleData(mergeSwapPercentForChart(metricsMap), 300),
    [metricsMap]
  );

  // Handle chart click - show process viewer
  const handleChartClick = useCallback((timestamp: number) => {
    setSelectedTimestamp(timestamp);

    // Show process viewer for the first selected agent
    if (selectedAgentIds.length > 0) {
      const agent = agents.find((a) => a.id === selectedAgentIds[0]);
      if (agent) {
        setProcessViewer({ agent, timestamp });
      }
    }
  }, [selectedAgentIds, agents]);

  return (
    <div className="h-full flex flex-col">
      {/* Process Snapshot Modal */}
      {processViewer && (
        <ProcessSnapshotViewer
          agent={processViewer.agent}
          timestamp={processViewer.timestamp}
          onClose={() => {
            setProcessViewer(null);
            setSelectedTimestamp(null);
          }}
        />
      )}

      {/* Header controls - overflow-visible to allow dropdown to show */}
      <div className="border border-terminal-border bg-terminal-panel/50 p-4 mb-4 overflow-visible relative z-20">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          {/* Time range selector */}
          <div className="flex-1">
            <div className="text-xs text-terminal-dim mb-2">TIME RANGE</div>
            <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
          </div>

          {/* Agent selector */}
          <div>
            <div className="text-xs text-terminal-dim mb-2">AGENTS</div>
            <AgentSelector
              agents={agents}
              selectedIds={selectedAgentIds}
              onChange={setSelectedAgentIds}
              maxSelection={6}
            />
          </div>

          {/* Refresh button */}
          <div className="flex items-end">
            <button
              onClick={fetchData}
              disabled={loading || selectedAgentIds.length === 0}
              className="px-4 py-2 border border-terminal-border text-terminal-text hover:bg-terminal-border/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'LOADING...' : 'REFRESH'}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* No selection state */}
        {selectedAgentIds.length === 0 && (
          <div className="h-full flex items-center justify-center border border-terminal-border bg-terminal-panel/20">
            <div className="text-center p-8">
              <pre className="text-phosphor-dim text-4xl mb-4">{'[□]'}</pre>
              <div className="text-terminal-dim">
                SELECT ONE OR MORE AGENTS TO VIEW HISTORY
              </div>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="p-4 border border-error bg-error/10 text-error mb-4">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading && selectedAgentIds.length > 0 && (
          <div className="text-center py-12 text-terminal-dim">
            <div className="animate-pulse text-lg">LOADING HISTORICAL DATA...</div>
          </div>
        )}

        {/* Charts grid */}
        {!loading && selectedAgentIds.length > 0 && (
          <div className="space-y-4">
            {/* Main metrics - 2x2 grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <HistoryChart
                data={cpuData}
                agentIds={selectedAgentIds}
                agentNames={agentNames}
                label="CPU Usage"
                unit="%"
                onPointClick={handleChartClick}
                selectedTimestamp={selectedTimestamp}
              />
              <HistoryChart
                data={cpuIoWaitData}
                agentIds={selectedAgentIds}
                agentNames={agentNames}
                label="CPU I/O Wait"
                unit="%"
                onPointClick={handleChartClick}
                selectedTimestamp={selectedTimestamp}
              />
              <HistoryChart
                data={memoryData}
                agentIds={selectedAgentIds}
                agentNames={agentNames}
                label="Memory Usage"
                unit="%"
                onPointClick={handleChartClick}
                selectedTimestamp={selectedTimestamp}
              />
              <HistoryChart
                data={swapData}
                agentIds={selectedAgentIds}
                agentNames={agentNames}
                label="Swap Usage"
                unit="%"
                onPointClick={handleChartClick}
                selectedTimestamp={selectedTimestamp}
              />
            </div>

            {/* Disk and Network - for primary agent only */}
            {selectedAgentIds.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-terminal-dim mb-2">
                    {agentNames.get(selectedAgentIds[0]) || selectedAgentIds[0]}
                  </div>
                  <DiskIOChart metrics={diskMetrics} />
                </div>
                <div>
                  <div className="text-xs text-terminal-dim mb-2">
                    {agentNames.get(selectedAgentIds[0]) || selectedAgentIds[0]}
                  </div>
                  <NetworkChart metrics={networkMetrics} />
                </div>
              </div>
            )}

            {/* Data summary */}
            <div className="text-xs text-terminal-dim text-center py-2 border-t border-terminal-border">
              Showing data from{' '}
              {timeRange.from.toLocaleString('en-GB', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              to{' '}
              {timeRange.to.toLocaleString('en-GB', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {cpuData.length > 0 && ` | ${cpuData.length} data points`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
