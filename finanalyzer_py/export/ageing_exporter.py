from __future__ import annotations

from export.base_exporter import BaseExporter
from export.styles import AMOUNT_FMT, COUNT_FMT, DATE_FMT, OBS_FILL, OBS_FONT, CENTER
from app.constants import AGE_BUCKET_LABELS


class AgeingExporter(BaseExporter):

    SUMMARY_HEADERS = [
        "Party", "Opening Dr", "Opening Cr",
        "Closing Dr (Ledger)", "Closing Cr (Ledger)",
        "FIFO Closing Receivable", "FIFO Advance", "Net FIFO (Dr-Cr)",
        "Invoices",
        "0-30 days", "31-60 days", "61-90 days", "91-180 days", "181-365 days", ">365 days",
    ]
    INVOICE_HEADERS = [
        "Party", "Voucher / Invoice", "Invoice Date", "Age (Days)",
        "Bucket", "Original Amount (₹)", "Outstanding Amount (₹)", "Remarks",
    ]
    RECON_HEADERS = ["Check", "FIFO Value (₹)", "Ledger Value (₹)", "Difference (₹)", "Status"]

    def export(self, data: dict, company: str, period: str) -> None:
        mode = data["mode"]
        label = "Debtor" if mode == "debtor" else "Creditor"
        parties = data["parties"]
        as_of = data["as_of"]
        meta = f"{company}  |  As of {as_of}  |  {period}"

        self._summary_sheet(parties, label, meta)
        self._invoice_sheet(parties, label, meta)
        self._recon_sheet(data["recon"], label, meta)

    def _summary_sheet(self, parties: list[dict], label: str, meta: str) -> None:
        ws = self.add_sheet("Summary")
        n = len(self.SUMMARY_HEADERS)
        self.write_title_row(ws, f"{label} Ageing Summary (FIFO)", n, row=1)
        self.write_meta_row(ws, meta, n, row=2)
        self.write_meta_row(ws, "Ageing as of report date using FIFO knock-off method", n, row=3)
        self.write_header_row(ws, self.SUMMARY_HEADERS, row=5, freeze_row=5, freeze_col=1)

        amt_cols = {i: AMOUNT_FMT for i in range(2, 16)}
        amt_cols[9] = COUNT_FMT

        totals = [0.0] * (len(self.SUMMARY_HEADERS) - 1)
        for i, p in enumerate(parties):
            vals = [
                p["party"], p["opening_dr"], p["opening_cr"],
                p["closing_dr"], p["closing_cr"],
                p["fifo_receivable"], p["fifo_advance"], p["net_fifo"],
                p["invoice_count"],
                *p["buckets"],
            ]
            self.write_data_row(ws, i + 6, vals, i % 2 == 0, num_fmt_cols=amt_cols)
            for j, v in enumerate(vals[1:]):
                if isinstance(v, (int, float)):
                    totals[j] += v

        tr = len(parties) + 6
        self.write_total_row(ws, tr, ["TOTAL"] + [round(t, 2) for t in totals], num_fmt_cols=amt_cols)

        # Observations block
        total_outstanding = sum(p["fifo_receivable"] for p in parties)
        obs = [
            f"Total Outstanding (FIFO): ₹{total_outstanding:,.2f}",
            f"Parties with outstanding: {sum(1 for p in parties if p['fifo_receivable'] > 0)}",
            f"Parties with advance: {sum(1 for p in parties if p['fifo_advance'] > 0)}",
        ]
        self.write_obs_block(ws, tr + 2, obs, n)
        self.set_col_widths(ws, [34, 13, 13, 14, 14, 18, 14, 14, 10, 13, 13, 13, 13, 13, 13])

    def _invoice_sheet(self, parties: list[dict], label: str, meta: str) -> None:
        ws = self.add_sheet("Invoice FIFO")
        n = len(self.INVOICE_HEADERS)
        self.write_title_row(ws, f"{label} FIFO Invoice Detail", n, row=1)
        self.write_meta_row(ws, meta, n, row=2)
        self.write_header_row(ws, self.INVOICE_HEADERS, row=5, freeze_row=5, freeze_col=1)

        amt_cols = {6: AMOUNT_FMT, 7: AMOUNT_FMT, 4: COUNT_FMT}
        row_num = 6
        for p in parties:
            for i, inv in enumerate(p["invoices"]):
                vals = [
                    inv["party"], inv["voucher_number"], inv["invoice_date"],
                    inv["age_days"], inv["bucket_label"],
                    inv["original_amount"], inv["outstanding"], inv["remarks"],
                ]
                self.write_data_row(ws, row_num, vals, row_num % 2 == 0, num_fmt_cols=amt_cols)
                row_num += 1

        self.set_col_widths(ws, [34, 22, 14, 10, 12, 16, 18, 28])

    def _recon_sheet(self, recon: list[dict], label: str, meta: str) -> None:
        ws = self.add_sheet("Reconciliation")
        n = len(self.RECON_HEADERS)
        self.write_title_row(ws, f"{label} FIFO Reconciliation", n, row=1)
        self.write_meta_row(ws, meta, n, row=2)
        self.write_header_row(ws, self.RECON_HEADERS, row=4, freeze_row=4)

        amt_cols = {2: AMOUNT_FMT, 3: AMOUNT_FMT, 4: AMOUNT_FMT}
        from export.styles import RED_FILL, GREEN_FILL
        for i, r in enumerate(recon):
            fill = GREEN_FILL if r["status"] == "PASS" else RED_FILL
            vals = [r["check"], r["fifo_value"], r["ledger_value"], r["difference"], r["status"]]
            self.write_data_row(ws, i + 5, vals, True, num_fmt_cols=amt_cols, fill_override=fill)

        self.set_col_widths(ws, [30, 15, 18, 18, 12])
