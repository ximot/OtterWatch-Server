import { memo, useMemo } from 'react';
import type { Agent, Metrics } from '../types/api';
import { formatBytes, formatUptime, getStatusColor } from '../utils/format';

interface OverviewPanelProps {
  agents: Agent[];
  metricsMap: Map<string, Metrics>;
  onSelectAgent: (id: string) => void;
  loading: boolean;
  groups: string[];
  selectedGroup: string | null;
  onGroupChange: (group: string | null) => void;
}

function MiniGauge({ value, thresholds }: { value: number; thresholds: { warn: number; error: number } }) {
  const color = getStatusColor(value, thresholds);
  const width = Math.min(value, 100);

  return (
    <div className="h-1.5 bg-terminal-dark rounded-sm overflow-hidden">
      <div
        className="h-full transition-all duration-300"
        style={{
          width: `${width}%`,
          backgroundColor: color,
          boxShadow: `0 0 6px ${color}`,
        }}
      />
    </div>
  );
}

const AgentTile = memo(function AgentTile({
  agent,
  metrics,
  onClick,
}: {
  agent: Agent;
  metrics: Metrics | undefined;
  onClick: () => void;
}) {
  const cpuUsage = metrics?.cpu_usage ?? 0;
  const memoryPercent = metrics
    ? (metrics.memory_used_kib / metrics.memory_total_kib) * 100
    : 0;

  return (
    <button
      onClick={onClick}
      className="text-left p-4 border border-terminal-border bg-terminal-panel/30
                 hover:bg-terminal-panel/60 hover:border-phosphor/30
                 transition-all duration-200 group"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
            agent.is_online ? 'bg-ok' : 'bg-error'
          }`}
          style={{
            boxShadow: agent.is_online
              ? '0 0 8px var(--color-ok)'
              : '0 0 8px var(--color-error)',
          }}
        />
        <h3 className="font-bold text-terminal-text group-hover:text-phosphor truncate transition-colors">
          {agent.hostname}
        </h3>
      </div>

      {/* OS Info & Group */}
      <div className="text-xs text-terminal-dim mb-3 truncate">
        {agent.os_name}
      </div>
      {agent.agent_group && (
        <div className="mb-2">
          <span className="inline-block px-2 py-0.5 text-[10px] bg-info/20 text-info border border-info/30">
            {agent.agent_group}
          </span>
        </div>
      )}

      {/* Metrics */}
      {agent.is_online && metrics ? (
        <div className="space-y-2">
          {/* CPU */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-terminal-dim">CPU</span>
              <span
                className="font-mono tabular-nums"
                style={{ color: getStatusColor(cpuUsage, { warn: 70, error: 90 }) }}
              >
                {cpuUsage.toFixed(1)}%
              </span>
            </div>
            <MiniGauge value={cpuUsage} thresholds={{ warn: 70, error: 90 }} />
          </div>

          {/* Memory */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-terminal-dim">MEM</span>
              <span
                className="font-mono tabular-nums"
                style={{ color: getStatusColor(memoryPercent, { warn: 80, error: 95 }) }}
              >
                {memoryPercent.toFixed(1)}%
              </span>
            </div>
            <MiniGauge value={memoryPercent} thresholds={{ warn: 80, error: 95 }} />
          </div>

          {/* Memory Details */}
          <div className="text-[10px] text-terminal-dim pt-1">
            {formatBytes(metrics.memory_used_kib)} / {formatBytes(metrics.memory_total_kib)}
          </div>
        </div>
      ) : (
        <div className="text-xs text-terminal-dim py-4 text-center">
          {agent.is_online ? 'LOADING...' : 'OFFLINE'}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 pt-2 border-t border-terminal-border/50 flex justify-between text-[10px] text-terminal-dim">
        <span>{agent.cpu_cores} cores</span>
        <span>{formatUptime(agent.last_seen_at)}</span>
      </div>
    </button>
  );
});

export const OverviewPanel = memo(function OverviewPanel({
  agents,
  metricsMap,
  onSelectAgent,
  loading,
  groups,
  selectedGroup,
  onGroupChange,
}: OverviewPanelProps) {
  // Memoize filtered agents to prevent recalculation on every render
  const filteredAgents = useMemo(() =>
    selectedGroup
      ? agents.filter(a => a.agent_group === selectedGroup)
      : agents,
    [agents, selectedGroup]
  );

  // Memoize counts and averages to prevent recalculation on every render
  const { onlineCount, offlineCount, avgCpu, avgMem } = useMemo(() => {
    const online = filteredAgents.filter(a => a.is_online).length;
    let cpu = 0;
    let mem = 0;
    let count = 0;

    filteredAgents.forEach(agent => {
      const metrics = metricsMap.get(agent.id);
      if (metrics && agent.is_online) {
        cpu += metrics.cpu_usage;
        mem += (metrics.memory_used_kib / metrics.memory_total_kib) * 100;
        count++;
      }
    });

    return {
      onlineCount: online,
      offlineCount: filteredAgents.length - online,
      avgCpu: count > 0 ? cpu / count : 0,
      avgMem: count > 0 ? mem / count : 0,
    };
  }, [filteredAgents, metricsMap]);

  return (
    <div className="h-full overflow-y-auto">
      {/* Summary Header */}
      <div className="border border-terminal-border bg-terminal-panel/50 p-4 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-phosphor text-lg">▸</span>
          <h2
            className="text-xl font-bold text-phosphor"
            style={{ textShadow: '0 0 10px var(--color-phosphor-glow)' }}
          >
            FLEET OVERVIEW
          </h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Total Agents */}
          <div className="text-center p-3 border border-terminal-border bg-terminal-dark/50">
            <div className="text-3xl font-bold text-terminal-text mb-1">{agents.length}</div>
            <div className="text-xs text-terminal-dim uppercase">Total Agents</div>
          </div>

          {/* Online */}
          <div className="text-center p-3 border border-terminal-border bg-terminal-dark/50">
            <div className="text-3xl font-bold text-ok mb-1" style={{ textShadow: '0 0 10px var(--color-ok)' }}>
              {onlineCount}
            </div>
            <div className="text-xs text-terminal-dim uppercase">Online</div>
          </div>

          {/* Avg CPU */}
          <div className="text-center p-3 border border-terminal-border bg-terminal-dark/50">
            <div
              className="text-3xl font-bold mb-1 tabular-nums"
              style={{
                color: getStatusColor(avgCpu, { warn: 70, error: 90 }),
                textShadow: `0 0 10px ${getStatusColor(avgCpu, { warn: 70, error: 90 })}60`,
              }}
            >
              {avgCpu.toFixed(1)}%
            </div>
            <div className="text-xs text-terminal-dim uppercase">Avg CPU</div>
          </div>

          {/* Avg Memory */}
          <div className="text-center p-3 border border-terminal-border bg-terminal-dark/50">
            <div
              className="text-3xl font-bold mb-1 tabular-nums"
              style={{
                color: getStatusColor(avgMem, { warn: 80, error: 95 }),
                textShadow: `0 0 10px ${getStatusColor(avgMem, { warn: 80, error: 95 })}60`,
              }}
            >
              {avgMem.toFixed(1)}%
            </div>
            <div className="text-xs text-terminal-dim uppercase">Avg Memory</div>
          </div>
        </div>

        {offlineCount > 0 && (
          <div className="mt-3 px-3 py-2 border border-error/30 bg-error/10 text-error text-sm flex items-center gap-2">
            <span>⚠</span>
            <span>{offlineCount} agent{offlineCount > 1 ? 's' : ''} offline</span>
          </div>
        )}
      </div>

      {/* Group Filter */}
      {groups.length > 0 && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-terminal-dim uppercase mr-2">Filter:</span>
          <button
            onClick={() => onGroupChange(null)}
            className={`px-3 py-1 text-xs border transition-all ${
              selectedGroup === null
                ? 'border-phosphor bg-phosphor/20 text-phosphor'
                : 'border-terminal-border text-terminal-dim hover:text-terminal-text hover:border-terminal-text'
            }`}
          >
            ALL
          </button>
          {groups.map(group => (
            <button
              key={group}
              onClick={() => onGroupChange(group)}
              className={`px-3 py-1 text-xs border transition-all ${
                selectedGroup === group
                  ? 'border-info bg-info/20 text-info'
                  : 'border-terminal-border text-terminal-dim hover:text-terminal-text hover:border-terminal-text'
              }`}
            >
              {group.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {/* Agent Grid */}
      {loading && agents.length === 0 ? (
        <div className="text-center py-12 text-terminal-dim">
          <div className="animate-pulse text-lg">LOADING AGENTS...</div>
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="text-center py-12 text-terminal-dim border border-terminal-border">
          <pre className="text-4xl mb-4">[ ]</pre>
          <div>{selectedGroup ? `NO AGENTS IN GROUP "${selectedGroup.toUpperCase()}"` : 'NO AGENTS CONNECTED'}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredAgents.map(agent => (
            <AgentTile
              key={agent.id}
              agent={agent}
              metrics={metricsMap.get(agent.id)}
              onClick={() => onSelectAgent(agent.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
});
