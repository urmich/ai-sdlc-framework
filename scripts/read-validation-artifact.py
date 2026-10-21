"""Read bounded Actions result data without extracting or executing archive entries."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import sys
import zipfile

MAX_ARCHIVE = 128 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024
MAX_FILE = 4 * 1024 * 1024
MAX_NATIVE_JOURNAL = 16 * 1024 * 1024
NATIVE_STAGE_JOURNALS = frozenset(
    f"{stage}.json.journal.ndjson"
    for stage in ("unit", "required-units", "regression")
)


def read_results(archive, kind="native"):
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size > MAX_ARCHIVE:
        raise ValueError("Result archive must be a bounded regular file")
    selected = {}
    seen = set()
    regular = set()
    fingerprints = []
    expanded = 0
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        if not entries or len(entries) > 10000:
            raise ValueError("Result archive has an invalid entry count")
        for entry in entries:
            name = entry.filename
            parts = PurePosixPath(name).parts
            if (not name or "\\" in name or ":" in name or name.startswith("/")
                    or any(part in ("", ".", "..") for part in name.rstrip("/").split("/"))
                    or any(ord(character) < 32 for character in name)):
                raise ValueError("Unsafe result archive path")
            key = name.rstrip("/").casefold()
            if key in seen:
                raise ValueError("Duplicate result archive path")
            if any("/".join(parts[:index]).casefold() in regular
                   for index in range(1, len(parts))):
                raise ValueError("Result archive has a file/directory collision")
            seen.add(key)
            mode = entry.external_attr >> 16
            if (entry.flag_bits & 1 or stat.S_ISLNK(mode)
                    or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                    or stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                raise ValueError("Executable links or encrypted result data are forbidden")
            if entry.is_dir():
                continue
            if ((kind != "candidate" and mode & 0o111)
                    or any(previous.startswith(f"{key}/") for previous in seen)):
                raise ValueError("Result data cannot be executable or replace a directory")
            regular.add(key)
            if kind != "candidate" and not name.endswith((".json", ".ndjson", ".jsonl", ".md", ".log", ".txt")):
                raise ValueError("Only declared result data formats may enter the trusted observer")
            maximum = (MAX_ARCHIVE if kind == "candidate" else
                       MAX_EXPANDED if name == "readiness-bundle.json" else
                       MAX_NATIVE_JOURNAL if name in NATIVE_STAGE_JOURNALS else MAX_FILE)
            expanded += entry.file_size
            if entry.file_size > maximum or expanded > (MAX_ARCHIVE if kind == "candidate" else MAX_EXPANDED):
                raise ValueError("Expanded result data exceeds its budget")
            with bundle.open(entry) as content:
                data = content.read(maximum + 1)
            if len(data) != entry.file_size or len(data) > maximum:
                raise ValueError("Result entry size differs from its archive declaration")
            fingerprints.append({"filename": name, "size": len(data),
                                 "sha256": hashlib.sha256(data).hexdigest()})
            if kind != "candidate":
                selected[name] = data.decode("utf-8", errors="strict")
            elif name in ("context.json", "assets/release-descriptor.json", "assets/SHA256SUMS"):
                if len(data) > MAX_FILE:
                    raise ValueError("Candidate identity document exceeds its budget")
                selected[name] = data.decode("utf-8", errors="strict")
    required = ({"execution.json", "readiness-bundle.json"} if kind == "native" else
                {"toolchain.json", "native-homebrew-prefix-request.json",
                 "native-homebrew-prefix-allocation.json", "native-homebrew-prefix-cleanup.json"}
                if kind == "cleanup" else
                {"context.json", "assets/release-descriptor.json", "assets/SHA256SUMS"})
    if not required.issubset(selected):
        raise ValueError("Required owned-prefix cleanup and bootstrap originals are missing"
                         if kind == "cleanup" else
                         "Required original execution and readiness bundle are missing")
    return {"texts": selected, "files": fingerprints}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--kind", choices=("native", "candidate", "cleanup"), default="native")
    args = parser.parse_args()
    if sys.version_info[:3] != (3, 12, 10):
        raise RuntimeError("The trusted result reader requires CPython 3.12.10")
    print(json.dumps(read_results(args.archive, args.kind), separators=(",", ":")))
