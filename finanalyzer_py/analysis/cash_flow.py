from __future__ import annotations

from collections import defaultdict
from data.models import LedgerEntry


def compute_cash_flow(
    entries: list[LedgerEntry],
    master_entries: list[LedgerEntry],
) -> list[dict]:
    """
    Cash pool (bank + cash ledgers) opening / inflow / outflow / closing per ledger.
    """
    CASH_KEYWORDS = {"bank accounts", "bank account", "cash-in-hand", "cash in hand"}

    cash_ledgers = {
        e.ledger for e in entries + master_entries
        if any(kw in e.tally_primary.lower() for kw in CASH_KEYWORDS)
    }

    master_map = {e.ledger: e for e in master_entries}
    inflow: dict[str, float] = defaultdict(float)
    outflow: dict[str, float] = defaultdict(float)

    for e in entries:
        if e.ledger not in cash_ledgers or e.is_master_ledger:
            continue
        if e.amount > 0:
            inflow[e.ledger] += e.amount
        else:
            outflow[e.ledger] += abs(e.amount)

    rows = []
    for ledger in sorted(cash_ledgers):
        me = master_map.get(ledger)
        opening = me.opening_balance if me else 0.0
        closing = me.closing_balance if me else 0.0
        rows.append({
            "ledger": ledger,
            "opening": round(opening, 2),
            "inflow": round(inflow.get(ledger, 0.0), 2),
            "outflow": round(outflow.get(ledger, 0.0), 2),
            "closing": round(closing, 2),
            "net": round(closing - opening, 2),
        })
    return rows
