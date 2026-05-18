from __future__ import annotations

import tkinter as tk
from tkinter import ttk
from typing import Callable

import customtkinter as ctk


class LedgerSelector(ctk.CTkFrame):
    """
    Searchable multi-select list of ledger names.
    Shows a search entry + scrollable checklist.
    Calls on_change(selected_names) whenever the selection changes.
    """

    def __init__(
        self,
        parent: tk.Widget,
        label: str = "Select Ledgers",
        on_change: Callable[[list[str]], None] | None = None,
        height: int = 180,
        **kwargs,
    ) -> None:
        super().__init__(parent, **kwargs)
        self._on_change = on_change
        self._all_items: list[str] = []
        self._vars: dict[str, tk.BooleanVar] = {}
        self._height = height
        self._build(label)

    def _build(self, label: str) -> None:
        ctk.CTkLabel(self, text=label, font=ctk.CTkFont(weight="bold")).pack(
            anchor="w", padx=4, pady=(4, 0)
        )

        # Search box
        self._search_var = tk.StringVar()
        self._search_var.trace_add("write", lambda *_: self._filter())
        search = ctk.CTkEntry(self, textvariable=self._search_var, placeholder_text="Search…")
        search.pack(fill="x", padx=4, pady=4)

        # Select / Clear buttons
        btn_row = ctk.CTkFrame(self, fg_color="transparent")
        btn_row.pack(fill="x", padx=4, pady=(0, 4))
        ctk.CTkButton(btn_row, text="Select All", width=90,
                      command=self._select_all).pack(side="left", padx=2)
        ctk.CTkButton(btn_row, text="Clear All", width=90,
                      command=self._clear_all).pack(side="left", padx=2)

        # Scrollable frame for checkboxes
        self._scroll_frame = ctk.CTkScrollableFrame(self, height=self._height)
        self._scroll_frame.pack(fill="both", expand=True, padx=4, pady=(0, 4))

    def set_items(self, items: list[str]) -> None:
        self._all_items = sorted(items)
        self._vars = {name: tk.BooleanVar(value=False) for name in self._all_items}
        self._render_list(self._all_items)

    def get_selected(self) -> list[str]:
        return [name for name, var in self._vars.items() if var.get()]

    def set_selected(self, items: list[str]) -> None:
        item_set = set(items)
        for name, var in self._vars.items():
            var.set(name in item_set)

    def _filter(self) -> None:
        q = self._search_var.get().lower()
        filtered = [n for n in self._all_items if q in n.lower()] if q else self._all_items
        self._render_list(filtered)

    def _render_list(self, items: list[str]) -> None:
        for widget in self._scroll_frame.winfo_children():
            widget.destroy()
        for name in items:
            var = self._vars.get(name)
            if var is None:
                continue
            cb = ctk.CTkCheckBox(
                self._scroll_frame,
                text=name,
                variable=var,
                command=self._on_toggle,
                font=ctk.CTkFont(size=11),
            )
            cb.pack(anchor="w", padx=4, pady=1)

    def _on_toggle(self) -> None:
        if self._on_change:
            self._on_change(self.get_selected())

    def _select_all(self) -> None:
        for var in self._vars.values():
            var.set(True)
        if self._on_change:
            self._on_change(self.get_selected())

    def _clear_all(self) -> None:
        for var in self._vars.values():
            var.set(False)
        if self._on_change:
            self._on_change([])
