# Plan de implementación: Homelab Rebuild

> Ejecutar con la skill `executing-plans`, tarea a tarea. Pasos con checkbox `- [ ]`.

**Objetivo:** Recrear el homelab de kcurtet.com como repo público reproducible (compose + docs), por fases de blast-radius creciente, staging en `panther`, destino final Raspberry Pi 5 8 GB + SSD.

**Arquitectura:** Repo con un directorio por concern (`hosting/`, `remote-access/`, `network/`, `backup/`, `docs/runbooks/`). Cada fase es autocontenida (móvil con copy+rerun) y se valida en el host que toque antes de declararse hecha. Nada de la red de casa se aplica hasta la era Raspberry.

**Stack:** Docker Compose, Coolify, Pi-hole v6, cloudflared, Tailscale, restic, bash, systemd timers.

**Spec:** `docs/specs/001-homelab-rebuild/spec.md` — el plan argumenta desde ella.

## Restricciones globales

- Docs en inglés; artículo original enlazado como origin story.
- Público en GitHub: cero secretos/MACs familiares/IPs de casa reales → solo `.env` (gitignored) + `.env.example`.
- `.gitignore` cubre `.env` y `**/data/` ANTES de que exista cualquier `.env` o dato runtime.
- Pi-hole compose arranca con **DHCP desactivado por defecto** (`PIHOLE_DHCP_ACTIVE=false` en `.env.example`); activarlo es paso manual de la era Raspberry.
- Fase 3 nunca se aplica fuera de la Raspberry; fase 1 sí se valida en panther.
- Cada tarea termina en commit; mensajes en inglés, conventional style (`feat:`, `docs:`, `chore:`).

## Foco de revisión

1. **Secreto commiteado** → `.gitignore` + `git check-ignore` verificado en Tarea 1 antes de crear nada más.
2. **Pi-hole secuestra el DHCP de casa por accidente** → default DHCP-off en compose (T6: `docker compose config` muestra la flag off).
3. **Compose de Coolify desalineado del instalador oficial** → T3 fija versión y compara contra el instalador oficial.
4. **Backups sin restore verificado** → T8 exige restore real de un fichero de prueba (la spec lo llama decoración si no).
5. **Failover DNS sin documentar el trade-off de fugas de anuncios** → T7 incluye sección explícita y su verificación es de revisión de doc.

## Tareas

### Tarea 1: Fundaciones del repo

**Ficheros:**
- Crear: `README.md`, `.gitignore`, `LICENSE` (MIT), `docs/topology.md`
- Crear (vacíos con `.gitkeep`): `hosting/`, `remote-access/`, `network/`, `backup/`, `docs/runbooks/`

**Interfaces:**
- Produce: estructura de directorios que T3–T8 rellenan; `.gitignore` que T2–T8 asumen.

- [ ] **Paso 1: crear `.gitignore`** con: `.env`, `**/data/`, `**/.restic-cache/`
- [ ] **Paso 2: verificar que cubre** — Run: `git check-ignore -v fixtures.env 2>/dev/null; mkdir -p /tmp/x && git check-ignore hosting/data` — Expected: rutas ignoradas (probar con ficheros temporales `.env` y `x/data/f` en el árbol)
- [ ] **Paso 3: escribir `README.md`** — qué es este lab, link al artículo, diagrama de topología (Mermaid en `docs/topology.md`: internet ↔ router (DNS2/respaldo) ↔ Pi (Pi-hole DNS1+DHCP, Coolify, restic, Tailscale subnet router, WoL sender) ↔ familia/dispositivos; staging: panther), índice de fases con orden recomendado y "what each teaches".
- [ ] **Paso 4: LICENSE MIT** con copyright `Kevin Curtet`
- [ ] **Paso 5: verificar** — Run: `ls` muestra los 5 directorios; README renderiza (revisión visual de secciones: intro, topology link, phase index).
- [ ] **Paso 6: commit** `chore: repo skeleton, gitignore, MIT license, README with topology`

