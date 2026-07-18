#!/bin/bash
set -e

SERVER="sebasolo-server"
REMOTE_DIR="/opt/llm-wiki-web"
REMOTE_CONTENT_DIR="/opt/llm-wiki-public"
GITHUB_REPO="git@github.com:sebasolo-de/llm-wiki-web.git"
CONTENT_REPO="git@github.com:sebasolo-de/llm-wiki-betreuungsrecht-public.git"

echo "Pushe lokale Frontend-Änderungen zu GitHub..."
git push origin main

echo "Starte Deployment auf $SERVER..."
ssh $SERVER << EOF
    set -e

    # 1. Content-Repository aktualisieren/initialisieren
    if [ ! -d "$REMOTE_CONTENT_DIR" ]; then
        echo "Initialisiere Content-Repository auf dem Server..."
        git clone $CONTENT_REPO $REMOTE_CONTENT_DIR
    else
        echo "Ziehe neueste Content-Änderungen..."
        git -C $REMOTE_CONTENT_DIR fetch --all
        git -C $REMOTE_CONTENT_DIR reset --hard origin/main
    fi

    # 2. Web-Repository aktualisieren/initialisieren
    if [ ! -d "$REMOTE_DIR" ]; then
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

    # 3. Content in den Build-Kontext kopieren (für Next.js SSG beim Docker-Build)
    echo "Kopiere Content in den Docker-Build-Kontext..."
    rm -rf frontend/content-wiki frontend/content-raw
    cp -r $REMOTE_CONTENT_DIR/wiki ./frontend/content-wiki
    cp -r $REMOTE_CONTENT_DIR/raw ./frontend/content-raw

    echo "Baue und starte Docker Container..."
    docker compose build --build-arg WIKI_CONTENT_PATH=./content-wiki
    docker compose up -d

    echo "Lade Caddy neu..."
    docker exec remote_proxy_caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || true
EOF

echo "Deployment erfolgreich! ✅"
echo "https://llm-wiki.hebler-betreuung.de"
