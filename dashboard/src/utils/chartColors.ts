// Color palette for multi-agent charts
// These colors are designed to be visible on the dark terminal theme
export const AGENT_COLORS = [
  '#33ff33', // phosphor green (primary)
  '#33ccff', // info blue
  '#ffb000', // amber
  '#ff66cc', // magenta
  '#66ffcc', // cyan
  '#ff6666', // red
  '#ffff66', // yellow
  '#cc99ff', // purple
] as const;

export type AgentColor = (typeof AGENT_COLORS)[number];

/**
 * Get a color for an agent based on index
 * Cycles through the palette if more agents than colors
 */
export function getAgentColor(index: number): AgentColor {
  return AGENT_COLORS[index % AGENT_COLORS.length];
}

/**
 * Assign colors to a list of agent IDs
 * Returns a map from agent ID to color
 */
export function assignAgentColors(agentIds: string[]): Map<string, AgentColor> {
  const colorMap = new Map<string, AgentColor>();
  agentIds.forEach((id, index) => {
    colorMap.set(id, getAgentColor(index));
  });
  return colorMap;
}

/**
 * CSS variable fallbacks for chart colors
 */
export const CHART_COLORS = {
  ok: 'var(--color-ok, #33ff33)',
  warn: 'var(--color-warn, #ffb000)',
  error: 'var(--color-error, #ff5555)',
  info: 'var(--color-info, #33ccff)',
  amber: 'var(--color-amber, #ffb000)',
  phosphor: 'var(--color-phosphor, #33ff33)',
} as const;
