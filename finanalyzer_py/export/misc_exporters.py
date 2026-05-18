"""
Consolidated exporter for smaller modules:
  VoucherBookExporter, LedgerVoucherExporter, GSTRateExporter,
  SalesRegisterExporter, PurchaseRegisterExporter, RCMExporter,
  GSTExpenseExporter, GSTLedgerExporter, LedgerAnalyticsExporter,
  CashFlowExporter, PnLExporter, VarianceExporter,
  ExceptionHeatmapExporter, BSCleanlinessExporter,
  RelatedPartyExporter, OrphanPLExporter, TSFComparisonExporter,
  GSTR2BExporter
"""
from __future__ import annotations

from export.base_exporter import BaseExporter
from export.styles import (
    AMOUNT_FMT, COUNT_FMT, DATE_FMT, hex_fill, thin_border,
    RED_FILL, GREEN_FILL, AMBER_FILL, HEADER_FONT, CENTER,
)


class VoucherBookExporter(BaseExporter):
    HEADERS = ["Date", "Voucher No", "Voucher Type", "Party Name", "Total Dr (₹)", "Total Cr (₹)", "Narration"]

    def export(self, rows: list[dict], company: str, period: str) -> None:
        ws = self.add_sheet("Voucher Book")
        n = len(self.HEADERS)
        self.write_title_row(ws, "Voucher Book", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, self.HEADERS, row=4, freeze_row=4)
        amt_cols = {5: AMOUNT_FMT, 6: AMOUNT_FMT}
        for i, r in enumerate(rows):
            self.write_data_row(ws, i + 5, [r["date"], r["voucher_number"], r["voucher_type"],
                                            r["party_name"], r["total_dr"], r["total_cr"], r["narration"]],
                                i % 2 == 0, num_fmt_cols=amt_cols)
        self.set_col_widths(ws, [12, 18, 16, 28, 14, 14, 50])


class LedgerVoucherExporter(BaseExporter):
    HEADERS = ["Date", "Voucher Type", "Voucher No", "Party Name", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]

    def export(self, data: dict, company: str, period: str) -> None:
        ws = self.add_sheet("Ledger Statement")
        n = len(self.HEADERS)
        self.write_title_row(ws, f"Ledger: {data['ledger']}", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}  |  Opening: ₹{data['opening']:,.2f}", n, row=2)
        self.write_header_row(ws, self.HEADERS, row=4, freeze_row=4)
        amt_cols = {6: AMOUNT_FMT, 7: AMOUNT_FMT, 8: AMOUNT_FMT}
        for i, r in enumerate(data["rows"]):
            self.write_data_row(ws, i + 5, [r["date"], r["voucher_type"], r["voucher_number"],
                                            r["party_name"], r["narration"], r["debit"], r["credit"], r["balance"]],
                                i % 2 == 0, num_fmt_cols=amt_cols)
        tr = len(data["rows"]) + 5
        self.write_total_row(ws, tr, ["CLOSING BALANCE", "", "", "", "", 0.0, 0.0, round(data["closing"], 2)],
                             num_fmt_cols=amt_cols)
        self.set_col_widths(ws, [12, 16, 18, 28, 40, 14, 14, 14])


class GSTRateExporter(BaseExporter):
    HEADERS = ["Date", "Voucher Type", "Voucher No", "Party", "GSTIN", "Invoice No",
               "Taxable Amount (₹)", "GST Amount (₹)", "Effective Rate (%)", "GST Ledgers", "Narration"]

    def export(self, rows: list[dict], company: str, period: str) -> None:
        ws = self.add_sheet("GST Rate Analysis")
        n = len(self.HEADERS)
        self.write_title_row(ws, "GST Rate Analysis", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, self.HEADERS, row=4, freeze_row=4)
        amt_cols = {7: AMOUNT_FMT, 8: AMOUNT_FMT, 9: "0.00"}
        for i, r in enumerate(rows):
            self.write_data_row(ws, i + 5, [r["date"], r["voucher_type"], r["voucher_number"],
                                            r["party_name"], r["gstin"], r["invoice_number"],
                                            r["taxable_amount"], r["gst_amount"], r["effective_rate"],
                                            r["gst_ledgers"], r["narration"]],
                                i % 2 == 0, num_fmt_cols=amt_cols)
        self.set_col_widths(ws, [12, 14, 16, 28, 18, 18, 16, 14, 14, 28, 40])


