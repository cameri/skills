#!/usr/bin/env bash
# Readiness and failure-mode diagnostics for herdr remote attach over SSH.
# Run ON the target machine (the one running the herdr server). Each check
# corresponds to a requirement that actually failed in production on
# 2026-09-07 (see the skill's SKILL.md): SSH transport, env parity via sshd
# SetEnv, the server being a detached session leader, and the real session
# reporting running.
#
# Prints per-check OK / FAIL / SKIP and exits 0 only when every check that
# ran came back OK.
#
# Env overrides:
#   HERDR_SSHD_DIR   sshd config dir (default: $HOME/.sshd)
#   HERDR_SSHD_PORT  sshd port (default: 2222)
set -uo pipefail

DIR="${HERDR_SSHD_DIR:-$HOME/.sshd}"
PORT="${HERDR_SSHD_PORT:-2222}"
CONFIG="$DIR/sshd_config"
FAIL=0

ok()   { echo "OK:   $1"; }
skip() { echo "SKIP: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

echo "== sshd process =="
if [ -f "$DIR/sshd.pid" ] && kill -0 "$(cat "$DIR/sshd.pid" 2>/dev/null)" 2>/dev/null; then
  ok "sshd running (pid $(cat "$DIR/sshd.pid"))"
elif pgrep -f "sshd.*$DIR" >/dev/null 2>&1; then
  ok "sshd running (pid $(pgrep -f "sshd.*$DIR" | head -1), no pid file)"
else
  fail "no sshd running from $DIR (run scripts/setup-herdr-sshd.sh)"
fi

echo
echo "== port $PORT listening =="
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  exec 3>&- 2>/dev/null || true
  exec 3<&- 2>/dev/null || true
  ok "port $PORT accepts connections"
else
  fail "port $PORT not listening (sshd may not be up; /dev/tcp is authoritative in containers where ss shows nothing)"
fi

echo
echo "== key-only auth =="
if [ -f "$CONFIG" ] && grep -qE '^\s*PasswordAuthentication\s+no' "$CONFIG"; then
  ok "PasswordAuthentication no in $CONFIG"
else
  fail "sshd_config missing 'PasswordAuthentication no'"
fi

echo
echo "== sshd SetEnv vs running server env (parity) =="
SERVER_PIDS=$(pgrep -f '^herdr server($| )' 2>/dev/null || true)
if [ -z "$SERVER_PIDS" ]; then
  skip "no 'herdr server' process found; nothing to compare"
elif [ "$(echo "$SERVER_PIDS" | wc -l)" -gt 1 ]; then
  fail "multiple herdr server processes ($(echo "$SERVER_PIDS" | tr '\n' ' ')); attach target is ambiguous"
else
  SERVER_PID=$SERVER_PIDS
  declare -A SERVER_ENV
  while IFS='=' read -r KEY VALUE; do
    [ -n "$KEY" ] && SERVER_ENV["$KEY"]="$VALUE"
  done < <(tr '\0' '\n' < "/proc/$SERVER_PID/environ" 2>/dev/null)
  if [ "${#SERVER_ENV[@]}" -eq 0 ]; then
    fail "cannot read /proc/$SERVER_PID/environ"
  fi
  SETENV=$(grep -E '^\s*SetEnv\s' "$CONFIG" 2>/dev/null || true)
  if [ -z "$SETENV" ]; then
    # No injection configured: parity holds only if the server env has no
    # overrides either (both sides then resolve herdr's default config root).
    if [ -z "${SERVER_ENV[XDG_CONFIG_HOME]:-}" ] && [ -z "${SERVER_ENV[HERDR_SESSION]:-}" ]; then
      ok "no SetEnv, and server env has no XDG_CONFIG_HOME/HERDR_SESSION override (default context matches)"
    else
      fail "server runs with XDG_CONFIG_HOME='${SERVER_ENV[XDG_CONFIG_HOME]:-}' HERDR_SESSION='${SERVER_ENV[HERDR_SESSION]:-}' but sshd_config has no SetEnv; add it (run scripts/setup-herdr-sshd.sh)"
    fi
  else
    for PAIR in $(echo "$SETENV" | sed -E 's/^\s*SetEnv\s+//'); do
      KEY="${PAIR%%=*}"
      VALUE="${PAIR#*=}"
      case "$KEY" in
        XDG_CONFIG_HOME|HERDR_SESSION)
          if [ "${SERVER_ENV[$KEY]:-}" = "$VALUE" ]; then
            ok "SetEnv $KEY=$VALUE matches the running server"
          elif [ -z "${SERVER_ENV[$KEY]:-}" ] && [ "$KEY" = "HERDR_SESSION" ]; then
            ok "SetEnv $KEY=$VALUE; server env has no $KEY (defaults match an unset value only if the server session is 'default')"
          else
            fail "SetEnv $KEY=$VALUE but the server runs with $KEY='${SERVER_ENV[$KEY]:-}'"
          fi
          ;;
      esac
    done
  fi
