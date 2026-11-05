# Progress ledger

## 001-homelab-rebuild

- 2026-11-05: Builder check (spec-check-homelab): 4 preguntas, todas del humano. Respuestas: backups = estado del lab + /home; WoL solo educativo; router sin segundo SSID → **fuera el Wi-Fi de respaldo** (apaño), sustituido por failover DNS automático (Pi-hole primario, router secundario por DHCP). Modelo de Pi sin confirmar (hipótesis: Pi 5 8 GB + SSD, punto de decisión al llegar). Spec actualizada con sección "Improvements over the article"; pendiente de aprobación del humano (puerta dura).
- 2026-11-05: Spec aprobada por el humano ("ok"). Hipótesis Pi 5 8 GB + SSD queda como dato pendiente de confirmar a la llegada. Siguiente paso: writing-plans.
- 2026-11-05: Humano confirma Raspberry Pi 5 8 GB + SSD. Spec actualizada.
- 2026-11-05: Plan escrito en docs/specs/001-homelab-rebuild/plan.md (9 tareas: fundaciones → docker-host → coolify → cloudflare → tailscale+wol → pihole → restic → retarget-raspberry → publicación). Pendiente aprobación humana.
