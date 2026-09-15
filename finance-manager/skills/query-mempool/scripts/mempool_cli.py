#!/usr/bin/env python3
"""CLI for querying mempool.space: transactions, addresses, and wallet
descriptors (via bdkpython address derivation with gap-limit scanning).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

DEFAULT_API_URLS = {
    "mainnet": "https://mempool.space/api",
    "testnet": "https://mempool.space/testnet/api",
    "signet": "https://mempool.space/signet/api",
}

# Blockstream's Esplora is the API mempool.space's own API is derived from - same
# endpoint shapes, no API key required. Used as an automatic fallback when the
# primary is rate-limited or unreachable. No public Blockstream signet instance
# exists, so signet has no fallback.
FALLBACK_API_URLS = {
    "mainnet": ["https://blockstream.info/api"],
    "testnet": ["https://blockstream.info/testnet/api"],
    "signet": [],
}

RATE_LIMIT_MAX_RETRIES = 3
RATE_LIMIT_BACKOFF_SECONDS = 1.0
# Hard ceiling on any single sleep, including a server-supplied Retry-After -
# a misbehaving or malicious response should never be able to hang the CLI
# for an unbounded amount of time.
RATE_LIMIT_MAX_SLEEP_SECONDS = 60.0

# Proactive pacing between successive descriptor-scan requests. mempool.space
# does not publish its rate-limit thresholds ("if you have to ask you'll hit
# them" - project maintainers), so this is a conservative default meant to
# avoid tripping 429s in the first place during a wide gap-limit scan, not a
# number derived from documented limits. Override with --request-delay.
DEFAULT_REQUEST_DELAY_SECONDS = 0.5


class MempoolApiError(Exception):
    pass


class MempoolNotFoundError(MempoolApiError):
    pass


class MempoolRateLimitError(MempoolApiError):
    pass


def _retry_delay_seconds(exc: urllib.error.HTTPError, fallback: float) -> float:
    """Honor a 429 response's Retry-After header when present (either the
    delta-seconds form or an HTTP-date), else fall back to the caller's own
    exponential-backoff value. Neither mempool.space nor Blockstream document
    sending this header, but respecting it when a provider does is strictly
    safer than guessing - and costs nothing when it's absent. Always bounded
    by RATE_LIMIT_MAX_SLEEP_SECONDS so a hostile or malformed value can't hang
    the CLI indefinitely."""
    raw = exc.headers.get("Retry-After") if exc.headers is not None else None
    delay = fallback
    if raw is not None:
        raw = raw.strip()
        if raw.isdigit():
            delay = float(raw)
        else:
            try:
                when = parsedate_to_datetime(raw)
            except (TypeError, ValueError):
                when = None
            if when is not None:
                from datetime import datetime, timezone

                now = datetime.now(timezone.utc)
                if when.tzinfo is None:
                    when = when.replace(tzinfo=timezone.utc)
                delay = max(0.0, (when - now).total_seconds())
    return min(max(delay, 0.0), RATE_LIMIT_MAX_SLEEP_SECONDS)


def fetch_json(
    url: str,
    timeout: int = 10,
    max_retries: int = RATE_LIMIT_MAX_RETRIES,
    backoff_seconds: float = RATE_LIMIT_BACKOFF_SECONDS,
):
    """Fetch a single URL, retrying with exponential backoff on HTTP 429
    (rate limited) up to `max_retries` times before giving up on this URL."""
    attempt = 0
    while True:
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise MempoolNotFoundError(f"not found: {url}") from exc
            if exc.code == 429:
                if attempt >= max_retries:
                    raise MempoolRateLimitError(f"rate limited, retry later: {url}") from exc
                time.sleep(_retry_delay_seconds(exc, backoff_seconds * (2**attempt)))
                attempt += 1
                continue
            raise MempoolApiError(f"HTTP {exc.code} from {url}: {exc.reason}") from exc
        except urllib.error.URLError as exc:
            raise MempoolApiError(f"request to {url} failed: {exc.reason}") from exc


def resolve_api_urls(network: str, api_url_override: str | None) -> list[str]:
    """Primary + fallback base URLs to try in order for `network`. An explicit
    `--api-url` override (e.g. a self-hosted instance) disables fallback
    entirely - that's assumed to be an intentional, specific choice."""
    if api_url_override:
        return [api_url_override]
    return [DEFAULT_API_URLS[network], *FALLBACK_API_URLS.get(network, [])]


