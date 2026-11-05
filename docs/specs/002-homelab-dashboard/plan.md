# Plan de implementación: Homelab Dashboard

> Ejecutar con la skill `executing-plans`, tarea a tarea. Pasos con checkbox `- [ ]`.

**Objetivo:** Dashboard Astro (hub + estado + acciones) para el homelab, vía Docker API con socket-proxy, Tailscale-only, como servicio compose más del repo.

**Arquitectura:** `dashboard/` = Astro SSR (adapter node) en contenedor + `tecnativa/docker-socket-proxy` con grants mínimos. Fase = proyecto compose renombrado (`hosting`, `network`, `dashboard`); acciones whitelist sobre labels. Backup manual = contenedor que ejecuta `backup.sh` tal cual.

**Stack:** Astro 5 + @astrojs/node, TypeScript, vitest (lógica pura), Playwright (screenshots), docker socket-proxy, restic.

**Spec:** `docs/specs/002-homelab-dashboard/spec.md`

## Restricciones globales

- Fase = label `com.docker.compose.project`: `hosting` (coolify+cloudflare), `network` (pihole), `dashboard`.
- Anti-objetivos spec: sin exec arbitrario, sin 0.0.0.0 público (publish solo `127.0.0.1:`), sin socket crudo.
- Stop de `hosting` exige confirmación explícita (caída de publicación pública).
- En lynx `docker` = podman: validaciones locales contra el socket de podman (`unix:///run/user/1000/podman/podman.sock`).
- Docs/código/UI en inglés; commits conventional; `.env.example` solo placeholders.

## Foco de revisión

1. **Socket-proxy con grants de más** → T2: denegación efectiva de `/exec`, `/build` verificada con curl contra el proxy.
2. **Stop de hosting sin confirmación** → T5: `POST stop-phase` sin `confirm:true` devuelve 400 (test).
3. **Docker caído tumba la UI** → T3: DOCKER_HOST inválido → tarjetas "unreachable", HTTP 200 (test).
4. **Scope de backup divergente** → T6: el contenedor ejecuta `backup.sh` literal (logs lo demuestran), mismo .env del timer.
5. **Exposición accidental** → T2: `docker compose config` muestra puertos publicados solo en 127.0.0.1.

## Tareas

### Tarea 1: Renaming de proyectos compose

**Ficheros:**
- Modificar: `hosting/coolify/docker-compose.yml`, `hosting/cloudflare/docker-compose.yml` (→ `name: hosting`), `network/pihole/docker-compose.yml` (→ `name: network`)
- Modificar: `docs/runbooks/hosting.md`, `docs/runbooks/dhcp-migration.md` (nota: project name)

**Interfaces:**
- Produce: labels `com.docker.compose.project=hosting|network|dashboard` que T3/T5 consumen.

- [ ] Añadir `name:` a los tres compose (nivel superior, junto a services)
- [ ] Verificar: en cada dir, `cp .env.example .env 2>/dev/null; docker compose config | grep -m1 '^name:'` muestra el nombre esperado; limpiar .env generados
- [ ] Nota de una línea en los dos runbooks ("compose project: hosting")
- [ ] Commit `feat: explicit compose project names (hosting, network) for phase-level control`

### Tarea 2: Scaffold Astro + contenedor + socket-proxy

**Ficheros:**
- Crear: `dashboard/package.json`, `dashboard/astro.config.mjs`, `dashboard/tsconfig.json`, `dashboard/src/pages/index.astro` (placeholder), `dashboard/Dockerfile`, `dashboard/docker-compose.yml`, `dashboard/.env.example`, `.gitignore` ampliado (`dashboard/node_modules/`, `dashboard/dist/`)
- Modificar: `.gitignore`

**Interfaces:**
- Produce: contenedor `dashboard` (node adapter, puerto interno 4321, publish `127.0.0.1:${DASHBOARD_PORT:-4321}:4321`), servicio `socket-proxy` con grants: `CONTAINERS=1 POST=1, LOGS=1, NETWORKS=1, VOLUMES=1, IMAGES=1, INFO=1, PING=1`, exec/build sin grant, red interna compartida; env `DOCKER_HOST=tcp://socket-proxy:2375`.

- [ ] Scaffold Astro con adapter node (SSR), página placeholder que imprime OK
- [ ] Dockerfile multi-stage (node:22-alpine, build → runtime con solo dist + node_modules producción)
- [ ] compose con dashboard + socket-proxy (imagen pinnada) según Interfaces
- [ ] Verificar: `npm ci && npm run build` en lynx OK; `docker build` (podman build) OK; `docker compose config -q` OK; puertos publicados SOLO 127.0.0.1 (foco 5)
- [ ] Commit `feat: dashboard scaffold (astro ssr + node) with socket-proxy compose`

### Tarea 3: Cliente Docker + API de estado

**Ficheros:**
- Crear: `dashboard/src/lib/docker.ts` (cliente Docker API), `dashboard/src/lib/status.ts` (agregación por proyecto, pura), `dashboard/src/lib/cards.ts` (tipos+lista esperada de proyectos desde env), `dashboard/src/pages/api/status.ts`, `dashboard/.env.example` (+`EXPECTED_PROJECTS=hosting,network,dashboard`), `dashboard/src/lib/*.test.ts` (vitest)

**Interfaces:**
- Consume: labels de T1.
- Produce: `GET /api/status` → `{projects: {name, state: 'up'|'partial'|'down'|'not-deployed'|'unreachable', containers: [{name, state, startedAt}]}}`; caché memoria TTL 10s; tipos exportados para T4/T5.

