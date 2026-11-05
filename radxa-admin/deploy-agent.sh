#!/bin/sh
# Runs on the MAIN PC (wrangler and the Cloudflare login live here). Waits for the "Опублікувати" button in the admin:
#   RADXA_SSH=root@radxa.tail2dfcaf.ts.net DEPLOY_SCRIPT=~/Documents/Server/viteh-site/deploy-worker.sh ./deploy-agent.sh
# Every POLL seconds it asks the Radxa for a queued request (outbound ssh only, nothing listens here), runs deploy-from-radxa.sh and
# sends the result back so the admin shows it. Needs deploy-from-radxa.sh next to this file. Stop with Ctrl-C or systemctl --user stop.
set -u
: "${RADXA_SSH:?set RADXA_SSH=user@radxa}"
# Cloudflare credentials for unattended deploys (API token limited to "Workers Scripts: Edit"); never put them in the unit file or in git.
ENV_FILE=${DEPLOY_ENV_FILE:-$HOME/.config/viteh-deploy.env}
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
HERE=$(cd "$(dirname "$0")" && pwd)
KEY=${RADXA_KEY:-$HOME/.ssh/viteh_ai_radxa_ed25519}
POLL=${POLL:-10}
REMOTE_CLI=${REMOTE_CLI:-python3 /srv/fwportal/admin/vadmin-cli.py}
REMOTE_ENV=${REMOTE_ENV:-VADMIN_ROOT=/srv/fwportal/staging/viteh-site VADMIN_SECRET=/srv/fwportal/admin-secret}
SSH="ssh -o BatchMode=yes -o ConnectTimeout=10"; [ -f "$KEY" ] && SSH="$SSH -i $KEY -o IdentitiesOnly=yes"
remote() { $SSH "$RADXA_SSH" "env $REMOTE_ENV $REMOTE_CLI $*"; }
export DEPLOY_SCRIPT=${DEPLOY_SCRIPT:-$HOME/Documents/Server/viteh-site/deploy-worker.sh}
while :; do
  ID=$(remote deploy-next 2>/dev/null | tr -d '[:space:]')
  case "$ID" in
    [0-9]*-[0-9]*-[0-9a-f]*)
      echo "$(date '+%F %T') deploying $ID"
      LOG=$(mktemp); REPO_DIR=$(mktemp -d)
      ( GIT_TERMINAL_PROMPT=0 git clone --quiet --depth 1 ${VITEH_BRANCH:+-b "$VITEH_BRANCH"} "${VITEH_REPO:-https://github.com/Vitalii81/VitehSite.git}" "$REPO_DIR/src" \
        && WORKER_SRC="$REPO_DIR/src" sh "$HERE/deploy-from-radxa.sh" "$ID" ) >"$LOG" 2>&1 &
      PID=$!
      while kill -0 "$PID" 2>/dev/null; do          # every few seconds the page gets the tail of the log (progress)
        sleep 4
        tail -c 6000 "$LOG" | remote deploy-progress "$ID" >/dev/null 2>&1 || true
      done
      if wait "$PID"; then R=ok; else R=fail; fi
      rm -rf "$REPO_DIR"
      tail -c 6000 "$LOG" | remote deploy-report "$ID" "$R" || echo "could not report $R for $ID" >&2
      echo "$(date '+%F %T') $ID: $R"; rm -f "$LOG" ;;
  esac
  sleep "$POLL"
done
