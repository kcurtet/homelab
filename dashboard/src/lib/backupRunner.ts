/**
 * Impure backup orchestration (task 6) — executes the pure spec of
 * lib/backup.ts against the Docker API:
 *
 *   - status card: one anonymous probe container per TTL window runs
 *     "prerequisites check + restic snapshots --json" (60s cache: a container
 *     per 10s status poll would hammer the daemon for nothing).
 *   - backup-now: single named container (409 while one is already running),
 *     AutoRemove, fire-and-forget, with a best-effort exit-code/log-tail
 *     capture so a restic lock failure surfaces in the UI instead of dying
 *     silently with the auto-removed container.
 *
 * The dashboard never reads /etc/homelab itself — every value comes from the
 * container's own mount, so secrets stay outside this process.
 */
import {
  MANUAL_BACKUP_CONTAINER,
  buildBackupContainerSpec,
  extractSnapshotsJson,
  parseSnapshots,
  resticErrorMessage,
  type BackupRunOutcome,
  type BackupStatus,
} from './backup';
import type { RawContainer } from './status';
import {
  createContainer,
  getContainerLogs,
  listContainers,
  removeContainer,
  startContainer,
  waitForContainer,
} from './docker';

const SNAPSHOT_TTL_MS = 60_000; // > status cache (10s): snapshot reads are expensive
const PROBE_WAIT_MS = 60_000; // huge repos can be slow; the probe is bounded

interface ProbeResult {
  available: boolean;
  reason?: string;
  lastSnapshot: string | null;
  count: number | null;
}

let probeCache: { value: ProbeResult; expiresAt: number } | null = null;
let probeInFlight: Promise<ProbeResult> | null = null;
let lastRun: BackupRunOutcome | null = null;

const ACTIVE_STATES = new Set(['created', 'running', 'restarting', 'paused', 'removing']);

