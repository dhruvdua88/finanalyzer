from __future__ import annotations

from data.models import LedgerEntry


def compute_ledger_statement(
    entries: list[LedgerEntry],
    ledger_name: str,
    from_date: str = "",
    to_date: str = "",
) -> dict:
    """
    Single-ledger running balance statement.
    Returns {"opening": float, "rows": [...], "closing": float}
    """
    ledger_entries = [
        e for e in entries
        if e.ledger.lower() == ledger_name.lower()
        and not e.is_master_ledger
    ]
    if from_date:
        ledger_entries = [e for e in ledger_entries if e.date >= from_date]
    if to_date:
        ledger_entries = [e for e in ledger_entries if e.date <= to_date]
    ledger_entries.sort(key=lambda e: (e.date, e.voucher_number))

    # Opening balance from master or first transaction's opening_balance
    opening = 0.0
    for e in entries:
        if e.ledger.lower() == ledger_name.lower() and e.is_master_ledger:
            opening = e.opening_balance
            break

    running = opening
    rows = []
    for e in ledger_entries:
        debit = abs(e.amount) if e.amount < 0 else 0.0
        credit = e.amount if e.amount > 0 else 0.0
        running += credit - debit
        rows.append({
            "date": e.date,
            "voucher_type": e.voucher_type,
            "voucher_number": e.voucher_number,
            "party_name": e.party_name,
            "narration": e.narration,
            "debit": round(debit, 2),
            "credit": round(credit, 2),
            "balance": round(running, 2),
        })

    return {"ledger": ledger_name, "opening": round(opening, 2),
            "rows": rows, "closing": round(running, 2)}
