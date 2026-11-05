#!/usr/bin/env bash
# Vercel Ignored Build Step: 0 = skip deployment, 1 = build normally.
# Fail safe: ANY uncertainty must build. Production only; previews always build.
if [ "${VERCEL_ENV:-}" != "production" ]; then
  echo "Preview: build normally."
  exit 1
fi

# Git shallow history or missing parent: build normally.
if ! git rev-parse --verify 'HEAD^' >/dev/null 2>&1; then
  echo "No parent commit available: build normally."
  exit 1
fi

# --no-renames prevents a rename hiding a source-file removal.
changed="$(git diff --no-renames --name-only HEAD^ HEAD --)" || {
  echo "Git diff unavailable: build normally."
  exit 1
}
if [ -z "$changed" ]; then
  echo "No changed files identified: build normally."
  exit 1
fi

# Explicit allowlist: ONLY files belonging to AUTOMATION-01.
# Every other file, including source, dependencies, vercel.json and secrets config, builds.
while IFS= read -r file; do
  case "$file" in
    .github/workflows/handoff-states.yml|\
    config/automation-authorized-accounts.json|\
    docs/ESTADOS_COORDINACION.md|\
    lib/automation/handoff-states.mjs|\
    scripts/automation/apply-handoff-states.mjs|\
    scripts/automation/ignore-vercel-build.sh|\
    tests/handoff-states.test.mjs)
      ;;
    *)
      echo "Build required due to changed file: $file"
      exit 1
      ;;
  esac
done <<< "$changed"

echo "Only AUTOMATION-01 files changed: skip this Production deployment."
exit 0
