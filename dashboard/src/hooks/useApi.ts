import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Agent, Metrics, ApiResponse, ServerStats, DeletedMetricsCount, ProcessSnapshot, CommandResponse as StoredCommandResponse, AgentConfig, SwapProcessList, DiskMetrics, NetworkMetrics, ServiceSummary, ServiceMetrics } from '../types/api';

const API_BASE = '/api';

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, options);
  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }
  const data: ApiResponse<T> = await response.json();
  if (!data.success || data.data === null) {
    throw new Error(data.error || 'Unknown error');
  }
  return data.data;
}

// Management API functions
export async function deleteAgent(agentId: string): Promise<void> {
  await fetchApi(`/agents/${agentId}`, { method: 'DELETE' });
}

export async function deleteAgentMetrics(agentId: string): Promise<DeletedMetricsCount> {
  return fetchApi<DeletedMetricsCount>(`/agents/${agentId}/metrics`, { method: 'DELETE' });
}

export async function deleteAgentsByGroup(groupName: string): Promise<{ deleted: number; group: string }> {
  return fetchApi<{ deleted: number; group: string }>(`/groups/${encodeURIComponent(groupName)}`, { method: 'DELETE' });
}

export async function getServerStats(): Promise<ServerStats> {
  return fetchApi<ServerStats>('/server/stats');
}

export function useAgents(refreshInterval = 5000) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchApi<Agent[]>('/agents');
      setAgents(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  return { agents, loading, error, refresh };
}

export function useAgentMetrics(agentId: string | null, refreshInterval = 2000) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [history, setHistory] = useState<Metrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!agentId) return;

    try {
      const data = await fetchApi<Metrics>(`/agents/${agentId}/metrics/latest`);
      setMetrics(data);
      // Optimized history update: avoid creating new array when at max length
      setHistory(prev => {
        if (prev.length >= 60) {
          // Reuse array structure when at limit to reduce GC pressure
          return [...prev.slice(1), data];
        }
        return [...prev, data];
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!agentId) {
      setMetrics(null);
      setHistory([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setHistory([]);
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [agentId, refresh, refreshInterval]);

  return { metrics, history, loading, error, refresh };
}

export function useAllAgentsMetrics(agents: Agent[], refreshInterval = 2000) {
  const [metricsMap, setMetricsMap] = useState<Map<string, Metrics>>(new Map());
  const [loading, setLoading] = useState(true);

  // Stabilize dependency: only re-run callback when agent IDs actually change
  const agentIds = useMemo(() => agents.map(a => a.id).sort().join(','), [agents]);

  const refresh = useCallback(async () => {
    const ids = agentIds.split(',').filter(id => id);
    if (ids.length === 0) {
      setLoading(false);
      return;
    }

    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const metrics = await fetchApi<Metrics>(`/agents/${id}/metrics/latest`);
        return { id, metrics };
      })
    );

    const newMap = new Map<string, Metrics>();
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        newMap.set(result.value.id, result.value.metrics);
      }
    });

    setMetricsMap(newMap);
    setLoading(false);
  }, [agentIds]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  return { metricsMap, loading, refresh };
}

// Group management API functions
export async function getGroups(): Promise<string[]> {
  return fetchApi<string[]>('/groups');
}

export async function updateAgentGroup(agentId: string, group: string | null): Promise<void> {
  await fetchApi(`/agents/${agentId}/group`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group }),
  });
}

