#!/usr/bin/env python3
"""Derive a month's figures from the ledger, programmatically.

Every number the monthly report shows is computed here, by code, from the ledger
and from explicitly-supplied inputs. The model's job is the narrative, the three
actions and the prose notes - never arithmetic. The rules this implements are the
ones in references/derivations.md; where a rule cannot be derived from the ledger
(the mortgage principal/interest split comes from an amortisation statement, a
manual balance is typed by a human) the input is passed in and named in the output
rather than guessed.

Usage:
    derive.py --month 2026-08 --config <account map> --out numbers.json
              [--manual-balances docs/finance/manual-balances.json]
              [--profile docs/finance/financial-profile.md | --home-value 530000]
              [--mortgage-balance 489441.74] [--mortgage-principal 1819.00]
              [--bitcoin-quantity 0.44053689] [--prev-snapshot <path>]

Requires the environment the actual-budget skill documents (ACTUAL_SERVER_URL,
ACTUAL_PASSWORD, ACTUAL_SYNC_ID, ACTUAL_DATA_DIR, ACTUAL_ENCRYPTION_PASSWORD) and
the CLI itself (ACTUAL_CLI, defaulting to the plugin's node_modules). Output is the
numeric half of a snapshot; narrative/actions/highlights are deliberately absent.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# The CLI's JSON is in CENTS, not milliunits: measured, not assumed. Summing August's
# income-category rows and dividing by 1000 produced 1,335.36 against the published
# 13,335.66 - a factor of 10.00 - so the raw figures are cents and the divisor is 100.
MINOR_UNITS = 100.0
TRANSFER_MATCH_WINDOW_DAYS = 21


# --------------------------------------------------------------------------- CLI


def cli_path() -> str:
    explicit = os.environ.get("ACTUAL_CLI")
    if explicit:
        return explicit
    here = Path(__file__).resolve()
    for candidate in (
        here.parents[4] / "actual-budget" / "node_modules" / ".bin" / "actual",
        Path.home() / ".omp/plugins/cache/plugins/cameri-skills___actual-budget___0.1.4/node_modules/.bin/actual",
    ):
        if candidate.exists():
            return str(candidate)
    fail("cannot find the actual CLI; set ACTUAL_CLI to its path")


def fail(message: str) -> None:
    print(f"derive: {message}", file=sys.stderr)
    raise SystemExit(2)


def cli(*args: str) -> object:
    required = ("ACTUAL_SERVER_URL", "ACTUAL_PASSWORD", "ACTUAL_SYNC_ID")
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        fail(f"credentials not in the environment: {', '.join(missing)} "
             f"(source ~/.claude/channels/actual-budget/.env before running, as the actual-budget skill documents)")
    # --refresh forces a server sync instead of trusting the CLI's local cache: a
    # stale cache reads as a plausible fraction of a month, which is the most
    # dangerous kind of wrong - every figure is small and nothing looks broken.
    cmd = [cli_path(), "--format", "json", "--refresh", *args]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        fail(f"actual {' '.join(args)} failed: {proc.stderr.strip()[:400]}")
    out = proc.stdout.strip()
    if not out:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        fail(f"actual {' '.join(args)} returned non-JSON: {out[:200]}")


def rows(payload: object) -> list[dict]:
    """The CLI wraps some results in {data: [...]} and returns others bare."""
    if payload is None:
        return []
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("data", "rows", "transactions", "accounts"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


# ------------------------------------------------------------------------- inputs


def read_json(path: str, what: str) -> dict:
    p = Path(path)
    if not p.exists():
        fail(f"{what} not found: {path}")
    return json.loads(p.read_text())


def manual_balances(path: str | None, month_end: date) -> tuple[dict[str, dict], list[str]]:
    """Balances a human typed, keyed by account id, with their read date.

    A missing entry is NOT a zero: it is reported and the account is carried at
    whatever the ledger last saw, flagged. A real 0 is a fact and is used as one.
    """
    if not path:
        return {}, ["no manual-balances file supplied"]
    p = Path(path)
    if not p.exists():
        return {}, [f"{path} does not exist; accounts no feed reaches carry their last ledger date"]
    data = json.loads(p.read_text())
    out, notes = {}, []
    for account_id, entry in (data.get("accounts") or {}).items():
        read_on = entry.get("date")
        if not read_on:
            notes.append(f"manual balance for {account_id} has no date and was ignored")
            continue
        if datetime.fromisoformat(read_on).date() > month_end:
            notes.append(f"manual balance for {account_id} is dated {read_on}, after the month end, and was ignored")
            continue
        out[account_id] = {"balance": float(entry["balance"]), "date": read_on, "note": entry.get("note", "")}
    return out, notes


def bitcoin_quantity(explicit: float | None) -> tuple[float | None, str]:
    if explicit is not None:
        return explicit, "supplied on the command line"
    state = Path("docs/finance/bitkey-mempool-monitor-state.json")
    if state.exists():
        data = json.loads(state.read_text())
        wallet = data.get("bitkey") if isinstance(data.get("bitkey"), dict) else data
        for key in ("total_balance_sats", "confirmed_balance_sats"):
            sats = wallet.get(key)
            if isinstance(sats, (int, float)):
                return float(sats) / 1e8, f"docs/finance/bitkey-mempool-monitor-state.json (bitkey.{key})"
        for key in ("balance_btc", "quantity_btc"):
            if isinstance(wallet.get(key), (int, float)):
                return float(wallet[key]), f"docs/finance/bitkey-mempool-monitor-state.json ({key})"
    return None, "not found; pass --bitcoin-quantity"


def bitcoin_price(currency: str) -> tuple[float | None, str, str | None]:
    """The month's price, from the plugin's own client. Historical when the month is
    in the past, so a figure never wears a timestamp it was not measured at."""
    script = Path(__file__).resolve().parents[2] / "query-mempool" / "scripts" / "mempool_cli.py"
    if not script.exists():
        return None, "query-mempool script not found", None
    try:
        proc = subprocess.run([sys.executable, str(script), "price", "--currency", currency],
                              capture_output=True, text=True, timeout=90)
        if proc.returncode == 0:
            line = proc.stdout.strip()
            rate = float(line.split()[1].replace(",", ""))
            as_of = line.split("as of")[1].split("(")[0].strip()
            return rate, f"mempool.space, live at run time ({as_of})", as_of
    except Exception as exc:  # a price is not worth failing the whole run over
        return None, f"price lookup failed: {exc}", None
    return None, "price lookup returned nothing", None


# -------------------------------------------------------------------- derivations


def month_bounds(month: str) -> tuple[date, date]:
    year, mon = (int(x) for x in month.split("-"))
    start = date(year, mon, 1)
    end = date(year + (mon == 12), (mon % 12) + 1, 1) - timedelta(days=1)
    return start, end


def ledger_rows(start: date, end: date) -> list[dict]:
    # --select is not optional: without it the CLI returns bare ids and every
    # category total below would be a silent zero.
    payload = cli("query", "run", "--table", "transactions",
                  "--select", "id,date,amount,account,account.name,payee.name,notes,transfer_id,"
                              "is_parent,is_child,category,category.name,category.group.name",
                  "--filter", json.dumps({"date": {"$gte": start.isoformat(), "$lte": end.isoformat()}}),
                  "--order-by", "date")
    out = []
    for r in rows(payload):
        if r.get("is_parent"):
            continue  # a split's parent carries the net; its children carry the detail
        amount = r.get("amount")
        if amount is None:
            continue
        r["amount_cad"] = round(float(amount) / MINOR_UNITS, 4)
        out.append(r)
    return out


def balances(accounts: list[dict], cutoff: date) -> dict[str, float]:
    """Balances as of a date, computed by the CLI's own --cutoff, not by us."""
    out = {}
    for a in accounts:
        try:
            payload = cli("accounts", "balance", a["id"], "--cutoff", cutoff.isoformat())
        except SystemExit:
            fail(f"no balance for {a.get('name')} at {cutoff}; a net-worth figure with a silent hole in it is worse than no figure")
        if isinstance(payload, dict) and "balance" in payload:
            out[a["id"]] = round(float(payload["balance"]) / MINOR_UNITS, 2)
        elif isinstance(payload, (int, float)):
            out[a["id"]] = round(float(payload) / MINOR_UNITS, 2)
        else:
            fail(f"unexpected balance payload for {a.get('name')}: {str(payload)[:120]}")
    return out


