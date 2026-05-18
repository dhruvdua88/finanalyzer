from __future__ import annotations

import queue
import threading
import tkinter as tk
from tkinter import filedialog, messagebox
from typing import Any, Callable

import customtkinter as ctk

from app.state import AppState

PANEL_TITLE = "Module"


class BasePanel(ctk.CTkFrame):
    """
    Base class for all 24 analysis module panels.

    Subclasses must define:
        PANEL_TITLE: str
        EXPORT_FILENAME: str   (without extension)
        _build_content()       → add filter widgets + DataTable
        _run_analysis() → Any  → return result (called in thread)
        _on_result(result)     → render result into the DataTable
        _run_export(path, result) → call the correct exporter and save

    Threading: all heavy work runs in a daemon thread and communicates
    back via self._queue polled by self.after(100, _poll_queue).
    """

    PANEL_TITLE: str = "Module"
    EXPORT_FILENAME: str = "Export"

    def __init__(
        self,
        parent: tk.Widget,
        app_state: AppState,
        on_state_change: Callable[[], None],
        **kwargs: Any,
    ) -> None:
        super().__init__(parent, **kwargs)
        self.app_state = app_state
        self.on_state_change = on_state_change
        self._queue: queue.Queue[tuple[str, Any]] = queue.Queue()
        self._last_result: Any = None

        self._build_header()
        self._build_content()
        self._build_statusbar()
        self.after(100, self._poll_queue)

    # ── Layout helpers ────────────────────────────────────────────────────────

    def _build_header(self) -> None:
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(12, 0))

        ctk.CTkLabel(
            header,
            text=self.PANEL_TITLE,
            font=ctk.CTkFont(size=20, weight="bold"),
        ).pack(side="left")

        self.export_btn = ctk.CTkButton(
            header,
            text="Export to Excel",
            command=self._on_export_click,
            state="disabled",
            width=140,
        )
        self.export_btn.pack(side="right", padx=4)

        self.run_btn = ctk.CTkButton(
            header,
            text="Run Analysis",
            command=self._trigger_analysis,
            width=120,
        )
        self.run_btn.pack(side="right", padx=4)

    def _build_content(self) -> None:
        """Override in subclass to add filter controls + DataTable."""

    def _build_statusbar(self) -> None:
        self._status_var = tk.StringVar(value="Ready")
        ctk.CTkLabel(
            self,
            textvariable=self._status_var,
            font=ctk.CTkFont(size=11),
            anchor="w",
        ).pack(side="bottom", fill="x", padx=16, pady=4)

    # ── Public API ────────────────────────────────────────────────────────────

    def on_activate(self) -> None:
        """Called when this panel is switched to."""
        if self._last_result is None and self.app_state.entries:
            self._trigger_analysis()

    def refresh_from_state(self) -> None:
        """Called after state.entries is updated (e.g. new TSF loaded)."""

    # ── Analysis ──────────────────────────────────────────────────────────────

    def _trigger_analysis(self) -> None:
        if not self.app_state.entries:
            self._set_status("No data loaded. Import a TSF file first.")
            return
        self._set_status("Computing…")
        self.run_btn.configure(state="disabled")
        self.export_btn.configure(state="disabled")
        threading.Thread(target=self._run_analysis_safe, daemon=True).start()

    def _run_analysis_safe(self) -> None:
        try:
            result = self._run_analysis()
            self._queue.put(("result", result))
        except Exception as exc:
            self._queue.put(("error", str(exc)))

    def _run_analysis(self) -> Any:
        """Override: compute and return result (runs in background thread)."""
        return None

    def _on_result(self, result: Any) -> None:
        """Override: render result into the UI (runs on main thread)."""

    # ── Export ────────────────────────────────────────────────────────────────

    def _on_export_click(self) -> None:
        path = filedialog.asksaveasfilename(
            defaultextension=".xlsx",
            filetypes=[("Excel Workbook", "*.xlsx")],
            initialfile=f"{self.EXPORT_FILENAME}.xlsx",
        )
        if not path:
            return
        self.export_btn.configure(state="disabled")
        self._set_status("Exporting…")
        result = self._last_result
        threading.Thread(
            target=self._run_export_safe, args=(path, result), daemon=True
        ).start()

    def _run_export_safe(self, path: str, result: Any) -> None:
        try:
            self._run_export(path, result)
            self._queue.put(("export_done", path))
        except Exception as exc:
            self._queue.put(("error", str(exc)))

    def _run_export(self, path: str, result: Any) -> None:
        """Override: call the correct exporter and save to path."""

    # ── Queue polling ─────────────────────────────────────────────────────────

    def _poll_queue(self) -> None:
        while True:
            try:
                kind, payload = self._queue.get_nowait()
            except queue.Empty:
                break

            if kind == "result":
                self._last_result = payload
                self._on_result(payload)
                self.export_btn.configure(state="normal")
                self.run_btn.configure(state="normal")
                self._set_status("Done.")
            elif kind == "export_done":
                self.export_btn.configure(state="normal")
                self._set_status(f"Saved: {payload}")
            elif kind == "error":
                self.run_btn.configure(state="normal")
                self.export_btn.configure(
                    state="normal" if self._last_result is not None else "disabled"
                )
                self._set_status(f"Error: {payload}")
                messagebox.showerror(self.PANEL_TITLE, payload)
            elif kind == "status":
                self._set_status(payload)

        self.after(100, self._poll_queue)

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _set_status(self, msg: str) -> None:
        self._status_var.set(msg)

    def _post_status(self, msg: str) -> None:
        """Thread-safe status update."""
        self._queue.put(("status", msg))
