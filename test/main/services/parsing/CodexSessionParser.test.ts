/* eslint-disable security/detect-non-literal-fs-filename -- Tests create temporary fixture files. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseCodexSessionFile } from '../../../../src/main/services/parsing/CodexSessionParser';
import { LocalFileSystemProvider } from '../../../../src/main/services/infrastructure/LocalFileSystemProvider';

const fsProvider = new LocalFileSystemProvider();

function line(
  type: string,
  payload: Record<string, unknown>,
  timestamp = '2026-04-26T09:00:00.000Z'
): string {
  return JSON.stringify({ timestamp, type, payload });
}

describe('CodexSessionParser', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
    tempDirs.length = 0;
  });

  it('parses Codex user, assistant, tool call, and tool result records', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parser-'));
    tempDirs.push(tempDir);

    const sessionId = '019dc922-1da9-7b40-84cd-9472ae446a60';
    const filePath = path.join(tempDir, `rollout-2026-04-26T17-32-29-${sessionId}.jsonl`);
    const callId = 'call_shell_1';

    fs.writeFileSync(
      filePath,
      [
        line('session_meta', { id: sessionId, cwd: 'D:\\llm\\claude-devtools' }),
        line('turn_context', { model: 'gpt-5.5', cwd: 'D:\\llm\\claude-devtools' }),
        line('event_msg', { type: 'user_message', message: 'run tests' }),
        line('response_item', {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'I will run the tests.' }],
        }),
        line('response_item', {
          type: 'function_call',
          call_id: callId,
          name: 'shell_command',
          arguments: JSON.stringify({ command: 'pnpm typecheck' }),
        }),
        line('event_msg', {
          type: 'exec_command_end',
          call_id: callId,
          stdout: 'ok',
          stderr: '',
          exit_code: 0,
          status: 'completed',
        }),
        line('response_item', {
          type: 'function_call_output',
          call_id: callId,
          output: 'ok',
        }),
      ].join('\n') + '\n',
      'utf8'
    );

    const parsed = await parseCodexSessionFile(filePath, fsProvider);

    expect(parsed.byType.realUser).toHaveLength(1);
    expect(parsed.byType.realUser[0].content).toBe('run tests');
    expect(parsed.byType.assistant.some((msg) => msg.model === 'gpt-5.5')).toBe(true);

    const toolCallMessage = parsed.messages.find((msg) =>
      msg.toolCalls.some((call) => call.id === callId)
    );
    expect(toolCallMessage?.toolCalls[0]).toMatchObject({
      id: callId,
      name: 'shell_command',
      input: { command: 'pnpm typecheck' },
    });

    const toolResultMessage = parsed.messages.find((msg) => msg.sourceToolUseID === callId);
    expect(toolResultMessage?.toolResults[0]).toMatchObject({
      toolUseId: callId,
      content: 'ok',
      isError: false,
    });
    expect(toolResultMessage?.toolUseResult).toMatchObject({
      toolName: 'shell_command',
      exitCode: 0,
      stdout: 'ok',
    });
  });

  it('preserves apply_patch input and patch_apply_end changes', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parser-patch-'));
    tempDirs.push(tempDir);

    const sessionId = '019dc922-1da9-7b40-84cd-9472ae446a60';
    const filePath = path.join(tempDir, `rollout-2026-04-26T17-32-29-${sessionId}.jsonl`);
    const callId = 'call_patch_1';
    const patch = '*** Begin Patch\n*** Add File: a.txt\n+hello\n*** End Patch\n';

    fs.writeFileSync(
      filePath,
      [
        line('session_meta', { id: sessionId, cwd: 'D:\\llm\\claude-devtools' }),
        line('response_item', {
          type: 'custom_tool_call',
          call_id: callId,
          name: 'apply_patch',
          input: patch,
        }),
        line('event_msg', {
          type: 'patch_apply_end',
          call_id: callId,
          stdout: 'Success. Updated the following files:\nA a.txt\n',
          stderr: '',
          success: true,
          changes: {
            'D:\\llm\\claude-devtools\\a.txt': {
              type: 'add',
              content: 'hello\n',
            },
          },
          status: 'completed',
        }),
        line('response_item', {
          type: 'custom_tool_call_output',
          call_id: callId,
          output: JSON.stringify({
            output: 'Success. Updated the following files:\nA a.txt\n',
            metadata: { exit_code: 0, duration_seconds: 0.1 },
          }),
        }),
      ].join('\n') + '\n',
      'utf8'
    );

    const parsed = await parseCodexSessionFile(filePath, fsProvider);
    const toolCallMessage = parsed.messages.find((msg) =>
      msg.toolCalls.some((call) => call.id === callId)
    );
    const toolResultMessage = parsed.messages.find((msg) => msg.sourceToolUseID === callId);

    expect(toolCallMessage?.toolCalls[0].input).toEqual({ patch });
    expect(toolResultMessage?.toolUseResult).toMatchObject({
      toolName: 'apply_patch',
      success: true,
      exitCode: 0,
      changes: {
        'D:\\llm\\claude-devtools\\a.txt': {
          type: 'add',
          content: 'hello\n',
        },
      },
    });
  });
});
