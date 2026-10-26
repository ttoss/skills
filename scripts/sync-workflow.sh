#!/bin/sh
# Copies the ttoss Engineering Workflow pages the flow skill carries verbatim.
# An edit to them belongs in ttoss/ttoss, never here.
set -e
base="https://raw.githubusercontent.com/ttoss/ttoss/${1:-main}/docs/website/docs/engineering/workflow"
for page in process parameters; do
  curl -fsSL "$base/$page.md" -o "skills/flow/references/$page.md"
done
