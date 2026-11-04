#!/bin/sh
# Installs the private ViTeh admin on the Radxa (iStoreOS / BusyBox ash compatible, POSIX sh only).
#
#   sh install-on-radxa.sh [--listen IP]... [--admin-port 8082] [--preview-port 8083] [--probe URL]... [--dry-run]
#   sh install-on-radxa.sh --set-password
#   sh install-on-radxa.sh --update-code        (new admin code or site files; the service is not touched)
#   sh install-on-radxa.sh --uninstall [--purge-code] [--purge-data]
#
# The admin runs as its OWN small uhttpd service (procd, /etc/init.d/vadmin): one instance for the admin + CGI, one for the preview.
# nginx and its config are NOT touched at all (the Radxa's CGI is uhttpd, there is no fastcgi). Order of work:
#   1. checks python3, uhttpd, procd, disk space, ports and that every listen address is private
#   2. records the answers of the MAIN portal (default http://127.0.0.1/) before the change
#   3. installs the code and the init script, starts the service
#   4. checks the admin page, the CGI and the preview, and that the main portal answers exactly as before
#   5. ANY failure: stops and removes the service again, re-checks the portal, exits non-zero
# It never touches /srv/fwportal/reserve/, radxa-reserve/, /api/mail, /api/files, /api/bridge, /cgi-bin/* or the nginx config.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT_PREFIX=${INSTALL_ROOT:-}                       # tests install into a scratch tree
APP=${ROOT_PREFIX}/srv/fwportal/admin               # code
SECRET=${ROOT_PREFIX}/srv/fwportal/admin-secret     # password hash, session key (0700)
STAGING=${ROOT_PREFIX}/srv/fwportal/staging/viteh-site
DOCROOT=${APP}/docroot                              # what the admin uhttpd serves: web files, site-assets/, cgi-bin/vadmin-api
PREVIEW=${STAGING}/preview                          # what the preview uhttpd serves (swapped by every build)
INITD=${ROOT_PREFIX}/etc/init.d/vadmin
UHTTPD=${UHTTPD_BIN:-/usr/sbin/uhttpd}
SERVICE_CMD=${VADMIN_SERVICE_CMD:-$INITD}           # tests replace the real init script with a fake
STATE_FILE=${APP}/.install-state
ADMIN_PORT=8082
PREVIEW_PORT=8083
MIN_FREE_KB=204800
LISTEN=""
PROBES=""
DRY=0
MODE=install
PURGE_CODE=0
PURGE_DATA=0
BASE_FILE=""
CHANGED=0
TMPDIR_=""

say()  { printf '%s\n' "$*"; }
ok()   { printf 'OK    %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*" >&2; }
bad()  { printf 'FAIL  %s\n' "$*" >&2; }
die()  { bad "$*"; rollback; exit 1; }
run()  { if [ "$DRY" = 1 ]; then say "dry-run: $*"; else "$@"; fi; }

while [ $# -gt 0 ]; do
  case "$1" in
    --listen) LISTEN="$LISTEN $2"; shift ;;
    --admin-port) ADMIN_PORT=$2; shift ;;
    --preview-port) PREVIEW_PORT=$2; shift ;;
    --probe) PROBES="$PROBES $2"; shift ;;
    --dry-run) DRY=1 ;;
    --uninstall) MODE=uninstall ;;
    --set-password) MODE=password ;;
    --update-code) MODE=update ;;
    --purge-code) PURGE_CODE=1 ;;
    --purge-data) PURGE_DATA=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) bad "unknown option: $1"; exit 2 ;;
  esac
  shift
done
[ -n "$PROBES" ] || PROBES="http://127.0.0.1/"

# ---------- small helpers ----------
is_private_ip() {
  case "$1" in
    127.*|10.*|192.168.*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) return 0 ;;
    100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 0 ;;   # Tailscale / CGNAT 100.64.0.0/10
  esac
  return 1
}

fetch_body()   { if command -v curl >/dev/null 2>&1; then curl -s -m 8 "$1"; else wget -q -T 8 -O - "$1"; fi; }
fetch_status() {
  if command -v curl >/dev/null 2>&1; then curl -s -o /dev/null -m 8 -w '%{http_code}' "$1"
  else wget -S -q -T 8 -O /dev/null "$1" 2>&1 | awk '/HTTP\//{c=$2} END{print c+0}'; fi
}
digest() { if command -v md5sum >/dev/null 2>&1; then md5sum | cut -d' ' -f1; else cksum | cut -d' ' -f1; fi; }

svc() { [ "${SKIP_SERVICE:-0}" = 1 ] && return 0; "$SERVICE_CMD" "$@" >/dev/null 2>&1; }

