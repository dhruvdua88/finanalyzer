from __future__ import annotations

from export.base_exporter import BaseExporter
from export.styles import AMOUNT_FMT, hex_fill

STATUS_COLORS = {
    "Deducted": "DCFCE7",
    "Short Deducted": "FEF3C7",
    "Missed": "FEE2E2",
    "Below Threshold": "F1F5F9",
}

HEADERS = [
    "Ledger / Party Name", "Date", "Voucher Type", "Voucher No",
    "Party Name", "Expense Ledger", "Ledger Hit (₹)", "Status",
    "TDS Deducted (₹)", "Applied Rate (%)", "Expected Rate (%)", "Rate Deviation (%)",
    "Shortfall (₹)", "Section", "Party YTD Before (₹)", "Party YTD After (₹)",
    "Threshold Crossed", "TDS Ledgers", "Narration", "Audit Note",
]


class TDSExporter(BaseExporter):

    def export(self, rows: list[dict], company: str, period: str) -> None:
        ws = self.add_sheet("TDS Analysis")
        n = len(HEADERS)
        self.write_title_row(ws, "TDS Analysis", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, HEADERS, row=4, freeze_row=4, freeze_col=1)

        amt_cols = {7: AMOUNT_FMT, 9: AMOUNT_FMT, 13: AMOUNT_FMT, 15: AMOUNT_FMT, 16: AMOUNT_FMT}
        pct_cols = {10: "0.00", 11: "0.00", 12: "0.00"}

        for i, r in enumerate(rows):
            status = r.get("status", "")
            fill = hex_fill(STATUS_COLORS.get(status, "FFFFFF"))
            vals = [
                r["ledger"], r["date"], r["voucher_type"], r["voucher_number"],
                r["party_name"], r["expense_ledger"], r["ledger_hit"], status,
                r["tds_deducted"], r["applied_rate"], r["expected_rate"], r["rate_deviation"],
                r["shortfall"], r["section"], r["party_ytd_before"], r["party_ytd_after"],
                r["threshold_crossed"], r["tds_ledgers"], r["narration"], r["audit_note"],
            ]
            num_fmts = {**amt_cols, **pct_cols}
            self.write_data_row(ws, i + 5, vals, i % 2 == 0, num_fmt_cols=num_fmts, fill_override=fill)

        self.set_col_widths(ws, [
            26, 12, 14, 16, 26, 26, 14, 16,
            14, 13, 13, 14, 13, 10, 14, 14,
            14, 22, 30, 20,
        ])