def fetch_with_fallback(path: str, api_urls: list[str], fetch=fetch_json):
    """Fetch `path` against each base URL in `api_urls` in turn, falling
    through to the next provider if one is rate-limited (after its own
    retries) or unreachable. A 404 is authoritative - every provider indexes
    the same chain, so a genuinely missing resource won't appear on the next
    one either - and is raised immediately without trying further providers."""
    last_error: MempoolApiError | None = None
    for base_url in api_urls:
        try:
            return fetch(f"{base_url}{path}")
        except MempoolNotFoundError:
            raise
        except MempoolApiError as exc:
            last_error = exc
            continue
    assert last_error is not None  # api_urls is never empty
    raise last_error


def resolve_network(name: str):
    import bdkpython as bdk

    return {
        "mainnet": (bdk.NetworkKind.MAIN, bdk.Network.BITCOIN),
        "testnet": (bdk.NetworkKind.TEST, bdk.Network.TESTNET),
        "signet": (bdk.NetworkKind.TEST, bdk.Network.SIGNET),
    }[name]


def split_branches(descriptor):
    if descriptor.is_multipath():
        return descriptor.to_single_descriptors()
    return [descriptor]


def scan_descriptor(
    descriptor_str: str,
    network_name: str,
    gap_limit: int,
    api_urls: list[str],
    fetch=fetch_json,
    request_delay: float = DEFAULT_REQUEST_DELAY_SECONDS,
    start_index: int = 0,
) -> dict:
    import bdkpython as bdk

    network_kind, network = resolve_network(network_name)
    branches = split_branches(bdk.Descriptor(descriptor_str, network_kind))

    addresses: list[dict] = []
    last_scanned_index = start_index - 1
    for branch in branches:
        def address_at(index, branch=branch):
            return str(branch.derive_address(index, network))

        def fetch_address_summary(address):
            return fetch_with_fallback(f"/address/{address}", api_urls, fetch)

        branch_addresses, branch_last_index = scan_branch(
            address_at, fetch_address_summary, gap_limit, request_delay, start_index
        )
        addresses.extend(branch_addresses)
        last_scanned_index = max(last_scanned_index, branch_last_index)

    confirmed_balance = 0
    unconfirmed_delta = 0
    tx_count = 0
    for entry in addresses:
        cs = entry["summary"]["chain_stats"]
        ms = entry["summary"]["mempool_stats"]
        confirmed_balance += cs["funded_txo_sum"] - cs["spent_txo_sum"]
        unconfirmed_delta += ms["funded_txo_sum"] - ms["spent_txo_sum"]
        tx_count += cs["tx_count"] + ms["tx_count"]

    return {
        "addresses": addresses,
        "confirmed_balance_sats": confirmed_balance,
        "unconfirmed_delta_sats": unconfirmed_delta,
        "total_balance_sats": confirmed_balance + unconfirmed_delta,
        "tx_count": tx_count,
        # Highest address index actually scanned across all branches this run.
        # Persist this and pass it back as --start-index next run to resume
        # from here instead of re-deriving every address from 0 - a wallet
        # that never reuses addresses only ever grows past its last known
        # used index, so re-scanning the already-confirmed-empty prefix on
        # every run is pure waste. Applies the same start_index to every
        # branch (receive/change may differ slightly in real depth); the
        # worst case is a few extra harmless re-checks on the shallower one.
        "last_scanned_index": last_scanned_index,
    }


def _is_unused(addr_json: dict) -> bool:
    return (
        addr_json["chain_stats"]["funded_txo_count"] == 0
        and addr_json["mempool_stats"]["funded_txo_count"] == 0
    )


def scan_branch(
    address_at,
    fetch_address_summary,
    gap_limit: int,
    request_delay: float = DEFAULT_REQUEST_DELAY_SECONDS,
    start_index: int = 0,
) -> tuple[list[dict], int]:
    """Scan addresses starting at `start_index` until `gap_limit` consecutive
    unused addresses are found. Returns the used addresses plus the highest
    index actually checked, so a caller can resume from there next time.
    `request_delay` paces successive requests proactively (mempool.space's
    exact rate limits are undocumented by design) rather than relying solely
    on reactive backoff after a 429 already happened."""
    used: list[dict] = []
    consecutive_unused = 0
    index = start_index
    first = True
    while consecutive_unused < gap_limit:
        if not first:
            time.sleep(request_delay)
        first = False
        address = address_at(index)
        summary = fetch_address_summary(address)
        if _is_unused(summary):
            consecutive_unused += 1
        else:
            consecutive_unused = 0
            used.append({"index": index, "address": address, "summary": summary})
        index += 1
    return used, index - 1


