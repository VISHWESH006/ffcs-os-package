#!/usr/bin/env python3
"""CLI wrapper: read JSON from stdin, parse VTOP data, write result to stdout.

Usage (from workspace root):
  echo '<json>' | python -m backend.cli.parse_cli
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from backend.data_loader import DataStore
from backend.parser import parse_vtop_data

def main() -> None:
    DataStore.load()
    raw = sys.stdin.read().strip()
    try:
        inp = json.loads(raw)
        # If it's already an array, pass it through; if it's an object with rawData, unwrap it
        if isinstance(inp, dict):
            raw_data = inp.get("rawData", raw)
        else:
            raw_data = raw  # already a JSON array string — pass as-is
    except json.JSONDecodeError:
        raw_data = raw

    result = parse_vtop_data(raw_data)
    print(json.dumps(result.model_dump()))

if __name__ == "__main__":
    main()
