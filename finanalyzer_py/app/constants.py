from __future__ import annotations

TDS_SECTION_DEFAULTS: list[dict] = [
    {"code": "194C", "label": "Contractors", "singleTxnLimit": 30_000, "annualLimit": 100_000, "defaultRate": 1.0},
    {"code": "194J", "label": "Professional / Technical", "singleTxnLimit": 30_000, "annualLimit": None, "defaultRate": 10.0},
    {"code": "194H", "label": "Commission / Brokerage", "singleTxnLimit": 15_000, "annualLimit": None, "defaultRate": 5.0},
    {"code": "194I", "label": "Rent", "singleTxnLimit": 240_000, "annualLimit": None, "defaultRate": 10.0},
    {"code": "194A", "label": "Interest (non-bank)", "singleTxnLimit": 40_000, "annualLimit": None, "defaultRate": 10.0},
    {"code": "194Q", "label": "Purchase >50L", "singleTxnLimit": 5_000_000, "annualLimit": None, "defaultRate": 0.1},
    {"code": "194M", "label": "Contractor/Prof (Individual)", "singleTxnLimit": 5_000_000, "annualLimit": None, "defaultRate": 5.0},
    {"code": "194O", "label": "E-commerce Operator", "singleTxnLimit": None, "annualLimit": None, "defaultRate": 1.0},
]

AGE_BUCKETS: list[tuple[int, int | None]] = [
    (0, 30),
    (31, 60),
    (61, 90),
    (91, 180),
    (181, 365),
    (366, None),
]

AGE_BUCKET_LABELS = ["0-30", "31-60", "61-90", "91-180", "181-365", ">365"]

NAV_SECTIONS: list[dict] = [
    {
        "title": "Data",
        "modules": ["dashboard", "audit_config"],
    },
    {
        "title": "Balance Sheet",
        "modules": ["trial_balance", "ledger_analytics", "bs_cleanliness"],
    },
    {
        "title": "Receivables & Payables",
        "modules": ["debtor_ageing", "creditor_ageing"],
    },
    {
        "title": "Voucher Analysis",
        "modules": ["voucher_book", "ledger_voucher", "party_matrix", "related_party", "orphan_pl"],
    },
    {
        "title": "GST",
        "modules": [
            "gst_rate", "sales_register", "purchase_register",
            "gstr2b_reco", "itc_3b", "gst_ledger", "rcm", "gst_expense",
        ],
    },
    {
        "title": "TDS",
        "modules": ["tds_analysis"],
    },
    {
        "title": "Financial Analytics",
        "modules": ["cash_flow", "pnl_analysis", "variance", "exception_heatmap"],
    },
    {
        "title": "Utilities",
        "modules": ["tsf_comparison"],
    },
]

MODULE_LABELS: dict[str, str] = {
    "dashboard": "Dashboard",
    "audit_config": "Audit Configuration",
    "trial_balance": "Trial Balance",
    "ledger_analytics": "Ledger Analytics",
    "bs_cleanliness": "BS Cleanliness",
    "debtor_ageing": "Debtor Ageing (FIFO)",
    "creditor_ageing": "Creditor Ageing (FIFO)",
    "voucher_book": "Voucher Book",
    "ledger_voucher": "Ledger Voucher View",
    "party_matrix": "Party Ledger Matrix",
    "related_party": "Related Party (AS-18)",
    "orphan_pl": "Orphan P&L Vouchers",
    "gst_rate": "GST Rate Analysis",
    "sales_register": "Sales Register",
    "purchase_register": "Purchase GST Register",
    "gstr2b_reco": "GSTR-2B Reconciliation",
    "itc_3b": "ITC 3B Reconciliation",
    "gst_ledger": "GST Ledger Summary",
    "rcm": "RCM Analysis",
    "gst_expense": "GST Expense (Blocked Credit)",
    "tds_analysis": "TDS Analysis",
    "cash_flow": "Cash Flow Analysis",
    "pnl_analysis": "P&L Analysis",
    "variance": "Variance Analysis",
    "exception_heatmap": "Exception Density Heatmap",
    "tsf_comparison": "TSF Comparison",
}

# Tally primary groups classifying P&L vs Balance Sheet
PNL_PRIMARY_KEYWORDS = {
    "sales accounts", "purchase accounts", "direct expenses", "direct incomes",
    "indirect expenses", "indirect incomes", "manufacturing expenses",
}
BS_PRIMARY_KEYWORDS = {
    "sundry debtors", "sundry creditors", "bank accounts", "cash-in-hand",
    "loans (liability)", "loans & advances (asset)", "current liabilities",
    "current assets", "fixed assets", "capital account", "reserves & surplus",
    "investments", "misc. expenses (asset)",
}

TALLY_DEBTOR_KEYWORDS = {"sundry debtors", "sundry debtor"}
TALLY_CREDITOR_KEYWORDS = {"sundry creditors", "sundry creditor"}
TALLY_BANK_KEYWORDS = {"bank accounts", "bank account"}
TALLY_CASH_KEYWORDS = {"cash-in-hand", "cash in hand"}

# Fiscal month order (Apr = 1 … Mar = 12)
FY_MONTH_ORDER = {
    "Apr": 1, "May": 2, "Jun": 3, "Jul": 4, "Aug": 5, "Sep": 6,
    "Oct": 7, "Nov": 8, "Dec": 9, "Jan": 10, "Feb": 11, "Mar": 12,
}
