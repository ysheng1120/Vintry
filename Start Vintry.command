#!/bin/bash
# Double-click this file on a Mac to start Vintry.
# The first time, macOS may ask for permission: right-click the file, choose Open, then Open.
cd "$(dirname "$0")" || exit 1

pause_and_exit() {
  echo ""
  read -r -p "  Press Enter to close this window." _
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Vintry needs Node.js, a free program, to run on this Mac."
  echo "  Opening the Node.js download page. Install the LTS version, then double-click Start Vintry again."
  open "https://nodejs.org/en/download"
  pause_and_exit
fi

NODE_MAJOR="$(node -p 'parseInt(process.versions.node)')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo ""
  echo "  Vintry needs Node.js version 20 or newer (this Mac has $(node -v))."
  echo "  Opening the Node.js download page. Install the LTS version, then try again."
  open "https://nodejs.org/en/download"
  pause_and_exit
fi

node scripts/launch.mjs || pause_and_exit
