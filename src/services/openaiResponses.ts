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
      const parsedArgs = safeParseJson(call.arguments);
      try {
        const result = await tool.execute(parsedArgs);
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      } catch (error) {
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

  return {
    outputText: extractOutputText(response),
    toolCalls,
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
