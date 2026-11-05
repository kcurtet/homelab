/**
 * Pure backup logic (task 6): the spec of the one-shot container the
 * dashboard asks the Docker API to create, plus parsing of
 * `restic snapshots --json`. No IO here — backupRunner.ts executes this spec.
 *
 * Spec decision (002): the manual backup runs the repo's OWN
 * backup/restic/backup.sh inside the container — the SAME script the host's
 * systemd timer executes — so the backup scope is identical by construction.
 * The dashboard therefore never needs to know RESTIC_* values: the container
 * reads /etc/homelab/backup.env from its read-only mount (via the image's
 * entrypoint, which parses it as pure data). Nothing secret crosses the
 * Docker API or lands in a status response.
 */

/** Fixed name: existence of this container == a manual backup in flight. */
export const MANUAL_BACKUP_CONTAINER = 'homelab-backup-manual';

/**
 * Built with `podman build -f backup.Dockerfile -t homelab-backup dashboard/`
 * (localhost/ is podman's local registry; override with BACKUP_IMAGE, e.g.
 * when fronting a real docker daemon).
 */
export const DEFAULT_BACKUP_IMAGE = 'localhost/homelab-backup:latest';

/** restic cache lives on the /cache tmpfs — never inside the ro mounts. */
export const DEFAULT_CACHE_DIR = '/cache/restic';

/** process.env-shaped input (injected, so tests stay deterministic). */
export type BackupEnv = Record<string, string | undefined>;

/** Host-side sources of the four binds. Container sides are always fixed. */
export interface BackupBinds {
  repo: string;
  etc: string;
  mnt: string;
  home: string;
}

/**
 * Production binds are FIXED (spec): host /repo (the homelab checkout),
 * /etc/homelab, /mnt/backup, /home. The BACKUP_BIND_* overrides exist for
 * staging boxes and local dry-runs only — leave them unset in production.
 */
export function backupBinds(env: BackupEnv = {}): BackupBinds {
  return {
    repo: env.BACKUP_BIND_REPO?.trim() || '/repo',
    etc: env.BACKUP_BIND_ETC?.trim() || '/etc/homelab',
    mnt: env.BACKUP_BIND_MNT?.trim() || '/mnt/backup',
    home: env.BACKUP_BIND_HOME?.trim() || '/home',
  };
}

export type BackupSpecMode = 'backup' | 'snapshots' | 'probe';

/**
 * Probe = prerequisites + snapshots in one shot: 99 means a host path is
 * missing (staging case → 503 + disabled button, never an ugly mid-flight
 * failure); 0 means the JSON is on stdout. Paths are container-side (fixed).
 */
const PROBE_CMD = [
  '/bin/sh',
  '-c',
  'missing="";'
    + ' for p in /etc/homelab /etc/homelab/backup.env /mnt/backup /repo/backup/restic/backup.sh;'
    + ' do [ -e "$p" ] || missing="$missing $p"; done;'
    + ' [ -z "$missing" ] || { echo "backup prerequisites missing on the docker host:$missing" >&2; exit 99; };'
    + ' exec restic snapshots --json',
];

/** The subset of the Docker create-container API the runner submits. */
export interface BackupContainerSpec {
  Image: string;
  Name?: string;
  Cmd?: string[];
  Env: string[];
  Labels: Record<string, string>;
  HostConfig: {
    Binds: string[];
    AutoRemove: boolean;
    Tmpfs: Record<string, string>;
  };
}

export function buildBackupContainerSpec(env: BackupEnv = {}, mode: BackupSpecMode): BackupContainerSpec {
  const binds = backupBinds(env);
  const spec: BackupContainerSpec = {
    Image: env.BACKUP_IMAGE?.trim() || DEFAULT_BACKUP_IMAGE,
    Env: [`RESTIC_CACHE_DIR=${env.BACKUP_CACHE_DIR?.trim() || DEFAULT_CACHE_DIR}`],
    Labels: { 'homelab.dashboard': 'backup' },
    HostConfig: {
      // /mnt/backup is the only writable disk mount: restic needs to write
      // the repository; the repo, credentials and /home are read-only.
      Binds: [
        `${binds.repo}:/repo:ro`,
        `${binds.etc}:/etc/homelab:ro`,
        `${binds.mnt}:/mnt/backup:rw`,
        `${binds.home}:/home:ro`,
      ],
      AutoRemove: false,
      Tmpfs: { '/cache': 'rw,noexec,nosuid,size=512m' },
    },
  };

  if (mode === 'backup') {
    spec.Name = MANUAL_BACKUP_CONTAINER;
    spec.Labels['homelab.dashboard.mode'] = 'manual';
    // No Cmd: the image's own CMD runs /repo/backup/restic/backup.sh.
    spec.HostConfig.AutoRemove = true; // ephemeral: gone once it exits
  } else if (mode === 'snapshots') {
    spec.Cmd = ['restic', 'snapshots', '--json'];
  } else {
    spec.Cmd = PROBE_CMD;
  }
  return spec;
}

/* ---- snapshots parsing --------------------------------------------------- */

export interface SnapshotsInfo {
  lastSnapshot: string | null; // UTC ISO of the newest snapshot
  count: number;
}

/**
 * restic emits RFC3339 with up to nanosecond fractions ("…T20:44:51.818548346+01:00")
 * which Date.parse may reject — trim the fraction to milliseconds first.
 */
function normalizeTime(raw: string): string | null {
  const trimmed = raw.replace(/(\.\d{3})\d+/, '$1');
  const ms = new Date(trimmed).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** `restic snapshots --json` → {lastSnapshot, count}. Total: garbage → nulls. */
export function parseSnapshots(json: unknown): SnapshotsInfo {
  if (!Array.isArray(json)) return { lastSnapshot: null, count: 0 };
  let last: string | null = null;
  let lastMs = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const entry of json) {
    if (typeof entry !== 'object' || entry === null) continue;
    const time = (entry as Record<string, unknown>).time;
    if (typeof time !== 'string') continue;
    const iso = normalizeTime(time);
    if (iso === null) continue;
    count += 1;
    const ms = new Date(iso).getTime();
    if (ms > lastMs) {
      lastMs = ms;
      last = iso;
    }
  }
  return { lastSnapshot: last, count };
}

/**
 * Pull the JSON array out of container logs (restic can prefix warnings to
 * stderr; the demuxed stream joins both). Returns null when no array parses.
 */
export function extractSnapshotsJson(text: string): unknown {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * restic prints failures as one JSON line ({message_type:"exit_error",…}) —
 * surface its human `message` instead of the raw JSON in UI notes.
 * Returns null when the line is not a restic JSON error.
 */
export function resticErrorMessage(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as { message_type?: string; message?: string };
    if (parsed.message_type !== 'exit_error' || typeof parsed.message !== 'string') return null;
    return parsed.message;
  } catch {
    return null;
  }
}

/* ---- status shape (built impurely by backupRunner, typed here) ---------- */

export interface BackupRunOutcome {
  exitCode: number;
  finishedAt: string; // ISO
  tail: string | null; // last log lines, when they survived AutoRemove
}

export interface BackupStatus {
  running: boolean;
  lastSnapshot: string | null;
  /** null = unknown (probe failed); 0 = healthy empty repo. */
  count: number | null;
  /** false → prerequisites missing (503 on backup-now, disabled button). */
  available: boolean;
  reason?: string;
  /** Outcome of the last manual run, best effort (AutoRemove eats logs). */
  lastRun?: BackupRunOutcome | null;
}