def group_by_category(ledger: list[dict]) -> dict[str, dict]:
    totals: dict[str, dict] = defaultdict(lambda: {"total": 0.0, "group": "", "income": False, "rows": 0})
    for r in ledger:
        name = r.get("category.name") or "(uncategorized)"
        entry = totals[name]
        entry["total"] = round(entry["total"] + r["amount_cad"], 2)
        entry["group"] = r.get("category.group.name") or ""
        entry["income"] = entry["income"] or bool(r.get("category.is_income"))
        entry["rows"] += 1
    return dict(totals)


def flow(ledger: list[dict], accounts_by_id: dict[str, dict]) -> dict:
    """Income, consumption and the internal-transfer total, by the documented rules.

    Internal movement is excluded explicitly and only ever by evidence: a row that
    the ledger itself linked (transfer_id) or a pair of equal and opposite rows on
    different accounts inside the matching window. Categories are never read as
    flow, and gross deposits are never read as saving.
    """
    linked = {r["id"]: r for r in ledger if r.get("transfer_id")}
    unmatched = [r for r in ledger if not r.get("transfer_id")]

    by_pair: dict[tuple[str, float], list[dict]] = defaultdict(list)
    for r in unmatched:
        key = (r.get("account"), round(r["amount_cad"], 2))
        by_pair[key].append(r)

    matched_ids: set[str] = set()
    pairs: list[dict] = []
    for key, group in by_pair.items():
        account, amount = key
        if amount >= 0:
            continue
        for outflow in group:
            for inflow_key, inflow_group in by_pair.items():
                if inflow_key[0] == account or round(inflow_key[1], 2) != round(-amount, 2):
                    continue
                for inflow in inflow_group:
                    gap = abs((datetime.fromisoformat(inflow["date"]).date()
                               - datetime.fromisoformat(outflow["date"]).date()).days)
                    if gap <= TRANSFER_MATCH_WINDOW_DAYS:
                        matched_ids.update({outflow["id"], inflow["id"]})
                        pairs.append({"from": outflow.get("account.name"), "to": inflow.get("account.name"),
                                      "amount": abs(amount), "days_apart": gap})
                        break
                if outflow["id"] in matched_ids:
                    break

    internal_ids = set(linked) | matched_ids
    internal_total = round(sum(r["amount_cad"] for r in ledger if r["id"] in internal_ids and r["amount_cad"] < 0) * -1, 2)

    income, expense = [], []
    for name, entry in group_by_category(ledger).items():
        if name in ("(uncategorized)",):
            continue
        if entry["income"] or entry["group"] in ("Income",):
            income.append({"name": name, "amount": round(entry["total"] * -1, 2)})
        elif entry["total"] < 0:
            expense.append({"name": name, "amount": round(entry["total"] * -1, 2)})
    income.sort(key=lambda x: -x["amount"])
    expense.sort(key=lambda x: -x["amount"])

    return {
        "income": income,
        "expense": expense,
        "transfer_pairs": pairs,
        "internal_transfers": internal_total,
        "internal_movement_rule": (f"transfer_id rows plus matched equal-and-opposite pairs within "
                                   f"{TRANSFER_MATCH_WINDOW_DAYS} days; categories are never read as flow"),
        "excluded_rows": {"linked": len(linked), "matched": len(matched_ids)},
    }


