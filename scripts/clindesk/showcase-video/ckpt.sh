#!/bin/zsh
# ckpt.sh <name> – snapshot the live local database (online backup)
L=/Users/khuram/Projects/Appstackx/marketing/clindesk/showcase-video-v1-src/local
sqlite3 $L/db.sqlite ".backup $L/db-$1.sqlite" && echo "checkpoint $1"
