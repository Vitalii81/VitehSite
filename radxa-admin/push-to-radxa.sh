#!/bin/sh
# Run on the main PC. Copies radxa-admin/ and the public site files to the Radxa over ssh (tar), without needing git or rsync there.
#   ./radxa-admin/push-to-radxa.sh user@radxa            # first install or code update
#   then on the Radxa:  sh /srv/fwportal/admin-incoming/radxa-admin/install-on-radxa.sh        (first time)
#                  or:  sh /srv/fwportal/admin-incoming/radxa-admin/install-on-radxa.sh --update-code
# Environment: RADXA_KEY (default ~/.ssh/viteh_ai_radxa_ed25519), REMOTE_DIR (default /srv/fwportal/admin-incoming)
set -eu
[ $# -ge 1 ] || { sed -n '2,7p' "$0"; exit 2; }
HOST=$1
KEY=${RADXA_KEY:-$HOME/.ssh/viteh_ai_radxa_ed25519}
REMOTE_DIR=${REMOTE_DIR:-/srv/fwportal/admin-incoming}
REPO=$(cd "$(dirname "$0")/.." && pwd)
SSH="ssh"; [ -f "$KEY" ] && SSH="ssh -i $KEY -o IdentitiesOnly=yes"
cd "$REPO"
for f in index.html impressum.html datenschutz.html robots.txt assets data radxa-admin/cgi radxa-admin/lib radxa-admin/web radxa-admin/vadmin-cli.py radxa-admin/install-on-radxa.sh; do
  [ -e "$f" ] || { echo "missing $f (run from a full checkout)" >&2; exit 1; }
done
echo "Copying to $HOST:$REMOTE_DIR ..."
tar -cf - --exclude='__pycache__' --exclude='*.pyc' --exclude='.dev-data' \
  index.html impressum.html datenschutz.html robots.txt assets data \
  radxa-admin/cgi radxa-admin/lib radxa-admin/web radxa-admin/vadmin-cli.py radxa-admin/install-on-radxa.sh \
  | $SSH "$HOST" "mkdir -p '$REMOTE_DIR' && cd '$REMOTE_DIR' && tar -xf -"
echo "Done. On the Radxa run:  sh $REMOTE_DIR/radxa-admin/install-on-radxa.sh   (or --update-code)"
