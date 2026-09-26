import sys
from pathlib import Path

# Tests import the service modules (main, lines, phash) from apps/analyze.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
