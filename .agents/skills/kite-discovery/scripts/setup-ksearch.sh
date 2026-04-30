#!/usr/bin/env bash
# Kite Discovery CLI (ksearch) Bootstrap Script
#
# Ensures the ksearch CLI is installed and available on PATH.
# Tries multiple installation methods in order of preference.
#
# Usage: bash scripts/setup-ksearch.sh [--help]
#
# Output: JSON to stdout.
#   {"status":"ok","cli_version":"ksearch v0.3.0","installed_via":"existing"}
#   {"status":"ok","cli_version":"ksearch v0.3.0","installed_via":"go"}
#   {"status":"error","error":"..."}
#
# Exit codes:
#   0  ksearch is available on PATH.
#   1  Could not install ksearch.
set -euo pipefail

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Kite Discovery CLI (ksearch) Bootstrap"
  echo ""
  echo "Ensures ksearch is installed and available on PATH."
  echo "If not found, attempts to install it automatically via go install."
  echo ""
  echo "Usage: bash scripts/setup-ksearch.sh"
  echo ""
  echo "Installation order:"
  echo "  1. Check if ksearch is already on PATH"
  echo "  2. Try: go install github.com/datalego/service-discovery/cli/cmd/kite-discovery@latest"
  echo "  3. Fail with installation instructions"
  echo ""
  echo "Output: JSON to stdout"
  echo "  {\"status\":\"ok\",\"cli_version\":\"...\",\"installed_via\":\"...\"}"
  echo "  {\"status\":\"error\",\"error\":\"...\"}"
  exit 0
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
# Sanitize a string for safe JSON interpolation (strip newlines, escape quotes)
sanitize_for_json() {
  printf '%s' "$1" | tr -d '\n' | tr '"\\' '__'
}

# ---------------------------------------------------------------------------
# Step 1: Already installed?
# ---------------------------------------------------------------------------
if command -v ksearch &>/dev/null; then
  RAW_VERSION=$(ksearch --version 2>/dev/null || echo "unknown")
  VERSION_OUTPUT=$(sanitize_for_json "$RAW_VERSION")
  echo "{\"status\":\"ok\",\"cli_version\":\"${VERSION_OUTPUT}\",\"installed_via\":\"existing\"}"
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 2: Try go install
# ---------------------------------------------------------------------------
if command -v go &>/dev/null; then
  echo "ksearch not found. Installing via go install..." >&2
  if go install "github.com/datalego/service-discovery/cli/cmd/kite-discovery@latest" >&2 2>&1; then
    # go install puts binary in GOPATH/bin — check if it's on PATH
    GOBIN_PATH="$(go env GOPATH)/bin/ksearch"
    if command -v ksearch &>/dev/null; then
      RAW_VERSION=$(ksearch --version 2>/dev/null || echo "unknown")
      VERSION_OUTPUT=$(sanitize_for_json "$RAW_VERSION")
      echo "{\"status\":\"ok\",\"cli_version\":\"${VERSION_OUTPUT}\",\"installed_via\":\"go\"}"
      exit 0
    elif [[ -x "$GOBIN_PATH" ]]; then
      RAW_VERSION=$("$GOBIN_PATH" --version 2>/dev/null || echo "unknown")
      VERSION_OUTPUT=$(sanitize_for_json "$RAW_VERSION")
      echo "{\"status\":\"ok\",\"cli_version\":\"${VERSION_OUTPUT}\",\"installed_via\":\"go\",\"note\":\"Binary installed at ${GOBIN_PATH} but not on PATH. Add $(go env GOPATH)/bin to your PATH.\"}"
      exit 0
    fi
  fi
  echo "go install failed." >&2
fi

# ---------------------------------------------------------------------------
# Step 3: Nothing worked
# ---------------------------------------------------------------------------
cat <<'EOF'
{"status":"error","error":"Could not find or install ksearch. Install manually:\n\n  Option 1 (Go):    go install github.com/datalego/service-discovery/cli/cmd/kite-discovery@latest\n  Option 2 (source): git clone https://github.com/gokite-ai/service-discovery-cli.git && cd service-discovery-cli && make install\n\nThen ensure the binary is on your PATH ($(go env GOPATH)/bin or /usr/local/bin)."}
EOF
exit 1
