# Runbook: DHCP migration to AdGuard Home (house DNS/DHCP era)

> **STATUS: BUILT, NOT APPLIED.** This runbook is the activation path for
> `network/adguardhome/` and may only be executed when the **Raspberry Pi 5 is
> on the LAN and stable**. **NEVER on staging (panther or any laptop):** a
> second DHCP server on the house network can break connectivity for every
> device (spec anti-objective; family helpdesk rule — if resolution dies, "the
> internet is down" for three people). Nothing here is automated: router-side
> steps are manual by design.

> Note: this stack runs under compose project `network` (see its `docker-compose.yml`).

## What this implements (and why)

Spec, "Improvements over the article" #1: the original setup had no fallback —
AdGuard Home was the only DNS, so "AdGuard Home is down" meant "no internet"
for the whole house. This design adds **automatic DNS failover**:

- AdGuard Home's DHCP hands out leases with **DNS1 = the AdGuard Home host**
  and **DNS2 = the router**, via `dhcp.dhcpv4.options` in `AdGuardHome.yaml`
  (the pre-seeded line `6 ips <host>,<router>`; see
  [the official DHCP docs](https://github.com/AdguardTeam/AdGuardHome/wiki/DHCP)).
  Option 6 takes literal IPv4 addresses only — there is no
  self-referencing placeholder — so the host's **real LAN IP** must be baked
  in: that is `ADGUARD_HOST_IP` in `.env`, wired into the seed by
  `generate-config.sh`. The official docs warn that when defining
  option 6 you must include AdGuard Home's own address, or DHCP clients will
  bypass its filtering — the seed puts it first (DNS1).
- AdGuard Home dies → clients fall back to the router on their own → the
  household keeps internet. Nobody switches networks; ads return until
  AdGuard Home is fixed.

### MANDATORY: ad-leak trade-off (this is by design, not a bug)

Some clients (notably Android/Chrome devices, and anything using Happy
Eyeballs-style racing) query the **secondary** resolver occasionally even in
normal operation. Those queries bypass AdGuard Home, so **some ads will slip
through even while everything is healthy**. This is the accepted cost of the
failover design — the alternative (advertising AdGuard Home as the only
resolver) restores 100 % blocking but turns "AdGuard Home down" into
"internet down".

Expected symptom, expected answer:

| Symptom | Cause | Action |
| --- | --- | --- |
| One device shows ads, everything else blocked | That device used DNS2 (router) | None — accepted trade-off. Optionally re-check the device's DNS settings. |
| **All** devices show ads, internet works | Clients failed over to the router (AdGuard Home down) | Fix AdGuard Home; clients drift back to DNS1 automatically. |
| Internet dead for everyone | Not failover — check the router/ISP | Router-side troubleshooting. |

If the ad-leak trade-off ever becomes unacceptable, revisit the design
(e.g. DHCP advertising only AdGuard Home) — do **not** paper over it client by
client.

## Prerequisites

1. **Raspberry Pi 5 running the stack** (`network/adguardhome/` seeded, up,
   healthy — `docker compose ps` shows healthy; web UI reachable at
   `http://<host>:3000` and the admin login works). Staging hosts need not
   apply (see header).
2. **Static IP for the server** (DHCP reservation on the router or static
   config). DNS1 in every lease points at this address; if it changes, the
   whole house silently loses its primary DNS. The seeded option-6 line must
   carry exactly this IP — check it:

   ```console
   $ grep -A2 'options:' network/adguardhome/data/conf/AdGuardHome.yaml
   options:
     - 6 ips 192.168.1.10,192.168.1.1   # <- DNS1 must be THIS host's real IP
   ```

   If the host's IP differs from the seed, fix `ADGUARD_HOST_IP` in `.env`
   and re-seed **while the container is stopped** (see step 1 below).

3. **The router resolves DNS on its own** — it must be a usable secondary:

   ```console
   $ dig @192.168.1.1 example.com +short   # adjust to your router's LAN IP
   93.184.216.34
   ```

   Must return an answer **without AdGuard Home running**. If the router only
   forwards to AdGuard Home (common if it was configured that way in the
   past), failover would be circular: fix that first (router DNS = ISP or
   public).
4. Router's DHCP pool and the AdGuard Home pool (`ADGUARD_DHCP_START/END` in
   `.env`, mirrored into the seeded yaml) do not overlap, and neither contains
   the router's or the server's IP.
5. **The seeded dhcpv4 block matches your LAN** (pool, gateway, subnet mask,
   option-6 pair). This block lives in `network/adguardhome/data/conf/
   AdGuardHome.yaml` — inspect it with the container stopped (see below for
   why stopped).

## Migration order (the two-DHCP window is the dangerous one)

Two DHCP servers answering on the same LAN = clients get random leases from
either one. The order below keeps that window to minutes and ends with a
verified client before the router's server is switched off.

### 1. Reconcile the config while the container is STOPPED

AdGuard Home's yaml may only be edited while the container is stopped — the
running app overwrites concurrent edits
([official Docker KB](https://adguard-dns.io/kb/adguard-home/docker/)). So do
all config reconciliation before opening the window:

```console
$ cd network/adguardhome
$ docker compose stop
$ $EDITOR .env          # ADGUARD_DHCP_START/END, ADGUARD_DHCP_GATEWAY, ADGUARD_HOST_IP, ADGUARD_DNS2_ROUTER
$ ./generate-config.sh --force    # re-seed from .env (resets UI-era changes!)
```

`--force` resets the whole config to the seed — fine before the first
takeover (fresh install); if you have UI-era changes worth keeping, edit the
`dhcp:` block of `data/conf/AdGuardHome.yaml` by hand instead. Either way,
before continuing, confirm the seed state:

```console
$ grep -B1 -A16 '^dhcp:' data/conf/AdGuardHome.yaml
dhcp:
  enabled: false        # still off — enabled in step 2
  ...
    options:
      - 6 ips 192.168.1.10,192.168.1.1   # DNS1 = this host, DNS2 = router
$ docker compose up -d
```

### 2. Enable AdGuard Home's DHCP (start of the dangerous window)

The natural path is the web UI (**Settings → DHCP server**):

1. **Select DHCP interface** — the host's LAN interface (`eth0` on the
   Raspberry; the seeded `ADGUARD_INTERFACE`).
2. Tick **Enable DHCP server**.
3. Check the **DHCP IPv4 Settings** shown against the seed (gateway, subnet,
   range start/end, lease time) and **Save**.

The DNS failover pair is **not visible or editable in the UI** — the
`dhcp.dhcpv4.options` array is one of the parameters the dashboard cannot set
(official DHCP docs) — but it is not lost either: saving DHCP settings from
the UI/API round-trips the yaml and preserves the pre-seeded option-6 line
(verified against v0.107.80: `enabled: true` was written while
`options: [6 ips host,router]` survived untouched).

The equivalent yaml-only path (if you prefer no UI): stop the container, flip
`enabled: false` → `true` under `dhcp:`, `docker compose up -d`.

Verify AdGuard Home is listening on UDP 67 (host networking):

```console
$ ss -lnup | grep :67
```

### 3. Verify on ONE client BEFORE touching the router

Force a renew on a single device (toggle Wi-Fi off/on, or replug Ethernet) and
check it received **both DNS servers from AdGuard Home's pool**:

- Linux: `resolvectl status` or `nmcli dev show <iface> | grep DNS` (also check
  the lease address is inside the pool range)
- Windows: `ipconfig /all` → DNS Servers must list the AdGuard Home host
  **and** the router
- macOS/iOS/Android: connection details

Also confirm the lease in the AdGuard Home web UI (**Settings → DHCP server →
DHCP leases**). **Do not proceed until DNS1=AdGuard Home host and DNS2=router
are both visible on that client**, and resolution works from it
(`dig example.com` / browse a site).

### 4. Switch OFF the router's DHCP server (end of the window)

Router admin UI → LAN/DHCP → disable the DHCP server. This is a manual,
router-specific step — no code in this repo touches the router, by design.

### 5. Per-device verification

Walk the household devices (phones, laptops, TV, consoles). For each: renew the
lease (toggle Wi-Fi / reconnect) and confirm working internet. It is normal for
already-leased devices to keep their old lease until it expires — a
disconnect/reconnect forces it immediately. Expect stragglers (printers, IoT)
for up to one old lease time (commonly 24 h).

## Rollback (at any point)

1. Router admin UI → **re-enable the router's DHCP server**.
2. Kill the duplicate on the AdGuard Home side. UI path: **Settings → DHCP
   server** → untick **Enable DHCP server** → Save. Or, yaml path:

   ```console
   $ cd network/adguardhome && docker compose stop
   $ $EDITOR data/conf/AdGuardHome.yaml    # dhcp.enabled: false
   $ docker compose up -d
   ```

3. Renew leases on affected devices (toggle Wi-Fi / replug). They go back to
   the router for IP+DNS; AdGuard Home keeps serving DNS to whatever still
   points at it until the next lease.

Rollback is safe because it is the mirror image of the migration: exactly one
DHCP server ends up authoritative (the router), the same one that had it before.

## Post-maintenance notes

- Stopping AdGuard Home on purpose (upgrades etc.): expected behavior is
  exactly the failover path — clients use the router, ads return, internet
  stays. Announce it if the family is watching something ad-supported.
- AdGuard Home's DHCP settings are editable from the web UI — the seed
  (`.env` + `generate-config.sh`) is only the *initial* state, not a pin.
  Treat `data/conf/AdGuardHome.yaml` as the live source of truth; the one
  exception is `dhcp.dhcpv4.options` (the failover pair), which is **not**
  UI-editable: change it with the container stopped, directly in the yaml,
  then `docker compose up -d`.
