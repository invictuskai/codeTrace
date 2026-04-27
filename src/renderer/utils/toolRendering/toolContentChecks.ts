/**
 * Tool Content Check Helpers
 *
 * Utilities for checking if tool items have specific types of content.
 */

import type { LinkedToolItem } from '@renderer/types/groups';

/**
 * Checks if a Skill tool has skill instructions.
 */
export function hasSkillInstructions(linkedTool: LinkedToolItem): boolean {
  return !!linkedTool.skillInstructions;
}

/**
 * Checks if a Read tool has content to display.
 */
export function hasReadContent(linkedTool: LinkedToolItem): boolean {
  if (!linkedTool.result) return false;

  const toolUseResult = linkedTool.result.toolUseResult as Record<string, unknown> | undefined;
  const fileData = toolUseResult?.file as { content?: string } | undefined;
  if (fileData?.content) return true;

  if (linkedTool.result.content != null) {
    if (typeof linkedTool.result.content === 'string' && linkedTool.result.content.length > 0)
      return true;
    if (Array.isArray(linkedTool.result.content) && linkedTool.result.content.length > 0)
      return true;
  }

  return false;
}

/**
 * Checks if an Edit tool has content to display.
 */
export function hasEditContent(linkedTool: LinkedToolItem): boolean {
  if (linkedTool.input.old_string != null) return true;

  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;
  if (toolUseResult?.oldString != null || toolUseResult?.newString != null) return true;

  return false;
}

/**
 * Checks if a Codex apply_patch tool has patch or unified diff content to display.
 */
export function hasPatchContent(linkedTool: LinkedToolItem): boolean {
  if (typeof linkedTool.input.patch === 'string' && linkedTool.input.patch.length > 0) {
    return true;
  }

  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;
  return toolUseResult?.changes != null;
}

/**
 * Checks if a Write tool has content to display.
 */
export function hasWriteContent(linkedTool: LinkedToolItem): boolean {
  if (linkedTool.input.content != null || linkedTool.input.file_path != null) return true;

  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;
  if (toolUseResult?.content != null || toolUseResult?.filePath != null) return true;

  return false;
}

/**
 * Checks if a Codex shell_command tool has command/output data to display.
 * Either input.command (raw string from function arguments) or
 * toolUseResult.command (array form recovered from exec_command_end) suffices.
 */
export function hasShellCommandContent(linkedTool: LinkedToolItem): boolean {
  if (typeof linkedTool.input.command === 'string' && linkedTool.input.command.length > 0) {
    return true;
  }

  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;
  return toolUseResult?.command != null;
}

/**
 * Checks if an update_plan tool call carries a plan array.
 */
export function hasUpdatePlanContent(linkedTool: LinkedToolItem): boolean {
  return Array.isArray(linkedTool.input.plan);
}

/**
 * Checks if a web_search tool call carries query data.
 */
export function hasWebSearchContent(linkedTool: LinkedToolItem): boolean {
  if (typeof linkedTool.input.query === 'string' && linkedTool.input.query.length > 0) {
    return true;
  }
  if (Array.isArray(linkedTool.input.queries) && linkedTool.input.queries.length > 0) {
    return true;
  }
  const action = linkedTool.input.action as Record<string, unknown> | undefined;
  return typeof action?.query === 'string' && action.query.length > 0;
}

/**
 * Checks if a view_image tool call carries a path.
 */
export function hasViewImageContent(linkedTool: LinkedToolItem): boolean {
  return typeof linkedTool.input.path === 'string' && linkedTool.input.path.length > 0;
}
