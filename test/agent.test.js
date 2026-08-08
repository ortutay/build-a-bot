import { afterEach, expect, test, vi } from "vitest";
import { Agent } from "../src/agent.js";

const toolkit = {
  tools: [],
  mapping: {
    echo: async (_agent, { value }) => ({ value }),
  },
};

const resp = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

afterEach(() => vi.unstubAllGlobals());

test("agent executes a tool call and stores an OpenAI-compatible tool result", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      resp({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  function: { name: "echo", arguments: '{"value":"ok"}' },
                },
              ],
            },
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      resp({
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "Done." },
          },
        ],
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const agent = new Agent("test-model", toolkit);

  expect((await agent.step()).stop).toBe(false);
  expect(agent.messages.at(-1)).toMatchObject({
    role: "tool",
    tool_call_id: "call_1",
    name: "echo",
    content: '{"value":"ok"}',
  });
  expect((await agent.step()).stop).toBe(true);
  expect(agent.lastReply().content).toBe("Done.");
});
