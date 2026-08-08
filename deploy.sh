#!/usr/bin/env bash
set -e
cd /opt/gal-yiba
git pull --ff-only
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
