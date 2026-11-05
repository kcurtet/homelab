# Progress ledger

## 001-homelab-rebuild

- 2026-11-05: Builder check (spec-check-homelab): 4 preguntas, todas del humano. Respuestas: backups = estado del lab + /home; WoL solo educativo; router sin segundo SSID → **fuera el Wi-Fi de respaldo** (apaño), sustituido por failover DNS automático (Pi-hole primario, router secundario por DHCP). Modelo de Pi sin confirmar (hipótesis: Pi 5 8 GB + SSD, punto de decisión al llegar). Spec actualizada con sección "Improvements over the article"; pendiente de aprobación del humano (puerta dura).
- 2026-11-05: Spec aprobada por el humano ("ok"). Hipótesis Pi 5 8 GB + SSD queda como dato pendiente de confirmar a la llegada. Siguiente paso: writing-plans.
- 2026-11-05: Humano confirma Raspberry Pi 5 8 GB + SSD. Spec actualizada.
- 2026-11-05: Plan escrito en docs/specs/001-homelab-rebuild/plan.md (9 tareas: fundaciones → docker-host → coolify → cloudflare → tailscale+wol → pihole → restic → retarget-raspberry → publicación). Pendiente aprobación humana.
- 2026-11-05: Task 7: build complete, live validation DEFERRED (panther reinstall). restic scripts (backup.sh/forget.sh), unidades systemd (03:00, Persistent, RandomizedDelaySec 15m) y backup/README.md con runbook de restore. Scope fijo por spec: coolify data + pihole data + repo + /home (sin rootfs). Dry-run real en lynx (restic 0.17.3 estático): init → backup (paths relativos y absolutos) → restore latest → diff idéntico → forget elimina duplicado intradía. Parser .env sin source (bug: variables no exportadas, cazado por el test y arreglado). shellcheck + bash -n limpios; systemd-analyze verify OK (solo ruta /opt/homelab inexistente en dev, esperado).
- 2026-11-05: Cierre de rama: 001-homelab-rebuild integrada como main (rename; main nunca llegó a nacer aparte). Suite verde en main: compose 3/3, bash -n 3/3, wol selftest OK, timer OK. Pendiente: validaciones live T3/T6/T7 tras Debian en panther (espera USB) y T9 publicación con gh auth. Minors diferidos en el ledger de la spec.
