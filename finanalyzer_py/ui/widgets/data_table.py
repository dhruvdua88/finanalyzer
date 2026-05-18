from __future__ import annotations

import tkinter as tk
from tkinter import ttk
from typing import Any

PAGE_SIZE = 500


class DataTable(tk.Frame):
    """
    Scrollable ttk.Treeview with sort, alternating row colours,
    and simple page-based pagination (PAGE_SIZE rows per page).
    """

    def __init__(
        self,
        parent: tk.Widget,
        columns: list[tuple[str, str, int]],  # (col_id, heading, width)
        **kwargs: Any,
    ) -> None:
        super().__init__(parent, **kwargs)
        self._all_rows: list[list] = []
        self._page = 0
        self._sort_col: str | None = None
        self._sort_rev = False

        self._build(columns)

    def _build(self, columns: list[tuple[str, str, int]]) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(0, weight=1)

        col_ids = [c[0] for c in columns]
        self.tree = ttk.Treeview(self, columns=col_ids, show="headings", selectmode="browse")

        for col_id, heading, width in columns:
            self.tree.heading(col_id, text=heading, command=lambda c=col_id: self._on_header(c))
            self.tree.column(col_id, width=width, minwidth=40, anchor="e" if width < 80 else "w")

        vsb = ttk.Scrollbar(self, orient="vertical", command=self.tree.yview)
        hsb = ttk.Scrollbar(self, orient="horizontal", command=self.tree.xview)
        self.tree.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)

        self.tree.grid(row=0, column=0, sticky="nsew")
        vsb.grid(row=0, column=1, sticky="ns")
        hsb.grid(row=1, column=0, sticky="ew")

        # Pagination bar
        nav = tk.Frame(self)
        nav.grid(row=2, column=0, columnspan=2, sticky="ew", pady=2)
        self._prev_btn = tk.Button(nav, text="◀ Prev", command=self._prev_page, state="disabled")
        self._prev_btn.pack(side="left", padx=4)
        self._page_label = tk.Label(nav, text="")
        self._page_label.pack(side="left", padx=8)
        self._next_btn = tk.Button(nav, text="Next ▶", command=self._next_page, state="disabled")
        self._next_btn.pack(side="left", padx=4)
        self._count_label = tk.Label(nav, text="", fg="#555")
        self._count_label.pack(side="right", padx=8)

        # Alternating row tags
        self.tree.tag_configure("odd", background="#FFFFFF")
        self.tree.tag_configure("even", background="#F8FAFC")

    def load_rows(self, rows: list[list]) -> None:
        self._all_rows = rows
        self._page = 0
        self._render_page()

    def clear(self) -> None:
        for item in self.tree.get_children():
            self.tree.delete(item)
        self._all_rows = []
        self._page = 0
        self._update_nav()

    def _render_page(self) -> None:
        for item in self.tree.get_children():
            self.tree.delete(item)
        start = self._page * PAGE_SIZE
        end = start + PAGE_SIZE
        for i, row in enumerate(self._all_rows[start:end]):
            tag = "odd" if i % 2 == 0 else "even"
            self.tree.insert("", "end", values=[str(v) if v is not None else "" for v in row], tags=(tag,))
        self._update_nav()

    def _update_nav(self) -> None:
        total = len(self._all_rows)
        total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
        self._page_label.config(text=f"Page {self._page + 1} of {total_pages}")
        self._prev_btn.config(state="normal" if self._page > 0 else "disabled")
        self._next_btn.config(state="normal" if self._page < total_pages - 1 else "disabled")
        self._count_label.config(text=f"{total:,} rows")

    def _prev_page(self) -> None:
        if self._page > 0:
            self._page -= 1
            self._render_page()

    def _next_page(self) -> None:
        total_pages = (len(self._all_rows) + PAGE_SIZE - 1) // PAGE_SIZE
        if self._page < total_pages - 1:
            self._page += 1
            self._render_page()

    def _on_header(self, col: str) -> None:
        if self._sort_col == col:
            self._sort_rev = not self._sort_rev
        else:
            self._sort_col = col
            self._sort_rev = False
        col_ids = [self.tree.heading(c)["text"] for c in self.tree["columns"]]
        col_idx = list(self.tree["columns"]).index(col)
        self._all_rows.sort(
            key=lambda r: _sort_key(r[col_idx] if col_idx < len(r) else ""),
            reverse=self._sort_rev,
        )
        self._page = 0
        self._render_page()


def _sort_key(val: Any) -> tuple:
    try:
        return (0, float(str(val).replace(",", "")))
    except (ValueError, TypeError):
        return (1, str(val).lower())
