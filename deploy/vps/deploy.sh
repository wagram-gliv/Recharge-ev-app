#!/usr/bin/env bash
# Met à jour le site sur le VPS : récupère `main`, (re)lance le conteneur statique.
# Usage (sur le VPS, utilisateur deploy) :  ~/apps/charge/deploy/vps/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
git fetch --quiet origin main
git checkout --quiet main
git reset --quiet --hard origin/main
docker compose -f deploy/vps/docker-compose.yml up -d
docker compose -f deploy/vps/docker-compose.yml exec -T charge-web caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || true
echo "Déployé : $(git log --oneline -1)"
