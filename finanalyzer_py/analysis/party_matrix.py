from __future__ import annotations

from collections import defaultdict
from data.models import LedgerEntry, AuditSettings


def compute_party_matrix(
    entries: list[LedgerEntry],
    settings: AuditSettings,
) -> dict:
    """
    For each party ledger, aggregate all counter-ledger amounts into buckets:
    sales / purchase / expense / tds / gst / rcm / bank / others.

    Returns:
      {
        "parties": [PartyRow],   # one row per party with bucket totals
        "vouchers": [VoucherRow], # all voucher legs for detail sheet
        "anomalies": [AnomalyRow],
        "tagged_ledgers": {"tds": [...], "gst": [...], "rcm": [...]}
      }
    """
    tds_set = {l.lower() for l in settings.tds_tax_ledgers}
    gst_set = {l.lower() for l in settings.sales_gst_ledgers + settings.purchase_gst_ledgers}
    rcm_set = {l.lower() for l in settings.rcm_tax_ledgers}
    bank_keywords = {"bank accounts", "bank account", "cash-in-hand", "cash in hand"}

    # Group all entries by voucher_number
    voucher_map: dict[str, list[LedgerEntry]] = defaultdict(list)
    for e in entries:
        if not e.is_master_ledger:
            voucher_map[e.voucher_number].append(e)

    party_data: dict[str, dict] = {}

    all_voucher_rows = []
    for vn, legs in voucher_map.items():
        # Find party legs (Sundry Debtor / Creditor)
        party_legs = [
            e for e in legs
            if any(kw in e.tally_primary.lower() for kw in {"sundry debtor", "sundry creditor"})
        ]
        if not party_legs:
            party_legs = [
                e for e in legs
                if e.party_name and e.party_name == e.ledger
            ]
        if not party_legs:
            continue

        for pl in party_legs:
            party = pl.ledger
            if party not in party_data:
                party_data[party] = {
                    "voucher_count": 0,
                    "first_date": "",
                    "last_date": "",
                    "sales": 0.0, "purchase": 0.0, "expense": 0.0,
                    "tds": 0.0, "gst": 0.0, "rcm": 0.0, "bank": 0.0, "others": 0.0,
                    "party_amount": 0.0,
                    "top_ledgers": defaultdict(float),
                    "dates": [],
                }

            pd = party_data[party]
            pd["voucher_count"] += 1
            vdate = min((e.date for e in legs if e.date), default="")
            if vdate:
                pd["dates"].append(vdate)

            pd["party_amount"] += pl.amount

            # Classify each non-party counter leg
            counter = [e for e in legs if e != pl]
            sales = purchase = expense = tds = gst = rcm = bank = others = 0.0
            for e in counter:
                amt = abs(e.amount)
                lk = e.ledger.lower()
                pk = e.tally_primary.lower()
                if lk in tds_set:
                    tds += amt
                elif lk in gst_set:
                    gst += amt
                elif lk in rcm_set:
                    rcm += amt
                elif any(kw in pk for kw in bank_keywords):
                    bank += amt
                elif "sales" in pk:
                    sales += amt
                elif "purchase" in pk:
                    purchase += amt
                elif "expense" in pk or "indirect" in pk or "direct" in pk:
                    expense += amt
                else:
                    others += amt
                pd["top_ledgers"][e.ledger] += amt

            pd["sales"] += sales
            pd["purchase"] += purchase
            pd["expense"] += expense
            pd["tds"] += tds
            pd["gst"] += gst
            pd["rcm"] += rcm
            pd["bank"] += bank
            pd["others"] += others

            all_voucher_rows.append({
                "party": party,
                "date": vdate,
                "voucher_type": pl.voucher_type,
                "voucher_number": vn,
                "party_amount": round(pl.amount, 2),
                "expense": round(expense, 2),
                "sales": round(sales, 2),
                "purchase": round(purchase, 2),
                "tds": round(tds, 2),
                "gst": round(gst, 2),
                "rcm": round(rcm, 2),
                "bank": round(bank, 2),
                "others": round(others, 2),
                "counter_breakdown": "; ".join(
                    f"{e.ledger}:{e.amount:+.2f}" for e in counter
                )[:200],
            })

    # Build summary rows
    party_rows = []
    anomaly_rows = []
    for party, pd in sorted(party_data.items()):
        dates = sorted(pd["dates"])
        top_ledgers = sorted(pd["top_ledgers"].items(), key=lambda x: -x[1])[:5]
        top_str = "; ".join(f"{l}:{a:,.0f}" for l, a in top_ledgers)

        tds_pct = (pd["tds"] / pd["expense"] * 100) if pd["expense"] > 0.01 else 0.0
        gst_pct = (pd["gst"] / (pd["sales"] + pd["expense"]) * 100) if (pd["sales"] + pd["expense"]) > 0.01 else 0.0
        net_balance = round(pd["party_amount"], 2)
        total_activity = pd["sales"] + pd["expense"] + pd["purchase"]

        party_rows.append({
            "party": party,
            "voucher_count": pd["voucher_count"],
            "first_date": dates[0] if dates else "",
            "last_date": dates[-1] if dates else "",
            "sales": round(pd["sales"], 2),
            "purchase": round(pd["purchase"], 2),
            "expense": round(pd["expense"], 2),
            "tds": round(pd["tds"], 2),
            "tds_pct": round(tds_pct, 2),
            "gst": round(pd["gst"], 2),
            "gst_pct": round(gst_pct, 2),
            "rcm": round(pd["rcm"], 2),
            "bank": round(pd["bank"], 2),
            "others": round(pd["others"], 2),
            "net_balance": net_balance,
            "top_ledgers": top_str,
        })

        # Anomaly detection
        if pd["expense"] > 0.01 and pd["tds"] < 0.01:
            anomaly_rows.append({
                "anomaly_type": "Zero TDS",
                "party": party,
                "metric": "TDS/Expense %",
                "value": 0.0,
                "note": f"Expense ₹{pd['expense']:,.0f} with no TDS deducted",
            })
        if total_activity > 0.01 and pd["gst"] < 0.01:
            anomaly_rows.append({
                "anomaly_type": "Zero GST",
                "party": party,
                "metric": "GST/Taxable %",
                "value": 0.0,
                "note": f"Activity ₹{total_activity:,.0f} with no GST",
            })
        if pd["others"] > 0.01 and total_activity > 0.01 and pd["others"] / total_activity > 0.25:
            anomaly_rows.append({
                "anomaly_type": "High Others",
                "party": party,
                "metric": "Others/Activity %",
                "value": round(pd["others"] / total_activity * 100, 2),
                "note": f"Others ₹{pd['others']:,.0f} is >{25}% of activity",
            })

    return {
        "parties": party_rows,
        "vouchers": all_voucher_rows,
        "anomalies": anomaly_rows,
        "tagged_ledgers": {
            "tds": settings.tds_tax_ledgers,
            "gst": settings.sales_gst_ledgers + settings.purchase_gst_ledgers,
            "rcm": settings.rcm_tax_ledgers,
        },
    }
