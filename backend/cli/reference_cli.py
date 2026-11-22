#!/usr/bin/env python3
"""CLI wrapper: serve reference data (faculty, slots, buildings).

Usage:
  echo '{"command":"faculty","query":"Sharma"}' | python -m backend.cli.reference_cli
  echo '{"command":"slots"}' | python -m backend.cli.reference_cli
  echo '{"command":"buildings"}' | python -m backend.cli.reference_cli
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from backend.data_loader import DataStore

def main() -> None:
    DataStore.load()
    raw = sys.stdin.read().strip()
    try:
        inp = json.loads(raw)
    except Exception:
        inp = {}

    command = inp.get("command", "slots")

    if command == "faculty":
        query = inp.get("query", "").lower()
        results = [
            f.model_dump() for f in DataStore.faculty_list
            if not query or query in f.facultyName.lower() or query in f.department.lower()
        ]
        print(json.dumps({"faculty": results}))

    elif command == "slots":
        results = [s.model_dump() for s in DataStore.slots]
        print(json.dumps({"slots": results}))

    elif command == "buildings":
        results = [b.model_dump() for b in DataStore.buildings]
        print(json.dumps({"buildings": results}))

    else:
        print(json.dumps({"error": f"Unknown command: {command}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
