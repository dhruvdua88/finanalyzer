from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from data.models import LedgerEntry, AuditSettings


@dataclass
class AppState:
    entries: list[LedgerEntry] = field(default_factory=list)
    master_entries: list[LedgerEntry] = field(default_factory=list)
    tsf_path: Path | None = None
    settings: AuditSettings = field(default_factory=AuditSettings)

    # Derived summary (populated after import)
    total_rows: int = 0
    unique_vouchers: int = 0
    min_date: str = ""
    max_date: str = ""
    available_months: list[str] = field(default_factory=list)
    all_ledger_names: list[str] = field(default_factory=list)

    # GSTR-2B rows (loaded separately)
    gstr2b_b2b_rows: list[dict] = field(default_factory=list)

    def refresh_summary(self) -> None:
        dates = [e.date for e in self.entries if e.date]
        vouchers = {e.voucher_number for e in self.entries}
        self.total_rows = len(self.entries)
        self.unique_vouchers = len(vouchers)
        self.min_date = min(dates, default="")
        self.max_date = max(dates, default="")
        # Compute available fiscal months (Apr-YYYY format)
        months_seen: set[str] = set()
        for e in self.entries:
            if e.date and len(e.date) >= 7:
                y, m = int(e.date[:4]), int(e.date[5:7])
                month_str = f"{_MONTHS[m-1]}-{y}"
                months_seen.add(month_str)
        from app.constants import FY_MONTH_ORDER
        self.available_months = sorted(
            months_seen,
            key=lambda s: (int(s.split("-")[1]), FY_MONTH_ORDER.get(s.split("-")[0], 0)),
        )
        self.all_ledger_names = sorted({e.ledger for e in self.entries if e.ledger})


_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
