#!/usr/bin/env python3
"""
Tally Financial Statements Generator
Reads a Tally SQLite export and produces:
  • Schedule III Balance Sheet
  • Statement of Profit & Loss
  • 3-Year Projected P&L and Balance Sheet (banker/investor format)

Run:  python financial_statements.py
Requires: openpyxl  (pip install openpyxl)
"""
import os
import sqlite3
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from pathlib import Path
from datetime import date
from dataclasses import dataclass, field
from typing import Any

import openpyxl
from openpyxl.styles import (
    Alignment, Border, Font, PatternFill, Side,
)
from openpyxl.utils import get_column_letter

# ─── Schedule III primary-group classification ────────────────────────────────
# Values: (side, schedule_head, is_asset)
#   side:  'equity' | 'noncurrent_liab' | 'current_liab' | 'noncurrent_asset' | 'current_asset'
#   schedule_head: display label used in grouping
#   is_asset: True if the natural balance is debit (asset)
#
# Tally sign convention in closing_balance:
#   negative → debit balance   (normal for assets / expenses)
#   positive → credit balance  (normal for liabilities / income)
#
# For display we always show amounts as POSITIVE on the face of statements:
#   asset display  =  – closing_balance   (negate the debit)
#   liab display   =  + closing_balance   (credit as-is)
#   revenue display=  + closing_balance   (credit as-is)
#   expense display=  – closing_balance   (negate the debit)

BS_MAP: dict[str, tuple[str, str, bool]] = {
    # ── Assets ───────────────────────────────────────────────────────────────
    "Fixed Assets":             ("noncurrent_asset", "Fixed Assets",                     True),
    "Investments":              ("noncurrent_asset", "Non-Current Investments",           True),
    "Deposits (Asset)":         ("noncurrent_asset", "Long-Term Loans & Advances",        True),
    "Loans & Advances (Asset)": ("noncurrent_asset", "Long-Term Loans & Advances",        True),
    "Misc. Expenses (ASSET)":   ("noncurrent_asset", "Other Non-Current Assets",          True),
    "Stock-in-hand":            ("current_asset",    "Inventories",                       True),
    "Sundry Debtors":           ("current_asset",    "Trade Receivables",                 True),
    "Cash-in-hand":             ("current_asset",    "Cash & Cash Equivalents",           True),
    "Bank Accounts":            ("current_asset",    "Cash & Cash Equivalents",           True),
    "Current Assets":           ("current_asset",    "Other Current Assets",              True),
    # ── Equity ───────────────────────────────────────────────────────────────
    "Capital Account":          ("equity",           "Share Capital",                     False),
    "Reserves & Surplus":       ("equity",           "Reserves & Surplus",                False),
    # ── Non-current liabilities ──────────────────────────────────────────────
    "Secured Loans":            ("noncurrent_liab",  "Long-Term Borrowings",              False),
    "Unsecured Loans":          ("noncurrent_liab",  "Long-Term Borrowings",              False),
    "Loans (Liability)":        ("noncurrent_liab",  "Long-Term Borrowings",              False),
    # ── Current liabilities ──────────────────────────────────────────────────
    "Bank OD A/c":              ("current_liab",     "Short-Term Borrowings",             False),
    "Sundry Creditors":         ("current_liab",     "Trade Payables",                    False),
    "Current Liabilities":      ("current_liab",     "Other Current Liabilities",         False),
    "Branch / Divisions":       ("current_liab",     "Other Current Liabilities",         False),
    "Duties & Taxes":           ("current_liab",     "Duties & Taxes (Net)",              False),
    "Provisions":               ("current_liab",     "Short-Term Provisions",             False),
    "Suspense A/c":             ("current_liab",     "Other Current Liabilities",         False),
}

PNL_MAP: dict[str, tuple[str, str]] = {
    "Sales Accounts":   ("revenue",  "Revenue from Operations"),
    "Direct Incomes":   ("revenue",  "Revenue from Operations"),
    "Indirect Incomes": ("revenue",  "Other Income"),
    "Purchase Accounts":("expense",  "Cost of Materials / Purchases"),
    "Direct Expenses":  ("expense",  "Direct Expenses"),
    "Indirect Expenses":("expense",  "Indirect Expenses"),
}

# Sub-groups of Indirect Expenses that are carved out on the face of P&L
FINANCE_COST_PARENTS = {"Finance Costs", "Interest & Late Filing Fees"}
EMPLOYEE_COST_PARENTS = {
    "Employee benefit expenses", "Contribution to Provident Funds & Others",
    "Salary", "Salaries", "Staff Salary",
}

# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class LedgerRow:
    name: str
    parent: str
    primary_group: str
    opening: float
    closing: float
    is_deemedpositive: bool

@dataclass
class PnlRow:
    """Aggregated P&L transaction total from trn_accounting."""
    primary_group: str
    parent: str           # Tally sub-group (e.g. "Finance Costs")
    total: float          # raw sum; negative = debit (expense/purchase), positive = credit (income)

@dataclass
class FinancialData:
    company: str
    period_from: str
    period_to: str
    period_label: str
    ledgers: list[LedgerRow]
    pnl_rows: list[PnlRow]    # from trn_accounting (kept for future use)
    pnl_balance: float         # P&L A/c closing (cumulative, used in Reserves & Surplus on BS)
    pnl_opening: float         # P&L A/c opening (prior year retained profit not yet in Reserves)
    opening_stock_override: float | None = None
    closing_stock_override: float | None = None

    # ── Balance-sheet ledger helpers ─────────────────────────────────────────

    def _ledgers_for(self, primary_group: str) -> list[LedgerRow]:
        return [l for l in self.ledgers if l.primary_group == primary_group]

    def _sum_closing(self, primary_group: str) -> float:
        return sum(l.closing for l in self._ledgers_for(primary_group))

    def _sum_opening(self, primary_group: str) -> float:
        return sum(l.opening for l in self._ledgers_for(primary_group))

    # ── P&L helpers (use mst_ledger closing_balance — matches Tally's own P&L) ──
    # trn_accounting totals include journal/inter-branch adjustments that Tally
    # excludes from its P&L computation. mst_ledger.closing_balance is the
    # authoritative figure Tally uses.
    # Sign convention for P&L ledgers:
    #   Revenue (Sales, Incomes): positive closing = credit = income as-is
    #   Expenses (Purchases, Costs): negative closing = debit = negate to display positive

    def _pnl_group_total(self, primary_group: str) -> float:
        """Sum of closing_balances for a primary group (matches Tally's P&L)."""
        return sum(l.closing for l in self._ledgers_for(primary_group))

    def _pnl_by_parent(self, primary_group: str) -> dict[str, float]:
        result: dict[str, float] = {}
        for l in self._ledgers_for(primary_group):
            result[l.parent] = result.get(l.parent, 0) + l.closing
        return result

    # ── Fixed assets note ─────────────────────────────────────────────────────

    def fixed_assets_schedule(self) -> list[dict]:
        by_subgroup: dict[str, dict] = {}
        for l in self._ledgers_for("Fixed Assets"):
            sg = l.parent
            if sg not in by_subgroup:
                by_subgroup[sg] = {"gross_open": 0, "gross_close": 0,
                                   "depr_open": 0, "depr_close": 0}
            d = by_subgroup[sg]
            is_depr = "depreciation" in l.name.lower() or "accumulated" in l.name.lower()
            if is_depr:
                d["depr_open"]  += l.opening   # credit = positive
                d["depr_close"] += l.closing
            else:
                d["gross_open"]  += -l.opening  # debit = negative → negate for display
                d["gross_close"] += -l.closing
        rows = []
        for sg, d in by_subgroup.items():
            rows.append({
                "name":        sg,
                "gross_open":  d["gross_open"],
                "additions":   max(0, d["gross_close"] - d["gross_open"]),
                "disposals":   max(0, d["gross_open"] - d["gross_close"]),
                "gross_close": d["gross_close"],
                "depr_open":   d["depr_open"],
                "depr_charge": max(0, d["depr_close"] - d["depr_open"]),
                "depr_close":  d["depr_close"],
                "net_open":    d["gross_open"]  - d["depr_open"],
                "net_close":   d["gross_close"] - d["depr_close"],
            })
        return sorted(rows, key=lambda r: r["name"])

    def net_fixed_assets(self) -> float:
        return sum(r["net_close"] for r in self.fixed_assets_schedule())

    # ── Stock ─────────────────────────────────────────────────────────────────

    def opening_stock(self) -> float:
        if self.opening_stock_override is not None:
            return self.opening_stock_override
        return -self._sum_opening("Stock-in-hand")   # debit balance → negate

    def closing_stock(self) -> float:
        if self.closing_stock_override is not None:
            return self.closing_stock_override
        return -self._sum_closing("Stock-in-hand")

    # ── P&L totals (from mst_ledger closing_balance) ─────────────────────────

    def revenue_from_ops(self) -> float:
        # Revenue accounts: credit nature → positive closing_balance → use as-is
        return (self._pnl_group_total("Sales Accounts")
                + self._pnl_group_total("Direct Incomes"))

    def other_income(self) -> float:
        return self._pnl_group_total("Indirect Incomes")

    def purchases(self) -> float:
        # Expense accounts: debit nature → negative closing_balance → negate to display positive
        return -self._pnl_group_total("Purchase Accounts")

    def direct_expenses(self) -> float:
        return -self._pnl_group_total("Direct Expenses")

    def finance_costs(self) -> float:
        ibd = self._pnl_by_parent("Indirect Expenses")
        return sum(-v for k, v in ibd.items() if k in FINANCE_COST_PARENTS)

    def employee_costs(self) -> float:
        ibd = self._pnl_by_parent("Indirect Expenses")
        return sum(-v for k, v in ibd.items() if k in EMPLOYEE_COST_PARENTS)

    def depreciation_from_fa(self) -> float:
        return sum(r["depr_charge"] for r in self.fixed_assets_schedule())

    def other_indirect_expenses(self) -> float:
        ibd = self._pnl_by_parent("Indirect Expenses")
        skip = FINANCE_COST_PARENTS | EMPLOYEE_COST_PARENTS
        return sum(-v for k, v in ibd.items() if k not in skip)

    def total_expenses(self) -> float:
        return (self.purchases()
                + self.direct_expenses()
                + self.employee_costs()
                + self.finance_costs()
                + self.depreciation_from_fa()
                + self.other_indirect_expenses()
                + self.opening_stock()
                - self.closing_stock())

    def profit_before_tax(self) -> float:
        return self.revenue_from_ops() + self.other_income() - self.total_expenses()

    def tax_expense(self) -> float:
        # Deferred Tax Liability ledger treatment: positive = credit = liability = tax expense
        dtl = next((l.closing for l in self.ledgers
                    if "deferred tax" in l.name.lower()), 0.0)
        return dtl  # simplified; actual tax computation needs I-T workings

    def profit_after_tax(self) -> float:
        return self.profit_before_tax() - self.tax_expense()

    # ── Balance sheet totals ──────────────────────────────────────────────────

    def share_capital(self) -> float:
        # Capital Account with EQUITY SHARE CAPITAL parent (exclude Reserve & Surplus ledger)
        total = 0.0
        for l in self._ledgers_for("Capital Account"):
            if "reserve" not in l.name.lower() and "profit" not in l.name.lower():
                total += l.closing   # credit = positive = equity
        return total

    def reserves_surplus(self) -> float:
        res = self._sum_closing("Reserves & Surplus")
        # Reserve & Surplus ledger under Capital Account
        for l in self._ledgers_for("Capital Account"):
            if "reserve" in l.name.lower():
                res += l.closing
        # Add current year P&L
        res += self.pnl_balance
        return res

    def long_term_borrowings(self) -> float:
        return (self._sum_closing("Secured Loans")
                + self._sum_closing("Unsecured Loans")
                + self._sum_closing("Loans (Liability)"))

    def short_term_borrowings(self) -> float:
        return self._sum_closing("Bank OD A/c")

    def trade_payables(self) -> float:
        return max(0, self._sum_closing("Sundry Creditors"))

    def duties_and_taxes_net(self) -> float:
        net = self._sum_closing("Duties & Taxes")
        # Positive net = payable (liability); negative net = refund (asset)
        return net

    def other_current_liabilities(self) -> float:
        # Duties & Taxes gets its own line; don't include it here
        cl     = self._sum_closing("Current Liabilities")
        branch = self._sum_closing("Branch / Divisions")
        susp   = self._sum_closing("Suspense A/c")
        ocl    = cl + max(0, branch) + susp
        # Remove Deferred Tax Liability from OCL (it's non-current)
        dtl = next((l.closing for l in self.ledgers
                    if "deferred tax" in l.name.lower()), 0.0)
        return max(0, ocl - dtl)

    def short_term_provisions(self) -> float:
        return max(0, self._sum_closing("Provisions"))

    def non_current_investments(self) -> float:
        return -self._sum_closing("Investments")

    def long_term_loans_advances(self) -> float:
        dep = -self._sum_closing("Deposits (Asset)")
        la  = -self._sum_closing("Loans & Advances (Asset)")
        return dep + la

    def other_noncurrent_assets(self) -> float:
        return -self._sum_closing("Misc. Expenses (ASSET)")

    def trade_receivables(self) -> float:
        return max(0, -self._sum_closing("Sundry Debtors"))

    def cash_and_bank(self) -> float:
        # Tally: for is_deemedpositive groups, negative closing = debit = asset (cash/bank balance)
        # Only count banks with a debit (negative) closing as assets here.
        # Banks with credit (positive) closing are picked up in bank_od_in_bank_accounts().
        cash = -self._sum_closing("Cash-in-hand")
        bank_asset = sum(-l.closing for l in self._ledgers_for("Bank Accounts")
                         if l.closing < 0)
        return cash + bank_asset

    def bank_od_in_bank_accounts(self) -> float:
        """Bank Accounts ledgers with credit (positive) closing = additional OD / liability."""
        return sum(l.closing for l in self._ledgers_for("Bank Accounts") if l.closing > 0)

    def duties_and_taxes_asset(self) -> float:
        """Net GST/TDS refund receivable (when D&T net is debit/negative)."""
        net = self.duties_and_taxes_net()
        return -net if net < 0 else 0.0

    def other_current_assets(self) -> float:
        oca       = -self._sum_closing("Current Assets")
        branch_dr = max(0, -self._sum_closing("Branch / Divisions"))
        dt_asset  = self.duties_and_taxes_asset()
        return oca + branch_dr + dt_asset

    def deferred_tax_asset(self) -> float:
        dtl = next((l.closing for l in self.ledgers
                    if "deferred tax" in l.name.lower()), 0.0)
        return max(0, -dtl)  # if DTL < 0, it's actually a DTA

    def total_noncurrent_assets(self) -> float:
        return (self.net_fixed_assets()
                + self.non_current_investments()
                + self.long_term_loans_advances()
                + self.other_noncurrent_assets()
                + self.deferred_tax_asset())

    def total_current_assets(self) -> float:
        return (self.closing_stock()
                + self.trade_receivables()
                + self.cash_and_bank()
                + self.other_current_assets())

    def total_assets(self) -> float:
        return self.total_noncurrent_assets() + self.total_current_assets()

    def total_equity(self) -> float:
        return self.share_capital() + self.reserves_surplus()

    def deferred_tax_liability(self) -> float:
        dtl = next((l.closing for l in self.ledgers
                    if "deferred tax" in l.name.lower()), 0.0)
        return max(0, dtl)

    def total_noncurrent_liab(self) -> float:
        return self.long_term_borrowings() + self.deferred_tax_liability()

    def total_current_liab(self) -> float:
        return (self.short_term_borrowings()
                + self.bank_od_in_bank_accounts()   # OD banks under Bank Accounts group
                + self.trade_payables()
                + max(0, self.duties_and_taxes_net())
                + self.other_current_liabilities()
                + self.short_term_provisions())

    def total_equity_liabilities(self) -> float:
        return self.total_equity() + self.total_noncurrent_liab() + self.total_current_liab()


