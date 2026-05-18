from __future__ import annotations

from collections import defaultdict
from data.models import LedgerEntry, AuditSettings


def compute_gstr2b_reco(
    books_entries: list[LedgerEntry],
    gstr2b_rows: list[dict],
    settings: AuditSettings,
) -> dict:
    """
    GSTR-2B reconciliation (simplified 4-pass matching).
    Returns summary and detail rows.
    """
    purch_gst_set = {l.lower() for l in settings.purchase_gst_ledgers}

    # Build books rows from purchase entries
    voucher_map: dict[str, list[LedgerEntry]] = defaultdict(list)
    for e in books_entries:
        if not e.is_master_ledger and e.voucher_type.lower() in {"purchase", "purchases"}:
            voucher_map[e.voucher_number].append(e)

    books_rows = []
    for vn, legs in voucher_map.items():
        gst_legs = [e for e in legs if e.ledger.lower() in purch_gst_set]
        gst_amount = sum(abs(e.amount) for e in gst_legs)
        taxable = sum(abs(e.amount) for e in legs if e.ledger.lower() not in purch_gst_set)
        first = legs[0]
        books_rows.append({
            "gstin": first.gstin,
            "party": first.party_name,
            "invoice_no": first.invoice_number or vn,
            "invoice_date": min((e.date for e in legs if e.date), default=""),
            "taxable": round(taxable, 2),
            "tax": round(gst_amount, 2),
        })

    # Match 2B vs books
    unmatched_2b = list(gstr2b_rows)
    unmatched_books = list(books_rows)
    matched_rows = []

    # Pass A: exact GSTIN + normalised invoice + amount
    remaining_2b = []
    matched_book_ids = set()
    for i, b2b in enumerate(unmatched_2b):
        found = False
        for j, bk in enumerate(unmatched_books):
            if j in matched_book_ids:
                continue
            if (b2b["gstin"] == bk["gstin"]
                    and _norm_inv(b2b["invoice_no"]) == _norm_inv(bk["invoice_no"])
                    and abs(b2b["taxable"] - bk["taxable"]) < 1.0):
                matched_rows.append(_make_match("Matched", b2b, bk))
                matched_book_ids.add(j)
                found = True
                break
        if not found:
            remaining_2b.append(b2b)

    unmatched_books = [bk for j, bk in enumerate(unmatched_books) if j not in matched_book_ids]

    # Pass B: GSTIN + normalised invoice (amount mismatch)
    remaining_2b2 = []
    matched_book_ids2 = set()
    for b2b in remaining_2b:
        found = False
        for j, bk in enumerate(unmatched_books):
            if j in matched_book_ids2:
                continue
            if (b2b["gstin"] == bk["gstin"]
                    and _norm_inv(b2b["invoice_no"]) == _norm_inv(bk["invoice_no"])):
                matched_rows.append(_make_match("Amount Mismatch", b2b, bk))
                matched_book_ids2.add(j)
                found = True
                break
        if not found:
            remaining_2b2.append(b2b)

    unmatched_books = [bk for j, bk in enumerate(unmatched_books) if j not in matched_book_ids2]

    # Residuals
    for b2b in remaining_2b2:
        matched_rows.append(_make_match("Only in 2B", b2b, None))
    for bk in unmatched_books:
        matched_rows.append(_make_match("Only in Books", None, bk))

    # Summary
    status_counts: dict[str, int] = defaultdict(int)
    status_taxable: dict[str, float] = defaultdict(float)
    status_tax: dict[str, float] = defaultdict(float)
    for r in matched_rows:
        s = r["status"]
        status_counts[s] += 1
        status_taxable[s] += r.get("b2b_taxable", 0) or r.get("tally_taxable", 0)
        status_tax[s] += r.get("b2b_tax", 0) or r.get("tally_tax", 0)

    summary = [
        {"category": s, "count": status_counts[s],
         "taxable": round(status_taxable[s], 2), "tax": round(status_tax[s], 2)}
        for s in ["Matched", "Amount Mismatch", "Only in 2B", "Only in Books"]
    ]

    return {"summary": summary, "rows": matched_rows}


def _norm_inv(inv: str) -> str:
    return "".join(str(inv).upper().split()).lstrip("0")