export function useGroups(refreshInterval = 10000) {
  const [groups, setGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await getGroups();
      setGroups(data);
    } catch (e) {
      console.error('Failed to fetch groups:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  return { groups, loading, refresh };
}

// Command API
export interface CommandSentResponse {
  command_id: string;
  agent_id: string;
  command_type: string;
  sent: boolean;
}

export async function sendCommand(
  agentId: string,
  command: string,
  options?: { group?: string; updateUrl?: string; updateChecksum?: string; configKey?: string; configValue?: string }
): Promise<CommandSentResponse> {
  return fetchApi<CommandSentResponse>(`/agents/${agentId}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command,
      group: options?.group,
      update_url: options?.updateUrl,
      update_checksum: options?.updateChecksum,
      config_key: options?.configKey,
      config_value: options?.configValue,
    }),
  });
}

// Send set-config command to update a single configuration parameter
// Increased timeout because MQTT round-trip can take longer on slow connections
export async function setAgentConfigValue(
  agentId: string,
  configKey: string,
  configValue: string,
  maxWaitMs = 15000
): Promise<{ success: boolean; message: string }> {
  const sent = await sendCommand(agentId, 'set-config', { configKey, configValue });

  // Poll for response
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await getCommandResponse(agentId, sent.command_id);
      return { success: response.success, message: response.message };
    } catch (e) {
      if (e instanceof Error && (e.message.includes('404') || e.message.includes('not found'))) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }
      throw e;
    }
  }

  throw new Error('Timeout waiting for set-config response');
}

// Get stored command response (for polling results like get-config)
export async function getCommandResponse(agentId: string, commandId: string): Promise<StoredCommandResponse> {
  return fetchApi<StoredCommandResponse>(`/agents/${agentId}/command/${commandId}`);
}

// Send get-config command and poll for response
// Increased timeout because MQTT round-trip can take longer on slow connections
export async function getAgentConfig(agentId: string, maxWaitMs = 15000): Promise<AgentConfig> {
  // Send the get-config command
  const sent = await sendCommand(agentId, 'get-config');

  // Poll for response
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await getCommandResponse(agentId, sent.command_id);
      if (response.config_json) {
        return JSON.parse(response.config_json) as AgentConfig;
      }
      throw new Error(response.message || 'No config returned');
    } catch (e) {
      if (e instanceof Error && (e.message.includes('404') || e.message.includes('not found'))) {
        // Response not ready yet, wait and retry
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }
      throw e;
    }
  }

  throw new Error('Timeout waiting for agent config response');
}

// Send get-swap-processes command and poll for response
// Longer timeout (30s) because reading /proc/*/status on busy machines can take time
export async function getAgentSwapProcesses(agentId: string, maxWaitMs = 30000): Promise<SwapProcessList> {
  // Send the get-swap-processes command
  const sent = await sendCommand(agentId, 'get-swap-processes');

  // Poll for response
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await getCommandResponse(agentId, sent.command_id);
      if (response.swap_processes_json) {
        return JSON.parse(response.swap_processes_json) as SwapProcessList;
      }
      throw new Error(response.message || 'No swap processes returned');
    } catch (e) {
      if (e instanceof Error && (e.message.includes('404') || e.message.includes('not found'))) {
        // Response not ready yet, wait and retry
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }
      throw e;
    }
  }

  throw new Error('Timeout waiting for swap processes response');
}

// Updates API
export interface LatestUpdateInfo {
  version: string;
  checksum: string;
  download_url: string;
  size: number;
}

export async function getLatestUpdate(): Promise<LatestUpdateInfo | null> {
  try {
    return await fetchApi<LatestUpdateInfo>('/updates/latest');
  } catch {
    return null;
  }
}

export async function refreshUpdatesOnServer(): Promise<void> {
  await fetchApi<{ refreshed: boolean; versions_count: number }>('/updates/refresh', {
    method: 'POST',
  });
}

export async function sendUpdateCommand(agentId: string, updateInfo: LatestUpdateInfo): Promise<CommandSentResponse> {
  return sendCommand(agentId, 'update', {
    updateUrl: updateInfo.download_url,
    updateChecksum: updateInfo.checksum,
  });
}

export function useAgentProcesses(agentId: string | null, refreshInterval = 5000) {
  const [processes, setProcesses] = useState<ProcessSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!agentId) return;

    try {
      const data = await fetchApi<ProcessSnapshot[]>(`/agents/${agentId}/processes/latest`);
      setProcesses(data);
      setError(null);
    } catch (e) {
      // Don't set error for 404 - just means no process data yet
      if (e instanceof Error && e.message.includes('404')) {
        setProcesses([]);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to fetch processes');
      }
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!agentId) {
      setProcesses([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [agentId, refresh, refreshInterval]);

  return { processes, loading, error, refresh };
}

// ============================================================================
// Historical Data API for History View
// ============================================================================

/**
 * Get historical metrics for an agent within a time range
 */
export async function getHistoricalMetrics(
  agentId: string,
  from: Date,
  to: Date
): Promise<Metrics[]> {
  const fromStr = from.toISOString();
  const toStr = to.toISOString();
  return fetchApi<Metrics[]>(`/agents/${agentId}/metrics?from=${fromStr}&to=${toStr}`);
}

/**
 * Get historical metrics for multiple agents
 */
export async function getMultiAgentMetrics(
  agentIds: string[],
  from: Date,
  to: Date
): Promise<Map<string, Metrics[]>> {
  const results = await Promise.allSettled(
    agentIds.map(async (id) => ({
      id,
      metrics: await getHistoricalMetrics(id, from, to),
    }))
  );

  const metricsMap = new Map<string, Metrics[]>();
  for (const result of results) {
    if (result.status === 'fulfilled') {
      metricsMap.set(result.value.id, result.value.metrics);
    }
  }
  return metricsMap;
}

/**
 * Get disk metrics for an agent within a time range
 */
export async function getDiskMetrics(
  agentId: string,
  from: Date,
  to: Date
): Promise<DiskMetrics[]> {
  const fromStr = from.toISOString();
  const toStr = to.toISOString();
  return fetchApi<DiskMetrics[]>(`/agents/${agentId}/disk-metrics?from=${fromStr}&to=${toStr}`);
}

/**
 * Get network metrics for an agent within a time range
 */
export async function getNetworkMetrics(
  agentId: string,
  from: Date,
  to: Date
): Promise<NetworkMetrics[]> {
  const fromStr = from.toISOString();
  const toStr = to.toISOString();
  return fetchApi<NetworkMetrics[]>(`/agents/${agentId}/network-metrics?from=${fromStr}&to=${toStr}`);
}

/**
 * Get processes at a specific timestamp (closest snapshot)
 */
export async function getProcessesAtTime(
  agentId: string,
  at: Date
): Promise<ProcessSnapshot[]> {
  const atStr = at.toISOString();
  return fetchApi<ProcessSnapshot[]>(`/agents/${agentId}/processes/at?at=${atStr}`);
}

// ============================================================================
// Service Metrics API (plugins: nginx, tomcat, self, etc.)
// ============================================================================

/**
 * Get list of services monitored for an agent
 */
export async function getAgentServices(agentId: string): Promise<ServiceSummary[]> {
  return fetchApi<ServiceSummary[]>(`/agents/${agentId}/services`);
}

/**
 * Get metrics for a specific service
 */
export async function getServiceMetrics(
  agentId: string,
  serviceName: string,
  from?: Date,
  to?: Date
): Promise<ServiceMetrics[]> {
  let url = `/agents/${agentId}/services/${encodeURIComponent(serviceName)}/metrics`;
  if (from && to) {
    url += `?from=${from.toISOString()}&to=${to.toISOString()}`;
  }
  return fetchApi<ServiceMetrics[]>(url);
}

/**
 * Get latest metrics for a specific service
 */
export async function getLatestServiceMetrics(
  agentId: string,
  serviceName: string
): Promise<ServiceMetrics> {
  return fetchApi<ServiceMetrics>(`/agents/${agentId}/services/${encodeURIComponent(serviceName)}/metrics/latest`);
}

/**
 * Hook to fetch services for an agent
 */
export function useAgentServices(agentId: string | null, refreshInterval = 10000) {
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!agentId) return;

    try {
      const data = await getAgentServices(agentId);
      setServices(data);
      setError(null);
    } catch (e) {
      // Don't set error for 404 - just means no services yet
      if (e instanceof Error && e.message.includes('404')) {
        setServices([]);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to fetch services');
      }
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!agentId) {
      setServices([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [agentId, refresh, refreshInterval]);

  return { services, loading, error, refresh };
}

/**
 * Hook to fetch latest metrics for all services of an agent
 */
export function useAllServicesMetrics(agentId: string | null, services: ServiceSummary[], refreshInterval = 5000) {
  const [metricsMap, setMetricsMap] = useState<Map<string, ServiceMetrics>>(new Map());
  const [loading, setLoading] = useState(true);

  // Stabilize dependency: only re-run when service names actually change
  const serviceNames = useMemo(() => services.map(s => s.service_name).sort().join(','), [services]);

  const refresh = useCallback(async () => {
    const names = serviceNames.split(',').filter(n => n);
    if (!agentId || names.length === 0) {
      setLoading(false);
      return;
    }

    const results = await Promise.allSettled(
      names.map(async (serviceName) => {
        const metrics = await getLatestServiceMetrics(agentId, serviceName);
        return { serviceName, metrics };
      })
    );

    const newMap = new Map<string, ServiceMetrics>();
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        newMap.set(result.value.serviceName, result.value.metrics);
      }
    });

    setMetricsMap(newMap);
    setLoading(false);
  }, [agentId, serviceNames]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  return { metricsMap, loading, refresh };
}

// Server health check
export interface ServerHealth {
  isConnected: boolean;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  serverVersion: string | null;
}

export function useServerHealth(checkInterval = 10000) {
  const [health, setHealth] = useState<ServerHealth>({
    isConnected: true, // Optimistic start
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    consecutiveFailures: 0,
    serverVersion: null,
  });

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch('/health', {
        method: 'GET',
        // Short timeout for health checks
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json();
        setHealth(prev => ({
          isConnected: true,
          lastSuccessAt: new Date(),
          lastErrorAt: prev.lastErrorAt,
          lastError: null,
          consecutiveFailures: 0,
          serverVersion: data.version || null,
        }));
      } else {
        throw new Error(`Server returned ${response.status}`);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Connection failed';
      setHealth(prev => ({
        isConnected: false,
        lastSuccessAt: prev.lastSuccessAt,
        lastErrorAt: new Date(),
        lastError: errorMessage,
        consecutiveFailures: prev.consecutiveFailures + 1,
        serverVersion: prev.serverVersion,
      }));
    }
  }, []);

  useEffect(() => {
    // Initial check
    checkHealth();

    // Periodic checks
    const interval = setInterval(checkHealth, checkInterval);
    return () => clearInterval(interval);
  }, [checkHealth, checkInterval]);

  return health;
}

// ========== MQTT Cluster API ==========

import type { MqttClusterStatus } from '../types/api';

export function useMqttClusterStatus(refreshInterval = 5000) {
  const [status, setStatus] = useState<MqttClusterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/mqtt/cluster`);
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
        setError(null);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch cluster status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  return { status, loading, error, refresh };
}

// Rebalance a group to a different node
export async function rebalanceMqttGroup(group: string, node: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/mqtt/cluster/rebalance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group, node }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

// ========== AI Analysis API ==========

import type { AiAgentStatus, AiResponse, AiAnalyzeRequest, AiAnalyzeResponse, AiInsight, AiRecommendation } from '../types/api';

/**
 * Send an AI analysis request
 */
export async function sendAiAnalyzeRequest(request: AiAnalyzeRequest): Promise<AiAnalyzeResponse> {
  return fetchApi<AiAnalyzeResponse>('/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}

/**
 * Get AI response by request ID
 */
export async function getAiResponse(requestId: string): Promise<AiResponse | null> {
  try {
    return await fetchApi<AiResponse>(`/ai/response/${requestId}`);
  } catch (e) {
    if (e instanceof Error && (e.message.includes('404') || e.message.includes('not found'))) {
      return null;
    }
    throw e;
  }
}

/**
 * Get AI agent status
 */
export async function getAiStatus(): Promise<AiAgentStatus | null> {
  try {
    const response = await fetch(`${API_BASE}/ai/status`);
    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse insights JSON from AI response
 */
export function parseAiInsights(insightsJson: string | null): AiInsight[] {
  if (!insightsJson) return [];
  try {
    return JSON.parse(insightsJson) as AiInsight[];
  } catch {
    return [];
  }
}

/**
 * Parse recommendations JSON from AI response
 */
export function parseAiRecommendations(recommendationsJson: string | null): AiRecommendation[] {
  if (!recommendationsJson) return [];
  try {
    return JSON.parse(recommendationsJson) as AiRecommendation[];
  } catch {
    return [];
  }
}

/**
 * Send AI analysis request and poll for response
 * @param request - The analysis request
 * @param maxWaitMs - Maximum time to wait for response (default 120s for LLM)
 * @param pollIntervalMs - Polling interval (default 1s)
 * @param onProgress - Optional callback for progress updates
 */
export async function sendAiAnalyzeAndWait(
  request: AiAnalyzeRequest,
  maxWaitMs = 120000,
  pollIntervalMs = 1000,
  onProgress?: (status: 'pending' | 'processing' | 'completed' | 'error', elapsedMs: number) => void
): Promise<AiResponse> {
  const sent = await sendAiAnalyzeRequest(request);
  const requestId = sent.request_id;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const elapsed = Date.now() - startTime;

    const response = await getAiResponse(requestId);

    if (response?.completed_at) {
      onProgress?.('completed', elapsed);
      return response;
    }

    onProgress?.(response ? 'processing' : 'pending', elapsed);
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error('Timeout waiting for AI analysis response');
}

/**
 * Hook to monitor AI agent status
 */
export function useAiStatus(refreshInterval = 10000) {
  const [status, setStatus] = useState<AiAgentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getAiStatus();
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch AI status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  return { status, loading, error, refresh };
}
