---
name: claude-devtools:markdown-search
description: Markdown search logic — how in-session and cross-session search works. Use when working on SearchBar, search highlighting, searchHighlightUtils, markdownTextSearch, or SessionSearcher.
---

# Markdown Search Logic

How in-session and cross-session markdown search works end-to-end.

## Scope

Current in-session search intentionally covers:

- User message markdown text
- AI `lastOutput` text markdown

Current in-session search intentionally excludes:

- System items
- Tool result text blocks
- Thinking/subagent/internal display items

Primary source files:

- `src/renderer/components/search/SearchBar.tsx`
- `src/renderer/store/slices/conversationSlice.ts`
- `src/renderer/components/chat/ChatHistory.tsx`
- `src/renderer/components/chat/searchHighlightUtils.ts`
- `src/shared/utils/markdownTextSearch.ts`
- `src/main/services/discovery/SessionSearcher.ts`

## Core Data Model

`SearchMatch` (renderer store) in `src/renderer/store/types.ts`:

- `itemId`: chat group id (`user-*`, `ai-*`)
- `itemType`: `user | ai`
- `matchIndexInItem`: 0-based index inside one searchable item
- `globalIndex`: 0-based index across all matches
- `displayItemId`: optional (`lastOutput` for AI output)

Important distinction:

- `matchIndexInItem` is local to one item.
- `currentSearchIndex` is global position in the search result list.

## Pipeline Overview

### 1) Query input and initial match generation

`SearchBar` updates the query with tab-scoped conversation data:

- `setSearchQuery(query, conversation)` in `src/renderer/components/search/SearchBar.tsx`

`setSearchQuery` in `src/renderer/store/slices/conversationSlice.ts`:

- Scans conversation items
- Uses `findMarkdownSearchMatches` (shared parser logic) per searchable item
- Builds initial `searchMatches`, `searchResultCount`, `currentSearchIndex`

### 2) Rendering highlights

Search highlighting is rendered in markdown component trees through:

- `createSearchContext(...)` in `src/renderer/components/chat/searchHighlightUtils.ts`
- `highlightSearchInChildren(...)` in `src/renderer/components/chat/searchHighlightUtils.ts`

Each rendered highlight mark includes:

- `data-search-item-id`
- `data-search-match-index`
- `data-search-result` (`current` or `match`)

### 3) Canonicalization to rendered DOM (critical)

`ChatHistory` collects rendered `<mark>` elements in DOM order and calls:

- `syncSearchMatchesWithRendered(renderedMatches)` in `src/renderer/store/slices/conversationSlice.ts`

Why this exists:

- Real UI navigation must match visible marks exactly.
- Parser results can temporarily differ during render timing.
- DOM order is the final source of truth for nth navigation.

Safety guard:

- `ChatHistory` delays syncing when a transient empty mark snapshot appears, to avoid wiping results mid-render.

### 4) Next/prev navigation and scrolling

`nextSearchResult` / `previousSearchResult` in `src/renderer/store/slices/conversationSlice.ts`:

- Move `currentSearchIndex` with wrap-around

`ChatHistory` scroll effect:

- First tries exact selector:
  - `mark[data-search-item-id="..."][data-search-match-index="..."]`
- If missing, falls back to the global nth rendered mark (same `currentSearchIndex`)
- Final fallback walks text nodes under `[data-search-content]` roots

## Shared Markdown Search Engine

`src/shared/utils/markdownTextSearch.ts` is used by both renderer and main process:

- `findMarkdownSearchMatches`
- `countMarkdownSearchMatches`
- `extractMarkdownPlainText`

Design principle:

- Search parser mirrors markdown render behavior (remark + gfm + HAST traversal)
- Matching is segment-based (no cross-node match)

## Cross-Session Search (Command Palette / IPC)

Main process search path:

- IPC handler: `src/main/ipc/search.ts`
- Engine: `src/main/services/discovery/SessionSearcher.ts`

`SessionSearcher` also uses shared markdown search utils, and returns:

- `groupId`
- `itemType`
- `matchIndexInItem`
- `matchStartOffset`

These are passed into tab navigation context so opening a search result can jump to the exact in-session match.

## Invariants to Keep

When changing markdown/search code, keep these invariants:

1. Parser and renderer must agree on searchable text boundaries.
2. `matchIndexInItem` semantics must stay stable per item.
3. `currentSearchIndex` must represent the global nth visible match.
4. `searchResultCount` must reflect actual rendered match count after canonicalization.
5. Search source scope must be explicit (no accidental inclusion of hidden/internal text).

## If You Add New Searchable Markdown Surfaces

If you make a new markdown surface searchable:

1. Ensure it uses search context + `highlightSearchInChildren`.
2. Ensure emitted marks include `data-search-item-id` and `data-search-match-index`.
3. Ensure the content is included in `setSearchQuery` source scanning.
4. Ensure parser collection logic in `src/shared/utils/markdownTextSearch.ts` still mirrors render behavior.
5. Add/adjust alignment tests.

## Debug Playbook

Enable debug logs:

- `localStorage.setItem('search-debug', '1')`

Useful logs:

- `[search] query` / `[search] sample` from `setSearchQuery`
- `[search] sync-rendered` from DOM canonicalization
- `[search] next` / `[search] prev` navigation logs

Quick checks when behavior is off:

1. Compare `searchResultCount` vs number of rendered marks.
2. Verify `currentSearchIndex` increments exactly once per click.
3. Check whether exact mark selector exists for current match.
4. Confirm the active tab conversation is the same one used for `setSearchQuery`.
5. Confirm virtualization is disabled during active search.

## Tests

Main tests relevant to this logic:

- `test/shared/utils/markdownTextSearch.test.ts`
- `test/shared/utils/markdownSearchRendererAlignment.test.ts`

The alignment test ensures parser match indexes and rendered mark indexes stay identical across representative markdown cases.
