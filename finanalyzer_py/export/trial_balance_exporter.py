from __future__ import annotations

from export.base_exporter import BaseExporter
from export.styles import AMOUNT_FMT, LEFT, RIGHT, CENTER


class TrialBalanceExporter(BaseExporter):
    COLS_GROUP = [
        "Primary Group", "Parent Group",
        "Opening Dr (₹)", "Opening Cr (₹)",
        "During Dr (₹)", "During Cr (₹)",
        "Closing Dr (₹)", "Closing Cr (₹)",
    ]
    COLS_LEDGER = [
        "Ledger", "Primary Group", "Parent Group",
        "Opening Dr (₹)", "Opening Cr (₹)",
        "During Dr (₹)", "During Cr (₹)",
        "Closing Dr (₹)", "Closing Cr (₹)",
    ]
    AMT_COLS_GROUP = {3: AMOUNT_FMT, 4: AMOUNT_FMT, 5: AMOUNT_FMT, 6: AMOUNT_FMT, 7: AMOUNT_FMT, 8: AMOUNT_FMT}
    AMT_COLS_LEDGER = {4: AMOUNT_FMT, 5: AMOUNT_FMT, 6: AMOUNT_FMT, 7: AMOUNT_FMT, 8: AMOUNT_FMT, 9: AMOUNT_FMT}

    def export(self, data: dict, company: str, period: str) -> None:
        self._export_groups(data["groups"], company, period)
        self._export_ledgers(data["ledgers"], company, period)

    def _export_groups(self, rows: list[dict], company: str, period: str) -> None:
        ws = self.add_sheet("Group Summary")
        n = len(self.COLS_GROUP)
        self.write_title_row(ws, f"Trial Balance – Group Summary", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, self.COLS_GROUP, row=4, freeze_row=4)

        totals = [0.0] * 6
        for i, r in enumerate(rows):
            vals = [r["primary"], r["parent"],
                    r["opening_dr"], r["opening_cr"],
                    r["during_dr"], r["during_cr"],
                    r["closing_dr"], r["closing_cr"]]
            self.write_data_row(ws, i + 5, vals, i % 2 == 0, num_fmt_cols=self.AMT_COLS_GROUP)
            for j, k in enumerate(["opening_dr", "opening_cr", "during_dr", "during_cr", "closing_dr", "closing_cr"]):
                totals[j] += r[k]

        tr = len(rows) + 5
        self.write_total_row(ws, tr, ["TOTAL", ""] + [round(t, 2) for t in totals], num_fmt_cols=self.AMT_COLS_GROUP)
        self.set_col_widths(ws, [30, 22, 14, 14, 14, 14, 14, 14])

    def _export_ledgers(self, rows: list[dict], company: str, period: str) -> None:
        ws = self.add_sheet("Ledger Detail")
        n = len(self.COLS_LEDGER)
        self.write_title_row(ws, f"Trial Balance – Ledger Detail", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, self.COLS_LEDGER, row=4, freeze_row=4)

        for i, r in enumerate(rows):
            vals = [r["ledger"], r["primary"], r["parent"],
                    r["opening_dr"], r["opening_cr"],
                    r["during_dr"], r["during_cr"],
                    r["closing_dr"], r["closing_cr"]]
            self.write_data_row(ws, i + 5, vals, i % 2 == 0, num_fmt_cols=self.AMT_COLS_LEDGER)

        self.set_col_widths(ws, [34, 26, 22, 14, 14, 14, 14, 14, 14])
