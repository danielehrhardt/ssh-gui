#!/usr/bin/env bash
# End-to-end check of the ssh-agent integration against a PRIVATE, throw-away ssh-agent and key
# directory. Your real agent and ~/.ssh are never touched: the script refuses to run unless the
# private agent is demonstrably the one in use, and it verifies your real agent is unchanged after.
set -u
BIN="${1:-$(dirname "$0")/../target/debug/sshkm}"
[ -x "$BIN" ] || { echo "build first: cargo build -p sshkm"; exit 2; }

REAL_SOCK="${SSH_AUTH_SOCK:-}"
before=$( [ -n "$REAL_SOCK" ] && SSH_AUTH_SOCK="$REAL_SOCK" ssh-add -l -E sha256 2>&1 )
# Unix socket paths are limited to ~104 bytes, so keep this short.
D=$(mktemp -d /tmp/sshkm.XXXXXX) || exit 2
trap '[ -n "${SSH_AGENT_PID:-}" ] && kill "$SSH_AGENT_PID" 2>/dev/null; rm -rf "$D"' EXIT
unset SSH_AGENT_PID
eval "$(ssh-agent -a "$D/a.sock")" >/dev/null 2>&1
if [ -z "${SSH_AGENT_PID:-}" ] || [ "${SSH_AUTH_SOCK:-}" != "$D/a.sock" ] || [ "$SSH_AUTH_SOCK" = "$REAL_SOCK" ]; then
  echo "ABORT: the private ssh-agent did not start; refusing to touch the real one."; exit 2
fi
export SSHKM_SSH_DIR="$D/ssh"

fail=0
check() { # check <description> <expected exit> <expected output substring> -- command…
  local what="$1" want="$2" needle="$3"; shift 4
  local out; out=$("$@" 2>&1 </dev/null); local got=$?
  if [ "$got" -eq "$want" ] && [[ "$out" == *"$needle"* ]]; then echo "ok    $what"
  else echo "FAIL  $what (exit $got, wanted $want) — $out"; fail=1; fi
}
with_pass() { local pass="$1"; shift; printf '%s\n' "$pass" | "$@" 2>&1; }

"$BIN" generate plain -N "" >/dev/null </dev/null
"$BIN" generate locked -N "s3cret" >/dev/null </dev/null

check "unprotected key loads"                0 "Loaded plain"        -- "$BIN" agent add plain
check "protected key needs a passphrase"     1 "passphrase is required" -- "$BIN" agent add locked
start=$(date +%s)
out=$(with_pass "wrong" "$BIN" agent add locked --passphrase-stdin); code=$?
took=$(( $(date +%s) - start ))
if [ $code -eq 1 ] && [[ "$out" == *"incorrect passphrase"* ]] && [ $took -lt 5 ]; then echo "ok    wrong passphrase fails fast (${took}s)"
else echo "FAIL  wrong passphrase: exit $code after ${took}s — $out"; fail=1; fi
out=$(with_pass "s3cret" "$BIN" agent add locked --passphrase-stdin); code=$?
if [ $code -eq 0 ]; then echo "ok    right passphrase loads"; else echo "FAIL  right passphrase: $out"; fail=1; fi
check "both keys show as loaded"             0 "locked"              -- "$BIN" agent list
check "disabling unloads the key"            0 "Disabled locked"     -- "$BIN" disable locked
out=$("$BIN" agent list </dev/null 2>&1)
if [[ "$out" != *"locked"* ]] && [[ "$out" == *"plain"* ]]; then echo "ok    agent now holds only 'plain'"; else echo "FAIL  after disable: $out"; fail=1; fi
check "disabled keys cannot be loaded"       1 "is disabled"         -- "$BIN" agent add locked
check "agent remove"                         0 "Removed plain"       -- "$BIN" agent remove plain
check "agent is empty"                       0 "holds no keys"       -- "$BIN" agent list
leftover=$(ls "${TMPDIR:-/tmp}"/sshkm-askpass-* 2>/dev/null | wc -l | tr -d ' ')
if [ "$leftover" = "0" ]; then echo "ok    no passphrase files left behind"; else echo "FAIL  $leftover askpass temp files remain"; fail=1; fi

after=$( [ -n "$REAL_SOCK" ] && SSH_AUTH_SOCK="$REAL_SOCK" ssh-add -l -E sha256 2>&1 )
if [ "$before" = "$after" ]; then echo "ok    your real ssh-agent is unchanged"; else echo "FAIL  REAL AGENT CHANGED"; echo "before: $before"; echo "after:  $after"; fail=1; fi
exit $fail
