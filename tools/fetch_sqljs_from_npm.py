#!/usr/bin/env python3
"""Replace vendor/sql-wasm.js and vendor/sql-wasm.wasm with the official sql.js release from npm.

Usage:  python3 tools/fetch_sqljs_from_npm.py [version]      (default 1.14.2)
The tarball is checked against the integrity hash that the npm registry publishes for it.
"""
import base64, hashlib, io, json, sys, tarfile, urllib.request
from pathlib import Path

version = sys.argv[1] if len(sys.argv) > 1 else "1.14.2"
root = Path(__file__).resolve().parent.parent
meta = json.load(urllib.request.urlopen(f"https://registry.npmjs.org/sql.js/{version}"))
want = meta["dist"]["integrity"]            # "sha512-<base64>"
data = urllib.request.urlopen(meta["dist"]["tarball"]).read()
got = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
if got != want:
    sys.exit(f"Integrity check FAILED (expected {want}, got {got}). Nothing was changed.")
with tarfile.open(fileobj=io.BytesIO(data)) as tar:
    for name in ("sql-wasm.js", "sql-wasm.wasm"):
        (root / "vendor" / name).write_bytes(tar.extractfile(f"package/dist/{name}").read())
lines = [f"{hashlib.sha256((root/'vendor'/n).read_bytes()).hexdigest()}  {n}" for n in ("sql-wasm.js", "sql-wasm.wasm")]
(root / "vendor" / "CHECKSUMS.txt").write_text(f"sql.js {version} from npm (verified {want[:20]}...)\n" + "\n".join(lines) + "\n")
print("Updated vendor/ to sql.js", version, "- now run: npm test")
