#!/usr/bin/env bash
# Strip AI-tool attribution from commit messages (and optional PR bodies).
# Used by .husky/commit-msg (local strip) and CI (rewrite + push).
set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

# Line-oriented. Human Co-authored-by trailers are left alone.
AI_ATTR_GREP='^[[:space:]]*(Co-authored-by:[[:space:]]*(Cursor|GitHub[[:space:]]+Copilot|Copilot|Claude|ChatGPT|Gemini|Codex|Devin|Windsurf|Cline)\b|Co-authored-by:.*<(cursoragent@cursor.com|copilot@github.com)>|Made with[[:space:]]*(\[Cursor\]|Cursor|Copilot)|Made with \[Cursor\]\([^)]*\)|🤖[[:space:]]*Generated)'

usage() {
  cat <<'EOF'
Usage:
  scripts/check-commit-messages.sh [--strip FILE]
  scripts/check-commit-messages.sh [--strip-stdin]
  scripts/check-commit-messages.sh [--self-test]
  scripts/check-commit-messages.sh [--ci]
  scripts/check-commit-messages.sh [GIT_RANGE]

Environment (CI):
  EVENT_NAME    pull_request | push | ...
  BASE_SHA      PR base or push before
  HEAD_SHA      PR head or push after
  BRANCH_NAME   feature/hotfix branch to rewrite
  SAME_REPO     true when CI can push the head branch
  PR_BODY       optional pull request body to strip
  PR_NUMBER     pull request number for body edits
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

strip_stream() {
  local out="" had=0 line
  while IFS= read -r line || [[ -n "$line" ]]; do
    if line_is_ai_attr "$line"; then
      continue
    fi
    out+="$line"$'\n'
    had=1
  done
  if (( !had )); then
    printf '%s\n' 'chore: update'
    return
  fi
  printf '%s' "$out"
}

strip_file() {
  local file="$1"
  local tmp
  tmp="$(mktemp)"
  if [[ ! -f "$file" ]]; then
    echo "commit-msg file not found: $file" >&2
    exit 1
  fi
  strip_stream < "$file" > "$tmp"
  mv "$tmp" "$file"
}

protected_branch() {
  local name="${1:-}"
  [[ "$name" == "master" || "$name" == "develop" || "$name" == release/* ]]
}

rewrite_range() {
  local range="$1"
  FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --msg-filter \
    "bash \"${SCRIPT_PATH}\" --strip-stdin" \
    -- "$range"
  git update-ref -d refs/original/refs/heads/"${BRANCH_NAME:-}" 2>/dev/null || true
  git for-each-ref --format='%(refname)' refs/original | while read -r ref; do
    git update-ref -d "$ref" || true
  done
}

strip_pr_body_if_needed() {
  local body="${PR_BODY:-}"
  local stripped
  if [[ -z "$body" || -z "${PR_NUMBER:-}" ]]; then
    return 0
  fi
  if scan_text "PR body" "$body"; then
    return 0
  fi
  stripped="$(printf '%s\n' "$body" | strip_stream)"
  if [[ -z "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]]; then
    echo "PR body has AI attribution; cannot edit without a GitHub token."
    return 0
  fi
  if gh pr edit "$PR_NUMBER" --body "$stripped"; then
    echo "Stripped AI attribution from PR #${PR_NUMBER} body."
  else
    echo "Could not edit PR #${PR_NUMBER} body; squash merge still uses the PR title only."
  fi
}

run_ci() {
  local range found=0
  range="$(resolve_range)"
  echo "Scanning commit messages in $range"
  if scan_git_range "$range"; then
    :
  else
    found=1
  fi

  if (( found )); then
    if [[ "${SAME_REPO:-}" != "true" ]]; then
      echo
      echo "This is a fork PR, so CI cannot rewrite the branch."
      echo "Strip the AI-tool lines locally (the commit-msg hook does this) and push."
      exit 1
    fi
    if protected_branch "${BRANCH_NAME:-}"; then
      echo
      echo "Refusing to rewrite protected branch '${BRANCH_NAME}'."
      echo "Open a feature branch so CI can strip the messages there."
      exit 1
    fi
    if [[ -z "${BRANCH_NAME:-}" ]]; then
      echo "BRANCH_NAME is required to rewrite commit messages." >&2
      exit 1
    fi
    echo "Stripping AI attribution from commit messages in $range"
    rewrite_range "$range"
    git push --force-with-lease="refs/heads/${BRANCH_NAME}:${HEAD_SHA:-}" \
      origin "HEAD:refs/heads/${BRANCH_NAME}"
    echo "Pushed stripped commit messages to ${BRANCH_NAME}."
  else
    echo "Commit messages are clean."
  fi

  strip_pr_body_if_needed
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
  stdin_out="$(printf '%s\n' 'feat: stdin' 'Co-authored-by: Copilot <copilot@github.com>' | strip_stream)"
  if printf '%s\n' "$stdin_out" | grep -q 'Copilot'; then
    echo "strip-stdin left Copilot trailer" >&2
    fail=1
  fi
  if ! printf '%s\n' "$stdin_out" | grep -q 'feat: stdin'; then
    echo "strip-stdin dropped subject" >&2
    fail=1
  fi
  rm -f "$tmp"

  local repo
  repo="$(mktemp -d)"
  git -C "$repo" init -q
  git -C "$repo" config user.name test
  git -C "$repo" config user.email test@example.com
  printf 'a\n' > "$repo/f"
  git -C "$repo" add f
  git -C "$repo" commit -q -m 'base'
  local base
  base="$(git -C "$repo" rev-parse HEAD)"
  printf 'b\n' > "$repo/f"
  git -C "$repo" add f
  git -C "$repo" commit -q -m "$(printf '%s\n' 'feat: dirty' 'Co-authored-by: Cursor <cursoragent@cursor.com>')"
  (
    cd "$repo"
    BRANCH_NAME=master rewrite_range "${base}..HEAD"
  )
  if git -C "$repo" log -1 --format=%B | grep -q 'Cursor'; then
    echo "rewrite_range left Cursor trailer" >&2
    fail=1
  fi
  if ! git -C "$repo" log -1 --format=%s | grep -q 'feat: dirty'; then
    echo "rewrite_range dropped subject" >&2
    fail=1
  fi
  rm -rf "$repo"

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
    --strip-stdin)
      strip_stream
      ;;
    --ci)
      run_ci
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