class SalesRegisterExporter(BaseExporter):
    HEADERS = ["Date", "Voucher No", "Party", "GSTIN", "Invoice No",
               "Taxable (₹)", "GST (₹)", "Total (₹)", "Narration"]

    def export(self, rows: list[dict], company: str, period: str) -> None:
        ws = self.add_sheet("Sales Register")
        n = len(self.HEADERS)
        self.write_title_row(ws, "Sales Register", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, self.HEADERS, row=4, freeze_row=4)
        amt_cols = {6: AMOUNT_FMT, 7: AMOUNT_FMT, 8: AMOUNT_FMT}
        for i, r in enumerate(rows):
            self.write_data_row(ws, i + 5, [r["date"], r["voucher_number"], r["party_name"],
                                            r["gstin"], r["invoice_number"], r["taxable_amount"],
                                            r["gst_amount"], r["total_amount"], r["narration"]],
                                i % 2 == 0, num_fmt_cols=amt_cols)
        self.set_col_widths(ws, [12, 16, 28, 18, 18, 16, 14, 14, 40])


class PurchaseRegisterExporter(BaseExporter):
    HEADERS = ["Date", "Voucher No", "Party", "GSTIN", "Invoice No",
               "Taxable (₹)", "IGST (₹)", "CGST (₹)", "SGST (₹)", "Total GST (₹)", "RCM (₹)", "Total (₹)", "Narration"]

    def export(self, rows: list[dict], company: str, period: str) -> None:
        ws = self.add_sheet("Purchase GST Register")
        n = len(self.HEADERS)
        self.write_title_row(ws, "Purchase GST Register", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, self.HEADERS, row=4, freeze_row=4)
        amt_cols = {i: AMOUNT_FMT for i in range(6, 14)}
        for i, r in enumerate(rows):
            self.write_data_row(ws, i + 5, [r["date"], r["voucher_number"], r["party_name"],
                                            r["gstin"], r["invoice_number"], r["taxable_amount"],
                                            r["igst"], r["cgst"], r["sgst"], r["total_gst"],
                                            r["rcm"], r["total_amount"], r["narration"]],
                                i % 2 == 0, num_fmt_cols=amt_cols)
        self.set_col_widths(ws, [12, 16, 28, 18, 18, 16, 12, 12, 12, 12, 12, 14, 40])


class RCMExporter(BaseExporter):
    HEADERS = ["Date", "Voucher Type", "Voucher No", "Party", "GSTIN", "RCM Ledgers", "RCM Amount (₹)", "Narration"]

    def export(self, rows: list[dict], company: str, period: str) -> None:
        ws = self.add_sheet("RCM Analysis")
        n = len(self.HEADERS)
        self.write_title_row(ws, "RCM Analysis", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, self.HEADERS, row=4, freeze_row=4)
        for i, r in enumerate(rows):
            self.write_data_row(ws, i + 5, [r["date"], r["voucher_type"], r["voucher_number"],
                                            r["party_name"], r["gstin"], r["rcm_ledgers"],
                                            r["rcm_amount"], r["narration"]],
                                i % 2 == 0, num_fmt_cols={7: AMOUNT_FMT})
        self.set_col_widths(ws, [12, 14, 16, 28, 18, 30, 14, 40])


class GSTExpenseExporter(BaseExporter):
    HEADERS = ["Date", "Voucher Type", "Voucher No", "Ledger", "Party", "Amount (₹)", "Narration"]

    def export(self, rows: list[dict], company: str, period: str) -> None:
        ws = self.add_sheet("Blocked Credit")
        n = len(self.HEADERS)
        self.write_title_row(ws, "GST Expense – Blocked Credit", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, self.HEADERS, row=4, freeze_row=4)
        for i, r in enumerate(rows):
            self.write_data_row(ws, i + 5, [r["date"], r["voucher_type"], r["voucher_number"],
                                            r["ledger"], r["party_name"], r["amount"], r["narration"]],
                                i % 2 == 0, num_fmt_cols={6: AMOUNT_FMT})
        self.set_col_widths(ws, [12, 14, 16, 28, 28, 14, 50])


