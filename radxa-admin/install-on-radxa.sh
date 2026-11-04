#!/bin/sh
# Installs the private ViTeh admin on the Radxa (iStoreOS / BusyBox ash compatible, POSIX sh only).
#
#   sh install-on-radxa.sh [--listen IP]... [--admin-port 8082] [--preview-port 8081] [--probe URL]... [--dry-run]
#   sh install-on-radxa.sh --set-password
#   sh install-on-radxa.sh --update-code        (new admin code or site files; nginx is not touched)
#   sh install-on-radxa.sh --uninstall [--purge-code] [--purge-data]
#
# What it does, in this order (and undoes in reverse order at the first failure):
#   1. checks python3, nginx, a CGI mechanism, disk space, ports and that every listen address is private
#   2. records the answers of the MAIN portal (default http://127.0.0.1/) before the change
#   3. backs up the nginx config, installs the code, writes our two server blocks AFTER the main `server {` (or into conf.d)
#   4. nginx -t, reload, then compares the main portal's answers with step 2 and tests the admin
#   5. ANY failure: restores the backup, reloads, re-checks the portal, exits non-zero
# It never touches /srv/fwportal/reserve/, radxa-reserve/, /api/mail, /api/files, /api/bridge or /cgi-bin/*.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT_PREFIX=${INSTALL_ROOT:-}                       # tests install into a scratch tree
APP=${ROOT_PREFIX}/srv/fwportal/admin               # code
SECRET=${ROOT_PREFIX}/srv/fwportal/admin-secret     # password hash, session key (0700)
STAGING=${ROOT_PREFIX}/srv/fwportal/staging/viteh-site
NGINX_CONF=${NGINX_CONF:-${ROOT_PREFIX}/etc/nginx/nginx.conf}
NGINX=${NGINX_BIN:-nginx}
MARK_BEGIN="# >>> viteh-admin (managed by install-on-radxa.sh; remove with --uninstall) >>>"
MARK_END="# <<< viteh-admin <<<"
STATE_FILE=${APP}/.install-state
ADMIN_PORT=8082
PREVIEW_PORT=8081
MIN_FREE_KB=204800
LISTEN=""
PROBES=""
DRY=0
MODE=install
PURGE_CODE=0
PURGE_DATA=0
BACKUP=""
CONF_TARGET=""
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
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
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

nginx_reload() {
  [ "${SKIP_RELOAD:-0}" = 1 ] && return 0
  if "$NGINX" -s reload >/dev/null 2>&1; then return 0; fi
  [ -x /etc/init.d/nginx ] && /etc/init.d/nginx reload >/dev/null 2>&1
}

nginx_dump() { "$NGINX" -T 2>/dev/null; }

# ---------- portal probes ----------
BASE_FILE=""
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
  if [ -n "$BACKUP" ] && [ -f "$BACKUP" ] && [ "$DRY" = 0 ]; then
    cp -p "$BACKUP" "$NGINX_CONF" 2>/dev/null
  fi
  [ -n "$CONF_TARGET" ] && [ -f "$CONF_TARGET" ] && [ "$DRY" = 0 ] && rm -f "$CONF_TARGET"
  nginx_reload
  if [ -n "$BASE_FILE" ] && [ -f "$BASE_FILE" ]; then
    snapshot_portal "$TMPDIR_/after-rollback"
    if compare_portal "$BASE_FILE" "$TMPDIR_/after-rollback"; then ok "main portal answers as before the attempt"; else bad "the main portal still differs: check nginx by hand (backup: $BACKUP)"; fi
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

# Where our nginx blocks live: a conf.d include if the main config has one, otherwise a marked block after the first `server {`.
detect_target() {
  dump=$(nginx_dump)
  inc=$(printf '%s\n' "$dump" | sed -n 's/^[[:space:]]*include[[:space:]]\{1,\}\(.*conf\.d\/\)\*\.conf;.*/\1/p' | head -n 1)
  if [ -n "$inc" ] && [ -d "$inc" ]; then CONF_TARGET="${inc}viteh-admin.conf"; else CONF_TARGET=""; fi
}