### Tarea 2: runbook de instalación de Docker (host objetivo)

**Ficheros:**
- Crear: `docs/runbooks/docker-host.md`

**Interfaces:**
- Produce: procedimiento que T3 (panther) y T8/T9 (Pi) ejecutan: instalar Docker + compose plugin en Arch/CachyOS (`pacman -S docker docker-compose`, `systemctl enable --now docker`) y en Raspberry Pi OS (get.docker.com), añadir usuario al grupo `docker`.

- [ ] **Paso 1: escribir el runbook** con los dos targets (Arch y Pi OS), verificación (`docker run --rm hello-world`) y nota de seguridad del grupo docker.
- [ ] **Paso 2: validar el tramo Arch en panther** — Run: `ssh panther-wifi 'docker --version || echo MISSING'` — Expected hoy: `MISSING` (documentado como estado inicial); al ejecutar el runbook: hello-world corre. Ejecución real requiere sudo en panther → pedir OK al humano en su momento.
- [ ] **Paso 3: commit** `docs: docker host runbook (arch + raspberry pi os)`

### Tarea 3: Coolify — compose + runbook de hosting

**Ficheros:**
- Crear: `hosting/coolify/docker-compose.yml`, `hosting/coolify/.env.example`, `docs/runbooks/hosting.md`

**Interfaces:**
- Consume: `docs/runbooks/docker-host.md` (T2).
- Produce: Coolify operativo con datos bajo `hosting/coolify/data/` (gitignored); runbook usado por T3-validación y T9 (retarget).

- [ ] **Paso 1: extraer el compose oficial** — descargar el instalador oficial de Coolify, extraer su compose subyacente (servicios: coolify, postgres, redis, socket-proxy, etc.), pinnar la misma versión/tag que usa el instalador. Referencia en comentario del fichero.
- [ ] **Paso 2: escribir `.env.example`** — `COOLIFY_APP_ID`, `COOLIFY_SECRET_KEY`, rutas bajo `./data/`, puertos si difieren.
- [ ] **Paso 3: validar sintaxis** — Run: `cd hosting/coolify && docker compose config --quiet` — Expected: exit 0 (necesita `.env` copiado de example).
- [ ] **Paso 4: escribir `hosting.md`** — instalar Docker (→ T2), `cp .env.example .env`, `docker compose up -d`, abrir asistente en `:8000`, desplegar un sitio estático de muestra desde un repo público vía git push (Coolify git integration), y teardown: `docker compose down -v` + `rm -rf data/`.
- [ ] **Paso 5: validación live en panther** (tras OK humano + Docker instalado): seguir el runbook completo — Expected: sitio muestra accesible, teardown limpio.
- [ ] **Paso 6: commit** `feat: coolify compose + hosting runbook`

### Tarea 4: Cloudflare Tunnel — documentación inerte

**Ficheros:**
- Crear: `hosting/cloudflare/docker-compose.yml` (cloudflared standalone), `hosting/cloudflare/.env.example` (`TUNNEL_TOKEN=`), `docs/runbooks/cloudflare-tunnel.md`

**Interfaces:**
- Produce: camino de publicación sin exponer IP, inerte hasta que exista cuenta/dominio.

- [ ] **Paso 1: compose de cloudflared** — imagen `cloudflare/cloudflared`, comando `tunnel run`, token por env, `restart: unless-stopped`.
- [ ] **Paso 2: validar** — Run: `cd hosting/cloudflare && docker compose config --quiet` — Expected: exit 0.
- [ ] **Paso 3: runbook** — crear cuenta, dominio, tunnel (dashboard o CLI), dónde pegar el token, cómo apuntar hostnames a servicios Coolify, rollback (parar compose). Estado marcado **"PENDING ACCOUNT"** en cabecera.
- [ ] **Paso 4: commit** `feat: cloudflare tunnel compose + runbook (pending account)`

### Tarea 5: Tailscale + Wake-on-LAN (acceso remoto)

