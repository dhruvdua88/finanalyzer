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

        # Row 1 – import / fetch buttons
        btn_row = ctk.CTkFrame(self, fg_color="transparent")
        btn_row.pack(pady=(0, 4))
        ctk.CTkButton(
            btn_row, text="📂  Import TSF File",
            width=200, height=40,
            font=ctk.CTkFont(size=14),
            command=self._import_tsf,
        ).pack(side="left", padx=10)
        ctk.CTkButton(
            btn_row, text="📋  Import GSTR-2B JSON",
            width=200, height=40,
            font=ctk.CTkFont(size=14),
            fg_color="#6D28D9", hover_color="#5B21B6",
            command=self._import_gstr2b,
        ).pack(side="left", padx=10)
        ctk.CTkButton(
            btn_row, text="🔄  Fetch from Tally",
            width=200, height=40,
            font=ctk.CTkFont(size=14),
            fg_color="#B45309", hover_color="#92400E",
            command=self._open_tally_dialog,
        ).pack(side="left", padx=10)

        # Row 2 – export button (centred, full-width feel)
        btn_row2 = ctk.CTkFrame(self, fg_color="transparent")
        btn_row2.pack(pady=4)
        self._export_btn = ctk.CTkButton(
            btn_row2, text="📊  Export Full Report",
            width=628, height=40,
            font=ctk.CTkFont(size=14),
            fg_color="#0F766E", hover_color="#0D6B63",
            state="disabled",
            command=self._export_full_report,
        )
        self._export_btn.pack()

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

    # ── Queue polling ─────────────────────────────────────────────────────────

    def _poll_queue(self) -> None:
        while True:
            try:
                kind, payload = self._queue.get_nowait()
            except queue.Empty:
                break
            if kind == "status":
                self._status_var.set(payload)
            elif kind == "tsf_ready":
                self._load_tsf(payload)
            elif kind == "tally_done":
                self._status_var.set(f"Tally export complete. Loading {payload}…")
                threading.Thread(target=self._load_tsf, args=(payload,), daemon=True).start()
            elif kind == "tally_error":
                self._status_var.set("Tally fetch failed.")
                messagebox.showerror("Tally Fetch Error", payload)
            elif kind == "export_done":
                self._export_btn.configure(state="normal")
                self._status_var.set(f"Saved: {payload}")
                messagebox.showinfo("Export Complete", f"Full report saved to:\n{payload}")
            elif kind == "export_error":
                self._export_btn.configure(state="normal")
                self._status_var.set(f"Export failed: {payload}")
                messagebox.showerror("Export Error", payload)
        self.after(100, self._poll_queue)

    # ── Panel lifecycle ───────────────────────────────────────────────────────

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

    # ── Import TSF file ───────────────────────────────────────────────────────

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

    # ── Import GSTR-2B ────────────────────────────────────────────────────────

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

    # ── Fetch from Tally ──────────────────────────────────────────────────────

    def _open_tally_dialog(self) -> None:
        """Show a modal dialog for Tally live fetch parameters."""
        dlg = _TallyFetchDialog(self)
        self.wait_window(dlg)
        if dlg.result is None:
            return
        from_date, to_date, company, out_dir = dlg.result
        self._status_var.set("Connecting to Tally Prime on port 9000…")
        threading.Thread(
            target=self._run_tally_fetch,
            args=(from_date, to_date, company, out_dir),
            daemon=True,
        ).start()

    def _run_tally_fetch(self, from_date: str, to_date: str, company: str, out_dir: str) -> None:
        try:
            import sys
            import os
            from pathlib import Path

            # Add the python-tsf-exporter package to sys.path if available
            repo_root = Path(__file__).resolve().parents[3]
            exporter_root = repo_root / "python-tsf-exporter"
            if exporter_root.exists() and str(exporter_root) not in sys.path:
                sys.path.insert(0, str(exporter_root))

            from tsf_exporter.controller.export_controller import ExportController, ExportRequest
            from tsf_exporter.model.runtime_paths import resolve_app_paths

            paths = resolve_app_paths()
            controller = ExportController(paths)
            request = ExportRequest(
                from_date=from_date,
                to_date=to_date,
                company=company,
                out_dir=Path(out_dir),
            )

            def on_progress(msg: str) -> None:
                self._queue.put(("status", msg))

            result = controller.run_export_sync(request, progress_callback=on_progress)
            self._queue.put(("tally_done", str(result.output_path)))
        except ImportError:
            self._queue.put(("tally_error",
                "The python-tsf-exporter package was not found.\n\n"
                "Make sure the 'python-tsf-exporter' folder is present next to 'finanalyzer_py' "
                "in the repository root."))
        except Exception as exc:
            import traceback
            self._queue.put(("tally_error", traceback.format_exc()[-600:]))

    # ── Export full report ────────────────────────────────────────────────────

    def _export_full_report(self) -> None:
        if not self.app_state.entries:
            messagebox.showwarning("No Data", "Import a TSF file before exporting.")
            return

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


