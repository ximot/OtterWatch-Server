import { useState, useMemo, memo } from 'react';
import type { ProcessSnapshot } from '../types/api';

interface ProcessPanelProps {
  processes: ProcessSnapshot[];
  loading: boolean;
}

type SortField = 'cpu_percent' | 'memory_rss_kib' | 'pid' | 'name' | 'username';
type SortDirection = 'asc' | 'desc';

function formatMemory(kib: number): string {
  if (kib < 1024) return `${kib} KiB`;
  if (kib < 1024 * 1024) return `${(kib / 1024).toFixed(1)} MiB`;
  return `${(kib / 1024 / 1024).toFixed(2)} GiB`;
}

function getStateLabel(state: string): { label: string; color: string } {
  switch (state) {
    case 'R':
      return { label: 'Running', color: 'text-ok' };
    case 'S':
      return { label: 'Sleeping', color: 'text-terminal-dim' };
    case 'D':
      return { label: 'Disk Sleep', color: 'text-amber' };
    case 'Z':
      return { label: 'Zombie', color: 'text-error' };
    case 'T':
      return { label: 'Stopped', color: 'text-info' };
    case 'I':
      return { label: 'Idle', color: 'text-terminal-dim' };
    default:
      return { label: state, color: 'text-terminal-dim' };
  }
}

export const ProcessPanel = memo(function ProcessPanel({ processes, loading }: ProcessPanelProps) {
  const [sortField, setSortField] = useState<SortField>('cpu_percent');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filter, setFilter] = useState('');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Memoize sorting and filtering to avoid recalculation on every render
  const sortedProcesses = useMemo(() => {
    return [...processes]
      .filter(
        (p) =>
          filter === '' ||
          p.name.toLowerCase().includes(filter.toLowerCase()) ||
          p.username.toLowerCase().includes(filter.toLowerCase()) ||
          p.pid.toString().includes(filter)
      )
      .sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case 'cpu_percent':
            comparison = a.cpu_percent - b.cpu_percent;
            break;
          case 'memory_rss_kib':
            comparison = a.memory_rss_kib - b.memory_rss_kib;
            break;
          case 'pid':
            comparison = a.pid - b.pid;
            break;
          case 'name':
            comparison = a.name.localeCompare(b.name);
            break;
          case 'username':
            comparison = a.username.localeCompare(b.username);
            break;
        }
        return sortDirection === 'desc' ? -comparison : comparison;
      });
  }, [processes, filter, sortField, sortDirection]);

  const SortHeader = ({
    field,
    label,
    className = '',
  }: {
    field: SortField;
    label: string;
    className?: string;
  }) => (
    <th
      className={`px-2 py-2 text-left cursor-pointer hover:bg-terminal-border/30 select-none ${className}`}
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {sortField === field && (
          <span className="text-phosphor">{sortDirection === 'desc' ? '▼' : '▲'}</span>
        )}
      </div>
    </th>
  );

  if (loading && processes.length === 0) {
    return (
      <div className="border border-terminal-border bg-terminal-panel/50 p-4 h-full">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-phosphor animate-pulse">▸</span>
          <span className="text-terminal-dim">Loading process list...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-terminal-border bg-terminal-panel/50 p-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-phosphor text-lg">▸</span>
          <h2
            className="text-xl font-bold text-phosphor"
            style={{ textShadow: '0 0 10px var(--color-phosphor)' }}
          >
            PROCESS LIST
          </h2>
          <span className="text-terminal-dim text-sm ml-2">
            ({sortedProcesses.length} processes)
          </span>
        </div>

        {/* Filter input */}
        <div className="flex items-center gap-2">
          <span className="text-terminal-dim text-sm">Filter:</span>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="name, user, pid..."
            className="px-2 py-1 text-sm bg-terminal-dark border border-terminal-border text-terminal-text placeholder-terminal-dim focus:border-phosphor focus:outline-none"
          />
        </div>
      </div>

      {/* Process table */}
      {processes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-terminal-dim">
          <div className="text-center">
            <div className="text-4xl mb-2">⏳</div>
            <div>No process data available</div>
            <div className="text-sm mt-1">Waiting for agent to send process list...</div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-terminal-panel border-b border-terminal-border">
              <tr className="text-terminal-dim text-xs uppercase tracking-wider">
                <SortHeader field="pid" label="PID" className="w-16" />
                <SortHeader field="name" label="Name" />
                <SortHeader field="username" label="User" className="w-24" />
                <SortHeader field="cpu_percent" label="CPU%" className="w-20 text-right" />
                <SortHeader field="memory_rss_kib" label="Memory" className="w-24 text-right" />
                <th className="px-2 py-2 text-left w-16">State</th>
                <th className="px-2 py-2 text-left w-16">THR</th>
                <th className="px-2 py-2 text-left">Command</th>
              </tr>
            </thead>
            <tbody>
              {sortedProcesses.map((proc) => {
                const stateInfo = getStateLabel(proc.state);
                const cpuColor =
                  proc.cpu_percent > 80
                    ? 'text-error'
                    : proc.cpu_percent > 50
                    ? 'text-amber'
                    : proc.cpu_percent > 10
                    ? 'text-ok'
                    : 'text-terminal-text';

                return (
                  <tr
                    key={`${proc.pid}-${proc.time}`}
                    className="border-b border-terminal-border/30 hover:bg-terminal-border/20"
                  >
                    <td className="px-2 py-1.5 font-mono text-terminal-dim">{proc.pid}</td>
                    <td className="px-2 py-1.5 font-semibold text-terminal-text truncate max-w-[150px]">
                      {proc.name}
                    </td>
                    <td className="px-2 py-1.5 text-info truncate max-w-[100px]">
                      {proc.username}
                    </td>
                    <td className={`px-2 py-1.5 text-right font-mono ${cpuColor}`}>
                      {proc.cpu_percent.toFixed(1)}%
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-terminal-text">
                      {formatMemory(proc.memory_rss_kib)}
                    </td>
                    <td className={`px-2 py-1.5 ${stateInfo.color}`}>
                      <span title={stateInfo.label}>{proc.state}</span>
                    </td>
                    <td className="px-2 py-1.5 text-terminal-dim">{proc.threads}</td>
                    <td className="px-2 py-1.5 text-terminal-dim truncate max-w-[300px]">
                      <span title={proc.cmdline || proc.name}>
                        {proc.cmdline || `[${proc.name}]`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer with timestamp */}
      {processes.length > 0 && (
        <div className="mt-2 pt-2 border-t border-terminal-border/30 text-xs text-terminal-dim flex justify-between">
          <span>
            Last updated: {new Date(processes[0]?.time).toLocaleTimeString()}
          </span>
          <span>
            Total CPU: {sortedProcesses.reduce((sum, p) => sum + p.cpu_percent, 0).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
});
