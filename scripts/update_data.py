#!/usr/bin/env python3
"""Refresh the approximate item values in data/items.json from the OSRS Wiki
real-time prices API, and record the fetch date in data/meta.json.

Design goals (see README.md, "Wiki usage notes"):
  * as few requests as possible: normally ONE request (/latest, all items at
    once). /mapping is only requested when an item has no id yet or --remap.
  * a descriptive User-Agent, as the wiki asks.
  * a pause between requests, an on-disk cache, and conditional requests
    (If-None-Match) when a cached copy exists.
  * never leave the data directory half-written: on any failure the existing
    files are left untouched and the script exits non-zero with a clear message.

Only the Python standard library is used.
"""

import argparse
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request

USER_AGENT = (
    "osrs-task-generator-data-refresh/1.0 "
    "(+https://github.com/harveymahon/osrs-task-generator; "
    "weekly item-price refresh for a static fan site)"
)
BASE_URL = "https://prices.runescape.wiki/api/v2/osrs"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
CACHE_DIR = os.path.join(ROOT, ".cache", "wiki")
TIMEOUT_SECONDS = 30
SLEEP_SECONDS = 3.0
RETRY_WAIT_SECONDS = 15.0


class RefreshError(Exception):
    """A problem that should stop the refresh without touching data/."""


def log(message):
    print(message, flush=True)


