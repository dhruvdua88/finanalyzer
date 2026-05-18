from __future__ import annotations

import queue
import threading
import tkinter as tk
from tkinter import filedialog, messagebox
from typing import Callable

import customtkinter as ctk

from app.state import AppState
from data.tsf_reader import read_tsf
from data import settings_store


class DashboardPanel(ctk.CTkFrame):
    """Landing screen with import buttons and KPI cards."""

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
        self._queue: queue.Queue = queue.Queue()

        # Title
        ctk.CTkLabel(
            self, text="FinAnalyzer",
            font=ctk.CTkFont(size=28, weight="bold"),
        ).pack(pady=(24, 4))
        ctk.CTkLabel(
            self, text="Tally Audit & Analysis Platform",
            font=ctk.CTkFont(size=14),
            text_color="gray",
        ).pack(pady=(0, 20))

        # Import buttons
        btn_row = ctk.CTkFrame(self, fg_color="transparent")
        btn_row.pack(pady=8)
        ctk.CTkButton(
            btn_row, text="📂  Import TSF File",
            width=200, height=40,
            font=ctk.CTkFont(size=14),
            command=self._import_tsf,
        ).pack(side="left", padx=12)
        ctk.CTkButton(
            btn_row, text="📋  Import GSTR-2B JSON",
            width=200, height=40,
            font=ctk.CTkFont(size=14),
            fg_color="#6D28D9", hover_color="#5B21B6",
            command=self._import_gstr2b,
        ).pack(side="left", padx=12)

        # Full report export button
        self._export_btn = ctk.CTkButton(
            btn_row, text="📊  Export Full Report",
            width=200, height=40,
            font=ctk.CTkFont(size=14),
            fg_color="#0F766E", hover_color="#0D6B63",
            state="disabled",
            command=self._export_full_report,
        )
        self._export_btn.pack(side="left", padx=12)

        # KPI cards
        kpi_frame = ctk.CTkFrame(self, fg_color="transparent")
        kpi_frame.pack(pady=20, fill="x", padx=40)

        self._kpi_labels: dict[str, ctk.CTkLabel] = {}
        KPI_KEYS = [
            ("Total Entries", "total_rows"),
            ("Unique Vouchers", "unique_vouchers"),
            ("From Date", "min_date"),
            ("To Date", "max_date"),
            ("Months", "month_count"),
            ("Ledgers", "ledger_count"),
        ]
        for i, (label, key) in enumerate(KPI_KEYS):
            card = ctk.CTkFrame(kpi_frame, border_width=1, corner_radius=8)
            card.grid(row=i // 3, column=i % 3, padx=10, pady=10, sticky="nsew")
            kpi_frame.columnconfigure(i % 3, weight=1)
            ctk.CTkLabel(card, text=label, font=ctk.CTkFont(size=11), text_color="gray").pack(pady=(10, 0))
            val_lbl = ctk.CTkLabel(card, text="—", font=ctk.CTkFont(size=22, weight="bold"))
            val_lbl.pack(pady=(0, 10))
            self._kpi_labels[key] = val_lbl

        # Status
        self._status_var = tk.StringVar(value="No data loaded. Import a TSF file to begin.")
        ctk.CTkLabel(self, textvariable=self._status_var, font=ctk.CTkFont(size=11),
                     text_color="gray").pack(pady=8)

        self.after(100, self._poll_queue)

    def _poll_queue(self) -> None:
        while True:
            try:
                kind, payload = self._queue.get_nowait()
            except queue.Empty:
                break
            if kind == "status":
                self._status_var.set(payload)
            elif kind == "export_done":
                self._export_btn.configure(state="normal")
                self._status_var.set(f"Saved: {payload}")
                messagebox.showinfo("Export Complete", f"Full report saved to:\n{payload}")
            elif kind == "export_error":
                self._export_btn.configure(state="normal")
                self._status_var.set(f"Export failed: {payload}")
                messagebox.showerror("Export Error", payload)
        self.after(100, self._poll_queue)

    def on_activate(self) -> None:
        self._refresh_kpis()

    def refresh_from_state(self) -> None:
        self._refresh_kpis()

    def _refresh_kpis(self) -> None:
        s = self.app_state
        vals = {
            "total_rows": f"{s.total_rows:,}",
            "unique_vouchers": f"{s.unique_vouchers:,}",
            "min_date": s.min_date or "—",
            "max_date": s.max_date or "—",
            "month_count": str(len(s.available_months)),
            "ledger_count": str(len(s.all_ledger_names)),
        }
        for key, val in vals.items():
            if key in self._kpi_labels:
                self._kpi_labels[key].configure(text=val)

    def _import_tsf(self) -> None:
        path = filedialog.askopenfilename(
            title="Select TSF File",
            filetypes=[("TSF / SQLite files", "*.tsf *.sqlite *.db"), ("All files", "*.*")],
        )
        if not path:
            return
        self._status_var.set(f"Loading {path}…")
        threading.Thread(target=self._load_tsf, args=(path,), daemon=True).start()

    def _load_tsf(self, path: str) -> None:
        try:
            tx, master = read_tsf(path)
            self.app_state.entries = tx
            self.app_state.master_entries = master
            self.app_state.tsf_path = path
            self.app_state.refresh_summary()
            self.after(0, self._on_tsf_loaded)
        except Exception as exc:
            self.after(0, lambda: messagebox.showerror("Import Error", str(exc)))
            self.after(0, lambda: self._status_var.set("Import failed."))

    def _on_tsf_loaded(self) -> None:
        self._refresh_kpis()
        n = self.app_state.total_rows
        self._status_var.set(f"Loaded {n:,} entries from TSF file.")
        self._export_btn.configure(state="normal")
        self.on_state_change()

    def _import_gstr2b(self) -> None:
        path = filedialog.askopenfilename(
            title="Select GSTR-2B JSON File",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if not path:
            return
        try:
            from data.gstr2b_reader import parse_gstr2b_json
            data = parse_gstr2b_json(path)
            self.app_state.gstr2b_b2b_rows = data.get("b2b", [])
            n = len(self.app_state.gstr2b_b2b_rows)
            self._status_var.set(f"GSTR-2B loaded: {n:,} B2B invoices.")
            messagebox.showinfo("GSTR-2B Imported", f"Loaded {n:,} B2B invoice records.")
        except Exception as exc:
            messagebox.showerror("GSTR-2B Import Error", str(exc))

    def _export_full_report(self) -> None:
        if not self.app_state.entries:
            messagebox.showwarning("No Data", "Import a TSF file before exporting.")
            return

        from export.consolidated_exporter import suggested_filename
        company = self.app_state.settings.company_name or "Company"
        default_name = suggested_filename(company)

        out_dir = filedialog.askdirectory(title="Choose output folder for full report")
        if not out_dir:
            return

        self._export_btn.configure(state="disabled")
        self._status_var.set("Preparing full report…")
        threading.Thread(target=self._run_full_export, args=(out_dir,), daemon=True).start()

    def _run_full_export(self, out_dir: str) -> None:
        try:
            from export.consolidated_exporter import export_consolidated

            def on_progress(msg: str) -> None:
                self._queue.put(("status", msg))

            path = export_consolidated(self.app_state, out_dir, on_progress=on_progress)
            self._queue.put(("export_done", str(path)))
        except Exception as exc:
            import traceback
            self._queue.put(("export_error", traceback.format_exc()[-500:]))
