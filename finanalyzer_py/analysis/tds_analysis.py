from __future__ import annotations

from collections import defaultdict
from data.models import LedgerEntry, AuditSettings
from app.constants import TDS_SECTION_DEFAULTS


_SECTION_MAP = {s["code"]: s for s in TDS_SECTION_DEFAULTS}


def compute_tds(
    entries: list[LedgerEntry],
    settings: AuditSettings,
) -> list[dict]:
    """
    Port of tdsWorker.ts computeTdsGroups.

    For each voucher that touches a TDS ledger:
      - Find the expense leg amount and TDS leg amount
      - Resolve section from settings.tds_section_mappings
      - Compute YTD accumulation per (party, section) in date order
      - Classify status: deducted / short_deducted / missed / below_threshold

    Returns list of row dicts with 20 columns matching TDSAnalysis.tsx export.
    """
    tds_ledger_set = {l.lower() for l in settings.tds_tax_ledgers}
    if not tds_ledger_set:
        return []

    # Build ledger→section mapping
    ledger_section: dict[str, dict] = {}
    for m in settings.tds_section_mappings:
        sec = _SECTION_MAP.get(m.section_code, {})
        ledger_section[m.ledger_name.lower()] = {
            "code": m.section_code,
            "label": sec.get("label", m.section_code),
            "singleTxnLimit": sec.get("singleTxnLimit"),
            "annualLimit": sec.get("annualLimit"),
            "defaultRate": m.custom_rate if m.custom_rate is not None else sec.get("defaultRate", 0.0),
        }

    # Group entries by voucher_number
    voucher_map: dict[str, list[LedgerEntry]] = defaultdict(list)
    for e in entries:
        if not e.is_master_ledger:
            voucher_map[e.voucher_number].append(e)

    # YTD tracker: (party, section_code) → cumulative expense amount
    party_ytd: dict[tuple[str, str], float] = defaultdict(float)

    # Sort vouchers by date
    voucher_keys = sorted(
        voucher_map.keys(),
        key=lambda vn: min((e.date for e in voucher_map[vn] if e.date), default=""),
    )

    rows = []
    for vn in voucher_keys:
        legs = voucher_map[vn]
        tds_legs = [e for e in legs if e.ledger.lower() in tds_ledger_set]
        if not tds_legs:
            continue

        # Identify the expense/income leg (non-TDS legs)
        expense_legs = [e for e in legs if e.ledger.lower() not in tds_ledger_set]

        # Find representative expense ledger and amount
        expense_ledger = ""
        expense_amount = 0.0
        for el in expense_legs:
            if abs(el.amount) > abs(expense_amount):
                expense_amount = el.amount
                expense_ledger = el.ledger

        # Net TDS amount (absolute)
        tds_amount = sum(abs(e.amount) for e in tds_legs)
        tds_ledger_names = ", ".join(sorted({e.ledger for e in tds_legs}))

        # Resolve section from first TDS ledger
        tds_ledger_key = tds_legs[0].ledger.lower()
        section_info = ledger_section.get(tds_ledger_key, {})
        section_code = section_info.get("code", "")
        single_limit = section_info.get("singleTxnLimit")
        annual_limit = section_info.get("annualLimit")
        expected_rate = section_info.get("defaultRate", 0.0)

        # Representative voucher metadata
        first = legs[0]
        voucher_date = min((e.date for e in legs if e.date), default="")
        party = first.party_name

        # YTD
        ytd_key = (party.lower(), section_code)
        ytd_before = party_ytd[ytd_key]
        party_ytd[ytd_key] += abs(expense_amount)
        ytd_after = party_ytd[ytd_key]

        # Threshold check
        single_crossed = single_limit is not None and abs(expense_amount) >= single_limit
        annual_crossed = annual_limit is not None and ytd_after >= annual_limit
        threshold_crossed = single_crossed or annual_crossed

        # Applied rate
        applied_rate = (tds_amount / abs(expense_amount) * 100) if abs(expense_amount) > 0.001 else 0.0

        # Status classification
        status = _classify_status(
            tds_amount, abs(expense_amount), applied_rate, expected_rate,
            threshold_crossed, single_limit, annual_limit, ytd_before, ytd_after,
        )

        # Rate deviation and shortfall
        rate_deviation = round(applied_rate - expected_rate, 4)
        shortfall = round(max(0.0, abs(expense_amount) * expected_rate / 100 - tds_amount), 2)

        annotation = settings.tds_annotations.get(first.guid, "")

        rows.append({
            "ledger": expense_ledger,
            "date": voucher_date,
            "voucher_type": first.voucher_type,
            "voucher_number": vn,
            "party_name": party,
            "expense_ledger": expense_ledger,
            "ledger_hit": round(abs(expense_amount), 2),
            "status": status,
            "tds_deducted": round(tds_amount, 2),
            "applied_rate": round(applied_rate, 4),
            "expected_rate": round(expected_rate, 4),
            "rate_deviation": rate_deviation,
            "shortfall": shortfall,
            "section": section_code,
            "party_ytd_before": round(ytd_before, 2),
            "party_ytd_after": round(ytd_after, 2),
            "threshold_crossed": "Yes" if threshold_crossed else "No",
            "tds_ledgers": tds_ledger_names,
            "narration": first.narration,
            "audit_note": annotation,
        })

    return rows


def _classify_status(
    tds_amount: float,
    expense_amount: float,
    applied_rate: float,
    expected_rate: float,
    threshold_crossed: bool,
    single_limit,
    annual_limit,
    ytd_before: float,
    ytd_after: float,
) -> str:
    if not threshold_crossed and tds_amount < 0.01:
        return "Below Threshold"
    if tds_amount < 0.01:
        return "Missed"
    if expected_rate > 0 and applied_rate < expected_rate - 0.01:
        return "Short Deducted"
    return "Deducted"
