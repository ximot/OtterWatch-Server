export interface Agent {
  id: string;
  hostname: string;
  os_name: string;
  kernel_version: string;
  agent_version: string;
  cpu_cores: number;
  cpu_name: string;
  created_at: string;
  last_seen_at: string | null;
  is_online: boolean;
  agent_group: string | null;
  // Connection quality stats
  reconnect_count: number;
  last_disconnect_at: string | null;
  last_rtt_ms: number | null;
  last_rtt_at: string | null;
  // Security indicator
  is_root: boolean;
  // Offline queue status
  queue_pending_count: number;
  queue_pending_bytes: number;
}

export interface Metrics {
  time: string;
  agent_id: string;
  cpu_usage: number;
  cpu_io_wait: number;
  memory_used_kib: number;
  memory_available_kib: number;
  memory_total_kib: number;
  swap_free_kib: number;
  swap_total_kib: number;
}

export interface DiskMetrics {
  time: string;
  agent_id: string;
  device: string;
  read_ops: number;
  write_ops: number;
  read_time_ms: number;
  write_time_ms: number;
}

export interface NetworkMetrics {
  time: string;
  agent_id: string;
  interface_name: string;
  bytes_received: number;
  bytes_transmitted: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export interface ServerStats {
  agents_total: number;
  agents_online: number;
  metrics_count: number;
  disk_metrics_count: number;
  network_metrics_count: number;
  oldest_metric: string | null;
  newest_metric: string | null;
}

export interface DeletedMetricsCount {
  metrics: number;
  disk_metrics: number;
  network_metrics: number;
}

export interface ProcessSnapshot {
  time: string;
  agent_id: string;
  pid: number;
  name: string;
  state: string;
  ppid: number;
  cpu_percent: number;
  memory_rss_kib: number;
  memory_vsz_kib: number;
  threads: number;
  username: string;
  cmdline: string | null;
  start_time: number;
}

export interface AgentConfig {
  interval_secs: number;
  process_list_interval_secs: number;
  process_top_n: number;
  listen_addr: string;
  mqtt_broker_addr: string;
  mqtt_topic_prefix: string;
  mqtt_enabled: boolean;
  // MQTT Bootstrap settings (v0.3.2+)
  mqtt_bootstrap_url?: string;
  mqtt_bootstrap_timeout_secs?: number;
  db_file_name: string;
  db_save: boolean;
  db_history_days: number;
  agent_group: string;
  exclude_interfaces: string;
  config_path: string;
  data_directory: string;
  // Optional MQTT parameters (may not be present in older agents)
  mqtt_keepalive_secs?: number;
  mqtt_retry_interval_secs?: number;
  mqtt_queue_path?: string;
  mqtt_queue_max_size_mb?: number;
  cors_allowed_origins?: string;
  // Plugin settings (v0.2.2+)
  plugin_interval_secs?: number;
  plugins_collect_process_details?: boolean;
  plugins_nginx_enabled?: boolean;
  plugins_nginx_service_name?: string;
  plugins_tomcat_enabled?: boolean;
  plugins_tomcat_service_name?: string;
  plugins_self_monitor_enabled?: boolean;
  plugins_self_monitor_collect_open_fds?: boolean;
  plugins_self_monitor_collect_io_stats?: boolean;
}

// Configuration parameter definition for validation and editing
export interface ConfigParameterDef {
  key: string;
  type: 'int' | 'bool' | 'string';
  description: string;
  category: 'Collection' | 'Network' | 'Storage' | 'MQTT' | 'Agent' | 'Plugins';
  min?: number;
  max?: number;
  readOnly?: boolean;
}

// Configuration schema for frontend validation
export const CONFIG_SCHEMA: ConfigParameterDef[] = [
  // Collection
  { key: 'interval_secs', type: 'int', min: 1, max: 3600, category: 'Collection', description: 'Metrics collection interval (seconds)' },
  { key: 'process_list_interval_secs', type: 'int', min: 5, max: 3600, category: 'Collection', description: 'Process list collection interval (seconds)' },
  { key: 'process_top_n', type: 'int', min: 1, max: 100, category: 'Collection', description: 'Number of top processes to collect' },

  // Network
  { key: 'listen_addr', type: 'string', category: 'Network', description: 'HTTP API listen address' },
  { key: 'cors_allowed_origins', type: 'string', category: 'Network', description: 'CORS allowed origins (comma-separated)' },

  // Storage
  { key: 'db_file_name', type: 'string', category: 'Storage', description: 'Local storage directory name' },
  { key: 'db_save', type: 'bool', category: 'Storage', description: 'Enable local storage' },
  { key: 'db_history_days', type: 'int', min: 1, max: 365, category: 'Storage', description: 'Days of history to keep' },
  { key: 'exclude_interfaces', type: 'string', category: 'Storage', description: 'Network interfaces to exclude (comma-separated)' },

  // MQTT
  { key: 'mqtt_enabled', type: 'bool', category: 'MQTT', description: 'Enable MQTT metrics push' },
  { key: 'mqtt_broker_addr', type: 'string', category: 'MQTT', description: 'MQTT broker address' },
  { key: 'mqtt_topic_prefix', type: 'string', category: 'MQTT', description: 'MQTT topic prefix' },
  { key: 'mqtt_keepalive_secs', type: 'int', min: 10, max: 600, category: 'MQTT', description: 'MQTT keepalive interval (seconds)' },
  { key: 'mqtt_retry_interval_secs', type: 'int', min: 1, max: 60, category: 'MQTT', description: 'MQTT reconnection retry interval (seconds)' },
  { key: 'mqtt_queue_path', type: 'string', category: 'MQTT', description: 'Offline queue directory' },
  { key: 'mqtt_queue_max_size_mb', type: 'int', min: 10, max: 10000, category: 'MQTT', description: 'Maximum offline queue size (MB)' },
  { key: 'mqtt_bootstrap_url', type: 'string', category: 'MQTT', description: 'Bootstrap URL for broker auto-discovery (v0.3.2+)' },
  { key: 'mqtt_bootstrap_timeout_secs', type: 'int', min: 1, max: 60, category: 'MQTT', description: 'Bootstrap request timeout (seconds)' },

  // Agent
  { key: 'agent_group', type: 'string', category: 'Agent', description: 'Agent group name for categorization' },

  // Read-only paths
  { key: 'config_path', type: 'string', category: 'Agent', description: 'Configuration file path', readOnly: true },
  { key: 'data_directory', type: 'string', category: 'Agent', description: 'Data directory path', readOnly: true },

  // Plugins
  { key: 'plugins.plugin_interval_secs', type: 'int', min: 5, max: 3600, category: 'Plugins', description: 'Plugin metrics collection interval (seconds)' },
  { key: 'plugins.collect_process_details', type: 'bool', category: 'Plugins', description: 'Collect per-process details in plugins' },
  { key: 'plugins.nginx.enabled', type: 'bool', category: 'Plugins', description: 'Enable nginx monitoring plugin' },
  { key: 'plugins.nginx.service_name', type: 'string', category: 'Plugins', description: 'Nginx systemd service name' },
  { key: 'plugins.tomcat.enabled', type: 'bool', category: 'Plugins', description: 'Enable Tomcat monitoring plugin' },
  { key: 'plugins.tomcat.service_name', type: 'string', category: 'Plugins', description: 'Tomcat systemd service name' },
  { key: 'plugins.self_monitor.enabled', type: 'bool', category: 'Plugins', description: 'Enable enhanced self-monitoring plugin' },
  { key: 'plugins.self_monitor.collect_open_fds', type: 'bool', category: 'Plugins', description: 'Collect open file descriptors count' },
  { key: 'plugins.self_monitor.collect_io_stats', type: 'bool', category: 'Plugins', description: 'Collect I/O statistics' },
];

// Helper to get parameter definition by key
export function getConfigParamDef(key: string): ConfigParameterDef | undefined {
  return CONFIG_SCHEMA.find(p => p.key === key);
}

// Validate a config value against its definition
export function validateConfigValue(key: string, value: string): { valid: boolean; error?: string } {
  const def = getConfigParamDef(key);
  if (!def) {
    return { valid: false, error: 'Unknown parameter' };
  }

  if (def.readOnly) {
    return { valid: false, error: 'This parameter is read-only' };
  }

  if (def.type === 'int') {
    const num = parseInt(value, 10);
    if (isNaN(num)) {
      return { valid: false, error: 'Must be a number' };
    }
    if (def.min !== undefined && num < def.min) {
      return { valid: false, error: `Minimum value is ${def.min}` };
    }
    if (def.max !== undefined && num > def.max) {
      return { valid: false, error: `Maximum value is ${def.max}` };
    }
  }

  if (def.type === 'bool') {
    if (value !== 'true' && value !== 'false') {
      return { valid: false, error: 'Must be true or false' };
    }
  }

  return { valid: true };
}

export interface SwapProcessInfo {
  pid: number;
  name: string;
  swap_kib: number;
  cmdline: string;
  user: string;
}

export interface SwapProcessList {
  total_swap_kib: number;
  processes: SwapProcessInfo[];
}

export interface CommandResponse {
  command_id: string;
  agent_id: string;
  success: boolean;
  message: string;
  config_json: string | null;
  swap_processes_json: string | null;
  created_at: string;
}

// Service metrics (plugins: nginx, tomcat, self, etc.)
export interface ServiceMetrics {
  time: string;
  agent_id: string;
  service_name: string;
  plugin_type: string;
  is_running: boolean;

