from __future__ import annotations

import tkinter as tk
from typing import Any

import customtkinter as ctk

from app.constants import NAV_SECTIONS, MODULE_LABELS
from app.state import AppState
from data import settings_store

# Panel imports
from ui.panels.dashboard_panel import DashboardPanel
from ui.panels.audit_config_panel import AuditConfigPanel
from ui.panels.module_panels import (
    TrialBalancePanel, DebtorAgeingPanel, CreditorAgeingPanel,
    VoucherBookPanel, LedgerVoucherPanel,
    GSTRatePanel, SalesRegisterPanel, PurchaseRegisterPanel,
    GSTR2BPanel, ITC3BPanel, GSTLedgerPanel, RCMPanel, GSTExpensePanel,
    TDSPanel, LedgerAnalyticsPanel, PartyMatrixPanel, RelatedPartyPanel,
    CashFlowPanel, PnLPanel, VariancePanel, ExceptionHeatmapPanel,
    BSCleanlinessPanel, TSFComparisonPanel, OrphanPLPanel,
)

PANEL_MAP: dict[str, type] = {
    "dashboard": DashboardPanel,
    "audit_config": AuditConfigPanel,
    "trial_balance": TrialBalancePanel,
    "ledger_analytics": LedgerAnalyticsPanel,
    "bs_cleanliness": BSCleanlinessPanel,
    "debtor_ageing": DebtorAgeingPanel,
    "creditor_ageing": CreditorAgeingPanel,
    "voucher_book": VoucherBookPanel,
    "ledger_voucher": LedgerVoucherPanel,
    "party_matrix": PartyMatrixPanel,
    "related_party": RelatedPartyPanel,
    "orphan_pl": OrphanPLPanel,
    "gst_rate": GSTRatePanel,
    "sales_register": SalesRegisterPanel,
    "purchase_register": PurchaseRegisterPanel,
    "gstr2b_reco": GSTR2BPanel,
    "itc_3b": ITC3BPanel,
    "gst_ledger": GSTLedgerPanel,
    "rcm": RCMPanel,
    "gst_expense": GSTExpensePanel,
    "tds_analysis": TDSPanel,
    "cash_flow": CashFlowPanel,
    "pnl_analysis": PnLPanel,
    "variance": VariancePanel,
    "exception_heatmap": ExceptionHeatmapPanel,
    "tsf_comparison": TSFComparisonPanel,
}


class MainApp(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()
        self.title("FinAnalyzer – Tally Audit & Analysis")
        self.geometry("1400x860")
        self.minsize(1100, 700)

        ctk.set_appearance_mode("light")
        ctk.set_default_color_theme("blue")

        self.state_obj = AppState()
        self.state_obj.settings = settings_store.load()

        self._panels: dict[str, Any] = {}
        self._active_key: str | None = None
        self._nav_btns: dict[str, ctk.CTkButton] = {}

        self._build_layout()
        self._switch_panel("dashboard")

    def _build_layout(self) -> None:
        # Sidebar
        self.sidebar = ctk.CTkScrollableFrame(
            self, width=230, fg_color="#1E3A8A", corner_radius=0,
        )
        self.sidebar.pack(side="left", fill="y")

        # App branding
        ctk.CTkLabel(
            self.sidebar,
            text="FinAnalyzer",
            font=ctk.CTkFont(size=20, weight="bold"),
            text_color="white",
        ).pack(pady=(20, 2), padx=12)
        ctk.CTkLabel(
            self.sidebar,
            text="Tally Audit Platform",
            font=ctk.CTkFont(size=11),
            text_color="#93C5FD",
        ).pack(pady=(0, 16), padx=12)

        # Nav sections
        for section in NAV_SECTIONS:
            ctk.CTkLabel(
                self.sidebar,
                text=section["title"].upper(),
                font=ctk.CTkFont(size=9, weight="bold"),
                text_color="#60A5FA",
                anchor="w",
            ).pack(anchor="w", padx=16, pady=(10, 2))

            for module_key in section["modules"]:
                label = MODULE_LABELS.get(module_key, module_key)
                btn = ctk.CTkButton(
                    self.sidebar,
                    text=label,
                    fg_color="transparent",
                    hover_color="#1D4ED8",
                    anchor="w",
                    text_color="white",
                    font=ctk.CTkFont(size=12),
                    height=30,
                    corner_radius=6,
                    command=lambda k=module_key: self._switch_panel(k),
                )
                btn.pack(fill="x", padx=8, pady=1)
                self._nav_btns[module_key] = btn

        # Content area
        self.content = ctk.CTkFrame(self, fg_color="#F1F5F9", corner_radius=0)
        self.content.pack(side="right", fill="both", expand=True)

    def _switch_panel(self, key: str) -> None:
        if self._active_key == key:
            return

        # Deactivate current
        if self._active_key:
            if self._active_key in self._panels:
                self._panels[self._active_key].pack_forget()
            if self._active_key in self._nav_btns:
                self._nav_btns[self._active_key].configure(fg_color="transparent")

        # Activate target
        if key not in self._panels:
            panel_cls = PANEL_MAP.get(key)
            if panel_cls is None:
                return
            panel = panel_cls(
                self.content,
                self.state_obj,
                self._on_state_change,
                fg_color="#F1F5F9",
            )
            self._panels[key] = panel

        self._panels[key].pack(fill="both", expand=True)
        self._panels[key].on_activate()
        self._active_key = key

        if key in self._nav_btns:
            self._nav_btns[key].configure(fg_color="#1D4ED8")

    def _on_state_change(self) -> None:
        """Called by panels after state mutation (TSF load, settings save)."""
        # Notify all cached panels of the state change
        for key, panel in self._panels.items():
            if hasattr(panel, "refresh_from_state"):
                panel.refresh_from_state()
        # Save settings automatically
        settings_store.save(self.state_obj.settings)
