# Remote access: Tailscale (a mesh VPN with zero open ports)

> **STATUS: verified against a live tailnet** (Tailscale 1.104.x). The commands
> in the checklist at the end are the ones that were actually run and their
> observed output. All addresses and names below are documentation placeholders
> — this repo is public, so no real tailnet names, node names, or node IPs
> appear here. We use `100.64.0.x` (the start of the CGNAT range Tailscale
> draws from); your nodes will get different `100.x.y.z` addresses.

## Why a mesh VPN

The lab rule this repo inherits from the
[original article]: **opening router ports is the last resort.** Every port
forward is a permanent advertisement of a service to the entire internet
(scanners find new exposures within minutes), and it makes the router — which
this repo deliberately does not manage — part of the attack surface.

A mesh VPN removes the need for any of that:

- **Nothing listens inbound.** Every node dials out to the Tailscale
  coordination server; connections between nodes are established
  peer-to-peer (WireGuard®) through NAT traversal. The router forwards
  nothing.
- **Identity, not topology.** Nodes authenticate as devices of your account
  (or via an identity provider), not by being "on the home network". A laptop
  on a café Wi-Fi is as trusted-positioned as one at home.
- **One flat network.** Every device gets a stable `100.x.y.z` address in the
  private CGNAT range (`100.64.0.0/10`). That address works from anywhere and
  never changes when the underlying network does.
- **End-to-end encrypted.** Keys are per-node; the coordination server
  arranges introductions but does not see traffic. When direct connection
  fails (hostile NAT), traffic relays encrypted through DERP servers.

Tailscale and the [Cloudflare Tunnel] are complements, not alternatives: the
tunnel publishes *selected* hostnames to the *public* internet; Tailscale
gives *private* access to *everything* (SSH, admin panels, databases) without
publishing anything at all.

## 1. Install and join the tailnet

A *tailnet* is your private network of Tailscale devices. The lab assumes one
already exists (created from any first device — installing and logging in on
your laptop creates it). Below, "the server" means whichever host currently
plays that role: the staging host today, the Raspberry Pi in the end state.

Arch/CachyOS:

```bash
sudo pacman -S tailscale
```

Debian / Raspberry Pi OS:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

Both, then:

```bash
sudo systemctl enable --now tailscaled
```

Join with an **auth key** from the admin console
(<https://login.tailscale.com/admin/settings/keys> → *Generate auth key*).
Prefer a reusable, pre-authorized key with a short expiry; a key is a secret
(one use of some types), so treat generated keys like passwords — paste it,
don't script it into anything committed:

```bash
sudo tailscale up --authkey=tskey-auth-XXXXXXX --hostname=server
```

Without `--authkey`, `tailscale up` prints a login URL to open in a browser —
fine for interactive machines, awkward for headless ones.

## 2. SSH over Tailscale — pick one of two mechanisms

**Option A: your normal sshd, reached at the tailnet IP.** Nothing new to
enable on the server beyond a running OpenSSH. From any tailnet client:

```bash
ssh youruser@100.64.0.1
```

The tailnet IP is stable, so host keys pin normally and `~/.ssh/config`
entries never need editing. Optional hardening: make sshd listen *only* on
the tailnet interface (`ListenAddress 100.64.0.1` in
`/etc/ssh/sshd_config`), so SSH is unreachable from the LAN side too.

**Option B: Tailscale SSH.** Tailscale itself terminates SSH on the server:

```bash
sudo tailscale set --ssh     # on the server, per node
```

No host keys, no authorized_keys to distribute — the tailnet's ACLs decide
who may SSH as whom, enforced server-side. The trade-off: it works *only*
from Tailscale clients, and authentication rules live in the admin console
rather than in OpenSSH's ecosystem.

This lab uses **Option A** (the hosts already run sshd, and the staging →
Raspberry retarget shouldn't grow console-side dependencies), with Option B
noted as the lower-maintenance alternative for a tailnet-only fleet.

## 3. Subnet router on the final server (Raspberry era)

Useful now, required later: a **subnet router** publishes the home LAN
itself into the tailnet, so a phone on mobile data can reach the router's
admin page, a printer, or any other LAN device that will never run
Tailscale:

```bash
sudo tailscale up --advertise-routes=192.168.1.0/24
```

Routes must then be **approved in the admin console**
(<https://login.tailscale.com/admin/machines> → the server → *Edit route
settings* → approve the `192.168.1.0/24` subnet route). Linux clients must
also opt in with `--accept-routes` (macOS/Windows accept by default). This is
a step for the Raspberry era; until then the doc is inert and nothing
advertises routes.

## 4. MagicDNS — and one known wart

MagicDNS lets you use bare hostnames (`ssh server`) instead of `100.x.y.z`
addresses. Enable it in the admin console (*DNS → MagicDNS*).

**Known symptom on some hosts** (observed while verifying this doc): when
`systemd-resolved` and NetworkManager are wired together incorrectly, Tailscale
cannot hook the resolver, and:

- `tailscale status` prints a health warning at the bottom:
  `systemd-resolved and NetworkManager are wired together incorrectly;
  MagicDNS will probably not work` (details: <https://tailscale.com/s/resolved-nm>);
- bare hostnames (`ping server`) fail, while tailnet IPs (`ping 100.64.0.1`)
  keep working.

Everything in this repo's checklists uses `100.x.y.z` addresses precisely so
it does not depend on the host's DNS stack. Repairing the resolver wiring is
host administration outside this lab's scope — see the linked Tailscale doc
if you want MagicDNS anyway.

## 5. Verification checklist

Run from any tailnet client. Expected output comes from a real run (addresses
anonymized):

```console
$ tailscale status | head
100.64.0.1      server   yourname@  linux      -
100.64.0.2      laptop   yourname@  linux      -
100.64.0.3      phone    yourname@  android    offline, last seen 17d ago
```

One line per node: tailnet IP, name, owner, OS, connection state. Health
warnings, if any, appear at the end (see MagicDNS above). Check that every
node you expect is listed, and that its state is not unexpectedly `offline`.

```console
$ tailscale ping --timeout=3s server
pong from server (100.64.0.1) via 192.168.1.10:41641 in 48ms
```

`tailscale ping` verifies connectivity at the Tailscale level (it needs no
listening service). A `via` your-LAN-IP answer means a direct connection on
the same network; `via DERP` means relayed (works, but slower); no answer
within the timeout means the node is off or unreachable — for offline nodes
that is expected, not an error.

```console
$ ssh youruser@100.64.0.1
yourname@server:~$
```

If all three pass, remote access works from anywhere the client has
internet — the router, meanwhile, still forwards nothing.

## Rollback

To temporarily suspend: `sudo tailscale down`. To remove a node from the
tailnet: `tailscale logout` on the node, then disable/remove the machine in
the admin console (*Machines → ⋯ → Remove*). To uninstall:
`sudo systemctl disable --now tailscaled` and remove the package
(`pacman -R tailscale` / `apt remove tailscale`). Nothing on the router or
the LAN changes in any case.

[original article]: https://kcurtet.com/proyectos/homelab/
[Cloudflare Tunnel]: ../docs/runbooks/cloudflare-tunnel.md
