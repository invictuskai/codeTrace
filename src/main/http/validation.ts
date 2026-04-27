/**
 * HTTP route handlers for Validation Operations.
 *
 * Routes:
 * - POST /api/validate/path - Validate file/directory path
 * - POST /api/validate/mentions - Batch validate path mentions
 * - POST /api/session/scroll-to-line - Deep link scroll handler
 */

import { createLogger } from '@shared/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:validation');

/**
 * Checks if a path is contained within a base directory.
 * Prevents path traversal attacks.
 */
function isPathContained(fullPath: string, basePath: string): boolean {
  const normalizedFull = path.normalize(fullPath);
  const normalizedBase = path.normalize(basePath);
  return normalizedFull === normalizedBase || normalizedFull.startsWith(normalizedBase + path.sep);
}

export function registerValidationRoutes(app: FastifyInstance): void {
  // Validate path
  app.post<{ Body: { relativePath: string; projectPath: string } }>(
    '/api/validate/path',
    async (request) => {
      try {
        const { relativePath, projectPath } = request.body;
        const fullPath = path.join(projectPath, relativePath);

        if (!isPathContained(fullPath, projectPath)) {
          logger.warn('validate-path blocked path traversal attempt:', relativePath);
          return { exists: false };
        }

        if (!fs.existsSync(fullPath)) {
          return { exists: false };
        }

        const stats = fs.statSync(fullPath);
        return { exists: true, isDirectory: stats.isDirectory() };
      } catch {
        return { exists: false };
      }
    }
  );

  // Validate mentions
  app.post<{ Body: { mentions: { type: 'path'; value: string }[]; projectPath: string } }>(
    '/api/validate/mentions',
    async (request) => {
      const { mentions, projectPath } = request.body;
      const results = new Map<string, boolean>();

      for (const mention of mentions) {
        const fullPath = path.join(projectPath, mention.value);
        if (!isPathContained(fullPath, projectPath)) {
          results.set(`@${mention.value}`, false);
          continue;
        }
        results.set(`@${mention.value}`, fs.existsSync(fullPath));
      }

      return Object.fromEntries(results);
    }
  );

  // Scroll to line
  app.post<{ Body: { sessionId: string; lineNumber: number } }>(
    '/api/session/scroll-to-line',
    async (request) => {
      try {
        const { sessionId, lineNumber } = request.body;

        if (!sessionId) {
          logger.error('scroll-to-line called with empty sessionId');
          return { success: false, sessionId: '', lineNumber: 0 };
        }

        if (typeof lineNumber !== 'number' || lineNumber < 0) {
          logger.error('scroll-to-line called with invalid lineNumber');
          return { success: false, sessionId, lineNumber: 0 };
        }

        return { success: true, sessionId, lineNumber };
      } catch (error) {
        logger.error('Error in POST /api/session/scroll-to-line:', error);
        return { success: false, sessionId: '', lineNumber: 0 };
      }
    }
  );
}
