# Backups (restic)

Nightly restic snapshots of the homelab to a USB disk, with a tested restore
path. Scope is fixed by the spec: **lab state + the repo + `/home` of the host
running the timer** — nothing else.

> A backup without a tested restore is decoration. The restore runbook below
> is part of this feature, not an appendix.

## What gets backed up (and why nothing else)

| Source | What it is | Notes |
|---|---|---|
| `hosting/coolify/data/` | Coolify state: apps, deployments, webhooks | The lab's crown jewels |
| `network/adguardhome/data/` | AdGuard Home config + state | Raspberry era; tiny (or absent) until then |
| `.` (this repo) | The lab definition itself | Infrastructure as code |
| `/home` | Home dirs of the backup host | The irreplaceable part |

No rootfs imaging: the OS is reproducible from this repo + the runbooks in
`docs/runbooks/`. Rebuilding an OS is an afternoon; `/home` and app state are
not. restic deduplicates and encrypts, so the small scope keeps the USB disk
useful for years.

## Components

| File | Role |
|---|---|
| `backup/.env.example` | Template for the configuration (repo + password file + scope) |
| `restic/backup.sh` | Snapshots `BACKUP_PATHS`, initializes the repo on first run |
| `restic/forget.sh` | Applies the retention policy (`--prune`) |
| `restic/homelab-backup.service` | `Type=oneshot` unit: backup then retention |
| `restic/homelab-backup.timer` | Nightly trigger: `03:00`, `Persistent=true`, `RandomizedDelaySec=15m` |

Both scripts read configuration with the same precedence: **environment
variables first** (systemd's `EnvironmentFile=`, or manual exports), then
`backup/.env` (gitignored) for manual runs. The `.env` file is parsed as pure
`KEY=VALUE` data — never sourced, never evaluated.

## Setup (on the backup host: panther for staging, the Raspberry in the end state)

### 1. Mount the USB disk at /mnt/backup (by UUID)

```bash
lsblk -f                       # note the UUID of the backup partition
sudo mkdir -p /mnt/backup
sudo tee -a /etc/fstab <<< 'UUID=your-uuid-here  /mnt/backup  ext4  defaults,nofail  0  2'
sudo systemctl daemon-reload
sudo mount /mnt/backup
```

Mounting by UUID survives re-plugging and disk swaps that change `/dev/sdX`
names. `nofail` keeps the host booting if the USB disk is absent — a missing
backup target must not take down the DNS/DHCP server for the house.

### 2. Generate the repository password

```bash
sudo install -d -m 700 /etc/homelab
sudo sh -c 'umask 077; head -c 32 /dev/urandom | base64 > /etc/homelab/restic.pass'
sudo chmod 600 /etc/homelab/restic.pass
```

The password lives **outside the repo** (the repo is public) and the scripts
refuse to run if the file is looser than `600`. Losing this file means losing
every backup — store one offline copy (password manager, printed).

### 3. Create the environment file(s)

For the systemd units — copy the example, adjust, tighten permissions:

```bash
sudo cp backup/.env.example /etc/homelab/backup.env
sudo chmod 600 /etc/homelab/backup.env
sudo vi /etc/homelab/backup.env     # set RESTIC_REPOSITORY, password file, paths
```

> systemd does **not** read `backup/.env` from the repo. `/etc/homelab/backup.env`
> is the single source of truth for the units.

For manual runs, the same content can go to `backup/.env` (gitignored) — or
just export the variables inline, as in the restore runbook below.

**Staging note:** before the USB disk travels with the lab, `RESTIC_REPOSITORY`
may point at a plain local directory (e.g. `/var/backups/homelab.restic`).
restic treats a local dir and a mounted disk identically; only the mount step
differs.

### 4. Install the systemd units

The units assume the repo is checked out at `/opt/homelab`; adjust the
`ExecStart`/`ExecStartPost` paths if yours lives elsewhere.

```bash
sudo cp backup/restic/homelab-backup.service backup/restic/homelab-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now homelab-backup.timer
systemctl list-timers homelab-backup.timer    # NEXT shows ~tomorrow 03:00
```

First run (also the smoke test after any config change):

```bash
sudo systemctl start homelab-backup.service
journalctl -u homelab-backup.service -n 30    # backup + forget output
```

## Retention policy

| Rule | Keep | Rationale |
|---|---|---|
| `--keep-daily` | 7 | Cover a bad change noticed within the week |
| `--keep-weekly` | 4 | A month of coarse history |
| `--keep-monthly` | 6 | Half a year of "what did this look like in March" |
| `--prune` | — | Reclaim USB space immediately, not "later" |

`forget.sh` runs as `ExecStartPost` after every successful snapshot, so the
policy can never drift behind the data. restic groups snapshots by host +
paths, so after the panther → Raspberry migration the old staging snapshots
age out on their own schedule.

## Restore runbook

The moment you actually need backups is the worst time to learn the tool.
Walk this path once now, while calm.

```bash
# 0. Preconditions: USB disk mounted, password file in place.
mount | grep /mnt/backup
sudo ls -l /etc/homelab/restic.pass    # must be -rw------- root root

# 1. Point restic at the repository (root: the password file is 600/root).
sudo -s
export RESTIC_REPOSITORY=/mnt/backup/homelab.restic
export RESTIC_PASSWORD_FILE=/etc/homelab/restic.pass

# 2. List snapshots — pick one (IDs shorten as far as unique).
restic snapshots

# 3. Restore the latest snapshot to a scratch dir. NEVER --target /
#    or /home directly: restore to /tmp and move deliberately.
restic restore latest --target /tmp/verify

# 4. Verify what you care about against the live copy.
diff -r /tmp/verify/home/USER/somedir /home/USER/somedir
restic dump latest /home/USER/.bashrc | diff - /home/USER/.bashrc   # single file

# 5. Only then copy into place, e.g.:
#    rsync -av /tmp/verify/home/USER/ /home/USER/
exit    # leave the root shell
```

### Restore drill (run it every month or two)

A restore that has never been executed is a hypothesis, not a procedure:

```bash
echo "restore drill $(date -Is)" > ~/restore-drill.txt
sudo systemctl start homelab-backup.service        # snapshot it now
sudo -s
export RESTIC_REPOSITORY=/mnt/backup/homelab.restic
export RESTIC_PASSWORD_FILE=/etc/homelab/restic.pass
restic restore latest --target /tmp/verify --include "/home/YOURUSER/restore-drill.txt"
diff /tmp/verify/home/YOURUSER/restore-drill.txt /home/YOURUSER/restore-drill.txt
rm -rf /tmp/verify; exit
```

If the `diff` is clean, the chain snapshot → list → restore → verify works.
If it is not clean, the backup is decoration — fix it before you need it.

## Status

- Scripts and units verified with a local dry run (init → snapshot → restore
  → diff → forget) on the dev machine.
- Live validation on `panther` (staging host) is **deferred**: panther is
  being reinstalled as a Debian server. Re-run the dry run there after
  reinstall, then enable the timer pointing at a local-dir repository until
  the USB disk moves to the Raspberry.
