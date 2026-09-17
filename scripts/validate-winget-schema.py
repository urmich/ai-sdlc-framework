"""Validate candidate manifests against hash-locked official WinGet JSON schemas."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import jsonschema
import yaml
from referencing import Registry


def validate(manifest_dir, schema_dir):
    lock = json.loads(Path("packaging/winget/schema-lock.json").read_text())
    schemas = {}
    schema_dir.mkdir(parents=True, exist_ok=True)
    for kind, digest in lock["schemas"].items():
        name = f"manifest.{kind}.{lock['manifestVersion']}.json"
        file = schema_dir / name
        if not file.exists():
            url = ("https://raw.githubusercontent.com/microsoft/winget-cli/"
                   f"{lock['upstreamCommit']}/schemas/JSON/manifests/"
                   f"v{lock['manifestVersion']}/{name}")
            subprocess.run(["curl", "--fail", "--silent", "--show-error", "--location",
                            "--proto", "=https", "--proto-redir", "=https",
                            "--output", str(file), url], check=True)
        if file.is_symlink() or hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise ValueError(f"Official schema digest mismatch: {name}")
        schemas[kind] = json.loads(file.read_bytes())
    found = set()
    files = sorted(manifest_dir.iterdir())
    if len(files) != 3:
        raise ValueError("Exactly three WinGet manifests are required")
    for file in files:
        if file.is_symlink() or not file.is_file() or file.suffix != ".yaml":
            raise ValueError("Only regular WinGet YAML manifests are allowed")
        document = yaml.safe_load(file.read_text())
        kind = document["ManifestType"]
        if kind in found or kind not in schemas:
            raise ValueError("Duplicate or unexpected manifest type")
        found.add(kind)
        schema = schemas[kind]
        validator = jsonschema.validators.validator_for(schema)
        validator.check_schema(schema)
        # An empty registry deliberately disallows remote reference resolution.
        validator(schema, registry=Registry()).validate(document)
    if found != set(schemas):
        raise ValueError("Missing WinGet manifest type")
    return {"schemaValidation": "Passed", "manifestVersion": lock["manifestVersion"],
            "schemaCommit": lock["upstreamCommit"], "nativeValidation": "NotRun"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest-dir", required=True, type=Path)
    parser.add_argument("--schema-dir", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(validate(args.manifest_dir, args.schema_dir), sort_keys=True))