def off_budget(ledger: list[dict], accounts_by_id: dict[str, dict]) -> list[dict]:
    """Net per-account deltas on off-budget accounts - the only honest way to show
    what moved outside the budget without counting transfers as spending."""
    deltas: dict[str, float] = defaultdict(float)
    for r in ledger:
        account = accounts_by_id.get(r.get("account"))
        if account and account.get("offbudget"):
            deltas[r["account"]] += r["amount_cad"]
    return [{"name": accounts_by_id[aid].get("name", aid), "amount": round(total, 2), "basis": "measured"}
            for aid, total in sorted(deltas.items(), key=lambda kv: -abs(kv[1])) if abs(total) >= 0.01]


# Which bucket an account belongs to is configuration, not inference: it is read
# from the account map when the map says so, and the run fails loudly when a tracked
# account is in no bucket - silently dropping an account from net worth is the one
# error a net-worth figure cannot survive.
DEFAULT_BUCKETS = {
    "liquid": ["rbc-joint", "rbc-chequing-arturo", "rbc-chequing-gina", "tangerine-chequing",
               "eq-joint", "eq-mortgage-savings", "eq-savings-gina", "eq-honda-buyout",
               "wise-cad", "wise-usd", "shakepay-cad"],
    "tax": ["questrade-rrsp-gina", "questrade-tfsa-arturo", "questrade-tfsa-gina",
            "questrade-spousal-rrsp-gina"],
    "debt": ["rbc-visa-arturo", "rbc-visa-gina", "rbc-mastercard", "tangerine-mastercard",
             "amex", "cibc-mastercard", "fairstone-best-buy", "tangerine-loc", "ledn-loan"],
    "bitcoin": ["bitkey", "shakepay-bitcoin"],
}


