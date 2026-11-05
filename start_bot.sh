#!/bin/bash
cd ~/gmgn-alert-bot-repo
export $(grep -v '^#' .env | xargs)
node index.js > bot.log 2>&1