**Ficheros:**
- Crear: `remote-access/tailscale.md`, `remote-access/wol/wake`, `remote-access/wol/wol.md`, `remote-access/.env.example` (`WOL_MAC=`, `WOL_BROADCAST=`)

**Interfaces:**
- Produce: doc de acceso remoto verificada contra el tailnet real (`<your-tailnet>`); script educativo `wake` que emite magic packet UDP.

- [ ] **Paso 1: escribir `tailscale.md`** — unirse al tailnet existente (auth key), SSH por Tailscale, subnet router en el servidor final (`tailscale up --advertise-routes=192.168.1.0/24` + aprobación en admin console), checklist de verificación con `tailscale status`/`tailscale ping`.
- [ ] **Paso 2: verificar doc contra el tailnet real** — Run: `ssh panther-wifi 'tailscale status | head -5'` — Expected: nodos del tailnet listados; ajustar la doc si algún comando difiere.
- [ ] **Paso 3: escribir `wake`** — bash: valida MAC (regex), lee `WOL_MAC`/`WOL_BROADCAST` del `.env` del directorio o args, emite 16×MAC via `/dev/udp` (sin dependencias) o `wakeonlan` si existe; exit 0 y mensaje "educational — no target expected".
- [ ] **Paso 4: verificar script** — Run: `bash -n remote-access/wol/wake && shellcheck remote-access/wol/wake` (si shellcheck está) y `remote-access/wol/wake --selftest` — Expected: selftest emite packet a 127.0.0.1 y escucha con `nc -ul` un frame de 102 bytes.
- [ ] **Paso 5: escribir `wol.md`** — prerrequisitos (UEFI: WoL enabled; Linux: `ethtool -s iface wol g` persistente), por qué el emisor debe ser host encendido con cable, y etiqueta **EDUCATIONAL** (sin objetivo verificable hoy).
- [ ] **Paso 6: commit** `feat: remote access docs (tailscale) + educational wol script`

### Tarea 6: Pi-hole — compose con failover DNS

**Ficheros:**
- Crear: `network/pihole/docker-compose.yml`, `network/pihole/.env.example`, `docs/runbooks/dhcp-migration.md`

**Interfaces:**
- Produce: Pi-hole v6 con DHCP **off por defecto**; variables para rango DHCP y DNS2=router; runbook de migración con rollback.

- [ ] **Paso 1: `.env.example`** — `PIHOLE_DHCP_ACTIVE=false`, `PIHOLE_DHCP_START/END`, `PIHOLE_DHCP_ROUTER`, `PIHOLE_DNS2_ROUTER=192.168.1.1`, `FTLCONF_dns_listening_mode`, TZ.
- [ ] **Paso 2: compose** — Pi-hole v6, `network_mode: host` (DHCP), `cap_add: NET_ADMIN`, volúmenes bajo `./data/`, `FTLCONF_` mapeadas desde env, healthcheck `dig`.
- [ ] **Paso 3: validar default seguro** — Run: `cd network/pihole && cp .env.example .env && docker compose config | grep -i dhcp` — Expected: flag DHCP inactiva en la configuración renderizada.
- [ ] **Paso 4: validar live SIN tocar la red** — levantar en panther con DHCP off: resuelve (`dig @localhost pi.hole` / `dig @localhost example.com`) y luego `down -v`. Nunca activar DHCP aquí.
- [ ] **Paso 5: `dhcp-migration.md`** — prerequisito: verificar que el router responde DNS como secundario (`dig @192.168.1.1 example.com`); orden: Pi-hole DHCP ON → verificar leases+DNS1/DNS2 en un cliente → router DHCP OFF → verificación por dispositivo; rollback: router DHCP ON de nuevo + renovar leases. Sección obligatoria: trade-off de fuga de anuncios cuando algún cliente usa DNS2.
- [ ] **Paso 6: commit** `feat: pihole v6 compose (dhcp-off default, dns failover) + migration runbook`

### Tarea 7: Backups restic

