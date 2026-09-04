#!/bin/bash
# Learning Hub Debian/RPM pre-remove: CLI symlinks + leftover Docker app data.
# Image removal (`docker compose down --rmi all`) is done in-app via
# Settings → Docker → Prepare to Uninstall. This script is the safety net
# when the user uninstalls without that step. Docker may not be running.
#
# Installer hooks run as root with HOME=/root — do not rely on $HOME alone.
# Prefer SUDO_USER / PKEXEC_UID so the real user's extract tree is wiped.

set -u

SYMLINK_PATH="/usr/local/bin/redfireforge"
RFF_SYMLINK_PATH="/usr/local/bin/rff"
for path in "$SYMLINK_PATH" "$RFF_SYMLINK_PATH"; do
  if [ -L "$path" ]; then
    TARGET=$(readlink "$path")
    if [[ "$TARGET" == *"redfireforge"* ]] || [[ "$TARGET" == *"RedfireForge"* ]]; then
      rm "$path" || true
    fi
  fi
done

APP_ID="${RFF_DOCKER_APP_ID:-com.redfireforge.desktop.demo}"

# Collect candidate docker dirs (deduped). Root uninstall must still hit
# the installing user's ~/.local/share/<app>/docker.
collect_docker_dirs() {
  local -a candidates=()
  local user home

  if [ -n "${XDG_DATA_HOME:-}" ]; then
    candidates+=("${XDG_DATA_HOME}/${APP_ID}/docker")
  fi
  if [ -n "${HOME:-}" ]; then
    candidates+=("${HOME}/.local/share/${APP_ID}/docker")
  fi

  user="${SUDO_USER:-}"
  if [ -z "$user" ] && [ -n "${PKEXEC_UID:-}" ]; then
    user=$(getent passwd "$PKEXEC_UID" 2>/dev/null | cut -d: -f1 || true)
  fi
  if [ -n "$user" ] && [ "$user" != "root" ]; then
    home=$(getent passwd "$user" 2>/dev/null | cut -d: -f6 || true)
    if [ -n "$home" ]; then
      candidates+=("${home}/.local/share/${APP_ID}/docker")
    fi
  fi

  # Root uninstall without SUDO_USER (GUI package managers / wsl -u root)
  # still needs the real user's extract tree. Only touch known APP_ID paths.
  if [ "$(id -u 2>/dev/null || echo 1)" = "0" ]; then
    for home in /home/*; do
      [ -d "$home" ] || continue
      candidates+=("${home}/.local/share/${APP_ID}/docker")
    done
  fi

  printf '%s\n' "${candidates[@]}" | awk 'NF && !seen[$0]++'
}

wipe_docker_dir() {
  local DOCKER_DIR="$1"
  [ -d "$DOCKER_DIR" ] || return 0

  if command -v docker >/dev/null 2>&1; then
    # Best-effort compose teardown. Every -f in one invocation — looping
    # files would tear sibling TLS/mTLS services down independently.
    find "$DOCKER_DIR" -type d -print 2>/dev/null | while read -r dir; do
      set --
      for f in "$dir"/docker-compose*.yml "$dir"/docker-compose*.yaml; do
        [ -f "$f" ] || continue
        set -- "$@" -f "$(basename "$f")"
      done
      [ "$#" -gt 0 ] || continue
      (cd "$dir" && docker compose --profile spring "$@" down --rmi all --remove-orphans) >/dev/null 2>&1 || true
      (cd "$dir" && docker compose "$@" down --rmi all --remove-orphans) >/dev/null 2>&1 || true
    done
  fi

  rm -rf "$DOCKER_DIR"
}

while IFS= read -r docker_dir; do
  wipe_docker_dir "$docker_dir"
done < <(collect_docker_dirs)

exit 0
