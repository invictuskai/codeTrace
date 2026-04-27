---
name: claude-devtools:design-system
description: Design system and visual language — theming, CSS variables, Tailwind config, component styling patterns, icon usage, animations, and z-index layers. Use when creating or modifying UI components, working with the dark/light theme, or debugging visual issues.
---

# Design System & Visual Language

How the theming, color palette, component patterns, and styling conventions work.

## Theme Architecture

Two themes (dark/light) driven by CSS custom properties in `src/renderer/index.css`.
Toggled via `useTheme()` hook which adds/removes `light` class on `document.documentElement`.

Flash prevention: a script in `index.html` applies the cached theme before React loads.

### Theme Hook

```typescript
// src/renderer/hooks/useTheme.ts
const { theme, resolvedTheme, isDark, isLight } = useTheme();
// theme: 'dark' | 'light' | 'system'
// resolvedTheme: 'dark' | 'light' (after system resolution)
```

## Styling Convention

**Colors**: Always via CSS variables (theme-aware). Use inline `style` or Tailwind classes mapped to variables.
**Layout/spacing**: Tailwind utility classes.
**Icons**: `lucide-react` with `size-*` Tailwind classes.

```tsx
// Preferred: inline style for theme-aware colors, Tailwind for layout
<div className="flex items-center gap-2 rounded-md px-3 py-2"
     style={{ backgroundColor: 'var(--color-surface-raised)', color: 'var(--color-text)' }}>
  <Bot className="size-4 shrink-0" style={{ color: COLOR_TEXT_SECONDARY }} />
</div>

// Also valid: Tailwind classes that reference CSS variables
<div className="bg-surface text-text border-border">
<div className="bg-surface-raised text-text-secondary">
```

### TypeScript Constants

`src/renderer/constants/cssVariables.ts` centralizes CSS variable strings:

```typescript
import { COLOR_TEXT_MUTED, CARD_BG, CARD_BORDER_STYLE } from '@renderer/constants/cssVariables';

<span style={{ color: COLOR_TEXT_MUTED }}>Muted text</span>
<div style={{ backgroundColor: CARD_BG, border: CARD_BORDER_STYLE }}>Card</div>
```

Constants cover: text colors, surfaces, borders, code blocks, diff, cards, tags, prose.

## CSS Variable Reference

All defined in `src/renderer/index.css` under `:root` (dark) and `:root.light`.

### Surfaces

| Variable | Dark | Light | Usage |
|----------|------|-------|-------|
| `--color-surface` | `#141416` | `#f9f9f7` | Main background |
| `--color-surface-raised` | `#27272a` | `#f0efed` | Elevated surfaces |
| `--color-surface-overlay` | `#27272a` | `#e8e7e4` | Overlays/modals |
| `--color-surface-sidebar` | `#0f0f11` | `#f1f0ee` | Sidebar background |

### Text

| Variable | Dark | Light | Usage |
|----------|------|-------|-------|
| `--color-text` | `#fafafa` | `#1c1b19` | Primary text |
| `--color-text-secondary` | `#a1a1aa` | `#4d4b46` | Secondary text |
| `--color-text-muted` | `#71717a` | `#6d6b65` | Muted text |

### Borders

| Variable | Dark | Light |
|----------|------|-------|
| `--color-border` | `rgba(255,255,255,0.05)` | `#d5d3cf` |
| `--color-border-subtle` | `rgba(255,255,255,0.05)` | `#e3e1dd` |
| `--color-border-emphasis` | `rgba(255,255,255,0.1)` | `#a8a5a0` |

### Chat Bubbles

**User bubble** (right-aligned):
| Variable | Dark | Light |
|----------|------|-------|
| `--chat-user-bg` | `#27272a` | `#eae9e6` |
| `--chat-user-text` | `#a1a1aa` | `#5a5955` |
| `--chat-user-border` | `rgba(255,255,255,0.08)` | `#d5d3cf` |
| `--chat-user-shadow` | `0 1px 0 0 rgba(255,255,255,0.03)` | `0 1px 2px 0 rgba(0,0,0,0.04)` |
| `--chat-user-tag-bg` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.05)` |
| `--chat-user-tag-text` | `#e4e4e7` | `#3a3935` |
| `--chat-user-tag-border` | `rgba(255,255,255,0.12)` | `rgba(0,0,0,0.08)` |

**AI message**:
| Variable | Dark | Light |
|----------|------|-------|
| `--chat-ai-border` | `rgba(255,255,255,0.05)` | `#d5d3cf` |
| `--chat-ai-icon` | `#71717a` | `#6d6b65` |