class GSTLedgerExporter(BaseExporter):
    HEADERS = ["Ledger", "Type", "Net Credit (₹)", "Net Debit (₹)", "Net (₹)"]

    def export(self, rows: list[dict], company: str, period: str) -> None:
        ws = self.add_sheet("GST Ledger Summary")
        n = len(self.HEADERS)
        self.write_title_row(ws, "GST Ledger Summary", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, self.HEADERS, row=4, freeze_row=4)
        amt_cols = {3: AMOUNT_FMT, 4: AMOUNT_FMT, 5: AMOUNT_FMT}
        for i, r in enumerate(rows):
            self.write_data_row(ws, i + 5, [r["ledger"], r["type"], r["net_cr"], r["net_dr"], r["net"]],
                                i % 2 == 0, num_fmt_cols=amt_cols)
        self.set_col_widths(ws, [36, 16, 16, 16, 16])


class LedgerAnalyticsExporter(BaseExporter):
    HEADERS = [
        "Ledger", "Primary Group", "Parent Group",
        "Opening Dr (₹)", "Opening Cr (₹)", "During Dr (₹)", "During Cr (₹)",
        "Closing Dr (₹)", "Closing Cr (₹)", "Recon Diff (₹)", "Txn Count", "Flags",
    ]

    def export(self, rows: list[dict], company: str, period: str) -> None:
        ws = self.add_sheet("Ledger Analytics")
        n = len(self.HEADERS)
        self.write_title_row(ws, "Ledger Analytics", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, self.HEADERS, row=4, freeze_row=4, freeze_col=1)
        amt_cols = {i: AMOUNT_FMT for i in [4, 5, 6, 7, 8, 9, 10]}
        for i, r in enumerate(rows):
            fill = RED_FILL if r.get("flags") else None
            self.write_data_row(ws, i + 5, [r["ledger"], r["primary"], r["parent"],
                                            r["opening_dr"], r["opening_cr"], r["during_dr"], r["during_cr"],
                                            r["closing_dr"], r["closing_cr"], r["recon_diff"],
                                            r["txn_count"], r["flags"]],
                                i % 2 == 0, num_fmt_cols=amt_cols, fill_override=fill if r.get("flags") else None)
        self.set_col_widths(ws, [34, 26, 22, 14, 14, 14, 14, 14, 14, 12, 10, 24])


class CashFlowExporter(BaseExporter):
    HEADERS = ["Ledger", "Opening (₹)", "Inflow (₹)", "Outflow (₹)", "Closing (₹)", "Net Change (₹)"]

    def export(self, rows: list[dict], company: str, period: str) -> None:
        ws = self.add_sheet("Cash Flow")
        n = len(self.HEADERS)
        self.write_title_row(ws, "Cash Flow Analysis", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, self.HEADERS, row=4, freeze_row=4)
        amt_cols = {i: AMOUNT_FMT for i in range(2, 7)}
        for i, r in enumerate(rows):
            self.write_data_row(ws, i + 5, [r["ledger"], r["opening"], r["inflow"],
                                            r["outflow"], r["closing"], r["net"]],
                                i % 2 == 0, num_fmt_cols=amt_cols)
        totals = [sum(r[k] for r in rows) for k in ["opening", "inflow", "outflow", "closing", "net"]]
        self.write_total_row(ws, len(rows) + 5, ["TOTAL"] + [round(t, 2) for t in totals], num_fmt_cols=amt_cols)
        self.set_col_widths(ws, [34, 16, 16, 16, 16, 16])


