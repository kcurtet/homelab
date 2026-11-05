# Ledger — plan: docs/specs/002-homelab-dashboard/plan.md

Spec: docs/specs/002-homelab-dashboard/spec.md | Rama: 002-homelab-dashboard | Validaciones locales contra podman de lynx; panther sigue esperando USB.
Task 1: complete (commit 0b95930 — name: hosting x2, name: network; config verifica ^name: en los tres)
Task 2: complete (uncommitted) — dashboard/ scaffold: astro 5.18.2 SSR + @astrojs/node 9 standalone (host 0.0.0.0:4321), Dockerfile multi-stage node:22.14-alpine (non-root, wget healthcheck), compose dashboard+socket-proxy tecnativa v0.5.0 (grants CONTAINERS/POST/LOGS/NETWORKS/VOLUMES/IMAGES/INFO/PING only, red dash-internal internal:true, publish solo 127.0.0.1). Evidencia: npm run build OK; podman build OK (66d096ccc1ee); compose config -q OK, ports = 127.0.0.1:4321:4321; smoke: container responde 'scaffold OK' como user app. Nota: astro 5.18 eliminó astro/constants → versión vía astro/package.json; sharp añadido como dep (peer opcional).
