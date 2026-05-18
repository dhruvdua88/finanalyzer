from __future__ import annotations

from collections import defaultdict
from data.models import LedgerEntry


def compute_voucher_book(
    entries: list[LedgerEntry],
    voucher_types: list[str] | None = None,
    from_date: str = "",
    to_date: str = "",
) -> list[dict]:
    """
    Group entries by voucher_number, return one row per voucher with
    total_dr, total_cr, narration, party, date.
    """
    if voucher_types:
        vt_set = {v.lower() for v in voucher_types}
        entries = [e for e in entries if e.voucher_type.lower() in vt_set]
    if from_date:
        entries = [e for e in entries if e.date >= from_date]
    if to_date:
        entries = [e for e in entries if e.date <= to_date]

    vouchers: dict[str, dict] = {}
    dr_map: dict[str, float] = defaultdict(float)
    cr_map: dict[str, float] = defaultdict(float)

    for e in entries:
        vn = e.voucher_number
        if vn not in vouchers:
            vouchers[vn] = {
                "date": e.date,
                "voucher_number": vn,
                "voucher_type": e.voucher_type,
                "party_name": e.party_name,
                "narration": e.narration,
            }
        if e.amount < 0:
            dr_map[vn] += abs(e.amount)
        else:
            cr_map[vn] += e.amount

    rows = []
    for vn, meta in vouchers.items():
        rows.append({
            **meta,
            "total_dr": round(dr_map[vn], 2),
            "total_cr": round(cr_map[vn], 2),
        })

    rows.sort(key=lambda r: (r["date"], r["voucher_number"]))
    return rows
