#!/usr/bin/env bash
set -euo pipefail

PROJECT="${1:-TaskForge Enhancements}"
STATUS_FILTER="${2:-}"

# Build status clause
if [[ -n "$STATUS_FILTER" ]]; then
  STATUS_CLAUSE="AND i.status = '$STATUS_FILTER'"
else
  STATUS_CLAUSE="AND i.status != 'DONE'"
fi

SQL="
SELECT
  i.id,
  i.title,
  i.status,
  i.priority,
  i.description
FROM \"Issue\" i
JOIN \"Project\" p ON i.\"projectId\" = p.id
WHERE p.name = '$PROJECT'
  $STATUS_CLAUSE
ORDER BY
  CASE i.priority
    WHEN 'CRITICAL' THEN 1
    WHEN 'HIGH'     THEN 2
    WHEN 'MEDIUM'   THEN 3
    WHEN 'LOW'      THEN 4
    ELSE 5
  END,
  i.\"createdAt\" ASC;
"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TaskForge Issues — $PROJECT"
[[ -n "$STATUS_FILTER" ]] && echo "  Status filter: $STATUS_FILTER" || echo "  Status filter: open (excluding DONE)"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Run query and capture output
RAW=$(echo "$SQL" | railway connect postgres 2>&1)

# Check for query errors
if echo "$RAW" | grep -q "^ERROR:"; then
  echo ""
  echo "  Database error:"
  echo "$RAW" | grep "^ERROR:"
  exit 1
fi

# Parse rows (skip header lines and trailing count line)
ROWS=$(echo "$RAW" | tail -n +3 | grep -v "^([0-9]* row" | grep -v "^$")

if [[ -z "$ROWS" ]]; then
  echo ""
  echo "  No issues found."
  echo ""
  exit 0
fi

COUNT=0
while IFS= read -r row; do
  # Split on " | " delimiter
  IFS='|' read -ra FIELDS <<< "$row"
  [[ ${#FIELDS[@]} -lt 4 ]] && continue

  trim() { echo "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }
  ID=$(trim "${FIELDS[0]}")
  TITLE=$(trim "${FIELDS[1]}")
  STATUS=$(trim "${FIELDS[2]}")
  PRIORITY=$(trim "${FIELDS[3]}")
  DESC=$(trim "${FIELDS[4]:-}")

  # Skip separator lines (all dashes/spaces)
  [[ "$ID" =~ ^[-]+$ ]] && continue
  [[ "$ID" == "id" ]] && continue

  COUNT=$((COUNT + 1))

  # Status and priority badges
  case "$STATUS" in
    TODO)        STATUS_LABEL="[ TODO ]"       ;;
    IN_PROGRESS) STATUS_LABEL="[  WIP  ]"      ;;
    *)           STATUS_LABEL="[$STATUS]"      ;;
  esac

  case "$PRIORITY" in
    CRITICAL) PRIORITY_LABEL="!! CRITICAL" ;;
    HIGH)     PRIORITY_LABEL="!  HIGH"     ;;
    MEDIUM)   PRIORITY_LABEL="   MEDIUM"   ;;
    LOW)      PRIORITY_LABEL="   LOW"      ;;
    *)        PRIORITY_LABEL="   -"        ;;
  esac

  echo ""
  printf "  %s  %-10s  %s\n" "$STATUS_LABEL" "$PRIORITY_LABEL" "$TITLE"
  printf "  ID: %s\n" "$ID"

  if [[ -n "$DESC" && "$DESC" != "\\N" ]]; then
    # Wrap description at ~68 chars
    echo "  Desc: $(echo "$DESC" | fold -s -w 68 | sed '2,$s/^/        /')"
  fi

  echo "  ──────────────────────────────────────────────────────────────────"
done <<< "$ROWS"

echo ""
echo "  Total: $COUNT issue(s)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Usage:"
echo "    ./taskforge-issues.sh                        # open issues (default project)"
echo "    ./taskforge-issues.sh \"My Project\"           # different project"
echo "    ./taskforge-issues.sh \"My Project\" IN_PROGRESS  # filter by status"
echo ""
