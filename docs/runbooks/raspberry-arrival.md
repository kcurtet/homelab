# Runbook: Raspberry Pi arrival + retarget from staging

> **STATUS: PENDING HARDWARE.** The final server (Raspberry Pi 5, 8 GB, SSD boot) has not been delivered yet. This checklist moves every phase from the staging host (`panther`, see `staging-host.md`) to the Pi — each phase's state lives in its own directory precisely so that retargeting is **copy + rerun, not archaeology**.

## 0. Arrival inspection — decision point

- [ ] Pi 5 8 GB boots; the SSD is detected (`lsblk`, `smartctl` if available).
- [ ] If the Pi arrives **broken or underdelivered** (wrong model, dead USB, RMA): fall back to the documented split — **Coolify stays on panther; the Pi takes only DNS/DHCP + backups** when replaced. If no Pi at all, panther keeps running everything until one arrives.

## 1. Base system

- [ ] Install Raspberry Pi OS **64-bit** on the SSD (not an SD card: Coolify's database and restic will hammer the storage).
- [ ] Static IP on the LAN (or DHCP reservation) — same idea as staging: stable address for ssh, docs and DNS.
- [ ] Bring it into the tailnet (`remote-access/tailscale.md`) and approve its subnet route for `192.168.1.0/24` in the admin console.
- [ ] Install Docker: `docs/runbooks/docker-host.md` (Debian path). Verify with `docker run --rm hello-world`.

## 2. Hosting (Coolify)

- [ ] `rsync` the repo checkout + `hosting/coolify/data/` from panther to the Pi (or fresh clone + restore `data/` only).
- [ ] `cp .env.example .env` on the Pi (fresh secrets: APP_KEY, DB_PASSWORD — do not copy staging secrets to the final host).
- [ ] `docker compose up -d`, re-register the server in the Coolify UI if the instance is fresh, redeploy apps from git.
- [ ] Decommission staging Coolify: `docker compose down -v` on panther **after** the Pi serves the same sites.

## 3. DNS/DHCP (Pi-hole) — only now, never before

- [ ] This is the only phase that must wait for the final host. Follow `docs/runbooks/dhcp-migration.md` end to end: verify the router resolves as DNS2 → Pi-hole DHCP ON → router DHCP OFF → per-device check → note the ad-leak trade-off.
- [ ] Family rule: the fallback is automatic (DNS2 = router). Nobody has to do anything if Pi-hole dies.

## 4. Backups

- [ ] Attach the USB backup disk to the Pi, mount by UUID at `/mnt/backup` (`backup/README.md`).
- [ ] Install the systemd units, create the password file, run one manual `backup.sh` and one **restore drill** before trusting it.
- [ ] Point `RESTIC_REPOSITORY` at the USB repo: if staging already created a restic repo on panther, either start fresh or copy the repo dir first and `restic check` it.

## 5. Decommission staging (eventually)

- [ ] When the Pi has been stable for a couple of weeks: stop the timer and Coolify on panther, remove Docker if the laptop returns to daily use.
- [ ] panther's `/data` USB disk is personal storage — untouched by all of this.