# ---------- portal probes ----------
snapshot_portal() {   # $1 = output file; line per probe: url status digest stable
  out=$1; : > "$out"
  for url in $PROBES; do
    s1=$(fetch_status "$url"); d1=$(fetch_body "$url" | digest)
    d2=$(fetch_body "$url" | digest)
    stable=1; [ "$d1" = "$d2" ] || stable=0               # a page with a clock cannot be compared byte by byte
    printf '%s %s %s %s\n' "$url" "$s1" "$d1" "$stable" >> "$out"
  done
}

compare_portal() {    # $1 = baseline, $2 = now
  fails=0
  while read -r url s d stable; do
    now=$(grep -F "$url " "$2" | head -n 1)
    ns=$(printf '%s' "$now" | cut -d' ' -f2); nd=$(printf '%s' "$now" | cut -d' ' -f3)
    if [ "$ns" != "$s" ]; then bad "main portal $url: status $s -> $ns"; fails=1
    elif [ "$stable" = 1 ] && [ "$nd" != "$d" ]; then bad "main portal $url: the body changed"; fails=1; fi
  done < "$1"
  [ "$fails" = 0 ]
}

# ---------- rollback ----------
rollback() {
  [ "$CHANGED" = 1 ] || return 0
  warn "rolling back"
  if [ "$DRY" = 0 ]; then
    svc stop; svc disable
    rm -f "$INITD"
  fi
  if [ -n "$BASE_FILE" ] && [ -f "$BASE_FILE" ]; then
    snapshot_portal "$TMPDIR_/after-rollback"
    if compare_portal "$BASE_FILE" "$TMPDIR_/after-rollback"; then ok "main portal answers as before the attempt"; else bad "the main portal differs: check it by hand"; fi
  fi
  CHANGED=0
}

trap 'rc=$?; [ -n "$TMPDIR_" ] && rm -rf "$TMPDIR_"; exit $rc' EXIT
TMPDIR_=$(mktemp -d 2>/dev/null || { d=/tmp/vadmin-install.$$; mkdir -p "$d"; echo "$d"; })

# ---------- modes ----------
if [ "$MODE" = password ]; then
  [ -x "$APP/vadmin-cli.py" ] || die "the admin is not installed yet (run without --set-password first)"
  mkdir -p "$SECRET" && chmod 700 "$SECRET"
  VADMIN_SECRET="$SECRET" VADMIN_ROOT="$STAGING" exec python3 "$APP/vadmin-cli.py" set-password
fi

if [ "$MODE" = uninstall ]; then
  say "== uninstall =="
  snapshot_portal "$TMPDIR_/before"; BASE_FILE="$TMPDIR_/before"
  if [ "$DRY" = 1 ]; then say "dry-run: stop and remove the service $INITD"; else svc stop; svc disable; rm -f "$INITD"; ok "service stopped and removed"; fi
  snapshot_portal "$TMPDIR_/after"
  compare_portal "$BASE_FILE" "$TMPDIR_/after" || die "the main portal answers differently after the removal"
  [ "$PURGE_CODE" = 1 ] && run rm -rf "$APP" "$SECRET" && ok "removed code and the password hash"
  [ "$PURGE_DATA" = 1 ] && run rm -rf "$STAGING" && ok "removed draft, uploads and builds"
  ok "uninstalled; draft, uploads and builds were kept unless --purge-data"
  exit 0
fi

# ---------- document root of the admin uhttpd ----------
# Real copies, no symlinks: uhttpd resolves its root once. The CGI is a tiny wrapper that sets the environment (uhttpd passes none of ours).
build_docroot() {
  rm -rf "$DOCROOT.new"; mkdir -p "$DOCROOT.new/cgi-bin" || die "cannot create $DOCROOT.new"
  cp -R "$APP/web/." "$DOCROOT.new/" || die "cannot copy the web files"
  cp -R "$STAGING/src/assets" "$DOCROOT.new/site-assets" || die "cannot copy the site assets for the editor"
  {
    printf '#!/bin/sh\n'
    printf "VADMIN_ROOT='%s'\n" "${STAGING#"$ROOT_PREFIX"}"
    printf "VADMIN_SECRET='%s'\n" "${SECRET#"$ROOT_PREFIX"}"
    printf "VADMIN_PREVIEW_PORT='%s'\n" "$PREVIEW_PORT"
    printf 'export VADMIN_ROOT VADMIN_SECRET VADMIN_PREVIEW_PORT\n'
    printf "exec python3 '%s/cgi/vadmin.py'\n" "${APP#"$ROOT_PREFIX"}"
  } > "$DOCROOT.new/cgi-bin/vadmin-api"
  chmod 755 "$DOCROOT.new/cgi-bin/vadmin-api"
  rm -rf "$DOCROOT.old"; [ -d "$DOCROOT" ] && mv "$DOCROOT" "$DOCROOT.old"
  mv "$DOCROOT.new" "$DOCROOT" || die "cannot move the new document root in place"
  rm -rf "$DOCROOT.old"
}

