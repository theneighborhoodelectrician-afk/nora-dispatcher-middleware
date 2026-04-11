export interface OpenAiFunctionTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: unknown): Promise<unknown> | unknown;
}

export interface RunOpenAiResponsesOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  inputText: string;
  tools: OpenAiFunctionTool[];
  maxToolRounds?: number;
}

interface ResponsesApiOutputItem {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

interface ResponsesApiResponse {
  id?: string;
  output?: ResponsesApiOutputItem[];
  output_text?: string;
}

export interface RunOpenAiResponsesResult {
  outputText: string;
  toolCalls: string[];
  trace: Array<{
    type: "function_call" | "function_result" | "final_output";
    name?: string;
    summary: string;
  }>;
}

export async function runOpenAiResponses(
  options: RunOpenAiResponsesOptions,
): Promise<RunOpenAiResponsesResult> {
  const {
    apiKey,
    baseUrl,
    model,
    systemPrompt,
    inputText,
    tools,
    maxToolRounds = 4,
  } = options;

  const toolCalls: string[] = [];
  const trace: RunOpenAiResponsesResult["trace"] = [];
  let response = await createResponse(baseUrl, apiKey, {
    model,
    input: [
      {
        role: "developer",
        content: [{ type: "input_text", text: systemPrompt }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: inputText }],
      },
    ],
    tools: tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    tool_choice: "auto",
  });

  let rounds = 0;
  while (rounds < maxToolRounds) {
    const functionCalls = (response.output ?? []).filter((item) => item.type === "function_call");
    if (!functionCalls.length) {
      break;
    }

    const outputs = [];
    for (const call of functionCalls) {
      if (!call.call_id || !call.name) {
        continue;
      }

      const tool = tools.find((entry) => entry.name === call.name);
      if (!tool) {
        trace.push({
          type: "function_call",
          name: call.name,
          summary: `Model requested unknown tool ${call.name}.`,
        });
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({
            ok: false,
            error: `Unknown tool: ${call.name}`,
          }),
        });
        continue;
      }

      toolCalls.push(tool.name);
      trace.push({
        type: "function_call",
        name: tool.name,
        summary: summarizeFunctionCall(tool.name, call.arguments),
      });
      const parsedArgs = safeParseJson(call.arguments);
      try {
        const result = await tool.execute(parsedArgs);
        trace.push({
          type: "function_result",
          name: tool.name,
          summary: summarizeToolResult(tool.name, result),
        });
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      } catch (error) {
        trace.push({
          type: "function_result",
          name: tool.name,
          summary: `${tool.name} failed: ${error instanceof Error ? error.message : "Unknown tool execution error"}`,
        });
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : "Unknown tool execution error",
          }),
        });
      }
    }

    response = await createResponse(baseUrl, apiKey, {
      model,
      previous_response_id: response.id,
      input: outputs,
      tools: tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
      tool_choice: "auto",
    });
    rounds += 1;
  }

  const outputText = extractOutputText(response);
  trace.push({
    type: "final_output",
    summary: outputText ? `Assistant reply: ${truncate(outputText, 160)}` : "Assistant returned no reply text.",
  });

  return {
    outputText,
    toolCalls,
    trace,
  };
}

async function createResponse(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<ResponsesApiResponse> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI Responses request failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as ResponsesApiResponse;
}

function extractOutputText(response: ResponsesApiResponse): string {
  if (response.output_text?.trim()) {
    return response.output_text.trim();
  }

  const text = (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text?.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return text;
}

function safeParseJson(value: string | undefined): unknown {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function summarizeFunctionCall(name: string, args: string | undefined): string {
  const parsed = safeParseJson(args);
  if (!parsed || typeof parsed !== "object" || !Object.keys(parsed).length) {
    return `${name} called with no structured arguments.`;
  }

  return `${name} called with ${truncate(JSON.stringify(parsed), 160)}.`;
}

function summarizeToolResult(name: string, result: unknown): string {
  if (typeof result === "string") {
    return `${name} returned ${truncate(result, 160)}.`;
  }

  if (!result || typeof result !== "object") {
    return `${name} completed.`;
  }

  return `${name} returned ${truncate(JSON.stringify(result), 160)}.`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}
