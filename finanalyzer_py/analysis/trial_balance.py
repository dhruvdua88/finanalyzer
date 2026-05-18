from __future__ import annotations

from collections import defaultdict
from data.models import LedgerEntry


def compute_trial_balance(
    entries: list[LedgerEntry],
    master_entries: list[LedgerEntry],
) -> dict:
    """
    Returns:
      {
        "groups": [{"primary": str, "parent": str, "opening_dr": float, "opening_cr": float,
                    "during_dr": float, "during_cr": float, "closing_dr": float, "closing_cr": float}],
        "ledgers": [{"ledger": str, "primary": str, "parent": str, ...same amounts...}]
      }
    """
    # Aggregate transaction amounts per ledger
    ledger_during: dict[str, dict[str, float]] = defaultdict(lambda: {"dr": 0.0, "cr": 0.0})
    ledger_meta: dict[str, dict] = {}

    for e in entries:
        if e.is_master_ledger:
            continue
        key = e.ledger
        if e.amount < 0:
            ledger_during[key]["dr"] += abs(e.amount)
        else:
            ledger_during[key]["cr"] += e.amount
        ledger_meta[key] = {
            "primary": e.tally_primary,
            "parent": e.tally_parent,
        }

    # Collect opening/closing from master entries
    master_map: dict[str, LedgerEntry] = {e.ledger: e for e in master_entries}

    # Also pick opening/closing from tx entries (first occurrence per ledger)
    for e in entries:
        if e.ledger not in master_map and not e.is_master_ledger:
            master_map.setdefault(e.ledger, e)

    all_ledgers = sorted(set(list(ledger_during.keys()) + list(master_map.keys())))

    ledger_rows = []
    for ledger in all_ledgers:
        me = master_map.get(ledger)
        primary = ledger_meta.get(ledger, {}).get("primary", "") or (me.tally_primary if me else "")
        parent = ledger_meta.get(ledger, {}).get("parent", "") or (me.tally_parent if me else "")
        opening = me.opening_balance if me else 0.0
        closing = me.closing_balance if me else 0.0
        during = ledger_during.get(ledger, {"dr": 0.0, "cr": 0.0})
        ledger_rows.append({
            "ledger": ledger,
            "primary": primary,
            "parent": parent,
            "opening_dr": max(0.0, -opening),
            "opening_cr": max(0.0, opening),
            "during_dr": during["dr"],
            "during_cr": during["cr"],
            "closing_dr": max(0.0, -closing),
            "closing_cr": max(0.0, closing),
        })

    # Roll up to primary groups
    group_map: dict[str, dict[str, float]] = defaultdict(
        lambda: {"opening_dr": 0.0, "opening_cr": 0.0, "during_dr": 0.0,
                 "during_cr": 0.0, "closing_dr": 0.0, "closing_cr": 0.0}
    )
    group_parent: dict[str, str] = {}
    for r in ledger_rows:
        g = r["primary"] or r["parent"] or "Unclassified"
        group_map[g]["opening_dr"] += r["opening_dr"]
        group_map[g]["opening_cr"] += r["opening_cr"]
        group_map[g]["during_dr"] += r["during_dr"]
        group_map[g]["during_cr"] += r["during_cr"]
        group_map[g]["closing_dr"] += r["closing_dr"]
        group_map[g]["closing_cr"] += r["closing_cr"]
        group_parent[g] = r["parent"]

    group_rows = [
        {"primary": g, "parent": group_parent.get(g, ""), **v}
        for g, v in sorted(group_map.items())
    ]

    return {"groups": group_rows, "ledgers": ledger_rows}
