/**
 * ViewImageViewer
 *
 * Renders Codex `view_image` calls. The tool input typically carries a
 * `path` to an image on the local filesystem. We surface the path with a
 * copy/open affordance plus an inline preview when the path can be loaded
 * via the file:// protocol.
 */

import React, { useCallback, useState } from 'react';

import { CopyablePath } from '@renderer/components/common/CopyablePath';
import {
  CODE_BG,
  CODE_BORDER,
  CODE_HEADER_BG,
  COLOR_TEXT_MUTED,
  COLOR_TEXT_SECONDARY,
} from '@renderer/constants/cssVariables';
import { getBaseName } from '@renderer/utils/pathUtils';
import { ImageIcon, ImageOff } from 'lucide-react';

import type { LinkedToolItem } from '@renderer/types/groups';

interface ViewImageViewerProps {
  linkedTool: LinkedToolItem;
}

export const ViewImageViewer: React.FC<ViewImageViewerProps> = ({ linkedTool }) => {
  const path = typeof linkedTool.input.path === 'string' ? linkedTool.input.path : '';
  const [imageError, setImageError] = useState(false);

  const handleOpen = useCallback(() => {
    if (!path) return;
    void window.electronAPI.openPath(path);
  }, [path]);

  if (!path) {
    return (
      <div className="text-xs italic" style={{ color: COLOR_TEXT_MUTED }}>
        (no path)
      </div>
    );
  }

  const fileUrl = toFileUrl(path);
  const displayName = getBaseName(path) || path;

  return (
    <div
      className="overflow-hidden rounded"
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
        <ImageIcon className="size-4 shrink-0" style={{ color: COLOR_TEXT_MUTED }} />
        <CopyablePath
          displayText={displayName}
          copyText={path}
          className="text-sm"
          style={{ color: COLOR_TEXT_SECONDARY }}
        />
        <button
          type="button"
          onClick={handleOpen}
          className="ml-auto rounded px-2 py-0.5 text-xs hover:underline"
          style={{ color: COLOR_TEXT_MUTED, background: 'none', border: 'none' }}
        >
          Open
        </button>
      </div>
      <div className="flex items-center justify-center p-3">
        {imageError ? (
          <div
            className="flex items-center gap-2 text-xs italic"
            style={{ color: COLOR_TEXT_MUTED }}
          >
            <ImageOff className="size-4" />
            Preview unavailable
          </div>
        ) : (
          <img
            src={fileUrl}
            alt={displayName}
            onError={() => setImageError(true)}
            className="max-h-80 max-w-full object-contain"
            style={{ borderRadius: 4 }}
          />
        )}
      </div>
    </div>
  );
};

function toFileUrl(rawPath: string): string {
  // Normalize Windows-style paths to file:// URLs the renderer can load.
  const normalized = rawPath.replace(/\\/g, '/');
  if (normalized.startsWith('file://')) return normalized;
  if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${normalized}`;
  if (normalized.startsWith('/')) return `file://${normalized}`;
  return `file:///${normalized}`;
}
