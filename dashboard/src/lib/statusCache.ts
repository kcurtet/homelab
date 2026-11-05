/**
 * In-memory TTL cache for /api/status (spec: no DB, state is "now", don't
 * hammer the socket-proxy). Module-level singleton: one entry, shared by every
 * request in the node server process. Action routes call clearStatusCache()
 * after a mutation so the next poll never shows the pre-action world.
 */
import type { ProjectStatus } from './status';
import type { BackupStatus } from './backup';

export interface StatusResponse {
  projects: ProjectStatus[];
  /** Task 6: manual-backup state + last restic snapshot (TTL 60s probe). */
  backup: BackupStatus;
  fetchedAt: string;
}

const TTL_MS = 10_000;

let cached: StatusResponse | null = null;
let expiresAt = 0;

export function getStatusCache(): StatusResponse | null {
  if (cached && expiresAt > Date.now()) return cached;
  return null;
}

export function setStatusCache(body: StatusResponse): void {
  cached = body;
  expiresAt = Date.now() + TTL_MS;
}

export function clearStatusCache(): void {
  cached = null;
  expiresAt = 0;
}
