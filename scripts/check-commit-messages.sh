#!/usr/bin/env bash
# Strip or reject AI-tool attribution in commit messages (and optional PR bodies).
# Used by .husky/commit-msg (strip) and CI (reject).
set -euo pipefail

# Line-oriented. Human Co-authored-by trailers are left alone.
AI_ATTR_GREP='^[[:space:]]*(Co-authored-by:[[:space:]]*(Cursor|GitHub[[:space:]]+Copilot|Copilot|Claude|ChatGPT|Gemini|Codex|Devin|Windsurf|Cline)\b|Co-authored-by:.*<(cursoragent@cursor.com|copilot@github.com)>|Made with[[:space:]]*(\[Cursor\]|Cursor|Copilot)|Made with \[Cursor\]\([^)]*\)|🤖[[:space:]]*Generated)'

usage() {
  cat <<'EOF'
Usage:
  scripts/check-commit-messages.sh [--strip FILE]
  scripts/check-commit-messages.sh [--self-test]
  scripts/check-commit-messages.sh [GIT_RANGE]

Environment (CI):
  EVENT_NAME   pull_request | push | ...
  BASE_SHA     PR base or push before
  HEAD_SHA     PR head or push after
  PR_BODY      optional pull request body to scan
EOF
}

line_is_ai_attr() {
  printf '%s\n' "$1" | grep -Eiq -- "$AI_ATTR_GREP"
}

scan_text() {
  local label="$1"
  local text="$2"
  local found=0
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    if line_is_ai_attr "$line"; then
      printf '❌ %s: %s\n' "$label" "$line"
      found=1
    fi
  done <<< "$text"
  return "$found"
}

strip_file() {
  local file="$1"
  local tmp
  tmp="$(mktemp)"
  # Portable: rewrite without matching lines. Keep a trailing newline.
  if [[ ! -f "$file" ]]; then
    echo "commit-msg file not found: $file" >&2
    exit 1
  fi
  : > "$tmp"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if line_is_ai_attr "$line"; then
      continue
    fi
    printf '%s\n' "$line" >> "$tmp"
  done < "$file"
  mv "$tmp" "$file"
}

zeros_sha() {
  [[ "${1:-}" =~ ^0+$ ]]
}

resolve_range() {
  if [[ -n "${1:-}" ]]; then
    printf '%s\n' "$1"
    return
  fi

  local head="${HEAD_SHA:-HEAD}"
  local base="${BASE_SHA:-}"
  local event="${EVENT_NAME:-}"

  if [[ "$event" == "pull_request" && -n "$base" ]]; then
    printf '%s\n' "${base}..${head}"
    return
  fi

  if [[ "$event" == "push" && -n "$base" ]] && ! zeros_sha "$base"; then
    printf '%s\n' "${base}..${head}"
    return
  fi

  if git rev-parse --verify origin/develop >/dev/null 2>&1; then
    printf '%s\n' "origin/develop..${head}"
    return
  fi

  if git rev-parse --verify origin/master >/dev/null 2>&1; then
    printf '%s\n' "origin/master..${head}"
    return
  fi

  printf '%s\n' "$head"
}

scan_git_range() {
  local range="$1"
  local found=0
  local rec hash subject body

  if ! git rev-parse --verify "${range##*..}" >/dev/null 2>&1; then
    echo "Cannot resolve commit range: $range" >&2
    exit 1
  fi

  # One record per commit: hash, subject, body.
  while IFS= read -r -d '' rec; do
    hash="${rec%%$'\x1f'*}"
    rest="${rec#*$'\x1f'}"
    subject="${rest%%$'\x1f'*}"
    body="${rest#*$'\x1f'}"
    if scan_text "${hash:0:10} subject" "$subject"; then
      :
    else
      found=1
    fi
    if [[ -n "$body" ]]; then
      if scan_text "${hash:0:10} body" "$body"; then
        :
      else
        found=1
      fi
    fi
  done < <(git log --format='%H%x1f%s%x1f%b%x00' "$range")

  return "$found"
}

self_test() {
  local tmp fail=0
  tmp="$(mktemp)"

  expect_match() {
    if line_is_ai_attr "$1"; then
      return 0
    fi
    echo "expected match: $1" >&2
    fail=1
  }
  expect_clean() {
    if line_is_ai_attr "$1"; then
      echo "expected clean: $1" >&2
      fail=1
    fi
  }

  expect_match 'Co-authored-by: Cursor <cursoragent@cursor.com>'
  expect_match 'Co-authored-by: Copilot <copilot@github.com>'
  expect_match 'Co-authored-by: GitHub Copilot <copilot@github.com>'
  expect_match 'Co-authored-by: Claude <claude@anthropic.com>'
  expect_match 'Made with Cursor'
  expect_match 'Made with [Cursor](https://cursor.com)'
  expect_match '🤖 Generated with Claude'
  expect_clean 'Co-authored-by: Jane Doe <jane@example.com>'
  expect_clean 'prepare-commit-msg runs too early, so Co-authored-by: Cursor was still landing on commits.'
  expect_clean 'feat: add export'

  printf '%s\n' 'feat: demo' 'Co-authored-by: Cursor <cursoragent@cursor.com>' 'Co-authored-by: Jane Doe <jane@example.com>' > "$tmp"
  strip_file "$tmp"
  if grep -q 'Cursor' "$tmp"; then
    echo "strip left Cursor trailer" >&2
    fail=1
  fi
  if ! grep -q 'Jane Doe' "$tmp"; then
    echo "strip removed human trailer" >&2
    fail=1
  fi
  rm -f "$tmp"

  if (( fail )); then
    echo "self-test failed"
    exit 1
  fi
  echo "self-test passed"
}

main() {
  case "${1:-}" in
    -h|--help)
      usage
      ;;
    --self-test)
      self_test
      ;;
    --strip)
      if [[ -z "${2:-}" ]]; then
        usage >&2
        exit 2
      fi
      strip_file "$2"
      ;;
    *)
      local range found=0
      range="$(resolve_range "${1:-}")"
      echo "Scanning commit messages in $range"
      if scan_git_range "$range"; then
        :
      else
        found=1
      fi
      if [[ -n "${PR_BODY:-}" ]]; then
        if scan_text "PR body" "$PR_BODY"; then
          :
        else
          found=1
        fi
      fi
      if (( found )); then
        echo
        echo "Remove AI-tool attribution (Cursor, Copilot, Claude, and similar) from the lines above."
        echo "Human Co-authored-by trailers are allowed."
        exit 1
      fi
      echo "Commit message check passed."
      ;;
  esac
}

main "$@"