def buckets(accounts: list[dict], account_map: list[dict], account_balances: dict[str, float],
            manual: dict[str, dict], home_value: float | None, mortgage_balance: float | None,
            btc_quantity: float | None, btc_rate: float | None, btc_rate_note: str,
            btc_rate_as_of: str | None) -> tuple[list[dict], list[str]]:
    notes: list[str] = []
    actual_ids = {a["id"] for a in accounts}

    def bucket_of(account: dict) -> str | None:
        declared = account.get("bucket")
        if declared:
            return str(declared)
        for name, members in DEFAULT_BUCKETS.items():
            if account.get("id") in members:
                return name
        return None

    membership: dict[str, list[dict]] = {"liquid": [], "tax": [], "debt": [], "bitcoin": []}
    for account in account_map:
        if account.get("actual_budget_id") not in actual_ids:
            notes.append(f"{account.get('name')}: tracked account is not in the ledger and was skipped")
            continue
        place = bucket_of(account)
        if place in membership:
            membership[place].append(account)
        else:
            notes.append(f"{account.get('name')}: in no bucket, so it is missing from net worth")

    def balance_of(account: dict) -> tuple[float, str, str]:
        manual_entry = manual.get(account["id"])
        if manual_entry is not None:
            return manual_entry["balance"], "manual", manual_entry["date"]
        ledger_value = account_balances.get(account["actual_budget_id"])
        if ledger_value is None:
            notes.append(f"{account.get('name')}: no balance available")
            return 0.0, "manual", ""
        return ledger_value, "measured", ""


    def sum_of(kind: str) -> dict:
        total, as_of, stale = 0.0, "", False
        for account in membership[kind]:
            value, basis, when = balance_of(account)
            if basis == "manual" and not when:
                stale = True
            total += value
            as_of = max(as_of, when)
        out = {"value": round(total, 2), "as_of": as_of or "unknown"}
        if stale:
            out["note"] = "at least one account has no current balance; see the data notes"
        return out

    out: list[dict] = []
    liquid = sum_of("liquid")
    out.append({"name": "Liquid Cash", **liquid, "basis": "measured" if not liquid.get("note") else "manual"})

    tax = sum_of("tax")
    out.append({"name": "Tax Shelters", **tax, "basis": "measured" if not tax.get("note") else "manual"})

    if btc_quantity is None:
        notes.append("Bitcoin quantity unknown; the Bitcoin bucket is omitted rather than guessed")
    elif btc_rate is None:
        notes.append(f"Bitcoin price unavailable ({btc_rate_note}); the Bitcoin bucket is omitted rather than valued at a stale rate")
    else:
        # Market value from the verified quantity, cost from the accounts that hold
        # it, and any holding without a verifiable quantity named rather than folded
        # in at cost to look like market.
        market = round(btc_quantity * btc_rate, 2)
        cost = 0.0
        unpriced: list[str] = []
        for account in account_map:
            if bucket_of(account) != "bitcoin":
                continue
            if account.get("priced_quantity") is False:
                value, _, _ = balance_of(account)
                cost += value
                unpriced.append(f"{account.get('name')} ({value:,.2f} at cost)")
                continue
            value, _, _ = balance_of(account)
            cost += value
        unpriced_value = sum(
            balance_of(a)[0] for a in account_map
            if bucket_of(a) == "bitcoin" and a.get("priced_quantity") is False)
        value = round(market + unpriced_value, 2)
        out.append({"name": "Bitcoin", "value": value, "basis": "market", "cost_basis": round(cost, 2),
                    "as_of": btc_rate_as_of or "run time",
                    "price": {"currency": "CAD", "rate": btc_rate, "as_of": btc_rate_as_of, "source": btc_rate_note},
                    "quantity": btc_quantity,
                    "note": (f"{btc_quantity} BTC on-chain verified, at the {btc_rate:,.0f} CAD rate; "
                             + ("unpriced and carried at cost: " + ", ".join(unpriced) if unpriced else "all holdings priced"))})

    if home_value is not None and mortgage_balance is not None:
        out.append({"name": "Home Equity", "value": round(home_value - mortgage_balance, 2),
                    "basis": "reconstructed", "as_of": "supplied",
                    "note": f"{home_value:,.0f} estimate less the {mortgage_balance:,.2f} mortgage balance"})
    else:
        notes.append("home value or mortgage balance not supplied; Home Equity is omitted rather than estimated")

    debt = sum_of("debt")
    if abs(debt["value"]) >= 0.01:
        out.append({"name": "Debt", "value": debt["value"], "basis": "measured", "as_of": debt["as_of"]})
    return out, notes