**System bubble**:
| Variable | Dark | Light |
|----------|------|-------|
| `--chat-system-bg` | `rgba(39,39,42,0.5)` | `#eae9e6` |
| `--chat-system-text` | `#d4d4d8` | `#3a3935` |

### Code & Syntax

| Variable | Dark | Light |
|----------|------|-------|
| `--code-bg` | `#1c1c1e` | `#f0efed` |
| `--code-header-bg` | `#1c1c1e` | `#eae9e6` |
| `--code-border` | `rgba(255,255,255,0.1)` | `#d5d3cf` |
| `--code-line-number` | `#52525b` | `#a8a5a0` |
| `--code-filename` | `#60a5fa` | `#2563eb` |
| `--inline-code-bg` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.05)` |
| `--inline-code-text` | `#e4e4e7` | `#3a3935` |

Syntax highlighting: `--syntax-string`, `--syntax-comment`, `--syntax-number`, `--syntax-keyword`, `--syntax-type`, `--syntax-operator`, `--syntax-function`. Dark uses vibrant colors; light uses GitHub-inspired palette.

### Semantic Blocks

**Thinking**: Purple tones (`--thinking-bg`, `--thinking-border`, `--thinking-text`)
**Tool call**: Amber tones (`--tool-call-bg`, `--tool-call-border`, `--tool-call-text`)
**Tool result success**: Green tones (`--tool-result-success-bg/border/text`)
**Tool result error**: Red tones (`--tool-result-error-bg/border/text`)
**Output**: Gray tones (`--output-bg`, `--output-border`, `--output-text`)
**Interruption**: Red (`--interruption-bg/border/text`)
**Warning**: Amber (`--warning-bg/border/text`)
**Plan exit**: Green (`--plan-exit-bg/header-bg/border/text`)

### Diff Viewer

| Variable | Dark | Light |
|----------|------|-------|
| `--diff-added-bg` | `rgba(34,197,94,0.15)` | `rgba(34,197,94,0.1)` |
| `--diff-added-text` | `#4ade80` | `#166534` |
| `--diff-removed-bg` | `rgba(239,68,68,0.15)` | `rgba(239,68,68,0.1)` |
| `--diff-removed-text` | `#f87171` | `#991b1b` |

### Cards (Subagents)

| Variable | Dark | Light |
|----------|------|-------|
| `--card-bg` | `#121212` | `#f9f9f7` |
| `--card-border` | `#27272a` | `#d5d3cf` |
| `--card-header-bg` | `#18181b` | `#f0efed` |
| `--card-header-hover` | `#1f1f23` | `#eae9e6` |
| `--card-icon-muted` | `#52525b` | `#a8a5a0` |
| `--card-separator` | `#3f3f46` | `#d5d3cf` |

### Badges

Status badges: `--badge-error-bg/text`, `--badge-warning-bg/text`, `--badge-success-bg/text`, `--badge-info-bg/text`, `--badge-neutral-bg/text`.
Tags: `--tag-bg`, `--tag-text`, `--tag-border`.

### Search Highlights

| Variable | Dark | Light |
|----------|------|-------|
| `--highlight-bg` | `rgba(202,138,4,0.7)` | `#facc15` |
| `--highlight-bg-inactive` | `rgba(113,63,18,0.5)` | `#fef08a` |
| `--highlight-ring` | `#facc15` | `#ca8a04` |

### Scrollbar

Custom scrollbar styling via `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-thumb-active`.

## Tailwind Config

`tailwind.config.js` maps CSS variables to Tailwind classes:

```javascript
colors: {
  surface: {
    DEFAULT: 'var(--color-surface)',
    raised: 'var(--color-surface-raised)',
    overlay: 'var(--color-surface-overlay)',
    sidebar: 'var(--color-surface-sidebar)',
    code: 'var(--code-bg)',
  },
  border: {
    DEFAULT: 'var(--color-border)',
    subtle: 'var(--color-border-subtle)',
    emphasis: 'var(--color-border-emphasis)',
  },
  text: {
    DEFAULT: 'var(--color-text)',
    secondary: 'var(--color-text-secondary)',
    muted: 'var(--color-text-muted)',
  },
  semantic: {
    success: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
  },
  // Backward-compatible alias
  'claude-dark': { bg: 'var(--color-surface)', surface: 'var(--color-surface-raised)', ... },
}
```

Plugin: `@tailwindcss/typography` for markdown prose.

## Icon Library

`lucide-react` across 55+ components.

**Sizes**: `size-3` (tiny), `size-3.5` (small), `size-4` (standard), `size-5` (medium), `size-10` (empty states)

**Pattern**: `className` for size, `style` for color:
```tsx
<Bot className="size-4 shrink-0" style={{ color: COLOR_TEXT_SECONDARY }} />
<Loader2 className="size-3.5 shrink-0 animate-spin" style={{ color: '#3b82f6' }} />
```

