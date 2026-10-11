#!/bin/bash
# deploy.sh — llm-wiki-web auf sebasolo-server ausrollen (Mac-Mini-Plan Phase 6, 2026-10-11).
#
# Ablauf: Frontend nach GitHub pushen → auf dem Server das Content-Repo (öffentlicher Vault, nur
# lesender Deploy-Key über den SSH-Alias github.com-llmwiki) und das Web-Repo auf origin/main setzen →
# nur den Teil des Vaults in den Build-Kontext spiegeln, den frontend/src/lib/wiki.ts liest:
#   wiki/ ohne die Privatschichten 05_Sachkunde, 06_Fachliteratur und ohne 99_Meta/Reports,
#   raw/public/Rechtsprechung, raw/public/Gesetze & Co., index.md, Design.md (falls vorhanden).
# raw/private kommt damit nie auf den Server. Der Content wird beim Build ins Image kopiert
# (Dockerfile), es gibt keinen Bind-Mount mehr: ein Image = ein reproduzierbarer Inhaltsstand.
set -e

SERVER="sebasolo-server"
REMOTE_DIR="/opt/llm-wiki-web"
REMOTE_CONTENT_DIR="/opt/llm-wiki-public"
GITHUB_REPO="git@github.com:sebasolo-de/llm-wiki-web.git"
# Host-Alias github.com-llmwiki = Deploy-Key ~/.ssh/id_ed25519_llmwiki auf dem Server (~/.ssh/config)
CONTENT_REPO="git@github.com-llmwiki:sebasolo-de/LLM-WIKI.Betreuungsrecht.public.git"

echo "Pushe lokale Frontend-Änderungen zu GitHub..."
git push origin main

echo "Starte Deployment auf $SERVER..."
ssh $SERVER << EOF
    set -e

    # 1. Content-Repository (öffentlicher Vault) aktualisieren oder erstmals klonen
    if [ ! -d "$REMOTE_CONTENT_DIR/.git" ]; then
        echo "Klone Content-Repository..."
        git clone $CONTENT_REPO $REMOTE_CONTENT_DIR
    else
        echo "Ziehe neueste Content-Änderungen..."
        git -C $REMOTE_CONTENT_DIR remote set-url origin $CONTENT_REPO   # der alte Klon zeigte auf das stillgelegte Repo
        git -C $REMOTE_CONTENT_DIR fetch origin
        git -C $REMOTE_CONTENT_DIR reset --hard origin/main
    fi
    echo "Content-Stand: \$(git -C $REMOTE_CONTENT_DIR log -1 --format='%h %ad %s' --date=short)"

    # 2. Web-Repository aktualisieren oder initialisieren
    if [ ! -d "$REMOTE_DIR/.git" ]; then
        echo "Initialisiere Web-Repository auf dem Server..."
        mkdir -p $REMOTE_DIR
        cd $REMOTE_DIR
        git init
        git remote add origin $GITHUB_REPO
        git fetch --all
        git reset --hard origin/main
        git branch -M main
    else
        cd $REMOTE_DIR
        echo "Ziehe neueste Web-Änderungen..."
        git fetch --all
        git reset --hard origin/main
    fi

    # 3. Nur das in den Build-Kontext spiegeln, was wiki.ts liest (rsync --delete hält es sauber)
    echo "Spiegle Content in den Docker-Build-Kontext..."
    mkdir -p frontend/content/wiki "frontend/content/raw/public"
    rsync -a --delete --exclude '05_Sachkunde/' --exclude '06_Fachliteratur/' --exclude '99_Meta/Reports/' \
        "$REMOTE_CONTENT_DIR/wiki/" frontend/content/wiki/
    rsync -a --delete "$REMOTE_CONTENT_DIR/raw/public/Rechtsprechung/" "frontend/content/raw/public/Rechtsprechung/"
    rsync -a --delete "$REMOTE_CONTENT_DIR/raw/public/Gesetze & Co./" "frontend/content/raw/public/Gesetze & Co./"
    cp "$REMOTE_CONTENT_DIR/index.md" frontend/content/index.md
    cp "$REMOTE_CONTENT_DIR"/[Dd]esign.md frontend/content/Design.md 2>/dev/null || true
    rm -rf frontend/content/raw/private
    echo "Build-Kontext: \$(find frontend/content -type f | wc -l) Dateien, \$(du -sh frontend/content | cut -f1)"

    echo "Baue und starte Docker Container..."
    docker compose build --build-arg WIKI_CONTENT_PATH=./content
    docker compose up -d
    docker image prune -f > /dev/null

    echo "Lade Caddy neu..."
    docker exec remote_proxy_caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || true
EOF

echo "Deployment erfolgreich! ✅"
echo "https://llm-wiki.hebler-betreuung.de"
