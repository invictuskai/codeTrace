/* eslint-disable security/detect-non-literal-fs-filename -- Tests create temporary fixture files. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { CodexProjectScanner } from '../../../../src/main/services/discovery/CodexProjectScanner';
import { buildCodexProjectId } from '../../../../src/main/utils/codexPaths';

function record(
  type: string,
  payload: Record<string, unknown>,
  timestamp = '2026-04-26T09:00:00.000Z'
): string {
  return JSON.stringify({ timestamp, type, payload });
}

describe('CodexProjectScanner', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
    tempDirs.length = 0;
  });

  it('scans nested Codex rollout files into project and session metadata', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-scanner-'));
    tempDirs.push(tempDir);

    const sessionsDir = path.join(tempDir, 'sessions');
    const nestedDir = path.join(sessionsDir, '2026', '04', '26');
    fs.mkdirSync(nestedDir, { recursive: true });

    const sessionId = '019dc922-1da9-7b40-84cd-9472ae446a60';
    const cwd = 'D:\\llm\\claude-devtools';
    const filePath = path.join(nestedDir, `rollout-2026-04-26T17-32-29-${sessionId}.jsonl`);
    fs.writeFileSync(
      filePath,
      [
        record('session_meta', { id: sessionId, cwd }),
        record('event_msg', { type: 'user_message', message: 'find unfinished tasks' }),
        record('response_item', {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'I found several items.' }],
        }),
      ].join('\n') + '\n',
      'utf8'
    );

    const scanner = new CodexProjectScanner(sessionsDir);
    const projects = await scanner.scan();

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      provider: 'codex',
      id: buildCodexProjectId(cwd),
      path: cwd,
      sessions: [sessionId],
    });

    const sessions = await scanner.listSessions(projects[0].id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      provider: 'codex',
      id: sessionId,
      projectId: buildCodexProjectId(cwd),
      firstMessage: 'find unfinished tasks',
      messageCount: 2,
    });
  });

  it('searches parsed Codex user and assistant text', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-scanner-search-'));
    tempDirs.push(tempDir);

    const sessionsDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const sessionId = '019dc922-1da9-7b40-84cd-9472ae446a60';
    const cwd = 'D:\\llm\\claude-devtools';
    fs.writeFileSync(
      path.join(sessionsDir, `rollout-2026-04-26T17-32-29-${sessionId}.jsonl`),
      [
        record('session_meta', { id: sessionId, cwd }),
        record('event_msg', { type: 'user_message', message: 'alpha question' }),
        record('response_item', {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'alpha answer' }],
        }),
      ].join('\n') + '\n',
      'utf8'
    );

    const scanner = new CodexProjectScanner(sessionsDir);
    const result = await scanner.searchSessions(buildCodexProjectId(cwd), 'alpha', 10);

    expect(result.totalMatches).toBe(2);
    expect(result.results.map((entry) => entry.itemType)).toEqual(
      expect.arrayContaining(['ai', 'user'])
    );
  });
});
