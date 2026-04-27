/**
 * Parser for Codex CLI rollout JSONL files.
 *
 * Codex logs are event streams rather than Claude-style message entries. This
 * adapter synthesizes the existing ParsedMessage shape so the chunk builder,
 * tool linking, token metrics, and context UI can be reused.
 */

import {
  type ContentBlock,
  isParsedInternalUserMessage,
  isParsedRealUserMessage,
  type ParsedMessage,
  type PhaseTokenBreakdown,
  type SessionMetrics,
  type TokenUsage,
  type ToolCall,
} from '@main/types';
import { extractCodexSessionIdFromFilename } from '@main/utils/codexPaths';
import { calculateMetrics, getTaskCalls } from '@main/utils/jsonl';
import { createLogger } from '@shared/utils/logger';
import * as readline from 'readline';

import type { FileSystemProvider } from '../infrastructure/FileSystemProvider';
import type { ParsedSession } from './SessionParser';

const logger = createLogger('Parsing:CodexSessionParser');

const CODEX_SUBAGENT_TOOL_NAMES = new Set([
  'spawn_agent',
  'wait_agent',
  'send_input',
  'resume_agent',
  'close_agent',
]);

interface CodexRecord {
  timestamp?: string;
  type?: 'session_meta' | 'turn_context' | 'event_msg' | 'response_item';
  payload?: Record<string, unknown>;
}

interface CodexExecEndPayload {
  type: 'exec_command_end';
  call_id?: string;
  command?: unknown;
  cwd?: string;
  stdout?: string;
  stderr?: string;
  aggregated_output?: string;
  exit_code?: number;
  duration?: { secs?: number; nanos?: number };
  status?: string;
}

interface CodexPatchApplyEndPayload {
  type: 'patch_apply_end';
  call_id?: string;
  stdout?: string;
  stderr?: string;
  success?: boolean;
  changes?: unknown;
  status?: string;
}

interface CodexWebSearchEndPayload {
  type: 'web_search_end';
  call_id?: string;
  query?: string;
  action?: unknown;
  timestamp: Date;
}

interface ParsedCodexToolOutput {
  content: string;
  metadata?: Record<string, unknown>;
}

interface FunctionCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  timestamp: Date;
}

export interface CodexSessionFileMetadata {
  sessionId: string;
  cwd: string | null;
  model: string | null;
  firstUserMessage: { text: string; timestamp: string } | null;
  messageCount: number;
  isOngoing: boolean;
  hasSubagents: boolean;
  contextConsumption?: number;
  phaseBreakdown?: PhaseTokenBreakdown[];
}

