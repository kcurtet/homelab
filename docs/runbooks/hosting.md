# Runbook: Dokku hosting (push-to-deploy behind Traefik)

Dokku is the lab's application platform: `git push` builds and runs any
Dockerfile app. It replaced the originally planned Coolify (decision recorded
in the ledger, 2026-11-07): minimal state, no UI/database to babysit, and git
push already is the deploy pipeline.

**Live validation status:** running on `panther` (staging) since 2026-11-07 —
install quirks, the Traefik edge pattern, and per-app deploys are exercised
for real (sample app behind `sample.int.ntux.link`). Final host is the
Raspberry Pi via the official Debian installer.

The full runbook lives with the phase: **[`hosting/dokku/README.md`](../../hosting/dokku/README.md)**
(install on Arch/Debian, sudoers/sshd/events fixes, traefik labels pattern,
gotchas). Publishing to the internet without open ports (Cloudflare Tunnel)
and Let's Encrypt: [`cloudflare-tunnel.md`](cloudflare-tunnel.md) — pending a
Cloudflare account/domain.
