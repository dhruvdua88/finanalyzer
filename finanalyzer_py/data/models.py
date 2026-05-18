from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class LedgerEntry:
    guid: str
    date: str                   # YYYY-MM-DD (empty for master rows)
    voucher_type: str
    voucher_number: str
    invoice_number: str
    reference_number: str
    narration: str
    party_name: str
    gstin: str
    ledger: str
    amount: float               # + = Credit, − = Debit
    group_name: str
    opening_balance: float
    closing_balance: float
    tally_parent: str
    tally_primary: str
    is_revenue: int             # 1 or 0
    is_accounting_voucher: int  # 1 or 0
    is_master_ledger: int       # 1 = master balance row, 0 = transaction


@dataclass
class TDSSectionMapping:
    ledger_name: str
    section_code: str
    custom_rate: Optional[float] = None  # None → use defaultRate from section


@dataclass
class RelatedPartyProfile:
    name: str
    category: str  # "Holding" | "Subsidiary" | "KMP" | "Associate" | "Other"
    gstin: str = ""


@dataclass
class AuditSettings:
    sales_gst_ledgers: list[str] = field(default_factory=list)
    purchase_gst_ledgers: list[str] = field(default_factory=list)
    tds_tax_ledgers: list[str] = field(default_factory=list)
    rcm_tax_ledgers: list[str] = field(default_factory=list)
    blocked_credit_ledgers: list[str] = field(default_factory=list)
    gst_ledger_summary_ledgers: list[str] = field(default_factory=list)
    tds_section_mappings: list[TDSSectionMapping] = field(default_factory=list)
    tds_annotations: dict[str, str] = field(default_factory=dict)  # guid → note
    related_parties: list[RelatedPartyProfile] = field(default_factory=list)
    company_name: str = ""
    fiscal_year: str = ""       # e.g. "2025-26"
    as_of_date: str = ""        # YYYY-MM-DD for ageing; if empty use max date