export async function parseCodexSessionFile(
  filePath: string,
  fsProvider: FileSystemProvider
): Promise<ParsedSession> {
  const messages: ParsedMessage[] = [];
  const functionCalls = new Map<string, FunctionCallInfo>();
  const execResults = new Map<string, CodexExecEndPayload>();
  const patchResults = new Map<string, CodexPatchApplyEndPayload>();
  const toolOutputs = new Map<string, ParsedCodexToolOutput>();
  const resultMessages = new Map<string, ParsedMessage>();
  // Keyed by call_id for accurate matching when web searches interleave; falls
  // back to FIFO insertion order if a web_search_call arrives without an id.
  const pendingWebSearchEnds = new Map<string, CodexWebSearchEndPayload>();
  let pendingWebSearchSeq = 0;

  let sessionId = extractCodexSessionIdFromFilename(filePath);
  let currentCwd: string | undefined;
  let currentModel: string | undefined;
  let sequence = 0;
  let lastUuid: string | null = null;
  let lastTokenUsageKey = '';

  const appendMessage = (message: ParsedMessage): void => {
    messages.push(message);
    lastUuid = message.uuid;
  };

  const nextUuid = (kind: string, callId?: string): string => {
    const suffix = callId ? callId.replace(/[^a-zA-Z0-9._-]/g, '-') : String(++sequence);
    return `codex-${sessionId}-${kind}-${suffix}`;
  };

  const messageHasText = (message: ParsedMessage): boolean =>
    Array.isArray(message.content) && message.content.some((block) => block.type === 'text');

  const attachLatestUsage = (usage: TokenUsage | null): void => {
    if (!usage) {
      return;
    }

    const key = JSON.stringify(usage);
    if (key === lastTokenUsageKey) {
      return;
    }

    // Prefer the most recent text-bearing assistant message so token totals
    // surface on the response visible to the user, not on an intermediate
    // tool_use record.
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.type === 'assistant' && !message.usage && messageHasText(message)) {
        message.usage = usage;
        lastTokenUsageKey = key;
        return;
      }
    }

    // Fallback: no text-bearing assistant yet (e.g., turn produced only a tool
    // call before token_count fired). Attach to the latest assistant so the
    // value is not lost.
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.type === 'assistant' && !message.usage) {
        message.usage = usage;
        lastTokenUsageKey = key;
        return;
      }
    }
  };

  const applyExecResultToMessage = (
    resultMessage: ParsedMessage,
    callId: string,
    execPayload: CodexExecEndPayload
  ): void => {
    const message = resultMessage;
    const newContent = getToolResultContent(execPayload);
    const isError = execPayload.exit_code != null ? execPayload.exit_code !== 0 : false;

    if (Array.isArray(message.content)) {
      const block = message.content[0];
      if (block?.type === 'tool_result') {
        block.content = newContent;
        block.is_error = isError;
      }
    }

    const toolResult = message.toolResults[0];
    if (toolResult) {
      toolResult.content = newContent;
      toolResult.isError = isError;
    }

    message.toolUseResult = buildToolUseResult(
      callId,
      functionCalls.get(callId),
      execPayload,
      newContent,
      toolOutputs.get(callId)
    );
  };

  const applyPatchResultToMessage = (
    resultMessage: ParsedMessage,
    callId: string,
    patchPayload: CodexPatchApplyEndPayload
  ): void => {
    const message = resultMessage;
    const newContent = getPatchResultContent(patchPayload);
    const isError = patchPayload.success === false;

    if (Array.isArray(message.content)) {
      const block = message.content[0];
      if (block?.type === 'tool_result') {
        block.content = newContent;
        block.is_error = isError;
      }
    }

    const toolResult = message.toolResults[0];
    if (toolResult) {
      toolResult.content = newContent;
      toolResult.isError = isError;
    }

    message.toolUseResult = buildPatchToolUseResult(
      callId,
      functionCalls.get(callId),
      patchPayload,
      newContent,
      toolOutputs.get(callId)
    );
  };

  const recordToolCall = (
    callId: string,
    name: string,
    input: Record<string, unknown>,
    callTimestamp: Date
  ): void => {
    const callInfo = {
      id: callId,
      name,
      input,
      timestamp: callTimestamp,
    };
    functionCalls.set(callId, callInfo);

    // Some Codex records can arrive out of order. If the result was already
    // synthesized, backfill the metadata used by the renderer.
    const resultMessage = resultMessages.get(callId);
    if (resultMessage?.toolUseResult) {
      resultMessage.toolUseResult.toolName = name;
      resultMessage.toolUseResult.input = input;
    }
  };

  const appendToolCallMessage = (
    callId: string,
    name: string,
    input: Record<string, unknown>,
    callTimestamp: Date
  ): void => {
    recordToolCall(callId, name, input, callTimestamp);

    const toolUseBlock: ContentBlock = {
      type: 'tool_use',
      id: callId,
      name,
      input,
    };

    appendMessage({
      uuid: nextUuid('tool-call', callId),
      parentUuid: lastUuid,
      type: 'assistant',
      timestamp: callTimestamp,
      role: 'assistant',
      content: [toolUseBlock],
      model: currentModel,
      cwd: currentCwd,
      isSidechain: false,
      isMeta: false,
      toolCalls: [
        {
          id: callId,
          name,
          input,
          isTask: CODEX_SUBAGENT_TOOL_NAMES.has(name),
          taskDescription: extractSubagentDescription(input),
          taskSubagentType: extractSubagentType(input),
        },
      ],
      toolResults: [],
    });
  };

  const appendToolResultMessage = (
    callId: string,
    resultTimestamp: Date,
    resultContent: string,
    isError: boolean,
    toolUseResult: Record<string, unknown>
  ): void => {
    const toolResultBlock: ContentBlock = {
      type: 'tool_result',
      tool_use_id: callId,
      content: resultContent,
      is_error: isError,
    };

    const resultMessage: ParsedMessage = {
      uuid: nextUuid('tool-result', callId),
      parentUuid: lastUuid,
      type: 'user',
      timestamp: resultTimestamp,
      role: 'user',
      content: [toolResultBlock],
      cwd: currentCwd,
      isSidechain: false,
      isMeta: true,
      userType: 'external',
      toolCalls: [],
      toolResults: [
        {
          toolUseId: callId,
          content: toolResultBlock.content,
          isError: toolResultBlock.is_error ?? false,
        },
      ],
      sourceToolUseID: callId,
      toolUseResult,
    };
    resultMessages.set(callId, resultMessage);
    appendMessage(resultMessage);
  };

  if (!(await fsProvider.exists(filePath))) {
    return processMessages(messages);
  }

  const rl = readline.createInterface({
    input: fsProvider.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    let record: CodexRecord;
    try {
      record = JSON.parse(line) as CodexRecord;
    } catch (error) {
      logger.debug(`Skipping malformed Codex JSONL line in ${filePath}:`, error);
      continue;
    }

    const timestamp = parseRecordTimestamp(record.timestamp);
    const payload = record.payload ?? {};

    if (record.type === 'session_meta') {
      const payloadId = getString(payload.id);
      const payloadCwd = getString(payload.cwd);
      if (payloadId) sessionId = payloadId;
      if (payloadCwd) currentCwd = payloadCwd;
      continue;
    }

    if (record.type === 'turn_context') {
      const payloadCwd = getString(payload.cwd);
      const payloadModel = getString(payload.model);
      if (payloadCwd) currentCwd = payloadCwd;
      if (payloadModel) currentModel = payloadModel;
      continue;
    }

    if (record.type === 'event_msg') {
      const eventType = getString(payload.type);

      if (eventType === 'user_message') {
        const text = getString(payload.message);
        if (!text) {
          continue;
        }

        appendMessage({
          uuid: nextUuid('user'),
          parentUuid: lastUuid,
          type: 'user',
          timestamp,
          role: 'user',
          content: text,
          cwd: currentCwd,
          isSidechain: false,
          isMeta: false,
          userType: 'external',
          toolCalls: [],
          toolResults: [],
        });
        continue;
      }

      if (eventType === 'token_count') {
        const info = asRecord(payload.info);
        const usage = codexTokenUsageToUsageMetadata(asRecord(info?.last_token_usage));
        attachLatestUsage(usage);
        continue;
      }

      if (eventType === 'exec_command_end') {
        const execPayload = payload as unknown as CodexExecEndPayload;
        if (!execPayload.call_id) {
          continue;
        }
        execResults.set(execPayload.call_id, execPayload);
        const resultMessage = resultMessages.get(execPayload.call_id);
        if (resultMessage) {
          // function_call_output already arrived first — backfill the visible
          // content blocks too, not just the toolUseResult metadata.
          applyExecResultToMessage(resultMessage, execPayload.call_id, execPayload);
        }
      }

      if (eventType === 'patch_apply_end') {
        const patchPayload = payload as unknown as CodexPatchApplyEndPayload;
        if (!patchPayload.call_id) {
          continue;
        }
        patchResults.set(patchPayload.call_id, patchPayload);
        const resultMessage = resultMessages.get(patchPayload.call_id);
        if (resultMessage) {
          applyPatchResultToMessage(resultMessage, patchPayload.call_id, patchPayload);
        }
      }

      if (eventType === 'web_search_end') {
        const webSearchPayload = payload as unknown as Omit<CodexWebSearchEndPayload, 'timestamp'>;
        const key = webSearchPayload.call_id ?? `__no_id__${++pendingWebSearchSeq}`;
        pendingWebSearchEnds.set(key, {
          ...webSearchPayload,
          timestamp,
        });
      }
      continue;
    }

    if (record.type !== 'response_item') {
      continue;
    }

    const responseType = getString(payload.type);

    if (responseType === 'message') {
      const role = getString(payload.role);
      if (role !== 'assistant') {
        continue;
      }

      const contentBlocks = codexContentToTextBlocks(payload.content);
      if (contentBlocks.length === 0) {
        continue;
      }

      appendMessage({
        uuid: nextUuid('assistant-message'),
        parentUuid: lastUuid,
        type: 'assistant',
        timestamp,
        role: 'assistant',
        content: contentBlocks,
        model: currentModel,
        cwd: currentCwd,
        isSidechain: false,
        isMeta: false,
        toolCalls: [],
        toolResults: [],
      });
      continue;
    }

    if (responseType === 'web_search_call') {
      // Prefer matching by call_id when both sides expose one. Fall back to
      // FIFO insertion order so historical logs that omit the id still pair up
      // sensibly.
      const explicitCallId = getCodexCallId(payload);
      let matchedEnd: CodexWebSearchEndPayload | undefined;
      if (explicitCallId && pendingWebSearchEnds.has(explicitCallId)) {
        matchedEnd = pendingWebSearchEnds.get(explicitCallId);
        pendingWebSearchEnds.delete(explicitCallId);
      } else {
        const oldestKey = pendingWebSearchEnds.keys().next().value;
        if (oldestKey !== undefined) {
          matchedEnd = pendingWebSearchEnds.get(oldestKey);
          pendingWebSearchEnds.delete(oldestKey);
        }
      }
      const callId = explicitCallId ?? matchedEnd?.call_id ?? `web-search-${++sequence}`;
      const action = asRecord(payload.action) ?? asRecord(matchedEnd?.action) ?? {};
      const query =
        getString(payload.query) ?? getString(action.query) ?? getString(matchedEnd?.query);
      const input = {
        ...action,
        ...(query ? { query } : {}),
        status: getString(payload.status),
      };

      appendToolCallMessage(callId, 'web_search', input, matchedEnd?.timestamp ?? timestamp);

      const resultContent = query ? `Web search completed: ${query}` : 'Web search completed';
      appendToolResultMessage(callId, timestamp, resultContent, false, {
        toolUseId: callId,
        toolName: 'web_search',
        input,
        content: resultContent,
        isError: false,
      });
      continue;
    }

    if (isCodexToolCallResponseType(responseType)) {
      const callId = getCodexCallId(payload);
      const name =
        getString(payload.name) ??
        (responseType ? deriveToolNameFromResponseType(responseType) : undefined);
      if (!callId || !name) {
        continue;
      }

      const input = parseCodexToolInput(responseType, name, payload);
      appendToolCallMessage(callId, name, input, timestamp);
      continue;
    }

    if (isCodexToolCallOutputResponseType(responseType)) {
      const callId = getCodexCallId(payload);
      if (!callId) {
        continue;
      }

      const output = parseToolCallOutput(payload.output);
      toolOutputs.set(callId, output);

      const execPayload = execResults.get(callId);
      const patchPayload = patchResults.get(callId);
      const resultContent = execPayload
        ? getToolResultContent(execPayload)
        : patchPayload
          ? getPatchResultContent(patchPayload)
          : output.content;
      const isError =
        execPayload?.exit_code != null
          ? execPayload.exit_code !== 0
          : patchPayload
            ? patchPayload.success === false
            : false;
      const toolUseResult = patchPayload
        ? buildPatchToolUseResult(
            callId,
            functionCalls.get(callId),
            patchPayload,
            resultContent,
            output
          )
        : buildToolUseResult(callId, functionCalls.get(callId), execPayload, resultContent, output);
      appendToolResultMessage(callId, timestamp, resultContent, isError, toolUseResult);
    }
  }

  return processMessages(messages);
}