- [ ] Tests primero (vitest): agregación pura — contenedores mixtos → partial; proyecto sin contenedores → not-deployed; error de conexión → unreachable. Ver fallos.
- [ ] Implementar cliente (dockerode o fetch+socket; decide el builder, debe funcionar contra podman socket para tests) y agregación. Ver tests verdes.
- [ ] E2E local: levantar 2 contenedores dummy con label project=hosting (podman run --label), `docker compose up dashboard` contra socket de podman, `curl /api/status` muestra hosting=up con 2 containers y network=not-deployed. Teardown dummies.
- [ ] Commit `feat: docker status api (project aggregation, ttl cache, degraded states)`

### Tarea 4: UI — tarjetas, hub, polling

**Ficheros:**
- Crear: `dashboard/src/layouts/Base.astro`, `dashboard/src/components/StatusGrid.*` (isla con polling 10s), `dashboard/src/components/HubLinks.astro`, `dashboard/src/styles/global.css` (tokens ops oscuro), ampliar `.env.example` (`HUB_COOLIFY_URL`, `HUB_PIHOLE_URL`, `HUB_TAILSCALE_URL`)

Nota: ejecutar con la skill `design-taste-frontend` cargada — es pantalla de app real del portfolio.

**Interfaces:**
- Consume: `/api/status` (tipos de T3), env de hub.
- Produce: página única mobile-friendly; tarjeta por proyecto con desglose expandible; estados coloreados (up/partial/down/not-deployed/unreachable); sección backup con placeholder "last snapshot: T6".

- [ ] UI completa según spec (oscura, tipografía mono para datos, sin librería de componentes pesada)
- [ ] Verificar: `npm run build` OK; levantar dev + screenshots Playwright (desktop 1280px y móvil 390px) — sin estados mentirosos, jerarquía clara
- [ ] Commit `feat: dashboard ui (status cards, hub links, polling island)`

### Tarea 5: API de acciones

**Ficheros:**
- Crear: `dashboard/src/pages/api/action/restart.ts`, `.../stop-phase.ts`, `.../start-phase.ts`, `dashboard/src/pages/api/logs.ts`, `dashboard/src/lib/actions.ts` (+tests), ampliar UI (botones, confirm modal para hosting-stop, visor de logs)
- Modificar: componente StatusGrid (acciones), `dashboard/src/components/LogViewer.*`

**Interfaces:**
- Consume: cliente docker T3, labels T1.
- Produce: `POST /api/action/restart {container}`; `POST /api/action/stop-phase {project, confirm?}` — 400 si project=hosting sin `confirm:true`; `POST /api/action/start-phase {project}`; `GET /api/logs?container=X&lines=200`. Whitelist estricta de projects (env); ningún endpoint ejecuta comandos arbitrarios.

- [ ] Tests primero: stop-phase hosting sin confirm → 400; project fuera de whitelist → 400; restart solo acepta contenedores existentes. Ver fallos.
- [ ] Implementar acciones contra Docker API. Ver tests verdes.
- [ ] E2E local con dummies (podman): restart un dummy (StartedAt cambia), stop-phase hosting (los 2 dummies Exited), logs devuelve últimas líneas. Teardown.
- [ ] Commit `feat: whitelist actions api (restart, phase start/stop with confirm, logs)`

### Tarea 6: Backup manual + último snapshot

**Ficheros:**
- Crear: `dashboard/backup.Dockerfile` (bash + restic), `dashboard/src/pages/api/action/backup-now.ts`, `dashboard/src/lib/backup.ts` (crear/arrancar contenedor one-shot con mounts de /etc/homelab + /mnt/backup + repo + /home; leer last-snapshot vía `restic snapshots --json`), tests; UI: botón Backup now + fecha último snapshot en tarjeta backup

**Interfaces:**
- Consume: `backup.sh` de T7-001 TAL CUAL (sin reimplementar), env del host `/etc/homelab/backup.env`.
- Produce: `POST /api/action/backup-now` → job id/estado; `GET /api/status` incluye `backup: {lastSnapshot?: string, running: boolean}`.

- [ ] backup.Dockerfile: imagen pequeña con bash+restic que ejecuta `/repo/backup/restic/backup.sh` montado
- [ ] Tests de la lógica de mounts/estado (puros)
- [ ] Dry-run local: repo restic temporal (como T7-001), `/etc/homelab` simulado en /tmp; backup-now → snapshot +1 en el repo temporal y `restic snapshots --json` refleja fecha; caso lock → error surfaced
- [ ] Commit `feat: manual backup via backup.sh-in-container + last snapshot status`

### Tarea 7: Documentación y publicación de fase

**Ficheros:**
- Crear: `docs/runbooks/dashboard.md`
- Modificar: `README.md` (sección install "5. Dashboard" + layout), `docs/status.md` (fila dashboard)

**Interfaces:**
- Produce: runbook: build imagen, `cp .env.example .env`, up, `tailscale serve --bg https+insecure://127.0.0.1:4321` (o `tailscale serve 4321`), verificación G2 (fuera de tailnet no conecta), teardown.

- [ ] Runbook + README + status
- [ ] Verificar: links relativos OK, `npm run build` final OK
- [ ] Commit `docs: dashboard runbook (build, tailscale serve, verification) + readme/status`

### Tarea 8: E2E completo local

- [ ] En lynx: compose up completo (dashboard+socket-proxy contra podman) con dummies etiquetados hosting/network + backup dry-run → captura: tarjetas correctas, restart funciona, stop/start fase, backup-now crea snapshot, logs visibles
- [ ] Sinopsis de evidencia al ledger; screenshot guardado en `docs/` NO (repo público sin assets runtime) — solo evidencia en ledger
- [ ] Commit final si hay ajustes

## Orden y dependencias

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8. T4 necesita T3 (tipos); T5/T6 amplían UI de T4. Validaciones locales contra podman de lynx; nada toca panther (sigue esperando USB).
