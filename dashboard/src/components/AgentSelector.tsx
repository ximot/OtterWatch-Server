import { useState, useRef, useEffect } from 'react';
import type { Agent } from '../types/api';
import { getAgentColor } from '../utils/chartColors';

interface AgentSelectorProps {
  agents: Agent[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  maxSelection?: number;
}

export function AgentSelector({
  agents,
  selectedIds,
  onChange,
  maxSelection = 6,
}: AgentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleAgent = (agentId: string) => {
    if (selectedIds.includes(agentId)) {
      onChange(selectedIds.filter((id) => id !== agentId));
    } else if (selectedIds.length < maxSelection) {
      onChange([...selectedIds, agentId]);
    }
  };

  const selectAll = () => {
    onChange(agents.slice(0, maxSelection).map((a) => a.id));
  };

  const clearAll = () => {
    onChange([]);
  };

  // Get display text for the dropdown button
  const getButtonText = () => {
    if (selectedIds.length === 0) {
      return 'Select Agents...';
    }
    if (selectedIds.length === 1) {
      const agent = agents.find((a) => a.id === selectedIds[0]);
      return agent?.hostname || '1 agent';
    }
    return `${selectedIds.length} agents`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Dropdown button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono border border-terminal-border text-terminal-text hover:border-terminal-text transition-colors min-w-[180px]"
      >
        <span className="flex-1 text-left truncate">{getButtonText()}</span>
        <span className="text-terminal-dim">{isOpen ? '▲' : '▼'}</span>
      </button>

      {/* Selected agent color indicators */}
      {selectedIds.length > 0 && (
        <div className="flex gap-1 mt-1">
          {selectedIds.map((id, index) => {
            const agent = agents.find((a) => a.id === id);
            return (
              <div
                key={id}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] border border-terminal-border bg-terminal-dark"
                style={{ borderColor: getAgentColor(index) }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: getAgentColor(index) }}
                />
                <span className="text-terminal-dim truncate max-w-[60px]">
                  {agent?.hostname || id.slice(0, 8)}
                </span>
                <button
                  onClick={() => toggleAgent(id)}
                  className="text-terminal-dim hover:text-error ml-1"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-64 border border-terminal-border bg-terminal-panel shadow-lg max-h-80 overflow-y-auto">
          {/* Header with actions */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-terminal-border bg-terminal-dark">
            <span className="text-xs text-terminal-dim">
              {selectedIds.length}/{maxSelection} selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="text-xs text-info hover:text-info/80"
              >
                All
              </button>
              <button
                onClick={clearAll}
                className="text-xs text-error hover:text-error/80"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Agent list */}
          <div className="py-1">
            {agents.map((agent, index) => {
              const isSelected = selectedIds.includes(agent.id);
              const isDisabled = !isSelected && selectedIds.length >= maxSelection;
              const colorIndex = isSelected ? selectedIds.indexOf(agent.id) : index;

              return (
                <button
                  key={agent.id}
                  onClick={() => toggleAgent(agent.id)}
                  disabled={isDisabled}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                    isDisabled
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:bg-terminal-border/20'
                  }`}
                >
                  {/* Checkbox */}
                  <span
                    className={`w-4 h-4 border flex items-center justify-center ${
                      isSelected
                        ? 'border-phosphor bg-phosphor/20 text-phosphor'
                        : 'border-terminal-border'
                    }`}
                  >
                    {isSelected && '✓'}
                  </span>

                  {/* Color indicator */}
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{
                      backgroundColor: isSelected
                        ? getAgentColor(colorIndex)
                        : 'transparent',
                      border: isSelected
                        ? 'none'
                        : `1px solid ${getAgentColor(index)}`,
                    }}
                  />

                  {/* Agent info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-terminal-text truncate">
                      {agent.hostname}
                    </div>
                    <div className="text-[10px] text-terminal-dim truncate">
                      {agent.os_name}
                    </div>
                  </div>

                  {/* Online status */}
                  <span
                    className={`w-2 h-2 rounded-full ${
                      agent.is_online ? 'bg-ok' : 'bg-error'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