class PnLExporter(BaseExporter):

    def export(self, data: dict, company: str, period: str) -> None:
        ws = self.add_sheet("P&L Analysis")
        months = data["months"]
        rows = data["rows"]
        headers = ["Head", "Primary Group", "Ledger"] + months + ["Total (₹)"]
        n = len(headers)
        self.write_title_row(ws, "Profit & Loss Analysis", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, headers, row=4, freeze_row=4, freeze_col=3)

        amt_start = 4
        amt_cols = {i: AMOUNT_FMT for i in range(amt_start, n + 1)}

        for i, r in enumerate(rows):
            vals = [r["head"], r["primary"], r["ledger"]]
            for m in months:
                vals.append(r["month_values"].get(m, 0.0))
            vals.append(r["total"])
            self.write_data_row(ws, i + 5, vals, i % 2 == 0, num_fmt_cols=amt_cols)

        self.set_col_widths(ws, [18, 26, 34] + [12] * len(months) + [14])


class VarianceExporter(BaseExporter):

    def export(self, rows: list[dict], months: list[str], company: str, period: str) -> None:
        ws = self.add_sheet("Variance Analysis")
        headers = ["Ledger"] + [m for m in months for _ in (m, f"{m} %")]
        n = len(headers)
        self.write_title_row(ws, "Variance Analysis (Month-on-Month)", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, headers, row=4, freeze_row=4, freeze_col=1)

        amt_cols = {}
        for i, m in enumerate(months):
            amt_cols[2 + i * 2] = AMOUNT_FMT
            amt_cols[3 + i * 2] = "0.00"

        for i, r in enumerate(rows):
            vals = [r["ledger"]]
            for m in months:
                vals.append(r.get(m, 0.0))
                vals.append(r.get(f"{m}_pct", ""))
            self.write_data_row(ws, i + 5, vals, i % 2 == 0, num_fmt_cols=amt_cols)

        self.set_col_widths(ws, [34] + [13, 10] * len(months))


class ExceptionHeatmapExporter(BaseExporter):

    def export(self, data: dict, company: str, period: str) -> None:
        ws = self.add_sheet("Exception Heatmap")
        exc_types = data["exception_types"]
        ledgers = data["ledgers"]
        months = data["months"]
        matrix = data["matrix"]

        headers = ["Ledger"] + [f"{m}\n{et}" for m in months for et in exc_types]
        n = len(headers)
        self.write_title_row(ws, "Exception Density Heatmap", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, headers, row=4, freeze_row=4, freeze_col=1)

        for i, ledger in enumerate(ledgers):
            vals = [ledger]
            for m in months:
                for et in exc_types:
                    count = matrix.get(ledger, {}).get(m, {}).get(et, 0)
                    vals.append(count if count else "")
            self.write_data_row(ws, i + 5, vals, i % 2 == 0)

        self.set_col_widths(ws, [34] + [8] * (len(months) * len(exc_types)))


class BSCleanlinessExporter(BaseExporter):
    HEADERS = ["Ledger", "Primary Group", "Opening (₹)", "Closing (₹)", "Flag"]

    def export(self, rows: list[dict], company: str, period: str) -> None:
        ws = self.add_sheet("BS Cleanliness")
        n = len(self.HEADERS)
        self.write_title_row(ws, "Balance Sheet Cleanliness", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, self.HEADERS, row=4, freeze_row=4)
        amt_cols = {3: AMOUNT_FMT, 4: AMOUNT_FMT}
        for i, r in enumerate(rows):
            fill = RED_FILL if r.get("flag") else None
            self.write_data_row(ws, i + 5, [r["ledger"], r["primary"], r["opening"], r["closing"], r["flag"]],
                                i % 2 == 0, num_fmt_cols=amt_cols, fill_override=fill if r.get("flag") else None)
        self.set_col_widths(ws, [34, 28, 16, 16, 24])


