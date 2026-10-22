#!/bin/sh
# BrickHack for Linux: starts the game server (node/bin/node server/server.js) in the background and opens the game
# in a window of its own (Chrome, Chromium, Brave or Edge in app mode: no tabs, no address bar; else the web
# browser); when that window closes, the server saves every game and stops.
DIR=$(cd "$(dirname "$0")" && pwd)
NODE="$DIR/node/bin/node"
PORT=18081
URL="http://127.0.0.1:$PORT/"
export PORT
up() { "$NODE" -e "require('net').connect($PORT,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"; }
if up; then echo "BrickHack is already running: $URL"; else
    "$NODE" "$DIR/server/server.js" >"$DIR/server.log" 2>&1 &
    SERVER=$!
    i=0
    until up; do i=$((i + 1)); [ $i -gt 100 ] && { echo "the server didn't start: see $DIR/server.log"; exit 1; }; sleep 0.1; done
fi
PROFILE="${XDG_CONFIG_HOME:-$HOME/.config}/BrickHack/window"
for b in google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge; do
    if command -v "$b" >/dev/null 2>&1; then
        mkdir -p "$PROFILE"
        "$b" --app="$URL" --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check --window-size=1280,800 >/dev/null 2>&1
        # (the window's closed: every game saved, the server stopped)
        "$NODE" -e "fetch('${URL}api/quit',{method:'POST'}).catch(()=>{})"
        [ -n "$SERVER" ] && wait "$SERVER"
        exit 0
    fi
done
xdg-open "$URL" >/dev/null 2>&1 || echo "Open $URL in your web browser."
echo "BrickHack is running at $URL. Press Ctrl+C here to save and stop."
trap '"$NODE" -e "fetch(\"${URL}api/quit\",{method:\"POST\"}).catch(()=>{})"; wait $SERVER; exit 0' INT TERM
[ -n "$SERVER" ] && wait "$SERVER"