# ─── Database loader ──────────────────────────────────────────────────────────

def load_from_sqlite(db_path: str,
                     opening_stock_override: float | None = None,
                     closing_stock_override: float | None = None) -> FinancialData:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row

    # Company / period (_export_info uses name/value columns)
    info = {r["name"]: r["value"]
            for r in con.execute("SELECT name, value FROM _export_info")}
    company     = info.get("company_name", "Company").replace("(from", "").replace(")", "").strip()
    period_from = info.get("period_from", "")
    period_to   = info.get("period_to",   "")

    # Build period label e.g. "31st March 2026"
    def _ordinal(dt_str: str) -> str:
        try:
            d = date.fromisoformat(dt_str)
            day = d.day
            suffix = {1:"st",2:"nd",3:"rd"}.get(day if day < 20 else day % 10, "th")
            return f"{day}{suffix} {d.strftime('%B %Y')}"
        except Exception:
            return dt_str
    period_label = _ordinal(period_to)

    # Profit & Loss A/c (special ledger, no parent group)
    # closing_balance = cumulative (prior year opening + current year profit)
    # opening_balance = prior year retained earnings not yet transferred to Reserves
    pnl_row = con.execute(
        "SELECT opening_balance, closing_balance FROM mst_ledger WHERE name = 'Profit & Loss A/c'"
    ).fetchone()
    pnl_balance  = float(pnl_row["closing_balance"]) if pnl_row else 0.0
    pnl_opening  = float(pnl_row["opening_balance"]) if pnl_row else 0.0

    # Balance-sheet ledgers from mst_ledger (closing balances = year-end positions)
    bs_rows = con.execute("""
        SELECT
            l.name,
            l.parent,
            g.primary_group,
            CAST(COALESCE(l.opening_balance, '0') AS REAL) AS opening,
            CAST(COALESCE(l.closing_balance, '0') AS REAL) AS closing,
            COALESCE(g.is_deemedpositive, '0') AS is_dp
        FROM mst_ledger l
        LEFT JOIN mst_group g ON g.name = l.parent
        WHERE g.primary_group IS NOT NULL
        ORDER BY g.primary_group, l.parent, l.name
    """).fetchall()

    ledgers = [
        LedgerRow(
            name=r["name"],
            parent=r["parent"],
            primary_group=r["primary_group"],
            opening=float(r["opening"]),
            closing=float(r["closing"]),
            is_deemedpositive=str(r["is_dp"]) == "1",
        )
        for r in bs_rows
    ]

    # P&L activity from trn_accounting — the REAL year's revenue/expense amounts.
    # mst_ledger.closing_balance for P&L accounts is net outstanding, not activity.
    pnl_groups = (
        "'Sales Accounts','Direct Incomes','Indirect Incomes',"
        "'Purchase Accounts','Direct Expenses','Indirect Expenses'"
    )
    pnl_txn_rows = con.execute(f"""
        SELECT
            g.primary_group,
            l.parent,
            SUM(CAST(a.amount AS REAL)) AS total
        FROM trn_accounting a
        JOIN mst_ledger l ON l.name = a.ledger
        LEFT JOIN mst_group g ON g.name = l.parent
        WHERE g.primary_group IN ({pnl_groups})
        GROUP BY g.primary_group, l.parent
        ORDER BY g.primary_group, l.parent
    """).fetchall()

    pnl_rows = [
        PnlRow(
            primary_group=r["primary_group"],
            parent=r["parent"],
            total=float(r["total"] or 0),
        )
        for r in pnl_txn_rows
    ]

    con.close()
    return FinancialData(
        company=company,
        period_from=period_from,
        period_to=period_to,
        period_label=period_label,
        ledgers=ledgers,
        pnl_rows=pnl_rows,
        pnl_balance=pnl_balance,
        pnl_opening=pnl_opening,
        opening_stock_override=opening_stock_override,
        closing_stock_override=closing_stock_override,
    )


# ─── Excel generation ─────────────────────────────────────────────────────────

# Colour palette
C_DARK_BLUE  = "1F3864"
C_MID_BLUE   = "2F5496"
C_LIGHT_BLUE = "D6E4F0"
C_HEADER_BG  = "1F3864"
C_SUBHD_BG   = "BDD7EE"
C_TOTAL_BG   = "D9E1F2"
C_WHITE      = "FFFFFF"
C_BLACK      = "000000"
C_AMBER      = "FFF2CC"

def _fill(hex_color: str) -> PatternFill:
    return PatternFill("solid", fgColor=hex_color)

def _border(style: str = "thin") -> Border:
    s = Side(style=style)
    return Border(left=s, right=s, top=s, bottom=s)

def _font(bold=False, size=10, color=C_BLACK, name="Calibri") -> Font:
    return Font(bold=bold, size=size, color=color, name=name)

def _align(h="left", v="center", wrap=False) -> Alignment:
    return Alignment(horizontal=h, vertical=v, wrap_text=wrap)

INR = '#,##0'          # Indian number format (openpyxl uses comma-separated)
INR2 = '#,##0.00'

def _fmt(ws, cell_ref: str, value: float | None, italic: bool = False) -> None:
    cell = ws[cell_ref]
    if value is not None:
        cell.value = value
    cell.number_format = INR
    if italic:
        cell.font = Font(name="Calibri", size=10, italic=True)