class RelatedPartyExporter(BaseExporter):

    def export(self, data: dict, company: str, period: str) -> None:
        meta = f"{company}  |  {period}"
        ws1 = self.add_sheet("Related Parties")
        headers1 = ["Party Name", "Category", "Total Dr (₹)", "Total Cr (₹)", "Net (₹)"]
        n = len(headers1)
        self.write_title_row(ws1, "Related Party Analysis (AS-18)", n, row=1)
        self.write_meta_row(ws1, meta, n, row=2)
        self.write_header_row(ws1, headers1, row=4, freeze_row=4)
        amt_cols = {3: AMOUNT_FMT, 4: AMOUNT_FMT, 5: AMOUNT_FMT}
        for i, r in enumerate(data["parties"]):
            self.write_data_row(ws1, i + 5, [r["name"], r["category"], r["total_dr"], r["total_cr"], r["net"]],
                                i % 2 == 0, num_fmt_cols=amt_cols)
        self.set_col_widths(ws1, [34, 18, 16, 16, 16])

        ws2 = self.add_sheet("Transaction Detail")
        headers2 = ["Date", "Voucher Type", "Voucher No", "Party", "Category", "Ledger", "Amount (₹)", "Narration"]
        n2 = len(headers2)
        self.write_title_row(ws2, "Related Party Transactions", n2, row=1)
        self.write_meta_row(ws2, meta, n2, row=2)
        self.write_header_row(ws2, headers2, row=4, freeze_row=4)
        for i, r in enumerate(data["transactions"]):
            self.write_data_row(ws2, i + 5, [r["date"], r["voucher_type"], r["voucher_number"],
                                             r["party"], r["category"], r["ledger"], r["amount"], r["narration"]],
                                i % 2 == 0, num_fmt_cols={7: AMOUNT_FMT})
        self.set_col_widths(ws2, [12, 14, 16, 28, 16, 28, 14, 50])


class OrphanPLExporter(BaseExporter):
    HEADERS = ["Date", "Voucher Type", "Voucher No", "Party", "P&L Ledgers", "Total Dr (₹)", "Total Cr (₹)", "Narration"]

    def export(self, rows: list[dict], company: str, period: str) -> None:
        ws = self.add_sheet("Orphan PL Vouchers")
        n = len(self.HEADERS)
        self.write_title_row(ws, "Orphan P&L Vouchers (No BS Offset)", n, row=1)
        self.write_meta_row(ws, f"{company}  |  {period}", n, row=2)
        self.write_header_row(ws, self.HEADERS, row=4, freeze_row=4)
        amt_cols = {6: AMOUNT_FMT, 7: AMOUNT_FMT}
        for i, r in enumerate(rows):
            self.write_data_row(ws, i + 5, [r["date"], r["voucher_type"], r["voucher_number"],
                                            r["party_name"], r["pnl_ledgers"], r["total_dr"],
                                            r["total_cr"], r["narration"]],
                                i % 2 == 0, num_fmt_cols=amt_cols)
        self.set_col_widths(ws, [12, 14, 16, 28, 40, 14, 14, 50])


class TSFComparisonExporter(BaseExporter):

    def export(self, data: dict, company: str) -> None:
        self._summary_sheet(data["summary"], company)
        self._entry_sheet("Added Entries", data["added"], company)
        self._entry_sheet("Removed Entries", data["removed"], company)
        self._modified_sheet(data["modified"], company)

    def _summary_sheet(self, summary: dict, company: str) -> None:
        ws = self.add_sheet("Comparison Summary")
        self.write_title_row(ws, "TSF Comparison Summary", 3, row=1)
        self.write_meta_row(ws, company, 3, row=2)
        items = [
            ("Added Entries", summary["added"]),
            ("Removed Entries", summary["removed"]),
            ("Modified Entries", summary["modified"]),
            ("Net Amount Change (₹)", summary["net_amount_change"]),
        ]
        for i, (label, val) in enumerate(items):
            ws.cell(row=4 + i, column=1, value=label).border = thin_border()
            c = ws.cell(row=4 + i, column=2, value=val)
            c.border = thin_border()
            if isinstance(val, float):
                c.number_format = AMOUNT_FMT
        self.set_col_widths(ws, [30, 20])

    def _entry_sheet(self, title: str, entries, company: str) -> None:
        ws = self.add_sheet(title)
        headers = ["Date", "Voucher No", "Voucher Type", "Ledger", "Party", "Amount (₹)", "Narration"]
        n = len(headers)
        self.write_title_row(ws, title, n, row=1)
        self.write_meta_row(ws, company, n, row=2)
        self.write_header_row(ws, headers, row=4, freeze_row=4)
        for i, e in enumerate(entries):
            self.write_data_row(ws, i + 5, [e.date, e.voucher_number, e.voucher_type,
                                            e.ledger, e.party_name, round(e.amount, 2), e.narration],
                                i % 2 == 0, num_fmt_cols={6: AMOUNT_FMT})
        self.set_col_widths(ws, [12, 18, 16, 30, 28, 14, 50])

    def _modified_sheet(self, modified: list[dict], company: str) -> None:
        ws = self.add_sheet("Modified Entries")
        headers = ["GUID", "Field", "Old Value", "New Value"]
        n = len(headers)
        self.write_title_row(ws, "Modified Entries", n, row=1)
        self.write_meta_row(ws, company, n, row=2)
        self.write_header_row(ws, headers, row=4, freeze_row=4)
        row_num = 5
        for mod in modified:
            for field, (old_val, new_val) in mod["changes"].items():
                self.write_data_row(ws, row_num, [mod["guid"], field, str(old_val), str(new_val)],
                                    row_num % 2 == 0)
                row_num += 1
        self.set_col_widths(ws, [40, 18, 30, 30])


