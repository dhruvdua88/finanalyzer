"""
All 22 analysis module panels (inheriting BasePanel).
Each panel wires up analysis → DataTable → Excel exporter.
"""
from __future__ import annotations

import tkinter as tk
from tkinter import filedialog
from typing import Any

import customtkinter as ctk

from ui.panels.base_panel import BasePanel
from ui.widgets.data_table import DataTable
from ui.widgets.ledger_selector import LedgerSelector
from app.state import AppState


# ─── Trial Balance ────────────────────────────────────────────────────────────

class TrialBalancePanel(BasePanel):
    PANEL_TITLE = "Trial Balance"
    EXPORT_FILENAME = "Trial_Balance"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("primary", "Primary Group", 200),
            ("parent", "Parent Group", 160),
            ("opening_dr", "Opening Dr (₹)", 130),
            ("opening_cr", "Opening Cr (₹)", 130),
            ("during_dr", "During Dr (₹)", 130),
            ("during_cr", "During Cr (₹)", 130),
            ("closing_dr", "Closing Dr (₹)", 130),
            ("closing_cr", "Closing Cr (₹)", 130),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.trial_balance import compute_trial_balance
        return compute_trial_balance(self.app_state.entries, self.app_state.master_entries)

    def _on_result(self, result: Any) -> None:
        rows = [[r["primary"], r["parent"], r["opening_dr"], r["opening_cr"],
                 r["during_dr"], r["during_cr"], r["closing_dr"], r["closing_cr"]]
                for r in result["groups"]]
        self._table.load_rows(rows)

    def _run_export(self, path: str, result: Any) -> None:
        from export.trial_balance_exporter import TrialBalanceExporter
        e = TrialBalanceExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── Debtor Ageing ────────────────────────────────────────────────────────────

class DebtorAgeingPanel(BasePanel):
    PANEL_TITLE = "Debtor Ageing (FIFO)"
    EXPORT_FILENAME = "Debtor_Ageing_FIFO"
    _MODE = "debtor"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("party", "Party", 200),
            ("fifo_receivable", "FIFO Receivable (₹)", 150),
            ("fifo_advance", "FIFO Advance (₹)", 130),
            ("net_fifo", "Net FIFO (₹)", 120),
            ("b0_30", "0-30", 90),
            ("b31_60", "31-60", 90),
            ("b61_90", "61-90", 90),
            ("b91_180", "91-180", 90),
            ("b181_365", "181-365", 90),
            ("b365", ">365", 90),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.ageing import compute_ageing
        return compute_ageing(self.app_state.entries, mode=self._MODE,
                              as_of_str=self.app_state.settings.as_of_date)

    def _on_result(self, result: Any) -> None:
        rows = [[p["party"], p["fifo_receivable"], p["fifo_advance"], p["net_fifo"], *p["buckets"]]
                for p in result["parties"]]
        self._table.load_rows(rows)

    def _run_export(self, path: str, result: Any) -> None:
        from export.ageing_exporter import AgeingExporter
        e = AgeingExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


class CreditorAgeingPanel(DebtorAgeingPanel):
    PANEL_TITLE = "Creditor Ageing (FIFO)"
    EXPORT_FILENAME = "Creditor_Ageing_FIFO"
    _MODE = "creditor"


# ─── Voucher Book ─────────────────────────────────────────────────────────────

