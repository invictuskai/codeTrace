---
name: claude-devtools:chatgroup-architecture
description: ChatGroup architecture — how conversation data flows from raw JSONL to rendered chat groups. Use when working on UserGroup, AIGroup, SystemGroup, display items, tool linking, chunks, or the rendering hierarchy.
---

# ChatGroup Architecture

How conversation data flows from raw JSONL messages to rendered chat groups.

## Core Design Principle

Chat groups are **independent items in a flat chronological list**, not paired turns.
There is no UserTurn/AITurn pairing — each group stands alone.

```typescript
// src/renderer/types/groups.ts
export type ChatItem =
  | { type: 'user'; group: UserGroup }
  | { type: 'system'; group: SystemGroup }
  | { type: 'ai'; group: AIGroup }
  | { type: 'compact'; group: CompactGroup };

export interface SessionConversation {
  sessionId: string;
  items: ChatItem[];  // Flat chronological list
  totalUserGroups: number;
  totalSystemGroups: number;
  totalAIGroups: number;
  totalCompactGroups: number;
}
```

## Pipeline Overview

```
Raw JSONL messages
  → MessageClassifier (classify into user/system/ai/hardNoise)
  → ChunkBuilder (buffer AI messages, flush on user/system boundary)
  → ChunkFactory (build EnhancedAIChunk with SemanticSteps)
  → groupTransformer (chunks → flat ChatItem[] conversation)
  → aiGroupEnhancer (AIGroup → EnhancedAIGroup with displayItems, linkedTools, lastOutput)
  → React components render
```

Primary source files:

- `src/main/services/parsing/MessageClassifier.ts`
- `src/main/services/analysis/ChunkBuilder.ts`
- `src/main/services/analysis/ChunkFactory.ts`
- `src/renderer/utils/groupTransformer.ts`
- `src/renderer/utils/aiGroupEnhancer.ts`
- `src/renderer/utils/displayItemBuilder.ts`
- `src/renderer/types/groups.ts`
- `src/main/types/chunks.ts`

## Data Models

### UserGroup

```typescript
// src/renderer/types/groups.ts
interface UserGroup {
  id: string;
  message: ParsedMessage;
  timestamp: Date;
  content: UserGroupContent;
  index: number;  // Ordering index within session
}

interface UserGroupContent {
  text?: string;                 // Plain text (commands removed)
  rawText?: string;              // Original text
  commands: CommandInfo[];       // Extracted /commands
  images: ImageData[];           // Attached images
  fileReferences: FileReference[]; // @file.ts mentions
}
```

Renders right-aligned blue bubble. Contains markdown text, slash commands, images, and file references.

### AIGroup

```typescript
interface AIGroup {
  id: string;
  turnIndex: number;             // 0-based (for turn navigation)
  startTime: Date;
  endTime: Date;
  durationMs: number;
  steps: SemanticStep[];         // Core semantic steps
  tokens: AIGroupTokens;
  summary: AIGroupSummary;       // For collapsed view
  status: AIGroupStatus;         // 'complete' | 'interrupted' | 'error' | 'in_progress'
  processes: Process[];          // Subagent processes
  chunkId: string;
  metrics: SessionMetrics;
  responses: ParsedMessage[];    // All assistant + internal messages
  isOngoing?: boolean;           // True for last group in ongoing session
}
```

### EnhancedAIGroup

The renderer enhances `AIGroup` before rendering:

```typescript
interface EnhancedAIGroup extends AIGroup {
  lastOutput: AIGroupLastOutput | null;      // Always-visible output
  displayItems: AIGroupDisplayItem[];        // Flattened chronological items
  linkedTools: Map<string, LinkedToolItem>;  // Tool call/result pairs
  itemsSummary: string;                      // "2 thinking, 4 tool calls, 3 subagents"
  mainModel: ModelInfo | null;
  subagentModels: ModelInfo[];
  claudeMdStats: ClaudeMdStats | null;
}
```

Enhancement happens in `src/renderer/utils/aiGroupEnhancer.ts`:

1. `findLastOutput` — extracts the final visible output (text, tool result, interruption, plan exit, ongoing)
2. `linkToolCallsToResults` — pairs tool calls with their results into `LinkedToolItem`
3. `buildDisplayItems` — flattens steps into chronological `AIGroupDisplayItem[]`
4. `buildSummary` — generates human-readable summary string
5. `extractMainModel` / `extractSubagentModels` — extracts model info