export async function analyzeCodexSessionFileMetadata(
  filePath: string,
  fsProvider: FileSystemProvider
): Promise<CodexSessionFileMetadata> {
  let sessionId = extractCodexSessionIdFromFilename(filePath);
  let cwd: string | null = null;
  let model: string | null = null;
  let firstUserMessage: { text: string; timestamp: string } | null = null;
  let messageCount = 0;
  let taskStartedAt = 0;
  let taskCompletedAt = 0;
  let hasSubagents = false;
  let latestContextTokens = 0;
  const pendingCalls = new Set<string>();

  if (!(await fsProvider.exists(filePath))) {
    return {
      sessionId,
      cwd,
      model,
      firstUserMessage,
      messageCount,
      isOngoing: false,
      hasSubagents,
    };
  }

  const rl = readline.createInterface({
    input: fsProvider.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let record: CodexRecord;
    try {
      record = JSON.parse(line) as CodexRecord;
    } catch {
      continue;
    }

    const payload = record.payload ?? {};

    if (record.type === 'session_meta') {
      sessionId = getString(payload.id) ?? sessionId;
      cwd = getString(payload.cwd) ?? cwd;
      continue;
    }

    if (record.type === 'turn_context') {
      cwd = getString(payload.cwd) ?? cwd;
      model = getString(payload.model) ?? model;
      continue;
    }

    if (record.type === 'event_msg') {
      const eventType = getString(payload.type);
      if (eventType === 'task_started') {
        taskStartedAt = Date.parse(record.timestamp ?? '') || taskStartedAt;
      } else if (eventType === 'task_complete') {
        taskCompletedAt = Date.parse(record.timestamp ?? '') || taskCompletedAt;
      } else if (eventType === 'user_message') {
        const text = getString(payload.message);
        if (text) {
          messageCount++;
          firstUserMessage ??= {
            text: text.substring(0, 500),
            timestamp: record.timestamp ?? new Date().toISOString(),
          };
        }
      } else if (eventType === 'token_count') {
        const info = asRecord(payload.info);
        const lastUsage = asRecord(info?.last_token_usage);
        const contextTokens = getNumber(lastUsage?.input_tokens);
        if (contextTokens && contextTokens > 0) {
          latestContextTokens = contextTokens;
        }
      }
      continue;
    }

    if (record.type !== 'response_item') {
      continue;
    }

    const responseType = getString(payload.type);
    if (responseType === 'message' && getString(payload.role) === 'assistant') {
      if (codexContentToTextBlocks(payload.content).length > 0) {
        messageCount++;
      }
    } else if (isCodexToolCallResponseType(responseType)) {
      const callId = getCodexCallId(payload);
      const name =
        getString(payload.name) ??
        (responseType ? deriveToolNameFromResponseType(responseType) : undefined);
      if (callId) {
        pendingCalls.add(callId);
      }
      if (name && CODEX_SUBAGENT_TOOL_NAMES.has(name)) {
        hasSubagents = true;
      }
    } else if (isCodexToolCallOutputResponseType(responseType)) {
      const callId = getCodexCallId(payload);
      if (callId) {
        pendingCalls.delete(callId);
      }
    }
  }

  return {
    sessionId,
    cwd,
    model,
    firstUserMessage,
    messageCount,
    isOngoing: pendingCalls.size > 0 || taskStartedAt > taskCompletedAt,
    hasSubagents,
    contextConsumption: latestContextTokens > 0 ? latestContextTokens : undefined,
    phaseBreakdown:
      latestContextTokens > 0
        ? [
            {
              phaseNumber: 1,
              contribution: latestContextTokens,
              peakTokens: latestContextTokens,
            },
          ]
        : undefined,
  };
}

function processMessages(messages: ParsedMessage[]): ParsedSession {
  const byType = {
    user: [] as ParsedMessage[],
    realUser: [] as ParsedMessage[],
    internalUser: [] as ParsedMessage[],
    assistant: [] as ParsedMessage[],
    system: [] as ParsedMessage[],
    other: [] as ParsedMessage[],
  };
  const sidechainMessages: ParsedMessage[] = [];
  const mainMessages: ParsedMessage[] = [];

  for (const message of messages) {
    switch (message.type) {
      case 'user':
        byType.user.push(message);
        if (isParsedRealUserMessage(message)) {
          byType.realUser.push(message);
        } else if (isParsedInternalUserMessage(message)) {
          byType.internalUser.push(message);
        }
        break;
      case 'assistant':
        byType.assistant.push(message);
        break;
      case 'system':
        byType.system.push(message);
        break;
      default:
        byType.other.push(message);
        break;
    }

    if (message.isSidechain) {
      sidechainMessages.push(message);
    } else {
      mainMessages.push(message);
    }
  }

  const metrics: SessionMetrics = calculateMetrics(messages);
  const taskCalls: ToolCall[] = getTaskCalls(messages);

  return {
    messages,
    metrics,
    taskCalls,
    byType,
    sidechainMessages,
    mainMessages,
  };
}

function parseRecordTimestamp(timestamp: string | undefined): Date {
  const parsed = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed) : new Date();
}