**Common icons**: `Bot` (AI), `User` (user), `ChevronRight`/`ChevronDown` (expansion), `Check`/`Copy` (clipboard), `Info` (tooltips), `Loader2` (loading), `Clock` (duration), `Terminal` (traces), `CheckCircle2` (completed).

## Team Colors

`src/renderer/constants/teamColors.ts` defines 8 color sets for teammate visualization:

```typescript
import { getTeamColorSet, TeamColorSet } from '@renderer/constants/teamColors';

const colors = getTeamColorSet('blue');
// colors.border: '#3b82f6'  — border accent
// colors.badge: 'rgba(59, 130, 246, 0.15)'  — badge background
// colors.text: '#60a5fa'  — text color
```

Available colors: blue, green, red, yellow, purple, cyan, orange, pink.

## Component Patterns

### User Chat Bubble

Right-aligned with rounded corners, subtle shadow, copy overlay on hover:

```tsx
<div className="flex justify-end">
  <div className="max-w-[85%]">
    <div className="rounded-2xl rounded-br-sm px-4 py-3"
         style={{
           backgroundColor: 'var(--chat-user-bg)',
           border: '1px solid var(--chat-user-border)',
           boxShadow: 'var(--chat-user-shadow)',
         }}>
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  </div>
</div>
```

### AI Group Header

Collapsible with model badge, summary, metrics:

```tsx
<div onClick={toggle} className="flex cursor-pointer items-center gap-2">
  <Bot className="size-4" style={{ color: COLOR_TEXT_SECONDARY }} />
  <span>Claude</span>
  <span className={getModelColorClass(model.family)}>{model.name}</span>
  <span style={{ color: COLOR_TEXT_MUTED }}>{itemsSummary}</span>
  <ChevronDown className={`size-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
</div>
```

### Subagent Card

Linear-style card with nested expansion:

```tsx
<div style={{ backgroundColor: CARD_BG, border: CARD_BORDER_STYLE }}>
  <div className="flex cursor-pointer items-center gap-2 px-3 py-2"
       style={{ backgroundColor: isExpanded ? CARD_HEADER_BG : 'transparent' }}>
    <ChevronRight className={`size-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
    {/* colored dot + badge + description + metrics */}
  </div>
  {isExpanded && <div className="space-y-3 p-3">{/* content */}</div>}
</div>
```

### Copy Button (Overlay)

Gradient-fade overlay that appears on group hover:

```tsx
<div className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity">
  <div style={{ background: `linear-gradient(to right, transparent, ${bgColor})` }} />
  <button><Copy className="size-3.5" /></button>
</div>
```

### Popover via Portal

Token usage and context badges use portaled popovers to escape stacking context:

```tsx
{showPopover && createPortal(
  <div style={{
    backgroundColor: 'var(--color-surface-raised)',
    border: '1px solid var(--color-border)',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
    zIndex: 99999,
  }}>
    {/* content */}
  </div>,
  document.body
)}
```

## Animations

### CSS Keyframes (in `index.css`)

- `shimmer` — skeleton loading shimmer effect
- `skeleton-fade-in` — staggered fade-in for skeleton cards
- `splash-slide` — splash screen loading bar

### Tailwind Utilities

| Class | Usage |
|-------|-------|
| `animate-spin` | Loading spinners (`Loader2`) |
| `animate-ping` | Pulsing dots (ongoing state) |
| `transition-transform` | Chevron rotation |
| `transition-colors` | Hover color changes |
| `transition-opacity` | Copy button fade-in |
| `transition-all duration-300` | Card highlight transitions |
| `duration-[3000ms]` | Highlight ring fade-out |

## Z-Index Layers

| Z-Index | Usage |
|---------|-------|
| `z-10` | Copy button overlays, dropdown backdrops |
| `z-20` | Dropdown menus, search bar |
| `z-30` | Pane split drop zones |
| `z-40` | Pane view overlays |
| `z-50` | Context menus, command palette, settings selects |
| `99999` | Portaled popovers (token usage, context badge, metrics pill) |

## Light Theme Notes

The light theme uses **warm neutrals** (not pure white/gray):
- Backgrounds: `#f9f9f7`, `#f0efed`, `#eae9e6` (warm off-white)
- Borders: `#d5d3cf`, `#e3e1dd` (warm gray)
- Text: `#1c1b19`, `#4d4b46`, `#6d6b65` (warm dark)
- Syntax highlighting: GitHub-inspired palette

Body transition: `background-color 0.2s ease, color 0.2s ease` for smooth theme switching.