class GSTR2BExporter(BaseExporter):

    def export(self, data: dict, company: str, period: str) -> None:
        meta = f"{company}  |  {period}"
        self._summary_sheet(data["summary"], meta)
        self._detail_sheet(data["rows"], meta)

    def _summary_sheet(self, summary: list[dict], meta: str) -> None:
        ws = self.add_sheet("2B Position Summary")
        headers = ["Category", "Count", "Taxable (₹)", "Tax (₹)"]
        n = len(headers)
        self.write_title_row(ws, "GSTR-2B Position Summary", n, row=1)
        self.write_meta_row(ws, meta, n, row=2)
        self.write_header_row(ws, headers, row=4, freeze_row=4)
        STATUS_COLORS = {
            "Matched": "DCFCE7",
            "Amount Mismatch": "FEE2E2",
            "Only in 2B": "FEE2E2",
            "Only in Books": "E0E7FF",
        }
        amt_cols = {3: AMOUNT_FMT, 4: AMOUNT_FMT}
        for i, r in enumerate(summary):
            fill = hex_fill(STATUS_COLORS.get(r["category"], "FFFFFF"))
            self.write_data_row(ws, i + 5, [r["category"], r["count"], r["taxable"], r["tax"]],
                                True, num_fmt_cols=amt_cols, fill_override=fill)
        self.set_col_widths(ws, [44, 12, 18, 16])

    def _detail_sheet(self, rows: list[dict], meta: str) -> None:
        ws = self.add_sheet("Reconciliation (B2B)")
        headers = [
            "Status", "Party", "GSTIN",
            "2B Invoice No", "2B Date", "2B Taxable (₹)", "2B Tax (₹)",
            "Tally Invoice No", "Tally Date", "Tally Taxable (₹)", "Tally Tax (₹)",
            "Δ Taxable (₹)", "Δ Tax (₹)",
        ]
        n = len(headers)
        self.write_title_row(ws, "GSTR-2B Reconciliation Detail", n, row=1)
        self.write_meta_row(ws, meta, n, row=2)
        self.write_header_row(ws, headers, row=4, freeze_row=4, freeze_col=3)

        STATUS_COLORS = {
            "Matched": "DCFCE7", "Amount Mismatch": "FEF3C7",
            "Only in 2B": "FEE2E2", "Only in Books": "E0E7FF",
        }
        amt_cols = {i: AMOUNT_FMT for i in [6, 7, 10, 11, 12, 13]}

        for i, r in enumerate(rows):
            fill = hex_fill(STATUS_COLORS.get(r["status"], "FFFFFF"))
            vals = [
                r["status"], r["party_name"], r["gstin"],
                r["b2b_invoice_no"], r["b2b_date"], r["b2b_taxable"], r["b2b_tax"],
                r["tally_invoice_no"], r["tally_date"], r["tally_taxable"], r["tally_tax"],
                r["delta_taxable"], r["delta_tax"],
            ]
            self.write_data_row(ws, i + 5, vals, i % 2 == 0, num_fmt_cols=amt_cols, fill_override=fill)

        self.set_col_widths(ws, [16, 28, 18, 20, 12, 16, 14, 20, 12, 16, 14, 14, 12])