### AIGroupDisplayItem

```typescript
type AIGroupDisplayItem =
  | { type: 'thinking'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'tool'; tool: LinkedToolItem }
  | { type: 'subagent'; subagent: Process }
  | { type: 'output'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'slash'; slash: SlashItem }
  | { type: 'teammate_message'; teammateMessage: TeammateMessage };
```

Display items are sorted chronologically in `src/renderer/utils/displayItemBuilder.ts`.

### LinkedToolItem

```typescript
interface LinkedToolItem {
  id: string;
  name: string;
  input: Record<string, unknown>;
  callTokens?: number;
  result?: {
    content: string | unknown[];
    isError: boolean;
    toolUseResult?: ToolUseResultData;
    tokenCount?: number;
  };
  inputPreview: string;          // First 100 chars
  outputPreview?: string;        // First 200 chars
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  isOrphaned: boolean;           // No result received
  sourceModel?: string;
  skillInstructions?: string;    // For Skill tool calls
  skillInstructionsTokenCount?: number;
}
```

### AIGroupLastOutput

Always-visible output below the AI group header:

```typescript
interface AIGroupLastOutput {
  type: 'text' | 'tool_result' | 'interruption' | 'ongoing' | 'plan_exit';
  text?: string;
  toolName?: string;
  toolResult?: string;
  isError?: boolean;
  interruptionMessage?: string;
  planContent?: string;
  planPreamble?: string;
  timestamp: Date;
}
```

### SystemGroup

```typescript
interface SystemGroup {
  id: string;
  message: ParsedMessage;
  timestamp: Date;
  commandOutput: string;
  commandName?: string;
}
```

Renders left-aligned with neutral gray styling. Monospace pre with ANSI escape codes cleaned.

### CompactGroup

```typescript
interface CompactGroup {
  id: string;
  timestamp: Date;
  message: ParsedMessage;
  tokenDelta?: CompactionTokenDelta;
  startingPhaseNumber?: number;
}
```

Visual boundary for context compaction events.

## Backend: Chunk Building

### Message Classification

`src/main/services/parsing/MessageClassifier.ts` classifies raw messages into 4 categories:

| Category | Description | Result |
|----------|-------------|--------|
| `user` | Genuine user input | Creates UserChunk, renders right |
| `system` | Command output | Creates SystemChunk, renders left |
| `ai` | Assistant responses | Buffered into AIChunk, renders left |
| `hardNoise` | System metadata, caveats, reminders | Filtered out entirely |

### Chunk Building

`src/main/services/analysis/ChunkBuilder.ts` buffers AI messages and flushes on boundaries:

```
for each classified message:
  hardNoise → skip
  compact   → flush AI buffer, emit CompactChunk
  user      → flush AI buffer, emit UserChunk
  system    → flush AI buffer, emit SystemChunk
  ai        → add to AI buffer
```

AI buffer is flushed when a non-AI message arrives, producing one `AIChunk` per contiguous run of assistant messages.

### Semantic Step Extraction

`src/main/services/analysis/ChunkFactory.ts` enriches AI chunks:

1. Build tool executions from message content blocks
2. Collect sidechain messages within the time range
3. Link subagent processes to the chunk
4. Extract semantic steps (`SemanticStep[]`)
5. Fill timeline gaps
6. Calculate step context accumulation
7. Build step groups

```typescript
type SemanticStepType = 'thinking' | 'tool_call' | 'tool_result' | 'subagent' | 'output' | 'interruption';

interface SemanticStep {
  id: string;
  type: SemanticStepType;
  startTime: Date;
  endTime?: Date;
  durationMs: number;
  content: { /* type-specific fields */ };
  tokens?: { input: number; output: number; cached?: number };
  context: 'main' | 'subagent';
}
```

## Rendering

### Component Hierarchy

