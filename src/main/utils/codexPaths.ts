import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

export const CODEX_PROJECT_ID_PREFIX = 'codex::';
const CODEX_PROJECT_ID_PATTERN = /^codex::[a-f0-9]{12}$/;

function getHomeDir(): string {
  const windowsHome =
    process.env.HOMEDRIVE && process.env.HOMEPATH
      ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`
      : null;
  return process.env.HOME || process.env.USERPROFILE || windowsHome || os.homedir() || '/';
}

export function getCodexBasePath(): string {
  const configured = process.env.CODEX_HOME?.trim();
  if (!configured) {
    return path.join(getHomeDir(), '.codex');
  }
  // Resolve relative CODEX_HOME against the user's home directory rather than
  // process.cwd(). In packaged Electron the cwd points at the install root or
  // some system path, so resolving against it would silently land in the wrong
  // place. Anchoring on home matches what users expect.
  return path.isAbsolute(configured)
    ? path.normalize(configured)
    : path.resolve(getHomeDir(), configured);
}

export function getCodexSessionsBasePath(): string {
  return path.join(getCodexBasePath(), 'sessions');
}

export function normalizeCodexProjectPath(cwd: string): string {
  const normalized = path.normalize(cwd);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function buildCodexProjectId(cwd: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(normalizeCodexProjectPath(cwd))
    .digest('hex')
    .slice(0, 12);
  return `${CODEX_PROJECT_ID_PREFIX}${hash}`;
}

export function isCodexProjectId(projectId: string): boolean {
  return CODEX_PROJECT_ID_PATTERN.test(projectId);
}

export function extractCodexSessionIdFromFilename(filename: string): string {
  const baseName = path.basename(filename, '.jsonl');
  const uuidMatch = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(
    baseName
  );
  return uuidMatch?.[1] ?? baseName;
}

export function getCodexProjectName(cwd: string): string {
  const normalized = path.normalize(cwd);
  return path.basename(normalized) || normalized;
}