def _make_match(status: str, b2b: dict | None, bk: dict | None) -> dict:
    return {
        "status": status,
        "party_name": (b2b or bk or {}).get("party", ""),
        "gstin": (b2b or bk or {}).get("gstin", ""),
        "b2b_invoice_no": b2b["invoice_no"] if b2b else "",
        "b2b_date": b2b["invoice_date"] if b2b else "",
        "b2b_taxable": b2b["taxable"] if b2b else 0.0,
        "b2b_tax": b2b["tax"] if b2b else 0.0,
        "tally_invoice_no": bk["invoice_no"] if bk else "",
        "tally_date": bk["invoice_date"] if bk else "",
        "tally_taxable": bk["taxable"] if bk else 0.0,
        "tally_tax": bk["tax"] if bk else 0.0,
        "delta_taxable": round((b2b["taxable"] if b2b else 0) - (bk["taxable"] if bk else 0), 2),
        "delta_tax": round((b2b["tax"] if b2b else 0) - (bk["tax"] if bk else 0), 2),
    }


def compute_related_party(
    entries: list[LedgerEntry],
    settings: AuditSettings,
) -> dict:
    rp_map = {p.name.lower(): p for p in settings.related_parties}
    if not rp_map:
        return {"parties": [], "transactions": []}

    party_totals: dict[str, dict] = {}
    txn_rows = []

    for e in entries:
        if e.is_master_ledger:
            continue
        rp = rp_map.get(e.ledger.lower()) or rp_map.get(e.party_name.lower())
        if not rp:
            continue
        key = rp.name
        if key not in party_totals:
            party_totals[key] = {"name": rp.name, "category": rp.category, "total_dr": 0.0, "total_cr": 0.0}
        if e.amount < 0:
            party_totals[key]["total_dr"] += abs(e.amount)
        else:
            party_totals[key]["total_cr"] += e.amount
        txn_rows.append({
            "date": e.date, "voucher_type": e.voucher_type, "voucher_number": e.voucher_number,
            "party": key, "category": rp.category, "ledger": e.ledger,
            "amount": round(e.amount, 2), "narration": e.narration,
        })

    parties = [
        {**v, "total_dr": round(v["total_dr"], 2), "total_cr": round(v["total_cr"], 2),
         "net": round(v["total_cr"] - v["total_dr"], 2)}
        for v in sorted(party_totals.values(), key=lambda x: x["name"])
    ]
    return {"parties": parties, "transactions": sorted(txn_rows, key=lambda r: r["date"])}


def compute_bs_cleanliness(
    entries: list[LedgerEntry],
    master_entries: list[LedgerEntry],
) -> list[dict]:
    """Flag ledgers with unexpected Dr/Cr balances based on their account type."""
    PNL_KEYWORDS = {"sales accounts", "purchase accounts", "direct expenses",
                    "indirect expenses", "direct incomes", "indirect incomes"}
    rows = []
    master_map = {e.ledger: e for e in master_entries}
    for ledger, me in sorted(master_map.items()):
        closing = me.closing_balance
        primary = me.tally_primary.lower()
        is_pnl = any(kw in primary for kw in PNL_KEYWORDS)
        flag = ""
        if is_pnl and abs(closing) > 0.5:
            flag = "PNL_NON_ZERO_CLOSING"
        elif "sundry debtor" in primary and closing < -0.5:
            flag = "DEBTOR_CREDIT_BALANCE"
        elif "sundry creditor" in primary and closing > 0.5:
            flag = "CREDITOR_DEBIT_BALANCE"
        rows.append({
            "ledger": ledger,
            "primary": me.tally_primary,
            "opening": round(me.opening_balance, 2),
            "closing": round(closing, 2),
            "flag": flag,
        })
    return rows


