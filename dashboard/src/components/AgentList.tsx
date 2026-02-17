import type { Agent } from '../types/api';
import { formatUptime } from '../utils/format';

interface AgentListProps {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}

export function AgentList({ agents, selectedId, onSelect, loading }: AgentListProps) {
  return (
    <div className="border border-terminal-border bg-terminal-panel/30 h-full flex flex-col">
      {/* Panel Header */}
      <div className="border-b border-terminal-border px-4 py-2 bg-terminal-dark/50">
        <div className="flex items-center gap-2">
          <span className="text-phosphor">▸</span>
          <span className="text-terminal-text font-semibold text-sm uppercase tracking-wider">
            Connected Agents
          </span>
          <span className="text-terminal-dim text-xs ml-auto">
            [{agents.length}]
          </span>
        </div>
      </div>

      {/* Agent List */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="text-terminal-dim text-sm p-4 text-center">
            <span className="inline-block animate-pulse">LOADING...</span>
          </div>
        ) : agents.length === 0 ? (
          <div className="text-terminal-dim text-sm p-4 text-center">
            NO AGENTS CONNECTED
          </div>
        ) : (
          <div className="space-y-1">
            {agents.map((agent, index) => (
              <button
                key={agent.id}
                onClick={() => onSelect(agent.id)}
                className={`w-full text-left px-3 py-2 transition-all duration-150 border ${
                  selectedId === agent.id
                    ? 'bg-phosphor/10 border-phosphor/50 text-phosphor'
                    : 'bg-transparent border-transparent hover:bg-terminal-border/30 hover:border-terminal-border text-terminal-text'
                }`}
                style={{
                  animationDelay: `${index * 50}ms`,
                }}
              >
                <div className="flex items-center gap-3">
                  {/* Status Indicator */}
                  <div
                    className={`w-2 h-2 rounded-full ${
                      agent.is_online ? 'bg-ok' : 'bg-error'
                    }`}
                    style={{
                      boxShadow: agent.is_online
                        ? '0 0 6px var(--color-ok), 0 0 12px var(--color-ok)'
                        : '0 0 6px var(--color-error)',
                      animation: agent.is_online ? 'pulse 2s ease-in-out infinite' : 'none',
                    }}
                  />

                  <div className="flex-1 min-w-0">
                    {/* Hostname */}
                    <div className="font-semibold truncate text-sm flex items-center gap-2">
                      {agent.hostname}
                      {agent.agent_group && (
                        <span className="px-1.5 py-0.5 text-[9px] bg-info/20 text-info border border-info/30 flex-shrink-0">
                          {agent.agent_group}
                        </span>
                      )}
                    </div>
                    {/* OS Info */}
                    <div className="text-xs text-terminal-dim truncate">
                      {agent.os_name}
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className="text-xs text-right">
                    <div className={agent.is_online ? 'text-ok' : 'text-error'}>
                      {agent.is_online ? 'ONLINE' : 'OFFLINE'}
                    </div>
                    <div className="text-terminal-dim">
                      {formatUptime(agent.last_seen_at)}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-terminal-border px-4 py-2 text-xs text-terminal-dim bg-terminal-dark/30">
        <span className="text-phosphor-dim">TIP:</span> Select agent to view metrics
      </div>
    </div>
  );
}
