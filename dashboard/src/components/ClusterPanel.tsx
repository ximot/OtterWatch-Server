import { useState } from 'react';
import { useMqttClusterStatus, updateAgentGroup, rebalanceMqttGroup, sendCommand } from '../hooks/useApi';
import type { Agent } from '../types/api';

// Format uptime from seconds to human-readable string
function formatUptimeSecs(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const hours = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (hours < 24) return `${hours}h ${mins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

interface ClusterPanelProps {
  agents: Agent[];
  onAgentUpdated?: () => void;
}

function NodeStateIndicator({ state }: { state: string }) {
  const stateColors: Record<string, string> = {
    healthy: 'bg-ok',
    suspect: 'bg-amber',
    down: 'bg-error',
    joining: 'bg-info',
  };

  const stateLabels: Record<string, string> = {
    healthy: 'HEALTHY',
    suspect: 'SUSPECT',
    down: 'DOWN',
    joining: 'JOINING',
  };

  return (
    <span className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${stateColors[state] || 'bg-terminal-dim'}`} />
      <span className={state === 'healthy' ? 'text-ok' : state === 'down' ? 'text-error' : 'text-amber'}>
        {stateLabels[state] || state.toUpperCase()}
      </span>
    </span>
  );
}

function StatCard({ label, value, unit, color = 'text-phosphor' }: {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
}) {
  return (
    <div className="border border-terminal-border bg-terminal-panel/50 p-4">
      <div className="text-terminal-dim text-xs mb-1">{label}</div>
      <div className={`text-2xl font-mono ${color}`}>
        {value}
        {unit && <span className="text-sm text-terminal-dim ml-1">{unit}</span>}
      </div>
    </div>
  );
}

