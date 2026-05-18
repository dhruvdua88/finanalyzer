from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime

from app.constants import AGE_BUCKETS, TALLY_DEBTOR_KEYWORDS, TALLY_CREDITOR_KEYWORDS
from data.models import LedgerEntry


def _parse_date(d: str) -> date:
    return datetime.strptime(d, "%Y-%m-%d").date()


def _age_days(inv_date: str, as_of: date) -> int:
    try:
        return (as_of - _parse_date(inv_date)).days
    except Exception:
        return 0


def _bucket_index(days: int) -> int:
    for i, (lo, hi) in enumerate(AGE_BUCKETS):
        if hi is None or days <= hi:
            return i
    return len(AGE_BUCKETS) - 1


def compute_ageing(
    entries: list[LedgerEntry],
    mode: str = "debtor",  # "debtor" or "creditor"
    as_of_str: str = "",
) -> dict:
    """
    FIFO ageing for Sundry Debtors or Creditors.
    Returns:
      {
        "as_of": str,
        "parties": [
          {
            "party": str,
            "opening_dr": float, "opening_cr": float,
            "fifo_receivable": float, "fifo_advance": float,
            "net_fifo": float,
            "closing_dr": float, "closing_cr": float,
            "invoice_count": int,
            "buckets": [float * 6],
            "invoices": [{"party", "voucher_number", "invoice_date", "age_days", "bucket_label",
                          "original_amount", "outstanding", "remarks"}]
          }
        ],
        "recon": [{"check", "fifo_value", "ledger_value", "difference", "status"}]
      }
    """
    keywords = TALLY_DEBTOR_KEYWORDS if mode == "debtor" else TALLY_CREDITOR_KEYWORDS

    # Filter to debtors/creditors only
    party_entries: dict[str, list[LedgerEntry]] = defaultdict(list)
    master_map: dict[str, LedgerEntry] = {}

    for e in entries:
        if any(kw in e.tally_primary.lower() for kw in keywords):
            if e.is_master_ledger:
                master_map[e.ledger] = e
            else:
                party_entries[e.ledger].append(e)

    # Determine as_of date
    all_dates = [e.date for group in party_entries.values() for e in group if e.date]
    if as_of_str:
        as_of = _parse_date(as_of_str)
    elif all_dates:
        as_of = _parse_date(max(all_dates))
    else:
        as_of = date.today()

    parties_result = []

    for party_name, p_entries in sorted(party_entries.items()):
        p_entries_sorted = sorted(p_entries, key=lambda e: (e.date, e.voucher_number))

        # Split into invoices (Dr for debtor = positive amount for debtor ledger)
        # Debtor: Dr = invoice (amount > 0 in Tally means Cr for the company = Dr for debtor)
        # Convention: +amount = Credit, -amount = Debit in LedgerEntry
        # For debtor: when debtor is debited (invoice), entry.amount < 0 (Dr)
        # For debtor: when debtor is credited (receipt), entry.amount > 0 (Cr)
        if mode == "debtor":
            invoices = sorted(
                [e for e in p_entries_sorted if e.amount < 0],
                key=lambda e: e.date,
            )
            receipts = sorted(
                [e for e in p_entries_sorted if e.amount >= 0],
                key=lambda e: e.date,
            )
        else:  # creditor
            invoices = sorted(
                [e for e in p_entries_sorted if e.amount > 0],
                key=lambda e: e.date,
            )
            receipts = sorted(
                [e for e in p_entries_sorted if e.amount <= 0],
                key=lambda e: e.date,
            )

        # FIFO knock-off
        outstanding: list[dict] = [
            {
                "voucher_number": e.voucher_number,
                "invoice_date": e.date,
                "original": abs(e.amount),
                "remaining": abs(e.amount),
            }
            for e in invoices
        ]

        for receipt in receipts:
            receipt_amt = abs(receipt.amount)
            for inv in outstanding:
                if inv["remaining"] <= 0 or receipt_amt <= 0:
                    continue
                apply = min(inv["remaining"], receipt_amt)
                inv["remaining"] -= apply
                receipt_amt -= apply

        # Compute advance (excess receipts not knocked off)
        total_receipts = sum(abs(r.amount) for r in receipts)
        total_invoices = sum(abs(i.amount) for i in invoices)
        fifo_receivable = round(sum(inv["remaining"] for inv in outstanding), 2)
        fifo_advance = round(max(0.0, total_receipts - (total_invoices - fifo_receivable)), 2)

        # Age remaining outstanding
        buckets = [0.0] * len(AGE_BUCKETS)
        invoice_rows = []
        for inv in outstanding:
            if inv["remaining"] > 0.005:
                days = _age_days(inv["invoice_date"], as_of)
                bi = _bucket_index(days)
                buckets[bi] += inv["remaining"]
                from app.constants import AGE_BUCKET_LABELS
                invoice_rows.append({
                    "party": party_name,
                    "voucher_number": inv["voucher_number"],
                    "invoice_date": inv["invoice_date"],
                    "age_days": days,
                    "bucket_label": AGE_BUCKET_LABELS[bi],
                    "original_amount": round(inv["original"], 2),
                    "outstanding": round(inv["remaining"], 2),
                    "remarks": "",
                })

        # Add advance row if applicable
        if fifo_advance > 0.005:
            invoice_rows.append({
                "party": party_name,
                "voucher_number": "",
                "invoice_date": "",
                "age_days": 0,
                "bucket_label": "Advance",
                "original_amount": 0.0,
                "outstanding": -fifo_advance,
                "remarks": f"Advance ₹{fifo_advance:,.2f}",
            })

        me = master_map.get(party_name)
        closing_bal = me.closing_balance if me else 0.0
        opening_bal = me.opening_balance if me else 0.0

        parties_result.append({
            "party": party_name,
            "opening_dr": max(0.0, -opening_bal),
            "opening_cr": max(0.0, opening_bal),
            "closing_dr": max(0.0, -closing_bal),
            "closing_cr": max(0.0, closing_bal),
            "fifo_receivable": fifo_receivable,
            "fifo_advance": fifo_advance,
            "net_fifo": round(fifo_receivable - fifo_advance, 2),
            "invoice_count": len([inv for inv in outstanding if inv["remaining"] > 0]),
            "buckets": [round(b, 2) for b in buckets],
            "invoices": invoice_rows,
        })

    # Reconciliation block
    total_fifo_dr = sum(p["fifo_receivable"] for p in parties_result)
    total_fifo_cr = sum(p["fifo_advance"] for p in parties_result)
    total_ledger_dr = sum(p["closing_dr"] for p in parties_result)
    total_ledger_cr = sum(p["closing_cr"] for p in parties_result)
    TOL = 0.5
    recon = [
        _rline("Receivable (Dr)", total_fifo_dr, total_ledger_dr, TOL),
        _rline("Advance (Cr)", total_fifo_cr, total_ledger_cr, TOL),
        _rline("Net FIFO (Dr-Cr)", total_fifo_dr - total_fifo_cr,
               total_ledger_dr - total_ledger_cr, TOL),
    ]

    return {
        "mode": mode,
        "as_of": as_of.isoformat(),
        "parties": parties_result,
        "recon": recon,
    }


def _rline(check: str, fifo: float, ledger: float, tol: float) -> dict:
    diff = round(fifo - ledger, 2)
    return {
        "check": check,
        "fifo_value": round(fifo, 2),
        "ledger_value": round(ledger, 2),
        "difference": diff,
        "status": "PASS" if abs(diff) <= tol else "REVIEW",
    }