function codexTokenUsageToUsageMetadata(
  record: Record<string, unknown> | undefined
): TokenUsage | null {
  if (!record) {
    return null;
  }

  const inputTokens = getNumber(record.input_tokens) ?? 0;
  const cachedInputTokens = getNumber(record.cached_input_tokens) ?? 0;
  const outputTokens = getNumber(record.output_tokens) ?? 0;

  if (inputTokens <= 0 && cachedInputTokens <= 0 && outputTokens <= 0) {
    return null;
  }

  return {
    input_tokens: Math.max(inputTokens - cachedInputTokens, 0),
    output_tokens: outputTokens,
    cache_read_input_tokens: cachedInputTokens > 0 ? cachedInputTokens : undefined,
  };
}

function codexContentToTextBlocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const blocks: ContentBlock[] = [];
  for (const item of content) {
    const record = asRecord(item);
    if (!record) continue;
    const type = getString(record.type);
    const text = getString(record.text);
    if ((type === 'output_text' || type === 'text') && text) {
      blocks.push({ type: 'text', text });
    }
  }
  return blocks;
}

function isCodexToolCallResponseType(responseType: string | undefined): boolean {
  if (!responseType || responseType === 'web_search_call') {
    return false;
  }

  return (
    responseType === 'function_call' ||
    responseType === 'custom_tool_call' ||
    responseType.endsWith('_call')
  );
}