/** A manual backup is in flight iff its fixed-name container is alive. Pure. */
export function manualBackupRunning(containers: RawContainer[]): boolean {
  return containers.some(
    (c) =>
      ACTIVE_STATES.has(c.State) &&
      c.Names?.some((n) => n.replace(/^\//, '') === MANUAL_BACKUP_CONTAINER),
  );
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // podman reports missing bind sources as statfs errors — make the
  // prerequisite explicit instead of raw daemon dialect.
  if (/no such file or directory|not a directory/i.test(message)) {
    return `backup prerequisites missing on the docker host: ${message}`;
  }
  return message;
}

function tailLines(text: string, lines: number): string {
  const clean = text.replace(/\n+$/, '').split('\n').filter((l) => l.trim() !== '');
  const tail = clean.slice(-lines).join(' · ');
  return resticErrorMessage(tail) ?? tail;
}

async function runSnapshotProbe(): Promise<ProbeResult> {
  const spec = buildBackupContainerSpec(process.env, 'probe');
  let id = '';
  try {
    id = await createContainer(spec);
    await startContainer(id);
    const code = await waitForContainer(id, PROBE_WAIT_MS);
    if (code === 99) {
      // staging host without /mnt/backup or /etc/homelab — the probe printed which
      const text = await getContainerLogs(id, 10);
      return {
        available: false,
        reason: tailLines(text, 1) || 'backup prerequisites missing on the docker host',
        lastSnapshot: null,
        count: null,
      };
    }
    if (code !== 0) {
      const text = await getContainerLogs(id, 5);
      return {
        available: true, // prerequisites OK; the repo itself is the problem
        reason: tailLines(text, 1) || `restic snapshots exited with code ${code}`,
        lastSnapshot: null,
        count: null,
      };
    }
    const out = await getContainerLogs(id, 500);
    const parsed = parseSnapshots(extractSnapshotsJson(out));
    return { available: true, ...parsed };
  } catch (error) {
    return { available: false, reason: errorMessage(error), lastSnapshot: null, count: null };
  } finally {
    if (id) await removeContainer(id).catch(() => {}); // AutoRemove is off: probes
  }
}

/** TTL-cached probe, deduplicated so a poll burst spawns one container. */
function probe(): Promise<ProbeResult> {
  if (probeCache && probeCache.expiresAt > Date.now()) return Promise.resolve(probeCache.value);
  if (!probeInFlight) {
    probeInFlight = runSnapshotProbe()
      .then((value) => {
        probeCache = { value, expiresAt: Date.now() + SNAPSHOT_TTL_MS };
        return value;
      })
      .finally(() => {
        probeInFlight = null;
      });
  }
  return probeInFlight;
}

/** Force the next status read to re-probe (e.g. after a backup finished). */
export function invalidateBackupSnapshotCache(): void {
  probeCache = null;
}

/**
 * Best-effort outcome capture for the fire-and-forget backup container.
 * AutoRemove usually wins the race for the logs; the exit code alone still
 * tells the UI "the backup failed" (G5: readable error, not a silent no-op).
 */
async function captureOutcome(id: string): Promise<void> {
  try {
    const exitCode = await waitForContainer(id, 0); // unbounded: backups take minutes
    let tail: string | null = null;
    try {
      tail = tailLines(await getContainerLogs(id, 12), 2);
    } catch {
      /* container already auto-removed — exit code is all we keep */
    }
    lastRun = { exitCode, finishedAt: new Date().toISOString(), tail };
    invalidateBackupSnapshotCache(); // lastSnapshot should reflect the new snapshot
  } catch {
    /* daemon died or the wait aborted — the next probe tells the truth */
  }
}

/**
 * The `backup` block of /api/status. Never throws: docker being down degrades
 * to available:false + 'docker unreachable', keeping review focus 3 intact.
 */
export async function getBackupStatus(): Promise<BackupStatus> {
  let containers: RawContainer[] | null = null;
  try {
    containers = await listContainers();
  } catch {
    /* docker down — probe below will fail too, and both get cached */
  }
  const result = await probe();
  const dockerDown = containers === null;
  return {
    running: containers ? manualBackupRunning(containers) : false,
    lastSnapshot: result.lastSnapshot,
    count: result.count,
    available: !dockerDown && result.available,
    reason: dockerDown ? 'docker unreachable' : result.reason,
    lastRun,
  };
}

export type BackupNowResult =
  | { status: 'started' }
  | { status: 'conflict'; message: string }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string };

/** POST /api/action/backup-now. Spawns the one-shot backup.sh container. */
export async function backupNow(): Promise<BackupNowResult> {
  let containers: RawContainer[];
  try {
    containers = await listContainers();
  } catch (error) {
    return { status: 'unavailable', message: `docker unreachable: ${errorMessage(error)}` };
  }
  if (manualBackupRunning(containers)) {
    return {
      status: 'conflict',
      message: `a manual backup is already running (${MANUAL_BACKUP_CONTAINER}) — wait for it to finish`,
    };
  }

  const result = await probe(); // prerequisites + repo reachable, cached
  if (!result.available) {
    return { status: 'unavailable', message: result.reason ?? 'backup unavailable' };
  }

  const spec = buildBackupContainerSpec(process.env, 'backup');
  let id: string;
  try {
    id = await createContainer(spec);
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 409) {
      // name held by a just-exited container whose AutoRemove hasn't landed
      return { status: 'conflict', message: 'the previous backup container is still being cleaned up — retry in a moment' };
    }
    return { status: 'error', message: `could not create the backup container: ${errorMessage(error)}` };
  }
  try {
    await startContainer(id);
  } catch (error) {
    await removeContainer(id).catch(() => {});
    return { status: 'unavailable', message: `could not start the backup container: ${errorMessage(error)}` };
  }

  lastRun = null; // a new run is in flight — drop the stale outcome
  void captureOutcome(id);
  return { status: 'started' };
}
