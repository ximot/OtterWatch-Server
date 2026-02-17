import { useState } from 'react';
import { Header } from './components/Header';
import { AgentList } from './components/AgentList';
import { MetricsPanel } from './components/MetricsPanel';
import { OverviewPanel } from './components/OverviewPanel';
import { AdminPanel } from './components/AdminPanel';
import { ProcessPanel } from './components/ProcessPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { ServiceMetricsPanel } from './components/ServiceMetricsPanel';
import { ClusterPanel } from './components/ClusterPanel';
import { AiPanel } from './components/AiPanel';
import { useAgents, useAgentMetrics, useAllAgentsMetrics, useAgentProcesses, useGroups, useServerHealth, useAgentServices, useAllServicesMetrics } from './hooks/useApi';

// Dashboard version from package.json via Vite define
const DASHBOARD_VERSION = __APP_VERSION__;

type ViewMode = 'overview' | 'detail' | 'history' | 'admin' | 'cluster' | 'ai';

function ViewSwitcher({
  mode,
  onModeChange,
}: {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="flex border border-terminal-border bg-terminal-panel/30">
      <button
        onClick={() => onModeChange('overview')}
        className={`px-4 py-2 text-sm font-medium transition-all border-r border-terminal-border ${
          mode === 'overview'
            ? 'bg-phosphor/20 text-phosphor'
            : 'text-terminal-dim hover:text-terminal-text hover:bg-terminal-border/30'
        }`}
      >
        <span className="mr-2">▦</span>
        OVERVIEW
      </button>
      <button
        onClick={() => onModeChange('detail')}
        className={`px-4 py-2 text-sm font-medium transition-all border-r border-terminal-border ${
          mode === 'detail'
            ? 'bg-phosphor/20 text-phosphor'
            : 'text-terminal-dim hover:text-terminal-text hover:bg-terminal-border/30'
        }`}
      >
        <span className="mr-2">▤</span>
        DETAIL
      </button>
      <button
        onClick={() => onModeChange('history')}
        className={`px-4 py-2 text-sm font-medium transition-all border-r border-terminal-border ${
          mode === 'history'
            ? 'bg-info/20 text-info'
            : 'text-terminal-dim hover:text-terminal-text hover:bg-terminal-border/30'
        }`}
      >
        <span className="mr-2">◷</span>
        HISTORY
      </button>
      <button
        onClick={() => onModeChange('admin')}
        className={`px-4 py-2 text-sm font-medium transition-all border-r border-terminal-border ${
          mode === 'admin'
            ? 'bg-amber/20 text-amber'
            : 'text-terminal-dim hover:text-terminal-text hover:bg-terminal-border/30'
        }`}
      >
        <span className="mr-2">⚙</span>
        ADMIN
      </button>
      <button
        onClick={() => onModeChange('cluster')}
        className={`px-4 py-2 text-sm font-medium transition-all border-r border-terminal-border ${
          mode === 'cluster'
            ? 'bg-info/20 text-info'
            : 'text-terminal-dim hover:text-terminal-text hover:bg-terminal-border/30'
        }`}
      >
        <span className="mr-2">◉</span>
        CLUSTER
      </button>
      <button
        onClick={() => onModeChange('ai')}
        className={`px-4 py-2 text-sm font-medium transition-all ${
          mode === 'ai'
            ? 'bg-purple-500/20 text-purple-400'
            : 'text-terminal-dim hover:text-terminal-text hover:bg-terminal-border/30'
        }`}
      >
        <span className="mr-2">🤖</span>
        AI
      </button>
    </div>
  );
}

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const { agents, loading: agentsLoading, refresh: refreshAgents } = useAgents(5000);
  const { groups } = useGroups();
  const { metrics, history, loading: metricsLoading } = useAgentMetrics(
    viewMode === 'detail' ? selectedAgentId : null,
    1000
  );
  const { metricsMap, loading: overviewLoading } = useAllAgentsMetrics(
    viewMode === 'overview' ? agents : [],
    2000
  );
  const { processes, loading: processesLoading } = useAgentProcesses(
    viewMode === 'detail' ? selectedAgentId : null,
    5000
  );
  const { services, loading: servicesLoading } = useAgentServices(
    viewMode === 'detail' ? selectedAgentId : null,
    10000
  );
  const { metricsMap: servicesMetricsMap, loading: servicesMetricsLoading } = useAllServicesMetrics(
    viewMode === 'detail' ? selectedAgentId : null,
    services,
    5000
  );
  const serverHealth = useServerHealth(10000); // Check every 10 seconds

  const selectedAgent = agents.find(a => a.id === selectedAgentId) ?? null;

  const handleSelectAgent = (id: string) => {
    setSelectedAgentId(id);
    setViewMode('detail');
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      {/* View Switcher */}
      <div className="px-4 lg:px-6 pt-4 flex items-center justify-between">
        <ViewSwitcher mode={viewMode} onModeChange={setViewMode} />
        <div className="text-xs text-terminal-dim hidden sm:block">
          <span className="text-phosphor-dim">[F1]</span> Overview
          <span className="mx-2">│</span>
          <span className="text-phosphor-dim">[F2]</span> Detail
          <span className="mx-2">│</span>
          <span className="text-info">[F3]</span> History
          <span className="mx-2">│</span>
          <span className="text-amber">[F4]</span> Admin
          <span className="mx-2">│</span>
          <span className="text-info">[F5]</span> Cluster
          <span className="mx-2">│</span>
          <span className="text-purple-400">[F6]</span> AI
        </div>
      </div>

      <main className="flex-1 p-4 lg:p-6">
        {viewMode === 'overview' && (
          <OverviewPanel
            agents={agents}
            metricsMap={metricsMap}
            onSelectAgent={handleSelectAgent}
            loading={agentsLoading || overviewLoading}
            groups={groups}
            selectedGroup={selectedGroup}
            onGroupChange={setSelectedGroup}
          />
        )}

        {viewMode === 'detail' && (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 lg:gap-6">
            {/* Sidebar - Agent List */}
            <div className="lg:h-[calc(100vh-240px)]">
              <AgentList
                agents={agents}
                selectedId={selectedAgentId}
                onSelect={setSelectedAgentId}
                loading={agentsLoading}
              />
            </div>

            {/* Main Content - Metrics and Processes */}
            <div className="flex flex-col gap-4">
              {/* Metrics Panel */}
              <div className="min-h-[350px]">
                <MetricsPanel
                  agent={selectedAgent}
                  metrics={metrics}
                  history={history}
                  loading={metricsLoading}
                />
              </div>

              {/* Process Panel */}
              <div className="min-h-[300px] lg:h-[350px]">
                <ProcessPanel
                  processes={processes}
                  loading={processesLoading}
                />
              </div>

              {/* Service Metrics Panel - only show if agent has services */}
              {(services.length > 0 || servicesLoading) && (
                <div className="min-h-[200px]">
                  <ServiceMetricsPanel
                    services={services}
                    metricsMap={servicesMetricsMap}
                    loading={servicesLoading || servicesMetricsLoading}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {viewMode === 'history' && (
          <HistoryPanel agents={agents} />
        )}

        {viewMode === 'admin' && (
          <AdminPanel agents={agents} onAgentDeleted={refreshAgents} />
        )}

        {viewMode === 'cluster' && (
          <ClusterPanel agents={agents} onAgentUpdated={refreshAgents} />
        )}

        {viewMode === 'ai' && (
          <AiPanel agents={agents} groups={groups} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-terminal-border bg-terminal-panel/30 px-6 py-3">
        <div className="flex items-center justify-between text-xs text-terminal-dim">
          <div className="flex items-center gap-4">
            <span>
              <span className="text-phosphor">▸</span> OTTERWATCH MONITORING SYSTEM
            </span>
            <span className="hidden sm:inline">
              │ {agents.filter(a => a.is_online).length}/{agents.length} AGENTS ONLINE
            </span>
            <span className="hidden md:inline text-terminal-dim">
              │ Dashboard v{DASHBOARD_VERSION}
              {serverHealth.serverVersion && (
                <> • Server v{serverHealth.serverVersion}</>
              )}
            </span>
          </div>
          {/* Server connection status */}
          {serverHealth.isConnected ? (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-ok animate-pulse" />
              <span className="text-ok">SYSTEM OPERATIONAL</span>
              {serverHealth.lastSuccessAt && (
                <span className="hidden lg:inline text-terminal-dim">
                  • Last check: {serverHealth.lastSuccessAt.toLocaleTimeString()}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-error animate-pulse" />
              <span className="text-error">
                CONNECTION LOST
                {serverHealth.consecutiveFailures > 1 && (
                  <span className="ml-1">({serverHealth.consecutiveFailures}x)</span>
                )}
              </span>
              {serverHealth.lastError && (
                <span className="hidden md:inline text-error/70" title={serverHealth.lastError}>
                  • {serverHealth.lastError.length > 30
                      ? serverHealth.lastError.slice(0, 30) + '...'
                      : serverHealth.lastError}
                </span>
              )}
              {serverHealth.lastSuccessAt && (
                <span className="hidden lg:inline text-terminal-dim">
                  • Last OK: {serverHealth.lastSuccessAt.toLocaleTimeString()}
                </span>
              )}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

export default App;