class ExcelWriter:
    def __init__(self, fd: FinancialData, proj: "ProjectionInputs | None" = None):
        self.fd = fd
        self.proj = proj
        self.wb = openpyxl.Workbook()
        self.wb.remove(self.wb.active)  # remove default sheet

    def save(self, path: str) -> None:
        self._write_bs()
        self._write_pnl()
        if self.proj:
            pe = ProjectionEngine(self.fd, self.proj)
            self._write_proj_pnl(pe)
            self._write_proj_bs(pe)
            self._write_assumptions()
        self.wb.save(path)

    # ── Balance Sheet ─────────────────────────────────────────────────────────

    def _write_bs(self) -> None:
        ws = self.wb.create_sheet("Balance Sheet")
        fd = self.fd
        ws.column_dimensions["A"].width = 46
        ws.column_dimensions["B"].width = 8
        ws.column_dimensions["C"].width = 18
        ws.column_dimensions["D"].width = 18

        r = 1
        def header(text, span=4, bg=C_HEADER_BG, fg=C_WHITE, sz=12, bold=True):
            nonlocal r
            ws.merge_cells(f"A{r}:D{r}")
            cell = ws[f"A{r}"]
            cell.value = text
            cell.font = _font(bold=bold, size=sz, color=fg)
            cell.fill = _fill(bg)
            cell.alignment = _align("center")
            r += 1

        def subheader(text, bg=C_SUBHD_BG):
            nonlocal r
            ws.merge_cells(f"A{r}:D{r}")
            cell = ws[f"A{r}"]
            cell.value = text
            cell.font = _font(bold=True, size=10)
            cell.fill = _fill(bg)
            cell.alignment = _align("left")
            r += 1

        def col_header():
            nonlocal r
            ws[f"A{r}"].value = "Particulars"
            ws[f"B{r}"].value = "Note"
            ws[f"C{r}"].value = f"As at {fd.period_label}"
            ws[f"D{r}"].value = f"Previous Year"
            for col in "ABCD":
                c = ws[f"{col}{r}"]
                c.font = _font(bold=True, size=9, color=C_WHITE)
                c.fill = _fill(C_MID_BLUE)
                c.alignment = _align("center")
                c.border = _border()
            r += 1

        def row(label, amount, note=None, indent=0, bold=False, total=False, fmt=INR):
            nonlocal r
            prefix = "  " * indent
            ws[f"A{r}"].value = prefix + label
            ws[f"A{r}"].font = _font(bold=bold or total, size=10)
            ws[f"A{r}"].alignment = _align("left")
            if note:
                ws[f"B{r}"].value = note
                ws[f"B{r}"].alignment = _align("center")
                ws[f"B{r}"].font = _font(size=9)
            if amount is not None:
                ws[f"C{r}"].value = amount
                ws[f"C{r}"].number_format = fmt
                ws[f"C{r}"].font = _font(bold=bold or total, size=10)
                ws[f"C{r}"].alignment = _align("right")
            if total:
                for col in "AC":
                    ws[f"{col}{r}"].fill = _fill(C_TOTAL_BG)
                    ws[f"{col}{r}"].border = _border()
            r += 1
            return r - 1  # return row number for formula references

        def spacer():
            nonlocal r
            r += 1

        header(fd.company.upper(), sz=14)
        header("BALANCE SHEET", sz=12)
        header(f"As at {fd.period_label}", sz=10, bg=C_MID_BLUE)
        header("(Amount in ₹)", sz=9, bg=C_LIGHT_BLUE, fg=C_BLACK, bold=False)
        col_header()

        # ── EQUITY & LIABILITIES ──────────────────────────────────────────────
        subheader("I.  SHAREHOLDERS' FUNDS")
        sc_r  = row("  a)  Share Capital",           fd.share_capital(),       note="1", indent=0)
        res_r = row("  b)  Reserves & Surplus",      fd.reserves_surplus(),    note="2", indent=0)
        row("Total Shareholders' Funds",
            None, bold=True, total=True)
        ws[f"C{r-1}"].value = f"=C{sc_r}+C{res_r}"
        ws[f"C{r-1}"].number_format = INR
        spacer()

        subheader("II.  NON-CURRENT LIABILITIES")
        ltb_r = row("  a)  Long-Term Borrowings",    fd.long_term_borrowings(), note="3", indent=0)
        dtl_r = row("  b)  Deferred Tax Liability",  fd.deferred_tax_liability(), indent=0)
        row("Total Non-Current Liabilities",
            None, bold=True, total=True)
        ws[f"C{r-1}"].value = f"=C{ltb_r}+C{dtl_r}"
        ws[f"C{r-1}"].number_format = INR
        spacer()

        subheader("III.  CURRENT LIABILITIES")
        stb_r  = row("  a)  Short-Term Borrowings",  fd.short_term_borrowings(), note="4", indent=0)
        tp_r   = row("  b)  Trade Payables",         fd.trade_payables(),         note="5", indent=0)
        dt_r   = row("  c)  Duties & Taxes (Net)",   max(0, fd.duties_and_taxes_net()), indent=0)
        ocl_r  = row("  d)  Other Current Liabilities", fd.other_current_liabilities(), note="6", indent=0)
        prov_r = row("  e)  Short-Term Provisions",  fd.short_term_provisions(),  note="7", indent=0)
        row("Total Current Liabilities",
            None, bold=True, total=True)
        ws[f"C{r-1}"].value = f"=C{stb_r}+C{tp_r}+C{dt_r}+C{ocl_r}+C{prov_r}"
        ws[f"C{r-1}"].number_format = INR
        total_cl_r = r - 1
        spacer()

        # Grand total E&L
        row("TOTAL EQUITY & LIABILITIES", None, bold=True)
        ws[f"C{r-1}"].value = fd.total_equity_liabilities()
        ws[f"C{r-1}"].number_format = INR
        ws[f"C{r-1}"].font = _font(bold=True, size=11)
        ws[f"C{r-1}"].fill = _fill(C_HEADER_BG)
        ws[f"C{r-1}"].font = Font(bold=True, size=11, color=C_WHITE, name="Calibri")
        ws[f"A{r-1}"].fill = _fill(C_HEADER_BG)
        ws[f"A{r-1}"].font = Font(bold=True, size=11, color=C_WHITE, name="Calibri")
        total_el_row = r - 1
        spacer(); spacer()

        # ── ASSETS ───────────────────────────────────────────────────────────
        subheader("I.  NON-CURRENT ASSETS")
        fa_r   = row("  a)  Fixed Assets (Net Block)",     fd.net_fixed_assets(),          note="8", indent=0)
        inv_r  = row("  b)  Non-Current Investments",      fd.non_current_investments(),   note="9", indent=0)
        lla_r  = row("  c)  Long-Term Loans & Advances",   fd.long_term_loans_advances(),  note="10", indent=0)
        dta_r  = row("  d)  Deferred Tax Asset",           fd.deferred_tax_asset(),        indent=0)
        ona_r  = row("  e)  Other Non-Current Assets",     fd.other_noncurrent_assets(),   indent=0)
        row("Total Non-Current Assets",
            None, bold=True, total=True)
        ws[f"C{r-1}"].value = f"=C{fa_r}+C{inv_r}+C{lla_r}+C{dta_r}+C{ona_r}"
        ws[f"C{r-1}"].number_format = INR
        spacer()

        subheader("II.  CURRENT ASSETS")
        stk_r  = row("  a)  Inventories (Closing Stock)",  fd.closing_stock(),             note="11", indent=0)
        tr_r   = row("  b)  Trade Receivables",            fd.trade_receivables(),         note="12", indent=0)
        cb_r   = row("  c)  Cash & Cash Equivalents",      fd.cash_and_bank(),             note="13", indent=0)
        oca_r  = row("  d)  Other Current Assets",         fd.other_current_assets(),      note="14", indent=0)
        row("Total Current Assets",
            None, bold=True, total=True)
        ws[f"C{r-1}"].value = f"=C{stk_r}+C{tr_r}+C{cb_r}+C{oca_r}"
        ws[f"C{r-1}"].number_format = INR
        spacer()

        row("TOTAL ASSETS", None, bold=True)
        ws[f"C{r-1}"].value = fd.total_assets()
        ws[f"C{r-1}"].number_format = INR
        ws[f"C{r-1}"].font = Font(bold=True, size=11, color=C_WHITE, name="Calibri")
        ws[f"C{r-1}"].fill = _fill(C_HEADER_BG)
        ws[f"A{r-1}"].fill = _fill(C_HEADER_BG)
        ws[f"A{r-1}"].font = Font(bold=True, size=11, color=C_WHITE, name="Calibri")
        spacer(); spacer()

        # ── Difference check ─────────────────────────────────────────────────
        diff = fd.total_assets() - fd.total_equity_liabilities()
        row("Balance Sheet Difference (should be 0)", diff,
            bold=True if abs(diff) > 1 else False)
        if abs(diff) > 1:
            ws[f"C{r-1}"].fill = _fill("FF0000")
            ws[f"C{r-1}"].font = Font(bold=True, size=10, color=C_WHITE)
        spacer(); spacer()

        # ── Notes ─────────────────────────────────────────────────────────────
        def note_header(num: int, title: str):
            nonlocal r
            ws.merge_cells(f"A{r}:D{r}")
            c = ws[f"A{r}"]
            c.value = f"Note {num}:  {title}"
            c.font = _font(bold=True, size=10)
            c.fill = _fill(C_SUBHD_BG)
            c.border = _border()
            r += 1

        def note_row(label: str, amount: float | None = None, bold=False, total=False):
            nonlocal r
            ws[f"A{r}"].value = "    " + label
            ws[f"A{r}"].font = _font(bold=bold or total, size=9)
            if amount is not None:
                ws[f"C{r}"].value = amount
                ws[f"C{r}"].number_format = INR
                ws[f"C{r}"].font = _font(bold=bold or total, size=9)
                ws[f"C{r}"].alignment = _align("right")
            if total:
                ws[f"A{r}"].fill = _fill(C_TOTAL_BG)
                ws[f"C{r}"].fill = _fill(C_TOTAL_BG)
            r += 1

        # Note 1 – Share Capital
        note_header(1, "Share Capital")
        for l in fd._ledgers_for("Capital Account"):
            if "reserve" not in l.name.lower() and "profit" not in l.name.lower():
                note_row(l.name, l.closing)
        note_row("Total Share Capital", fd.share_capital(), total=True)
        spacer()

        # Note 2 – Reserves & Surplus
        note_header(2, "Reserves & Surplus")
        for l in fd._ledgers_for("Capital Account"):
            if "reserve" in l.name.lower():
                note_row(l.name, l.closing)
        for l in fd._ledgers_for("Reserves & Surplus"):
            note_row(l.name, l.closing)
        note_row("Profit for the year (from P&L)", fd.pnl_balance)
        note_row("Total Reserves & Surplus", fd.reserves_surplus(), total=True)
        spacer()

        # Note 3 – Long-Term Borrowings
        note_header(3, "Long-Term Borrowings")
        note_row("Secured Loans")
        for l in fd._ledgers_for("Secured Loans"):
            note_row("  " + l.name, l.closing)
        note_row("Unsecured Loans")
        for l in fd._ledgers_for("Unsecured Loans"):
            note_row("  " + l.name, l.closing)
        note_row("Total Long-Term Borrowings", fd.long_term_borrowings(), total=True)
        spacer()

        # Note 4 – Short-Term Borrowings
        note_header(4, "Short-Term Borrowings (Bank OD / CC)")
        for l in fd._ledgers_for("Bank OD A/c"):
            note_row(l.name, l.closing)
        note_row("Total Short-Term Borrowings", fd.short_term_borrowings(), total=True)
        spacer()

        # Note 5 – Trade Payables
        note_header(5, "Trade Payables")
        by_parent: dict[str, float] = {}
        for l in fd._ledgers_for("Sundry Creditors"):
            by_parent[l.parent] = by_parent.get(l.parent, 0) + l.closing
        for parent, amt in sorted(by_parent.items()):
            note_row(parent, amt if amt > 0 else None)
        note_row("Total Trade Payables", fd.trade_payables(), total=True)
        spacer()

        # Note 8 – Fixed Assets Schedule
        note_header(8, "Fixed Assets")
        ws[f"A{r}"].value = "Asset Category"
        for col, lbl in [("B", "Gross Open"), ("C", "Gross Close"),
                          ("D", "Accum Depr"), ("E", "Net Block")]:
            ws.column_dimensions[col].width = 16
            ws[f"{col}{r}"].value = lbl
            ws[f"{col}{r}"].font = _font(bold=True, size=9)
            ws[f"{col}{r}"].fill = _fill(C_SUBHD_BG)
            ws[f"{col}{r}"].alignment = _align("center")
        r += 1
        for fa in fd.fixed_assets_schedule():
            ws[f"A{r}"].value = "    " + fa["name"]
            ws[f"A{r}"].font = _font(size=9)
            ws[f"B{r}"].value = fa["gross_open"];  ws[f"B{r}"].number_format = INR
            ws[f"C{r}"].value = fa["gross_close"]; ws[f"C{r}"].number_format = INR
            ws[f"D{r}"].value = fa["depr_close"];  ws[f"D{r}"].number_format = INR
            ws[f"E{r}"].value = fa["net_close"];   ws[f"E{r}"].number_format = INR
            for col in "BCDE":
                ws[f"{col}{r}"].font = _font(size=9)
                ws[f"{col}{r}"].alignment = _align("right")
            r += 1
        # Total row
        ws[f"A{r}"].value = "    Total Fixed Assets (Net)"
        ws[f"A{r}"].font = _font(bold=True, size=9)
        ws[f"E{r}"].value = fd.net_fixed_assets()
        ws[f"E{r}"].number_format = INR
        ws[f"E{r}"].font = _font(bold=True, size=9)
        ws[f"E{r}"].fill = _fill(C_TOTAL_BG)
        ws[f"A{r}"].fill = _fill(C_TOTAL_BG)
        r += 1; r += 1

        # Note 11 – Inventories
        note_header(11, "Inventories")
        note_row("Opening Stock",  fd.opening_stock())
        note_row("Closing Stock (as per books / entered)", fd.closing_stock())
        note_row("Net Inventory on Balance Sheet", fd.closing_stock(), total=True)
        spacer()

        # Note 12 – Trade Receivables
        note_header(12, "Trade Receivables")
        by_parent_dr: dict[str, float] = {}
        for l in fd._ledgers_for("Sundry Debtors"):
            by_parent_dr[l.parent] = by_parent_dr.get(l.parent, 0) + (-l.closing)
        for parent, amt in sorted(by_parent_dr.items()):
            note_row(parent, amt if abs(amt) > 0 else None)
        note_row("Total Trade Receivables", fd.trade_receivables(), total=True)
        spacer()

        # Note 13 – Cash & Cash Equivalents
        note_header(13, "Cash & Cash Equivalents")
        note_row("Cash-in-hand")
        for l in fd._ledgers_for("Cash-in-hand"):
            note_row("  " + l.name, -l.closing)
        note_row("Bank Accounts")
        for l in fd._ledgers_for("Bank Accounts"):
            note_row("  " + l.name, -l.closing)
        note_row("Total Cash & Cash Equivalents", fd.cash_and_bank(), total=True)
        spacer()

        ws.freeze_panes = "A6"

    # ── P&L Statement ─────────────────────────────────────────────────────────

    def _write_pnl(self) -> None:
        ws = self.wb.create_sheet("P&L Statement")
        fd = self.fd
        ws.column_dimensions["A"].width = 50
        ws.column_dimensions["B"].width = 8
        ws.column_dimensions["C"].width = 18

        r = 1

        def header(text, bg=C_HEADER_BG, fg=C_WHITE, sz=12, bold=True):
            nonlocal r
            ws.merge_cells(f"A{r}:C{r}")
            c = ws[f"A{r}"]
            c.value = text
            c.font = _font(bold=bold, size=sz, color=fg)
            c.fill = _fill(bg)
            c.alignment = _align("center")
            r += 1

        def row(label, amount=None, bold=False, total=False, indent=0, italic=False, bg=None):
            nonlocal r
            ws[f"A{r}"].value = "  " * indent + label
            ws[f"A{r}"].font = _font(bold=bold or total, size=10, name="Calibri")
            if italic:
                ws[f"A{r}"].font = Font(italic=True, size=10, name="Calibri")
            if amount is not None:
                ws[f"C{r}"].value = amount
                ws[f"C{r}"].number_format = INR
                ws[f"C{r}"].font = _font(bold=bold or total, size=10)
                ws[f"C{r}"].alignment = _align("right")
            if total or bg:
                col_bg = bg or C_TOTAL_BG
                ws[f"A{r}"].fill = _fill(col_bg)
                ws[f"C{r}"].fill = _fill(col_bg)
            r += 1
            return r - 1

        def spacer():
            nonlocal r; r += 1

        header(fd.company.upper(), sz=13)
        header("STATEMENT OF PROFIT & LOSS", sz=11)
        header(f"For the Year Ended {fd.period_label}", sz=10, bg=C_MID_BLUE)
        header("(Amount in ₹)", sz=9, bg=C_LIGHT_BLUE, fg=C_BLACK, bold=False)

        # Column labels
        ws[f"A{r}"].value = "Particulars"
        ws[f"B{r}"].value = "Note"
        ws[f"C{r}"].value = "Current Year"
        for col in "ABC":
            c = ws[f"{col}{r}"]
            c.font = _font(bold=True, size=9, color=C_WHITE)
            c.fill = _fill(C_MID_BLUE)
            c.alignment = _align("center")
            c.border = _border()
        r += 1

        # ── Revenue ──────────────────────────────────────────────────────────
        rev_r  = row("I.   Revenue from Operations",  fd.revenue_from_ops(), bold=True)
        oth_r  = row("II.  Other Income",              fd.other_income(),    bold=True)
        tot_r  = row("III. Total Revenue (I + II)",    None, bold=True, total=True)
        ws[f"C{tot_r}"].value  = f"=C{rev_r}+C{oth_r}"
        ws[f"C{tot_r}"].number_format = INR
        spacer()

        # ── Expenses ─────────────────────────────────────────────────────────
        row("IV.  Expenses", bold=True)
        pur_r  = row("     a)  Cost of Materials / Purchases", fd.purchases(), indent=1)
        chg_r  = row("     b)  Changes in Inventories",
                      fd.opening_stock() - fd.closing_stock(), indent=1,
                      italic=True)
        row("          (Opening Stock - Closing Stock)", italic=True, indent=2)
        emp_r  = row("     c)  Employee Benefits Expense",  fd.employee_costs(), indent=1)
        fin_r  = row("     d)  Finance Costs",              fd.finance_costs(), indent=1)
        dep_r  = row("     e)  Depreciation & Amortisation",fd.depreciation_from_fa(), indent=1)
        oth2_r = row("     f)  Other Expenses",             fd.other_indirect_expenses() + fd.direct_expenses(), indent=1)

        # Show breakdown of Other Expenses
        row("          Direct Expenses", fd.direct_expenses(), indent=3, italic=True)
        row("          Indirect Expenses (excl. Finance & Employee)", fd.other_indirect_expenses(), indent=3, italic=True)

        tot_exp_r = row("     Total Expenses", None, bold=True, total=True)
        ws[f"C{tot_exp_r}"].value = (
            f"=C{pur_r}+C{chg_r}+C{emp_r}+C{fin_r}+C{dep_r}+C{oth2_r}"
        )
        ws[f"C{tot_exp_r}"].number_format = INR
        spacer()

        # ── Profit lines ─────────────────────────────────────────────────────
        pbt_r = row("V.   Profit Before Tax (III − Expenses)", None, bold=True, total=True)
        ws[f"C{pbt_r}"].value = f"=C{tot_r}-C{tot_exp_r}"
        ws[f"C{pbt_r}"].number_format = INR

        tax_r = row("VI.  Tax Expense (Deferred Tax Provision)", fd.tax_expense())
        pat_r = row("VII. Profit After Tax", None, bold=True, bg=C_HEADER_BG)
        ws[f"C{pat_r}"].value = f"=C{pbt_r}-C{tax_r}"
        ws[f"C{pat_r}"].number_format = INR
        ws[f"C{pat_r}"].font = Font(bold=True, size=11, color=C_WHITE, name="Calibri")
        ws[f"A{pat_r}"].font = Font(bold=True, size=11, color=C_WHITE, name="Calibri")
        spacer(); spacer()

        # ── Key ratios ───────────────────────────────────────────────────────
        ws.merge_cells(f"A{r}:C{r}")
        ws[f"A{r}"].value = "KEY FINANCIAL RATIOS"
        ws[f"A{r}"].font = _font(bold=True, size=10, color=C_WHITE)
        ws[f"A{r}"].fill = _fill(C_MID_BLUE)
        r += 1

        rev = fd.revenue_from_ops()
        gp  = rev - fd.purchases() + (fd.closing_stock() - fd.opening_stock())
        ebitda = fd.profit_before_tax() + fd.finance_costs() + fd.depreciation_from_fa()
        ratios = [
            ("Gross Profit", gp, f"{gp/rev*100:.1f}% of Revenue" if rev else "N/A"),
            ("EBITDA", ebitda, f"{ebitda/rev*100:.1f}% of Revenue" if rev else "N/A"),
            ("PBT", fd.profit_before_tax(), f"{fd.profit_before_tax()/rev*100:.1f}% of Revenue" if rev else "N/A"),
            ("PAT", fd.profit_after_tax(), f"{fd.profit_after_tax()/rev*100:.1f}% of Revenue" if rev else "N/A"),
        ]
        for lbl, amt, ratio in ratios:
            ws[f"A{r}"].value = "  " + lbl
            ws[f"C{r}"].value = amt
            ws[f"C{r}"].number_format = INR
            ws[f"C{r}"].alignment = _align("right")
            # ratio in column B area as comment
            ws[f"B{r}"].value = ratio
            ws[f"B{r}"].font = _font(size=8, color="595959")
            ws[f"B{r}"].alignment = _align("center", wrap=True)
            ws.column_dimensions["B"].width = 20
            r += 1

        ws.freeze_panes = "A6"

    # ── Projected P&L ─────────────────────────────────────────────────────────

    def _write_proj_pnl(self, pe: "ProjectionEngine") -> None:
        ws = self.wb.create_sheet("Projected P&L")
        fd = self.fd
        ws.column_dimensions["A"].width = 42
        for col, lbl in [("B", "Base Year"), ("C", "Year 1"), ("D", "Year 2"), ("E", "Year 3")]:
            ws.column_dimensions[col].width = 16

        r = 1
        ws.merge_cells(f"A{r}:E{r}")
        ws[f"A{r}"].value = f"{fd.company.upper()} — PROJECTED PROFIT & LOSS (3 YEARS)"
        ws[f"A{r}"].font = _font(bold=True, size=12, color=C_WHITE)
        ws[f"A{r}"].fill = _fill(C_HEADER_BG)
        ws[f"A{r}"].alignment = _align("center")
        r += 1

        ws.merge_cells(f"A{r}:E{r}")
        ws[f"A{r}"].value = "Figures in ₹ | Projections are management estimates"
        ws[f"A{r}"].font = _font(size=9, color="595959")
        ws[f"A{r}"].alignment = _align("center")
        r += 1

        # Column headers
        years = [fd.period_label, "Year 1", "Year 2", "Year 3"]
        for i, col in enumerate(["A", "B", "C", "D", "E"]):
            ws[f"{col}{r}"].value = "Particulars" if i == 0 else years[i-1]
            ws[f"{col}{r}"].font = _font(bold=True, size=9, color=C_WHITE)
            ws[f"{col}{r}"].fill = _fill(C_MID_BLUE)
            ws[f"{col}{r}"].alignment = _align("center" if i > 0 else "left")
        r += 1

        pnl = pe.projected_pnl()  # list of 3 year dicts

        def proj_row(label: str, base_val: float, proj_vals: list[float],
                     bold=False, total=False, bg=None, fmt=INR):
            nonlocal r
            ws[f"A{r}"].value = label
            ws[f"A{r}"].font = _font(bold=bold or total)
            ws[f"B{r}"].value = base_val
            ws[f"B{r}"].number_format = fmt
            ws[f"B{r}"].alignment = _align("right")
            for i, (col, val) in enumerate(zip(["C", "D", "E"], proj_vals)):
                ws[f"{col}{r}"].value = val
                ws[f"{col}{r}"].number_format = fmt
                ws[f"{col}{r}"].font = _font(bold=bold or total)
                ws[f"{col}{r}"].alignment = _align("right")
            if total or bg:
                fill_c = bg or C_TOTAL_BG
                for col in ["A", "B", "C", "D", "E"]:
                    ws[f"{col}{r}"].fill = _fill(fill_c)
            r += 1

        base = fd  # actual year
        proj_row("Revenue from Operations",
                 base.revenue_from_ops(), [p["revenue"] for p in pnl], bold=True)
        proj_row("Other Income",
                 base.other_income(), [p["other_income"] for p in pnl])
        proj_row("TOTAL REVENUE",
                 base.revenue_from_ops() + base.other_income(),
                 [p["revenue"] + p["other_income"] for p in pnl],
                 total=True)
        r += 1
        proj_row("Cost of Materials / Purchases",
                 base.purchases(), [p["cogs"] for p in pnl])
        proj_row("Changes in Inventories",
                 base.opening_stock() - base.closing_stock(),
                 [p["stock_change"] for p in pnl])
        proj_row("Gross Profit",
                 base.revenue_from_ops() - base.purchases() + (base.closing_stock() - base.opening_stock()),
                 [p["gross_profit"] for p in pnl], bold=True, bg=C_LIGHT_BLUE)
        r += 1
        proj_row("Employee Benefits Expense",
                 base.employee_costs(), [p["employee"] for p in pnl])
        proj_row("Finance Costs",
                 base.finance_costs(), [p["finance"] for p in pnl])
        proj_row("Depreciation",
                 base.depreciation_from_fa(), [p["depreciation"] for p in pnl])
        proj_row("Other Expenses",
                 base.other_indirect_expenses() + base.direct_expenses(),
                 [p["other_expenses"] for p in pnl])
        proj_row("TOTAL EXPENSES",
                 base.total_expenses(),
                 [p["total_expenses"] for p in pnl], total=True)
        r += 1
        proj_row("EBITDA",
                 base.profit_before_tax() + base.finance_costs() + base.depreciation_from_fa(),
                 [p["ebitda"] for p in pnl], bold=True)
        proj_row("Profit Before Tax",
                 base.profit_before_tax(), [p["pbt"] for p in pnl], bold=True)
        proj_row("Tax Expense",
                 base.tax_expense(), [p["tax"] for p in pnl])
        proj_row("PROFIT AFTER TAX",
                 base.profit_after_tax(), [p["pat"] for p in pnl],
                 bold=True, bg=C_HEADER_BG)
        # Colour PAT row white text
        for col in ["A","B","C","D","E"]:
            ws[f"{col}{r-1}"].font = Font(bold=True, size=10, color=C_WHITE, name="Calibri")

        r += 2
        # Growth % rows
        ws.merge_cells(f"A{r}:E{r}")
        ws[f"A{r}"].value = "GROWTH & MARGIN METRICS"
        ws[f"A{r}"].font = _font(bold=True, size=9, color=C_WHITE)
        ws[f"A{r}"].fill = _fill(C_MID_BLUE)
        r += 1
        for metric, base_v, proj_vs in [
            ("Revenue Growth %", None, [p.get("revenue_growth") for p in pnl]),
            ("Gross Margin %", (base.revenue_from_ops() - base.purchases() + base.closing_stock() - base.opening_stock()) / base.revenue_from_ops() * 100 if base.revenue_from_ops() else 0,
             [p["gross_margin_pct"] for p in pnl]),
            ("EBITDA Margin %", (base.profit_before_tax() + base.finance_costs() + base.depreciation_from_fa()) / base.revenue_from_ops() * 100 if base.revenue_from_ops() else 0,
             [p["ebitda_margin"] for p in pnl]),
            ("PAT Margin %", base.profit_after_tax() / base.revenue_from_ops() * 100 if base.revenue_from_ops() else 0,
             [p["pat_margin"] for p in pnl]),
        ]:
            ws[f"A{r}"].value = "  " + metric
            ws[f"A{r}"].font = _font(size=9)
            if base_v is not None:
                ws[f"B{r}"].value = base_v; ws[f"B{r}"].number_format = "0.0%"; ws[f"B{r}"].value = base_v / 100
            for col, val in zip(["C","D","E"], proj_vs):
                if val is not None:
                    ws[f"{col}{r}"].value = val / 100
                    ws[f"{col}{r}"].number_format = "0.0%"
                    ws[f"{col}{r}"].alignment = _align("right")
            r += 1

        ws.freeze_panes = "A5"

    # ── Projected Balance Sheet ───────────────────────────────────────────────

    def _write_proj_bs(self, pe: "ProjectionEngine") -> None:
        ws = self.wb.create_sheet("Projected Balance Sheet")
        fd = self.fd
        ws.column_dimensions["A"].width = 46
        for col in ["B","C","D","E"]:
            ws.column_dimensions[col].width = 16

        r = 1
        ws.merge_cells(f"A{r}:E{r}")
        ws[f"A{r}"].value = f"{fd.company.upper()} — PROJECTED BALANCE SHEET (3 YEARS)"
        ws[f"A{r}"].font = _font(bold=True, size=12, color=C_WHITE)
        ws[f"A{r}"].fill = _fill(C_HEADER_BG)
        ws[f"A{r}"].alignment = _align("center")
        r += 1

        ws.merge_cells(f"A{r}:E{r}")
        ws[f"A{r}"].value = "Provisional / Projected — For Discussion Purposes Only"
        ws[f"A{r}"].font = _font(size=9, color="FF0000")
        ws[f"A{r}"].alignment = _align("center")
        r += 1

        for i, (col, lbl) in enumerate(zip(["A","B","C","D","E"],
                                ["Particulars", "Base Year", "Year 1", "Year 2", "Year 3"])):
            ws[f"{col}{r}"].value = lbl
            ws[f"{col}{r}"].font = _font(bold=True, size=9, color=C_WHITE)
            ws[f"{col}{r}"].fill = _fill(C_MID_BLUE)
            ws[f"{col}{r}"].alignment = _align("left" if i == 0 else "center")
        r += 1

        bs = pe.projected_bs()

        def bs_row(label, base_val, proj_vals, bold=False, total=False, bg=None):
            nonlocal r
            ws[f"A{r}"].value = label
            ws[f"A{r}"].font = _font(bold=bold or total)
            ws[f"B{r}"].value = base_val; ws[f"B{r}"].number_format = INR
            ws[f"B{r}"].alignment = _align("right")
            for col, val in zip(["C","D","E"], proj_vals):
                ws[f"{col}{r}"].value = val
                ws[f"{col}{r}"].number_format = INR
                ws[f"{col}{r}"].font = _font(bold=bold or total)
                ws[f"{col}{r}"].alignment = _align("right")
            if total or bg:
                for col in ["A","B","C","D","E"]:
                    ws[f"{col}{r}"].fill = _fill(bg or C_TOTAL_BG)
            r += 1

        ws.merge_cells(f"A{r}:E{r}")
        ws[f"A{r}"].value = "EQUITY & LIABILITIES"; ws[f"A{r}"].font = _font(bold=True); ws[f"A{r}"].fill = _fill(C_SUBHD_BG); r += 1
        bs_row("  Share Capital",         fd.share_capital(),         [b["share_capital"] for b in bs])
        bs_row("  Reserves & Surplus",    fd.reserves_surplus(),      [b["reserves"] for b in bs], bold=True)
        bs_row("Total Equity",
               fd.total_equity(),         [b["total_equity"] for b in bs], total=True)
        r += 1
        ws.merge_cells(f"A{r}:E{r}")
        ws[f"A{r}"].value = "Non-Current Liabilities"; ws[f"A{r}"].font = _font(bold=True); ws[f"A{r}"].fill = _fill(C_SUBHD_BG); r += 1
        bs_row("  Long-Term Borrowings",  fd.long_term_borrowings(),  [b["lt_borrowings"] for b in bs])
        bs_row("  Deferred Tax Liability",fd.deferred_tax_liability(),[b["dtl"] for b in bs])
        r += 1
        ws.merge_cells(f"A{r}:E{r}")
        ws[f"A{r}"].value = "Current Liabilities"; ws[f"A{r}"].font = _font(bold=True); ws[f"A{r}"].fill = _fill(C_SUBHD_BG); r += 1
        bs_row("  Short-Term Borrowings", fd.short_term_borrowings(), [b["st_borrowings"] for b in bs])
        bs_row("  Trade Payables",        fd.trade_payables(),        [b["trade_payables"] for b in bs])
        bs_row("  Other Current Liab.",   fd.other_current_liabilities() + max(0, fd.duties_and_taxes_net()),
                                          [b["other_cl"] for b in bs])
        bs_row("  Short-Term Provisions", fd.short_term_provisions(), [b["provisions"] for b in bs])
        bs_row("TOTAL EQUITY & LIABILITIES",
               fd.total_equity_liabilities(), [b["total_el"] for b in bs],
               bold=True, bg=C_HEADER_BG)
        for col in ["A","B","C","D","E"]:
            ws[f"{col}{r-1}"].font = Font(bold=True, size=10, color=C_WHITE, name="Calibri")

        r += 2
        ws.merge_cells(f"A{r}:E{r}")
        ws[f"A{r}"].value = "ASSETS"; ws[f"A{r}"].font = _font(bold=True); ws[f"A{r}"].fill = _fill(C_SUBHD_BG); r += 1
        bs_row("  Fixed Assets (Net)",    fd.net_fixed_assets(),      [b["fixed_assets"] for b in bs])
        bs_row("  Long-Term Loans & Adv.",fd.long_term_loans_advances(),[b["lt_loans"] for b in bs])
        bs_row("Total Non-Current Assets",
               fd.total_noncurrent_assets(), [b["total_nca"] for b in bs], total=True)
        r += 1
        bs_row("  Inventories",           fd.closing_stock(),         [b["inventory"] for b in bs])
        bs_row("  Trade Receivables",     fd.trade_receivables(),     [b["debtors"] for b in bs])
        bs_row("  Cash & Cash Equiv.",    fd.cash_and_bank(),         [b["cash"] for b in bs])
        bs_row("  Other Current Assets",  fd.other_current_assets(),  [b["other_ca"] for b in bs])
        bs_row("Total Current Assets",
               fd.total_current_assets(), [b["total_ca"] for b in bs], total=True)
        r += 1
        bs_row("TOTAL ASSETS",
               fd.total_assets(),         [b["total_assets"] for b in bs],
               bold=True, bg=C_HEADER_BG)
        for col in ["A","B","C","D","E"]:
            ws[f"{col}{r-1}"].font = Font(bold=True, size=10, color=C_WHITE, name="Calibri")

        ws.freeze_panes = "A5"

    # ── Assumptions sheet ─────────────────────────────────────────────────────

    def _write_assumptions(self) -> None:
        ws = self.wb.create_sheet("Assumptions")
        p = self.proj
        ws.column_dimensions["A"].width = 40
        ws.column_dimensions["B"].width = 18

        ws.merge_cells("A1:B1")
        ws["A1"].value = "PROJECTION ASSUMPTIONS"
        ws["A1"].font = _font(bold=True, size=12, color=C_WHITE)
        ws["A1"].fill = _fill(C_HEADER_BG)
        ws["A1"].alignment = _align("center")

        rows = [
            ("Revenue Growth – Year 1",         f"{p.rev_growth_y1:.1f}%"),
            ("Revenue Growth – Year 2",         f"{p.rev_growth_y2:.1f}%"),
            ("Revenue Growth – Year 3",         f"{p.rev_growth_y3:.1f}%"),
            ("Gross Margin %",                  f"{p.gross_margin_pct:.1f}%"),
            ("Operating Expenses Growth %",     f"{p.opex_growth_pct:.1f}%"),
            ("Inventory / COGS Days",           f"{p.inventory_days:.0f} days"),
            ("Debtor Days",                     f"{p.debtor_days:.0f} days"),
            ("Creditor Days",                   f"{p.creditor_days:.0f} days"),
            ("Annual Loan Repayment (₹)",       f"₹ {p.loan_repayment_pa:,.0f}"),
            ("New Borrowings per Year (₹)",     f"₹ {p.new_borrowings_pa:,.0f}"),
            ("Interest Rate %",                 f"{p.interest_rate_pct:.1f}%"),
            ("Capital Expenditure / Year (₹)",  f"₹ {p.capex_pa:,.0f}"),
            ("Depreciation Rate (WDV) %",       f"{p.depreciation_rate_pct:.1f}%"),
            ("Effective Tax Rate %",            f"{p.tax_rate_pct:.1f}%"),
            ("Other Income (fixed ₹ / year)",   f"₹ {p.other_income_pa:,.0f}"),
        ]
        for i, (lbl, val) in enumerate(rows, start=2):
            ws[f"A{i}"].value = lbl
            ws[f"A{i}"].font = _font(size=10)
            ws[f"B{i}"].value = val
            ws[f"B{i}"].font = _font(size=10, bold=True)
            ws[f"B{i}"].alignment = _align("right")
            if i % 2 == 0:
                ws[f"A{i}"].fill = _fill(C_LIGHT_BLUE)
                ws[f"B{i}"].fill = _fill(C_LIGHT_BLUE)

        ws[f"A{len(rows)+3}"].value = "Generated on"
        ws[f"B{len(rows)+3}"].value = date.today().strftime("%d %B %Y")
        ws[f"A{len(rows)+3}"].font = _font(size=9, color="595959")
        ws[f"B{len(rows)+3}"].font = _font(size=9, color="595959")


