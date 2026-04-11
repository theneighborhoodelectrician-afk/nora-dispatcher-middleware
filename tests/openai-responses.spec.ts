import { afterEach, describe, expect, it, vi } from "vitest";
import { runOpenAiResponses } from "../src/services/openaiResponses.js";

describe("OpenAI Responses orchestration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("executes function calls and returns the final assistant text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "resp_1",
          output: [
            {
              type: "function_call",
              call_id: "call_1",
              name: "echo_tool",
              arguments: JSON.stringify({ value: "hello" }),
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "resp_2",
          output_text: "What city is the project in?",
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const tool = vi.fn(async (args: unknown) => ({
      ok: true,
      echoed: (args as { value: string }).value,
    }));

    const result = await runOpenAiResponses({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5-mini",
      systemPrompt: "Be brief.",
      inputText: "hello",
      tools: [
        {
          name: "echo_tool",
          description: "Echo a value",
          parameters: {
            type: "object",
            properties: {
              value: { type: "string" },
            },
            required: ["value"],
          },
          execute: tool,
        },
      ],
    });

    expect(result.outputText).toBe("What city is the project in?");
    expect(result.toolCalls).toEqual(["echo_tool"]);
    expect(result.trace.map((entry) => entry.type)).toEqual([
      "function_call",
      "function_result",
      "final_output",
    ]);
    expect(tool).toHaveBeenCalledWith({ value: "hello" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRequest.previous_response_id).toBe("resp_1");
    expect(secondRequest.input[0]).toMatchObject({
      type: "function_call_output",
      call_id: "call_1",
    });
  });
});