ADDRESS_TXS_PAGE_SIZE = 25


def paginate(items: list, page: int, page_size: int = 25) -> tuple[list, bool]:
    start = (page - 1) * page_size
    end = start + page_size
    return items[start:end], end < len(items)


def fetch_address_txs_page(api_urls: list[str], address: str, page: int, fetch=fetch_json) -> tuple[list[dict], bool]:
    """Fetch only up to the requested page (25 txs/page) of an address's confirmed
    history - mempool.space's cursor-based pagination means reaching page N requires
    sequentially requesting pages 1..N, but this never fetches beyond that."""
    base_path = f"/address/{address}/txs/chain"
    path = base_path
    current_page: list[dict] = []
    for page_num in range(1, page + 1):
        current_page = fetch_with_fallback(path, api_urls, fetch)
        if len(current_page) < ADDRESS_TXS_PAGE_SIZE:
            return current_page, False
        if page_num < page:
            path = f"{base_path}/{current_page[-1]['txid']}"
    return current_page, True


def render_descriptor_result(result: dict, total_addresses: int | None = None) -> str:
    if total_addresses is None:
        total_addresses = len(result["addresses"])
    summary = format_table(
        headers=[
            "confirmed_balance_sats",
            "unconfirmed_delta_sats",
            "total_balance_sats",
            "tx_count",
            "addresses_used",
        ],
        rows=[
            [
                str(result["confirmed_balance_sats"]),
                str(result["unconfirmed_delta_sats"]),
                str(result["total_balance_sats"]),
                str(result["tx_count"]),
                str(total_addresses),
            ]
        ],
    )
    addresses = format_table(
        headers=["index", "address", "confirmed_balance_sats"],
        rows=[
            [
                str(entry["index"]),
                entry["address"],
                str(entry["summary"]["chain_stats"]["funded_txo_sum"] - entry["summary"]["chain_stats"]["spent_txo_sum"]),
            ]
            for entry in result["addresses"]
        ],
    )
    footer = f"\n\nlast_scanned_index: {result['last_scanned_index']} (pass --start-index {result['last_scanned_index'] + 1} next run to resume from here)" if "last_scanned_index" in result else ""
    return f"{summary}\n\nAddresses:\n{addresses}{footer}"


def render_address(addr_json: dict) -> str:
    cs = addr_json["chain_stats"]
    ms = addr_json["mempool_stats"]
    confirmed_balance = cs["funded_txo_sum"] - cs["spent_txo_sum"]
    unconfirmed_delta = ms["funded_txo_sum"] - ms["spent_txo_sum"]
    return format_table(
        headers=[
            "address",
            "confirmed_balance_sats",
            "unconfirmed_delta_sats",
            "total_balance_sats",
            "tx_count",
        ],
        rows=[
            [
                addr_json["address"],
                str(confirmed_balance),
                str(unconfirmed_delta),
                str(confirmed_balance + unconfirmed_delta),
                str(cs["tx_count"] + ms["tx_count"]),
            ]
        ],
    )


def render_tx_list(txs: list[dict]) -> str:
    return format_table(
        headers=["txid", "confirmed", "block_height", "fee_sats"],
        rows=[
            [
                tx["txid"],
                "yes" if tx["status"].get("confirmed") else "no",
                str(tx["status"].get("block_height", "")),
                str(tx["fee"]),
            ]
            for tx in txs
        ],
    )


def render_tx(tx: dict) -> str:
    status = tx["status"]
    summary = format_table(
        headers=["txid", "confirmed", "block_height", "fee_sats", "size", "weight"],
        rows=[
            [
                tx["txid"],
                "yes" if status.get("confirmed") else "no",
                str(status.get("block_height", "")),
                str(tx["fee"]),
                str(tx["size"]),
                str(tx["weight"]),
            ]
        ],
    )
    outputs = format_table(
        headers=["vout", "address", "value_sats"],
        rows=[
            [str(i), v.get("scriptpubkey_address", v.get("scriptpubkey_type", "unknown")), str(v["value"])]
            for i, v in enumerate(tx["vout"])
        ],
    )
    return f"{summary}\n\nOutputs:\n{outputs}"