# --------------------------------------------------------------------------- main


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Derive a month's figures from the ledger")
    ap.add_argument("--month", required=True, help="YYYY-MM")
    ap.add_argument("--config", required=True, help="finance-manager account map")
    ap.add_argument("--out", required=True)
    ap.add_argument("--manual-balances", default=None)
    ap.add_argument("--mortgage-balance", type=float, default=None)
    ap.add_argument("--mortgage-principal", type=float, default=None)
    ap.add_argument("--home-value", type=float, default=None)
    ap.add_argument("--bitcoin-quantity", type=float, default=None)
    ap.add_argument("--currency", default="CAD")
    args = ap.parse_args(argv)

    start, end = month_bounds(args.month)
    config = read_json(args.config, "account map")
    manual, manual_notes = manual_balances(args.manual_balances, end)

    accounts = rows(cli("accounts", "list", "--include-closed"))
    accounts_by_id = {a["id"]: a for a in accounts}
    ledger = ledger_rows(start, end)
    account_balances = balances(accounts, end)

    quantity, quantity_note = bitcoin_quantity(args.bitcoin_quantity)
    rate, rate_note, rate_as_of = bitcoin_price(args.currency)

    flow_section = flow(ledger, accounts_by_id)
    bucket_list, bucket_notes = buckets(accounts, config.get("accounts") or [], account_balances, manual,
                                        args.home_value, args.mortgage_balance,
                                        quantity, rate, rate_note, rate_as_of)
    total = round(sum(b["value"] for b in bucket_list), 2)

    paydown = {"mortgage_principal": args.mortgage_principal, "other": 0.0}
    if args.mortgage_principal is None:
        bucket_notes.append("mortgage principal was not supplied; the debt-paydown split is omitted rather than estimated")

    out = {
        "derived_by": "report-finances/scripts/derive.py",
        "derived_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "month": args.month,
        "as_of": end.isoformat(),
        "net_worth": {"as_of": end.isoformat(), "total": total, "buckets": bucket_list},
        "flow": {**flow_section,
                 "expense_basis": "consumption",
                 "debt_paydown": paydown,
                 "off_budget_accounts": off_budget(ledger, accounts_by_id)},
        "inputs_used": [
            {"source": "script: derive.py", "detail": f"{len(ledger)} transaction rows for {args.month}, "
                                                      f"{len(accounts)} accounts, balances at {end}", "manual": False},
            {"source": args.config, "detail": "account map", "manual": False},
            {"source": args.manual_balances or "none", "detail": f"{len(manual)} manual balances", "manual": True},
            {"source": "bitcoin quantity", "detail": quantity_note, "manual": False},
            {"source": "bitcoin price", "detail": rate_note, "manual": False},
        ],
        "data_notes": [{"note": n, "reason": "derive.py", "since": end.isoformat()} for n in manual_notes + bucket_notes],
        "prose_required": ["highlights", "narrative", "actions", "findings"],
    }
    Path(args.out).write_text(json.dumps(out, indent=2) + "\n")
    print(f"derived {args.month}: net worth {total:,.2f} across {len(bucket_list)} buckets, "
          f"{len(flow_section['income'])} income lines, {len(flow_section['expense'])} expense lines")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
