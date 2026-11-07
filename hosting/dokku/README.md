# Hosting — Dokku (push-to-deploy)

Dokku as the lab's app hosting: `git push dokku main` builds and deploys any
Dockerfile app behind the shared Traefik edge (`monitoring/`). Chosen over
Coolify for the minimal-state philosophy of this repo (no UI, no database,
apps are plain containers) and over a CI/CD stack because git push **is** the
pipeline today; a GitHub Actions → dokku bridge can be added later without
replacing anything.

## Install

### Staging (panther, CachyOS/Arch)

Dokku's official installer is apt-only. Use the maintained AUR overlay fork:

```bash
# github.com/kcurtet/aur-dokku (AUR 'dokku' build is broken at 0.38.34)
paru -U https://github.com/kcurtet/aur-dokku  # or clone + makepkg -si
```

Arch post-install fixes (the Debian package would do these via dpkg):

```bash
# 1. sudoers rules the scheduler needs (upstream: docker/etc/sudoers.d/*)
echo 'dokku ALL=NOPASSWD:SETENV:/usr/bin/docker,/usr/bin/docker-container-healthchecker,/usr/bin/docker-image-labeler,/usr/bin/lambda-builder,/usr/bin/nixpacks,/usr/bin/railpack,/usr/bin/pack' \
  | sudo tee /etc/sudoers.d/dokku && sudo chmod 440 /etc/sudoers.d/dokku

# 2. events plugin assumes a Debian 'syslog' user
sudo sed -i 's/chown syslog:dokku/chown root:dokku/' \
  /var/lib/dokku/core-plugins/available/20_events/install

# 3. hardened sshd must admit the dokku deploy user
sudo sed -i 's/^AllowUsers .*/& dokku/' /etc/ssh/sshd_config.d/50-hardening.conf
```

Then bootstrap plugins and base config:

```bash
sudo dokku plugin:install --core
cat ~/.ssh/<key>.pub | sudo dokku ssh-keys:add admin
sudo dokku domains:set-global int.ntux.link
```

### Final (Raspberry Pi, Debian)

Use the official installer — same version pin:

```bash
sudo DOKKU_TAG=v0.38.34 bash bootstrap.sh   # see dokku.com/bootstrap.sh
```

Then the same ssh-keys/domains steps. Traefik integration below assumes the
`monitoring/` stack is up (the shared `monitoring_web` network).

## Deploy an app (Traefik edge pattern)

Dokku's own nginx proxy stays **disabled**; Traefik is the only edge. Per app:

```bash
dokku apps:create myapp
dokku proxy:disable myapp

# join the shared traefik network (as an EXTRA network; dokku keeps its own)
dokku network:set myapp attach-post-deploy monitoring_web

# traefik labels — note the single quotes inside, required by docker-options
dokku docker-options:add myapp deploy "--label='traefik.enable=true'"
dokku docker-options:add myapp deploy "--label='traefik.http.routers.myapp.rule=Host(\`myapp.int.ntux.link\`)'"
dokku docker-options:add myapp deploy "--label=traefik.http.services.myapp.loadbalancer.server.port=<container-port>"

git remote add dokku dokku@<host>:myapp   # ssh alias with IdentityAgent none
git push dokku main
```

Verify: `curl -H 'Host: myapp.int.ntux.link' http://<host>/`.

### Gotchas learned on panther (2026-11-07)

- **Do not** use `docker-options:add --network=...` to join traefik's network:
  it replaces dokku's default network, the scheduler's checks can't reach the
  container, and the deploy is rolled back (`Processes: 0`, exit 143).
  `network:set attach-post-deploy` is the supported way.
- Without `app.json` healthchecks, deploys wait 10s of container uptime
  (`docker-container-healthchecker`) — that's the "simple container check".
- `dokku ssh-keys:add` writes forced-command keys for the `dokku` user;
  `AllowUsers` in `sshd_config.d` must include it or pushes die with
  `Permission denied (publickey)` while verbose ssh shows the key offered.

## Data & backups

App containers keep state in volumes (`dokku storage:mount`) or container
fs; `/home/dokku` (app configs, git repos) is covered by the restic scope
(`/home`). Images: `docker image prune` runs in the nightly
`homelab-update.timer`, dokku apps re-pull via `dokku ps:rebuild --all`.
