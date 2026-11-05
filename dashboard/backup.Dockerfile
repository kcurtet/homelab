# syntax=docker/dockerfile:1

# Manual-backup runner (task 6): bash + restic on small Alpine. It runs the
# repo's OWN backup/restic/backup.sh (bind-mounted at /repo) UNCHANGED — the
# same script the host's systemd timer executes, so the backup scope is
# identical by construction (spec 002: "same source of truth").
#
# Everything the script needs arrives as mounts decided by the dashboard's
# buildBackupContainerSpec() (dashboard/src/lib/backup.ts):
#   /repo          homelab checkout (ro)          — script + BACKUP_PATHS
#   /etc/homelab   backup.env + restic.pass (ro)  — same config as the timer
#   /mnt/backup    restic repository (rw)         — the only writable disk mount
#   /cache         tmpfs                          — RESTIC_CACHE_DIR=/cache/restic
#
# Pinning decision: exact apk versions on a pinned Alpine minor. A floating
# "restic" would silently drift with the distro; an exact pin fails the build
# loudly instead of ever backing up with an unvetted restic. (Rejected
# alternative: static restic binary from GitHub releases + sha256 checksum —
# arch-specific per release artifact and manual to bump; apk resolves the
# right arch and lets the whole image be reproduced from the pin.)
FROM alpine:3.22

RUN apk add --no-cache \
      bash=5.2.37-r0 \
      restic=0.18.0-r7 \
      ca-certificates=20261020-r0

COPY backup-entrypoint.sh /usr/local/bin/backup-entrypoint.sh
RUN chmod 0755 /usr/local/bin/backup-entrypoint.sh \
 && restic version

# restic must never write cache into the read-only mounts; the dashboard's
# spec sends RESTIC_CACHE_DIR too — the default here covers manual `podman run`.
ENV RESTIC_CACHE_DIR=/cache/restic

# The entrypoint loads /etc/homelab/backup.env (pure data, never sourced) and
# execs CMD; the default CMD is the repo's script. Override CMD (not the
# entrypoint) for read-only modes like `restic snapshots --json`.
ENTRYPOINT ["/usr/local/bin/backup-entrypoint.sh"]
CMD ["/bin/bash", "/repo/backup/restic/backup.sh"]
