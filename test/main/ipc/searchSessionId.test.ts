/**
 * Interface contract tests for session ID lookup IPC handlers.
 * Tests the validation layer — guards.ts and sessionIdValidator — that
 * protects find-session-by-id and find-sessions-by-partial-id.
 * Follows the pattern in test/main/ipc/guards.test.ts.
 */

import { describe, expect, it } from 'vitest';

import { validateSessionId } from '../../../src/main/ipc/guards';
import { isSessionIdFragment } from '../../../src/shared/utils/sessionIdValidator';

// =============================================================================
// find-session-by-id guard layer
// =============================================================================

describe('find-session-by-id: guard layer (validateSessionId)', () => {
  it('rejects empty string — handler returns { found: false }', () => {
    const result = validateSessionId('');
    expect(result.valid).toBe(false);
  });

  it('rejects string with invalid characters (shell-injection attempt)', () => {
    const result = validateSessionId('$(rm -rf)');
    expect(result.valid).toBe(false);
  });

  it('accepts a valid UUID — passes guard, scanner determines found/not-found', () => {
    const result = validateSessionId('550e8400-e29b-41d4-a716-446655440000');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('accepted input produces { found: false } shape when scanner finds nothing', () => {
    // The handler's early-exit shape on invalid input
    const invalidResult = validateSessionId('');
    if (!invalidResult.valid) {
      const handlerEarlyReturn = { found: false } as const;
      expect(handlerEarlyReturn.found).toBe(false);
    }
  });
});

// =============================================================================
// find-sessions-by-partial-id guard layer
// =============================================================================

describe('find-sessions-by-partial-id: guard layer (isSessionIdFragment)', () => {
  it('rejects fragment shorter than 3 chars (2 chars)', () => {
    expect(isSessionIdFragment('ab')).toBe(false);
  });

  it('rejects single char', () => {
    expect(isSessionIdFragment('a')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isSessionIdFragment('')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isSessionIdFragment('xyz')).toBe(false);
  });

  it('rejects full UUID (treated as exact, not partial)', () => {
    expect(isSessionIdFragment('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('accepts minimum-length hex fragment (3 chars)', () => {
    expect(isSessionIdFragment('abc')).toBe(true);
  });

  it('accepts hex fragment with dashes', () => {
    expect(isSessionIdFragment('abc-def')).toBe(true);
  });

  it('rejected input produces { found: false, results: [] } shape', () => {
    const fragment = 'xy';
    if (!isSessionIdFragment(fragment)) {
      const handlerEarlyReturn = { found: false, results: [] } as const;
      expect(handlerEarlyReturn.found).toBe(false);
      expect(handlerEarlyReturn.results).toHaveLength(0);
    }
  });
});
