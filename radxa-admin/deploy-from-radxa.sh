#!/bin/sh
# Run on the MAIN PC (where wrangler and the Cloudflare login live). Publishes a package built on the Radxa:
#   ./deploy-from-radxa.sh [<build-id>] [--dry-run]
# It pulls the package over ssh+tar, verifies every file against the manifest's SHA-256, runs the existing
# `deploy-worker.sh --source <dir>` and, only after a successful deploy, marks the build as published on the Radxa.
# Cloudflare credentials never leave this PC. Put this file next to deploy-worker.sh (Server repository).
#
# Environment: RADXA_SSH=user@radxa (required)  RADXA_KEY (default ~/.ssh/viteh_ai_radxa_ed25519)
#              DEPLOY_SCRIPT (default ./deploy-worker.sh)  REMOTE_CLI (default "python3 /srv/fwportal/admin/vadmin-cli.py")
#              REMOTE_ENV (default "VADMIN_ROOT=/srv/fwportal/staging/viteh-site VADMIN_SECRET=/srv/fwportal/admin-secret")
set -eu
ID=""; DRY=0
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; -h|--help) sed -n '2,11p' "$0"; exit 0 ;; -*) echo "unknown option $a" >&2; exit 2 ;; *) ID=$a ;; esac; done
: "${RADXA_SSH:?set RADXA_SSH=user@radxa}"
KEY=${RADXA_KEY:-$HOME/.ssh/viteh_ai_radxa_ed25519}
DEPLOY_SCRIPT=${DEPLOY_SCRIPT:-./deploy-worker.sh}
REMOTE_CLI=${REMOTE_CLI:-python3 /srv/fwportal/admin/vadmin-cli.py}
REMOTE_ENV=${REMOTE_ENV:-VADMIN_ROOT=/srv/fwportal/staging/viteh-site VADMIN_SECRET=/srv/fwportal/admin-secret}
SSH="ssh"; [ -f "$KEY" ] && SSH="ssh -i $KEY -o IdentitiesOnly=yes"
remote() { $SSH "$RADXA_SSH" "env $REMOTE_ENV $REMOTE_CLI $*"; }

if [ -z "$ID" ]; then
  ID=$(remote list | awk '/\[built\]/{print $1; exit}')
  [ -n "$ID" ] || { echo "No built package on the Radxa: build one in the admin first." >&2; exit 1; }
  echo "Using the latest built package: $ID"
fi
case "$ID" in [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;; *) echo "Bad build id: $ID" >&2; exit 2 ;; esac

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
echo "Downloading $ID ..."
remote export "$ID" | tar -xf - -C "$WORK"
[ -f "$WORK/manifest.json" ] && [ -d "$WORK/site" ] || { echo "The download is not a package." >&2; exit 1; }

echo "Verifying checksums ..."
python3 - "$WORK" "$ID" <<'PY'
import hashlib, json, os, sys
work, bid = sys.argv[1], sys.argv[2]
manifest = json.load(open(os.path.join(work, "manifest.json")))
if manifest.get("id") != bid:
    sys.exit("manifest id %r does not match %r" % (manifest.get("id"), bid))
site = os.path.join(work, "site")
listed = manifest["files"]
actual = {}
for root, _, names in os.walk(site):
    for n in names:
        p = os.path.join(root, n)
        actual[os.path.relpath(p, site).replace(os.sep, "/")] = p
problems = []
for rel, digest in listed.items():
    if rel not in actual:
        problems.append("missing: " + rel)
    elif hashlib.sha256(open(actual[rel], "rb").read()).hexdigest() != digest:
        problems.append("changed: " + rel)
for rel in actual:
    if rel not in listed:
        problems.append("unexpected: " + rel)
    if rel.startswith("/") or ".." in rel.split("/"):
        problems.append("unsafe path: " + rel)
if problems:
    sys.exit("Verification FAILED:\n  " + "\n  ".join(problems[:20]))
print("OK: %d files match the manifest" % len(listed))
PY

if [ "$DRY" = 1 ]; then echo "dry-run: would run $DEPLOY_SCRIPT --source $WORK/site"; exit 0; fi
echo "Deploying with $DEPLOY_SCRIPT ..."
"$DEPLOY_SCRIPT" --source "$WORK/site"
echo "Marking $ID as published on the Radxa ..."
remote mark-published "$ID" || echo "Deployed, but could not mark it on the Radxa (run: vadmin-cli.py mark-published $ID)." >&2
echo "Published $ID."
