#!/bin/zsh
# reset.sh <ISO> [checkpoint]  – restore the pristine (or a checkpoint) local database and restart at that story time
L=/Users/khuram/Projects/Appstackx/marketing/clindesk/showcase-video-v1-src/local
SRC=$L/db-${2:-pristine}.sqlite
/Users/khuram/Projects/Appstackx/marketing/clindesk/showcase-video-v1-src/tools/server.sh stop
rm -f $L/db.sqlite-wal $L/db.sqlite-shm; cp $SRC $L/db.sqlite
/Users/khuram/Projects/Appstackx/marketing/clindesk/showcase-video-v1-src/tools/server.sh restart $1
