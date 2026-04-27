---
globs: ["**/*.css", "src/renderer/**/*.tsx"]
---

# Tailwind CSS Conventions

## Theme Architecture
Uses CSS custom properties for theme-aware colors defined in `src/renderer/index.css`.

### Core Surface Colors
```css
--color-surface: #141416          /* Main background */
--color-surface-raised: #27272a   /* Elevated surfaces */
--color-surface-overlay: #27272a  /* Overlays/modals */
--color-surface-sidebar: #0f0f11  /* Sidebar background */
```

### Border Colors
```css
--color-border: rgba(255, 255, 255, 0.05)
--color-border-subtle: rgba(255, 255, 255, 0.05)
--color-border-emphasis: rgba(255, 255, 255, 0.1)
```

### Text Colors
```css
--color-text: #fafafa             /* Primary text */
--color-text-secondary: #a1a1aa   /* Secondary text */
--color-text-muted: #71717a       /* Muted text */
```

## Tailwind Usage
Use theme-aware classes that reference CSS variables:
```tsx
// Preferred - uses CSS variables for theme support
<div className="bg-surface text-text border-border">
<div className="bg-surface-raised text-text-secondary">

// Also available via claude-dark namespace
<div className="bg-claude-dark-bg text-claude-dark-text">
```

## Additional CSS Variable Categories
- Chat bubbles: `--chat-user-*`, `--chat-ai-*`, `--chat-system-*`
- Code blocks: `--code-*`, `--syntax-*`, `--inline-code-*`
- Diff viewer: `--diff-added-*`, `--diff-removed-*`
- Tool blocks: `--tool-call-*`, `--tool-result-*`
- Tool items: `--tool-item-name`, `--tool-item-summary`, `--tool-item-muted`, `--tool-item-hover-bg`
- Badges: `--badge-*`, `--tag-*`
- Search: `--highlight-*`
- Scrollbar: `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-thumb-active`
- Prose/Markdown: `--prose-heading`, `--prose-body`, `--prose-link`, `--prose-code-*`, `--prose-pre-*`
- Thinking blocks: `--thinking-bg`, `--thinking-border`, `--thinking-text`, `--thinking-content-*`
- Output blocks: `--output-bg`, `--output-border`, `--output-text`, `--output-content-border`
- Cards/Subagents: `--card-bg`, `--card-border`, `--card-header-*`, `--card-icon-muted`, `--card-separator`
- Highlights: `--skill-highlight-*`, `--path-highlight-*`
- UI elements: `--interruption-*`, `--warning-*`, `--plan-exit-*`, `--error-highlight-*`, `--kbd-*`, `--context-btn-*`

## Dark/Light Theme
Both themes supported via `:root` and `:root.light` in index.css.
Toggle via `useTheme` hook which adds/removes `light` class on root.
