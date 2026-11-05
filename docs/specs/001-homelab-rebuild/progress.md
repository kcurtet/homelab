# Ledger — plan: docs/specs/001-homelab-rebuild/plan.md

Spec: docs/specs/001-homelab-rebuild/spec.md | Rama: 001-homelab-rebuild | Regla: Tareas con "Task N: complete" están HECHAS.

Pre-flight interfaces: sin conflictos — tareas consumen solo ficheros/runbooks que crea la tarea anterior. Puntos de pausa humana: Docker en panther (T2/T3), validaciones live (T3/T6/T7), repo remoto (T9).
Task 1: complete (commit e09bded, verificaciones: check-ignore .env/**data/.restic-cache OK, 5 dirs OK, README+topology revisión visual OK)
Task 2: complete (commit ef3351c, estado inicial panther verificado: MISSING — instalación real pendiente de OK humano antes de T3)
Ruling: podman evaluado por petición del humano — Coolify v4 estable es Docker-only (dependencia dura de docker-cli/compose); v5 (en desarrollo 2026) será Podman-nativo. Decisión: Docker + Coolify v4 ahora; migración futura a v5 es interna de Coolify y no rediseña el repo. Coste si v5 tarda: seguimos con daemon root, mitigado por ser máquinas lab monousuario.