  // CPU metrics
  cpu_usage_usec: number;
  cpu_percent: number;
  cpu_user_usec: number;
  cpu_system_usec: number;

  // Memory metrics
  memory_current_bytes: number;
  memory_swap_bytes: number;
  memory_anon_bytes: number;
  memory_file_bytes: number;

  // Disk I/O metrics
  disk_read_bytes: number;
  disk_write_bytes: number;
  disk_read_ops: number;
  disk_write_ops: number;

  // Network I/O metrics
  net_rx_bytes: number;
  net_tx_bytes: number;

  // Process/thread counts
  process_count: number;
  thread_count: number;

  // Data source info
  cgroup_version: number | null;
  data_source: number; // 0=unknown, 1=cgroupv2, 2=cgroupv1, 3=procfs
}

export interface ServiceSummary {
  service_name: string;
  plugin_type: string;
  is_running: boolean;
  last_seen: string;
}

export interface ServiceProcess {
  time: string;
  agent_id: string;
  service_name: string;
  pid: number;
  name: string;
  cpu_percent: number;
  memory_bytes: number;
  threads: number;
}

// ============================================
// AI Analysis Types
// ============================================

export interface AiInsight {
  category: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  affected_agents: string[];
  metric_type: string | null;
  confidence: number;
}

export interface AiRecommendation {
  title: string;
  description: string;
  action_type: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  target_agents: string[];
  command_suggestion: string | null;
}

export interface AiAnalyzeRequest {
  tool_type: string;
  agent_id?: string;
  agent_group?: string;
  time_window_minutes?: number;
  user_question?: string;
}

export interface AiAnalyzeResponse {
  request_id: string;
  tool_type: string;
  status: 'pending' | 'completed' | 'error';
}

export interface AiResponse {
  request_id: string;
  tool_type: string;
  agent_id: string | null;
  agent_group: string | null;
  success: boolean;
  error_message: string | null;
  analysis_text: string | null;
  insights_json: string | null;  // JSON string of AiInsight[]
  recommendations_json: string | null;  // JSON string of AiRecommendation[]
  model_used: string | null;
  tokens_used: number | null;
  processing_time_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface AiAgentStatus {
  online: boolean;
  agent_version: string | null;
  model_name: string | null;
  ollama_url: string | null;
  model_loaded: boolean;
  requests_processed: number;
  average_latency_ms: number;
  available_tools: string | null;  // JSON string of string[]
  last_seen_at: string | null;
  updated_at: string;
}

// AI Tool types for tool selector
export type AiToolType =
  | 'analyze_fleet'
  | 'explain_agent'
  | 'predict_issues'
  | 'correlate_events'
  | 'suggest_actions'
  | 'summarize_period';

export interface AiToolInfo {
  id: AiToolType;
  name: string;
  description: string;
  requiresAgent: boolean;
  icon: string;
}

export const AI_TOOLS: AiToolInfo[] = [
  {
    id: 'analyze_fleet',
    name: 'Analyze Fleet',
    description: 'Overview of entire fleet - trends, anomalies, comparisons',
    requiresAgent: false,
    icon: '📊',
  },
  {
    id: 'explain_agent',
    name: 'Explain Agent',
    description: 'Deep analysis of a specific agent',
    requiresAgent: true,
    icon: '🔍',
  },
  {
    id: 'predict_issues',
    name: 'Predict Issues',
    description: 'Predict potential problems based on trends',
    requiresAgent: false,
    icon: '🔮',
  },
  {
    id: 'correlate_events',
    name: 'Correlate Events',
    description: 'Find relationships between events across agents',
    requiresAgent: false,
    icon: '🔗',
  },
  {
    id: 'suggest_actions',
    name: 'Suggest Actions',
    description: 'Get actionable recommendations',
    requiresAgent: false,
    icon: '💡',
  },
  {
    id: 'summarize_period',
    name: 'Summarize Period',
    description: 'Generate a report for a time period',
    requiresAgent: false,
    icon: '📋',
  },
];

// MQTT Cluster types
export interface MqttClusterNode {
  name: string;
  cluster_addr: string;
  mqtt_addr: string;
  state: string;
  assigned_groups: string[];
  connection_count: number;
  is_local: boolean;
}

export interface MqttBrokerStats {
  node: string;
  uptime_secs: number;
  connections_active: number;
  subscriptions_active: number;
  messages_received: number;
  messages_failed: number;
}

export interface MqttClusterStatus {
  configured: boolean;
  configured_nodes: number;
  reachable_nodes: number;
  nodes: MqttClusterNode[];
  group_assignments: Record<string, string>;
  broker_stats: MqttBrokerStats[];
  total_connections: number;
  total_messages: number;
  retained_count: number;
  errors: string[];
}
