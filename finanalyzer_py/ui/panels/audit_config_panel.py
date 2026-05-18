from __future__ import annotations

import json
import threading
import tkinter as tk
from tkinter import filedialog, messagebox
from typing import Callable

import customtkinter as ctk

from app.state import AppState
from data import settings_store
from data.models import TDSSectionMapping
from ui.widgets.ledger_selector import LedgerSelector


class AuditConfigPanel(ctk.CTkFrame):
    """Configure ledger mappings, TDS sections, and related parties."""

    def __init__(
        self,
        parent: tk.Widget,
        app_state: AppState,
        on_state_change: Callable[[], None],
        **kwargs,
    ) -> None:
        super().__init__(parent, **kwargs)
        self.app_state = app_state
        self.on_state_change = on_state_change
        self._build()

    def _build(self) -> None:
        # Header
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(12, 4))
        ctk.CTkLabel(header, text="Audit Configuration",
                     font=ctk.CTkFont(size=20, weight="bold")).pack(side="left")
        ctk.CTkButton(header, text="Save Settings", command=self._save,
                      width=120).pack(side="right", padx=4)
        ctk.CTkButton(header, text="Export JSON", command=self._export_json,
                      width=110, fg_color="#059669", hover_color="#047857").pack(side="right", padx=4)
        ctk.CTkButton(header, text="Import JSON", command=self._import_json,
                      width=110, fg_color="#D97706", hover_color="#B45309").pack(side="right", padx=4)

        # Scrollable content
        scroll = ctk.CTkScrollableFrame(self)
        scroll.pack(fill="both", expand=True, padx=16, pady=8)

        # Company info
        info_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        info_frame.pack(fill="x", pady=(0, 12))
        ctk.CTkLabel(info_frame, text="Company Name").grid(row=0, column=0, sticky="w", padx=4)
        self._company_var = tk.StringVar(value=self.app_state.settings.company_name)
        ctk.CTkEntry(info_frame, textvariable=self._company_var, width=300).grid(row=0, column=1, padx=8)
        ctk.CTkLabel(info_frame, text="Fiscal Year").grid(row=1, column=0, sticky="w", padx=4, pady=4)
        self._fy_var = tk.StringVar(value=self.app_state.settings.fiscal_year)
        ctk.CTkEntry(info_frame, textvariable=self._fy_var, width=120,
                     placeholder_text="e.g. 2025-26").grid(row=1, column=1, padx=8, sticky="w")

        # Ledger selectors
        selectors_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        selectors_frame.pack(fill="x")
        selectors_frame.columnconfigure((0, 1, 2), weight=1)

        self._sales_gst_sel = LedgerSelector(selectors_frame, "Sales GST Ledgers")
        self._sales_gst_sel.grid(row=0, column=0, padx=6, pady=6, sticky="nsew")

        self._purch_gst_sel = LedgerSelector(selectors_frame, "Purchase GST Ledgers")
        self._purch_gst_sel.grid(row=0, column=1, padx=6, pady=6, sticky="nsew")

        self._tds_sel = LedgerSelector(selectors_frame, "TDS Tax Ledgers")
        self._tds_sel.grid(row=0, column=2, padx=6, pady=6, sticky="nsew")

        self._rcm_sel = LedgerSelector(selectors_frame, "RCM Tax Ledgers")
        self._rcm_sel.grid(row=1, column=0, padx=6, pady=6, sticky="nsew")

        self._blocked_sel = LedgerSelector(selectors_frame, "Blocked Credit Ledgers")
        self._blocked_sel.grid(row=1, column=1, padx=6, pady=6, sticky="nsew")

        self._gst_summary_sel = LedgerSelector(selectors_frame, "GST Ledger Summary")
        self._gst_summary_sel.grid(row=1, column=2, padx=6, pady=6, sticky="nsew")

        # TDS Section Mappings
        tds_frame = ctk.CTkFrame(scroll)
        tds_frame.pack(fill="x", pady=8)
        ctk.CTkLabel(tds_frame, text="TDS Section Mappings",
                     font=ctk.CTkFont(weight="bold")).pack(anchor="w", padx=8, pady=(6, 2))
        ctk.CTkLabel(tds_frame, text="Format: LedgerName → Section Code (one per line, comma separated)",
                     font=ctk.CTkFont(size=10), text_color="gray").pack(anchor="w", padx=8)
        self._tds_mappings_text = ctk.CTkTextbox(tds_frame, height=100)
        self._tds_mappings_text.pack(fill="x", padx=8, pady=4)

        # Related Parties
        rp_frame = ctk.CTkFrame(scroll)
        rp_frame.pack(fill="x", pady=8)
        ctk.CTkLabel(rp_frame, text="Related Party Profiles (AS-18)",
                     font=ctk.CTkFont(weight="bold")).pack(anchor="w", padx=8, pady=(6, 2))
        ctk.CTkLabel(rp_frame, text="Format: LedgerName, Category (one per line). Categories: Holding, Subsidiary, KMP, Associate, Other",
                     font=ctk.CTkFont(size=10), text_color="gray").pack(anchor="w", padx=8)
        self._rp_text = ctk.CTkTextbox(rp_frame, height=100)
        self._rp_text.pack(fill="x", padx=8, pady=4)

        self._status_var = tk.StringVar(value="")
        ctk.CTkLabel(self, textvariable=self._status_var, font=ctk.CTkFont(size=11),
                     text_color="gray").pack(side="bottom", pady=4)

    def on_activate(self) -> None:
        self._populate_selectors()
        self._populate_text_areas()

    def refresh_from_state(self) -> None:
        self._populate_selectors()

    def _populate_selectors(self) -> None:
        all_ledgers = self.app_state.all_ledger_names
        s = self.app_state.settings
        for sel, attr in [
            (self._sales_gst_sel, "sales_gst_ledgers"),
            (self._purch_gst_sel, "purchase_gst_ledgers"),
            (self._tds_sel, "tds_tax_ledgers"),
            (self._rcm_sel, "rcm_tax_ledgers"),
            (self._blocked_sel, "blocked_credit_ledgers"),
            (self._gst_summary_sel, "gst_ledger_summary_ledgers"),
        ]:
            sel.set_items(all_ledgers)
            sel.set_selected(getattr(s, attr))

    def _populate_text_areas(self) -> None:
        s = self.app_state.settings
        lines = [f"{m.ledger_name}, {m.section_code}" for m in s.tds_section_mappings]
        self._tds_mappings_text.delete("1.0", "end")
        self._tds_mappings_text.insert("1.0", "\n".join(lines))

        rp_lines = [f"{p.name}, {p.category}" for p in s.related_parties]
        self._rp_text.delete("1.0", "end")
        self._rp_text.insert("1.0", "\n".join(rp_lines))

    def _save(self) -> None:
        s = self.app_state.settings
        s.company_name = self._company_var.get().strip()
        s.fiscal_year = self._fy_var.get().strip()
        s.sales_gst_ledgers = self._sales_gst_sel.get_selected()
        s.purchase_gst_ledgers = self._purch_gst_sel.get_selected()
        s.tds_tax_ledgers = self._tds_sel.get_selected()
        s.rcm_tax_ledgers = self._rcm_sel.get_selected()
        s.blocked_credit_ledgers = self._blocked_sel.get_selected()
        s.gst_ledger_summary_ledgers = self._gst_summary_sel.get_selected()

        # Parse TDS section mappings
        mappings = []
        for line in self._tds_mappings_text.get("1.0", "end").strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 2:
                mappings.append(TDSSectionMapping(ledger_name=parts[0], section_code=parts[1]))
        s.tds_section_mappings = mappings

        # Parse related parties
        from data.models import RelatedPartyProfile
        rp_list = []
        for line in self._rp_text.get("1.0", "end").strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 2:
                rp_list.append(RelatedPartyProfile(name=parts[0], category=parts[1]))
        s.related_parties = rp_list

        settings_store.save(s)
        self._status_var.set("Settings saved.")
        self.on_state_change()

    def _export_json(self) -> None:
        path = filedialog.asksaveasfilename(
            defaultextension=".json", filetypes=[("JSON", "*.json")],
            initialfile="finanalyzer_settings.json",
        )
        if not path:
            return
        import json
        with open(path, "w", encoding="utf-8") as f:
            json.dump(settings_store._to_dict(self.app_state.settings), f, indent=2, ensure_ascii=False)
        self._status_var.set(f"Exported to {path}")

    def _import_json(self) -> None:
        path = filedialog.askopenfilename(filetypes=[("JSON", "*.json")])
        if not path:
            return
        try:
            import json
            raw = json.loads(open(path, encoding="utf-8").read())
            self.app_state.settings = settings_store._from_dict(raw)
            self.on_activate()
            self._status_var.set("Settings imported.")
        except Exception as exc:
            messagebox.showerror("Import Error", str(exc))
