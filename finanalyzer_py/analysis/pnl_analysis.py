from __future__ import annotations

from collections import defaultdict
from data.models import LedgerEntry


PNL_HEADS = {
    "sales": ["sales accounts"],
    "other_income": ["indirect incomes", "direct incomes"],
    "purchases": ["purchase accounts"],
    "direct_expenses": ["direct expenses", "manufacturing expenses"],
    "indirect_expenses": ["indirect expenses"],
}
BS_KEYWORDS = {
    "sundry debtors", "sundry creditors", "bank accounts", "cash-in-hand",
    "cash in hand", "loans", "fixed assets", "capital account",
    "reserves", "investments", "current liabilities", "current assets",
}


def _classify(primary: str) -> str:
    pl = primary.lower()
    for head, keywords in PNL_HEADS.items():
        if any(kw in pl for kw in keywords):
            return head
    if any(kw in pl for kw in BS_KEYWORDS):
        return "balance_sheet"
    return "indirect_expenses"


def compute_pnl(
    entries: list[LedgerEntry],
    months: list[str] | None = None,
) -> dict:
    """
    Returns:
      {
        "months": [str],
        "rows": [{"head", "primary", "ledger", "month_values": {month: float}, "total": float}]
      }
    """
    # Group by (head, primary, ledger, month) → amount
    data: dict[tuple, float] = defaultdict(float)
    all_months: set[str] = set()

    for e in entries:
        if e.is_master_ledger or not e.date:
            continue
        head = _classify(e.tally_primary)
        if head == "balance_sheet":
            continue
        y, m = int(e.date[:4]), int(e.date[5:7])
        month_str = f"{_MONTHS[m-1]}-{y}"
        if months and month_str not in months:
            continue
        data[(head, e.tally_primary, e.ledger, month_str)] += e.amount
        all_months.add(month_str)

    from app.constants import FY_MONTH_ORDER
    sorted_months = sorted(
        all_months,
        key=lambda s: (int(s.split("-")[1]), FY_MONTH_ORDER.get(s.split("-")[0], 0)),
    )

    # Aggregate by (head, primary, ledger)
    ledger_data: dict[tuple, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for (head, primary, ledger, month), amount in data.items():
        ledger_data[(head, primary, ledger)][month] += amount

    rows = []
    for (head, primary, ledger), month_values in sorted(ledger_data.items()):
        total = round(sum(month_values.values()), 2)
        rows.append({
            "head": head,
            "primary": primary,
            "ledger": ledger,
            "month_values": {m: round(v, 2) for m, v in month_values.items()},
            "total": total,
        })

    # Sort: by head order then primary then ledger
    head_order = list(PNL_HEADS.keys())
    rows.sort(key=lambda r: (
        head_order.index(r["head"]) if r["head"] in head_order else 99,
        r["primary"],
        r["ledger"],
    ))

    return {"months": sorted_months, "rows": rows}


_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