def read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def write_text_atomic(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.replace(tmp, path)


class Fetcher:
    """Fetches API routes politely: cache, ETag revalidation, sleep, one retry."""

    def __init__(self, base_url, cache_dir, sleep_seconds, offline, fixtures):
        self.base_url = base_url.rstrip("/")
        self.cache_dir = cache_dir
        self.sleep_seconds = sleep_seconds
        self.offline = offline
        self.fixtures = fixtures
        self.requests_made = 0

    def _cache_paths(self, route):
        return (
            os.path.join(self.cache_dir, route + ".json"),
            os.path.join(self.cache_dir, route + ".etag"),
        )

    def _read_cache(self, route):
        body_path, etag_path = self._cache_paths(route)
        try:
            with open(body_path, "rb") as handle:
                body = handle.read()
            json.loads(body.decode("utf-8"))  # a corrupt cache is no cache
        except (OSError, ValueError):
            return None, None
        try:
            with open(etag_path, "r", encoding="utf-8") as handle:
                etag = handle.read().strip() or None
        except OSError:
            etag = None
        return body, etag

    def _write_cache(self, route, body, etag):
        body_path, etag_path = self._cache_paths(route)
        try:
            os.makedirs(self.cache_dir, exist_ok=True)
            with open(body_path, "wb") as handle:
                handle.write(body)
            with open(etag_path, "w", encoding="utf-8") as handle:
                handle.write(etag or "")
        except OSError as exc:  # caching is best-effort
            log("  note: could not write cache (%s)" % exc)

    def get_json(self, route):
        if self.fixtures:
            path = os.path.join(self.fixtures, route + ".json")
            log("  reading recorded response %s" % path)
            try:
                return read_json(path)
            except (OSError, ValueError) as exc:
                raise RefreshError("recorded response %s is unusable: %s" % (path, exc))

        cached_body, cached_etag = self._read_cache(route)
        if self.offline:
            if cached_body is None:
                raise RefreshError("--offline was given but there is no cached /%s" % route)
            log("  offline: using cached /%s" % route)
            return self._parse(route, cached_body)

        url = "%s/%s" % (self.base_url, route)
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        if cached_body is not None and cached_etag:
            headers["If-None-Match"] = cached_etag

        last_error = None
        for attempt in (1, 2):
            if self.requests_made:
                time.sleep(self.sleep_seconds)
            self.requests_made += 1
            log("  GET %s%s" % (url, " (conditional)" if "If-None-Match" in headers else ""))
            try:
                request = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                    body = response.read()
                    etag = response.headers.get("ETag")
                data = self._parse(route, body)
                self._write_cache(route, body, etag)
                return data
            except urllib.error.HTTPError as exc:
                if exc.code == 304 and cached_body is not None:
                    log("  304 Not Modified: using cached /%s" % route)
                    return self._parse(route, cached_body)
                last_error = "HTTP %s from %s" % (exc.code, url)
                if exc.code < 500 and exc.code != 429:
                    break  # a client error will not fix itself; do not retry
            except (urllib.error.URLError, OSError, ValueError) as exc:
                last_error = "%s: %s" % (type(exc).__name__, getattr(exc, "reason", exc))
            if attempt == 1:
                log("  request failed (%s); one retry in %.0fs" % (last_error, RETRY_WAIT_SECONDS))
                time.sleep(RETRY_WAIT_SECONDS)
        raise RefreshError("could not fetch /%s: %s" % (route, last_error))

    @staticmethod
    def _parse(route, body):
        try:
            return json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise ValueError("response for /%s is not valid JSON (%s)" % (route, exc))


def round_value(value):
    """Round to 3 significant figures: the site only shows approximate gp."""
    value = int(round(value))
    if value < 1000:
        return value
    magnitude = 10 ** (len(str(value)) - 3)
    return int(round(value / magnitude) * magnitude)


def price_of(entry):
    if not isinstance(entry, dict):
        return None
    sides = [entry.get(k) for k in ("high", "low")]
    sides = [s for s in sides if isinstance(s, (int, float)) and s > 0]
    if not sides:
        return None
    return round_value(sum(sides) / len(sides))


def format_items(doc):
    lines = ",\n".join("    " + json.dumps(item, ensure_ascii=False) for item in doc["items"])
    note = json.dumps(doc.get("_note", ""), ensure_ascii=False)
    return '{\n  "_note": %s,\n  "items": [\n%s\n  ]\n}\n' % (note, lines)


def refresh(args):
    items_path = os.path.join(args.data_dir, "items.json")
    meta_path = os.path.join(args.data_dir, "meta.json")
    try:
        doc = read_json(items_path)
        items = doc["items"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise RefreshError("cannot read %s: %s" % (items_path, exc))

    tradeable = [item for item in items if item.get("tradeable")]
    log("Tracking %d items (%d tradeable)." % (len(items), len(tradeable)))

    fetcher = Fetcher(args.base_url, args.cache_dir, args.sleep, args.offline, args.fixtures)

    unmatched = []
    if args.remap or any(item.get("id") is None for item in tradeable):
        log("Resolving item ids via /mapping ...")
        mapping = fetcher.get_json("mapping")
        if not isinstance(mapping, list) or not mapping:
            raise RefreshError("/mapping did not return a non-empty list")
        by_name = {m.get("name"): m.get("id") for m in mapping if isinstance(m, dict)}
        for item in tradeable:
            if item["name"] in by_name:
                item["id"] = by_name[item["name"]]
            else:
                unmatched.append(item["name"])
    else:
        log("All tradeable items already have ids: skipping /mapping.")

    log("Fetching latest prices via /latest (one request for all items) ...")
    latest = fetcher.get_json("latest")
    prices = latest.get("data") if isinstance(latest, dict) else None
    if not isinstance(prices, dict) or not prices:
        raise RefreshError("/latest did not contain a non-empty 'data' object")

    priced, kept = 0, []
    for item in tradeable:
        value = price_of(prices.get(str(item.get("id")))) if item.get("id") is not None else None
        if value is None:
            kept.append(item["name"])  # keep whatever value we already had
        else:
            item["value"] = value
            priced += 1

    if tradeable and priced < len(tradeable) / 2:
        raise RefreshError(
            "only %d of %d tradeable items had a price; refusing to overwrite data"
            % (priced, len(tradeable))
        )

    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    doc["_note"] = (
        "Item list is hand-curated; id and value are filled in by scripts/update_data.py. "
        "value = approximate gp (mean of latest instant-buy and instant-sell, 3 significant figures). "
        "tradeable=false items are never priced."
    )
    meta = {
        "fetched_at": now.isoformat().replace("+00:00", "Z"),
        "fetched_date": now.date().isoformat(),
        "source": "OSRS Wiki real-time prices API (%s)" % args.base_url,
        "source_mode": "recorded" if args.fixtures else ("cache" if args.offline else "network"),
        "requests_made": fetcher.requests_made,
        "items_tracked": len(items),
        "items_priced": priced,
        "items_without_price": kept,
        "items_not_in_mapping": unmatched,
        "user_agent": USER_AGENT,
    }
    write_text_atomic(items_path, format_items(doc))
    write_text_atomic(meta_path, json.dumps(meta, indent=2, ensure_ascii=False) + "\n")

    log("Priced %d/%d tradeable items with %d request(s)." % (priced, len(tradeable), fetcher.requests_made))
    if kept:
        log("No current price (old value kept) for: %s" % ", ".join(kept))
    if unmatched:
        log("Not found in /mapping (check spelling): %s" % ", ".join(unmatched))
    log("Wrote %s and %s" % (items_path, meta_path))


def main(argv=None):
    # Printed before any argument parsing, file or network work.
    log("update_data.py started: refreshing OSRS item values (no network activity yet).")

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--data-dir", default=DATA_DIR, help="directory holding items.json / meta.json")
    parser.add_argument("--cache-dir", default=CACHE_DIR, help="directory for cached API responses")
    parser.add_argument("--base-url", default=BASE_URL, help="prices API base URL")
    parser.add_argument("--sleep", type=float, default=SLEEP_SECONDS, help="seconds to wait between requests")
    parser.add_argument("--remap", action="store_true", help="re-resolve every item id via /mapping")
    parser.add_argument("--offline", action="store_true", help="make no requests; use cached responses only")
    parser.add_argument("--fixtures", metavar="DIR", help="read mapping.json / latest.json from DIR instead of the network")
    args = parser.parse_args(argv)

    try:
        refresh(args)
    except RefreshError as exc:
        log("ERROR: %s" % exc)
        log("Nothing was written; the existing files in data/ are unchanged.")
        return 1
    except KeyboardInterrupt:
        log("Interrupted; the existing files in data/ are unchanged.")
        return 130
    log("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