function isCodexToolCallOutputResponseType(responseType: string | undefined): boolean {
  return responseType?.endsWith('_call_output') ?? false;
}

function deriveToolNameFromResponseType(responseType: string): string | undefined {
  if (responseType === 'function_call' || responseType === 'custom_tool_call') {
    return undefined;
  }

  return responseType.endsWith('_call') ? responseType.slice(0, -'_call'.length) : undefined;
}

function getCodexCallId(payload: Record<string, unknown>): string | undefined {
  return getString(payload.call_id) ?? getString(payload.id);
}

function parseCodexToolInput(
  responseType: string | undefined,
  name: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  if (responseType === 'custom_tool_call') {
    return parseCustomToolInput(name, payload.input);
  }

  if (payload.arguments !== undefined) {
    return parseFunctionArguments(payload.arguments);
  }

  if (payload.input !== undefined) {
    return parseCustomToolInput(name, payload.input);
  }

  const action = asRecord(payload.action);
  if (action) {
    const query = getString(payload.query) ?? getString(action.query);
    return {
      ...action,
      ...(query ? { query } : {}),
      status: getString(payload.status),
    };
  }

  const input: Record<string, unknown> = {};
  for (const key of ['query', 'status'] as const) {
    const value = payload[key];
    if (value !== undefined) {
      input[key] = value;
    }
  }
  return input;
}