# ---------- code and site files ----------
install_code() {
  if [ "$DRY" = 0 ]; then
    SITE_SRC="$HERE/site"; [ -f "$SITE_SRC/index.html" ] || SITE_SRC="$HERE/.."
    mkdir -p "$APP.new" "$SECRET" "$STAGING/src" "$STAGING/uploads" "$STAGING/builds" || die "cannot create directories"
    chmod 700 "$SECRET"
    cp -R "$HERE/cgi" "$HERE/lib" "$HERE/web" "$HERE/vadmin-cli.py" "$APP.new/" || die "copy failed"
    chmod +x "$APP.new/cgi/vadmin.py" "$APP.new/vadmin-cli.py"
    find "$APP.new" -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null
    [ -f "$STATE_FILE" ] && cp "$STATE_FILE" "$APP.new/.install-state"
    rm -rf "$APP.old"; [ -d "$APP" ] && mv "$APP" "$APP.old"; mv "$APP.new" "$APP" || die "cannot move the new code in place"
    rm -rf "$APP.old"
    for f in index.html impressum.html datenschutz.html robots.txt; do [ -f "$SITE_SRC/$f" ] && cp "$SITE_SRC/$f" "$STAGING/src/$f"; done
    rm -rf "$STAGING/src/assets" "$STAGING/src/data" "$STAGING/src/portfolio"
    cp -R "$SITE_SRC/assets" "$SITE_SRC/data" "$STAGING/src/" || die "cannot copy the site files"
    [ -d "$SITE_SRC/portfolio" ] && cp -R "$SITE_SRC/portfolio" "$STAGING/src/"
    build_docroot
    ok "code in $APP, site files in $STAGING/src"
  else
    say "dry-run: copy code to $APP, build $DOCROOT and copy site files to $STAGING/src"
  fi
}

if [ "$MODE" = update ]; then
  say "== update code and site files =="
  command -v python3 >/dev/null 2>&1 || die "python3 not found"
  [ -f "$HERE/cgi/vadmin.py" ] && [ -d "$HERE/lib/vadmin" ] && [ -d "$HERE/web" ] || die "run this script from the copied radxa-admin/ folder"
  if [ -f "$STATE_FILE" ]; then   # keep the ports chosen at install time
    PREVIEW_PORT=$(sed -n 's/.*"preview_port":\([0-9]*\).*/\1/p' "$STATE_FILE" | head -n 1); PREVIEW_PORT=${PREVIEW_PORT:-8083}
  fi
  install_code
  ok "updated; the draft, uploads and builds were not touched; the service keeps running (CGI code is read per request)"
  exit 0
fi

# ---------- install ----------
say "== preflight =="
command -v python3 >/dev/null 2>&1 || die "python3 not found (opkg install python3-light)"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)' || die "python3 >= 3.7 is required"
python3 -c 'import fcntl, hashlib, json, http.cookies, tarfile' >/dev/null 2>&1 || die "python3 is missing standard modules (fcntl/hashlib/json/tarfile): install the full python3 package"
ok "python3 $(python3 -V 2>&1 | cut -d' ' -f2)"
[ -x "$UHTTPD" ] || die "uhttpd not found at $UHTTPD (set UHTTPD_BIN=...)"
ok "uhttpd $UHTTPD"
[ "${SKIP_SERVICE:-0}" = 1 ] || [ -n "${VADMIN_SERVICE_CMD:-}" ] || [ -f /etc/rc.common ] || die "no procd (/etc/rc.common): this installer is for OpenWrt/iStoreOS"
[ -f "$HERE/cgi/vadmin.py" ] && [ -d "$HERE/lib/vadmin" ] && [ -d "$HERE/web" ] || die "run this script from the copied radxa-admin/ folder"
[ -f "$HERE/site/index.html" ] || [ -f "$HERE/../index.html" ] || die "site files not found next to radxa-admin/ (use push-to-radxa.sh)"

avail=$(df -Pk "$(dirname "$STAGING")" 2>/dev/null | awk 'NR==2{print $4}')
[ -z "${avail:-}" ] || [ "$avail" -ge "$MIN_FREE_KB" ] || die "less than 200 MB free (found ${avail} KB)"

# listen addresses: loopback + Tailscale (+ explicit ones); never public
if [ -z "$LISTEN" ]; then
  LISTEN="127.0.0.1"
  if command -v tailscale >/dev/null 2>&1; then
    ts=$(tailscale ip -4 2>/dev/null | head -n 1); [ -n "$ts" ] && LISTEN="$LISTEN $ts"
  fi