```
ChatHistory
  └─ ChatHistoryItem (router)
       ├─ UserChatGroup      → right-aligned blue bubble
       ├─ SystemChatGroup    → left-aligned gray block
       ├─ AIChatGroup        → left-aligned, collapsible
       │    ├─ Header (model, summary, tokens, duration, timestamp)
       │    ├─ DisplayItemList (when expanded)
       │    │    ├─ ThinkingItem
       │    │    ├─ LinkedToolItem (Read, Edit, Write, Skill, etc.)
       │    │    ├─ SubagentItem (with nested trace)
       │    │    ├─ TextItem
       │    │    ├─ SlashItem
       │    │    └─ TeammateMessageItem
       │    └─ LastOutputDisplay (always visible)
       └─ CompactBoundary
```

Primary render files:

- `src/renderer/components/chat/ChatHistory.tsx`
- `src/renderer/components/chat/ChatHistoryItem.tsx`
- `src/renderer/components/chat/UserChatGroup.tsx`
- `src/renderer/components/chat/SystemChatGroup.tsx`
- `src/renderer/components/chat/AIChatGroup.tsx`
- `src/renderer/components/chat/DisplayItemList.tsx`
- `src/renderer/components/chat/LastOutputDisplay.tsx`

### AI Group: Collapsed vs Expanded

**Collapsed** (default):
- Header: Bot icon, "Claude", model badge, items summary, chevron
- Right side: context badge, token usage, duration, timestamp
- Last output (always visible below header)

**Expanded**:
- All collapsed content, plus:
- `DisplayItemList` with chronologically ordered items
- Each display item can be individually expanded (nested expansion)

### Last Output Rendering

Always visible regardless of expansion state. Renders based on `type`:

| Type | Rendering |
|------|-----------|
| `text` | Markdown in code-bg rounded block |
| `tool_result` | Tool name + pre-formatted result |
| `interruption` | Warning banner with AlertTriangle |
| `plan_exit` | Plan preamble + plan content in special block |
| `ongoing` | Ongoing session banner (last AI group only) |

## Per-Tab UI State Isolation

Each tab maintains **completely independent** expansion state via `tabUISlice.ts`:

```typescript
interface TabUIState {
  expandedAIGroupIds: Set<string>;
  expandedDisplayItemIds: Map<string, Set<string>>;
  expandedSubagentTraceIds: Set<string>;
  showContextPanel: boolean;
  selectedContextPhase: number | null;
  savedScrollTop?: number;
}
```

Accessed via `useTabUI()` hook which reads `tabId` from `TabUIContext`:

```typescript
// src/renderer/hooks/useTabUI.tsx
const { isAIGroupExpanded, toggleAIGroupExpansion, expandAIGroup,
        getExpandedDisplayItemIds, toggleDisplayItemExpansion,
        isSubagentTraceExpanded, toggleSubagentTraceExpansion } = useTabUI();
```

Auto-expansion triggers:
- Error deep linking (contains highlighted error tool)
- Search results (contains search match)

## Store Integration

### Session Detail Slice

`src/renderer/store/slices/sessionDetailSlice.ts` manages the fetch pipeline:

```
fetchSessionDetail(projectId, sessionId, tabId?)
  → IPC: getSessionDetail (returns chunks + processes)
  → transformChunksToConversation (chunks → ChatItem[])
  → processSessionClaudeMd (compute CLAUDE.md stats)
  → processSessionContextWithPhases (compute context stats)
  → store in global state + per-tab tabSessionData
```

Key state:

| Field | Purpose |
|-------|---------|
| `sessionDetail` | Raw session data from main process |
| `conversation` | Transformed `SessionConversation` |
| `conversationLoading` | True during fetch (causes ChatHistory unmount) |
| `tabSessionData` | Per-tab copies of session data |
| `sessionClaudeMdStats` | CLAUDE.md injection stats per AI group |
| `sessionContextStats` | Context stats per AI group |
| `sessionPhaseInfo` | Phase boundary info |

### Real-Time Updates

`refreshSessionInPlace` re-fetches and transforms without setting `conversationLoading: true`, avoiding ChatHistory unmount/remount flicker.

## Invariants

1. Chat items are always flat and chronological — no nesting at the conversation level.
2. AI groups are self-contained — all semantic steps, tool links, and display items are computed per group.
3. Display items within an AI group are chronologically sorted.
4. Per-tab UI state is fully isolated — expanding a group in one tab doesn't affect another.
5. Last output is always visible regardless of AI group expansion state.
6. `conversationLoading: true` unmounts ChatHistory — avoid setting it unnecessarily for existing tabs.