if [ "$MODE" = uninstall ]; then
  say "== uninstall =="
  command -v "$NGINX" >/dev/null 2>&1 || die "nginx not found"
  snapshot_portal "$TMPDIR_/before"; BASE_FILE="$TMPDIR_/before"
  detect_target
  BACKUP="${NGINX_CONF}.vadmin-uninstall-$(date +%Y%m%d-%H%M%S)"
  cp -p "$NGINX_CONF" "$BACKUP" || die "cannot back up $NGINX_CONF"
  CHANGED=1
  if [ -n "$CONF_TARGET" ] && [ -f "$CONF_TARGET" ]; then run rm -f "$CONF_TARGET"; ok "removed $CONF_TARGET"; fi
  if grep -qF "$MARK_BEGIN" "$NGINX_CONF"; then
    awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$NGINX_CONF" > "$TMPDIR_/conf.new" && run cp "$TMPDIR_/conf.new" "$NGINX_CONF"
    ok "removed the managed block from $NGINX_CONF"
  fi
  "$NGINX" -t >/dev/null 2>&1 || die "nginx -t fails after removal"
  nginx_reload || die "nginx reload failed"
  snapshot_portal "$TMPDIR_/after"
  compare_portal "$BASE_FILE" "$TMPDIR_/after" || die "the main portal answers differently after the removal"
  CHANGED=0
  [ "$PURGE_CODE" = 1 ] && run rm -rf "$APP" "$SECRET" && ok "removed code and the password hash"
  [ "$PURGE_DATA" = 1 ] && run rm -rf "$STAGING" && ok "removed draft, uploads and builds"
  ok "uninstalled (nginx backup: $BACKUP); draft, uploads and builds were kept unless --purge-data"
  exit 0
fi

# ---------- update only ----------
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
    rm -rf "$STAGING/src/assets" "$STAGING/src/data"
    cp -R "$SITE_SRC/assets" "$SITE_SRC/data" "$STAGING/src/" || die "cannot copy the site files"
    ok "code in $APP, site files in $STAGING/src"
  else
    say "dry-run: copy code to $APP and site files to $STAGING/src"
  fi
}

if [ "$MODE" = update ]; then
  say "== update code and site files =="
  command -v python3 >/dev/null 2>&1 || die "python3 not found"
  [ -f "$HERE/cgi/vadmin.py" ] && [ -d "$HERE/lib/vadmin" ] && [ -d "$HERE/web" ] || die "run this script from the copied radxa-admin/ folder"
  install_code
  ok "updated; the draft, uploads and builds were not touched; nginx was not touched"
  exit 0
fi

# ---------- install ----------
say "== preflight =="
command -v python3 >/dev/null 2>&1 || die "python3 not found (opkg install python3-light)"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)' || die "python3 >= 3.7 is required"
python3 -c 'import fcntl, hashlib, json, http.cookies, tarfile' >/dev/null 2>&1 || die "python3 is missing standard modules (fcntl/hashlib/json/tarfile): install the full python3 package"
ok "python3 $(python3 -V 2>&1 | cut -d' ' -f2)"
command -v "$NGINX" >/dev/null 2>&1 || die "nginx not found"
[ -f "$NGINX_CONF" ] || die "nginx config not found: $NGINX_CONF (set NGINX_CONF=...)"
"$NGINX" -t >/dev/null 2>&1 || die "nginx -t fails BEFORE any change: fix nginx first"
ok "nginx config is valid"
detect_target
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
    grep -qF "$MARK_BEGIN" "$NGINX_CONF" || [ -f "${CONF_TARGET:-/nonexistent}" ] || die "port $port is already in use"
  fi
done

dump=$(nginx_dump)
fcgi=$(printf '%s\n' "$dump" | sed -n 's/^[[:space:]]*fastcgi_pass[[:space:]]\{1,\}\([^;]*\);.*/\1/p' | head -n 1)
if [ -z "$fcgi" ]; then
  for sock in /var/run/fcgiwrap.socket /run/fcgiwrap.socket /var/run/fcgiwrap/fcgiwrap.sock; do
    [ -S "${ROOT_PREFIX}$sock" ] && fcgi="unix:$sock" && break
  done
fi
[ -n "$fcgi" ] || die "no CGI mechanism found (no fastcgi_pass in nginx and no fcgiwrap socket). Install fcgiwrap or tell me how /cgi-bin/ runs here; nothing was changed"
ok "CGI via fastcgi_pass $fcgi (the same one the existing /cgi-bin/ uses)"

say "== record the main portal before the change =="
snapshot_portal "$TMPDIR_/before"; BASE_FILE="$TMPDIR_/before"
while read -r url s d stable; do say "      $url -> HTTP $s (body compare: $([ "$stable" = 1 ] && echo yes || echo 'no, the page changes by itself'))"; done < "$BASE_FILE"
awk '$2 !~ /^(200|301|302|401|403)$/ {f=1} END{exit f}' "$BASE_FILE" || warn "a probe URL does not answer 2xx/3xx/401/403 even before the change"

say "== backup =="
BACKUP="${NGINX_CONF}.vadmin-backup-$(date +%Y%m%d-%H%M%S)"
cp -p "$NGINX_CONF" "$BACKUP" || die "cannot write the backup next to $NGINX_CONF"
ok "$BACKUP"