**Ficheros:**
- Crear: `backup/restic/backup.sh`, `backup/restic/forget.sh`, `backup/restic/homelab-backup.service`, `backup/restic/homelab-backup.timer`, `backup/.env.example`, `backup/README.md`

**Interfaces:**
- Produce: snapshots de `hosting/coolify/data/` + config Pi-hole + repo + `/home` del host; política forget 7d/4w/6m; runbook de restore.

- [ ] **Paso 1: `.env.example`** — `RESTIC_REPOSITORY=/mnt/backup/homelab.restic` (staging: dir local en panther), `RESTIC_PASSWORD_FILE=/etc/homelab/restic.pass` (chmod 600), `BACKUP_PATHS` (las 4 fuentes).
- [ ] **Paso 2: `backup.sh`** — `set -euo pipefail`; carga `.env`; `restic backup $BACKUP_PATHS`; `forget.sh`: `restic forget --prune --keep-daily 7 --keep-weekly 4 --keep-monthly 6`.
- [ ] **Paso 3: unidades systemd** — timer nocturno (`OnCalendar=*-*-* 03:00`, `Persistent=true`), servicio `Type=oneshot` con `EnvironmentFile`.
- [ ] **Paso 4: verificar scripts** — Run: `bash -n backup/restic/*.sh && shellcheck backup/restic/*.sh` — Expected: limpio.
- [ ] **Paso 5: validación live en panther** (tras OK humano): repo temporal local, `backup.sh` manual → `restic snapshots` lista 1, `restic restore latest --target /tmp/restore-test` recupera el fichero de prueba → borrar repo temporal. Expected: fichero idéntico (`diff`).
- [ ] **Paso 6: `backup/README.md`** — montaje del USB (`/mnt/backup`, fstab por UUID), instalación de unidades, política, restore runbook paso a paso.
- [ ] **Paso 7: commit** `feat: restic backups (service+timer, forget policy, restore runbook)`

### Tarea 8: Retarget a Raspberry — checklist de llegada

**Ficheros:**
- Crear: `docs/runbooks/raspberry-arrival.md`
- Modificar: `README.md` (link al checklist)

**Interfaces:**
- Consume: todos los runbooks anteriores (T3–T7).

- [ ] **Paso 1: checklist** — verificar hardware (Pi 5 8 GB, SSD detectado), instalar Pi OS 64-bit en SSD, Docker (→ T2), retarget fase a fase (hosting: copiar `hosting/coolify/data/` y `up -d`; tailscale subnet router; pihole SOLO aquí + migración DHCP → T6; backups: conectar USB, unidades systemd). Punto de decisión documentado: si la Pi llega rota/inferior, Coolify se queda en panther y la Pi toma DNS+backups.
- [ ] **Paso 2: commit** `docs: raspberry arrival + retarget checklist`

### Tarea 9: Publicación

**Ficheros:**
- Modificar: `README.md` (estado de fases, badge/roadmap)

**Interfaces:**
- Consume: repo completo.

- [ ] **Paso 1: revisión final de secretos** — Run: `git log --all --diff-filter=A -- '*.env' '**/data/*' | wc -l` y `git grep -IiE 'ts\.net|100\.[0-9]+\.|password|token' -- ':!*.example' ':!docs/specs/*'` — Expected: 0 hallazgos reales (nombres de host del artículo sí pueden aparecer).
- [ ] **Paso 2: crear repo remoto** `github.com/kcurtet/homelab` (público), push de `main`. Requiere gh auth del humano o token.
- [ ] **Paso 3: roadmap en README** — fases con estado (done/pending account/pending raspberry).
- [ ] **Paso 4: commit + push** `docs: publish-ready readme with phase status`

## Orden y dependencias

T1 → T2 → T3 → (T4, T5 paralelizables) → T6 → T7 → T8 → T9. T3, T6-paso4, T7-paso5 tocan panther: confirmación humana antes de cada uno. T9 exige todo lo demás merged.
