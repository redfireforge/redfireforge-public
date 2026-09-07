# Contributing to RedfireForge

Thank you for your interest in contributing! Here's everything you need to get started.

---

## 0. CLA Requirement

Before your first Pull Request can be merged, you must sign the
[Contributor License Agreement](.github/CLA.md). The **CLA Assistant bot**
will automatically comment on your PR with a one-click signing link — it
takes under a minute and is required only once.

**Corporate contributors:** If you are contributing on behalf of your employer,
your company must sign a Corporate CLA before your employees open PRs. Please
email the maintainers at **contribute@redfireforge.com** to obtain the Corporate
CLA template before submitting your first PR.

---

## 1. Prerequisites

- **Node.js** >= 20
- **npm** >= 10
- **Rust** (desktop builds only — install via [rustup](https://rustup.rs/))
- **Git** >= 2.38

---

## 2. Repository Setup

```bash
git clone https://github.com/redfireforge/redfireforge-public.git
cd redfireforge-public
npm install
npm run dev        # web dev server at http://localhost:5173
npm run tauri:dev  # native desktop with hot-reload (requires Rust)
```

---

## 3. Development Workflow

### TypeScript check (mandatory after every change)

```bash
npx tsc -b --noEmit
```

This is **not** optional. The `-b` flag is required because the root
`tsconfig.json` uses project references. Vitest does not type-check source
files — only `tsc` catches missing properties, bad imports, and type
mismatches.

### Unit tests (touched files only during development)

```bash
npx vitest run src/path/to/changed.test.ts
```

Run the full suite only before merging:

```bash
npm run test:product   # product code
npm run test:demo      # demo hub lessons
```

### Lint

```bash
npm run lint           # ESLint — must report 0 errors and 0 warnings
```

### E2E tests

```bash
npm run dev            # start dev server on :5173 first
npx playwright test --reporter=list
```

E2E tests are **only required before merging** to `develop`, `release/*`, or
`master`. Do not run them on every feature iteration.

---

## 4. Branch & PR Rules

| Branch | Purpose |
|--------|---------|
| `develop` | Main integration branch — all PRs target this |
| `feature/<name>` | New features or improvements |
| `fix/<name>` | Bug fixes |
| `hotfix/<name>` | Urgent fixes against a `release/*` branch |
| `release/<version>` | Release preparation |

- **Always branch from `develop`.** Do not open PRs directly to `master`.
- **Never commit directly to `develop`, `release/*`, or `master`** — all
  changes go through a `feature/*` or `hotfix/*` branch first.
- **One concern per PR** — keep changes focused and reviewable.

### Commit message format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add WebSocket message history export
fix: correct timeout handling in gRPC stream
docs: update Kafka Studio setup guide
refactor: extract bottleneck analysis into separate module
test: add coverage for validationDsl parser
chore: bump vitest to 2.1.0
```

Do **not** add AI-tool attribution to commit messages or PR bodies
(`Co-authored-by: Cursor`, `Co-authored-by: Copilot`, `Made with Cursor`,
and similar). Human `Co-authored-by` trailers are fine. The `commit-msg`
hook strips known AI lines; CI job **Commit message** rejects any that
remain.

---

## 5. Code Standards

- **TypeScript strict mode** — `npx tsc -b --noEmit` must pass with zero errors.
  No `any` in production code — prefer explicit types or `unknown`.
- **ESLint** — `npm run lint` must pass with zero errors and zero warnings.
- **Test coverage ≥ 90%** on all four metrics (statements, branches, functions,
  lines) for every new or modified file.
- **No monolithic files** — source files must stay under 900 lines. The lint
  rule `lint:max-lines` enforces this.
- **No raw `alert()` or `confirm()`** — use the existing `ConfirmModal`
  component or equivalent.
- **No direct `localStorage` access** — always go through `src/utils/storage.ts`.
- **No hardcoded colors** — always use CSS design token variables (`--bg`,
  `--surface`, `--border`, `--text`, `--primary`).

---

## 6. Building the Tauri Desktop App

```bash
# Development
npm run tauri:dev

# Production build (creates .app and .dmg on macOS)
npm run tauri:build:prod

# Learning Hub variant
npm run tauri:build:demo
```

Requires the Rust toolchain. Run `rustup update` to stay current.

---

## 7. Reporting Issues

- **Bugs** — use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template.
- **Feature requests** — use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template.
- **Security vulnerabilities** — see [SECURITY.md](SECURITY.md). **Do not open a public issue for security bugs.**

---

## 8. Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
By participating you agree to uphold its standards. Please report unacceptable
behaviour to **conduct@redfireforge.com**.

---

## 9. License

By contributing, you agree that your contributions will be licensed under the
[GNU Affero General Public License v3](LICENSE) and the terms of the
[Contributor License Agreement](.github/CLA.md).