# ── Tally fetch dialog ────────────────────────────────────────────────────────

class _TallyFetchDialog(ctk.CTkToplevel):
    """Modal dialog: date range + company name + output folder for Tally fetch."""

    def __init__(self, parent: ctk.CTkFrame) -> None:
        super().__init__(parent)
        self.title("Fetch from Tally Prime")
        self.resizable(False, False)
        self.grab_set()
        self.result: tuple[str, str, str, str] | None = None
        self._build()
        self._center(parent)

    def _center(self, parent: ctk.CTkFrame) -> None:
        self.update_idletasks()
        px = parent.winfo_rootx() + parent.winfo_width() // 2
        py = parent.winfo_rooty() + parent.winfo_height() // 2
        w, h = self.winfo_width(), self.winfo_height()
        self.geometry(f"+{px - w // 2}+{py - h // 2}")

    def _build(self) -> None:
        pad = {"padx": 20, "pady": 6}

        ctk.CTkLabel(self, text="Fetch from Tally Prime",
                     font=ctk.CTkFont(size=16, weight="bold")).pack(pady=(20, 4))
        ctk.CTkLabel(self,
                     text="Tally Prime must be open and Gateway of Tally must be running.\n"
                          "Ensure 'Enable ODBC Server' is ON (port 9000).",
                     font=ctk.CTkFont(size=11), text_color="gray",
                     justify="center").pack(pady=(0, 12))

        form = ctk.CTkFrame(self, fg_color="transparent")
        form.pack(fill="x", **pad)
        form.columnconfigure(1, weight=1)

        def row(r: int, label: str) -> ctk.CTkEntry:
            ctk.CTkLabel(form, text=label, anchor="e").grid(row=r, column=0, padx=(0, 8), pady=4, sticky="e")
            e = ctk.CTkEntry(form, width=220)
            e.grid(row=r, column=1, pady=4, sticky="ew")
            return e

        self._from_entry = row(0, "From Date (dd/mm/yyyy):")
        self._to_entry   = row(1, "To Date (dd/mm/yyyy):")
        self._co_entry   = row(2, "Company Name (optional):")

        # Output folder
        ctk.CTkLabel(form, text="Save TSF to:", anchor="e").grid(row=3, column=0, padx=(0, 8), pady=4, sticky="e")
        dir_frame = ctk.CTkFrame(form, fg_color="transparent")
        dir_frame.grid(row=3, column=1, pady=4, sticky="ew")
        dir_frame.columnconfigure(0, weight=1)
        self._dir_var = tk.StringVar(value=str(__import__("pathlib").Path.home() / "Downloads"))
        ctk.CTkEntry(dir_frame, textvariable=self._dir_var, width=170).grid(row=0, column=0, sticky="ew")
        ctk.CTkButton(dir_frame, text="…", width=36, command=self._browse_dir).grid(row=0, column=1, padx=(4, 0))

        # Buttons
        btn_row = ctk.CTkFrame(self, fg_color="transparent")
        btn_row.pack(pady=(12, 20))
        ctk.CTkButton(btn_row, text="Cancel", width=100,
                      fg_color="gray40", hover_color="gray30",
                      command=self.destroy).pack(side="left", padx=8)
        ctk.CTkButton(btn_row, text="Fetch", width=100,
                      fg_color="#B45309", hover_color="#92400E",
                      command=self._on_fetch).pack(side="left", padx=8)

    def _browse_dir(self) -> None:
        d = filedialog.askdirectory(title="Save TSF file to…")
        if d:
            self._dir_var.set(d)

    def _on_fetch(self) -> None:
        from_date = self._from_entry.get().strip()
        to_date   = self._to_entry.get().strip()
        company   = self._co_entry.get().strip()
        out_dir   = self._dir_var.get().strip()

        if not from_date or not to_date:
            messagebox.showwarning("Missing Dates", "Please enter both From Date and To Date.", parent=self)
            return
        if not out_dir:
            messagebox.showwarning("Missing Folder", "Please select an output folder.", parent=self)
            return

        self.result = (from_date, to_date, company, out_dir)
        self.destroy()