fi
for ip in $LISTEN; do
  is_private_ip "$ip" || die "refusing to listen on $ip: only loopback, LAN (RFC1918) and Tailscale (100.64/10) addresses are allowed"
done
ok "listen on:$LISTEN (ports $ADMIN_PORT admin, $PREVIEW_PORT preview)"
for port in $ADMIN_PORT $PREVIEW_PORT; do
  if (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$port "; ) || (command -v netstat >/dev/null 2>&1 && netstat -ltn 2>/dev/null | grep -q ":$port "); then
    [ -f "$STATE_FILE" ] || die "port $port is already in use (choose another with --admin-port / --preview-port)"
  fi
done

say "== record the main portal before the change =="
snapshot_portal "$TMPDIR_/before"; BASE_FILE="$TMPDIR_/before"
while read -r url s d stable; do say "      $url -> HTTP $s (body compare: $([ "$stable" = 1 ] && echo yes || echo 'no, the page changes by itself'))"; done < "$BASE_FILE"
awk '$2 !~ /^(200|301|302|401|403)$/ {f=1} END{exit f}' "$BASE_FILE" || warn "a probe URL does not answer 2xx/3xx/401/403 even before the change"

say "== install code =="
CHANGED=1
install_code
if [ "$DRY" = 0 ]; then
  mkdir -p "$PREVIEW"
  printf '{"installed":"%s","listen":"%s","admin_port":%s,"preview_port":%s}\n' "$(date -u +%FT%TZ)" "$(echo $LISTEN)" "$ADMIN_PORT" "$PREVIEW_PORT" > "$STATE_FILE"
fi

say "== write the service =="
service_script() {
  bind_admin=""; bind_prev=""
  for ip in $LISTEN; do bind_admin="$bind_admin -p $ip:$ADMIN_PORT"; bind_prev="$bind_prev -p $ip:$PREVIEW_PORT"; done
  cat <<EOF
#!/bin/sh /etc/rc.common
# ViTeh private admin (written by install-on-radxa.sh; remove with: sh install-on-radxa.sh --uninstall)
START=96
STOP=10
USE_PROCD=1

start_service() {
    # admin pages + CGI (login required); a script is killed after 60 s
    procd_open_instance admin
    procd_set_param command ${UHTTPD#"$ROOT_PREFIX"} -f -h ${DOCROOT#"$ROOT_PREFIX"} -r vadmin -x /cgi-bin -D -S -t 60 -T 60 -k 5 -n 3 -N 20$bind_admin
    procd_set_param respawn
    procd_close_instance
    # preview of the last built package (what would be published); no CGI
    procd_open_instance preview
    procd_set_param command ${UHTTPD#"$ROOT_PREFIX"} -f -h ${PREVIEW#"$ROOT_PREFIX"} -r vadmin-preview -D -S -T 60 -k 5 -N 20$bind_prev
    procd_set_param respawn
    procd_close_instance
}
EOF
}
if [ "$DRY" = 0 ]; then
  { mkdir -p "$(dirname "$INITD")" && service_script > "$INITD" && chmod 755 "$INITD"; } || die "cannot write $INITD"
  ok "written $INITD"
else
  say "dry-run: would write $INITD:"; service_script | sed 's/^/      /'
fi

say "== start =="
if [ "$DRY" = 0 ]; then
  svc enable || die "service enable failed"
  svc restart || die "service start failed"
  sleep 1
  snapshot_portal "$TMPDIR_/after"
  compare_portal "$BASE_FILE" "$TMPDIR_/after" || die "the main portal answers differently after the change"
  ok "main portal answers exactly as before"
  first=$(echo $LISTEN | cut -d' ' -f1)
  code=$(fetch_status "http://$first:$ADMIN_PORT/")
  [ "$code" = 200 ] || die "admin page: HTTP $code (expected 200)"
  fetch_body "http://$first:$ADMIN_PORT/" | grep -q "ViTeh" || die "admin page answers, but it is not ours"
  ok "admin page http://$first:$ADMIN_PORT/"
  code=$(fetch_status "http://$first:$ADMIN_PORT/cgi-bin/vadmin-api?action=status")
  [ "$code" = 401 ] || [ "$code" = 503 ] || die "admin API: HTTP $code (expected 401 without a login, or 503 before the password is set)"
  ok "admin API answers $code without a login (the CGI runs)"
  code=$(fetch_status "http://$first:$PREVIEW_PORT/")
  [ "$code" = 404 ] || [ "$code" = 200 ] || die "preview port: HTTP $code"
  ok "preview port http://$first:$PREVIEW_PORT/ (404 until the first build is normal)"
fi
CHANGED=0

say ""
say "Done. Next:"
say "  1) sh $0 --set-password"
say "  2) open http://$(echo $LISTEN | awk '{print $NF}'):$ADMIN_PORT/ from the tailnet/LAN"
exit 0
