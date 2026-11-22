#!/usr/bin/env python3
"""CLI wrapper: read JSON from stdin, run optimizer, write result to stdout.

Usage (from workspace root):
  echo '<OptimizeInput JSON>' | python -m backend.cli.optimize_cli
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from backend.data_loader import DataStore
from backend.optimizer import optimize
from backend.models import OptimizeInput

def main() -> None:
    DataStore.load()
    raw = sys.stdin.read().strip()
    try:
        data = json.loads(raw)
        inp = OptimizeInput.model_validate(data)
        result = optimize(inp)
        print(json.dumps(result.model_dump()))
    except Exception as e:
        err = {"error": str(e), "timetables": [], "durationMs": 0, "feasibleCount": 0}
        print(json.dumps(err))
        sys.exit(1)

if __name__ == "__main__":
    main()
