"""Download and verify the IBM Telco Customer Churn dataset.

Run from the project root:
    python -m ml.download_data
"""
from __future__ import annotations

import hashlib
import sys
import urllib.request
from pathlib import Path

URL = "https://raw.githubusercontent.com/IBM/telco-customer-churn-on-icp4d/master/data/Telco-Customer-Churn.csv"
SHA256 = "16320c9c1ec72448db59aa0a26a0b95401046bef5d02fd3aeb906448e3055e91"
DEST = Path(__file__).resolve().parents[1] / "data" / "raw" / "Telco-Customer-Churn.csv"


def main() -> int:
    DEST.parent.mkdir(parents=True, exist_ok=True)
    if DEST.exists() and hashlib.sha256(DEST.read_bytes()).hexdigest() == SHA256:
        print(f"Dataset already present and verified: {DEST}")
        return 0
    print(f"Downloading {URL}")
    try:
        with urllib.request.urlopen(URL, timeout=60) as resp:
            data = resp.read()
    except Exception as exc:  # network blocked, proxy, etc.
        print(f"Download failed: {exc}\nDownload the file manually from the URL above and save it to {DEST}", file=sys.stderr)
        return 1
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        print(f"Checksum mismatch (got {digest}). The upstream file may have changed; inspect it before training.", file=sys.stderr)
        return 1
    DEST.write_bytes(data)
    print(f"Saved and verified {DEST} ({len(data):,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
