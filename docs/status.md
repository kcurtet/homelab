# Build status

| Piece | Status |
|-------|--------|
| Phase 1 — Coolify hosting | Built; live bring-up pending (staging host reinstall) |
| Phase 1 — Cloudflare Tunnel | Documented and inert — **pending account/domain** |
| Phase 1 — Let's Encrypt | Documented (two TLS paths); activates with a domain |
| Phase 2 — Tailscale | Doc verified against a live tailnet |
| Phase 2 — Wake-on-LAN | Educational script + docs (no wakeable target today) |
| Phase 3 — Pi-hole DNS/DHCP | Built with DHCP **off** by default; applies only on the Raspberry (**pending hardware**) |
| Phase 4 — restic backups | Scripts verified with a full local dry-run (backup → restore → diff); live timer pending |
| Dashboard — status + actions UI | Built and fully verified locally against podman (TDD 40/40, e2e dummies, backup dry-run); live on host pending |

Design and build artifacts (spec, plan, rulings ledger) live under `specs/` in
Spanish — the working log of how this was designed and built.