# ─── Projection Engine ────────────────────────────────────────────────────────

@dataclass
class ProjectionInputs:
    rev_growth_y1:       float = 15.0   # %
    rev_growth_y2:       float = 15.0   # %
    rev_growth_y3:       float = 10.0   # %
    gross_margin_pct:    float = 30.0   # % of revenue
    opex_growth_pct:     float = 10.0   # % growth in operating expenses
    inventory_days:      float = 45.0   # days
    debtor_days:         float = 60.0   # days
    creditor_days:       float = 45.0   # days
    loan_repayment_pa:   float = 0.0    # ₹ per year
    new_borrowings_pa:   float = 0.0    # ₹ per year
    interest_rate_pct:   float = 14.0   # % on average borrowings
    capex_pa:            float = 0.0    # ₹ per year
    depreciation_rate_pct: float = 15.0 # % WDV
    tax_rate_pct:        float = 25.0   # %
    other_income_pa:     float = 0.0    # ₹ fixed per year


class ProjectionEngine:
    def __init__(self, fd: FinancialData, p: ProjectionInputs):
        self.fd = fd
        self.p  = p

    def projected_pnl(self) -> list[dict]:
        fd = self.fd
        p  = self.p
        base_rev  = fd.revenue_from_ops()
        base_opex = (fd.employee_costs()
                     + fd.other_indirect_expenses()
                     + fd.direct_expenses())

        results = []
        prev_rev = base_rev
        prev_rev_growth = None
        growth_rates = [p.rev_growth_y1, p.rev_growth_y2, p.rev_growth_y3]

        for yr_idx, g in enumerate(growth_rates):
            rev = prev_rev * (1 + g / 100)
            cogs = rev * (1 - p.gross_margin_pct / 100)
            stock_change = -(rev / 365 * p.inventory_days - fd.closing_stock()) if yr_idx == 0 else 0
            gross_profit = rev - cogs + stock_change

            opex_mult = (1 + p.opex_growth_pct / 100) ** (yr_idx + 1)
            employee  = fd.employee_costs() * opex_mult
            other_exp = (fd.other_indirect_expenses() + fd.direct_expenses()) * opex_mult

            # Borrowings for interest calculation
            lt_borr = max(0, fd.long_term_borrowings()
                          + (p.new_borrowings_pa - p.loan_repayment_pa) * (yr_idx + 1))
            st_borr = fd.short_term_borrowings()
            avg_borr = lt_borr + st_borr
            finance  = avg_borr * p.interest_rate_pct / 100

            # Depreciation (WDV)
            if yr_idx == 0:
                fa_base = fd.net_fixed_assets() + p.capex_pa
            else:
                fa_base = results[-1]["net_fa"]
            depr = fa_base * p.depreciation_rate_pct / 100
            net_fa = fa_base - depr + p.capex_pa

            total_exp = cogs + employee + finance + depr + other_exp
            ebitda    = rev - cogs - employee - other_exp
            pbt       = rev - total_exp + p.other_income_pa
            tax       = max(0, pbt * p.tax_rate_pct / 100)
            pat       = pbt - tax

            results.append({
                "revenue":          rev,
                "revenue_growth":   g,
                "other_income":     p.other_income_pa,
                "cogs":             cogs,
                "stock_change":     stock_change,
                "gross_profit":     gross_profit,
                "gross_margin_pct": p.gross_margin_pct,
                "employee":         employee,
                "finance":          finance,
                "depreciation":     depr,
                "other_expenses":   other_exp,
                "total_expenses":   total_exp,
                "ebitda":           ebitda,
                "ebitda_margin":    ebitda / rev * 100 if rev else 0,
                "pbt":              pbt,
                "tax":              tax,
                "pat":              pat,
                "pat_margin":       pat / rev * 100 if rev else 0,
                "net_fa":           net_fa,
            })
            prev_rev = rev

        return results

    def projected_bs(self) -> list[dict]:
        fd = self.fd
        p  = self.p
        pnl = self.projected_pnl()

        bs_list = []
        prev_reserves = fd.reserves_surplus()
        prev_lt_borr  = fd.long_term_borrowings()
        prev_fa       = fd.net_fixed_assets()

        for yr_idx, yr in enumerate(pnl):
            rev  = yr["revenue"]
            cogs = yr["cogs"]
            pat  = yr["pat"]

            # Equity
            reserves    = prev_reserves + pat
            share_cap   = fd.share_capital()
            total_equity = share_cap + reserves

            # Borrowings
            lt_borr = max(0, prev_lt_borr + p.new_borrowings_pa - p.loan_repayment_pa)
            st_borr = fd.short_term_borrowings()

            # Working capital
            inventory = cogs / 365 * p.inventory_days
            debtors   = rev  / 365 * p.debtor_days
            creditors = cogs / 365 * p.creditor_days

            # Fixed assets
            fa = yr["net_fa"]

            # Other items (kept at base year)
            lt_loans = fd.long_term_loans_advances()
            other_ca = fd.other_current_assets()
            provisions = fd.short_term_provisions()
            dtl       = fd.deferred_tax_liability()

            # Total liabilities
            other_cl = fd.other_current_liabilities()
            total_el = total_equity + lt_borr + dtl + st_borr + creditors + other_cl + provisions

            # Cash (plug — balances the sheet)
            total_nca  = fa + lt_loans
            total_excl_cash = total_nca + inventory + debtors + other_ca
            cash = total_el - total_excl_cash

            total_ca = inventory + debtors + cash + other_ca
            total_assets = total_nca + total_ca

            bs_list.append({
                "share_capital":  share_cap,
                "reserves":       reserves,
                "total_equity":   total_equity,
                "lt_borrowings":  lt_borr,
                "dtl":            dtl,
                "st_borrowings":  st_borr,
                "trade_payables": creditors,
                "other_cl":       other_cl,
                "provisions":     provisions,
                "total_el":       total_el,
                "fixed_assets":   fa,
                "lt_loans":       lt_loans,
                "total_nca":      total_nca,
                "inventory":      inventory,
                "debtors":        debtors,
                "cash":           cash,
                "other_ca":       other_ca,
                "total_ca":       total_ca,
                "total_assets":   total_assets,
            })
            prev_reserves = reserves
            prev_lt_borr  = lt_borr
            prev_fa       = fa

        return bs_list


