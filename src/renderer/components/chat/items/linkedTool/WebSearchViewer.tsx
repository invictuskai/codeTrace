/**
 * WebSearchViewer
 *
 * Renders Codex `web_search` calls. Codex emits the request as a
 * `web_search_call` response_item with an `action.query` plus optional
 * `queries[]` history; the parser flattens these into the tool input.
 */

import React from 'react';

import {
  CODE_BG,
  CODE_BORDER,
  COLOR_TEXT,
  COLOR_TEXT_MUTED,
} from '@renderer/constants/cssVariables';
import { Search } from 'lucide-react';

import type { LinkedToolItem } from '@renderer/types/groups';

interface WebSearchViewerProps {
  linkedTool: LinkedToolItem;
}

export const WebSearchViewer: React.FC<WebSearchViewerProps> = ({ linkedTool }) => {
  const { primary, history, status } = extractWebSearchData(linkedTool);

  return (
    <div
      className="overflow-hidden rounded"
      style={{
        backgroundColor: CODE_BG,
        border: `1px solid ${CODE_BORDER}`,
      }}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <Search className="mt-0.5 size-4 shrink-0" style={{ color: COLOR_TEXT_MUTED }} />
        <div className="flex-1 space-y-1.5">
          {primary && (
            <div className="font-mono text-sm" style={{ color: COLOR_TEXT }}>
              {primary}
            </div>
          )}
          {history.length > 0 && (
            <ul className="space-y-0.5">
              {history.map((q, idx) => (
                <li
                  key={idx}
                  className="truncate font-mono text-xs"
                  style={{ color: COLOR_TEXT_MUTED }}
                  title={q}
                >
                  {q}
                </li>
              ))}
            </ul>
          )}
          {!primary && history.length === 0 && (
            <div className="text-xs italic" style={{ color: COLOR_TEXT_MUTED }}>
              (no query)
            </div>
          )}
          {status && (
            <div
              className="text-[10px] uppercase tracking-wide"
              style={{ color: COLOR_TEXT_MUTED }}
            >
              {status}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function extractWebSearchData(linkedTool: LinkedToolItem): {
  primary: string | undefined;
  history: string[];
  status: string | undefined;
} {
  const input = linkedTool.input;
  const action = (input.action as Record<string, unknown> | undefined) ?? undefined;

  const primary =
    pickString(input.query) ??
    pickString(action?.query) ??
    (Array.isArray(input.queries) ? pickString(input.queries[0]) : undefined);

  const queriesArr = Array.isArray(input.queries) ? input.queries : [];
  const history = queriesArr
    .map((q) => (typeof q === 'string' ? q : undefined))
    .filter((q): q is string => !!q && q !== primary);

  const status = pickString(input.status) ?? pickString(action?.status);

  return { primary, history, status };
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
