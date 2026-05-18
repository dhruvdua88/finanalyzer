from __future__ import annotations

from collections import defaultdict
from data.models import LedgerEntry, AuditSettings


def compute_exception_heatmap(
    entries: list[LedgerEntry],
    settings: AuditSettings,
) -> dict:
    """
    Returns:
      {
        "exception_types": [str],
        "ledgers": [str],
        "months": [str],
        "matrix": {ledger: {month: {exception_type: count}}}
      }
    """
    gst_set = {l.lower() for l in settings.sales_gst_ledgers + settings.purchase_gst_ledgers}

    # Group by voucher
    from collections import defaultdict
    voucher_map: dict[str, list[LedgerEntry]] = defaultdict(list)
    for e in entries:
        if not e.is_master_ledger:
            voucher_map[e.voucher_number].append(e)

    # Seen invoice numbers per party (for duplicate detection)
    seen_invoices: dict[str, set[str]] = defaultdict(set)
    dup_invoices: set[tuple] = set()
    for vn, legs in voucher_map.items():
        for e in legs:
            if e.invoice_number and e.party_name:
                key = (e.party_name.lower(), e.invoice_number.lower())
                if key in seen_invoices:
                    dup_invoices.add(key)
                seen_invoices[key].add(vn)

    matrix: dict[str, dict[str, dict[str, int]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(int))
    )
    all_months: set[str] = set()
    all_ledgers: set[str] = set()

    for vn, legs in voucher_map.items():
        if not legs:
            continue
        vdate = min((e.date for e in legs if e.date), default="")
        if not vdate:
            continue
        y, m = int(vdate[:4]), int(vdate[5:7])
        month_str = f"{_MONTHS[m-1]}-{y}"
        all_months.add(month_str)

        total_dr = sum(abs(e.amount) for e in legs if e.amount < 0)
        total_cr = sum(e.amount for e in legs if e.amount > 0)

        exceptions = []
        if abs(total_dr - total_cr) > 0.01:
            exceptions.append("UNBALANCED")
        all_pos = all(e.amount >= 0 for e in legs)
        all_neg = all(e.amount <= 0 for e in legs)
        if all_pos or all_neg:
            exceptions.append("SINGLE_SIDED")
        if not all(e.party_name for e in legs if e.voucher_type.lower() in {"sales", "purchase"}):
            exceptions.append("MISSING_PARTY")
        for e in legs:
            if e.ledger.lower() in gst_set and not e.gstin:
                exceptions.append("GST_NO_GSTIN")
                break
        for e in legs:
            if e.invoice_number and e.party_name:
                key = (e.party_name.lower(), e.invoice_number.lower())
                if key in dup_invoices:
                    exceptions.append("DUPLICATE_INVOICE")
                    break

        for ledger in {e.ledger for e in legs}:
            all_ledgers.add(ledger)
            for exc in exceptions:
                matrix[ledger][month_str][exc] += 1

    from app.constants import FY_MONTH_ORDER
    sorted_months = sorted(
        all_months,
        key=lambda s: (int(s.split("-")[1]), FY_MONTH_ORDER.get(s.split("-")[0], 0)),
    )

    return {
        "exception_types": ["UNBALANCED", "SINGLE_SIDED", "MISSING_PARTY", "GST_NO_GSTIN", "DUPLICATE_INVOICE"],
        "ledgers": sorted(all_ledgers),
        "months": sorted_months,
        "matrix": dict(matrix),
    }


_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
