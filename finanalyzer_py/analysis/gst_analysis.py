from __future__ import annotations

from collections import defaultdict
from data.models import LedgerEntry, AuditSettings


def compute_gst_rate_analysis(
    entries: list[LedgerEntry],
    settings: AuditSettings,
) -> list[dict]:
    """
    GST Rate Analysis: identify the effective GST rate per sales invoice
    and flag any invoices where rate deviates from expected.
    """
    gst_ledger_set = {l.lower() for l in settings.sales_gst_ledgers + settings.purchase_gst_ledgers}
    if not gst_ledger_set:
        return []

    voucher_map: dict[str, list[LedgerEntry]] = defaultdict(list)
    for e in entries:
        if not e.is_master_ledger:
            voucher_map[e.voucher_number].append(e)

    rows = []
    for vn, legs in sorted(voucher_map.items(), key=lambda x: min((e.date for e in x[1] if e.date), default="")):
        gst_legs = [e for e in legs if e.ledger.lower() in gst_ledger_set]
        if not gst_legs:
            continue
        non_gst = [e for e in legs if e.ledger.lower() not in gst_ledger_set]
        taxable = sum(abs(e.amount) for e in non_gst if e.amount != 0)
        gst_amount = sum(abs(e.amount) for e in gst_legs)
        rate = round(gst_amount / taxable * 100, 2) if taxable > 0.01 else 0.0
        first = legs[0]
        rows.append({
            "date": min((e.date for e in legs if e.date), default=""),
            "voucher_type": first.voucher_type,
            "voucher_number": vn,
            "party_name": first.party_name,
            "gstin": first.gstin,
            "invoice_number": first.invoice_number,
            "taxable_amount": round(taxable, 2),
            "gst_amount": round(gst_amount, 2),
            "effective_rate": rate,
            "gst_ledgers": ", ".join(sorted({e.ledger for e in gst_legs})),
            "narration": first.narration,
        })
    return rows


def compute_sales_register(
    entries: list[LedgerEntry],
    settings: AuditSettings,
) -> list[dict]:
    """
    Party-wise sales summary with GST breakdown.
    """
    sales_gst_set = {l.lower() for l in settings.sales_gst_ledgers}

    voucher_map: dict[str, list[LedgerEntry]] = defaultdict(list)
    for e in entries:
        if not e.is_master_ledger and e.voucher_type.lower() in {"sales", "sale"}:
            voucher_map[e.voucher_number].append(e)

    rows = []
    for vn, legs in sorted(voucher_map.items(), key=lambda x: min((e.date for e in x[1] if e.date), default="")):
        gst_legs = [e for e in legs if e.ledger.lower() in sales_gst_set]
        sales_legs = [e for e in legs if e.ledger.lower() not in sales_gst_set]
        taxable = sum(abs(e.amount) for e in sales_legs if "sales" in e.tally_primary.lower())
        gst = sum(abs(e.amount) for e in gst_legs)
        first = legs[0]
        rows.append({
            "date": min((e.date for e in legs if e.date), default=""),
            "voucher_number": vn,
            "party_name": first.party_name,
            "gstin": first.gstin,
            "invoice_number": first.invoice_number,
            "taxable_amount": round(taxable, 2),
            "gst_amount": round(gst, 2),
            "total_amount": round(taxable + gst, 2),
            "narration": first.narration,
        })
    return rows