# ─── Tkinter UI ───────────────────────────────────────────────────────────────

class App:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("Tally Financial Statements Generator")
        self.root.geometry("780x680")
        self.root.minsize(700, 600)
        self.root.configure(bg="#F0F4F8")

        self.db_path     = tk.StringVar()
        self.out_dir     = tk.StringVar(value=str(Path.home() / "Desktop"))
        self.op_stock    = tk.StringVar()
        self.cl_stock    = tk.StringVar()
        self.status_var  = tk.StringVar(value="Select a Tally SQLite file to begin.")
        self.fd: FinancialData | None = None

        # Projection inputs
        self.proj_vars: dict[str, tk.StringVar] = {
            "rev_growth_y1":       tk.StringVar(value="15"),
            "rev_growth_y2":       tk.StringVar(value="15"),
            "rev_growth_y3":       tk.StringVar(value="10"),
            "gross_margin_pct":    tk.StringVar(value="30"),
            "opex_growth_pct":     tk.StringVar(value="10"),
            "inventory_days":      tk.StringVar(value="45"),
            "debtor_days":         tk.StringVar(value="60"),
            "creditor_days":       tk.StringVar(value="45"),
            "loan_repayment_pa":   tk.StringVar(value="0"),
            "new_borrowings_pa":   tk.StringVar(value="0"),
            "interest_rate_pct":   tk.StringVar(value="14"),
            "capex_pa":            tk.StringVar(value="0"),
            "depreciation_rate_pct": tk.StringVar(value="15"),
            "tax_rate_pct":        tk.StringVar(value="25"),
            "other_income_pa":     tk.StringVar(value="0"),
        }

        self._build()
        self.root.mainloop()

    def _build(self) -> None:
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("TNotebook",        background="#F0F4F8")
        style.configure("TNotebook.Tab",    padding=[12, 6], font=("Calibri", 10, "bold"))
        style.configure("TFrame",           background="#F0F4F8")
        style.configure("TLabel",           background="#F0F4F8", font=("Calibri", 10))
        style.configure("TButton",          font=("Calibri", 10, "bold"), padding=6)
        style.configure("Accent.TButton",   font=("Calibri", 11, "bold"), padding=8)
        style.configure("TEntry",           font=("Calibri", 10))
        style.configure("TLabelframe",      background="#F0F4F8",
                         font=("Calibri", 10, "bold"))
        style.configure("TLabelframe.Label",background="#F0F4F8",
                         font=("Calibri", 10, "bold"))

        # ── Title bar ────────────────────────────────────────────────────────
        title_frame = tk.Frame(self.root, bg="#1F3864", pady=14)
        title_frame.pack(fill="x")
        tk.Label(title_frame,
                 text="Tally Financial Statements Generator",
                 bg="#1F3864", fg="white",
                 font=("Calibri", 15, "bold")).pack()
        tk.Label(title_frame,
                 text="Schedule III Balance Sheet  •  P&L  •  3-Year Projections",
                 bg="#1F3864", fg="#BDD7EE",
                 font=("Calibri", 10)).pack()

        main = ttk.Frame(self.root, padding=16)
        main.pack(fill="both", expand=True)

        # ── File selection ────────────────────────────────────────────────────
        file_frame = ttk.LabelFrame(main, text="  Database File", padding=10)
        file_frame.pack(fill="x", pady=(0, 10))
        file_frame.columnconfigure(1, weight=1)

        ttk.Label(file_frame, text="Tally SQLite:").grid(row=0, column=0, sticky="w", padx=(0,8))
        ttk.Entry(file_frame, textvariable=self.db_path, width=55).grid(row=0, column=1, sticky="ew")
        ttk.Button(file_frame, text="Browse…", command=self._pick_db).grid(row=0, column=2, padx=(8,0))

        ttk.Label(file_frame, text="Output Folder:").grid(row=1, column=0, sticky="w", padx=(0,8), pady=(6,0))
        ttk.Entry(file_frame, textvariable=self.out_dir, width=55).grid(row=1, column=1, sticky="ew", pady=(6,0))
        ttk.Button(file_frame, text="Browse…", command=self._pick_outdir).grid(row=1, column=2, padx=(8,0), pady=(6,0))

        # ── Tabs ─────────────────────────────────────────────────────────────
        self.nb = ttk.Notebook(main)
        self.nb.pack(fill="both", expand=True, pady=(0,10))

        self._build_actual_tab()
        self._build_proj_tab()

        # ── Status + action ───────────────────────────────────────────────────
        bottom = ttk.Frame(main)
        bottom.pack(fill="x")
        self.status_lbl = ttk.Label(bottom, textvariable=self.status_var,
                                    foreground="#2F5496")
        self.status_lbl.pack(side="left", fill="x", expand=True)
        ttk.Button(bottom, text="❌ Clear", command=self._clear,
                   style="TButton").pack(side="right", padx=(8,0))

    def _build_actual_tab(self) -> None:
        tab = ttk.Frame(self.nb, padding=12)
        self.nb.add(tab, text="Actual Statements")
        tab.columnconfigure(1, weight=1)

        # Stock adjustments
        stock_frame = ttk.LabelFrame(tab, text="  Stock Values", padding=10)
        stock_frame.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0,12))
        stock_frame.columnconfigure(1, weight=1)

        help_text = ("Tally's 'Closing Stock' ledger holds accounting-entry stock values.\n"
                     "Enter corrected values below if they differ from the audit trial balance.\n"
                     "Leave blank to use Tally's own figures.")
        ttk.Label(stock_frame, text=help_text, foreground="#595959",
                  font=("Calibri", 9)).grid(row=0, column=0, columnspan=3,
                                             sticky="w", pady=(0,8))

        ttk.Label(stock_frame, text="Opening Stock (₹):").grid(row=1, column=0, sticky="w", padx=(0,10))
        self.op_entry = ttk.Entry(stock_frame, textvariable=self.op_stock, width=20)
        self.op_entry.grid(row=1, column=1, sticky="w")
        ttk.Label(stock_frame, text="(from Tally if blank)",
                  foreground="#888", font=("Calibri",9)).grid(row=1, column=2, sticky="w", padx=8)

        ttk.Label(stock_frame, text="Closing Stock (₹):").grid(row=2, column=0, sticky="w", padx=(0,10), pady=(6,0))
        self.cl_entry = ttk.Entry(stock_frame, textvariable=self.cl_stock, width=20)
        self.cl_entry.grid(row=2, column=1, sticky="w", pady=(6,0))
        ttk.Label(stock_frame, text="(from Tally if blank)",
                  foreground="#888", font=("Calibri",9)).grid(row=2, column=2, sticky="w", padx=8, pady=(6,0))

        ttk.Button(stock_frame, text="Apply & Preview Numbers",
                   command=self._preview_actual).grid(row=3, column=0, columnspan=3,
                                                       pady=(10,0), sticky="w")

        # Preview panel
        self.preview_text = tk.Text(tab, height=16, width=72, font=("Courier", 9),
                                    bg="#FAFAFA", relief="flat", borderwidth=1)
        self.preview_text.grid(row=1, column=0, columnspan=2, sticky="nsew", pady=(0,8))
        tab.rowconfigure(1, weight=1)

        btn_frame = ttk.Frame(tab)
        btn_frame.grid(row=2, column=0, columnspan=2, sticky="ew")
        ttk.Button(btn_frame, text="Generate Actual Statements (Excel)",
                   command=self._gen_actual, style="Accent.TButton").pack(side="right")

    def _build_proj_tab(self) -> None:
        tab = ttk.Frame(self.nb, padding=12)
        self.nb.add(tab, text="3-Year Projections")

        canvas = tk.Canvas(tab, bg="#F0F4F8", highlightthickness=0)
        scrollbar = ttk.Scrollbar(tab, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)
        inner = ttk.Frame(canvas, padding=8)
        canvas_window = canvas.create_window((0, 0), window=inner, anchor="nw")

        def _on_configure(event):
            canvas.configure(scrollregion=canvas.bbox("all"))
            canvas.itemconfig(canvas_window, width=event.width if event.width > 1 else canvas.winfo_width())
        inner.bind("<Configure>", _on_configure)
        canvas.bind("<Configure>", _on_configure)

        inner.columnconfigure(1, weight=1)
        inner.columnconfigure(3, weight=1)

        fields = [
            ("Revenue Growth – Year 1 (%)",            "rev_growth_y1"),
            ("Revenue Growth – Year 2 (%)",            "rev_growth_y2"),
            ("Revenue Growth – Year 3 (%)",            "rev_growth_y3"),
            ("Gross Margin % (Revenue − COGS)",        "gross_margin_pct"),
            ("Operating Expense Growth (% per year)",  "opex_growth_pct"),
            ("Inventory Days (Stock / COGS × 365)",    "inventory_days"),
            ("Debtor Days (Receivables / Rev × 365)",  "debtor_days"),
            ("Creditor Days (Payables / COGS × 365)",  "creditor_days"),
            ("Loan Repayment per Year (₹)",            "loan_repayment_pa"),
            ("New Borrowings per Year (₹)",            "new_borrowings_pa"),
            ("Interest Rate on Borrowings (%)",        "interest_rate_pct"),
            ("Capital Expenditure per Year (₹)",       "capex_pa"),
            ("Depreciation Rate – WDV (%)",            "depreciation_rate_pct"),
            ("Effective Tax Rate (%)",                  "tax_rate_pct"),
            ("Other / Fixed Income per Year (₹)",      "other_income_pa"),
        ]

        hints = {
            "gross_margin_pct":  "Gross Profit as % of revenue (Revenue − Purchases ± Stock)",
            "debtor_days":       "Days outstanding for trade receivables",
            "creditor_days":     "Days outstanding for trade payables",
            "inventory_days":    "Days of stock held (based on COGS)",
            "interest_rate_pct": "Average annualised interest on total borrowings",
            "depreciation_rate_pct": "Written-down-value rate; 15% is typical for plant & equipment",
            "tax_rate_pct":      "Effective corporate tax rate (base rate 22% + surcharge ≈ 25.17%)",
        }

        for i, (label, key) in enumerate(fields):
            row_i = i // 2
            col_base = (i % 2) * 2
            ttk.Label(inner, text=label, font=("Calibri", 9)).grid(
                row=row_i, column=col_base, sticky="w", padx=(0,8), pady=4)
            e = ttk.Entry(inner, textvariable=self.proj_vars[key], width=14)
            e.grid(row=row_i, column=col_base + 1, sticky="ew", pady=4)
            if key in hints:
                e.bind("<FocusIn>", lambda ev, h=hints[key]: self._set_status(h))

        hint_r = len(fields) // 2 + 1
        hint_box = tk.Text(inner, height=5, font=("Calibri", 9), bg="#FFF9E6",
                           relief="flat", wrap="word", borderwidth=1)
        hint_box.insert("1.0",
            "GUIDANCE:\n"
            "• Gross Margin: for a trading company like Fortius, typical is 20–35%.\n"
            "• Debtor Days: if your debtors turn over in 60 days, enter 60.\n"
            "• Creditor Days: industry avg for electronics trading ≈ 30–45 days.\n"
            "• New Borrowings / Repayments: enter absolute ₹ values per year.\n"
            "• Leave CapEx at 0 if no new investments planned.\n"
            "• The projected Balance Sheet uses a cash plug to balance automatically.")
        hint_box.config(state="disabled")
        hint_box.grid(row=hint_r, column=0, columnspan=4, sticky="ew",
                      pady=(12,8), padx=4)

        btn_frame = ttk.Frame(inner)
        btn_frame.grid(row=hint_r + 1, column=0, columnspan=4, sticky="e", pady=8)
        ttk.Button(btn_frame, text="Generate Projected Statements + Actual (All Sheets)",
                   command=self._gen_all, style="Accent.TButton").pack(side="right")
        ttk.Button(btn_frame, text="Projections Only",
                   command=self._gen_proj_only, style="TButton").pack(side="right", padx=(0,8))

    # ── Actions ───────────────────────────────────────────────────────────────

    def _set_status(self, msg: str) -> None:
        self.status_var.set(msg)

    def _pick_db(self) -> None:
        path = filedialog.askopenfilename(
            title="Select Tally SQLite File",
            filetypes=[("SQLite Database", "*.sqlite *.db"), ("All Files", "*.*")]
        )
        if path:
            self.db_path.set(path)
            self._load_db()

    def _pick_outdir(self) -> None:
        d = filedialog.askdirectory(title="Select Output Folder")
        if d:
            self.out_dir.set(d)

    def _load_db(self) -> None:
        path = self.db_path.get()
        if not path or not os.path.isfile(path):
            return
        try:
            self.fd = load_from_sqlite(
                path,
                opening_stock_override=self._parse_stock(self.op_stock.get()),
                closing_stock_override=self._parse_stock(self.cl_stock.get()),
            )
            self._set_status(
                f"Loaded: {self.fd.company}  |  {self.fd.period_from} → {self.fd.period_to}"
            )
            self._preview_actual()
        except Exception as e:
            messagebox.showerror("Load Error", str(e))

    def _parse_stock(self, val: str) -> float | None:
        val = val.strip().replace(",", "")
        try:
            return float(val) if val else None
        except ValueError:
            return None

    def _get_fd(self) -> FinancialData | None:
        """Return (possibly refreshed) FinancialData."""
        path = self.db_path.get()
        if not path or not os.path.isfile(path):
            messagebox.showwarning("No File", "Please select a Tally SQLite file first.")
            return None
        try:
            fd = load_from_sqlite(
                path,
                opening_stock_override=self._parse_stock(self.op_stock.get()),
                closing_stock_override=self._parse_stock(self.cl_stock.get()),
            )
            self.fd = fd
            return fd
        except Exception as e:
            messagebox.showerror("Load Error", str(e))
            return None

    def _preview_actual(self) -> None:
        fd = self._get_fd()
        if fd is None:
            return
        self.preview_text.config(state="normal")
        self.preview_text.delete("1.0", "end")

        def line(label, amount, indent=0):
            prefix = "  " * indent
            self.preview_text.insert("end", f"{prefix}{label:<45} {amount:>16,.2f}\n")

        def divider():
            self.preview_text.insert("end", "─" * 64 + "\n")

        self.preview_text.insert("end",
            f"  {fd.company}\n"
            f"  Balance Sheet Preview — as at {fd.period_label}\n"
        )
        divider()
        self.preview_text.insert("end", "  EQUITY & LIABILITIES\n")
        line("Share Capital", fd.share_capital(), 1)
        line("Reserves & Surplus", fd.reserves_surplus(), 1)
        line("Long-Term Borrowings", fd.long_term_borrowings(), 1)
        line("Deferred Tax Liability", fd.deferred_tax_liability(), 1)
        line("Short-Term Borrowings (OD/CC)", fd.short_term_borrowings(), 1)
        line("Trade Payables", fd.trade_payables(), 1)
        line("Duties & Taxes (Net payable)", max(0, fd.duties_and_taxes_net()), 1)
        line("Other Current Liabilities", fd.other_current_liabilities(), 1)
        line("Short-Term Provisions", fd.short_term_provisions(), 1)
        divider()
        line("TOTAL EQUITY & LIABILITIES", fd.total_equity_liabilities(), 0)
        divider()
        self.preview_text.insert("end", "\n  ASSETS\n")
        line("Fixed Assets (Net)", fd.net_fixed_assets(), 1)
        line("Long-Term Loans & Advances", fd.long_term_loans_advances(), 1)
        line("Closing Stock (Inventories)", fd.closing_stock(), 1)
        line("Trade Receivables", fd.trade_receivables(), 1)
        line("Cash & Cash Equivalents", fd.cash_and_bank(), 1)
        line("Duties & Taxes Refund (GST/TDS)", fd.duties_and_taxes_asset(), 1)
        line("Other Current Assets", fd.other_current_assets(), 1)
        divider()
        line("TOTAL ASSETS", fd.total_assets(), 0)
        diff = fd.total_assets() - fd.total_equity_liabilities()
        divider()
        self.preview_text.insert("end", f"\n  Difference (Assets − E&L): {diff:,.2f}")
        if abs(diff) > 10:
            self.preview_text.insert("end", "  ← REVIEW REQUIRED\n")
        else:
            self.preview_text.insert("end", "  ← OK\n")

        self.preview_text.insert("end",
            f"\n  P&L SUMMARY\n"
            f"  Revenue from Operations: {fd.revenue_from_ops():>20,.2f}\n"
            f"  Cost of Materials:       {fd.purchases():>20,.2f}\n"
            f"  Gross Profit:            {fd.revenue_from_ops()-fd.purchases()+(fd.closing_stock()-fd.opening_stock()):>20,.2f}\n"
            f"  Finance Costs:           {fd.finance_costs():>20,.2f}\n"
            f"  Profit Before Tax:       {fd.profit_before_tax():>20,.2f}\n"
            f"  Profit After Tax:        {fd.profit_after_tax():>20,.2f}\n"
        )
        self.preview_text.config(state="disabled")

    def _get_proj_inputs(self) -> ProjectionInputs | None:
        try:
            return ProjectionInputs(**{
                k: float(v.get().replace(",",""))
                for k, v in self.proj_vars.items()
            })
        except ValueError as e:
            messagebox.showerror("Invalid Input",
                                 f"Please enter valid numbers in the projection fields.\n{e}")
            return None

    def _output_path(self, suffix="") -> str:
        fd = self.fd
        company_short = (fd.company.split()[0] if fd else "Company").replace(",","").replace(".","")
        year = fd.period_to[:4] if fd else "2026"
        fname = f"{company_short}_FinStatements_{year}{suffix}.xlsx"
        return str(Path(self.out_dir.get()) / fname)

    def _gen_actual(self) -> None:
        fd = self._get_fd()
        if fd is None:
            return
        out = self._output_path("_Actual")
        try:
            ExcelWriter(fd, proj=None).save(out)
            self._set_status(f"Saved: {out}")
            if messagebox.askyesno("Done", f"Excel saved:\n{out}\n\nOpen it now?"):
                os.startfile(out) if os.name == "nt" else os.system(f'open "{out}"')
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _gen_proj_only(self) -> None:
        fd = self._get_fd()
        if fd is None:
            return
        proj = self._get_proj_inputs()
        if proj is None:
            return
        out = self._output_path("_Projected")
        try:
            ew = ExcelWriter(fd, proj)
            ew.wb.remove   # keep actual sheets too
            ew.save(out)
            self._set_status(f"Saved: {out}")
            if messagebox.askyesno("Done", f"Excel saved:\n{out}\n\nOpen it now?"):
                os.startfile(out) if os.name == "nt" else os.system(f'open "{out}"')
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _gen_all(self) -> None:
        fd = self._get_fd()
        if fd is None:
            return
        proj = self._get_proj_inputs()
        if proj is None:
            return
        out = self._output_path("_Full")
        try:
            ExcelWriter(fd, proj).save(out)
            self._set_status(f"Saved: {out}")
            if messagebox.askyesno("Done", f"Excel saved:\n{out}\n\nOpen it now?"):
                os.startfile(out) if os.name == "nt" else os.system(f'open "{out}"')
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _clear(self) -> None:
        self.db_path.set("")
        self.op_stock.set("")
        self.cl_stock.set("")
        self.fd = None
        self.preview_text.config(state="normal")
        self.preview_text.delete("1.0", "end")
        self.preview_text.config(state="disabled")
        self._set_status("Cleared. Select a Tally SQLite file to begin.")


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    App()
