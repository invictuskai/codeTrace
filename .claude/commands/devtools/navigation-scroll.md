---
name: claude-devtools:navigation-scroll
description: Navigation and scroll orchestration — tab navigation, error highlights, search scrolling, auto-scroll coordination, and common bug patterns. Use when working on useTabNavigationController, scroll restore, or navigation requests.
---

# Navigation & Scroll Orchestration

How tab navigation (error highlights, search scrolling, auto-scroll) works end-to-end.

## Architecture

### Navigation Request Model (Nonce-Based)

```typescript
// src/renderer/types/tabs.ts
interface TabNavigationRequest {
  id: string;          // crypto.randomUUID() — fresh nonce per click
  kind: 'error' | 'search' | 'autoBottom';
  highlight: 'red' | 'yellow' | 'none';
  payload: ErrorNavigationPayload | SearchNavigationPayload | {};
  source: 'notification' | 'triggerPreview' | 'commandPalette' | 'sessionOpen';
}

// Stored on Tab:
interface Tab {
  pendingNavigation?: TabNavigationRequest;      // Set by enqueue, cleared by consume
  lastConsumedNavigationId?: string;             // Tracks last processed request
}
```

### Store Actions (tabSlice.ts)

| Action | Purpose |
|--------|---------|
| `enqueueTabNavigation(tabId, request)` | Set `pendingNavigation` on a tab |
| `consumeTabNavigation(tabId, requestId)` | Clear `pendingNavigation`, record `lastConsumedNavigationId` |

### Navigation Sources

| Source | Slice | Creates |
|--------|-------|---------|
| Notification click / test trigger | `notificationSlice.navigateToError()` | `ErrorNavigationRequest` (red) |
| CommandPalette search result | `tabSlice.navigateToSession()` | `SearchNavigationRequest` (yellow) |

### Controller Hook: `useTabNavigationController`

**Location:** `src/renderer/hooks/useTabNavigationController.ts`

Phase state machine:
```
idle → pending → expanding → scrolling → highlighting → complete → idle
```

Key behaviors:
- **Active-tab-only:** Ignores `!isActiveTab` to prevent cross-tab races
- **Nonce dedup:** `activeRequestIdRef.current === pendingNavigation.id` prevents reprocessing
- **Failure debounce:** 500ms cooldown after failed navigation (`lastFailureAtRef`)
- **Abort support:** New navigation aborts in-progress one via `AbortController`
- **Highlight-first:** Highlight is set BEFORE scroll (best-effort scroll, guaranteed highlight)

### Scroll Precedence (ChatHistory.tsx)

Three scroll systems compete — navigation wins:

| System | Guard | Priority |
|--------|-------|----------|
| Navigation scroll | Controller's `executeNavigation` | Highest |
| Scroll restore (tab switch) | `!shouldDisableAutoScroll` | Medium |
| Auto-scroll to bottom | `disabled: shouldDisableAutoScroll` | Lowest |

`shouldDisableAutoScroll` is `true` during ANY navigation phase or when `pendingNavigation` exists.

## Key Files

| File | Role |
|------|------|
| `src/renderer/hooks/useTabNavigationController.ts` | Unified navigation controller |
| `src/renderer/hooks/navigation/utils.ts` | Shared helpers (scroll calc, element lookup, visibility) |
| `src/renderer/components/chat/ChatHistory.tsx` | Scroll restore + auto-scroll coordination |
| `src/renderer/store/slices/tabSlice.ts` | `enqueueTabNavigation`, `consumeTabNavigation`, `navigateToSession` |
| `src/renderer/store/slices/notificationSlice.ts` | `navigateToError` |
| `src/renderer/store/slices/sessionDetailSlice.ts` | `fetchSessionDetail` (sets `conversationLoading`) |
| `src/renderer/types/tabs.ts` | `TabNavigationRequest` types + factory helpers |

## Common Bug Patterns

### 1. Scroll Restore Overrides Navigation

**Symptom:** Scrolls to target, then snaps back to top/previous position.

**Root cause:** The scroll restore effect fires after `consumeTabNavigation` clears `pendingNavigation`. If the guard only checks `!pendingNavigation`, it triggers while navigation highlight is still active.

**Fix pattern:** Guard scroll restore with `!shouldDisableAutoScroll` instead of `!pendingNavigation`. The controller's `shouldDisableAutoScroll` covers the FULL lifecycle (pending → complete), not just while `pendingNavigation` exists.

**Additional:** Save scroll position when `shouldDisableAutoScroll` transitions true→false (navigation completed) to prevent stale `savedScrollTop` from being restored later.

```typescript
// ChatHistory.tsx — scroll restore effect
useEffect(() => {
  const wasDisabled = prevShouldDisableRef.current;
  prevShouldDisableRef.current = shouldDisableAutoScroll;
  // Navigation just completed — save current position, skip restore
  if (wasDisabled && !shouldDisableAutoScroll && scrollContainerRef.current) {
    saveScrollPosition(scrollContainerRef.current.scrollTop);
    return;
  }
  if (isThisTabActive && savedScrollTop !== undefined && !conversationLoading && !shouldDisableAutoScroll) {
    // ... restore logic
  }
}, [isThisTabActive, savedScrollTop, conversationLoading, shouldDisableAutoScroll, saveScrollPosition]);
```

### 2. Redundant `fetchSessionDetail` Unmounts ChatHistory

**Symptom:** Navigation doesn't scroll at all, or session "reloads" unnecessarily.

**Root cause:** `navigateToSession` or `navigateToError` calls `fetchSessionDetail` even when the session is already loaded in an existing tab. This sets `conversationLoading: true`, causing ChatHistory to unmount (show loading spinner) and remount — losing scroll container and controller state.

