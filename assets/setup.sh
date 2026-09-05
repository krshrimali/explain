#!/bin/sh
# Reinstall the skill's toolchain. Only needed after a fresh clone or if a
# `npm install` here has re-inflated node_modules.
#
# The prune step is safe because difit ships a PREBUILT client bundle in
# dist/client/assets - React, mermaid, lucide, prism and friends are its
# build-time deps, not runtime ones. Pruning them takes the tree from ~255M to
# ~65M. mermaid is served to the page from vendor/mermaid.min.js instead.
#
# If difit ever fails with MODULE_NOT_FOUND, run `npm install` here to restore.
set -e
cd "$(cd "$(dirname "$0")" && pwd)"

npm install --no-audit --no-fund

# Keep a standalone mermaid for the explainer pages before pruning the package.
mkdir -p vendor
cp node_modules/mermaid/dist/mermaid.min.js vendor/mermaid.min.js

for pkg in mermaid lucide-react es-toolkit @mermaid-js cytoscape cytoscape-fcose \
           react-dom react katex prismjs prism-svelte prism-react-renderer; do
  rm -rf "node_modules/$pkg"
done

chmod +x explain explain.mjs
echo "explain skill ready: $(du -sh node_modules | cut -f1) node_modules"