function parseFunctionArguments(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return asRecord(parsed) ?? {};
    } catch {
      return {};
    }
  }

  return asRecord(value) ?? {};
}

function parseCustomToolInput(name: string, value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      const record = asRecord(parsed);
      if (record) {
        return record;
      }
    } catch {
      // Custom tools can use freeform input, e.g. apply_patch patch text.
    }

    return name === 'apply_patch' ? { patch: value } : { input: value };
  }

  return asRecord(value) ?? {};
}

function parseToolCallOutput(value: unknown): ParsedCodexToolOutput {
  if (typeof value !== 'string') {
    const record = asRecord(value);
    if (record) {
      return parseStructuredToolOutput(record);
    }

    return { content: stringifyToolOutput(value) };
  }

  const rawOutput = value;
  if (!rawOutput) {
    return { content: '' };
  }

  try {
    const parsed = JSON.parse(rawOutput) as unknown;
    const record = asRecord(parsed);
    if (record) {
      return parseStructuredToolOutput(record);
    }
  } catch {
    // Regular function_call_output records often contain plain text.
  }

  return { content: rawOutput };
}

function parseStructuredToolOutput(record: Record<string, unknown>): ParsedCodexToolOutput {
  return {
    content: stringifyToolOutput(record.output ?? record.content ?? record.result ?? record),
    metadata: asRecord(record.metadata),
  };
}

function stringifyToolOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return '';
  }

  const json = JSON.stringify(value);
  if (json) {
    return json;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'symbol') {
    return value.description ?? '';
  }

  return '';
}

