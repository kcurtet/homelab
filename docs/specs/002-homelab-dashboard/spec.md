# Spec: Homelab Dashboard

## Contexto e intención

El homelab (repo `kcurtet/homelab`, fases 1–4 construidas) se gestiona hoy con tres UIs distintas (Coolify, Pi-hole, consola Tailscale) + `ssh` + `docker ps` para saber si todo está vivo. El usuario quiere **una sola página**: hub de enlaces a las UIs existentes, estado de todos los servicios de un vistazo, y acciones seguras (restart, forzar backup, ver logs, parar/arrancar fases).

Decisión humana ya tomada: **Astro** (stack de kcurtet.com), **todo vía Docker API** (sin SSH ni systemd desde el dashboard), **exposición Tailscale-only** (la malla es la autenticación), acciones v1 = restart contenedores + forzar backup + ver logs + up/down fases.

Vive en el mismo repo público (`kcurtet/homelab`), directorio `dashboard/` con su compose. Doble valor: herramienta real del lab y pieza de portfolio full-stack.

## Objetivos

1. Una página que responda en <2s: tarjeta por servicio (coolify, postgres, redis, pihole, cloudflared, dashboard) con estado y uptime; sección de backup (fecha del último snapshot); hub de enlaces configurables (Coolify, Pi-hole admin, Tailscale admin).
2. Acciones whitelist: restart de contenedor, logs (últimas N líneas), start/stop por fase (label `com.docker.compose.project`), disparar backup manual.
3. Despliegue como un servicio compose más del lab, alcanzable solo dentro del tailnet (Tailscale Serve), sin credenciales propias.
4. UI limpia tipo "ops" (oscura, mobile-friendly) a la altura del resto del portfolio.

## No-objetivos

- Sustituir UIs existentes (Coolify/Pi-hole siguen siendo donde se configura).
- Historial de métricas (no Prometheus/Grafana; el estado es "ahora").
- Multiusuario/roles: el tailnet es el perímetro.
- Gestión de Pi-hole más allá de enlace (su API solo para estadísticas de queries si el token está en .env).

## Anti-objetivos

- Jamás exponerlo por el Cloudflare Tunnel ni escuchar en 0.0.0.0 público.
- Sin endpoint de exec arbitrario ni terminal; solo las acciones de la whitelist.
- Sin montar el socket crudo de Docker: siempre `tecnativa/docker-socket-proxy` (o equivalente) con los grants mínimos.

## Decisiones de implementación

- **Astro SSR** con adapter `@astrojs/node`; contenedor único `dashboard/` (Dockerfile en el repo, imagen construida en el host, no registry).
- **Cliente Docker**: HTTP contra `DOCKER_HOST=tcp://socket-proxy:2375` (dockerode o fetch directo). Grants del proxy: containers (GET+POST para restart/start/stop/create), logs (GET), networks/volumes/images solo GET, INFO=1, VERSION=1, PING=1; exec/buildd/build **denegados**. Si "forzar backup" vía contenedor efímero exige ALLOW que degrada el proxy, alternativa documentada: servicio `backup-manual` con compose profile `manual` en `backup/restic/` que el dashboard arranca por label.
- **Backup manual = misma fuente de verdad**: el botón arranca un contenedor (imagen con bash+restic) que monta el repo, `/home`, `/mnt/backup`, `/etc/homelab/{backup.env,restic.pass}` y ejecuta `backup.sh` TAL CUAL — scope idéntico al del timer por construcción, sin reimplementación. El timer del host SIGUE siendo el planificador; el botón es disparo manual extra. Colisión de lock de restic → error surfaced en UI, no crash. La fecha del último snapshot se lee con la misma forma de contenedor ejecutando `restic snapshots --json` (cacheada con el TTL general).
- **Fase = proyecto compose con nombre explícito**: los composes ganan `name:` — `hosting/coolify/` y `hosting/cloudflare/` → `name: hosting` (ambos comparten proyecto; nada desplegado live aún, el rename es gratis ahora), `network/pihole/` → `name: network`, `dashboard/` → `name: dashboard`. Up/Down de fase = start/stop de contenedores por label `com.docker.compose.project=<fase>`. Semántica documentada: lifecycle de lo existente, no creación (no `compose up`). La fase hosting INCLUYE cloudflared: pararla cae la publicación pública → confirmación explícita en UI ("this takes down public publishing") antes de parar.
- **Renaming de proyectos**: decisión humana (alternativa descartada: capa de mapeo fase→proyectos en el dashboard). Coste: redeployar desde cero los stacks ya levantados; hoy no hay ninguno live.
- **Tarjetas por proyecto (agregado)**: una tarjeta por proyecto compose (hosting, network, dashboard) agregando TODOS sus contenedores — soketi muerto = tarjeta hosting degradada, nunca todo-verde mentiroso. El estado de la tarjeta es el peor de sus contenedores, con desglose expandible. "No desplegado" es estado explícito de UI (gris), esperado hoy en staging donde casi nada está levantado.
- **Estado Pi-hole**: opcional vía su API (`PIHOLE_URL`, `PIHOLE_API_TOKEN` en `.env`) para queries bloqueadas/permitidas; sin token, la tarjeta muestra solo salud del contenedor.
- **Hub de enlaces**: array en `.env` (`HUB_COOLIFY_URL`, `HUB_PIHOLE_URL`, `HUB_TAILSCALE_URL`…), placeholders en `.env.example`.
- **Sin base de datos**: estado consultado por request con caché en memoria (TTL ~10s) para no martelar el socket-proxy.
- **Docker caído** → página degrada a "docker unreachable" por tarjeta, no 500.
- Docs en inglés (runbook `docs/runbooks/dashboard.md` + sección en README install + `docs/status.md`), código y UI en inglés.

## Criterios de aceptación (Given/When/Then)

- **G1** Given el lab levantado en el host, When abro el dashboard desde un dispositivo del tailnet, Then cada servicio muestra su estado real (verde/rojo) y los enlaces del hub cargan.
- **G2** Given un dispositivo SIN Tailscale, When intento abrir el dashboard, Then conexión imposible (no hay superficie fuera de la malla).
- **G3** When pulso restart en la tarjeta de un contenedor, Then ese contenedor reinicia (uptime se resetea) y los demás no se tocan.
- **G4** When abro logs de un servicio, Then veo las últimas ~200 líneas con auto-refresh opcional.
- **G5** When disparo "backup now", Then aparece un snapshot nuevo (`restic snapshots` +1) o un error legible si hay lock.
- **G6** When hago stop de la fase `hosting`, Then los contenedores de coolify se detienen y start los revive (mismo número de contenedores).
- **G7** Given el repo clonado en el host, When sigo `dashboard.md` (build + compose up + `tailscale serve`), Then el dashboard responde por HTTPS dentro del tailnet en <10 min de trabajo.

## Casos límite

- El propio dashboard se reinicia a sí mismo desde su tarjeta → la petición muere a mitad: la UI debe asumir respuestas abortadas y re-poll.
- Backup manual mientras corre el del timer → lock de restic: error limpio.
- Socket-proxy caído → igual que docker caído: degradación por tarjeta.
- Host de staging (panther) sin `/mnt/backup` montado → el botón backup ahora debe estar deshabilitado o explicar el prerequisito, no lanzar y fallar feo.

## Queda a criterio del builder

- Librería HTTP al Docker API (dockerode vs fetch) y shape del cliente.
- Estructura de componentes Astro / islands y frecuencia de polling.
- Estética concreta (tokens CSS) dentro del modo "ops oscuro".
- Si las estadísticas de Pi-hole entran en v1 o quedan como toggle apagado sin token.
