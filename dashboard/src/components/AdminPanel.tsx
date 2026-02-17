import { useState, useEffect, useRef, useCallback } from 'react';
import type { Agent, ServerStats, AgentConfig, SwapProcessList } from '../types/api';
import { getConfigParamDef, validateConfigValue } from '../types/api';
import { getServerStats, deleteAgent, deleteAgentMetrics, deleteAgentsByGroup, updateAgentGroup, useGroups, sendCommand, getLatestUpdate, sendUpdateCommand, refreshUpdatesOnServer, getAgentConfig, getAgentSwapProcesses, setAgentConfigValue, type LatestUpdateInfo } from '../hooks/useApi';
import { formatUptime, formatBytesRaw } from '../utils/format';

// Bulk update types
interface BulkUpdateState {
  isRunning: boolean;
  queue: Agent[];
  current: Agent | null;
  completed: { agent: Agent; success: boolean; error?: string }[];
  cancelled: boolean;
}

const INITIAL_BULK_UPDATE_STATE: BulkUpdateState = {
  isRunning: false,
  queue: [],
  current: null,
  completed: [],
  cancelled: false,
};

interface AdminPanelProps {
  agents: Agent[];
  onAgentDeleted: () => void;
}

function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
  dangerous = false,
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  dangerous?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="border border-terminal-border bg-terminal-panel p-6 max-w-md w-full mx-4">
        <h3 className={`text-lg font-bold mb-4 ${dangerous ? 'text-error' : 'text-amber'}`}>
          {title}
        </h3>
        <p className="text-terminal-text mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-terminal-border text-terminal-text hover:bg-terminal-border/30"
          >
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 border ${
              dangerous
                ? 'border-error bg-error/20 text-error hover:bg-error/40'
                : 'border-amber bg-amber/20 text-amber hover:bg-amber/40'
            }`}
          >
            CONFIRM
          </button>
        </div>
      </div>
    </div>
  );
}

// Editable config value component for inline editing
function EditableConfigValue({
  configKey,
  value,
  agentId,
  onUpdated,
}: {
  configKey: string;
  value: string | number | boolean;
  agentId: string;
  onUpdated: (key: string, newValue: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const paramDef = getConfigParamDef(configKey);
  const isReadOnly = paramDef?.readOnly ?? false;
  const isBool = paramDef?.type === 'bool';

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(String(value));
  }, [value]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  const handleSave = async () => {
    const validation = validateConfigValue(configKey, editValue);
    if (!validation.valid) {
      setError(validation.error || 'Invalid value');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await setAgentConfigValue(agentId, configKey, editValue);
      if (result.success) {
        setSuccess(true);
        setIsEditing(false);
        onUpdated(configKey, editValue);
      } else {
        setError(result.message || 'Failed to update');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(String(value));
      setError(null);
    }
  };

  const handleToggleBool = async () => {
    if (isReadOnly || saving) return;
    const newValue = value === true || value === 'true' ? 'false' : 'true';
    setSaving(true);
    setError(null);
    try {
      const result = await setAgentConfigValue(agentId, configKey, newValue);
      if (result.success) {
        setSuccess(true);
        onUpdated(configKey, newValue);
      } else {
        setError(result.message || 'Failed to update');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  // Boolean toggle
  if (isBool) {
    const boolValue = value === true || value === 'true';
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleToggleBool}
          disabled={isReadOnly || saving}
          className={`px-2 py-0.5 text-xs border transition-colors ${
            boolValue
              ? 'border-ok/50 bg-ok/20 text-ok'
              : 'border-terminal-border bg-terminal-dark text-terminal-dim'
          } ${isReadOnly ? 'cursor-not-allowed opacity-50' : 'hover:opacity-80 cursor-pointer'}`}
        >
          {saving ? '...' : boolValue ? 'true' : 'false'}
        </button>
        {success && <span className="text-ok text-xs">✓</span>}
        {error && <span className="text-error text-xs" title={error}>✕</span>}
      </div>
    );
  }

  // Read-only value
  if (isReadOnly) {
    return (
      <div className="text-terminal-text truncate" title={String(value)}>
        {String(value)}
      </div>
    );
  }

  // Editing mode
  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type={paramDef?.type === 'int' ? 'number' : 'text'}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (!saving) {
              setIsEditing(false);
              setEditValue(String(value));
              setError(null);
            }
          }}
          min={paramDef?.min}
          max={paramDef?.max}
          disabled={saving}
          className="w-full px-1 py-0.5 bg-terminal-dark border border-info text-terminal-text text-xs focus:outline-none"
        />
        {saving && <span className="text-info text-xs animate-pulse">...</span>}
        {error && <span className="text-error text-xs" title={error}>✕</span>}
      </div>
    );
  }

  // Display mode - clickable
  return (
    <div className="flex items-center gap-1 group">
      <button
        onClick={() => setIsEditing(true)}
        className="text-terminal-text hover:text-info hover:underline truncate text-left"
        title={`${String(value)} (click to edit)`}
      >
        {String(value)}
      </button>
      <span className="text-terminal-dim opacity-0 group-hover:opacity-100 text-xs">✎</span>
      {success && <span className="text-ok text-xs">✓</span>}
    </div>
  );
}

function ConfigViewerModal({
  agent,
  config,
  loading,
  error,
  onClose,
  onConfigUpdated,
}: {
  agent: Agent;
  config: AgentConfig | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConfigUpdated: (key: string, newValue: string) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="border border-terminal-border bg-terminal-panel p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-info">
            Configuration: {agent.hostname}
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
            Retrieving configuration from agent...
          </div>
        )}

        {error && (
          <div className="text-error py-4">
            {error}
          </div>
        )}

        {config && (
          <div className="space-y-4 font-mono text-sm">
            <div className="text-xs text-terminal-dim mb-2">
              Click on values to edit. Changes are saved immediately.
            </div>

            {/* Collection Settings */}
            <div className="border border-terminal-border p-3">
              <div className="text-xs text-terminal-dim uppercase mb-2">Collection</div>
              <div className="grid grid-cols-2 gap-2 items-center">
                <div className="text-terminal-dim">interval_secs:</div>
                <EditableConfigValue configKey="interval_secs" value={config.interval_secs} agentId={agent.id} onUpdated={onConfigUpdated} />
                <div className="text-terminal-dim">process_interval:</div>
                <EditableConfigValue configKey="process_list_interval_secs" value={config.process_list_interval_secs} agentId={agent.id} onUpdated={onConfigUpdated} />
                <div className="text-terminal-dim">process_top_n:</div>
                <EditableConfigValue configKey="process_top_n" value={config.process_top_n} agentId={agent.id} onUpdated={onConfigUpdated} />
              </div>
            </div>

            {/* Network Settings */}
            <div className="border border-terminal-border p-3">
              <div className="text-xs text-terminal-dim uppercase mb-2">Network</div>
              <div className="grid grid-cols-2 gap-2 items-center">
                <div className="text-terminal-dim">listen_addr:</div>
                <EditableConfigValue configKey="listen_addr" value={config.listen_addr} agentId={agent.id} onUpdated={onConfigUpdated} />
                <div className="text-terminal-dim">mqtt_enabled:</div>
                <EditableConfigValue configKey="mqtt_enabled" value={config.mqtt_enabled} agentId={agent.id} onUpdated={onConfigUpdated} />
                <div className="text-terminal-dim">mqtt_broker:</div>
                <EditableConfigValue configKey="mqtt_broker_addr" value={config.mqtt_broker_addr} agentId={agent.id} onUpdated={onConfigUpdated} />
                <div className="text-terminal-dim">mqtt_topic:</div>
                <EditableConfigValue configKey="mqtt_topic_prefix" value={config.mqtt_topic_prefix} agentId={agent.id} onUpdated={onConfigUpdated} />
              </div>
            </div>

            {/* Storage Settings */}
            <div className="border border-terminal-border p-3">
              <div className="text-xs text-terminal-dim uppercase mb-2">Storage</div>
              <div className="grid grid-cols-2 gap-2 items-center">
                <div className="text-terminal-dim">db_save:</div>
                <EditableConfigValue configKey="db_save" value={config.db_save} agentId={agent.id} onUpdated={onConfigUpdated} />
                <div className="text-terminal-dim">db_file_name:</div>
                <EditableConfigValue configKey="db_file_name" value={config.db_file_name} agentId={agent.id} onUpdated={onConfigUpdated} />
                <div className="text-terminal-dim">db_history_days:</div>
                <EditableConfigValue configKey="db_history_days" value={config.db_history_days} agentId={agent.id} onUpdated={onConfigUpdated} />
                <div className="text-terminal-dim">exclude_interfaces:</div>
                <EditableConfigValue configKey="exclude_interfaces" value={config.exclude_interfaces || ''} agentId={agent.id} onUpdated={onConfigUpdated} />
              </div>
            </div>

            {/* Paths (read-only) */}
            <div className="border border-terminal-border p-3">
              <div className="text-xs text-terminal-dim uppercase mb-2">Paths (read-only)</div>
              <div className="grid grid-cols-2 gap-2 items-center">
                <div className="text-terminal-dim">config_path:</div>
                <EditableConfigValue configKey="config_path" value={config.config_path} agentId={agent.id} onUpdated={onConfigUpdated} />
                <div className="text-terminal-dim">data_directory:</div>
                <EditableConfigValue configKey="data_directory" value={config.data_directory} agentId={agent.id} onUpdated={onConfigUpdated} />
              </div>
            </div>

            {/* Agent */}
            <div className="border border-terminal-border p-3">
              <div className="text-xs text-terminal-dim uppercase mb-2">Agent</div>
              <div className="grid grid-cols-2 gap-2 items-center">
                <div className="text-terminal-dim">agent_group:</div>
                <EditableConfigValue configKey="agent_group" value={config.agent_group || ''} agentId={agent.id} onUpdated={onConfigUpdated} />
              </div>
            </div>

            {/* MQTT Advanced (if available) */}
            {(config.mqtt_keepalive_secs !== undefined || config.mqtt_retry_interval_secs !== undefined) && (
              <div className="border border-terminal-border p-3">
                <div className="text-xs text-terminal-dim uppercase mb-2">MQTT Advanced</div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  {config.mqtt_keepalive_secs !== undefined && (
                    <>
                      <div className="text-terminal-dim">keepalive_secs:</div>
                      <EditableConfigValue configKey="mqtt_keepalive_secs" value={config.mqtt_keepalive_secs} agentId={agent.id} onUpdated={onConfigUpdated} />
                    </>
                  )}
                  {config.mqtt_retry_interval_secs !== undefined && (
                    <>
                      <div className="text-terminal-dim">retry_interval:</div>
                      <EditableConfigValue configKey="mqtt_retry_interval_secs" value={config.mqtt_retry_interval_secs} agentId={agent.id} onUpdated={onConfigUpdated} />
                    </>
                  )}
                  {config.mqtt_queue_path !== undefined && (
                    <>
                      <div className="text-terminal-dim">queue_path:</div>
                      <EditableConfigValue configKey="mqtt_queue_path" value={config.mqtt_queue_path} agentId={agent.id} onUpdated={onConfigUpdated} />
                    </>
                  )}
                  {config.mqtt_queue_max_size_mb !== undefined && (
                    <>
                      <div className="text-terminal-dim">queue_max_mb:</div>
                      <EditableConfigValue configKey="mqtt_queue_max_size_mb" value={config.mqtt_queue_max_size_mb} agentId={agent.id} onUpdated={onConfigUpdated} />
                    </>
                  )}
                </div>
              </div>
            )}

            {/* MQTT Bootstrap (v0.3.2+) */}
            {(config.mqtt_bootstrap_url !== undefined || config.mqtt_bootstrap_timeout_secs !== undefined) && (
              <div className="border border-terminal-border p-3">
                <div className="text-xs text-terminal-dim uppercase mb-2">MQTT Bootstrap</div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  {config.mqtt_bootstrap_url !== undefined && (
                    <>
                      <div className="text-terminal-dim">bootstrap_url:</div>
                      <EditableConfigValue configKey="mqtt_bootstrap_url" value={config.mqtt_bootstrap_url} agentId={agent.id} onUpdated={onConfigUpdated} />
                    </>
                  )}
                  {config.mqtt_bootstrap_timeout_secs !== undefined && (
                    <>
                      <div className="text-terminal-dim">timeout_secs:</div>
                      <EditableConfigValue configKey="mqtt_bootstrap_timeout_secs" value={config.mqtt_bootstrap_timeout_secs} agentId={agent.id} onUpdated={onConfigUpdated} />
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Plugins (v0.2.2+) */}
            {config.plugin_interval_secs !== undefined && (
              <div className="border border-terminal-border p-3">
                <div className="text-xs text-terminal-dim uppercase mb-2">Plugins</div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <div className="text-terminal-dim">interval_secs:</div>
                  <EditableConfigValue configKey="plugins.plugin_interval_secs" value={config.plugin_interval_secs} agentId={agent.id} onUpdated={onConfigUpdated} />
                  <div className="text-terminal-dim">collect_details:</div>
                  <EditableConfigValue configKey="plugins.collect_process_details" value={config.plugins_collect_process_details ?? false} agentId={agent.id} onUpdated={onConfigUpdated} />
                </div>

                {/* Nginx Plugin */}
                <div className="mt-3 pt-2 border-t border-terminal-border/50">
                  <div className="text-xs text-terminal-dim mb-2">nginx</div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div className="text-terminal-dim">enabled:</div>
                    <EditableConfigValue configKey="plugins.nginx.enabled" value={config.plugins_nginx_enabled ?? false} agentId={agent.id} onUpdated={onConfigUpdated} />
                    <div className="text-terminal-dim">service_name:</div>
                    <EditableConfigValue configKey="plugins.nginx.service_name" value={config.plugins_nginx_service_name ?? ''} agentId={agent.id} onUpdated={onConfigUpdated} />
                  </div>
                </div>

                {/* Tomcat Plugin */}
                <div className="mt-3 pt-2 border-t border-terminal-border/50">
                  <div className="text-xs text-terminal-dim mb-2">tomcat</div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div className="text-terminal-dim">enabled:</div>
                    <EditableConfigValue configKey="plugins.tomcat.enabled" value={config.plugins_tomcat_enabled ?? false} agentId={agent.id} onUpdated={onConfigUpdated} />
                    <div className="text-terminal-dim">service_name:</div>
                    <EditableConfigValue configKey="plugins.tomcat.service_name" value={config.plugins_tomcat_service_name ?? ''} agentId={agent.id} onUpdated={onConfigUpdated} />
                  </div>
                </div>

                {/* Self Monitor Plugin */}
                <div className="mt-3 pt-2 border-t border-terminal-border/50">
                  <div className="text-xs text-terminal-dim mb-2">self_monitor</div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div className="text-terminal-dim">enabled:</div>
                    <EditableConfigValue configKey="plugins.self_monitor.enabled" value={config.plugins_self_monitor_enabled ?? false} agentId={agent.id} onUpdated={onConfigUpdated} />
                    <div className="text-terminal-dim">collect_fds:</div>
                    <EditableConfigValue configKey="plugins.self_monitor.collect_open_fds" value={config.plugins_self_monitor_collect_open_fds ?? false} agentId={agent.id} onUpdated={onConfigUpdated} />
                    <div className="text-terminal-dim">collect_io:</div>
                    <EditableConfigValue configKey="plugins.self_monitor.collect_io_stats" value={config.plugins_self_monitor_collect_io_stats ?? false} agentId={agent.id} onUpdated={onConfigUpdated} />
                  </div>
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

function SwapProcessesViewerModal({
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

            {/* User info */}
            <div className="text-xs text-terminal-dim">
              <span className="mr-4">
                <span className="text-terminal-text">User:</span> Shows which user owns each process
              </span>
              <span>
                <span className="text-terminal-text">Swap:</span> Memory pushed to disk
              </span>
            </div>
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

function BulkUpdateModal({
  state,
  onCancel,
  onClose,
}: {
  state: BulkUpdateState;
  onCancel: () => void;
  onClose: () => void;
}) {
  const total = state.queue.length + state.completed.length + (state.current ? 1 : 0);
  const done = state.completed.length;
  const successful = state.completed.filter(c => c.success).length;
  const failed = state.completed.filter(c => !c.success).length;
  const progress = total > 0 ? (done / total) * 100 : 0;
  const isComplete = !state.isRunning && state.completed.length > 0;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="border border-terminal-border bg-terminal-panel p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-ok">
            {isComplete ? 'BULK UPDATE COMPLETE' : 'UPDATING AGENTS'}
          </h3>
          {isComplete && (
            <button
              onClick={onClose}
              className="px-2 py-1 text-terminal-dim hover:text-terminal-text"
            >
              ✕
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="h-2 bg-terminal-dark border border-terminal-border overflow-hidden">
            <div
              className="h-full bg-ok transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-terminal-dim mt-1">
            <span>{done} / {total} agents</span>
            <span>{Math.round(progress)}%</span>
          </div>
        </div>

        {/* Current agent */}
        {state.current && (
          <div className="mb-4 p-3 border border-info/50 bg-info/10">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-info animate-pulse" />
              <span className="text-info text-sm">
                Updating: <span className="font-semibold">{state.current.hostname}</span>
              </span>
            </div>
          </div>
        )}

        {/* Statistics */}
        <div className="grid grid-cols-3 gap-2 mb-4 text-center">
          <div className="p-2 border border-terminal-border bg-terminal-dark/50">
            <div className="text-lg font-bold text-terminal-text">{state.queue.length}</div>
            <div className="text-xs text-terminal-dim">PENDING</div>
          </div>
          <div className="p-2 border border-ok/50 bg-ok/10">
            <div className="text-lg font-bold text-ok">{successful}</div>
            <div className="text-xs text-ok/70">SUCCESS</div>
          </div>
          <div className="p-2 border border-error/50 bg-error/10">
            <div className="text-lg font-bold text-error">{failed}</div>
            <div className="text-xs text-error/70">FAILED</div>
          </div>
        </div>

        {/* Completed agents list */}
        {state.completed.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-terminal-dim uppercase mb-2">Results</div>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {state.completed.map((item, idx) => (
                <div
                  key={idx}
                  className={`p-2 text-xs flex items-center gap-2 ${
                    item.success
                      ? 'bg-ok/10 border border-ok/30'
                      : 'bg-error/10 border border-error/30'
                  }`}
                >
                  <span className={item.success ? 'text-ok' : 'text-error'}>
                    {item.success ? '✓' : '✕'}
                  </span>
                  <span className="text-terminal-text">{item.agent.hostname}</span>
                  {item.error && (
                    <span className="text-error/70 truncate ml-auto" title={item.error}>
                      {item.error.length > 30 ? item.error.slice(0, 30) + '...' : item.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          {state.isRunning ? (
            <button
              onClick={onCancel}
              className="px-4 py-2 border border-error/50 text-error hover:bg-error/20"
            >
              CANCEL
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 border border-terminal-border text-terminal-text hover:bg-terminal-border/30"
            >
              CLOSE
            </button>
          )}
        </div>

        {state.cancelled && (
          <div className="mt-3 text-xs text-amber">
            Update cancelled. Already sent updates will continue on agents.
          </div>
        )}
      </div>
    </div>
  );
}

export function AdminPanel({ agents, onAgentDeleted }: AdminPanelProps) {
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'delete-agent' | 'delete-metrics';
    agent: Agent;
  } | { type: 'delete-group'; groupName: string; agentCount: number } | null>(null);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupInput, setGroupInput] = useState('');
  const { groups, refresh: refreshGroups } = useGroups();
  const [latestUpdate, setLatestUpdate] = useState<LatestUpdateInfo | null>(null);
  const [refreshingUpdates, setRefreshingUpdates] = useState(false);
  const [configViewer, setConfigViewer] = useState<{
    agent: Agent;
    config: AgentConfig | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [swapViewer, setSwapViewer] = useState<{
    agent: Agent;
    swapData: SwapProcessList | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [bulkUpdate, setBulkUpdate] = useState<BulkUpdateState>(INITIAL_BULK_UPDATE_STATE);
  const bulkUpdateCancelledRef = useRef(false);

  function toggleAgentExpanded(agentId: string) {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  }

  useEffect(() => {
    loadServerStats();
    loadLatestUpdate();
    const interval = setInterval(loadServerStats, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadLatestUpdate() {
    const update = await getLatestUpdate();
    setLatestUpdate(update);
  }

  async function handleRefreshUpdates() {
    setRefreshingUpdates(true);
    try {
      await refreshUpdatesOnServer();
      await loadLatestUpdate();
      setNotification({
        type: 'success',
        message: 'Update info refreshed from server',
      });
    } catch (e) {
      setNotification({
        type: 'error',
        message: `Failed to refresh updates: ${e instanceof Error ? e.message : 'Unknown error'}`,
      });
    } finally {
      setRefreshingUpdates(false);
    }
  }

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  async function loadServerStats() {
    try {
      const stats = await getServerStats();
      setServerStats(stats);
    } catch (e) {
      console.error('Failed to load server stats:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAgent(agent: Agent) {
    setActionInProgress(agent.id);
    try {
      await deleteAgent(agent.id);
      setNotification({
        type: 'success',
        message: `Agent "${agent.hostname}" deleted successfully`,
      });
      onAgentDeleted();
      loadServerStats();
    } catch (e) {
      setNotification({
        type: 'error',
        message: `Failed to delete agent: ${e instanceof Error ? e.message : 'Unknown error'}`,
      });
    } finally {
      setActionInProgress(null);
      setConfirmAction(null);
    }
  }

  async function handleDeleteMetrics(agent: Agent) {
    setActionInProgress(agent.id);
    try {
      const result = await deleteAgentMetrics(agent.id);
      const total = result.metrics + result.disk_metrics + result.network_metrics;
      setNotification({
        type: 'success',
        message: `Deleted ${total.toLocaleString()} metrics for "${agent.hostname}"`,
      });
      loadServerStats();
    } catch (e) {
      setNotification({
        type: 'error',
        message: `Failed to delete metrics: ${e instanceof Error ? e.message : 'Unknown error'}`,
      });
    } finally {
      setActionInProgress(null);
      setConfirmAction(null);
    }
  }

  async function handleDeleteGroup(groupName: string) {
    setActionInProgress(groupName);
    try {
      const result = await deleteAgentsByGroup(groupName);
      setNotification({
        type: 'success',
        message: `Deleted ${result.deleted} agent(s) from group "${groupName}"`,
      });
      refreshGroups();
      onAgentDeleted();
      loadServerStats();
    } catch (e) {
      setNotification({
        type: 'error',
        message: `Failed to delete group: ${e instanceof Error ? e.message : 'Unknown error'}`,
      });
    } finally {
      setActionInProgress(null);
      setConfirmAction(null);
    }
  }

  async function handleUpdateGroup(agentId: string, newGroup: string | null) {
    setActionInProgress(agentId);
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

      // Update server database
      await updateAgentGroup(agentId, newGroup);
      setNotification({
        type: 'success',
        message: agent?.is_online
          ? `Group updated on agent and server`
          : `Group updated on server (agent offline - will apply on next connection)`,
      });
      refreshGroups();
      onAgentDeleted(); // Refresh agent list to get updated group
    } catch (e) {
      setNotification({
        type: 'error',
        message: `Failed to update group: ${e instanceof Error ? e.message : 'Unknown error'}`,
      });
    } finally {
      setActionInProgress(null);
      setEditingGroup(null);
      setGroupInput('');
    }
  }

  function startEditingGroup(agent: Agent) {
    setEditingGroup(agent.id);
    setGroupInput(agent.agent_group || '');
  }

  function cancelEditingGroup() {
    setEditingGroup(null);
    setGroupInput('');
  }

  async function handleSendCommand(agent: Agent, command: string) {
    if (!agent.is_online && command !== 'ping') {
      setNotification({
        type: 'error',
        message: `Cannot send "${command}" to offline agent`,
      });
      return;
    }

    setActionInProgress(agent.id);
    try {
      const result = await sendCommand(agent.id, command);
      setNotification({
        type: 'success',
        message: `Command "${command}" sent to ${agent.hostname} (id: ${result.command_id.slice(0, 8)}...)`,
      });
    } catch (e) {
      setNotification({
        type: 'error',
        message: `Failed to send command: ${e instanceof Error ? e.message : 'Unknown error'}`,
      });
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleSendUpdate(agent: Agent) {
    if (!agent.is_online) {
      setNotification({
        type: 'error',
        message: 'Cannot send update to offline agent',
      });
      return;
    }

    if (!latestUpdate) {
      setNotification({
        type: 'error',
        message: 'No update available on server',
      });
      return;
    }

    setActionInProgress(agent.id);
    try {
      const result = await sendUpdateCommand(agent.id, latestUpdate);
      setNotification({
        type: 'success',
        message: `Update command sent to ${agent.hostname}. Version: ${latestUpdate.version} (id: ${result.command_id.slice(0, 8)}...)`,
      });
    } catch (e) {
      setNotification({
        type: 'error',
        message: `Failed to send update: ${e instanceof Error ? e.message : 'Unknown error'}`,
      });
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleGetConfig(agent: Agent) {
    if (!agent.is_online) {
      setNotification({
        type: 'error',
        message: 'Cannot get config from offline agent',
      });
      return;
    }

    // Open modal with loading state
    setConfigViewer({
      agent,
      config: null,
      loading: true,
      error: null,
    });

    try {
      const config = await getAgentConfig(agent.id);
      setConfigViewer({
        agent,
        config,
        loading: false,
        error: null,
      });
    } catch (e) {
      setConfigViewer(prev => prev ? {
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to get configuration',
      } : null);
    }
  }

  async function handleGetSwapProcesses(agent: Agent) {
    if (!agent.is_online) {
      setNotification({
        type: 'error',
        message: 'Cannot get swap processes from offline agent',
      });
      return;
    }

    // Open modal with loading state
    setSwapViewer({
      agent,
      swapData: null,
      loading: true,
      error: null,
    });

    try {
      const swapData = await getAgentSwapProcesses(agent.id);
      setSwapViewer({
        agent,
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

  function formatNumber(n: number): string {
    return n.toLocaleString();
  }

  // Bulk update handlers
  const getUpdatableAgents = useCallback((): Agent[] => {
    if (!latestUpdate) return [];
    return agents.filter(agent => canUpdate(agent));
  }, [agents, latestUpdate]);

  const startBulkUpdate = useCallback(async () => {
    const updatableAgents = getUpdatableAgents();
    if (updatableAgents.length === 0 || !latestUpdate) return;

    bulkUpdateCancelledRef.current = false;

    setBulkUpdate({
      isRunning: true,
      queue: updatableAgents.slice(1), // First one goes to current
      current: updatableAgents[0],
      completed: [],
      cancelled: false,
    });

    // Process the first agent immediately, rest in processNextInQueue
    await processAgent(updatableAgents[0], updatableAgents.slice(1));
  }, [getUpdatableAgents, latestUpdate]);

  const processAgent = async (agent: Agent, remainingQueue: Agent[]) => {
    if (!latestUpdate) return;

    try {
      await sendUpdateCommand(agent.id, latestUpdate);

      // Success
      setBulkUpdate(prev => ({
        ...prev,
        completed: [...prev.completed, { agent, success: true }],
      }));
    } catch (e) {
      // Failure - continue with next agent
      setBulkUpdate(prev => ({
        ...prev,
        completed: [...prev.completed, {
          agent,
          success: false,
          error: e instanceof Error ? e.message : 'Unknown error',
        }],
      }));
    }

    // Small delay between updates to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 500));

    // Process next agent if not cancelled
    if (bulkUpdateCancelledRef.current) {
      setBulkUpdate(prev => ({
        ...prev,
        isRunning: false,
        current: null,
        cancelled: true,
      }));
      return;
    }

    if (remainingQueue.length > 0) {
      const nextAgent = remainingQueue[0];
      const nextQueue = remainingQueue.slice(1);

      setBulkUpdate(prev => ({
        ...prev,
        current: nextAgent,
        queue: nextQueue,
      }));

      await processAgent(nextAgent, nextQueue);
    } else {
      // All done
      setBulkUpdate(prev => ({
        ...prev,
        isRunning: false,
        current: null,
      }));
    }
  };

  const cancelBulkUpdate = useCallback(() => {
    bulkUpdateCancelledRef.current = true;
    setBulkUpdate(prev => ({
      ...prev,
      cancelled: true,
    }));
  }, []);

  const closeBulkUpdate = useCallback(() => {
    setBulkUpdate(INITIAL_BULK_UPDATE_STATE);
  }, []);

  // Compare semver versions: returns true if available > current
  function isNewerVersion(available: string, current: string): boolean {
    const parseVersion = (v: string): number[] =>
      v.split('.').map(p => parseInt(p, 10) || 0);

    const av = parseVersion(available);
    const cv = parseVersion(current);

    for (let i = 0; i < Math.max(av.length, cv.length); i++) {
      const a = av[i] || 0;
      const c = cv[i] || 0;
      if (a > c) return true;
      if (a < c) return false;
    }
    return false; // Equal versions
  }

  function canUpdate(agent: Agent): boolean {
    if (!latestUpdate) return false;
    if (!agent.is_online) return false;
    return isNewerVersion(latestUpdate.version, agent.agent_version);
  }

  // Get connection quality color based on RTT
  function getRttColor(rtt: number | null): string {
    if (rtt === null) return 'text-terminal-dim';
    if (rtt < 50) return 'text-ok';
    if (rtt < 200) return 'text-amber';
    return 'text-error';
  }

  // Get stability indicator based on reconnect count
  function getStabilityIndicator(agent: Agent): { label: string; color: string; tooltip: string } {
    const count = agent.reconnect_count;
    if (count === 0) {
      return { label: 'STABLE', color: 'text-ok', tooltip: 'No reconnections' };
    } else if (count < 5) {
      return { label: 'OK', color: 'text-info', tooltip: `${count} reconnection(s)` };
    } else if (count < 20) {
      return { label: 'UNSTABLE', color: 'text-amber', tooltip: `${count} reconnections - connection issues` };
    } else {
      return { label: 'CRITICAL', color: 'text-error', tooltip: `${count} reconnections - severe connection problems` };
    }
  }

  function formatRtt(rtt: number | null): string {
    if (rtt === null) return '-';
    return `${rtt}ms`;
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 p-4 border z-40 ${
            notification.type === 'success'
              ? 'border-ok/50 bg-ok/10 text-ok'
              : 'border-error/50 bg-error/10 text-error'
          }`}
        >
          {notification.message}
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmAction && (
        <ConfirmDialog
          title={
            confirmAction.type === 'delete-agent'
              ? 'Delete Agent?'
              : confirmAction.type === 'delete-group'
              ? 'Delete All Agents in Group?'
              : 'Delete All Metrics?'
          }
          message={
            confirmAction.type === 'delete-agent'
              ? `This will permanently delete agent "${confirmAction.agent.hostname}" and ALL its metrics. This action cannot be undone.`
              : confirmAction.type === 'delete-group'
              ? `This will permanently delete ALL ${confirmAction.agentCount} agent(s) in group "${confirmAction.groupName}" and their metrics. This action cannot be undone.`
              : `This will delete ALL metrics for agent "${confirmAction.agent.hostname}". The agent will remain registered.`
          }
          dangerous={confirmAction.type === 'delete-agent' || confirmAction.type === 'delete-group'}
          onConfirm={() =>
            confirmAction.type === 'delete-agent'
              ? handleDeleteAgent(confirmAction.agent)
              : confirmAction.type === 'delete-group'
              ? handleDeleteGroup(confirmAction.groupName)
              : handleDeleteMetrics(confirmAction.agent)
          }
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Config Viewer Modal */}
      {configViewer && (
        <ConfigViewerModal
          agent={configViewer.agent}
          config={configViewer.config}
          loading={configViewer.loading}
          error={configViewer.error}
          onClose={() => setConfigViewer(null)}
          onConfigUpdated={(key, newValue) => {
            // Update local config state to reflect the change
            if (configViewer.config) {
              setConfigViewer(prev => prev ? {
                ...prev,
                config: {
                  ...prev.config!,
                  [key]: newValue === 'true' ? true : newValue === 'false' ? false : isNaN(Number(newValue)) ? newValue : Number(newValue),
                },
              } : null);
            }
          }}
        />
      )}

      {/* Swap Processes Viewer Modal */}
      {swapViewer && (
        <SwapProcessesViewerModal
          agent={swapViewer.agent}
          swapData={swapViewer.swapData}
          loading={swapViewer.loading}
          error={swapViewer.error}
          onClose={() => setSwapViewer(null)}
        />
      )}

      {/* Bulk Update Modal */}
      {(bulkUpdate.isRunning || bulkUpdate.completed.length > 0) && (
        <BulkUpdateModal
          state={bulkUpdate}
          onCancel={cancelBulkUpdate}
          onClose={closeBulkUpdate}
        />
      )}

      {/* Server Statistics */}
      <div className="border border-terminal-border bg-terminal-panel/50 p-4 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-amber text-lg">⚙</span>
          <h2
            className="text-xl font-bold text-amber"
            style={{ textShadow: '0 0 10px var(--color-amber)' }}
          >
            SERVER ADMINISTRATION
          </h2>
        </div>

        {loading ? (
          <div className="text-terminal-dim animate-pulse">Loading statistics...</div>
        ) : serverStats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 border border-terminal-border bg-terminal-dark/50">
              <div className="text-2xl font-bold text-terminal-text">
                {formatNumber(serverStats.agents_total)}
              </div>
              <div className="text-xs text-terminal-dim uppercase">Total Agents</div>
            </div>
            <div className="p-3 border border-terminal-border bg-terminal-dark/50">
              <div className="text-2xl font-bold text-ok">
                {formatNumber(serverStats.agents_online)}
              </div>
              <div className="text-xs text-terminal-dim uppercase">Online</div>
            </div>
            <div className="p-3 border border-terminal-border bg-terminal-dark/50">
              <div className="text-2xl font-bold text-info">
                {formatNumber(serverStats.metrics_count)}
              </div>
              <div className="text-xs text-terminal-dim uppercase">Metrics Records</div>
            </div>
            <div className="p-3 border border-terminal-border bg-terminal-dark/50">
              <div className="text-2xl font-bold text-terminal-text">
                {formatNumber(
                  serverStats.disk_metrics_count + serverStats.network_metrics_count
                )}
              </div>
              <div className="text-xs text-terminal-dim uppercase">I/O Records</div>
            </div>
          </div>
        ) : (
          <div className="text-error">Failed to load statistics</div>
        )}

        {serverStats && serverStats.oldest_metric && (
          <div className="mt-4 text-xs text-terminal-dim">
            <span>Data range: </span>
            <span className="text-terminal-text">
              {new Date(serverStats.oldest_metric).toLocaleString()}
            </span>
            <span> → </span>
            <span className="text-terminal-text">
              {serverStats.newest_metric
                ? new Date(serverStats.newest_metric).toLocaleString()
                : 'now'}
            </span>
          </div>
        )}

        {/* Update availability info */}
        <div className="mt-4 p-3 border border-terminal-border bg-terminal-dark/30">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-ok">↑</span>
            <span className="text-xs text-terminal-dim uppercase">Agent Update:</span>
            {latestUpdate ? (
              <span className="text-xs text-ok">
                v{latestUpdate.version} available ({(latestUpdate.size / 1024 / 1024).toFixed(1)} MB)
              </span>
            ) : (
              <span className="text-xs text-terminal-dim">No updates on server</span>
            )}
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              {/* Update all button */}
              {latestUpdate && getUpdatableAgents().length > 0 && (
                <button
                  onClick={startBulkUpdate}
                  disabled={bulkUpdate.isRunning}
                  title={`Update ${getUpdatableAgents().length} agent(s) to v${latestUpdate.version}`}
                  className="px-3 py-1 text-xs border border-ok/50 bg-ok/10 text-ok hover:bg-ok/20 disabled:opacity-50"
                >
                  ↑ UPDATE ALL ({getUpdatableAgents().length})
                </button>
              )}
              <button
                onClick={handleRefreshUpdates}
                disabled={refreshingUpdates}
                title="Rescan updates directory on server"
                className="px-2 py-1 text-xs border border-terminal-border text-terminal-dim hover:text-terminal-text hover:bg-terminal-border/30 disabled:opacity-50"
              >
                {refreshingUpdates ? '...' : '↻ REFRESH'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Group Management */}
      {groups.length > 0 && (
        <div className="border border-terminal-border bg-terminal-panel/30 p-4 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-info">⊞</span>
            <h3 className="font-semibold text-terminal-text uppercase tracking-wide">
              Group Management
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {groups.map((group) => {
              const groupAgents = agents.filter((a) => a.agent_group === group);
              const onlineCount = groupAgents.filter((a) => a.is_online).length;

              return (
                <div
                  key={group}
                  className="flex items-center justify-between p-2 border border-terminal-border bg-terminal-dark/30"
                >
                  <div className="min-w-0">
                    <div className="text-terminal-text font-semibold truncate" title={group}>
                      {group}
                    </div>
                    <div className="text-xs text-terminal-dim">
                      {groupAgents.length} agent{groupAgents.length !== 1 ? 's' : ''}
                      {onlineCount > 0 && (
                        <span className="text-ok ml-1">({onlineCount} online)</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      setConfirmAction({
                        type: 'delete-group',
                        groupName: group,
                        agentCount: groupAgents.length,
                      })
                    }
                    disabled={actionInProgress === group}
                    title={`Delete all ${groupAgents.length} agent(s) in group "${group}"`}
                    className="px-2 py-1 text-xs border border-error/30 text-error hover:bg-error/20 disabled:opacity-50 ml-2"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-3 text-xs text-terminal-dim">
            <span className="text-error">⚠</span> Deleting a group removes ALL agents in that group and their metrics.
          </div>
        </div>
      )}

      {/* Agent Management */}
      <div className="border border-terminal-border bg-terminal-panel/30 p-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-phosphor">▸</span>
          <h3 className="font-semibold text-terminal-text uppercase tracking-wide">
            Agent Management
          </h3>
        </div>

        {agents.length === 0 ? (
          <div className="text-terminal-dim text-center py-8">No agents registered</div>
        ) : (
          <div className="space-y-1">
            {agents.map((agent) => {
              const isExpanded = expandedAgents.has(agent.id);
              const stability = getStabilityIndicator(agent);

              return (
                <div
                  key={agent.id}
                  className="border border-terminal-border bg-terminal-dark/30"
                >
                  {/* Main row - always visible */}
                  <div
                    className="p-2 flex items-center gap-3 cursor-pointer hover:bg-terminal-dark/50"
                    onClick={() => toggleAgentExpanded(agent.id)}
                  >
                    {/* Expand arrow */}
                    <span className={`text-terminal-dim text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                      ▶
                    </span>

                    {/* Status dot */}
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        agent.is_online ? 'bg-ok' : 'bg-error'
                      }`}
                      style={{
                        boxShadow: agent.is_online
                          ? '0 0 6px var(--color-ok)'
                          : '0 0 6px var(--color-error)',
                      }}
                    />

                    {/* Hostname & version */}
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-terminal-text">
                        {agent.hostname}
                      </span>
                      <span className="ml-2 text-xs text-terminal-dim">
                        v{agent.agent_version}
                      </span>
                      {/* Subtle root indicator - just a small icon */}
                      {agent.is_root && (
                        <span
                          className="ml-1.5 text-xs text-terminal-dim"
                          title="Running as root (full system access)"
                        >
                          #
                        </span>
                      )}
                    </div>

                    {/* Quick stats on main row */}
                    <div className="hidden sm:flex items-center gap-3 text-xs">
                      {/* Queue indicator */}
                      {agent.queue_pending_count > 0 && (
                        <span
                          className="px-1.5 py-0.5 bg-amber/20 text-amber text-xs animate-pulse"
                          title={`${agent.queue_pending_count} messages (${formatBytesRaw(agent.queue_pending_bytes)}) waiting to sync`}
                        >
                          ⇅ {agent.queue_pending_count}
                        </span>
                      )}
                      {/* Group badge */}
                      {agent.agent_group && (
                        <span className="px-1.5 py-0.5 bg-info/10 text-info/70 text-xs">
                          {agent.agent_group}
                        </span>
                      )}
                      {/* RTT */}
                      <span className={`font-mono ${getRttColor(agent.last_rtt_ms)}`}>
                        {agent.last_rtt_ms !== null ? `${agent.last_rtt_ms}ms` : '-'}
                      </span>
                      {/* Stability mini indicator */}
                      <span className={`${stability.color}`} title={stability.tooltip}>
                        {stability.label === 'STABLE' ? '●' : stability.label === 'OK' ? '◐' : stability.label === 'UNSTABLE' ? '○' : '✕'}
                      </span>
                    </div>

                    {/* Quick actions - always visible */}
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleSendCommand(agent, 'ping')}
                        disabled={actionInProgress === agent.id}
                        title="Ping"
                        className="px-2 py-1 text-xs border border-info/30 text-info hover:bg-info/20 disabled:opacity-50"
                      >
                        ↯
                      </button>
                      <button
                        onClick={() => setConfirmAction({ type: 'delete-agent', agent })}
                        disabled={actionInProgress === agent.id}
                        title="Delete agent"
                        className="px-2 py-1 text-xs border border-error/30 text-error hover:bg-error/20 disabled:opacity-50"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-t border-terminal-border/50 p-3 bg-terminal-dark/20 space-y-3">
                      {/* Info row */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div>
                          <div className="text-terminal-dim">OS</div>
                          <div className="text-terminal-text truncate">{agent.os_name}</div>
                        </div>
                        <div>
                          <div className="text-terminal-dim">Kernel</div>
                          <div className="text-terminal-text truncate">{agent.kernel_version}</div>
                        </div>
                        <div>
                          <div className="text-terminal-dim">CPU</div>
                          <div className="text-terminal-text truncate">{agent.cpu_cores} cores</div>
                        </div>
                        <div>
                          <div className="text-terminal-dim">Last seen</div>
                          <div className="text-terminal-text">{formatUptime(agent.last_seen_at)}</div>
                        </div>
                      </div>

                      {/* Connection & Status row */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div>
                          <div className="text-terminal-dim">RTT</div>
                          <div className={getRttColor(agent.last_rtt_ms)}>
                            {formatRtt(agent.last_rtt_ms)}
                            {agent.last_rtt_at && (
                              <span className="ml-1 text-terminal-dim">
                                ({new Date(agent.last_rtt_at).toLocaleTimeString()})
                              </span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-terminal-dim">Stability</div>
                          <div className={stability.color}>{stability.label} ({agent.reconnect_count} reconnects)</div>
                        </div>
                        <div>
                          <div className="text-terminal-dim">Mode</div>
                          <div className={agent.is_root ? 'text-amber' : 'text-terminal-text'}>
                            {agent.is_root ? 'Root (full access)' : 'User (limited)'}
                          </div>
                        </div>
                        <div>
                          <div className="text-terminal-dim">Offline Queue</div>
                          <div className={agent.queue_pending_count > 0 ? 'text-amber' : 'text-ok'}>
                            {agent.queue_pending_count > 0
                              ? `${agent.queue_pending_count} msg (${formatBytesRaw(agent.queue_pending_bytes)})`
                              : 'Synced'}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div>
                          <div className="text-terminal-dim">ID</div>
                          <div className="text-terminal-text font-mono truncate" title={agent.id}>{agent.id.slice(0, 8)}...</div>
                        </div>
                      </div>

                      {/* Group editing */}
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-terminal-dim">Group:</span>
                        {editingGroup === agent.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={groupInput}
                              onChange={(e) => setGroupInput(e.target.value)}
                              placeholder="Group name"
                              className="w-32 px-2 py-1 bg-terminal-dark border border-terminal-border text-terminal-text focus:border-info outline-none"
                              list={`groups-${agent.id}`}
                            />
                            <datalist id={`groups-${agent.id}`}>
                              {groups.map((g) => (
                                <option key={g} value={g} />
                              ))}
                            </datalist>
                            <button
                              onClick={() => handleUpdateGroup(agent.id, groupInput.trim() || null)}
                              disabled={actionInProgress === agent.id}
                              className="px-2 py-1 border border-ok/50 text-ok hover:bg-ok/20 disabled:opacity-50"
                            >
                              ✓
                            </button>
                            <button
                              onClick={cancelEditingGroup}
                              className="px-2 py-1 border border-terminal-border text-terminal-dim hover:bg-terminal-border/30"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEditingGroup(agent)}
                            className="text-terminal-dim hover:text-terminal-text"
                          >
                            {agent.agent_group ? (
                              <span className="px-2 py-0.5 bg-info/20 text-info border border-info/30">
                                {agent.agent_group}
                              </span>
                            ) : (
                              <span className="italic">None (click to set)</span>
                            )}
                          </button>
                        )}
                      </div>

                      {/* Commands row */}
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-terminal-border/30">
                        <button
                          onClick={() => handleSendCommand(agent, 'ping')}
                          disabled={actionInProgress === agent.id}
                          className="px-3 py-1.5 text-xs border border-info/50 text-info hover:bg-info/20 disabled:opacity-50"
                        >
                          PING
                        </button>
                        <button
                          onClick={() => handleGetConfig(agent)}
                          disabled={actionInProgress === agent.id || !agent.is_online}
                          className="px-3 py-1.5 text-xs border border-terminal-border text-terminal-text hover:bg-terminal-border/30 disabled:opacity-50"
                        >
                          CONFIG
                        </button>
                        <button
                          onClick={() => handleGetSwapProcesses(agent)}
                          disabled={actionInProgress === agent.id || !agent.is_online}
                          title="View processes using swap memory"
                          className="px-3 py-1.5 text-xs border border-amber/50 text-amber hover:bg-amber/20 disabled:opacity-50"
                        >
                          SWAP
                        </button>
                        <button
                          onClick={() => handleSendCommand(agent, 'reload-config')}
                          disabled={actionInProgress === agent.id || !agent.is_online}
                          className="px-3 py-1.5 text-xs border border-phosphor/50 text-phosphor hover:bg-phosphor/20 disabled:opacity-50"
                        >
                          RELOAD
                        </button>
                        <button
                          onClick={() => handleSendCommand(agent, 'restart')}
                          disabled={actionInProgress === agent.id || !agent.is_online}
                          className="px-3 py-1.5 text-xs border border-amber/50 text-amber hover:bg-amber/20 disabled:opacity-50"
                        >
                          RESTART
                        </button>
                        <button
                          onClick={() => handleSendCommand(agent, 'reconnect')}
                          disabled={actionInProgress === agent.id || !agent.is_online}
                          title="Reconnect to MQTT broker (re-run bootstrap)"
                          className="px-3 py-1.5 text-xs border border-cyan/50 text-cyan hover:bg-cyan/20 disabled:opacity-50"
                        >
                          RECONNECT
                        </button>
                        <button
                          onClick={() => handleSendUpdate(agent)}
                          disabled={actionInProgress === agent.id || !canUpdate(agent)}
                          title={
                            !latestUpdate
                              ? 'No update available'
                              : !agent.is_online
                              ? 'Agent offline'
                              : canUpdate(agent)
                              ? `Update to v${latestUpdate.version}`
                              : 'Up to date'
                          }
                          className="px-3 py-1.5 text-xs border border-ok/50 text-ok hover:bg-ok/20 disabled:opacity-50"
                        >
                          UPDATE
                        </button>
                        <div className="flex-1" />
                        <button
                          onClick={() => setConfirmAction({ type: 'delete-metrics', agent })}
                          disabled={actionInProgress === agent.id}
                          className="px-3 py-1.5 text-xs border border-amber/50 text-amber hover:bg-amber/20 disabled:opacity-50"
                        >
                          CLEAR METRICS
                        </button>
                        <button
                          onClick={() => setConfirmAction({ type: 'delete-agent', agent })}
                          disabled={actionInProgress === agent.id}
                          className="px-3 py-1.5 text-xs border border-error/50 text-error hover:bg-error/20 disabled:opacity-50"
                        >
                          DELETE AGENT
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="mt-4 text-xs text-terminal-dim">
        <p>
          <span className="text-amber">⚠</span> Deleting an agent removes all associated
          metrics and cannot be undone.
        </p>
        <p className="mt-1">
          <span className="text-info">ℹ</span> Clear metrics to free up database space
          while keeping the agent registered.
        </p>
      </div>
    </div>
  );
}
