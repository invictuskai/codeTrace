/**
 * Scans Codex CLI rollout logs under ~/.codex/sessions.
 */

import {
  analyzeCodexSessionFileMetadata,
  type CodexSessionFileMetadata,
  parseCodexSessionFile,
} from '@main/services/parsing/CodexSessionParser';
import {
  type FindSessionByIdResult,
  type FindSessionsByPartialIdResult,
  type PaginatedSessionsResult,
  type Project,
  type RepositoryGroup,
  type SearchResult,
  type SearchSessionsResult,
  type Session,
  type SessionCursor,
  type SessionMetadataLevel,
  type SessionsByIdsOptions,
  type SessionsPaginationOptions,
  type Worktree,
} from '@main/types';
import {
  buildCodexProjectId,
  extractCodexSessionIdFromFilename,
  getCodexProjectName,
  getCodexSessionsBasePath,
  isCodexProjectId,
} from '@main/utils/codexPaths';
import { createLogger } from '@shared/utils/logger';
import * as path from 'path';

import { LocalFileSystemProvider } from '../infrastructure/LocalFileSystemProvider';
import { gitIdentityResolver } from '../parsing/GitIdentityResolver';

import { SearchTextCache } from './SearchTextCache';
import { extractSearchableEntries } from './SearchTextExtractor';

import type { FileSystemProvider, FsDirent } from '../infrastructure/FileSystemProvider';

const logger = createLogger('Discovery:CodexProjectScanner');
const CODEX_SCAN_CACHE_TTL_MS = 5_000;
const CODEX_METADATA_CACHE_MAX = 1_000;

interface IndexedCodexSession {
  sessionId: string;
  projectId: string;
  cwd: string;
  filePath: string;
  mtimeMs: number;
  birthtimeMs: number;
  size: number;
  metadata: CodexSessionFileMetadata;
}

interface CodexIndex {
  projects: Project[];
  sessions: IndexedCodexSession[];
  projectSessions: Map<string, IndexedCodexSession[]>;
  sessionPaths: Map<string, string>;
  timestamp: number;
}

export class CodexProjectScanner {
  private readonly sessionsDir: string;
  private readonly fsProvider: FileSystemProvider;
  private indexCache: CodexIndex | null = null;
  // Bounded LRU keyed by file path; eviction happens at insertion time. Sized
  // to comfortably cover most users while preventing unbounded growth for
  // installations with very large session histories.
  private readonly metadataCache = new Map<
    string,
    { mtimeMs: number; size: number; metadata: CodexSessionFileMetadata }
  >();
  private readonly searchCache = new SearchTextCache();

  constructor(sessionsDir?: string, fsProvider?: FileSystemProvider) {
    this.sessionsDir = sessionsDir ?? getCodexSessionsBasePath();
    this.fsProvider = fsProvider ?? new LocalFileSystemProvider();
  }

  private touchMetadataCache(filePath: string): void {
    const entry = this.metadataCache.get(filePath);
    if (entry) {
      this.metadataCache.delete(filePath);
      this.metadataCache.set(filePath, entry);
    }
  }

  private setMetadataCache(
    filePath: string,
    entry: { mtimeMs: number; size: number; metadata: CodexSessionFileMetadata }
  ): void {
    if (this.metadataCache.has(filePath)) {
      this.metadataCache.delete(filePath);
    } else if (this.metadataCache.size >= CODEX_METADATA_CACHE_MAX) {
      const oldest = this.metadataCache.keys().next().value;
      if (oldest !== undefined) {
        this.metadataCache.delete(oldest);
      }
    }
    this.metadataCache.set(filePath, entry);
  }

  async scan(): Promise<Project[]> {
    const index = await this.buildIndex();
    return index.projects;
  }

