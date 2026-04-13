#!/bin/bash
# model-router.sh
# Reads the incoming prompt and sets the model accordingly.
# Fires on UserPromptSubmit — before Claude processes the message.

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""' | tr '[:upper:]' '[:lower:]')

# --- OPUS triggers (complex reasoning required) ---
if echo "$PROMPT" | grep -qE \
  "crawler|scrape|crawl|parser|schema|scoring|algorithm|architecture|\
  data model|type contract|redis|cache|upstash|assessment engine|\
  matching logic|tender type|normali|weighted|edge case|rate limit|\
  complex|redesign|refactor entire|migration|audit report|rebuild"; then
  echo '{"model": "opus"}'
  exit 0
fi

# --- HAIKU triggers (simple, fast, cheap) ---
if echo "$PROMPT" | grep -qE \
  "rename|typo|comment|format|indent|whitespace|console.log|\
  variable name|capitaliz|fix spelling|update copy|change text|\
  move file|delete file|add import|remove import"; then
  echo '{"model": "haiku"}'
  exit 0
fi

# --- Default: Sonnet for everything else ---
echo '{"model": "sonnet"}'
exit 0
