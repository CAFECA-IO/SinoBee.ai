#!/usr/bin/env bash
# SinoBee.ai auto redeploy: update from GitHub, print the version, keep `npm run swarm` running under pm2.
#
#   shell/auto_redeploy.sh            update if GitHub has new commits; otherwise make sure the service is up
#   shell/auto_redeploy.sh --force    rebuild and restart even without new commits
#   shell/auto_redeploy.sh --status   print the version and the pm2 status only (no pull, no start)
#
# cron (every 5 minutes):
#   */5 * * * * /path/to/SinoBee.ai/shell/auto_redeploy.sh >> $HOME/sinobee-redeploy.log 2>&1
#
# Environment (all optional):
#   APP_NAME=sinobee        pm2 process name
#   REMOTE=origin BRANCH=…  where to pull from (default: origin / the checked-out branch)
#   SWARM_PORT=10023        port of the site (also used for the health check)
#   SWARM_ARGS="--no-h3"    extra arguments for `npm run swarm --` (used when the pm2 process is created)
#   SWARM_KEEP=1            keep docker services (PostgreSQL, Boltchain, Ollama, H3) running across restarts (default 1)
#   HEALTH_TIMEOUT=300      seconds to wait for the site to answer after a (re)start
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

APP_NAME="${APP_NAME:-sinobee}"
REMOTE="${REMOTE:-origin}"
SWARM_PORT="${SWARM_PORT:-10023}"
SWARM_ARGS="${SWARM_ARGS:-}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"
export SWARM_KEEP="${SWARM_KEEP:-1}" SWARM_PORT

FORCE=0
STATUS_ONLY=0
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    --status) STATUS_ONLY=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "ERROR: $*"; exit 1; }

# cron has a minimal PATH: pick up nvm / volta / common install locations
if ! command -v npm >/dev/null 2>&1 || ! command -v pm2 >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
  export PATH="$HOME/.volta/bin:$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
fi
command -v git >/dev/null 2>&1 || die "git not found"
command -v npm >/dev/null 2>&1 || die "npm not found"
command -v pm2 >/dev/null 2>&1 || die "pm2 not found (install: npm install -g pm2)"

# one run at a time (cron may start the next run while a build is still going)
LOCK_DIR="$ROOT/.git/auto_redeploy.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -f "$LOCK_DIR/pid" ] && kill -0 "$(cat "$LOCK_DIR/pid")" 2>/dev/null; then
    log "another run (pid $(cat "$LOCK_DIR/pid")) is in progress; exiting"
    exit 0
  fi
  log "removing a stale lock"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" || die "cannot create $LOCK_DIR"
fi
echo $$ > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT

version() {
  local pkg
  pkg="$(node -p "require('./package.json').version" 2>/dev/null || echo '?')"
  printf 'v%s (%s @ %s, %s) %s' "$pkg" "$(git rev-parse --abbrev-ref HEAD)" "$(git rev-parse --short HEAD)" \
    "$(git log -1 --format=%cd --date=format:'%Y-%m-%d %H:%M')" "$(git log -1 --format=%s | cut -c1-72)"
}

# pm2 status of APP_NAME: online | stopped | errored | launching | … | missing
pm2_status() {
  pm2 jlist 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const app = JSON.parse(s.slice(s.indexOf("["))).find((p) => p.name === process.argv[1]);
        console.log(app ? app.pm2_env.status : "missing");
      } catch { console.log("missing"); }
    });' "$APP_NAME"
}

pm2_create() {
  log "pm2: starting $APP_NAME → npm run swarm${SWARM_ARGS:+ -- $SWARM_ARGS} (cwd $ROOT, port $SWARM_PORT, SWARM_KEEP=$SWARM_KEEP)"
  # shellcheck disable=SC2086
  pm2 start npm --name "$APP_NAME" --cwd "$ROOT" --time --kill-timeout 15000 --restart-delay 5000 \
    -- run swarm ${SWARM_ARGS:+-- $SWARM_ARGS} >/dev/null || die "pm2 start failed"
  pm2 save >/dev/null 2>&1 || true
}

pm2_restart() {
  if [ "$(pm2_status)" = "missing" ]; then pm2_create; return; fi
  log "pm2: restarting $APP_NAME"
  pm2 restart "$APP_NAME" --update-env >/dev/null || die "pm2 restart failed"
  pm2 save >/dev/null 2>&1 || true
}

