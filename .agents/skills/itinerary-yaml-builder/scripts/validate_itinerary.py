#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = ["pyyaml>=6", "jsonschema>=4"]
# ///
"""Validate ShowMeWay itinerary YAML against showmeway-schema.json.

Self-contained: dependencies are declared inline (PEP 723), so it runs with no
setup via uv -- `uv run validate_itinerary.py [files...]` -- or directly as
./validate_itinerary.py thanks to the uv shebang above.

Usage:
  uv run validate_itinerary.py                  # checks public/itinerary.yaml and (if present) public/itinerary.local.yaml
  uv run validate_itinerary.py path/to/file.yaml [more.yaml ...]

Exits 1 if any checked file fails validation.
"""

from __future__ import annotations

import sys
from pathlib import Path
from datetime import datetime, timedelta

import yaml
from jsonschema import Draft7Validator

SCHEMA_NAME = "showmeway-schema.json"
DEFAULT_SCHEMA_URL = "https://hsin19.github.io/show-me-way/showmeway-schema.json"


def find_upwards(start: Path, name: str) -> Path | None:
    """Search `start` and its parents for a file named `name`."""
    for directory in (start, *start.parents):
        candidate = directory / name
        if candidate.is_file():
            return candidate
    return None


def load_schema_for(target: Path) -> dict | None:
    """Load schema either from local parent directory or from web fallback."""
    # 1. Try to find local schema file upward
    schema_path = find_upwards(target.resolve().parent, SCHEMA_NAME)
    if schema_path is not None:
        try:
            return yaml.safe_load(schema_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    # 2. Try to fetch from modeline URL in the target file
    try:
        raw_text = target.read_text(encoding="utf-8")
        lines = raw_text.splitlines()
        first_line = lines[0].strip() if lines else ""
        if first_line.startswith("# yaml-language-server:"):
            import urllib.request
            parts = first_line.split("$schema=")
            if len(parts) > 1:
                schema_url = parts[1].strip()
                with urllib.request.urlopen(schema_url, timeout=5) as response:
                    return yaml.safe_load(response.read().decode("utf-8"))
    except Exception:
        pass

    # 3. Fallback to default raw GitHub URL
    try:
        import urllib.request
        with urllib.request.urlopen(DEFAULT_SCHEMA_URL, timeout=5) as response:
            return yaml.safe_load(response.read().decode("utf-8"))
    except Exception:
        pass

    return None


def default_targets() -> list[Path]:
    """When no args: locate the repo's public/ (where the schema lives) and check both itineraries."""
    # The schema now lives in public/, so walk up looking for a public/ dir that contains it.
    for directory in (Path.cwd(), *Path.cwd().parents):
        public = directory / "public"
        if (public / SCHEMA_NAME).is_file():
            return [p for p in (public / "itinerary.yaml", public / "itinerary.local.yaml") if p.is_file()]
    return []


def format_error(err) -> str:
    location = "/".join(str(p) for p in err.absolute_path) or "(root)"
    return f"  {location}: {err.message}"


def validate_file(path: Path) -> bool:
    schema = load_schema_for(path)
    if schema is None:
        print(f"✗ {path}\n  Could not load schema from local files or remote URLs", file=sys.stderr)
        return False

    try:
        raw_text = path.read_text(encoding="utf-8")
        data = yaml.safe_load(raw_text)
    except yaml.YAMLError as exc:
        print(f"✗ {path}\n  YAML parsing failed: {exc}", file=sys.stderr)
        return False

    validator = Draft7Validator(schema)
    errors = sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path))

    if errors:
        print(f"✗ {path}", file=sys.stderr)
        for err in errors:
            print(format_error(err), file=sys.stderr)
        return False

    # Additional custom semantic checks
    custom_errors = []
    
    # 1. Modeline validation (Must be line 1)
    lines = raw_text.splitlines()
    first_line = lines[0].strip() if lines else ""
    if not first_line.startswith("# yaml-language-server:"):
        custom_errors.append("Line 1: Missing schema modeline (e.g. '# yaml-language-server: $schema=...')")

    if isinstance(data, dict):
        trip = data.get("trip", {})
        start_str = trip.get("start")
        end_str = trip.get("end")
        
        try:
            start_date = datetime.strptime(start_str, "%Y-%m-%d").date() if start_str else None
            end_date = datetime.strptime(end_str, "%Y-%m-%d").date() if end_str else None
        except ValueError:
            start_date = None
            end_date = None

        if start_date and end_date and start_date > end_date:
            custom_errors.append(f"trip.start ({start_str}) cannot be after trip.end ({end_str})")

        # 2. Check hotel check-in/check-out chronological correctness and boundaries
        hotels = trip.get("hotels", [])
        for idx, hotel in enumerate(hotels):
            h_name = hotel.get("name", f"Hotel #{idx+1}")
            h_in_str = hotel.get("checkIn")
            h_out_str = hotel.get("checkOut")
            try:
                h_in = datetime.strptime(h_in_str, "%Y-%m-%d").date() if h_in_str else None
                h_out = datetime.strptime(h_out_str, "%Y-%m-%d").date() if h_out_str else None
            except ValueError:
                h_in, h_out = None, None
                
            if h_in and h_out:
                if h_in > h_out:
                    custom_errors.append(f"trip.hotels[{idx}] ({h_name}): checkIn ({h_in_str}) cannot be after checkOut ({h_out_str})")
                if start_date and h_in < start_date:
                    custom_errors.append(f"trip.hotels[{idx}] ({h_name}): checkIn ({h_in_str}) is before trip start ({start_str})")
                if end_date and h_out > end_date:
                    custom_errors.append(f"trip.hotels[{idx}] ({h_name}): checkOut ({h_out_str}) is after trip end ({end_str})")

        # 3. Check days sequencing and date alignment
        days = data.get("days", [])
        for idx, day in enumerate(days):
            day_num = day.get("day")
            day_date_str = day.get("date")
            
            expected_day_num = idx + 1
            if day_num != expected_day_num:
                custom_errors.append(f"days[{idx}].day: Expected {expected_day_num}, but got {day_num}")
                
            try:
                day_date = datetime.strptime(day_date_str, "%Y-%m-%d").date() if day_date_str else None
            except ValueError:
                day_date = None
                
            if day_date:
                if start_date and day_date < start_date:
                    custom_errors.append(f"days[{idx}].date: Date ({day_date_str}) is before trip start ({start_str})")
                if end_date and day_date > end_date:
                    custom_errors.append(f"days[{idx}].date: Date ({day_date_str}) is after trip end ({end_str})")
                if start_date and day_num:
                    expected_date = start_date + timedelta(days=day_num - 1)
                    if day_date != expected_date:
                        custom_errors.append(f"days[{idx}].date: Expected {expected_date} for Day {day_num}, but got {day_date_str}")
            
            # 4. Check timeline events for forbidden runtime keys (_id)
            timeline = day.get("timeline", [])
            for t_idx, event in enumerate(timeline):
                if "_id" in event:
                    custom_errors.append(f"days[{idx}].timeline[{t_idx}]: Contains forbidden runtime key '_id'")

        # 5. todo/packing items must not carry id or runtime-only _id keys.
        for list_name in ("todo", "packing"):
            for idx, item in enumerate(data.get(list_name) or []):
                for forbidden in ("id", "_id"):
                    if forbidden in item:
                        custom_errors.append(f"{list_name}[{idx}]: Contains forbidden key '{forbidden}'")

    if custom_errors:
        print(f"✗ {path}", file=sys.stderr)
        for err in custom_errors:
            print(f"  {err}", file=sys.stderr)
        return False

    days_cnt = len(data.get("days") or []) if isinstance(data, dict) else 0
    hotels_cnt = len((data.get("trip") or {}).get("hotels") or []) if isinstance(data, dict) else 0
    print(f"✓ {path} — valid ({days_cnt} days, {hotels_cnt} hotels)")
    return True


def main(argv: list[str]) -> int:
    if argv:
        targets = [Path(a) for a in argv]
    else:
        targets = default_targets()

    targets = [t for t in targets if t.is_file()]
    if not targets:
        print("No itinerary YAML files found to validate.", file=sys.stderr)
        return 1

    ok = all(validate_file(t) for t in targets)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
