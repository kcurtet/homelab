# Ledger — plan: docs/specs/001-homelab-rebuild/plan.md

Spec: docs/specs/001-homelab-rebuild/spec.md | Rama: 001-homelab-rebuild | Regla: Tareas con "Task N: complete" están HECHAS.

Pre-flight interfaces: sin conflictos — tareas consumen solo ficheros/runbooks que crea la tarea anterior. Puntos de pausa humana: Docker en panther (T2/T3), validaciones live (T3/T6/T7), repo remoto (T9).
Task 1: complete (commit e09bded, verificaciones: check-ignore .env/**data/.restic-cache OK, 5 dirs OK, README+topology revisión visual OK)
Task 2: complete (commit ef3351c, estado inicial panther verificado: MISSING — instalación real pendiente de OK humano antes de T3)
Ruling: podman evaluado por petición del humano — Coolify v4 estable es Docker-only (dependencia dura de docker-cli/compose); v5 (en desarrollo 2026) será Podman-nativo. Decisión: Docker + Coolify v4 ahora; migración futura a v5 es interna de Coolify y no rediseña el repo. Coste si v5 tarda: seguimos con daemon root, mitigado por ser máquinas lab monousuario.
Ruling: panther pasa de CachyOS a Debian estable como servidor (decisión humana tras diagnosticar grub.cfg con 10_linux vacío por la actualización interrumpida del 26 oct). El staging de T3/T6/T7 se hace sobre Debian; docker-host.md gana sección Debian. Antes del wipe: backup de /home y /etc útil a /data (USB 310G libres). Instalación Debian: física con netinstall; Docker y validaciones después por ssh.
Ruling: sin backup pre-wipe NVMe (humano confirma que todo está duplicado en lynx). Debian 13.7 netinst + ext4 + IP fija 192.168.1.100; runbook staging-host.md creada; docker-host.md gana camino Debian.
Task 3: build complete, live validation DEFERRED (panther reinstall)
Task 4: complete (cloudflared 2026.10.7 pinned, compose config verificado en dev, inerte por diseño — activación gated en checklist del runbook; sin validación live pendiente)
Task 5: complete (tailscale.md verificada contra el tailnet real desde lynx — panther en reinstalación, sin ssh: `tailscale status`/`tailscale ping` OK, quirk MagicDNS resolved+NM documentado como síntoma con workaround IPs 100.x; wake en bash puro /dev/udp: shellcheck 0.10.0 limpio (binario estático, no instalado en el sistema), selftest 2/2 — 102 bytes verificados vía `nc -ul` incluida MAC con octetos 00; limitación documentada: /dev/udp no puede SO_BROADCAST → broadcast de subred local da EACCES con diagnóstico propio, workarounds unicast/wakeonlan; WoL queda EDUCATIONAL)