health() {
  command -v curl >/dev/null 2>&1 || { log "health: curl not found, skipped"; return 0; }
  local url="http://127.0.0.1:$SWARM_PORT/" waited=0 code
  log "health: waiting for $url (up to ${HEALTH_TIMEOUT}s)"
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)"
    if [ -n "$code" ] && [ "$code" != "000" ] && [ "$code" -lt 500 ]; then
      log "health: OK (HTTP $code after ${waited}s)"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done
  log "health: no answer after ${HEALTH_TIMEOUT}s — check: pm2 logs $APP_NAME --lines 100"
  return 1
}

install_deps() {
  log "npm install"
  npm install --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund || return 1
}

build() {
  # db:generate + next build (the running site keeps serving until the restart); output only on failure
  local out
  out="$(mktemp)"
  log "npm run build"
  if npm run build >"$out" 2>&1; then
    rm -f "$out"
    return 0
  fi
  tail -40 "$out"
  rm -f "$out"
  return 1
}

ensure_running() {
  local st
  st="$(pm2_status)"
  case "$st" in
    online) log "pm2: $APP_NAME is online — nothing to do" ;;
    missing) pm2_create; health ;;
    *) log "pm2: $APP_NAME is $st"; pm2_restart; health ;;
  esac
}

log "SinoBee.ai auto redeploy in $ROOT"
log "current version: $(version)"
if [ "$STATUS_ONLY" = 1 ]; then
  log "pm2: $APP_NAME is $(pm2_status)"
  exit 0
fi

BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
# a commit that failed to build is not tried again until GitHub moves on (or --force)
FAILED_FILE="$ROOT/.git/auto_redeploy.failed"
OLD="$(git rev-parse HEAD)"
UPDATED=0

if ! git fetch --quiet "$REMOTE" "$BRANCH" 2>&1; then
  log "WARN: git fetch $REMOTE $BRANCH failed — keeping the current version"
else
  NEW="$(git rev-parse "$REMOTE/$BRANCH")"
  if [ "$OLD" = "$NEW" ]; then
    log "GitHub: up to date ($REMOTE/$BRANCH @ $(git rev-parse --short "$NEW"))"
  elif [ "$FORCE" != 1 ] && [ -f "$FAILED_FILE" ] && [ "$(cat "$FAILED_FILE")" = "$NEW" ]; then
    log "WARN: $REMOTE/$BRANCH @ $(git rev-parse --short "$NEW") failed to build before — skipped until a new commit (or --force)"
  elif ! git merge-base --is-ancestor "$OLD" "$NEW"; then
    log "WARN: local $BRANCH has commits that are not on $REMOTE/$BRANCH (diverged) — not updating"
  elif [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    log "WARN: tracked files were changed on this server — not updating. See: git status"
  else
    log "GitHub: $(git rev-list --count "$OLD..$NEW") new commit(s):"
    git log --format='    %h %s' "$OLD..$NEW" | head -20
    if git merge --ff-only --quiet "$NEW"; then
      UPDATED=1
      log "updated to: $(version)"
    else
      log "WARN: fast-forward failed (untracked files in the way?) — keeping the current version"
    fi
  fi
fi

if [ "$UPDATED" = 1 ] || [ "$FORCE" = 1 ]; then
  [ "$UPDATED" = 1 ] || log "--force: rebuilding and restarting $(version)"
  ok=1
  if [ ! -d node_modules ] || { [ "$UPDATED" = 1 ] && [ -n "$(git diff --name-only "$OLD" HEAD -- package.json package-lock.json)" ]; }; then
    install_deps || ok=0
  fi
  [ "$ok" = 1 ] && { build || ok=0; }
  if [ "$ok" = 1 ]; then
    rm -f "$FAILED_FILE"
    pm2_restart
    health
    log "done: running $(version)"
    exit 0
  fi
  # the new version does not install or build: go back to the previous one so the site keeps working
  if [ "$UPDATED" = 1 ]; then
    log "ERROR: the new version failed to install/build — rolling back to $(git rev-parse --short "$OLD")"
    echo "$NEW" > "$FAILED_FILE"
    git reset --hard --quiet "$OLD"
    [ -n "$(git diff --name-only "$OLD" "$NEW" -- package.json package-lock.json)" ] && install_deps
    if build; then
      pm2_restart
      health
      log "rolled back: running $(version); the next run waits for a newer commit on $REMOTE/$BRANCH"
    else
      log "ERROR: the previous version does not build either — leaving pm2 as is"
    fi
  else
    log "ERROR: build failed — leaving pm2 as is"
  fi
  exit 1
fi

ensure_running