**Fix pattern:** Only call `fetchSessionDetail` for NEW tabs. For existing tabs, `setActiveTab` already handles the fetch when `sessionChanged` is true.

```typescript
// tabSlice.ts — navigateToSession
if (existingTab) {
  state.setActiveTab(existingTab.id);
  // NO fetchSessionDetail — setActiveTab handles it
} else {
  state.openTab({ ... });
  void state.fetchSessionDetail(projectId, sessionId); // Only for new tabs
}
```

### 3. Highlight Not Showing (Strict Post-Scroll Gates)

**Symptom:** Scrolls to correct location but no red/yellow highlight ring appears.

**Root cause:** `executeErrorNavigation` / `executeSearchNavigation` returns `false` after scroll due to strict gates:
- `userInterrupted` — any accidental wheel/touch event during smooth scroll
- `isElementVisibleInContainer` — element partially off-screen after centering (tall elements)
- Element not found within 600ms timeout

When `success = false`, `executeNavigation` clears all highlight state (`setHighlightedGroupId(null)`).

**Fix pattern:** Set highlight BEFORE scroll attempt. Make scroll best-effort. Always return `true` once target group is found.

```typescript
// In executeErrorNavigation:
// 1. Find target group
// 2. Expand group
// 3. SET HIGHLIGHT HERE (before scroll)
setHighlightedGroupId(targetGroupId);
setIsSearchHighlight(false);
if (toolUseId) setCurrentToolUseId(toolUseId);
// 4. Best-effort scroll (don't gate highlight on scroll outcome)
// 5. Return true (highlight already visible)
```

### 4. Test Trigger Shows No Highlight

**Symptom:** "Test trigger" creates an error with a timestamp that doesn't match any AI group. Navigation scrolls but nothing is highlighted.

**Root cause:** Same as #3. The error timestamp doesn't match, so `findAIGroupByTimestamp` falls back to closest/last group. But post-scroll gates prevent the highlight from being applied.

**Fix:** Same as #3 — highlight-first pattern.

### 5. `conversationLoading` Race During Tab Switch

**Symptom:** Navigation queued on tab, but when switching to that tab, loading state causes ChatHistory unmount. Navigation controller state is lost.

**Root cause:** `fetchSessionDetail` immediately sets `conversationLoading: true`. ChatHistory returns `<ChatHistoryLoadingState />`, unmounting the controller hook.

**Recovery:** The controller is designed to survive remount — when ChatHistory remounts with `pendingNavigation` still set and `conversationLoading: false`, the detection effect starts fresh navigation. BUT scroll restore can race with it (see #1).

## Debugging Checklist

When navigation isn't working:

1. **Check `pendingNavigation` exists on the tab** — is `enqueueTabNavigation` called?
2. **Check `isActiveTab` is true** — controller ignores inactive tabs
3. **Check `conversationLoading`** — if true, controller waits in `pending` phase
4. **Check `conversation` exists** — if null, controller waits
5. **Check timestamp matching** — does `findAIGroupByTimestamp` find the right group?
6. **Check element refs** — are `aiGroupRefs` / `chatItemRefs` populated?
7. **Check `shouldDisableAutoScroll`** — is scroll restore racing with navigation?
8. **Check for double `fetchSessionDetail`** — is ChatHistory unmounting unnecessarily?
9. **Check `phase` progression** — is it stuck in `pending` or failing at `scrolling`?

## Navigation Helper Functions (navigation/utils.ts)

| Function | Purpose |
|----------|---------|
| `findAIGroupByTimestamp(items, timestamp)` | Find AI group containing/closest to timestamp |
| `findChatItemByTimestamp(items, timestamp)` | Find any chat item by timestamp |
| `findAIGroupBySubagentId(items, subagentId)` | Find AI group by subagent ID |
| `calculateCenteredScrollTop(element, container, offset)` | Calculate scroll position to center element |
| `waitForElementStability(element, timeout, stableFrames)` | Wait for element size to stop changing |
| `waitForScrollEnd(container, timeout)` | Wait for smooth scroll to finish |
| `isElementVisibleInContainer(element, container, offset)` | Check if element is in viewport |
| `findCurrentSearchResultInContainer(container)` | Find `[data-search-result="current"]` element |

## Factory Helpers (tabs.ts)

```typescript
createErrorNavigationRequest({ errorId, errorTimestamp, toolUseId, lineNumber })
createSearchNavigationRequest({ query, messageTimestamp, matchedText })
isErrorPayload(request)  // type guard
isSearchPayload(request) // type guard
```

## Tests

Related test files:
- `test/renderer/store/tabSlice.test.ts` — `enqueueTabNavigation` / `consumeTabNavigation`
- `test/renderer/store/notificationSlice.test.ts` — `navigateToError` behavior
- `test/renderer/hooks/navigationUtils.test.ts` — Navigation utility functions
- `test/renderer/hooks/useSearchContextNavigation.test.ts` — Search result finding

Test patterns:
```typescript
// Mock crypto for predictable nonces
vi.stubGlobal('crypto', { randomUUID: () => `test-uuid-${++counter}` });

// Verify navigation request shape
expect(tab.pendingNavigation?.kind).toBe('error');
expect(tab.pendingNavigation?.highlight).toBe('red');

// Verify nonce uniqueness on repeated clicks
store.getState().navigateToError(error);
const firstId = store.getState().openTabs[0].pendingNavigation?.id;
store.getState().navigateToError(error);
const secondId = store.getState().openTabs[0].pendingNavigation?.id;
expect(firstId).not.toBe(secondId);
```
