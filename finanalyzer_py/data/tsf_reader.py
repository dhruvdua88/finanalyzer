from __future__ import annotations

import sqlite3
from pathlib import Path

from data.models import LedgerEntry


def read_tsf(tsf_path: str | Path) -> tuple[list[LedgerEntry], list[LedgerEntry]]:
    """
    Read a TSF SQLite file and return (transaction_entries, master_entries).

    TSF schema (ledger_entries table):
      guid, date, voucher_type, voucher_number, invoice_number, reference_number,
      narration, party_name, gstin, ledger, amount, group_name, opening_balance,
      closing_balance, tally_parent, tally_primary, is_revenue,
      is_accounting_voucher, is_master_ledger
    """
    con = sqlite3.connect(str(tsf_path))
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            "SELECT * FROM ledger_entries ORDER BY date, voucher_number, rowid"
        ).fetchall()
    finally:
        con.close()

    tx: list[LedgerEntry] = []
    master: list[LedgerEntry] = []
    for r in rows:
        entry = _row_to_entry(r)
        if entry.is_master_ledger:
            master.append(entry)
        else:
            tx.append(entry)
    return tx, master


def _row_to_entry(r: sqlite3.Row) -> LedgerEntry:
    return LedgerEntry(
        guid=r["guid"] or "",
        date=r["date"] or "",
        voucher_type=r["voucher_type"] or "",
        voucher_number=r["voucher_number"] or "",
        invoice_number=r["invoice_number"] or "",
        reference_number=r["reference_number"] or "",
        narration=r["narration"] or "",
        party_name=r["party_name"] or "",
        gstin=r["gstin"] or "",
        ledger=r["ledger"] or "",
        amount=float(r["amount"] or 0),
        group_name=r["group_name"] or "",
        opening_balance=float(r["opening_balance"] or 0),
        closing_balance=float(r["closing_balance"] or 0),
        tally_parent=r["tally_parent"] or "",
        tally_primary=r["tally_primary"] or "",
        is_revenue=int(r["is_revenue"] or 0),
        is_accounting_voucher=int(r["is_accounting_voucher"] or 0),
        is_master_ledger=int(r["is_master_ledger"] or 0),
    )


def get_all_ledger_names(tsf_path: str | Path) -> list[str]:
    """Return distinct ledger names from a TSF file (for UI selectors)."""
    con = sqlite3.connect(str(tsf_path))
    try:
        rows = con.execute(
            "SELECT DISTINCT ledger FROM ledger_entries WHERE ledger <> '' ORDER BY ledger"
        ).fetchall()
        return [r[0] for r in rows]
    finally:
        con.close()
