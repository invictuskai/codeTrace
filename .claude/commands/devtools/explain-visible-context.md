---
name: claude-devtools:explain-visible-context
description: Explains what "Visible Context" is — the 6 trackable token categories, what falls outside tracking, how it's displayed, and why it matters. Use when someone asks about visible context, token attribution, or context window usage.
---

Present the following explanation directly to the user. Output the full content below as your response — do not summarize, ask follow-up questions, or treat this as background context.

# Visible Context

## What It Is

"Visible Context" is the portion of Claude's context window that we can identify and measure. Every time Claude processes a turn, its context window fills with various pieces of information — your messages, file contents, tool outputs, thinking, and more. Visible Context tracks what we **can** attribute to a known source, so you can see where your tokens are going.

## What We Track (6 Categories)

### CLAUDE.md Files

Memory files that Claude loads automatically at the start of every session and after each compaction. These include:

- **Global** CLAUDE.md (`~/.claude/CLAUDE.md`) — your personal instructions across all projects
- **Project** CLAUDE.md (`.claude/CLAUDE.md` or `CLAUDE.md` at project root) — project-specific instructions
- **Directory** CLAUDE.md — instructions scoped to subdirectories (e.g., `src/renderer/CLAUDE.md`)

These are injected repeatedly (once per compaction phase), so their token cost accumulates. A 500-token CLAUDE.md file injected across 3 compaction phases costs ~1,500 tokens total.

### @-Mentioned Files

Files you reference with `@path/to/file` in your messages. When you mention a file, Claude Code injects the full file contents into the context. Large files consume significant tokens — a 1,000-line source file could use 5,000+ tokens per mention.

### Tool Outputs

Results returned from tool executions: file reads (`Read`), command output (`Bash`), search results (`Grep`, `Glob`), and others. Every tool result stays in the context window until compaction. A `Bash` command that prints 500 lines of output or a `Read` of a large file both count here.

### Thinking + Text Output

Claude's own output that consumes context:

- **Extended thinking** — Claude's internal reasoning (when thinking mode is active). This can be substantial for complex tasks.
- **Text output** — Claude's visible responses to you. Longer explanations and code blocks use more tokens.

### Task Coordination

Messages and operations from Claude Code's team/orchestration features:

- `SendMessage` — messages between teammates
- `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet` — task management
- `TeamCreate`, `TeamDelete` — team lifecycle

Each coordination message adds to the context window of the receiving agent.

### User Messages

Your actual prompt text for each turn. This includes the raw text you type, but not the system-injected metadata around it.

## What We Don't Track

Visible Context does **not** cover everything in Claude's context window. The following are present but not attributable by our tracking:

- **Claude Code's system prompt** — the base instructions that tell Claude how to behave, use tools, format output, etc.
- **Tool descriptions** — the schema and documentation for each built-in tool (Read, Write, Edit, Bash, Grep, Glob, etc.)
- **MCP tool descriptions** — schemas for any MCP (Model Context Protocol) servers you have connected
- **Custom agent definitions** — instructions from `.claude/agents/` configurations
- **Skill descriptions** — the short descriptions of available skills that Claude sees so it knows what's available (visible via `/context` in Claude Code)
- **Internal system reminders** — `<system-reminder>` injections that Claude Code adds for session state, git status, available skills, etc.
- **Conversation structure overhead** — the message formatting, role markers, and protocol framing around each message

These untracked items form a "base cost" that's always present. You can see what Claude Code injects via the `/context` command in Claude Code itself.

## How It's Displayed

### Per-Turn Popover (Context Badge)

Each AI group in the chat shows a small badge. Hovering reveals what was injected at that specific turn — which CLAUDE.md files, which @-mentioned files, which tool outputs contributed tokens.

### Token Usage Popover

The token count next to each AI group has an info icon. Hovering shows the standard input/output/cache breakdown, plus an expandable "Visible Context" section showing the percentage of total tokens attributable to each tracked category.

### Session Context Panel

A dedicated panel (toggle via the context badge or header button) that shows the full session-wide view:

- All tracked injections grouped by category
- Token estimates per injection
- Phase filtering (if compaction events split the session into phases)
- Total visible context as a percentage of total session tokens

## Compaction Phases

When Claude's context window fills up, Claude Code compacts the conversation — summarizing older messages to free space. Each compaction creates a new "phase." Visible Context tracks injections per phase because:

- CLAUDE.md files are re-injected after each compaction
- Previous tool outputs and file contents are summarized away
- The phase selector lets you see what's in context **right now** (current phase) vs. what was present earlier

## Why Visible Context Matters

Understanding where tokens go helps you:

- **Spot expensive injections** — a massive CLAUDE.md file or a frequently-mentioned large file could be using 20%+ of your context
- **Optimize CLAUDE.md** — keep memory files concise; every token is repeated across phases
- **Be strategic with @-mentions** — mentioning a 2,000-line file costs real context space
- **Understand compaction impact** — see how much context resets after compaction
- **Debug unexpected behavior** — if Claude seems to "forget" something, check whether it was compacted away
