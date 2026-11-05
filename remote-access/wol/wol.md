# Wake-on-LAN (educational)

> **STATUS: EDUCATIONAL — no target exists today.** Every machine in this lab
> is a laptop (and the ones reachable remotely are on Wi-Fi), so no wake can
> be verified. The script and this doc stay as a learning piece, not an
> operated feature — exactly as the [spec] prescribes. Running
> [`wake`](wake) is expected to wake nothing and exit 0.

## What Wake-on-LAN is

A WoL-capable machine keeps its network card partially powered while off. The
NIC listens for a **magic packet**: 6 bytes of `0xFF` followed by the target
MAC address repeated 16 times — 102 bytes — typically sent as a UDP broadcast
(port 9 is conventional). On receiving it, the NIC signals the machine to
power on. In the [original article], the author used exactly this to wake his
laptop from outside the house — which is the pattern this phase documents:
**SSH over Tailscale into an always-on machine on the LAN, then send the
magic packet from there.** A broadcast sent from outside the LAN would never
arrive, and most routers won't forward it in; that is a feature, not a bug —
it keeps "no open ports" true.

## Prerequisites on the machine you want to wake

1. **UEFI/BIOS: enable Wake-on-LAN.** Usually under *Power* or *Advanced →
   APM* ("Wake on LAN", "PME Event Wake Up", name varies). On laptops, also
   disable *ErP/EuP* deep-off states if WoL is greyed out — and note that
   many laptops only honor WoL on AC power, never on battery.
2. **Linux: enable it on the interface too.** Check the current state:

   ```console
   $ sudo ethtool enp3s0 | grep Wake-on
   Supports Wake-on: pumbg
   Wake-on: d
   ```

   `Wake-on: d` means disabled; `g` (magic packet) is what WoL needs:

   ```bash
   sudo ethtool -s enp3s0 wol g
   ```

3. **Persist it — `ethtool -s` does not survive a reboot.** How, depends on
   the network stack:
   - NetworkManager (Arch/CachyOS hosts):
     ```bash
     nmcli connection modify "<connection>" 802-3-ethernet.wake-on-lan magic
     ```
   - systemd-networkd (Debian server era): add `WakeOnLan=magic` to the
     `.network` file's `[Match]`ed link section.

## Why the sender must be an always-on, wired host on the LAN

Two physical constraints, not policy:

- **Broadcasts don't route.** The magic packet is a link-layer broadcast; it
  must originate on the same L2 segment as the target. Nothing you send from
  the internet reaches it — hence the Tailscale-into-the-LAN pattern above.
- **Wi-Fi drops it.** Most Wi-Fi drivers and access points filter broadcast
  traffic (and magic packets specifically) to save power; a Wi-Fi sender
  usually cannot deliver the packet at all. The sender must be wired.

In the end state, that sender is the Raspberry Pi (wired, always on) — see
the topology. Today there is no such host, which is the second reason this
feature is educational-only.

## Usage

```bash
cd remote-access
cp .env.example .env
$EDITOR .env            # WOL_MAC of the target, WOL_BROADCAST of its LAN

wol/wake                # sends the packet, exits 0
wol/wake --mac AA:BB:CC:DD:EE:FF --broadcast 192.168.1.255   # one-off override
```

`wake` is plain bash: it builds the frame and writes it through bash's
built-in `/dev/udp` redirection — no `wakeonlan`/`ether-wake` needed. It
prints `educational — no target expected` and exits 0 even though nothing
wakes; that is the documented success path for this lab.

### The /dev/udp broadcast caveat

One honest wart, verified while building this: **bash's `/dev/udp` cannot
set `SO_BROADCAST`**, so the kernel rejects datagrams addressed to a
broadcast address — `255.255.255.255` fails, and so does the local subnet
broadcast (e.g. `192.168.1.255`) with *Permission denied*. Unicast
destinations are fine. For a real deployment, either:

- point `WOL_BROADCAST` at the target's **unicast LAN IP** — this needs a
  static ARP entry for the sleeping host (a powered-off NIC answers no
  ARP), which an always-on sender can hold; or
- use `wakeonlan` or `ether-wake`, which open a proper broadcast-capable
  socket.

The sender-side logic (frame construction and the UDP write path) is the
same either way; `wake --selftest` verifies exactly that.

### Proving the sender works: `--selftest`

```bash
wol/wake --selftest
```

Sends two frames (one MAC includes `00` octets, on purpose) to `127.0.0.1`,
catches them with a local UDP listener (`nc -ul`), and verifies each received
datagram is exactly 102 bytes with the expected content (`0xFF` x6 + MAC x16).
Note: listening on UDP port 9 requires root (it is < 1024), so unprivileged
runs verify against a high local port instead — the send path tested is
identical to the real one.

## Privacy

MAC addresses are stable hardware identifiers. This repo is public, so no
real MAC is ever committed — values live only in `remote-access/.env`
(gitignored; see `.env.example`).

[spec]: ../../docs/specs/001-homelab-rebuild/spec.md
[original article]: https://kcurtet.com/proyectos/homelab/
