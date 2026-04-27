/**
 * DashboardView - Main dashboard with "Productivity Luxury" aesthetic.
 * Inspired by Linear, Vercel, and Raycast design patterns.
 * Features:
 * - Subtle spotlight gradient
 * - Centralized command search with inline project filtering
 * - Border-first project cards with minimal backgrounds
 */

import React, { useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { formatShortcut } from '@renderer/utils/stringUtils';
import { createLogger } from '@shared/utils/logger';
import { formatDistanceToNow } from 'date-fns';
import { Command, FolderGit2, FolderOpen, GitBranch, Search, Settings } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { type BrandMarkProps, ClaudeMark, OpenAIMark } from './providerIcons';

import type { ProjectProvider, RepositoryGroup } from '@renderer/types/data';

const logger = createLogger('Component:DashboardView');

// =============================================================================
// Provider visual metadata
// =============================================================================

type ProviderIcon = (props: Readonly<BrandMarkProps>) => React.JSX.Element;

interface ProviderMeta {
  label: string;
  shortLabel: string;
  emptyPath: string;
  Icon: ProviderIcon;
  accentText: string;
  accentBg: string;
  accentBorder: string;
  accentDot: string;
}

const PROVIDER_META: Record<ProjectProvider, ProviderMeta> = {
  claude: {
    label: 'Claude Code Directories',
    shortLabel: 'Claude Code',
    emptyPath: '~/.claude/projects/',
    Icon: ClaudeMark,
    accentText: 'text-[#B85C38]',
    accentBg: 'bg-[#B85C38]/15',
    accentBorder: 'border-[#B85C38]/45',
    accentDot: 'bg-[#B85C38]',
  },
  codex: {
    label: 'Codex Directories',
    shortLabel: 'Codex',
    emptyPath: '~/.codex/sessions/',
    Icon: OpenAIMark,
    accentText: 'text-[#087A63]',
    accentBg: 'bg-[#087A63]/15',
    accentBorder: 'border-[#087A63]/45',
    accentDot: 'bg-[#087A63]',
  },
};

const getProviderMeta = (provider: ProjectProvider | undefined): ProviderMeta =>
  PROVIDER_META[provider ?? 'claude'];

// =============================================================================
// Command Search Input
// =============================================================================

interface CommandSearchProps {
  value: string;
  onChange: (value: string) => void;
}

const CommandSearch = ({ value, onChange }: Readonly<CommandSearchProps>): React.JSX.Element => {
  const [isFocused, setIsFocused] = useState(false);
  const { openCommandPalette, selectedProjectId } = useStore(
    useShallow((s) => ({
      openCommandPalette: s.openCommandPalette,
      selectedProjectId: s.selectedProjectId,
    }))
  );

  // Handle Cmd+K to open full command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openCommandPalette();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openCommandPalette]);

  return (
    <div className="relative mx-auto w-full max-w-xl">
      {/* Search container with glow effect on focus */}
      <div
        className={`relative flex items-center gap-3 rounded-sm border bg-surface-raised px-4 py-3 transition-all duration-200 ${
          isFocused
            ? 'border-zinc-500 shadow-[0_0_20px_rgba(255,255,255,0.04)] ring-1 ring-zinc-600/30'
            : 'border-border hover:border-zinc-600'
        } `}
      >
        <Search className="size-4 shrink-0 text-text-muted" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search projects..."
          className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        {/* Keyboard shortcut badge - opens full command palette */}
        <button
          onClick={() => openCommandPalette()}
          className="flex shrink-0 items-center gap-1 transition-opacity hover:opacity-80"
          title={
            selectedProjectId
              ? `Search in sessions (${formatShortcut('K')})`
              : `Search projects (${formatShortcut('K')})`
          }
        >
          <kbd className="flex h-5 items-center justify-center rounded border border-border bg-surface-overlay px-1.5 text-[10px] font-medium text-text-muted">
            <Command className="size-2.5" />
          </kbd>
          <kbd className="flex size-5 items-center justify-center rounded border border-border bg-surface-overlay text-[10px] font-medium text-text-muted">
            K
          </kbd>
        </button>
      </div>
    </div>
  );
};

// =============================================================================
// Repository Card
// =============================================================================

interface RepositoryCardProps {
  repo: RepositoryGroup;
  onClick: () => void;
  isHighlighted?: boolean;
}

/**
 * Truncate path to show ~/relative/path format
 */
function formatProjectPath(path: string): string {
  const p = path.replace(/\\/g, '/');

  if (p.startsWith('/Users/') || p.startsWith('/home/')) {
    const parts = p.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const rest = parts.slice(2).join('/');
      return rest ? `~/${rest}` : '~';
    }
  }

  if (isWindowsUserPath(path)) {
    const parts = p.split('/').filter(Boolean);
    if (parts.length >= 3) {
      const rest = parts.slice(3).join('/');
      return rest ? `~/${rest}` : '~';
    }
  }

  return p;
}

