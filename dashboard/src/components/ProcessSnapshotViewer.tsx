import { useState, useEffect } from 'react';
import type { ProcessSnapshot, Agent } from '../types/api';
import { getProcessesAtTime } from '../hooks/useApi';
import { formatBytes } from '../utils/format';

interface ProcessSnapshotViewerProps {
  agent: Agent;
  timestamp: number;
  onClose: () => void;
}

export function ProcessSnapshotViewer({
  agent,
  timestamp,
  onClose,
}: ProcessSnapshotViewerProps) {
  const [processes, setProcesses] = useState<ProcessSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'cpu' | 'memory'>('cpu');

  useEffect(() => {
    async function fetchProcesses() {
      setLoading(true);
      setError(null);

      try {
        const data = await getProcessesAtTime(agent.id, new Date(timestamp));
        setProcesses(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to fetch processes');
      } finally {
        setLoading(false);
      }
    }

    fetchProcesses();
  }, [agent.id, timestamp]);

  const sortedProcesses = [...processes].sort((a, b) => {
    if (sortBy === 'cpu') {
      return b.cpu_percent - a.cpu_percent;
    }
    return b.memory_rss_kib - a.memory_rss_kib;
  });

  const snapshotTime = processes.length > 0 ? new Date(processes[0].time) : new Date(timestamp);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="border border-terminal-border bg-terminal-panel p-6 max-w-4xl w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-phosphor">
              Process Snapshot: {agent.hostname}
            </h3>
            <div className="text-xs text-terminal-dim mt-1">
              {snapshotTime.toLocaleString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-2 py-1 text-terminal-dim hover:text-terminal-text"
          >
            ✕
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-terminal-dim animate-pulse">
              Loading process snapshot...
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-error">{error}</div>
          </div>
        )}

        {/* Process list */}
        {!loading && !error && (
          <>
            {/* Summary */}
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-terminal-border">
              <span className="text-sm text-terminal-dim">
                {processes.length} processes
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSortBy('cpu')}
                  className={`px-2 py-1 text-xs border ${
                    sortBy === 'cpu'
                      ? 'border-phosphor text-phosphor'
                      : 'border-terminal-border text-terminal-dim hover:text-terminal-text'
                  }`}
                >
                  Sort by CPU
                </button>
                <button
                  onClick={() => setSortBy('memory')}
                  className={`px-2 py-1 text-xs border ${
                    sortBy === 'memory'
                      ? 'border-phosphor text-phosphor'
                      : 'border-terminal-border text-terminal-dim hover:text-terminal-text'
                  }`}
                >
                  Sort by Memory
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto">
              {processes.length === 0 ? (
                <div className="text-center py-8 text-terminal-dim">
                  No process data available for this timestamp
                </div>
              ) : (
                <div className="border border-terminal-border">
                  {/* Table header */}
                  <div className="grid grid-cols-[60px_120px_60px_70px_80px_80px_1fr] gap-2 p-2 border-b border-terminal-border bg-terminal-dark/50 text-xs text-terminal-dim uppercase sticky top-0">
                    <div>PID</div>
                    <div>Name</div>
                    <div>State</div>
                    <div className="text-right">CPU %</div>
                    <div className="text-right">Memory</div>
                    <div>User</div>
                    <div>Command</div>
                  </div>

                  {/* Table rows */}
                  {sortedProcesses.map((proc, idx) => (
                    <div
                      key={`${proc.pid}-${idx}`}
                      className={`grid grid-cols-[60px_120px_60px_70px_80px_80px_1fr] gap-2 p-2 text-xs ${
                        idx % 2 === 0 ? 'bg-terminal-dark/20' : ''
                      }`}
                    >
                      <div className="text-terminal-dim font-mono">
                        {proc.pid}
                      </div>
                      <div
                        className="text-terminal-text font-semibold truncate"
                        title={proc.name}
                      >
                        {proc.name}
                      </div>
                      <div
                        className={`font-mono ${
                          proc.state === 'R'
                            ? 'text-ok'
                            : proc.state === 'S'
                            ? 'text-terminal-dim'
                            : proc.state === 'D'
                            ? 'text-warn'
                            : 'text-terminal-text'
                        }`}
                      >
                        {proc.state}
                      </div>
                      <div
                        className={`text-right font-mono ${
                          proc.cpu_percent > 50
                            ? 'text-error'
                            : proc.cpu_percent > 20
                            ? 'text-warn'
                            : 'text-ok'
                        }`}
                      >
                        {proc.cpu_percent.toFixed(1)}%
                      </div>
                      <div className="text-right font-mono text-info">
                        {formatBytes(proc.memory_rss_kib)}
                      </div>
                      <div className="text-terminal-dim truncate" title={proc.username}>
                        {proc.username}
                      </div>
                      <div
                        className="text-terminal-dim truncate"
                        title={proc.cmdline || '-'}
                      >
                        {proc.cmdline || '-'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="mt-4 pt-4 border-t border-terminal-border flex justify-end">
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
