/**
 * CodexShellViewer
 *
 * Renders Codex `shell_command` calls. Displays the requested command (with
 * shell-wrapper unwrapping for PowerShell/bash), cwd, exit code and duration,
 * plus separated stdout/stderr panes recovered from the matching
 * `exec_command_end` event.
 */

import React from 'react';

import {
  CODE_BG,
  CODE_BORDER,
  CODE_HEADER_BG,
  COLOR_TEXT,
  COLOR_TEXT_MUTED,
  COLOR_TEXT_SECONDARY,
  TAG_BG,
  TAG_BORDER,
  TAG_TEXT,
} from '@renderer/constants/cssVariables';
import { Terminal } from 'lucide-react';

import { type ItemStatus } from '../BaseItem';
import { formatDuration } from '../baseItemHelpers';

import { CollapsibleOutputSection } from './CollapsibleOutputSection';

import type { LinkedToolItem } from '@renderer/types/groups';

interface CodexShellViewerProps {
  linkedTool: LinkedToolItem;
  status: ItemStatus;
}

interface ShellResultData {
  command: string;
  cwd?: string;
  stdout?: string;
  stderr?: string;
  aggregatedOutput?: string;
  exitCode?: number;
  durationMs?: number;
  status?: string;
}

const ERROR_TEXT = 'var(--tool-result-error-text)';

export const CodexShellViewer: React.FC<CodexShellViewerProps> = ({ linkedTool, status }) => {
  const data = extractShellResult(linkedTool);
  const isError = data.exitCode != null && data.exitCode !== 0;

  return (
    <div className="space-y-3">
      <ShellCommandBlock command={data.command} cwd={data.cwd} />

      <ShellMetaRow
        exitCode={data.exitCode}
        durationMs={data.durationMs}
        status={data.status}
        isError={isError}
      />

      <ShellOutputPanes data={data} viewerStatus={status} isError={isError} />
    </div>
  );
};

const ShellCommandBlock: React.FC<{ command: string; cwd?: string }> = ({ command, cwd }) => (
  <div
    className="overflow-hidden rounded-lg"
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
      <Terminal className="size-4 shrink-0" style={{ color: COLOR_TEXT_MUTED }} />
      <span className="text-xs font-medium" style={{ color: COLOR_TEXT_SECONDARY }}>
        shell
      </span>
      {cwd && (
        <span
          className="ml-auto truncate font-mono text-xs"
          title={cwd}
          style={{ color: COLOR_TEXT_MUTED }}
        >
          {cwd}
        </span>
      )}
    </div>
    <pre
      className="overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-xs"
      style={{ color: COLOR_TEXT }}
    >
      <span style={{ color: COLOR_TEXT_MUTED }}>$ </span>
      {command}
    </pre>
  </div>
);

const ShellMetaRow: React.FC<{
  exitCode?: number;
  durationMs?: number;
  status?: string;
  isError: boolean;
}> = ({ exitCode, durationMs, status, isError }) => {
  const items: React.ReactNode[] = [];

  if (exitCode != null) {
    items.push(<Pill key="exit" label={`exit ${exitCode}`} tone={isError ? 'error' : 'ok'} />);
  }
  if (durationMs != null) {
    items.push(<Pill key="dur" label={formatDuration(durationMs)} tone="muted" />);
  }
  if (status && status !== 'completed') {
    items.push(<Pill key="status" label={status} tone="muted" />);
  }

  if (items.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-1.5">{items}</div>;
};

const Pill: React.FC<{ label: string; tone: 'ok' | 'error' | 'muted' }> = ({ label, tone }) => {
  const palette =
    tone === 'error'
      ? { bg: 'rgba(239, 68, 68, 0.12)', text: '#ef4444', border: 'rgba(239, 68, 68, 0.35)' }
      : tone === 'ok'
        ? { bg: 'rgba(34, 197, 94, 0.12)', text: '#22c55e', border: 'rgba(34, 197, 94, 0.35)' }
        : { bg: TAG_BG, text: TAG_TEXT, border: TAG_BORDER };
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-[10px]"
      style={{
        backgroundColor: palette.bg,
        color: palette.text,
        border: `1px solid ${palette.border}`,
      }}
    >
      {label}
    </span>
  );
};

