#!/usr/bin/env bash
# Idempotent sshd bootstrap for herdr remote attach (`herdr --remote`).
#
# Writes a key-only sshd config that injects the herdr server's config
# context into every SSH session via SetEnv, generates a host key on first
# run, and starts or HUP-reloads sshd only when the config changed. SSH
# sessions must resolve the same herdr config root and session the running
# server was started with; shell rc files are not sourced for herdr's
# non-interactive SSH commands, so sshd SetEnv is the mechanism.
#
# Run as the user that owns the herdr server socket. Safe to call from a
# container boot script on every start (idempotent).
#
# Env overrides:
#   HERDR_SSHD_DIR              config dir (default: $HOME/.sshd)
#   HERDR_SSHD_PORT             sshd port (default: 2222)
#   HERDR_SSHD_LISTEN           listen address (default: 0.0.0.0)
#   HERDR_SSH_XDG_CONFIG_HOME   XDG_CONFIG_HOME the herdr server runs under
#                               (default: current $XDG_CONFIG_HOME if set)
#   HERDR_SSH_SESSION           HERDR_SESSION the herdr server runs under
#                               (default: current $HERDR_SESSION if set)
#   HERDR_SSHD_AUTHORIZED_KEYS  authorized_keys path (default: $DIR/authorized_keys)
set -uo pipefail

DIR="${HERDR_SSHD_DIR:-$HOME/.sshd}"
PORT="${HERDR_SSHD_PORT:-2222}"
LISTEN="${HERDR_SSHD_LISTEN:-0.0.0.0}"
XDG_VAL="${HERDR_SSH_XDG_CONFIG_HOME:-${XDG_CONFIG_HOME:-}}"
SESSION_VAL="${HERDR_SSH_SESSION:-${HERDR_SESSION:-}}"
AUTH_KEYS="${HERDR_SSHD_AUTHORIZED_KEYS:-$DIR/authorized_keys}"
SSHD_BIN="${HERDR_SSHD_BIN:-$(command -v sshd || echo /usr/sbin/sshd)}"

FAIL=0

if [ ! -x "$SSHD_BIN" ]; then
  echo "FAIL: no sshd binary at $SSHD_BIN (install openssh-server)"
  exit 1
fi

case "$PORT" in
  ''|*[!0-9]*) echo "FAIL: HERDR_SSHD_PORT must be numeric, got '$PORT'"; exit 1 ;;
esac

mkdir -p "$DIR" || { echo "FAIL: cannot create $DIR"; exit 1; }

HOST_KEY="$DIR/ssh_host_ed25519_key"
if [ ! -f "$HOST_KEY" ]; then
  ssh-keygen -q -t ed25519 -f "$HOST_KEY" -N "" || { echo "FAIL: host key generation"; exit 1; }
  echo "generated host key $HOST_KEY"
fi
chmod 600 "$HOST_KEY" 2>/dev/null || true

CONFIG="$DIR/sshd_config"
TMP="$CONFIG.tmp.$$"
{
  echo "Port $PORT"
  echo "ListenAddress $LISTEN"
  echo "HostKey $HOST_KEY"
  echo "AuthorizedKeysFile $AUTH_KEYS"
  echo "PasswordAuthentication no"
  echo "KbdInteractiveAuthentication no"
  echo "PermitRootLogin no"
  echo "PubkeyAuthentication yes"
  if [ -n "$XDG_VAL" ] || [ -n "$SESSION_VAL" ]; then
    # SSH logins (herdr --remote) must see the same XDG config and session
    # as the booted herdr server, or herdr finds no matching server socket.
    echo "SetEnv ${XDG_VAL:+XDG_CONFIG_HOME=$XDG_VAL }${SESSION_VAL:+HERDR_SESSION=$SESSION_VAL}"
  fi
  echo "UsePAM no"
  echo "PidFile $DIR/sshd.pid"
  echo "LogLevel VERBOSE"
} > "$TMP"

if ! "$SSHD_BIN" -t -f "$TMP" >/dev/null 2>&1; then
  echo "FAIL: generated sshd_config does not validate:"
  "$SSHD_BIN" -t -f "$TMP"
  rm -f "$TMP"
  exit 1
fi

CHANGED=0
if [ ! -f "$CONFIG" ] || ! cmp -s "$CONFIG" "$TMP"; then
  mv "$TMP" "$CONFIG"
  chmod 600 "$CONFIG"
  CHANGED=1
  echo "wrote $CONFIG"
else
  rm -f "$TMP"
fi

# Is an sshd already running from our pid file?
RUNNING=0
if [ -f "$DIR/sshd.pid" ]; then
  OLD_PID=$(cat "$DIR/sshd.pid" 2>/dev/null || true)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    RUNNING=1
    PID="$OLD_PID"
  fi
fi

if [ "$CHANGED" -eq 0 ] && [ "$RUNNING" -eq 1 ]; then
  echo "OK: sshd running (pid $PID), config unchanged, nothing to do"
elif [ "$RUNNING" -eq 1 ]; then
  kill -HUP "$PID" || { echo "FAIL: HUP reload of sshd pid $PID"; exit 1; }
  echo "OK: sshd reloaded (pid $PID); SetEnv applies to new connections"
else
  "$SSHD_BIN" -f "$CONFIG" || { echo "FAIL: sshd failed to start"; exit 1; }
  PID=$(cat "$DIR/sshd.pid" 2>/dev/null || echo unknown)
  echo "OK: sshd started (pid $PID) on port $PORT"
fi

if [ -n "$XDG_VAL" ] || [ -n "$SESSION_VAL" ]; then
  echo "SetEnv: ${XDG_VAL:+XDG_CONFIG_HOME=$XDG_VAL }${SESSION_VAL:+HERDR_SESSION=$SESSION_VAL}"
fi
if [ ! -s "$AUTH_KEYS" ]; then
  echo "WARN: $AUTH_KEYS is empty; add the client's public key or key-only auth will reject every connection"
fi
exit "$FAIL"
