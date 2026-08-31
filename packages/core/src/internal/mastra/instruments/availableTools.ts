const availableTools = new Set<string>();

export const markAvailableTool = async <Tool extends object>(tool: Tool): Promise<Tool> => {
  if (!('id' in tool) || typeof tool.id !== 'string') {
    throw new Error('Available tools must have a string id');
  }
  availableTools.add(tool.id);
  return tool;
};

export const selectAvailableTools = <Tool>(tools: Record<string, Tool>): Record<string, Tool> =>
  Object.fromEntries(Object.entries(tools).filter(([name]) => availableTools.has(name))) as Record<
    string,
    Tool
  >;
