# Runbook: staging host (panther) — Debian 13 install

`panther` is the temporary staging server: an always-on laptop that validates every phase until the Raspberry Pi arrives. It ran CachyOS, but a rolling-release distro is the wrong tool for an unattended server — after an interrupted update left it booting read-only snapshots, it was reinstalled as **Debian 13 (trixie), ext4, no desktop**. Boring on purpose.

## Why these choices

- **Debian stable**: security updates only, no rolling-update breakage on a headless box.
- **ext4, guided partitioning**: no snapper/snapshot machinery to misboot into. The btrfs incident is documented in the [pacman db.lck note](https://kcurtet.com/notas/pacman-db-lck-solo-lectura/) (Spanish).
- **Static IP** `192.168.1.100`: the ssh alias, runbooks and docs keep working across reinstalls.

## Installer answers (netinstall)

1. Boot the USB, choose **Graphical or plain install** — either works.
2. Hostname: `panther`. Domain: leave empty.
3. Users: your user (e.g. `kx`); when asked, make it administrator (sudo group).
4. Partitioning: **Guided — use entire disk**, all files in one partition (ext4). Swap as offered.
5. Network (if not offered automatically, configure manually when the installer reaches the mirror step):
   - IP: `192.168.1.100/24`, gateway `192.168.1.1`
   - DNS: `192.168.1.1` (the router — this is intentional: AdGuard Home does not exist yet, and when it does, this host should still resolve even if AdGuard Home is down)
6. Package selection (tasksel): **SSH server + standard system utilities**. Nothing else — no desktop.
7. GRUB to the primary disk (the NVMe, not the external USB data disk).

## First boot (from the console, once)

Authorize the admin machine's key so the lab can drive this host over ssh:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "<contents of the admin machine's ~/.ssh/id_kx.pub>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

## Then, from the admin machine

```bash
ssh panther-wifi 'cat /etc/debian_version'   # expect: 13.x
```

Continue with `docker-host.md` (Debian path) to prepare the container runtime.
