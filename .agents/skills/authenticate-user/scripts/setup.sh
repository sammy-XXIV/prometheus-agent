#!/usr/bin/env bash
# Kite Passport CLI Bootstrap Script
#
# Ensures the kpass CLI is installed and available on PATH.
# Tries multiple installation methods in order of preference.
#
# Usage: bash scripts/setup.sh [--help]
#
# Output: JSON to stdout.
#   {"status":"ok","cli_version":"kpass v1.2.3","installed_via":"existing"}
#   {"status":"ok","cli_version":"kpass v1.2.3","installed_via":"npm"}
#   {"status":"ok","cli_version":"kpass v1.2.3","installed_via":"go"}
#   {"status":"error","error":"..."}
#
# Exit codes:
#   0  kpass is available on PATH.
#   1  Could not install kpass.
set -euo pipefail

CLI_VERSION="1.2.3"

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Kite Passport CLI Bootstrap"
  echo ""
  echo "Ensures kpass is installed and available on PATH."
  echo "If not found, attempts to install it automatically."
  echo ""
  echo "Usage: bash scripts/setup.sh"
  echo ""
  echo "Installation order:"
  echo "  1. Check if kpass is already on PATH"
  echo "  2. Try: npm install -g kpass@${CLI_VERSION}"
  echo "  3. Try: go install github.com/gokite-ai/passport-cli/cmd/kpass@v${CLI_VERSION}"
  echo "  4. Fail with installation instructions"
  echo ""
  echo "Output: JSON to stdout"
  echo "  {\"status\":\"ok\",\"cli_version\":\"...\",\"installed_via\":\"...\"}"
  echo "  {\"status\":\"error\",\"error\":\"...\"}"
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 1: Already installed?
# ---------------------------------------------------------------------------
if command -v kpass &>/dev/null; then
  VERSION_OUTPUT=$(kpass --version 2>/dev/null || echo "unknown")
  echo "{\"status\":\"ok\",\"cli_version\":\"${VERSION_OUTPUT}\",\"installed_via\":\"existing\"}"
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 2: Try npm install -g
# ---------------------------------------------------------------------------
if command -v npm &>/dev/null; then
  echo "kpass not found. Installing via npm..." >&2
  if npm install -g "kpass@${CLI_VERSION}" >&2 2>&1; then
    # Verify it's now on PATH
    if command -v kpass &>/dev/null; then
      VERSION_OUTPUT=$(kpass --version 2>/dev/null || echo "unknown")
      echo "{\"status\":\"ok\",\"cli_version\":\"${VERSION_OUTPUT}\",\"installed_via\":\"npm\"}"
      exit 0
    fi
  fi
  echo "npm install failed or binary not on PATH after install." >&2
fi

# ---------------------------------------------------------------------------
# Step 3: Try go install
# ---------------------------------------------------------------------------
if command -v go &>/dev/null; then
  echo "Trying go install..." >&2
  if go install "github.com/gokite-ai/passport-cli/cmd/kpass@v${CLI_VERSION}" >&2 2>&1; then
    # go install puts binary in GOPATH/bin — check if it's on PATH
    GOBIN_PATH="$(go env GOPATH)/bin/kpass"
    if command -v kpass &>/dev/null; then
      VERSION_OUTPUT=$(kpass --version 2>/dev/null || echo "unknown")
      echo "{\"status\":\"ok\",\"cli_version\":\"${VERSION_OUTPUT}\",\"installed_via\":\"go\"}"
      exit 0
    elif [[ -x "$GOBIN_PATH" ]]; then
      VERSION_OUTPUT=$("$GOBIN_PATH" --version 2>/dev/null || echo "unknown")
      echo "{\"status\":\"ok\",\"cli_version\":\"${VERSION_OUTPUT}\",\"installed_via\":\"go\",\"note\":\"Binary installed at ${GOBIN_PATH} but not on PATH. Add $(go env GOPATH)/bin to your PATH.\"}"
      exit 0
    fi
  fi
  echo "go install failed." >&2
fi

# ---------------------------------------------------------------------------
# Step 4: Nothing worked
# ---------------------------------------------------------------------------
cat <<EOF
{"status":"error","error":"Could not install kpass. Install manually using one of these methods:\n\n  Option 1 (npm):  npm install -g kpass@${CLI_VERSION}\n  Option 2 (Go):   go install github.com/gokite-ai/passport-cli/cmd/kpass@v${CLI_VERSION}\n  Option 3 (source): git clone https://github.com/gokite-ai/passport-cli && cd passport-cli && make install\n\nThen ensure the binary is on your PATH."}
EOF
exit 1