function isWindowsUserPath(input: string): boolean {
  if (input.length < 10) {
    return false;
  }

  const drive = input.charCodeAt(0);
  const hasDriveLetter =
    ((drive >= 65 && drive <= 90) || (drive >= 97 && drive <= 122)) && input[1] === ':';

  return hasDriveLetter && input.startsWith('\\Users\\', 2);
}

const RepositoryCard = ({
  repo,
  onClick,
  isHighlighted,
}: Readonly<RepositoryCardProps>): React.JSX.Element => {
  const lastActivity = repo.mostRecentSession
    ? formatDistanceToNow(new Date(repo.mostRecentSession), { addSuffix: true })
    : 'No recent activity';

  const worktreeCount = repo.worktrees.length;
  const hasMultipleWorktrees = worktreeCount > 1;

  // Get the path from the first worktree
  const projectPath = repo.worktrees[0]?.path || '';
  const formattedPath = formatProjectPath(projectPath);

  const meta = getProviderMeta(repo.provider);
  const ProviderIcon = meta.Icon;

  return (
    <button
      onClick={onClick}
      className={`group relative flex min-h-[120px] flex-col overflow-hidden rounded-sm border p-4 text-left transition-all duration-300 ${
        isHighlighted
          ? 'border-border-emphasis bg-surface-raised'
          : 'bg-surface/50 border-border hover:border-border-emphasis hover:bg-surface-raised'
      } `}
    >
      {/* Provider accent strip */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-[2px] ${meta.accentDot} opacity-60 transition-opacity duration-300 group-hover:opacity-100`}
      />

      {/* Provider icon badge */}
      <div
        className={`mb-3 flex size-8 items-center justify-center rounded-sm border ${meta.accentBorder} ${meta.accentBg} transition-colors duration-300`}
        title={meta.shortLabel}
      >
        <ProviderIcon className={`size-4 ${meta.accentText}`} />
      </div>

      {/* Project name */}
      <h3 className="mb-1 truncate text-sm font-medium text-text transition-colors duration-200 group-hover:text-text">
        {repo.name}
      </h3>

      {/* Project path - monospace, muted */}
      <p className="mb-auto truncate font-mono text-[10px] text-text-muted">{formattedPath}</p>

      {/* Meta row: worktrees, sessions, time */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {hasMultipleWorktrees && (
          <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary">
            <GitBranch className="size-3" />
            {worktreeCount} worktrees
          </span>
        )}
        <span className="text-[10px] text-text-secondary">{repo.totalSessions} sessions</span>
        <span className="text-text-muted">·</span>
        <span className="text-[10px] text-text-muted">{lastActivity}</span>
      </div>
    </button>
  );
};

// =============================================================================
// Ghost Card (New Project)
// =============================================================================

const NewProjectCard = (): React.JSX.Element => {
  const { repositoryGroups, selectRepository } = useStore(
    useShallow((s) => ({
      repositoryGroups: s.repositoryGroups,
      selectRepository: s.selectRepository,
    }))
  );

  const handleClick = async (): Promise<void> => {
    try {
      const selectedPaths = await api.config.selectFolders();
      if (!selectedPaths || selectedPaths.length === 0) {
        return; // User cancelled
      }

      const selectedPath = selectedPaths[0];

      // Match selected path against known repository worktrees
      for (const repo of repositoryGroups) {
        for (const worktree of repo.worktrees) {
          if (worktree.path === selectedPath) {
            selectRepository(repo.id);
            return;
          }
        }
      }

      // No match found - open the folder in file manager as fallback
      const result = await api.openPath(selectedPath);
      if (!result.success) {
        logger.error('Failed to open folder:', result.error);
      }
    } catch (error) {
      logger.error('Error selecting folder:', error);
    }
  };

  return (
    <button
      className="hover:bg-surface/30 group relative flex min-h-[120px] flex-col items-center justify-center rounded-sm border border-dashed border-border bg-transparent p-4 transition-all duration-300 hover:border-border-emphasis"
      onClick={handleClick}
      title="Select a project folder"
    >
      <div className="mb-2 flex size-8 items-center justify-center rounded-sm border border-dashed border-border transition-colors duration-300 group-hover:border-border-emphasis">
        <FolderOpen className="size-4 text-text-muted transition-colors group-hover:text-text-secondary" />
      </div>
      <span className="text-xs text-text-muted transition-colors group-hover:text-text-secondary">
        Select Folder
      </span>
    </button>
  );
};

// =============================================================================
// Projects Grid
// =============================================================================

interface ProjectsGridProps {
  searchQuery: string;
  maxProjects?: number;
}

interface RepositorySectionProps {
  provider: ProjectProvider;
  repos: RepositoryGroup[];
  searchQuery: string;
  onSelect: (repoId: string) => void;
  showNewProjectCard?: boolean;
}

const RepositorySection = ({
  provider,
  repos,
  searchQuery,
  onSelect,
  showNewProjectCard,
}: Readonly<RepositorySectionProps>): React.JSX.Element => {
  const hasSearch = !!searchQuery.trim();
  const meta = getProviderMeta(provider);
  const ProviderIcon = meta.Icon;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex size-5 items-center justify-center rounded-sm border ${meta.accentBorder} ${meta.accentBg}`}
            aria-hidden="true"
          >
            <ProviderIcon className={`size-3 ${meta.accentText}`} />
          </span>
          <h3 className="text-xs font-medium uppercase tracking-wider text-text-secondary">
            {meta.label}
          </h3>
        </div>
        <span className="text-[10px] text-text-muted">
          {repos.length} {repos.length === 1 ? 'directory' : 'directories'}
        </span>
      </div>

      {repos.length === 0 ? (
        <div className="flex min-h-[120px] flex-col items-center justify-center rounded-sm border border-dashed border-border px-8 py-10">
          <div
            className={`mb-3 flex size-10 items-center justify-center rounded-sm border ${meta.accentBorder} ${meta.accentBg}`}
          >
            <ProviderIcon className={`size-5 ${meta.accentText}`} />
          </div>
          <p className="mb-1 text-sm text-text-secondary">
            {hasSearch ? 'No matches found' : 'No directories found'}
          </p>
          <p className="font-mono text-xs text-text-muted">{meta.emptyPath}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
          {repos.map((repo) => (
            <RepositoryCard
              key={repo.id}
              repo={repo}
              onClick={() => onSelect(repo.id)}
              isHighlighted={hasSearch}
            />
          ))}
          {showNewProjectCard && !hasSearch && <NewProjectCard />}
        </div>
      )}
    </section>
  );
};