export function ClusterPanel({ agents, onAgentUpdated }: ClusterPanelProps) {
  const { status, loading, error, refresh } = useMqttClusterStatus(5000);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [changingAgent, setChangingAgent] = useState<string | null>(null);
  const [rebalanceGroup, setRebalanceGroup] = useState<string | null>(null);
  const [rebalanceTarget, setRebalanceTarget] = useState<string>('');
  const [rebalancing, setRebalancing] = useState(false);
  const [rebalanceMessage, setRebalanceMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Calculate agents per group
  const agentsByGroup: Record<string, Agent[]> = {};
  for (const agent of agents) {
    const group = agent.agent_group || 'default';
    if (!agentsByGroup[group]) agentsByGroup[group] = [];
    agentsByGroup[group].push(agent);
  }

  // Find which node handles each group
  const getNodeForGroup = (group: string): string | null => {
    if (!status) return null;
    // Direct assignment
    if (status.group_assignments[group]) {
      return status.group_assignments[group];
    }
    // Check if any node has this group in assigned_groups
    for (const node of status.nodes) {
      if (node.assigned_groups.includes(group)) {
        return node.name;
      }
    }
    // Fallback to node with 'default' if this group is not explicitly assigned
    if (group !== 'default') {
      return status.group_assignments['default'] || null;
    }
    return null;
  };

  // Handle agent group change
  const handleGroupChange = async (agentId: string, newGroup: string) => {
    try {
      // Find the agent to check if it's online
      const agent = agents.find(a => a.id === agentId);

      // If agent is online, send set-group command to update its local config
      if (agent?.is_online) {
        try {
          await sendCommand(agentId, 'set-group', { group: newGroup || '' });
        } catch (cmdError) {
          console.warn('Failed to send set-group command to agent:', cmdError);
          // Continue to update server database even if command fails
        }
      }

      await updateAgentGroup(agentId, newGroup || null);
      onAgentUpdated?.();
      setChangingAgent(null);
    } catch (e) {
      console.error('Failed to update group:', e);
    }
  };

  // Handle group rebalance to a different node
  const handleRebalance = async () => {
    if (!rebalanceGroup || !rebalanceTarget) return;

    setRebalancing(true);
    setRebalanceMessage(null);

    try {
      const result = await rebalanceMqttGroup(rebalanceGroup, rebalanceTarget);
      if (result.success) {
        setRebalanceMessage({ type: 'success', text: result.message });
        setRebalanceGroup(null);
        setRebalanceTarget('');
        // Refresh cluster status
        refresh();
      } else {
        setRebalanceMessage({ type: 'error', text: result.message });
      }
    } catch (e) {
      setRebalanceMessage({ type: 'error', text: e instanceof Error ? e.message : 'Rebalance failed' });
    } finally {
      setRebalancing(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="border border-terminal-border bg-terminal-panel p-6">
        <div className="flex items-center gap-3 text-terminal-dim">
          <span className="animate-pulse">Loading cluster status...</span>
        </div>
      </div>
    );
  }

  if (!status?.configured) {
    return (
      <div className="border border-terminal-border bg-terminal-panel p-6">
        <h2 className="text-lg font-bold text-amber mb-4">
          <span className="mr-2">&#9888;</span>
          MQTT CLUSTER NOT CONFIGURED
        </h2>
        <p className="text-terminal-text mb-4">
          No MQTT broker nodes are configured. Add the following to your server's <code className="text-phosphor">settings.toml</code>:
        </p>
        <pre className="bg-terminal-bg border border-terminal-border p-4 text-sm text-phosphor overflow-x-auto">
{`mqtt_cluster_nodes = [
  "http://broker1:8085",
  "http://broker2:8086"
]`}
        </pre>
        {status?.errors && status.errors.length > 0 && (
          <div className="mt-4 text-error text-sm">
            {status.errors.map((err, i) => (
              <div key={i}>{err}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-phosphor">
          <span className="mr-2">&#9673;</span>
          MQTT CLUSTER STATUS
        </h2>
        <button
          onClick={refresh}
          className="px-3 py-1 text-sm border border-terminal-border hover:bg-terminal-border/30 text-terminal-text"
        >
          REFRESH
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="CLUSTER NODES"
          value={`${status.reachable_nodes}/${status.configured_nodes}`}
          color={status.reachable_nodes === status.configured_nodes ? 'text-ok' : 'text-amber'}
        />
        <StatCard
          label="TOTAL CONNECTIONS"
          value={status.total_connections}
          color="text-info"
        />
        <StatCard
          label="MESSAGES PROCESSED"
          value={status.total_messages.toLocaleString()}
          color="text-phosphor"
        />
        <StatCard
          label="RETAINED MESSAGES"
          value={status.retained_count}
          color="text-terminal-text"
        />
      </div>

      {/* Errors */}
      {status.errors.length > 0 && (
        <div className="border border-error/50 bg-error/10 p-4">
          <h3 className="text-error font-bold mb-2">CONNECTIVITY ERRORS</h3>
          {status.errors.map((err, i) => (
            <div key={i} className="text-error/80 text-sm">{err}</div>
          ))}
        </div>
      )}

      {/* Cluster Nodes */}
      <div className="border border-terminal-border bg-terminal-panel">
        <div className="border-b border-terminal-border px-4 py-3 bg-terminal-border/20">
          <h3 className="font-bold text-terminal-text">CLUSTER NODES</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-terminal-border text-terminal-dim text-left">
                <th className="px-4 py-2">NODE</th>
                <th className="px-4 py-2">STATUS</th>
                <th className="px-4 py-2">MQTT ADDRESS</th>
                <th className="px-4 py-2">CONNECTIONS</th>
                <th className="px-4 py-2">ASSIGNED GROUPS</th>
              </tr>
            </thead>
            <tbody>
              {status.nodes.map((node) => (
                <tr key={node.name} className="border-b border-terminal-border/50 hover:bg-terminal-border/20">
                  <td className="px-4 py-3">
                    <span className="font-mono text-phosphor">
                      {node.name}
                      {node.is_local && (
                        <span className="ml-2 text-xs text-terminal-dim">(local)</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <NodeStateIndicator state={node.state} />
                  </td>
                  <td className="px-4 py-3 font-mono text-terminal-dim">
                    {node.mqtt_addr}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    <span className={node.connection_count > 0 ? 'text-info' : 'text-terminal-dim'}>
                      {node.connection_count}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {node.assigned_groups.length > 0 ? (
                        node.assigned_groups.map((group) => (
                          <span
                            key={group}
                            className="px-2 py-0.5 bg-phosphor/20 text-phosphor text-xs"
                          >
                            {group}
                          </span>
                        ))
                      ) : (
                        <span className="text-terminal-dim text-xs">all groups</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {status.nodes.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-terminal-dim">
                    No cluster nodes found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Group Assignments */}
      <div className="border border-terminal-border bg-terminal-panel">
        <div className="border-b border-terminal-border px-4 py-3 bg-terminal-border/20 flex items-center justify-between">
          <h3 className="font-bold text-terminal-text">GROUP ASSIGNMENTS</h3>
          {rebalanceMessage && (
            <div className={`text-sm ${rebalanceMessage.type === 'success' ? 'text-ok' : 'text-error'}`}>
              {rebalanceMessage.text}
            </div>
          )}
        </div>
        <div className="p-4">
          {Object.keys(status.group_assignments).length > 0 || Object.keys(agentsByGroup).length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Show all groups (both from assignments and from agents) */}
              {[...new Set([...Object.keys(status.group_assignments), ...Object.keys(agentsByGroup)])].map((group) => {
                const currentNode = status.group_assignments[group] || getNodeForGroup(group) || 'unassigned';
                const isRebalancing = rebalanceGroup === group;

                return (
                  <div
                    key={group}
                    className="border border-terminal-border/50 p-3 bg-terminal-bg/50"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-phosphor font-mono">{group}</span>
                      <span className="text-terminal-dim text-sm">
                        → <span className="text-info">{currentNode}</span>
                      </span>
                    </div>

                    {isRebalancing ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={rebalanceTarget}
                          onChange={(e) => setRebalanceTarget(e.target.value)}
                          className="flex-1 bg-terminal-bg border border-terminal-border px-2 py-1 text-sm text-phosphor focus:outline-none focus:border-phosphor"
                          disabled={rebalancing}
                        >
                          <option value="">Select node...</option>
                          {status.nodes.map((node) => (
                            <option key={node.name} value={node.name}>
                              {node.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={handleRebalance}
                          disabled={!rebalanceTarget || rebalancing}
                          className="px-2 py-1 bg-ok/20 text-ok text-xs hover:bg-ok/30 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {rebalancing ? '...' : '✓'}
                        </button>
                        <button
                          onClick={() => { setRebalanceGroup(null); setRebalanceTarget(''); }}
                          className="px-2 py-1 bg-error/20 text-error text-xs hover:bg-error/30"
                          disabled={rebalancing}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setRebalanceGroup(group)}
                        className="w-full text-center px-2 py-1 bg-terminal-border/30 text-terminal-dim text-xs hover:bg-terminal-border/50 hover:text-terminal-text transition-colors"
                      >
                        MOVE TO NODE
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-terminal-dim text-center py-4">
              No group assignments configured
            </div>
          )}
        </div>
      </div>

      {/* Agent Groups */}
      <div className="border border-terminal-border bg-terminal-panel">
        <div className="border-b border-terminal-border px-4 py-3 bg-terminal-border/20">
          <h3 className="font-bold text-terminal-text">AGENTS BY GROUP</h3>
        </div>
        <div className="divide-y divide-terminal-border/50">
          {Object.entries(agentsByGroup).map(([group, groupAgents]) => {
            const node = getNodeForGroup(group);
            const isExpanded = expandedGroup === group;
            return (
              <div key={group}>
                {/* Group header */}
                <button
                  onClick={() => setExpandedGroup(isExpanded ? null : group)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-terminal-border/20 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-terminal-dim">{isExpanded ? '▼' : '▶'}</span>
                    <span className="font-mono text-phosphor">{group}</span>
                    <span className="px-2 py-0.5 bg-info/20 text-info text-xs">
                      {groupAgents.length} agent{groupAgents.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {node && (
                      <span className="text-terminal-dim text-sm">
                        → <span className="text-info">{node}</span>
                      </span>
                    )}
                  </div>
                </button>

                {/* Expanded agents list */}
                {isExpanded && (
                  <div className="bg-terminal-bg/50 border-t border-terminal-border/30">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-terminal-dim text-left text-xs">
                          <th className="px-4 py-2 pl-10">HOSTNAME</th>
                          <th className="px-4 py-2">STATUS</th>
                          <th className="px-4 py-2">VERSION</th>
                          <th className="px-4 py-2">GROUP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupAgents.map((agent) => (
                          <tr key={agent.id} className="border-t border-terminal-border/20 hover:bg-terminal-border/10">
                            <td className="px-4 py-2 pl-10 font-mono text-phosphor">
                              {agent.hostname}
                            </td>
                            <td className="px-4 py-2">
                              <span className={`flex items-center gap-2 ${agent.is_online ? 'text-ok' : 'text-terminal-dim'}`}>
                                <span className={`w-2 h-2 rounded-full ${agent.is_online ? 'bg-ok' : 'bg-terminal-dim'}`} />
                                {agent.is_online ? 'ONLINE' : 'OFFLINE'}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-terminal-dim font-mono">
                              v{agent.agent_version}
                            </td>
                            <td className="px-4 py-2">
                              {changingAgent === agent.id ? (
                                <select
                                  autoFocus
                                  defaultValue={agent.agent_group || ''}
                                  onChange={(e) => handleGroupChange(agent.id, e.target.value)}
                                  onBlur={() => setChangingAgent(null)}
                                  className="bg-terminal-bg border border-terminal-border px-2 py-1 text-sm text-phosphor focus:outline-none focus:border-phosphor"
                                >
                                  <option value="">default</option>
                                  {Object.keys(status.group_assignments)
                                    .filter(g => g !== 'default')
                                    .map(g => (
                                      <option key={g} value={g}>{g}</option>
                                    ))}
                                  {/* Also include current groups from agents */}
                                  {Object.keys(agentsByGroup)
                                    .filter(g => g !== 'default' && !status.group_assignments[g])
                                    .map(g => (
                                      <option key={g} value={g}>{g}</option>
                                    ))}
                                </select>
                              ) : (
                                <button
                                  onClick={() => setChangingAgent(agent.id)}
                                  className="px-2 py-0.5 bg-phosphor/10 text-phosphor text-xs hover:bg-phosphor/20 transition-colors"
                                  title="Click to change group"
                                >
                                  {agent.agent_group || 'default'}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          {Object.keys(agentsByGroup).length === 0 && (
            <div className="px-4 py-8 text-center text-terminal-dim">
              No agents registered
            </div>
          )}
        </div>
      </div>

      {/* Broker Stats */}
      {status.broker_stats.length > 0 && (
        <div className="border border-terminal-border bg-terminal-panel">
          <div className="border-b border-terminal-border px-4 py-3 bg-terminal-border/20">
            <h3 className="font-bold text-terminal-text">BROKER STATISTICS</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-terminal-border text-terminal-dim text-left">
                  <th className="px-4 py-2">NODE</th>
                  <th className="px-4 py-2">UPTIME</th>
                  <th className="px-4 py-2">CONNECTIONS</th>
                  <th className="px-4 py-2">SUBSCRIPTIONS</th>
                  <th className="px-4 py-2">MSG RECEIVED</th>
                  <th className="px-4 py-2">MSG FAILED</th>
                </tr>
              </thead>
              <tbody>
                {status.broker_stats.map((stats) => (
                  <tr key={stats.node} className="border-b border-terminal-border/50 hover:bg-terminal-border/20">
                    <td className="px-4 py-3 font-mono text-phosphor">{stats.node}</td>
                    <td className="px-4 py-3 text-terminal-dim">{formatUptimeSecs(stats.uptime_secs)}</td>
                    <td className="px-4 py-3 font-mono text-info">{stats.connections_active}</td>
                    <td className="px-4 py-3 font-mono">{stats.subscriptions_active}</td>
                    <td className="px-4 py-3 font-mono text-ok">{stats.messages_received.toLocaleString()}</td>
                    <td className="px-4 py-3 font-mono">
                      <span className={stats.messages_failed > 0 ? 'text-error' : 'text-terminal-dim'}>
                        {stats.messages_failed}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Error indicator */}
      {error && (
        <div className="text-error text-sm">
          Error: {error}
        </div>
      )}
    </div>
  );
}
