from __future__ import annotations

from collections import defaultdict
from data.models import LedgerEntry


def compute_ledger_analytics(
    entries: list[LedgerEntry],
    master_entries: list[LedgerEntry],
) -> list[dict]:
    """
    Per-ledger opening/movement/closing with audit flags.
    """
    master_map = {e.ledger: e for e in master_entries}

    ledger_dr: dict[str, float] = defaultdict(float)
    ledger_cr: dict[str, float] = defaultdict(float)
    ledger_txn_count: dict[str, int] = defaultdict(int)
    ledger_meta: dict[str, dict] = {}

    for e in entries:
        if e.is_master_ledger:
            continue
        ledger_dr[e.ledger] += abs(e.amount) if e.amount < 0 else 0.0
        ledger_cr[e.ledger] += e.amount if e.amount > 0 else 0.0
        ledger_txn_count[e.ledger] += 1
        ledger_meta[e.ledger] = {"primary": e.tally_primary, "parent": e.tally_parent, "is_revenue": e.is_revenue}

    all_ledgers = sorted(set(list(ledger_meta.keys()) + list(master_map.keys())))
    rows = []
    for ledger in all_ledgers:
        me = master_map.get(ledger)
        meta = ledger_meta.get(ledger, {})
        opening = me.opening_balance if me else 0.0
        closing = me.closing_balance if me else 0.0
        during_dr = round(ledger_dr.get(ledger, 0.0), 2)
        during_cr = round(ledger_cr.get(ledger, 0.0), 2)
        expected_closing = opening + during_cr - during_dr
        recon_diff = round(closing - expected_closing, 2)

        flags = []
        if abs(recon_diff) > 0.5:
            flags.append("RECON_DIFF")
        if ledger_txn_count.get(ledger, 0) == 0:
            flags.append("NO_MOVEMENT")
        if closing > 0 and meta.get("is_revenue"):
            flags.append("CREDIT_BALANCE_INCOME")

        rows.append({
            "ledger": ledger,
            "primary": meta.get("primary", ""),
            "parent": meta.get("parent", ""),
            "opening_dr": max(0.0, -opening),
            "opening_cr": max(0.0, opening),
            "during_dr": during_dr,
            "during_cr": during_cr,
            "closing_dr": max(0.0, -closing),
            "closing_cr": max(0.0, closing),
            "recon_diff": recon_diff,
            "txn_count": ledger_txn_count.get(ledger, 0),
            "flags": ", ".join(flags),
        })
    return rows
