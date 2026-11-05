import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKUP_IMAGE,
  MANUAL_BACKUP_CONTAINER,
  buildBackupContainerSpec,
  extractSnapshotsJson,
  parseSnapshots,
  resticErrorMessage,
} from './backup';

/**
 * Task 6 pure logic: the container spec the dashboard asks the Docker API to
 * create, and the parsing of `restic snapshots --json`. No IO here — the
 * runner (backupRunner.ts) executes this spec, these tests pin its shape.
 */
describe('buildBackupContainerSpec', () => {
  it('backup mode: fixed image, fixed name, image CMD (backup.sh), AutoRemove', () => {
    const spec = buildBackupContainerSpec({}, 'backup');
    expect(spec.Image).toBe(DEFAULT_BACKUP_IMAGE);
    expect(spec.Name).toBe(MANUAL_BACKUP_CONTAINER);
    // No Cmd: the image's own CMD runs /repo/backup/restic/backup.sh — the
    // same script the systemd timer uses, unchanged (spec: same source of
    // truth, scope identical by construction).
    expect(spec.Cmd).toBeUndefined();
    expect(spec.HostConfig.AutoRemove).toBe(true); // ephemeral one-shot
  });

  it('mounts the four production binds: repo ro, /etc/homelab ro, /mnt/backup rw, /home ro', () => {
    const spec = buildBackupContainerSpec({}, 'backup');
    expect(spec.HostConfig.Binds).toEqual([
      '/repo:/repo:ro',
      '/etc/homelab:/etc/homelab:ro',
      '/mnt/backup:/mnt/backup:rw',
      '/home:/home:ro',
    ]);
  });

  it('sends restic cache to a tmpfs-backed dir and NOTHING else — no secrets cross the API', () => {
    const spec = buildBackupContainerSpec({}, 'backup');
    // The container reads /etc/homelab/backup.env from its mount; the
    // dashboard never sees RESTIC_* values, so it cannot leak them.
    expect(spec.Env).toEqual(['RESTIC_CACHE_DIR=/cache/restic']);
    // /cache is a tmpfs: restic never writes cache into the ro mounts.
    expect(spec.HostConfig.Tmpfs['/cache']).toBeDefined();
  });

  it('host-side bind sources are overridable for staging/dry-runs (prod keeps the fixed binds)', () => {
    const spec = buildBackupContainerSpec(
      {
        BACKUP_BIND_REPO: '/tmp/dash-t6/repo',
        BACKUP_BIND_ETC: '/tmp/dash-t6/etc-homelab',
        BACKUP_BIND_MNT: '/tmp/dash-t6/mnt-backup',
        BACKUP_BIND_HOME: '/tmp/dash-t6/home',
        BACKUP_IMAGE: 'localhost/homelab-backup:test',
        BACKUP_CACHE_DIR: '/cache/x',
      },
      'backup',
    );
    expect(spec.Image).toBe('localhost/homelab-backup:test');
    expect(spec.HostConfig.Binds).toEqual([
      '/tmp/dash-t6/repo:/repo:ro',
      '/tmp/dash-t6/etc-homelab:/etc/homelab:ro',
      '/tmp/dash-t6/mnt-backup:/mnt/backup:rw',
      '/tmp/dash-t6/home:/home:ro',
    ]);
    expect(spec.Env).toEqual(['RESTIC_CACHE_DIR=/cache/x']);
  });

  it('snapshots mode: cmd override, anonymous (no Name), no AutoRemove', () => {
    const spec = buildBackupContainerSpec({}, 'snapshots');
    expect(spec.Cmd).toEqual(['restic', 'snapshots', '--json']);
    expect(spec.Name).toBeUndefined();
    expect(spec.HostConfig.AutoRemove).toBe(false); // runner reads logs after wait
  });

  it('probe mode: checks host prerequisites then execs restic snapshots', () => {
    const spec = buildBackupContainerSpec({}, 'probe');
    expect(spec.Cmd?.[0]).toBe('/bin/sh');
    const script = spec.Cmd?.[2] ?? '';
    // 99 = prerequisites missing on the host (staging case → 503 + disabled UI)
    expect(script).toContain('exit 99');
    expect(script).toContain('restic snapshots --json');
    // every mount the script/checks rely on, on the CONTAINER side (fixed)
    expect(script).toContain('/etc/homelab/backup.env');
    expect(script).toContain('/mnt/backup');
    expect(script).toContain('/repo/backup/restic/backup.sh');
    expect(spec.HostConfig.AutoRemove).toBe(false);
  });
});

describe('parseSnapshots', () => {
  it('empty repo → no last snapshot, count 0', () => {
    expect(parseSnapshots([])).toEqual({ lastSnapshot: null, count: 0 });
  });

  it('one snapshot → its time as UTC ISO', () => {
    const out = parseSnapshots([
      { id: 'a', time: '2025-11-05T20:44:51.818548346+01:00', paths: ['/repo'] },
    ]);
    expect(out.count).toBe(1);
    expect(out.lastSnapshot).toBe('2025-11-05T19:44:51.818Z');
  });

  it('multiple unsorted snapshots → the newest wins, count keeps all', () => {
    const out = parseSnapshots([
      { time: '2025-11-05T10:00:00Z' },
      { time: '2025-11-07T22:00:00Z' },
      { time: '2025-10-31T08:00:00Z' },
    ]);
    expect(out.count).toBe(3);
    expect(out.lastSnapshot).toBe('2025-11-07T22:00:00.000Z');
  });

  it('entries without a usable time are skipped, not fatal', () => {
    const out = parseSnapshots([{ id: 'x' }, { time: 'not-a-date' }, { time: '2025-11-05T10:00:00Z' }]);
    expect(out.count).toBe(1);
    expect(out.lastSnapshot).toBe('2025-11-05T10:00:00.000Z');
  });

  it('garbage input (lock errors, html, null) → null/0, never throws', () => {
    expect(parseSnapshots(null)).toEqual({ lastSnapshot: null, count: 0 });
    expect(parseSnapshots('repository is already locked')).toEqual({ lastSnapshot: null, count: 0 });
    expect(parseSnapshots({})).toEqual({ lastSnapshot: null, count: 0 });
  });
});

describe('extractSnapshotsJson', () => {
  it('pulls the JSON array out of log noise on surrounding lines', () => {
    const text =
      'using parent snapshot ffd21ce2\n[{"time":"2025-11-05T10:00:00Z","id":"a"}]\n';
    expect(extractSnapshotsJson(text)).toEqual([{ time: '2025-11-05T10:00:00Z', id: 'a' }]);
  });

  it('returns null when no array is present', () => {
    expect(extractSnapshotsJson('Fatal: wrong password')).toBeNull();
    expect(extractSnapshotsJson('')).toBeNull();
  });
});

describe('resticErrorMessage', () => {
  it('extracts the human message from a restic exit_error JSON line', () => {
    expect(
      resticErrorMessage(
        '{"message_type":"exit_error","code":10,"message":"Fatal: repository does not exist"}',
      ),
    ).toBe('Fatal: repository does not exist');
  });

  it('leaves plain log lines alone', () => {
    expect(resticErrorMessage('repository is already locked')).toBeNull();
    expect(resticErrorMessage('')).toBeNull();
    expect(resticErrorMessage('{"other":"json"}')).toBeNull();
  });
});