function buildToolUseResult(
  callId: string,
  callInfo: FunctionCallInfo | undefined,
  execPayload: CodexExecEndPayload | undefined,
  fallbackContent: string | ContentBlock[] | unknown[],
  output?: ParsedCodexToolOutput
): Record<string, unknown> {
  const metadataExitCode = getNumber(output?.metadata?.exit_code);
  const metadataDurationSeconds = getNumber(output?.metadata?.duration_seconds);
  const exitCode = execPayload?.exit_code ?? metadataExitCode;
  const durationMs = execPayload?.duration
    ? (execPayload.duration.secs ?? 0) * 1000 + Math.round((execPayload.duration.nanos ?? 0) / 1e6)
    : metadataDurationSeconds != null
      ? Math.round(metadataDurationSeconds * 1000)
      : undefined;

  const isError = exitCode != null ? exitCode !== 0 : false;

  const content =
    typeof fallbackContent === 'string' ? fallbackContent : JSON.stringify(fallbackContent);

  return {
    toolUseId: callId,
    toolName: callInfo?.name,
    input: callInfo?.input,
    content,
    output: output?.content,
    metadata: output?.metadata,
    stdout: execPayload?.stdout,
    stderr: execPayload?.stderr,
    aggregatedOutput: execPayload?.aggregated_output,
    exitCode,
    command: execPayload?.command,
    cwd: execPayload?.cwd,
    durationMs,
    status: execPayload?.status,
    isError,
  };
}

function buildPatchToolUseResult(
  callId: string,
  callInfo: FunctionCallInfo | undefined,
  patchPayload: CodexPatchApplyEndPayload,
  fallbackContent: string,
  output?: ParsedCodexToolOutput
): Record<string, unknown> {
  const exitCode = getNumber(output?.metadata?.exit_code);
  const durationSeconds = getNumber(output?.metadata?.duration_seconds);
  const durationMs = durationSeconds != null ? Math.round(durationSeconds * 1000) : undefined;
  const isError = patchPayload.success === false || (exitCode != null ? exitCode !== 0 : false);

  return {
    toolUseId: callId,
    toolName: callInfo?.name,
    input: callInfo?.input,
    content: fallbackContent,
    output: output?.content,
    metadata: output?.metadata,
    stdout: patchPayload.stdout,
    stderr: patchPayload.stderr,
    changes: patchPayload.changes,
    status: patchPayload.status,
    success: patchPayload.success,
    exitCode,
    durationMs,
    isError,
  };
}

function getToolResultContent(execPayload: CodexExecEndPayload): string {
  if (
    typeof execPayload.aggregated_output === 'string' &&
    execPayload.aggregated_output.length > 0
  ) {
    return execPayload.aggregated_output;
  }

  const stdout = execPayload.stdout ?? '';
  const stderr = execPayload.stderr ?? '';
  if (stdout || stderr) {
    return stderr ? `${stdout}${stdout ? '\n' : ''}${stderr}` : stdout;
  }

  if (execPayload.exit_code != null) {
    return `Exit code: ${execPayload.exit_code}`;
  }

  return '';
}

function getPatchResultContent(patchPayload: CodexPatchApplyEndPayload): string {
  const stdout = patchPayload.stdout ?? '';
  const stderr = patchPayload.stderr ?? '';
  if (stdout || stderr) {
    return stderr ? `${stdout}${stdout ? '\n' : ''}${stderr}` : stdout;
  }

  if (patchPayload.changes !== undefined) {
    return JSON.stringify(patchPayload.changes);
  }

  if (patchPayload.success !== undefined) {
    return patchPayload.success ? 'Patch applied' : 'Patch failed';
  }

  return patchPayload.status ?? '';
}

function extractSubagentDescription(input: Record<string, unknown>): string | undefined {
  const direct = getString(input.message) ?? getString(input.prompt) ?? getString(input.task);
  if (direct) {
    return direct.substring(0, 160);
  }

  const items = input.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      const record = asRecord(item);
      const text = record ? getString(record.text) : undefined;
      if (text) {
        return text.substring(0, 160);
      }
    }
  }

  return undefined;
}

function extractSubagentType(input: Record<string, unknown>): string | undefined {
  return getString(input.agent_type) ?? getString(input.agentType) ?? getString(input.model);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