def format_table(headers: list[str], rows: list[list[str]]) -> str:
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def format_row(cells: list[str]) -> str:
        padded = [cell.ljust(widths[i]) for i, cell in enumerate(cells[:-1])]
        padded.append(cells[-1])
        return "  ".join(padded)

    lines = [format_row(headers), "  ".join("-" * w for w in widths)]
    lines.extend(format_row(row) for row in rows)
    return "\n".join(lines)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Query mempool.space: transactions, addresses, and wallet descriptors")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of a table")
    parser.add_argument("--network", choices=sorted(DEFAULT_API_URLS), default="mainnet")
    parser.add_argument("--api-url", help="Override the default mempool.space API base URL for --network")

    subparsers = parser.add_subparsers(dest="command", required=True)

    tx_parser = subparsers.add_parser("tx", help="Look up a transaction by txid")
    tx_parser.add_argument("txid")

    address_parser = subparsers.add_parser("address", help="Look up an address's balance and tx history")
    address_parser.add_argument("address")
    address_parser.add_argument("--page", type=int, default=1, help="Tx history page (25 per page, default 1)")

    price_parser = subparsers.add_parser("price", help="Current BTC price in a fiat currency")
    price_parser.add_argument("--currency", default="CAD", help="Fiat code, e.g. CAD or USD (default CAD)")

    descriptor_parser = subparsers.add_parser(
        "descriptor", help="Derive addresses from a wallet descriptor and aggregate balance/history"
    )
    descriptor_parser.add_argument("descriptor")
    descriptor_parser.add_argument("--gap-limit", type=int, default=20)
    descriptor_parser.add_argument("--page", type=int, default=1, help="Used-addresses page (25 per page, default 1)")
    descriptor_parser.add_argument(
        "--request-delay",
        type=float,
        default=DEFAULT_REQUEST_DELAY_SECONDS,
        help=f"Seconds to wait between successive address lookups during the scan (default {DEFAULT_REQUEST_DELAY_SECONDS})",
    )
    descriptor_parser.add_argument(
        "--start-index",
        type=int,
        default=0,
        help="Resume scanning from this address index instead of 0 (see last_scanned_index in a prior run's output)",
    )

    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    api_urls = resolve_api_urls(args.network, args.api_url)

    try:
        if args.command == "tx":
            tx = fetch_with_fallback(f"/tx/{args.txid}", api_urls)
            print(json.dumps(tx, indent=2) if args.json else render_tx(tx))
        elif args.command == "price":
            prices = fetch_with_fallback("/v1/prices", api_urls)
            code = args.currency.upper()
            if code not in prices:
                available = ", ".join(sorted(k for k in prices if k != "time"))
                print(f"no {code} price in the response; available: {available}", file=sys.stderr)
                return 2
            as_of = datetime.fromtimestamp(prices["time"], tz=timezone.utc).isoformat().replace("+00:00", "Z")
            if args.json:
                print(json.dumps({"currency": code, "price": prices[code], "as_of": as_of}, indent=2))
            else:
                print(f"{code} {prices[code]:,.2f}  as of {as_of} (source: mempool.space)")
        elif args.command == "address":
            summary = fetch_with_fallback(f"/address/{args.address}", api_urls)
            txs, has_more = fetch_address_txs_page(api_urls, args.address, args.page)
            if args.json:
                print(json.dumps({**summary, "page": args.page, "has_more": has_more, "txs": txs}, indent=2))
            else:
                print(render_address(summary))
                if txs:
                    print("\nTransactions:")
                    print(render_tx_list(txs))
                print(f"\nPage {args.page}" + (f" (more available - use --page {args.page + 1})" if has_more else ""))
        elif args.command == "descriptor":
            result = scan_descriptor(
                args.descriptor,
                args.network,
                args.gap_limit,
                api_urls,
                request_delay=args.request_delay,
                start_index=args.start_index,
            )
            page_addresses, has_more = paginate(result["addresses"], args.page)
            total_addresses = len(result["addresses"])
            display_result = {**result, "addresses": page_addresses}
            if args.json:
                print(json.dumps({**display_result, "page": args.page, "has_more": has_more, "total_addresses": total_addresses}, indent=2))
            else:
                print(render_descriptor_result(display_result, total_addresses=total_addresses))
                print(f"\nPage {args.page}" + (f" (more available - use --page {args.page + 1})" if has_more else ""))
    except (MempoolNotFoundError, MempoolRateLimitError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except MempoolApiError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