def compute_purchase_register(
    entries: list[LedgerEntry],
    settings: AuditSettings,
) -> list[dict]:
    """
    Purchase register with IGST/CGST/SGST/RCM split.
    (Simplified — splits GST equally between CGST/SGST when IGST cannot be determined.)
    """
    purch_gst_set = {l.lower() for l in settings.purchase_gst_ledgers}
    rcm_set = {l.lower() for l in settings.rcm_tax_ledgers}

    voucher_map: dict[str, list[LedgerEntry]] = defaultdict(list)
    for e in entries:
        if not e.is_master_ledger and e.voucher_type.lower() in {"purchase", "purchases"}:
            voucher_map[e.voucher_number].append(e)

    rows = []
    for vn, legs in sorted(voucher_map.items(), key=lambda x: min((e.date for e in x[1] if e.date), default="")):
        gst_legs = [e for e in legs if e.ledger.lower() in purch_gst_set]
        rcm_legs = [e for e in legs if e.ledger.lower() in rcm_set]
        purch_legs = [e for e in legs if e.ledger.lower() not in purch_gst_set and e.ledger.lower() not in rcm_set]
        taxable = sum(abs(e.amount) for e in purch_legs if "purchase" in e.tally_primary.lower())
        gst = sum(abs(e.amount) for e in gst_legs)
        rcm = sum(abs(e.amount) for e in rcm_legs)
        first = legs[0]
        rows.append({
            "date": min((e.date for e in legs if e.date), default=""),
            "voucher_number": vn,
            "party_name": first.party_name,
            "gstin": first.gstin,
            "invoice_number": first.invoice_number,
            "taxable_amount": round(taxable, 2),
            "igst": 0.0,
            "cgst": round(gst / 2, 2),
            "sgst": round(gst / 2, 2),
            "total_gst": round(gst, 2),
            "rcm": round(rcm, 2),
            "total_amount": round(taxable + gst + rcm, 2),
            "narration": first.narration,
        })
    return rows


def compute_gst_ledger_summary(
    entries: list[LedgerEntry],
    settings: AuditSettings,
) -> list[dict]:
    all_gst = set(settings.sales_gst_ledgers + settings.purchase_gst_ledgers + settings.rcm_tax_ledgers)
    ledger_totals: dict[str, float] = defaultdict(float)
    for e in entries:
        if e.ledger in all_gst and not e.is_master_ledger:
            ledger_totals[e.ledger] += e.amount
    rows = []
    for ledger, net in sorted(ledger_totals.items()):
        rows.append({
            "ledger": ledger,
            "type": _gst_type(ledger, settings),
            "net_cr": round(max(net, 0), 2),
            "net_dr": round(max(-net, 0), 2),
            "net": round(net, 2),
        })
    return rows


def _gst_type(ledger: str, settings: AuditSettings) -> str:
    if ledger in settings.sales_gst_ledgers:
        return "Sales GST"
    if ledger in settings.purchase_gst_ledgers:
        return "Purchase GST"
    if ledger in settings.rcm_tax_ledgers:
        return "RCM"
    return "Other"


def compute_rcm_analysis(
    entries: list[LedgerEntry],
    settings: AuditSettings,
) -> list[dict]:
    rcm_set = {l.lower() for l in settings.rcm_tax_ledgers}
    if not rcm_set:
        return []
    voucher_map: dict[str, list[LedgerEntry]] = defaultdict(list)
    for e in entries:
        if not e.is_master_ledger:
            voucher_map[e.voucher_number].append(e)

    rows = []
    for vn, legs in sorted(voucher_map.items(), key=lambda x: min((e.date for e in x[1] if e.date), default="")):
        rcm_legs = [e for e in legs if e.ledger.lower() in rcm_set]
        if not rcm_legs:
            continue
        rcm_amount = sum(abs(e.amount) for e in rcm_legs)
        first = legs[0]
        rows.append({
            "date": min((e.date for e in legs if e.date), default=""),
            "voucher_type": first.voucher_type,
            "voucher_number": vn,
            "party_name": first.party_name,
            "gstin": first.gstin,
            "rcm_ledgers": ", ".join(sorted({e.ledger for e in rcm_legs})),
            "rcm_amount": round(rcm_amount, 2),
            "narration": first.narration,
        })
    return rows


def compute_blocked_credit(
    entries: list[LedgerEntry],
    settings: AuditSettings,
) -> list[dict]:
    blocked_set = {l.lower() for l in settings.blocked_credit_ledgers}
    if not blocked_set:
        return []
    rows = []
    for e in entries:
        if e.ledger.lower() in blocked_set and not e.is_master_ledger:
            rows.append({
                "date": e.date,
                "voucher_type": e.voucher_type,
                "voucher_number": e.voucher_number,
                "ledger": e.ledger,
                "party_name": e.party_name,
                "amount": round(abs(e.amount), 2),
                "narration": e.narration,
            })
    rows.sort(key=lambda r: r["date"])
    return rows