def compute_orphan_pl(
    entries: list[LedgerEntry],
) -> list[dict]:
    """P&L vouchers that have no Balance Sheet counter-leg."""
    PNL_KEYWORDS = {"sales accounts", "purchase accounts", "direct expenses",
                    "indirect expenses", "direct incomes", "indirect incomes"}
    BS_KEYWORDS = {"sundry debtors", "sundry creditors", "bank accounts",
                   "cash-in-hand", "loans", "fixed assets", "capital account"}

    from collections import defaultdict
    voucher_map: dict[str, list[LedgerEntry]] = defaultdict(list)
    for e in entries:
        if not e.is_master_ledger:
            voucher_map[e.voucher_number].append(e)

    rows = []
    for vn, legs in voucher_map.items():
        has_pnl = any(any(kw in e.tally_primary.lower() for kw in PNL_KEYWORDS) for e in legs)
        has_bs = any(any(kw in e.tally_primary.lower() for kw in BS_KEYWORDS) for e in legs)
        if has_pnl and not has_bs:
            first = legs[0]
            rows.append({
                "date": min((e.date for e in legs if e.date), default=""),
                "voucher_type": first.voucher_type,
                "voucher_number": vn,
                "party_name": first.party_name,
                "pnl_ledgers": "; ".join({e.ledger for e in legs if any(kw in e.tally_primary.lower() for kw in PNL_KEYWORDS)}),
                "total_dr": round(sum(abs(e.amount) for e in legs if e.amount < 0), 2),
                "total_cr": round(sum(e.amount for e in legs if e.amount > 0), 2),
                "narration": first.narration,
            })
    rows.sort(key=lambda r: r["date"])
    return rows


def compute_variance(
    entries: list[LedgerEntry],
    selected_ledgers: list[str] | None = None,
) -> list[dict]:
    """Month-on-month variance for selected ledgers (or all P&L)."""
    PNL_KEYWORDS = {"sales accounts", "purchase accounts", "direct expenses",
                    "indirect expenses", "direct incomes", "indirect incomes"}
    from collections import defaultdict
    ledger_month: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    all_months: set[str] = set()
    for e in entries:
        if e.is_master_ledger or not e.date:
            continue
        if selected_ledgers and e.ledger not in selected_ledgers:
            continue
        if not any(kw in e.tally_primary.lower() for kw in PNL_KEYWORDS):
            continue
        y, m = int(e.date[:4]), int(e.date[5:7])
        month_str = f"{_MONTHS[m-1]}-{y}"
        ledger_month[e.ledger][month_str] += e.amount
        all_months.add(month_str)

    from app.constants import FY_MONTH_ORDER
    sorted_months = sorted(
        all_months,
        key=lambda s: (int(s.split("-")[1]), FY_MONTH_ORDER.get(s.split("-")[0], 0)),
    )

    rows = []
    for ledger, month_vals in sorted(ledger_month.items()):
        row = {"ledger": ledger}
        prev_val = None
        for m in sorted_months:
            val = round(month_vals.get(m, 0.0), 2)
            row[m] = val
            if prev_val is not None and prev_val != 0:
                row[f"{m}_pct"] = round((val - prev_val) / abs(prev_val) * 100, 2)
            else:
                row[f"{m}_pct"] = None
            prev_val = val
        rows.append(row)
    return rows


def compute_tsf_comparison(
    current_entries: list[LedgerEntry],
    new_entries: list[LedgerEntry],
) -> dict:
    current_map = {e.guid: e for e in current_entries}
    new_map = {e.guid: e for e in new_entries}
    current_guids = set(current_map.keys())
    new_guids = set(new_map.keys())

    added = [new_map[g] for g in new_guids - current_guids]
    removed = [current_map[g] for g in current_guids - new_guids]

    modified = []
    COMPARE_FIELDS = ["amount", "voucher_type", "date", "ledger", "party_name"]
    for g in current_guids & new_guids:
        ce, ne = current_map[g], new_map[g]
        changes = {f: (getattr(ce, f), getattr(ne, f)) for f in COMPARE_FIELDS if getattr(ce, f) != getattr(ne, f)}
        if changes:
            modified.append({"guid": g, "current": ce, "new": ne, "changes": changes})

    total_amount_change = sum(e.amount for e in added) - sum(e.amount for e in removed)
    return {
        "summary": {
            "added": len(added), "removed": len(removed),
            "modified": len(modified), "net_amount_change": round(total_amount_change, 2),
        },
        "added": added,
        "removed": removed,
        "modified": modified,
    }


_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
