/**
 * PatchToolViewer
 *
 * Renders Codex apply_patch calls from patch_apply_end unified diffs.
 */

import React from 'react';

import { CodeBlockViewer } from '@renderer/components/chat/viewers';
import {
  CODE_BG,
  CODE_BORDER,
  CODE_FILENAME,
  CODE_HEADER_BG,
  CODE_LINE_NUMBER,
  COLOR_TEXT_MUTED,
  COLOR_TEXT_SECONDARY,
  DIFF_ADDED_BG,
  DIFF_ADDED_BORDER,
  DIFF_ADDED_TEXT,
  DIFF_REMOVED_BG,
  DIFF_REMOVED_BORDER,
  DIFF_REMOVED_TEXT,
  TAG_BG,
  TAG_BORDER,
  TAG_TEXT,
} from '@renderer/constants/cssVariables';
import { getBaseName } from '@renderer/utils/pathUtils';
import { FileDiff } from 'lucide-react';

import { type ItemStatus, StatusDot } from '../BaseItem';
import { formatTokens } from '../baseItemHelpers';

import { renderOutput } from './renderHelpers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface PatchToolViewerProps {
  linkedTool: LinkedToolItem;
  status: ItemStatus;
}

interface PatchChange {
  path: string;
  type: string;
  unifiedDiff: string;
  added: number;
  removed: number;
}

type DiffLineTone = 'added' | 'removed' | 'hunk' | 'file' | 'context';

interface DiffLine {
  content: string;
  lineNumber: number;
  tone: DiffLineTone;
}