say "== install code =="
install_code
if [ "$DRY" = 0 ]; then
  printf '{"installed":"%s","listen":"%s","admin_port":%s,"preview_port":%s}\n' "$(date -u +%FT%TZ)" "$(echo $LISTEN)" "$ADMIN_PORT" "$PREVIEW_PORT" > "$STATE_FILE"
fi

say "== write nginx blocks =="
block() {
  listens_admin=""; listens_prev=""
  for ip in $LISTEN; do listens_admin="$listens_admin    listen $ip:$ADMIN_PORT;
"; listens_prev="$listens_prev    listen $ip:$PREVIEW_PORT;
"; done
  cat <<EOF
$MARK_BEGIN
# Private admin (login required). Reachable only on the addresses below; never published through the Cloudflare tunnel.
server {
${listens_admin}    server_name _;
    root ${APP#"$ROOT_PREFIX"}/web;
    index index.html;
    client_max_body_size 9m;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'" always;
    location = /vadmin-api {
        fastcgi_param SCRIPT_FILENAME ${APP#"$ROOT_PREFIX"}/cgi/vadmin.py;
        fastcgi_param REQUEST_METHOD \$request_method;
        fastcgi_param QUERY_STRING \$query_string;
        fastcgi_param CONTENT_TYPE \$content_type;
        fastcgi_param CONTENT_LENGTH \$content_length;
        fastcgi_param REMOTE_ADDR \$remote_addr;
        fastcgi_param VADMIN_ROOT ${STAGING#"$ROOT_PREFIX"};
        fastcgi_param VADMIN_SECRET ${SECRET#"$ROOT_PREFIX"};
        fastcgi_read_timeout 60s;
        fastcgi_pass $fcgi;
    }
    location /site-assets/ { alias ${STAGING#"$ROOT_PREFIX"}/src/assets/; }
}
# Preview of the last built package (what would be published).
server {
${listens_prev}    server_name _;
    root ${STAGING#"$ROOT_PREFIX"}/builds/current/site;
    index index.html;
    add_header X-Robots-Tag "noindex, nofollow" always;
    add_header Cache-Control "no-store" always;
    location / { try_files \$uri \$uri/ =404; }
}
$MARK_END
EOF
}
CHANGED=1
if [ -n "$CONF_TARGET" ]; then
  if [ "$DRY" = 0 ]; then block > "$CONF_TARGET"; fi
  ok "written $CONF_TARGET (included by the main config; the main config itself is untouched)"
else
  if grep -qF "$MARK_BEGIN" "$NGINX_CONF"; then die "the managed block is already present: run --uninstall first or edit it by hand"; fi
  block > "$TMPDIR_/block.txt"
  # insert after the closing brace of the FIRST server block inside http { }, so the main portal stays the default server
  awk -v blockfile="$TMPDIR_/block.txt" '
    function flush(  line) { while ((getline line < blockfile) > 0) print line; close(blockfile) }
    { print }
    /^[[:space:]]*http[[:space:]]*\{/ { inhttp=1 }
    inhttp && !done {
      line=$0; gsub(/#.*/, "", line)
      n=gsub(/\{/, "{", line); m=gsub(/\}/, "}", line)
      if (!seen && line ~ /server[[:space:]]*\{/) { seen=1 }
      if (seen) { depth += n - m; if (depth <= 0 && m > 0) { flush(); done=1 } }
    }' "$NGINX_CONF" > "$TMPDIR_/conf.new"
  grep -qF "$MARK_BEGIN" "$TMPDIR_/conf.new" || die "could not find the main server block in $NGINX_CONF: add the block by hand (see ADMIN.md); nothing was changed"
  [ "$DRY" = 0 ] && cp "$TMPDIR_/conf.new" "$NGINX_CONF"
  ok "inserted after the main server block in $NGINX_CONF"
fi

say "== check and reload =="
"$NGINX" -t >"$TMPDIR_/nginx-t.log" 2>&1 || { cat "$TMPDIR_/nginx-t.log" >&2; die "nginx -t failed with the new blocks"; }
ok "nginx -t"
nginx_reload || die "nginx reload failed"
sleep 1
snapshot_portal "$TMPDIR_/after"
compare_portal "$BASE_FILE" "$TMPDIR_/after" || die "the main portal answers differently after the change"
ok "main portal answers exactly as before"

if [ "$DRY" = 0 ]; then
  first=$(echo $LISTEN | cut -d' ' -f1)
  code=$(fetch_status "http://$first:$ADMIN_PORT/")
  [ "$code" = 200 ] || die "admin page: HTTP $code (expected 200)"
  fetch_body "http://$first:$ADMIN_PORT/" | grep -q "ViTeh" || die "admin page answers, but it is not ours"
  ok "admin page http://$first:$ADMIN_PORT/"
  code=$(fetch_status "http://$first:$ADMIN_PORT/vadmin-api?action=status")
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
say "  nginx backup: $BACKUP"
exit 0
