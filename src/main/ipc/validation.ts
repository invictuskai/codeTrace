/**
 * IPC Handlers for Validation Operations.
 *
 * Handlers:
 * - validate-path: Validate if a file/directory path exists relative to project
 * - validate-mentions: Batch validate path mentions (@file references)
 * - session:scrollToLine: Deep link handler for scrolling to a specific line in a session
 */

import { createLogger } from '@shared/utils/logger';
import { type IpcMain, type IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('IPC:validation');

/**
 * Registers all validation-related IPC handlers.
 */
export function registerValidationHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('validate-path', handleValidatePath);
  ipcMain.handle('validate-mentions', handleValidateMentions);
  ipcMain.handle('session:scrollToLine', handleScrollToLine);

  logger.info('Validation handlers registered');
}

/**
 * Removes all validation IPC handlers.
 */
export function removeValidationHandlers(ipcMain: IpcMain): void {
  ipcMain.removeHandler('validate-path');
  ipcMain.removeHandler('validate-mentions');
  ipcMain.removeHandler('session:scrollToLine');

  logger.info('Validation handlers removed');
}

// =============================================================================
// Security Helpers
// =============================================================================

/**
 * Checks if a path is contained within a base directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 */
function isPathContained(fullPath: string, basePath: string): boolean {
  const normalizedFull = path.normalize(fullPath);
  const normalizedBase = path.normalize(basePath);

  // Ensure the full path starts with the base path followed by a separator
  // or is exactly the base path
  return normalizedFull === normalizedBase || normalizedFull.startsWith(normalizedBase + path.sep);
}

// =============================================================================
// Handler Implementations
// =============================================================================

/**
 * Handler for 'validate-path' IPC call.
 * Validates if a file/directory path exists relative to project.
 */
async function handleValidatePath(
  _event: IpcMainInvokeEvent,
  relativePath: string,
  projectPath: string
): Promise<{ exists: boolean; isDirectory?: boolean }> {
  try {
    const fullPath = path.join(projectPath, relativePath);

    // Security: Ensure path doesn't escape project directory
    if (!isPathContained(fullPath, projectPath)) {
      logger.warn('validate-path blocked path traversal attempt:', relativePath);
      return { exists: false };
    }

    if (!fs.existsSync(fullPath)) {
      return { exists: false };
    }

    const stats = fs.statSync(fullPath);
    return {
      exists: true,
      isDirectory: stats.isDirectory(),
    };
  } catch {
    return { exists: false };
  }
}

/**
 * Handler for 'validate-mentions' IPC call.
 * Batch validates path mentions (@file references).
 * Slash commands do not need validation.
 */
async function handleValidateMentions(
  _event: IpcMainInvokeEvent,
  mentions: { type: 'path'; value: string }[],
  projectPath: string
): Promise<Record<string, boolean>> {
  const results = new Map<string, boolean>();

  for (const mention of mentions) {
    const fullPath = path.join(projectPath, mention.value);

    // Security: Skip paths that escape project directory
    if (!isPathContained(fullPath, projectPath)) {
      results.set(`@${mention.value}`, false);
      continue;
    }

    results.set(`@${mention.value}`, fs.existsSync(fullPath));
  }

  return Object.fromEntries(results);
}

/**
 * Handler for 'session:scrollToLine' IPC call.
 * Used for deep linking from notifications to specific lines in a session.
 * The actual scrolling happens in the renderer; this handler validates and returns the data.
 */
async function handleScrollToLine(
  _event: IpcMainInvokeEvent,
  sessionId: string,
  lineNumber: number
): Promise<{ success: boolean; sessionId: string; lineNumber: number }> {
  try {
    if (!sessionId) {
      logger.error('session:scrollToLine called with empty sessionId');
      return { success: false, sessionId: '', lineNumber: 0 };
    }

    if (typeof lineNumber !== 'number' || lineNumber < 0) {
      logger.error('session:scrollToLine called with invalid lineNumber');
      return { success: false, sessionId, lineNumber: 0 };
    }

    return { success: true, sessionId, lineNumber };
  } catch (error) {
    logger.error(`Error in session:scrollToLine:`, error);
    return { success: false, sessionId: '', lineNumber: 0 };
  }
}