const ShellOutputPanes: React.FC<{
  data: ShellResultData;
  viewerStatus: ItemStatus;
  isError: boolean;
}> = ({ data, viewerStatus, isError }) => {
  const stdout = data.stdout?.trim() ?? '';
  const stderr = data.stderr?.trim() ?? '';
  const aggregated = data.aggregatedOutput?.trim() ?? '';

  // Prefer separated stdout/stderr when at least one is non-empty AND they
  // disagree with the aggregated string (i.e. tool already split the streams).
  const hasSeparated = stdout.length > 0 || stderr.length > 0;
  const useSeparated =
    hasSeparated &&
    (aggregated.length === 0 || aggregated !== `${stdout}${stdout && stderr ? '\n' : ''}${stderr}`);

  if (useSeparated) {
    return (
      <>
        {stdout.length > 0 && (
          <CollapsibleOutputSection status={viewerStatus} label="stdout">
            <pre className="whitespace-pre-wrap break-all" style={{ color: COLOR_TEXT }}>
              {stdout}
            </pre>
          </CollapsibleOutputSection>
        )}
        {stderr.length > 0 && (
          <CollapsibleOutputSection status={isError ? 'error' : viewerStatus} label="stderr">
            <pre
              className="whitespace-pre-wrap break-all"
              style={{ color: isError ? ERROR_TEXT : COLOR_TEXT }}
            >
              {stderr}
            </pre>
          </CollapsibleOutputSection>
        )}
      </>
    );
  }

  const body = aggregated || stdout || stderr;
  if (body.length === 0) return null;
  return (
    <CollapsibleOutputSection status={viewerStatus} label="output">
      <pre
        className="whitespace-pre-wrap break-all"
        style={{ color: isError ? ERROR_TEXT : COLOR_TEXT }}
      >
        {body}
      </pre>
    </CollapsibleOutputSection>
  );
};

// =============================================================================
// Data extraction
// =============================================================================

function extractShellResult(linkedTool: LinkedToolItem): ShellResultData {
  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;

  const command = pickCommand(linkedTool.input.command, toolUseResult?.command);
  const cwd = getString(linkedTool.input.workdir) ?? getString(toolUseResult?.cwd);

  return {
    command,
    cwd,
    stdout: getString(toolUseResult?.stdout),
    stderr: getString(toolUseResult?.stderr),
    aggregatedOutput: getString(toolUseResult?.aggregatedOutput),
    exitCode: getNumber(toolUseResult?.exitCode),
    durationMs: getNumber(toolUseResult?.durationMs),
    status: getString(toolUseResult?.status),
  };
}

function pickCommand(inputCommand: unknown, resultCommand: unknown): string {
  // Result-side command from exec_command_end is an array such as
  // ["powershell.exe", "-Command", "<actual>"]; unwrap it for readability.
  const unwrapped = unwrapShellCommand(resultCommand);
  if (unwrapped) return unwrapped;

  if (typeof inputCommand === 'string' && inputCommand.length > 0) return inputCommand;
  if (Array.isArray(inputCommand)) {
    const fromInput = unwrapShellCommandArray(inputCommand);
    if (fromInput) return fromInput;
  }
  return '(no command)';
}

function unwrapShellCommand(value: unknown): string | undefined {
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (Array.isArray(value)) return unwrapShellCommandArray(value);
  return undefined;
}

const SHELL_WRAPPER_FLAGS = new Set(['-Command', '-c', '/c', '-EncodedCommand', '--command']);

function unwrapShellCommandArray(parts: unknown[]): string | undefined {
  if (parts.length === 0) return undefined;

  const head = (typeof parts[0] === 'string' ? parts[0] : '').toLowerCase();
  const looksLikeShell =
    head.endsWith('powershell.exe') ||
    head.endsWith('powershell') ||
    head.endsWith('pwsh') ||
    head.endsWith('pwsh.exe') ||
    head.endsWith('cmd.exe') ||
    head.endsWith('bash') ||
    head.endsWith('sh') ||
    head.endsWith('zsh');

  if (looksLikeShell) {
    const flagIdx = parts.findIndex(
      (part) => typeof part === 'string' && SHELL_WRAPPER_FLAGS.has(part)
    );
    if (flagIdx >= 0 && flagIdx + 1 < parts.length) {
      const tail = parts
        .slice(flagIdx + 1)
        .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
        .join(' ');
      if (tail.length > 0) return tail;
    }
  }

  // Fallback: join the array as-is.
  return parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ');
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
