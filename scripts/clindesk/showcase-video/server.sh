#!/bin/zsh
# server.sh restart <ISO story time> | stop   – the local showcase app on :3320 (only the process this tool started)
L=/Users/khuram/Projects/Appstackx/marketing/clindesk/showcase-video-v1-src/local
stop() { pids=$(lsof -tiTCP:3320 -sTCP:LISTEN); [ -n "$pids" ] && kill $pids; sleep 1; }
case $1 in
  stop) stop ;;
  restart) stop; nohup $L/start-server.sh $2 > $L/server.log 2>&1 &
    for i in {1..40}; do curl -s -o /dev/null http://clinic.localhost:3320/ && break; sleep 0.5; done; echo "server at $2" ;;
esac
