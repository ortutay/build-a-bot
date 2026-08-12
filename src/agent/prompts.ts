export type PromptOptions = {
  agentState: string;
};

export const agentState = (options: PromptOptions) => `Current agent state is:
${options.agentState}`;