export const PatchToolViewer: React.FC<PatchToolViewerProps> = ({ linkedTool, status }) => {
  const changes = extractPatchChanges(linkedTool);
  const rawPatch = getString(linkedTool.input.patch);
  const resultOutput = extractPatchResultOutput(linkedTool);

  return (
    <div className="space-y-3">
      {changes.length > 0 ? (
        changes.map((change) => <PatchFileDiff key={change.path} change={change} />)
      ) : rawPatch ? (
        <CodeBlockViewer fileName="apply_patch.patch" content={rawPatch} language="diff" />
      ) : null}

      {!linkedTool.isOrphaned && linkedTool.result != null && (
        <div>
          <div
            className="mb-1 flex items-center gap-2 text-xs"
            style={{ color: 'var(--tool-item-muted)' }}
          >
            Result
            <StatusDot status={status} />
            {linkedTool.result.tokenCount !== undefined && linkedTool.result.tokenCount > 0 && (
              <span style={{ color: 'var(--color-text-muted)' }}>
                ~{formatTokens(linkedTool.result.tokenCount)} tokens
              </span>
            )}
          </div>
          {resultOutput && (
            <div
              className="overflow-auto rounded p-3 font-mono text-xs"
              style={{
                backgroundColor: 'var(--code-bg)',
                border: '1px solid var(--code-border)',
                color:
                  status === 'error'
                    ? 'var(--tool-result-error-text)'
                    : 'var(--color-text-secondary)',
              }}
            >
              {renderOutput(resultOutput)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const PatchFileDiff: React.FC<{ change: PatchChange }> = ({ change }) => {
  const diffLines = parseUnifiedDiff(change.unifiedDiff);
  const displayName = getBaseName(change.path) || change.path;

  return (
    <div
      className="overflow-hidden rounded-lg shadow-sm"
      style={{
        backgroundColor: CODE_BG,
        border: `1px solid ${CODE_BORDER}`,
      }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{
          backgroundColor: CODE_HEADER_BG,
          borderBottom: `1px solid ${CODE_BORDER}`,
        }}
      >
        <FileDiff className="size-4 shrink-0" style={{ color: COLOR_TEXT_MUTED }} />
        <span
          className="truncate font-mono text-sm"
          title={change.path}
          style={{ color: CODE_FILENAME }}
        >
          {displayName}
        </span>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-xs"
          style={{
            backgroundColor: TAG_BG,
            color: TAG_TEXT,
            border: `1px solid ${TAG_BORDER}`,
          }}
        >
          {formatChangeType(change.type)}
        </span>
        <span style={{ color: COLOR_TEXT_MUTED }}>-</span>
        <span className="shrink-0 text-sm">
          {change.added > 0 && (
            <span className="mr-1" style={{ color: DIFF_ADDED_TEXT }}>
              +{change.added}
            </span>
          )}
          {change.removed > 0 && (
            <span style={{ color: DIFF_REMOVED_TEXT }}>-{change.removed}</span>
          )}
          {change.added === 0 && change.removed === 0 && (
            <span style={{ color: COLOR_TEXT_MUTED }}>Changed</span>
          )}
        </span>
      </div>

      <div className="overflow-auto font-mono text-xs">
        <div className="inline-block min-w-full">
          {diffLines.map((line, index) => (
            <PatchDiffLine key={`${index}-${line.content}`} line={line} />
          ))}
          {diffLines.length === 0 && (
            <div className="px-3 py-2 italic" style={{ color: COLOR_TEXT_MUTED }}>
              No unified diff available
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const PatchDiffLine: React.FC<{ line: DiffLine }> = ({ line }) => {
  const style = getDiffLineStyle(line.tone);

  return (
    <div
      className="flex min-w-full"
      style={{
        backgroundColor: style.background,
        borderLeft: `3px solid ${style.border}`,
      }}
    >
      <span
        className="w-10 shrink-0 select-none px-2 text-right"
        style={{ color: CODE_LINE_NUMBER }}
      >
        {line.lineNumber}
      </span>
      <span className="flex-1 whitespace-pre px-2" style={{ color: style.text }}>
        {line.content || ' '}
      </span>
    </div>
  );
};

function extractPatchChanges(linkedTool: LinkedToolItem): PatchChange[] {
  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;
  const changesRecord = asRecord(toolUseResult?.changes);
  if (!changesRecord) {
    return [];
  }

  const changes: PatchChange[] = [];
  for (const [path, value] of Object.entries(changesRecord)) {
    const changeRecord = asRecord(value);
    if (!changeRecord) {
      continue;
    }

    const rawUnifiedDiff =
      getString(changeRecord.unified_diff) ?? getString(changeRecord.unifiedDiff);
    const type = getString(changeRecord.type) ?? 'update';
    const unifiedDiff =
      rawUnifiedDiff ?? buildDiffFromContent(type, getString(changeRecord.content)) ?? '';
    const stats = countUnifiedDiffStats(unifiedDiff);
    changes.push({
      path,
      type,
      unifiedDiff,
      added: stats.added,
      removed: stats.removed,
    });
  }

  return changes;
}

function extractPatchResultOutput(linkedTool: LinkedToolItem): string | null {
  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;
  const stdout = getString(toolUseResult?.stdout);
  const stderr = getString(toolUseResult?.stderr);
  const output = getString(toolUseResult?.output);

  if (stdout || stderr) {
    return stderr ? `${stdout ?? ''}${stdout ? '\n' : ''}${stderr}` : (stdout ?? '');
  }
  if (output) {
    return output;
  }

  const content = linkedTool.result?.content;
  if (typeof content === 'string' && content && !isChangesJson(content)) {
    return content;
  }

  return null;
}

function parseUnifiedDiff(diff: string): DiffLine[] {
  return diff.split('\n').map((content, index) => ({
    content,
    lineNumber: index + 1,
    tone: getDiffLineTone(content),
  }));
}

function buildDiffFromContent(type: string, content: string | undefined): string | undefined {
  if (!content) {
    return undefined;
  }

  const prefix = type === 'delete' ? '-' : type === 'add' ? '+' : ' ';
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function getDiffLineTone(line: string): DiffLineTone {
  if (line.startsWith('@@')) {
    return 'hunk';
  }
  if (line.startsWith('+++') || line.startsWith('---')) {
    return 'file';
  }
  if (line.startsWith('+')) {
    return 'added';
  }
  if (line.startsWith('-')) {
    return 'removed';
  }
  return 'context';
}

function getDiffLineStyle(tone: DiffLineTone): {
  background: string;
  border: string;
  text: string;
} {
  switch (tone) {
    case 'added':
      return {
        background: DIFF_ADDED_BG,
        border: DIFF_ADDED_BORDER,
        text: DIFF_ADDED_TEXT,
      };
    case 'removed':
      return {
        background: DIFF_REMOVED_BG,
        border: DIFF_REMOVED_BORDER,
        text: DIFF_REMOVED_TEXT,
      };
    case 'hunk':
      return {
        background: 'transparent',
        border: TAG_BORDER,
        text: TAG_TEXT,
      };
    case 'file':
      return {
        background: 'transparent',
        border: CODE_BORDER,
        text: COLOR_TEXT_MUTED,
      };
    default:
      return {
        background: 'transparent',
        border: 'transparent',
        text: COLOR_TEXT_SECONDARY,
      };
  }
}

function countUnifiedDiffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed++;
    }
  }

  return { added, removed };
}

function formatChangeType(type: string): string {
  switch (type) {
    case 'add':
      return 'add';
    case 'delete':
      return 'delete';
    default:
      return 'update';
  }
}

function isChangesJson(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as unknown;
    const record = asRecord(parsed);
    if (!record) {
      return false;
    }

    return Object.values(record).some((value) => {
      const changeRecord = asRecord(value);
      return changeRecord != null && getString(changeRecord.unified_diff) != null;
    });
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