  async scanWithWorktreeGrouping(): Promise<RepositoryGroup[]> {
    const projects = await this.scan();
    const groupMap = new Map<
      string,
      {
        identity: RepositoryGroup['identity'];
        name: string;
        worktrees: Worktree[];
      }
    >();

    // Resolve git metadata for every project in parallel. The previous
    // serial loop did 5 git calls per project sequentially — N projects =
    // 5N round-trips on cold start.
    const resolved = await Promise.all(
      projects.map(async (project) => {
        const [identity, branch, isWorktree, source] = await Promise.all([
          gitIdentityResolver.resolveIdentity(project.path),
          gitIdentityResolver.getBranch(project.path),
          gitIdentityResolver.isWorktree(project.path),
          gitIdentityResolver.detectWorktreeSource(project.path),
        ]);
        const isMainWorktree = !isWorktree;
        const displayName = await gitIdentityResolver.getWorktreeDisplayName(
          project.path,
          source,
          branch,
          isMainWorktree
        );
        return { project, identity, branch, isMainWorktree, source, displayName };
      })
    );

    for (const { project, identity, branch, isMainWorktree, source, displayName } of resolved) {
      const worktree: Worktree = {
        provider: 'codex',
        id: project.id,
        path: project.path,
        name: displayName,
        gitBranch: branch ?? undefined,
        isMainWorktree,
        source,
        sessions: project.sessions,
        createdAt: project.createdAt,
        mostRecentSession: project.mostRecentSession,
      };

      const groupId = `codex-repo::${identity?.id ?? project.id.replace(/^codex::/, '')}`;
      const group = groupMap.get(groupId) ?? {
        identity,
        name: identity?.name ?? project.name,
        worktrees: [],
      };
      group.worktrees.push(worktree);
      groupMap.set(groupId, group);
    }

    const groups: RepositoryGroup[] = [];
    for (const [groupId, group] of groupMap) {
      group.worktrees.sort((a, b) => {
        if (a.isMainWorktree && !b.isMainWorktree) return -1;
        if (!a.isMainWorktree && b.isMainWorktree) return 1;
        return (b.mostRecentSession ?? 0) - (a.mostRecentSession ?? 0);
      });
      const totalSessions = group.worktrees.reduce(
        (sum, worktree) => sum + worktree.sessions.length,
        0
      );
      const mostRecentSession = Math.max(
        ...group.worktrees.map((worktree) => worktree.mostRecentSession ?? 0)
      );
      groups.push({
        provider: 'codex',
        id: groupId,
        identity: group.identity,
        worktrees: group.worktrees,
        name: group.name,
        mostRecentSession: mostRecentSession > 0 ? mostRecentSession : undefined,
        totalSessions,
      });
    }

    groups.sort((a, b) => (b.mostRecentSession ?? 0) - (a.mostRecentSession ?? 0));
    return groups;
  }

  async listSessions(projectId: string): Promise<Session[]> {
    const sessions = await this.getIndexedSessionsForProject(projectId);
    return sessions
      .map((session) => this.buildSession(session, 'deep'))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async listSessionsPaginated(
    projectId: string,
    cursor: string | null,
    limit: number,
    options?: SessionsPaginationOptions
  ): Promise<PaginatedSessionsResult> {
    const includeTotalCount = options?.includeTotalCount ?? false;
    const metadataLevel: SessionMetadataLevel = options?.metadataLevel ?? 'deep';
    const sessions = await this.getIndexedSessionsForProject(projectId);
    const sorted = [...sessions].sort((a, b) => {
      if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
      return a.sessionId.localeCompare(b.sessionId);
    });

    let startIndex = 0;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as SessionCursor;
        const cursorIndex = sorted.findIndex((info) => {
          if (info.mtimeMs < decoded.timestamp) return true;
          return info.mtimeMs === decoded.timestamp && info.sessionId > decoded.sessionId;
        });
        startIndex = cursorIndex === -1 ? sorted.length : cursorIndex;
      } catch {
        startIndex = 0;
      }
    }

    const pageInfos = sorted.slice(startIndex, startIndex + limit + 1);
    const hasMore = pageInfos.length > limit;
    const pageSessions = pageInfos
      .slice(0, limit)
      .map((info) => this.buildSession(info, metadataLevel));
    const lastInfo = pageInfos[Math.min(pageInfos.length, limit) - 1];
    const nextCursor =
      hasMore && lastInfo
        ? Buffer.from(
            JSON.stringify({ timestamp: lastInfo.mtimeMs, sessionId: lastInfo.sessionId })
          ).toString('base64')
        : null;