class VoucherBookPanel(BasePanel):
    PANEL_TITLE = "Voucher Book"
    EXPORT_FILENAME = "Voucher_Book"

    def _build_content(self) -> None:
        filters = ctk.CTkFrame(self, fg_color="transparent")
        filters.pack(fill="x", padx=16, pady=(8, 0))
        ctk.CTkLabel(filters, text="Voucher Type Filter:").pack(side="left", padx=4)
        self._vtype_var = tk.StringVar(value="All")
        ctk.CTkEntry(filters, textvariable=self._vtype_var, width=200,
                     placeholder_text="e.g. Payment, Receipt (blank = all)").pack(side="left", padx=4)
        ctk.CTkLabel(filters, text="From:").pack(side="left", padx=(16, 4))
        self._from_var = tk.StringVar()
        ctk.CTkEntry(filters, textvariable=self._from_var, width=110,
                     placeholder_text="YYYY-MM-DD").pack(side="left", padx=4)
        ctk.CTkLabel(filters, text="To:").pack(side="left", padx=(8, 4))
        self._to_var = tk.StringVar()
        ctk.CTkEntry(filters, textvariable=self._to_var, width=110,
                     placeholder_text="YYYY-MM-DD").pack(side="left", padx=4)

        self._table = DataTable(self, columns=[
            ("date", "Date", 100),
            ("voucher_number", "Voucher No", 140),
            ("voucher_type", "Type", 120),
            ("party_name", "Party", 200),
            ("total_dr", "Total Dr (₹)", 130),
            ("total_cr", "Total Cr (₹)", 130),
            ("narration", "Narration", 300),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.voucher_book import compute_voucher_book
        vtype = self._vtype_var.get().strip()
        vtypes = [v.strip() for v in vtype.split(",")] if vtype and vtype.lower() != "all" else None
        return compute_voucher_book(
            self.app_state.entries,
            voucher_types=vtypes,
            from_date=self._from_var.get().strip(),
            to_date=self._to_var.get().strip(),
        )

    def _on_result(self, result: Any) -> None:
        rows = [[r["date"], r["voucher_number"], r["voucher_type"],
                 r["party_name"], r["total_dr"], r["total_cr"], r["narration"]]
                for r in result]
        self._table.load_rows(rows)

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import VoucherBookExporter
        e = VoucherBookExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── Ledger Voucher View ──────────────────────────────────────────────────────

class LedgerVoucherPanel(BasePanel):
    PANEL_TITLE = "Ledger Voucher View"
    EXPORT_FILENAME = "Ledger_Statement"

    def _build_content(self) -> None:
        filters = ctk.CTkFrame(self, fg_color="transparent")
        filters.pack(fill="x", padx=16, pady=(8, 0))
        ctk.CTkLabel(filters, text="Ledger:").pack(side="left", padx=4)
        self._ledger_var = tk.StringVar()
        self._ledger_combo = ctk.CTkComboBox(filters, variable=self._ledger_var, width=300, values=[])
        self._ledger_combo.pack(side="left", padx=4)

        self._table = DataTable(self, columns=[
            ("date", "Date", 100), ("voucher_type", "Type", 120),
            ("voucher_number", "Voucher No", 140), ("party_name", "Party", 180),
            ("narration", "Narration", 260),
            ("debit", "Debit (₹)", 130), ("credit", "Credit (₹)", 130), ("balance", "Balance (₹)", 130),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def on_activate(self) -> None:
        self._ledger_combo.configure(values=self.app_state.all_ledger_names)

    def _run_analysis(self) -> Any:
        from analysis.ledger_voucher import compute_ledger_statement
        ledger = self._ledger_var.get().strip()
        if not ledger:
            return {"ledger": "", "opening": 0.0, "rows": [], "closing": 0.0}
        return compute_ledger_statement(self.app_state.entries, ledger)

    def _on_result(self, result: Any) -> None:
        rows = [[r["date"], r["voucher_type"], r["voucher_number"], r["party_name"],
                 r["narration"], r["debit"], r["credit"], r["balance"]]
                for r in result["rows"]]
        self._table.load_rows(rows)

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import LedgerVoucherExporter
        e = LedgerVoucherExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── TDS Analysis ─────────────────────────────────────────────────────────────

class TDSPanel(BasePanel):
    PANEL_TITLE = "TDS Analysis"
    EXPORT_FILENAME = "TDS_Analysis"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("date", "Date", 100), ("voucher_number", "Voucher No", 130),
            ("party_name", "Party", 180), ("expense_ledger", "Expense Ledger", 160),
            ("ledger_hit", "Ledger Hit (₹)", 130), ("status", "Status", 120),
            ("tds_deducted", "TDS Deducted (₹)", 130), ("applied_rate", "Applied Rate %", 110),
            ("section", "Section", 80), ("threshold_crossed", "Threshold", 90),
            ("shortfall", "Shortfall (₹)", 110), ("audit_note", "Audit Note", 160),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.tds_analysis import compute_tds
        return compute_tds(self.app_state.entries, self.app_state.settings)

    def _on_result(self, result: Any) -> None:
        rows = [[r["date"], r["voucher_number"], r["party_name"], r["expense_ledger"],
                 r["ledger_hit"], r["status"], r["tds_deducted"], r["applied_rate"],
                 r["section"], r["threshold_crossed"], r["shortfall"], r["audit_note"]]
                for r in result]
        self._table.load_rows(rows)

    def _run_export(self, path: str, result: Any) -> None:
        from export.tds_exporter import TDSExporter
        e = TDSExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── GST Rate Analysis ────────────────────────────────────────────────────────

class GSTRatePanel(BasePanel):
    PANEL_TITLE = "GST Rate Analysis"
    EXPORT_FILENAME = "GST_Rate_Analysis"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("date", "Date", 100), ("voucher_number", "Voucher No", 130),
            ("party_name", "Party", 180), ("gstin", "GSTIN", 160),
            ("invoice_number", "Invoice No", 140),
            ("taxable_amount", "Taxable (₹)", 130), ("gst_amount", "GST (₹)", 120),
            ("effective_rate", "Effective Rate %", 120), ("gst_ledgers", "GST Ledgers", 200),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.gst_analysis import compute_gst_rate_analysis
        return compute_gst_rate_analysis(self.app_state.entries, self.app_state.settings)

    def _on_result(self, result: Any) -> None:
        rows = [[r["date"], r["voucher_number"], r["party_name"], r["gstin"],
                 r["invoice_number"], r["taxable_amount"], r["gst_amount"],
                 r["effective_rate"], r["gst_ledgers"]]
                for r in result]
        self._table.load_rows(rows)

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import GSTRateExporter
        e = GSTRateExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── Sales Register ───────────────────────────────────────────────────────────

class SalesRegisterPanel(BasePanel):
    PANEL_TITLE = "Sales Register"
    EXPORT_FILENAME = "Sales_Register"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("date", "Date", 100), ("voucher_number", "Voucher No", 130),
            ("party_name", "Party", 200), ("invoice_number", "Invoice No", 140),
            ("taxable_amount", "Taxable (₹)", 130), ("gst_amount", "GST (₹)", 120),
            ("total_amount", "Total (₹)", 130),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.gst_analysis import compute_sales_register
        return compute_sales_register(self.app_state.entries, self.app_state.settings)

    def _on_result(self, result: Any) -> None:
        rows = [[r["date"], r["voucher_number"], r["party_name"], r["invoice_number"],
                 r["taxable_amount"], r["gst_amount"], r["total_amount"]] for r in result]
        self._table.load_rows(rows)

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import SalesRegisterExporter
        e = SalesRegisterExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── Purchase GST Register ────────────────────────────────────────────────────

class PurchaseRegisterPanel(BasePanel):
    PANEL_TITLE = "Purchase GST Register"
    EXPORT_FILENAME = "Purchase_GST_Register"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("date", "Date", 100), ("voucher_number", "Voucher No", 130),
            ("party_name", "Party", 200), ("taxable_amount", "Taxable (₹)", 130),
            ("total_gst", "Total GST (₹)", 120), ("rcm", "RCM (₹)", 100),
            ("total_amount", "Total (₹)", 130),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.gst_analysis import compute_purchase_register
        return compute_purchase_register(self.app_state.entries, self.app_state.settings)

    def _on_result(self, result: Any) -> None:
        rows = [[r["date"], r["voucher_number"], r["party_name"], r["taxable_amount"],
                 r["total_gst"], r["rcm"], r["total_amount"]] for r in result]
        self._table.load_rows(rows)

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import PurchaseRegisterExporter
        e = PurchaseRegisterExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── GSTR-2B Reconciliation ───────────────────────────────────────────────────

class GSTR2BPanel(BasePanel):
    PANEL_TITLE = "GSTR-2B Reconciliation"
    EXPORT_FILENAME = "GSTR2B_Reconciliation"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("status", "Status", 140), ("party_name", "Party", 200),
            ("gstin", "GSTIN", 160), ("b2b_invoice_no", "2B Invoice No", 160),
            ("b2b_taxable", "2B Taxable (₹)", 130), ("tally_taxable", "Tally Taxable (₹)", 130),
            ("delta_taxable", "Δ Taxable (₹)", 120), ("delta_tax", "Δ Tax (₹)", 110),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.misc_analysis import compute_gstr2b_reco
        return compute_gstr2b_reco(
            self.app_state.entries,
            self.app_state.gstr2b_b2b_rows,
            self.app_state.settings,
        )

    def _on_result(self, result: Any) -> None:
        rows = [[r["status"], r["party_name"], r["gstin"], r["b2b_invoice_no"],
                 r["b2b_taxable"], r["tally_taxable"], r["delta_taxable"], r["delta_tax"]]
                for r in result["rows"]]
        self._table.load_rows(rows)

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import GSTR2BExporter
        e = GSTR2BExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── GST Ledger Summary ───────────────────────────────────────────────────────

class GSTLedgerPanel(BasePanel):
    PANEL_TITLE = "GST Ledger Summary"
    EXPORT_FILENAME = "GST_Ledger_Summary"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("ledger", "Ledger", 260), ("type", "Type", 140),
            ("net_cr", "Net Credit (₹)", 130), ("net_dr", "Net Debit (₹)", 130), ("net", "Net (₹)", 120),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.gst_analysis import compute_gst_ledger_summary
        return compute_gst_ledger_summary(self.app_state.entries, self.app_state.settings)

    def _on_result(self, result: Any) -> None:
        self._table.load_rows([[r["ledger"], r["type"], r["net_cr"], r["net_dr"], r["net"]] for r in result])

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import GSTLedgerExporter
        e = GSTLedgerExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── RCM Analysis ─────────────────────────────────────────────────────────────

class RCMPanel(BasePanel):
    PANEL_TITLE = "RCM Analysis"
    EXPORT_FILENAME = "RCM_Analysis"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("date", "Date", 100), ("voucher_number", "Voucher No", 130),
            ("party_name", "Party", 200), ("rcm_ledgers", "RCM Ledgers", 200),
            ("rcm_amount", "RCM Amount (₹)", 130),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.gst_analysis import compute_rcm_analysis
        return compute_rcm_analysis(self.app_state.entries, self.app_state.settings)

    def _on_result(self, result: Any) -> None:
        self._table.load_rows([[r["date"], r["voucher_number"], r["party_name"],
                                r["rcm_ledgers"], r["rcm_amount"]] for r in result])

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import RCMExporter
        e = RCMExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── GST Expense (Blocked Credit) ────────────────────────────────────────────

class GSTExpensePanel(BasePanel):
    PANEL_TITLE = "GST Expense – Blocked Credit"
    EXPORT_FILENAME = "GST_Blocked_Credit"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("date", "Date", 100), ("voucher_type", "Type", 120),
            ("ledger", "Ledger", 200), ("party_name", "Party", 180), ("amount", "Amount (₹)", 130),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.gst_analysis import compute_blocked_credit
        return compute_blocked_credit(self.app_state.entries, self.app_state.settings)

    def _on_result(self, result: Any) -> None:
        self._table.load_rows([[r["date"], r["voucher_type"], r["ledger"], r["party_name"], r["amount"]] for r in result])

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import GSTExpenseExporter
        e = GSTExpenseExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── Ledger Analytics ─────────────────────────────────────────────────────────

class LedgerAnalyticsPanel(BasePanel):
    PANEL_TITLE = "Ledger Analytics"
    EXPORT_FILENAME = "Ledger_Analytics"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("ledger", "Ledger", 220), ("primary", "Primary", 160),
            ("opening_dr", "Opening Dr (₹)", 120), ("opening_cr", "Opening Cr (₹)", 120),
            ("during_dr", "During Dr (₹)", 120), ("during_cr", "During Cr (₹)", 120),
            ("closing_dr", "Closing Dr (₹)", 120), ("closing_cr", "Closing Cr (₹)", 120),
            ("recon_diff", "Recon Diff", 100), ("flags", "Flags", 180),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.ledger_analytics import compute_ledger_analytics
        return compute_ledger_analytics(self.app_state.entries, self.app_state.master_entries)

    def _on_result(self, result: Any) -> None:
        rows = [[r["ledger"], r["primary"], r["opening_dr"], r["opening_cr"],
                 r["during_dr"], r["during_cr"], r["closing_dr"], r["closing_cr"],
                 r["recon_diff"], r["flags"]] for r in result]
        self._table.load_rows(rows)

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import LedgerAnalyticsExporter
        e = LedgerAnalyticsExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── Party Ledger Matrix ──────────────────────────────────────────────────────

class PartyMatrixPanel(BasePanel):
    PANEL_TITLE = "Party Ledger Matrix"
    EXPORT_FILENAME = "Party_Ledger_Matrix"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("party", "Party", 200),
            ("voucher_count", "Vouchers", 80),
            ("sales", "Sales (₹)", 130), ("purchase", "Purchase (₹)", 130),
            ("expense", "Expense (₹)", 130), ("tds", "TDS (₹)", 110),
            ("gst", "GST (₹)", 110), ("net_balance", "Net Balance (₹)", 130),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.party_matrix import compute_party_matrix
        return compute_party_matrix(self.app_state.entries, self.app_state.settings)

    def _on_result(self, result: Any) -> None:
        rows = [[p["party"], p["voucher_count"], p["sales"], p["purchase"],
                 p["expense"], p["tds"], p["gst"], p["net_balance"]]
                for p in result["parties"]]
        self._table.load_rows(rows)

    def _run_export(self, path: str, result: Any) -> None:
        from export.party_matrix_exporter import PartyMatrixExporter
        e = PartyMatrixExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── Related Party ────────────────────────────────────────────────────────────

class RelatedPartyPanel(BasePanel):
    PANEL_TITLE = "Related Party (AS-18)"
    EXPORT_FILENAME = "Related_Party"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("name", "Party Name", 220), ("category", "Category", 130),
            ("total_dr", "Total Dr (₹)", 130), ("total_cr", "Total Cr (₹)", 130), ("net", "Net (₹)", 120),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.misc_analysis import compute_related_party
        return compute_related_party(self.app_state.entries, self.app_state.settings)

    def _on_result(self, result: Any) -> None:
        self._table.load_rows([[p["name"], p["category"], p["total_dr"], p["total_cr"], p["net"]]
                               for p in result["parties"]])

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import RelatedPartyExporter
        e = RelatedPartyExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── Cash Flow ────────────────────────────────────────────────────────────────

class CashFlowPanel(BasePanel):
    PANEL_TITLE = "Cash Flow Analysis"
    EXPORT_FILENAME = "Cash_Flow"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("ledger", "Ledger", 220), ("opening", "Opening (₹)", 130),
            ("inflow", "Inflow (₹)", 130), ("outflow", "Outflow (₹)", 130),
            ("closing", "Closing (₹)", 130), ("net", "Net Change (₹)", 130),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.cash_flow import compute_cash_flow
        return compute_cash_flow(self.app_state.entries, self.app_state.master_entries)

    def _on_result(self, result: Any) -> None:
        self._table.load_rows([[r["ledger"], r["opening"], r["inflow"], r["outflow"], r["closing"], r["net"]]
                               for r in result])

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import CashFlowExporter
        e = CashFlowExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── P&L Analysis ─────────────────────────────────────────────────────────────

class PnLPanel(BasePanel):
    PANEL_TITLE = "P&L Analysis"
    EXPORT_FILENAME = "PnL_Analysis"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("head", "Head", 140), ("primary", "Primary", 180), ("ledger", "Ledger", 220),
            ("total", "Total (₹)", 130),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.pnl_analysis import compute_pnl
        return compute_pnl(self.app_state.entries)

    def _on_result(self, result: Any) -> None:
        rows = [[r["head"], r["primary"], r["ledger"], r["total"]] for r in result["rows"]]
        self._table.load_rows(rows)

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import PnLExporter
        e = PnLExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── Variance Analysis ────────────────────────────────────────────────────────

class VariancePanel(BasePanel):
    PANEL_TITLE = "Variance Analysis"
    EXPORT_FILENAME = "Variance_Analysis"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("ledger", "Ledger", 240),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.misc_analysis import compute_variance
        return compute_variance(self.app_state.entries)

    def _on_result(self, result: Any) -> None:
        self._table.load_rows([[r["ledger"]] for r in result])

    def _run_export(self, path: str, result: Any) -> None:
        from analysis.misc_analysis import compute_variance
        rows = result
        from analysis.pnl_analysis import _MONTHS as _M
        months: list[str] = []
        if rows:
            months = [k for k in rows[0].keys() if k != "ledger" and "_pct" not in k]
        from export.misc_exporters import VarianceExporter
        e = VarianceExporter()
        s = self.app_state.settings
        e.export(rows, months, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── Exception Heatmap ────────────────────────────────────────────────────────

class ExceptionHeatmapPanel(BasePanel):
    PANEL_TITLE = "Exception Density Heatmap"
    EXPORT_FILENAME = "Exception_Heatmap"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("ledger", "Ledger", 240), ("total_exceptions", "Total Exceptions", 140),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.exception_heatmap import compute_exception_heatmap
        return compute_exception_heatmap(self.app_state.entries, self.app_state.settings)

    def _on_result(self, result: Any) -> None:
        matrix = result["matrix"]
        rows = []
        for ledger in result["ledgers"]:
            total = sum(sum(m.values()) for m in matrix.get(ledger, {}).values())
            rows.append([ledger, total])
        self._table.load_rows(rows)

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import ExceptionHeatmapExporter
        e = ExceptionHeatmapExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── BS Cleanliness ───────────────────────────────────────────────────────────

class BSCleanlinessPanel(BasePanel):
    PANEL_TITLE = "BS Cleanliness"
    EXPORT_FILENAME = "BS_Cleanliness"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("ledger", "Ledger", 240), ("primary", "Primary", 200),
            ("closing", "Closing (₹)", 130), ("flag", "Flag", 220),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.misc_analysis import compute_bs_cleanliness
        return compute_bs_cleanliness(self.app_state.entries, self.app_state.master_entries)

    def _on_result(self, result: Any) -> None:
        self._table.load_rows([[r["ledger"], r["primary"], r["closing"], r["flag"]] for r in result if r["flag"]])

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import BSCleanlinessExporter
        e = BSCleanlinessExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── Orphan P&L ───────────────────────────────────────────────────────────────

class OrphanPLPanel(BasePanel):
    PANEL_TITLE = "Orphan P&L Vouchers"
    EXPORT_FILENAME = "Orphan_PL_Vouchers"

    def _build_content(self) -> None:
        self._table = DataTable(self, columns=[
            ("date", "Date", 100), ("voucher_type", "Type", 120),
            ("voucher_number", "Voucher No", 140),
            ("party_name", "Party", 200), ("pnl_ledgers", "P&L Ledgers", 260),
            ("total_dr", "Dr (₹)", 120), ("total_cr", "Cr (₹)", 120),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        from analysis.misc_analysis import compute_orphan_pl
        return compute_orphan_pl(self.app_state.entries)

    def _on_result(self, result: Any) -> None:
        self._table.load_rows([[r["date"], r["voucher_type"], r["voucher_number"],
                                r["party_name"], r["pnl_ledgers"], r["total_dr"], r["total_cr"]]
                               for r in result])

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import OrphanPLExporter
        e = OrphanPLExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company", s.fiscal_year or "")
        e.save(path)


# ─── TSF Comparison ───────────────────────────────────────────────────────────

class TSFComparisonPanel(BasePanel):
    PANEL_TITLE = "TSF Comparison"
    EXPORT_FILENAME = "TSF_Comparison"

    def _build_content(self) -> None:
        filters = ctk.CTkFrame(self, fg_color="transparent")
        filters.pack(fill="x", padx=16, pady=(8, 0))
        ctk.CTkLabel(filters, text="Compare with new TSF:").pack(side="left", padx=4)
        self._new_path_var = tk.StringVar(value="")
        ctk.CTkEntry(filters, textvariable=self._new_path_var, width=360,
                     placeholder_text="Path to new TSF file").pack(side="left", padx=4)
        ctk.CTkButton(filters, text="Browse", width=80,
                      command=self._browse).pack(side="left", padx=4)

        self._table = DataTable(self, columns=[
            ("metric", "Metric", 200), ("value", "Value", 200),
        ])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _browse(self) -> None:
        path = filedialog.askopenfilename(
            filetypes=[("TSF files", "*.tsf *.sqlite *.db"), ("All files", "*.*")]
        )
        if path:
            self._new_path_var.set(path)

    def _run_analysis(self) -> Any:
        new_path = self._new_path_var.get().strip()
        if not new_path:
            return {"summary": {}, "added": [], "removed": [], "modified": []}
        from data.tsf_reader import read_tsf
        from analysis.misc_analysis import compute_tsf_comparison
        new_tx, _ = read_tsf(new_path)
        return compute_tsf_comparison(self.app_state.entries, new_tx)

    def _on_result(self, result: Any) -> None:
        s = result.get("summary", {})
        self._table.load_rows([
            ["Added Entries", s.get("added", 0)],
            ["Removed Entries", s.get("removed", 0)],
            ["Modified Entries", s.get("modified", 0)],
            ["Net Amount Change (₹)", s.get("net_amount_change", 0.0)],
        ])

    def _run_export(self, path: str, result: Any) -> None:
        from export.misc_exporters import TSFComparisonExporter
        e = TSFComparisonExporter()
        s = self.app_state.settings
        e.export(result, s.company_name or "Company")
        e.save(path)


# ─── ITC 3B placeholder ───────────────────────────────────────────────────────

class ITC3BPanel(BasePanel):
    PANEL_TITLE = "ITC 3B Reconciliation"
    EXPORT_FILENAME = "ITC_3B_Recon"

    def _build_content(self) -> None:
        ctk.CTkLabel(self, text="Import GSTR-3B data (JSON) to use this module.",
                     font=ctk.CTkFont(size=13), text_color="gray").pack(pady=40)
        self._table = DataTable(self, columns=[("info", "Info", 400)])
        self._table.pack(fill="both", expand=True, padx=16, pady=8)

    def _run_analysis(self) -> Any:
        return []

    def _on_result(self, result: Any) -> None:
        self._table.load_rows([["No 3B data imported yet"]])

    def _run_export(self, path: str, result: Any) -> None:
        pass
