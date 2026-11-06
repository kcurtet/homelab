# Spec: Homelab Rebuild

## Context and intent

The public site [kcurtet.com/proyectos/homelab](https://kcurtet.com/proyectos/homelab/) describes a real home lab: AdGuard Home as house-wide DNS+DHCP, Tailscale + Wake-on-LAN for remote access, Coolify/Dokku hosting published through a Cloudflare Tunnel with Let's Encrypt certs, and backups to an old USB disk. That setup must now be rebuilt as a **reproducible, public GitHub repo** (`kcurtet/homelab`): compose files + scripts + documentation that explain the *why* of each decision. The repo doubles as portfolio material for an IT-support job search.

This rebuild is not a literal copy: known weak points of the original are replaced by better designs (see "Improvements over the article").

Hardware reality:

- **Final home server**: a Raspberry Pi 5, 8 GB RAM, SSD boot — **confirmed by user**, not yet delivered. Nothing may depend on it being present.
- **Temporary staging**: `panther` — a CachyOS laptop (16 GB RAM, ~110 GB free), always on, SSH reachable as `panther-wifi` (192.168.1.100). Currently has **no Docker**.
- **Dev machine**: `lynx` (CachyOS laptop), where the repo is written.

Existing assets: a live Tailscale tailnet (`<your-tailnet>.ts.net`) with `panther` already joined. No Cloudflare account/domain confirmed yet — everything Cloudflare-related must work as documented placeholders until then.

## Improvements over the article

The original design's fallback for "AdGuard Home is down" was a second Wi-Fi SSID that bypassed it — a manual workaround ("apaño") that also required family members to switch networks. It is **dropped**. This router cannot provide a second SSID on the LAN anyway (guest network has client isolation).

Replacements applied in this rebuild:

1. **Automatic DNS failover instead of fallback Wi-Fi.** AdGuard Home's DHCP hands out AdGuard Home as primary DNS and the router as secondary (DHCP option 6, seeded into `AdGuardHome.yaml`). If AdGuard Home dies, clients fail over by themselves; the household keeps internet (ads return until fixed). Nobody switches anything, nobody waits for the helpdesk. Trade-off documented: some clients occasionally use the secondary resolver, leaking ads; acceptable.
2. **Wake-on-LAN demoted to educational.** All current machines are laptops (panther reached over Wi-Fi), so WoL has no verifiable target today. The script and docs remain as a learning piece, clearly labeled, not as a operated feature.

## Objectives

1. A public repo where `docker compose up` (plus documented manual steps) brings up each lab service on any Linux box with Docker.
2. Every piece carries documentation explaining why it exists and what it teaches — same spirit as the article.
3. Each phase is independently verifiable and leaves no permanent mark on the temporary staging host that can't be retargeted to the Raspberry later.

## Non-objectives

- Managing the family router automatically (router-side steps are a runbook, not code).
- Dokku (article mentions it; Coolify alone was chosen — Dokku may be added later as a separate decision).
- A custom Certificate Authority (article presents it as past learning; Let's Encrypt via Coolify replaces it).
- Kubernetes or anything heavier than compose.
- Operating WoL against real targets (educational only).

## Anti-objectives

- No real secrets, tokens, MACs of family devices, or home IPs in the public repo. `.env.example` placeholders only.
- No opening router ports, ever. Remote access is Tailscale/tunnels only.
- Do not take over the house DHCP until the Raspberry is on-site and DNS failover to the router has been verified (family helpdesk rule: if resolution dies, "the internet is down" for three people).

## Phases (build order)

Phase order is by blast radius: things that only touch disposable hosts first, the shared home network last.

### Phase 0 — Repo foundation

- `git init` (done), README (English) introducing the lab, topology diagram (ASCII or Mermaid), link to the article.
- Directory per concern: `hosting/`, `remote-access/`, `network/`, `backup/`, plus `docs/` for runbooks.
- `.env.example` per deployable piece; `.gitignore` covers `.env` everywhere and runtime data dirs (`**/data/`).
- LICENSE: MIT.

### Phase 1 — Hosting (validated on panther)

- `hosting/coolify/docker-compose.yml`: standard Coolify install, data paths under `hosting/coolify/data/` (gitignored) so the whole phase is one directory to move.
- Let's Encrypt: handled inside Coolify; documented with a placeholder wildcard/app domain.
- `docs/runbooks/hosting.md`: install Docker on target host, bring Coolify up, deploy a sample static site via git push, tear everything down (`docker compose down -v` removes all compose traces; the Docker install itself stays).
- Cloudflare Tunnel: documented as the publishing path (`cloudflared` as a Coolify-managed service or standalone compose, token via `TUNNEL_TOKEN` in `.env`). Inert until an account exists.

### Phase 2 — Remote access

- `remote-access/tailscale.md`: joining the existing tailnet, enabling SSH over Tailscale, running a subnet router on the final server.
- `remote-access/wol/wake`: small script (ether-wake or `wakeonlan`) taking target MAC/host from `.env`; `wol.md` documents BIOS/UEFI + `ethtool` enabling steps and the design note that magic packets need an always-on wired sender. Labeled educational: no target is expected to wake during verification.

### Phase 3 — House DNS/DHCP (Raspberry era)

- `network/adguardhome/`: AdGuard Home with DHCP enabled (ranges, lease times as `.env`), host networking for DHCP broadcasts. Config is YAML-driven (no env-var configuration): a committed generator (`generate-config.sh`) seeds `AdGuardHome.yaml` from `.env` for reproducible first boots.
- **DNS failover design**: DHCP advertises AdGuard Home as DNS1 and the router as DNS2 (option 6 with the host's literal LAN IP — no self-referencing placeholder). Verify ad-blocking still routes through AdGuard Home in the normal case; document the ad-leak trade-off during failover.
- `docs/runbooks/dhcp-migration.md`: order of operations — verify router answers DNS as secondary → enable AdGuard Home DHCP → disable router DHCP → per-device verification. Includes the rollback path (re-enable router DHCP, clients re-lease).

### Phase 4 — Backups

- **Scope**: lab state (`hosting/coolify/data/`, AdGuard Home config, the repo itself) **plus** `/home` of the server. Nothing else — no rootfs imaging.
- `backup/restic/`: systemd service + timer (or cron script) snapshots to a mounted USB disk, password via `.env`/file with `chmod 600`; `forget --prune` policy (e.g. keep 7 daily / 4 weekly / 6 monthly); `backup/README.md` with the restore runbook — a backup without a tested restore is decoration.
- Timer runs on whichever host holds the data: panther during staging, the Raspberry in the end state. The USB disk travels with it.

## Acceptance criteria

Given/When/Then per phase, verified on the real target before the phase is called done:

- **P0**: Given a fresh clone, When I read README alone, Then I know what this lab is, its topology, and which phase to start with.
- **P1**: Given panther with Docker installed, When I follow `hosting.md`, Then Coolify is up, a sample site deploys via git push, and `docker compose down -v` removes all compose traces. Cloudflare section stays clearly "pending account".
- **P2**: Given `.env` with a MAC, When I run `remote-access/wol/wake`, Then the script emits the packet and exits 0, with docs noting no wake is expected (educational). Tailscale doc verified against the live tailnet.
- **P3**: Given the Raspberry on the LAN, When the migration runbook is followed, Then clients get IPs+DNS from AdGuard Home, the router resolves as secondary, and stopping the adguardhome container leaves clients with working internet (ads back) within one lease/DNS retry. Until then this phase is docs+compose only, never applied.
- **P4**: Given the USB disk mounted, When the timer fires, Then a restic snapshot of lab state + `/home` lands, `restic snapshots` lists it, and a test file restores to a temp dir.

## Edge cases

- Two DHCP servers alive at once (router + AdGuard Home) during migration → runbook treats this as the dangerous window, steps ordered to minimize it.
- AdGuard Home down → clients fail over to router DNS automatically; family sees ads, not an outage. Documented symptom-to-fix map for the helpdesk (me).
- Occasional use of the secondary resolver leaks ads in normal operation → documented trade-off of the failover design; not a bug.
- panther is temporary: every phase's state must live in its own directory/volume so retargeting to the Raspberry is copy + rerun, not archaeology.
- Pi underdelivers or arrives broken → Coolify may stay on panther and the Pi takes only DNS+backups; decision point written into the Raspberry arrival checklist.
- Public repo: secrets only via `.env`; MAC addresses of lab machines are fine, family devices are not.

## Implementation decisions (already taken)

- Coolify over Dokku (single-operator ergonomics, built-in Let's Encrypt + proxy).
- English documentation, Spanish article linked as origin story.
- restic for backups; scope = lab state + `/home` of the server.
- Repo name `homelab`, remote `github.com/kcurtet/homelab`.
- Phased rollout, home network last.
- Fallback Wi-Fi dropped; automatic DNS failover via DHCP (AdGuard Home primary, router secondary) replaces it.
- WoL kept as educational script/docs only.
- Raspberry Pi 5 8 GB + SSD, confirmed by user. Plan tolerates a weaker Pi only as contingency (see edge cases).

## Left to the builder

- Exact Coolify compose shape (pin to the official installer's versions).
- AdGuard Home config schema, DHCP option syntax, and how to advertise DNS2 = router.
- restic timer unit specifics and USB mount convention (`/mnt/backup` suggested).
- Whether `wol` uses `wakeonlan` or `ether-wake` (availability on Arch/CachyOS).