    return {
      sessions: pageSessions,
      nextCursor,
      hasMore,
      totalCount: includeTotalCount ? sorted.length : pageSessions.length + (hasMore ? 1 : 0),
    };
  }

  async getSession(projectId: string, sessionId: string): Promise<Session | null> {
    return this.getSessionWithOptions(projectId, sessionId, { metadataLevel: 'deep' });
  }

  async getSessionWithOptions(
    projectId: string,
    sessionId: string,
    options?: SessionsByIdsOptions
  ): Promise<Session | null> {
    const info = await this.getIndexedSession(projectId, sessionId);
    if (!info) {
      return null;
    }
    return this.buildSession(info, options?.metadataLevel ?? 'deep');
  }

  async getSessionPath(projectId: string, sessionId: string): Promise<string | null> {
    const info = await this.getIndexedSession(projectId, sessionId);
    return info?.filePath ?? null;
  }

  getCachedSessionPath(sessionId: string): string | null {
    return this.indexCache?.sessionPaths.get(sessionId) ?? null;
  }

  async listSessionFiles(projectId: string): Promise<string[]> {
    const sessions = await this.getIndexedSessionsForProject(projectId);
    return sessions.map((session) => session.filePath);
  }

  async searchSessions(
    projectId: string,
    query: string,
    maxResults: number = 50
  ): Promise<SearchSessionsResult> {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) {
      return { results: [], totalMatches: 0, sessionsSearched: 0, query };
    }

    const sessions = await this.getIndexedSessionsForProject(projectId);
    const sorted = [...sessions].sort((a, b) => b.mtimeMs - a.mtimeMs);
    const results: SearchResult[] = [];
    let sessionsSearched = 0;

    for (const session of sorted) {
      if (results.length >= maxResults) break;
      sessionsSearched++;

      let extracted = this.searchCache.get(session.filePath, session.mtimeMs);
      if (!extracted) {
        const parsed = await parseCodexSessionFile(session.filePath, this.fsProvider);
        const fresh = extractSearchableEntries(parsed.messages);
        this.searchCache.set(session.filePath, session.mtimeMs, fresh.entries, fresh.sessionTitle);
        extracted = fresh;
      }
      for (const entry of extracted.entries) {
        if (results.length >= maxResults) break;
        this.collectMatchesForEntry(
          entry.text,
          normalizedQuery,
          results,
          maxResults,
          projectId,
          session.sessionId,
          extracted.sessionTitle ?? session.metadata.firstUserMessage?.text,
          entry.messageType,
          entry.timestamp,
          entry.groupId,
          entry.itemType,
          entry.messageUuid
        );
      }
    }

    return {
      results,
      totalMatches: results.length,
      sessionsSearched,
      query,
    };
  }

  async findSessionById(sessionId: string): Promise<FindSessionByIdResult> {
    const index = await this.buildIndex();
    const match = index.sessions.find((session) => session.sessionId === sessionId);
    if (!match) {
      return { found: false };
    }

    return {
      found: true,
      projectId: match.projectId,
      session: this.buildSession(match, 'light'),
    };
  }

  async findSessionsByPartialId(
    fragment: string,
    maxResults: number = 50
  ): Promise<FindSessionsByPartialIdResult> {
    const lower = fragment.toLowerCase();
    const index = await this.buildIndex();
    const results = index.sessions
      .filter((session) => session.sessionId.toLowerCase().includes(lower))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, maxResults)
      .map((session) => ({
        projectId: session.projectId,
        session: this.buildSession(session, 'light'),
      }));

    return {
      found: results.length > 0,
      results,
    };
  }

  projectsDirExists(): Promise<boolean> {
    return this.fsProvider.exists(this.sessionsDir);
  }

  getSessionsDir(): string {
    return this.sessionsDir;
  }

  invalidateCachesForProject(projectId: string): void {
    if (!isCodexProjectId(projectId)) return;
    this.indexCache = null;
  }

  private async getIndexedSession(
    projectId: string,
    sessionId: string
  ): Promise<IndexedCodexSession | null> {
    const sessions = await this.getIndexedSessionsForProject(projectId);
    return sessions.find((session) => session.sessionId === sessionId) ?? null;
  }

  private async getIndexedSessionsForProject(projectId: string): Promise<IndexedCodexSession[]> {
    if (!isCodexProjectId(projectId)) {
      return [];
    }
    const index = await this.buildIndex();
    return index.projectSessions.get(projectId) ?? [];
  }

  private buildSession(info: IndexedCodexSession, metadataLevel: SessionMetadataLevel): Session {
    const previewTimestamp = info.metadata.firstUserMessage?.timestamp
      ? Date.parse(info.metadata.firstUserMessage.timestamp)
      : NaN;
    const createdAt = Number.isFinite(previewTimestamp) ? previewTimestamp : info.birthtimeMs;
    const staleThresholdMs = 5 * 60 * 1000;

    return {
      provider: 'codex',
      id: info.sessionId,
      projectId: info.projectId,
      projectPath: info.cwd,
      createdAt: Math.floor(createdAt),
      firstMessage: info.metadata.firstUserMessage?.text,
      messageTimestamp: info.metadata.firstUserMessage?.timestamp,
      hasSubagents: info.metadata.hasSubagents,
      messageCount: info.metadata.messageCount,
      isOngoing: info.metadata.isOngoing && Date.now() - info.mtimeMs < staleThresholdMs,
      metadataLevel,
      contextConsumption: metadataLevel === 'deep' ? info.metadata.contextConsumption : undefined,
      phaseBreakdown: metadataLevel === 'deep' ? info.metadata.phaseBreakdown : undefined,
    };
  }

  private async buildIndex(): Promise<CodexIndex> {
    if (this.indexCache && Date.now() - this.indexCache.timestamp < CODEX_SCAN_CACHE_TTL_MS) {
      return this.indexCache;
    }

    if (!(await this.fsProvider.exists(this.sessionsDir))) {
      this.indexCache = {
        projects: [],
        sessions: [],
        projectSessions: new Map(),
        sessionPaths: new Map(),
        timestamp: Date.now(),
      };
      return this.indexCache;
    }

    const files = await this.listCodexSessionFiles();
    const sessions = await this.collectFulfilledInBatches(files, 64, async (filePath) =>
      this.indexSessionFile(filePath)
    );
    const validSessions = sessions.filter(
      (session): session is IndexedCodexSession => session !== null
    );
    validSessions.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const projectSessions = new Map<string, IndexedCodexSession[]>();
    const sessionPaths = new Map<string, string>();
    for (const session of validSessions) {
      const group = projectSessions.get(session.projectId) ?? [];
      group.push(session);
      projectSessions.set(session.projectId, group);
      sessionPaths.set(session.sessionId, session.filePath);
    }

    const projects: Project[] = [];
    for (const [projectId, projectSessionList] of projectSessions) {
      const cwd = projectSessionList[0]?.cwd ?? projectId;
      const mostRecentSession = Math.max(...projectSessionList.map((session) => session.mtimeMs));
      const createdAt = Math.min(...projectSessionList.map((session) => session.birthtimeMs));
      projects.push({
        provider: 'codex',
        id: projectId,
        path: cwd,
        name: getCodexProjectName(cwd),
        sessions: projectSessionList.map((session) => session.sessionId),
        createdAt: Math.floor(createdAt),
        mostRecentSession: Math.floor(mostRecentSession),
      });
    }
    projects.sort((a, b) => (b.mostRecentSession ?? 0) - (a.mostRecentSession ?? 0));

    this.indexCache = {
      projects,
      sessions: validSessions,
      projectSessions,
      sessionPaths,
      timestamp: Date.now(),
    };
    return this.indexCache;
  }

  private async indexSessionFile(filePath: string): Promise<IndexedCodexSession | null> {
    try {
      const stats = await this.fsProvider.stat(filePath);
      const cached = this.metadataCache.get(filePath);
      const isCacheHit = cached?.mtimeMs === stats.mtimeMs && cached.size === stats.size;
      const metadata = isCacheHit
        ? cached.metadata
        : await analyzeCodexSessionFileMetadata(filePath, this.fsProvider);

      if (isCacheHit) {
        this.touchMetadataCache(filePath);
      } else {
        this.setMetadataCache(filePath, {
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          metadata,
        });
      }

      const cwd = metadata.cwd;
      if (!cwd) {
        return null;
      }

      return {
        sessionId: metadata.sessionId || extractCodexSessionIdFromFilename(filePath),
        projectId: buildCodexProjectId(cwd),
        cwd,
        filePath,
        mtimeMs: stats.mtimeMs,
        birthtimeMs: stats.birthtimeMs,
        size: stats.size,
        metadata,
      };
    } catch (error) {
      logger.debug(`Failed to index Codex session ${filePath}:`, error);
      return null;
    }
  }

  private async listCodexSessionFiles(): Promise<string[]> {
    const files: string[] = [];

    const walk = async (dirPath: string): Promise<void> => {
      let entries: FsDirent[];
      try {
        entries = await this.fsProvider.readdir(dirPath);
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          files.push(fullPath);
        }
      }
    };

    await walk(this.sessionsDir);
    return files;
  }

  private collectMatchesForEntry(
    text: string,
    query: string,
    results: SearchResult[],
    maxResults: number,
    projectId: string,
    sessionId: string,
    sessionTitle: string | undefined,
    messageType: 'user' | 'assistant',
    timestamp: number,
    groupId: string,
    itemType: 'user' | 'ai',
    messageUuid: string
  ): void {
    const lowerText = text.toLowerCase();
    let pos = 0;
    let matchIndex = 0;

    while ((pos = lowerText.indexOf(query, pos)) !== -1) {
      if (results.length >= maxResults) return;
      const contextStart = Math.max(0, pos - 50);
      const contextEnd = Math.min(text.length, pos + query.length + 50);
      results.push({
        sessionId,
        projectId,
        sessionTitle: sessionTitle ?? 'Untitled Session',
        matchedText: text.slice(pos, pos + query.length),
        context:
          (contextStart > 0 ? '...' : '') +
          text.slice(contextStart, contextEnd) +
          (contextEnd < text.length ? '...' : ''),
        messageType,
        timestamp,
        groupId,
        itemType,
        matchIndexInItem: matchIndex,
        matchStartOffset: pos,
        messageUuid,
      });
      matchIndex++;
      pos += query.length;
    }
  }

  private async collectFulfilledInBatches<T, R>(
    items: T[],
    batchSize: number,
    mapper: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = [];
    const safeBatchSize = Math.max(1, batchSize);

    for (let i = 0; i < items.length; i += safeBatchSize) {
      const batch = items.slice(i, i + safeBatchSize);
      const settled = await Promise.allSettled(batch.map((item) => mapper(item)));
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      }
    }

    return results;
  }
}