fi

echo
echo "== detached daemon (session leader) =="
if [ -n "${SERVER_PIDS:-}" ] && [ "$(echo "$SERVER_PIDS" | wc -l)" -eq 1 ]; then
  SID=$(ps -o sid= -p "$SERVER_PID" 2>/dev/null | tr -d ' ')
  if [ "$SID" = "$SERVER_PID" ]; then
    ok "herdr server pid $SERVER_PID is its own session leader (detached_server_daemon true)"
  else
    fail "herdr server pid $SERVER_PID runs in session $SID, not its own; herdr --remote will demand a restart and may fall back to a fresh session. Relaunch it detached: setsid herdr server &"
  fi
fi

echo
echo "== target session running =="
if [ -n "${SERVER_PIDS:-}" ] && [ "$(echo "$SERVER_PIDS" | wc -l)" -eq 1 ]; then
  RUN_XDG="${SERVER_ENV[XDG_CONFIG_HOME]:-}"
  RUN_SESSION="${SERVER_ENV[HERDR_SESSION]:-}"
  LIST_CMD="herdr session list"
  if [ -n "$RUN_XDG" ]; then LIST_CMD="XDG_CONFIG_HOME='$RUN_XDG' $LIST_CMD"; fi
  if [ -n "$RUN_SESSION" ]; then LIST_CMD="HERDR_SESSION='$RUN_SESSION' $LIST_CMD"; fi
  if command -v jq >/dev/null 2>&1; then
    SESSION_JSON=$(env ${RUN_XDG:+XDG_CONFIG_HOME="$RUN_XDG"} ${RUN_SESSION:+HERDR_SESSION="$RUN_SESSION"} herdr session list --json 2>/dev/null || true)
    if [ -n "$RUN_SESSION" ]; then
      RUNNING_STATE=$(echo "$SESSION_JSON" | jq -r --arg s "$RUN_SESSION" '.sessions[] | select(.name==$s) | .running' 2>/dev/null || true)
      if [ "$RUNNING_STATE" = "true" ]; then
        ok "session '$RUN_SESSION' is running"
      else
        fail "session '$RUN_SESSION' not reported running (empty remote session list means the env parity check above failed first)"
      fi
    else
      RUNNING_COUNT=$(echo "$SESSION_JSON" | jq '[.sessions[] | select(.running==true)] | length' 2>/dev/null || echo 0)
      if [ "${RUNNING_COUNT:-0}" -ge 1 ]; then
        ok "$RUNNING_COUNT running session(s)"
      else
        fail "no running sessions found"
      fi
    fi
  else
    skip "jq not installed; session running state not checked"
  fi
fi

echo
if [ "$FAIL" -ne 0 ]; then
  echo "RESULT: FAIL (fix the FAIL lines above, then re-run)"
  exit 1
fi
echo "RESULT: all OK"
exit 0