const ProjectsGrid = ({
  searchQuery,
  maxProjects = 12,
}: Readonly<ProjectsGridProps>): React.JSX.Element => {
  const { repositoryGroups, repositoryGroupsLoading, fetchRepositoryGroups, selectRepository } =
    useStore(
      useShallow((s) => ({
        repositoryGroups: s.repositoryGroups,
        repositoryGroupsLoading: s.repositoryGroupsLoading,
        fetchRepositoryGroups: s.fetchRepositoryGroups,
        selectRepository: s.selectRepository,
      }))
    );

  useEffect(() => {
    if (repositoryGroups.length === 0) {
      void fetchRepositoryGroups();
    }
  }, [repositoryGroups.length, fetchRepositoryGroups]);

  // Filter projects based on search query
  const filteredRepos = useMemo(() => {
    if (!searchQuery.trim()) {
      return repositoryGroups;
    }

    const query = searchQuery.toLowerCase().trim();
    return repositoryGroups
      .filter((repo) => {
        // Match by name
        if (repo.name.toLowerCase().includes(query)) return true;
        // Match by path
        const path = repo.worktrees[0]?.path || '';
        if (path.toLowerCase().includes(query)) return true;
        return false;
      })
      .slice(0, maxProjects * 2);
  }, [repositoryGroups, searchQuery, maxProjects]);

  const reposByProvider = useMemo(() => {
    const grouped: Record<ProjectProvider, RepositoryGroup[]> = {
      claude: [],
      codex: [],
    };

    for (const repo of filteredRepos) {
      const provider = repo.provider ?? 'claude';
      grouped[provider].push(repo);
    }

    if (!searchQuery.trim()) {
      grouped.claude = grouped.claude.slice(0, maxProjects);
      grouped.codex = grouped.codex.slice(0, maxProjects);
    }

    return grouped;
  }, [filteredRepos, searchQuery, maxProjects]);

  if (repositoryGroupsLoading) {
    // Organic widths per card — no repeating stamp
    const titleWidths = [60, 66, 50, 55, 75, 45, 40, 65];
    const pathWidths = [80, 75, 85, 66, 70, 80, 60, 72];

    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="skeleton-card flex min-h-[120px] flex-col rounded-sm border border-border p-4"
            style={{
              animationDelay: `${i * 80}ms`,
              backgroundColor: 'var(--skeleton-base)',
            }}
          >
            {/* Icon placeholder */}
            <div
              className="mb-3 size-8 rounded-sm"
              style={{ backgroundColor: 'var(--skeleton-base-light)' }}
            />
            {/* Title placeholder */}
            <div
              className="mb-2 h-3.5 rounded-sm"
              style={{
                width: `${titleWidths[i]}%`,
                backgroundColor: 'var(--skeleton-base-light)',
              }}
            />
            {/* Path placeholder */}
            <div
              className="mb-auto h-2.5 rounded-sm"
              style={{
                width: `${pathWidths[i]}%`,
                backgroundColor: 'var(--skeleton-base-dim)',
              }}
            />
            {/* Meta row placeholder */}
            <div className="mt-3 flex gap-2">
              <div
                className="h-2.5 w-16 rounded-sm"
                style={{ backgroundColor: 'var(--skeleton-base-dim)' }}
              />
              <div
                className="h-2.5 w-12 rounded-sm"
                style={{ backgroundColor: 'var(--skeleton-base-dim)' }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (filteredRepos.length === 0 && searchQuery.trim()) {
    return (
      <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-border px-8 py-16">
        <div className="mb-4 flex size-12 items-center justify-center rounded-sm border border-border bg-surface-raised">
          <Search className="size-6 text-text-muted" />
        </div>
        <p className="mb-1 text-sm text-text-secondary">No projects found</p>
        <p className="text-xs text-text-muted">No matches for &quot;{searchQuery}&quot;</p>
      </div>
    );
  }

  if (repositoryGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-border px-8 py-16">
        <div className="mb-4 flex size-12 items-center justify-center rounded-sm border border-border bg-surface-raised">
          <FolderGit2 className="size-6 text-text-muted" />
        </div>
        <p className="mb-1 text-sm text-text-secondary">No projects found</p>
        <p className="font-mono text-xs text-text-muted">~/.claude/projects/</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <RepositorySection
        provider="claude"
        repos={reposByProvider.claude}
        searchQuery={searchQuery}
        onSelect={selectRepository}
        showNewProjectCard
      />
      <RepositorySection
        provider="codex"
        repos={reposByProvider.codex}
        searchQuery={searchQuery}
        onSelect={selectRepository}
      />
    </div>
  );
};

// =============================================================================
// Dashboard View
// =============================================================================

export const DashboardView = (): React.JSX.Element => {
  const [searchQuery, setSearchQuery] = useState('');
  const openSettingsTab = useStore((s) => s.openSettingsTab);

  return (
    <div className="relative flex-1 overflow-auto bg-surface">
      {/* Spotlight gradient background */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.08),transparent)]"
        aria-hidden="true"
      />

      {/* Content */}
      <div className="relative mx-auto max-w-5xl px-8 py-12">
        {/* Command Search */}
        <div className="mb-8">
          <CommandSearch value={searchQuery} onChange={setSearchQuery} />
        </div>

        {/* Inline toolbar (no section header) */}
        <div className="mb-6 flex items-center justify-end gap-3">
          {searchQuery.trim() && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-xs text-text-muted transition-colors hover:text-text-secondary"
            >
              Clear search
            </button>
          )}
          <button
            onClick={() => openSettingsTab('general')}
            className="flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-secondary"
            title="Change Claude data folder"
          >
            <Settings className="size-3" />
            Change default folder
          </button>
        </div>

        {/* Projects Grid */}
        <ProjectsGrid searchQuery={searchQuery} />
      </div>
    </div>
  );
};
