from __future__ import annotations

import json
from pathlib import Path

from data.models import AuditSettings, TDSSectionMapping, RelatedPartyProfile

_SETTINGS_DIR = Path.home() / ".finanalyzer"
_SETTINGS_FILE = _SETTINGS_DIR / "settings.json"


def load() -> AuditSettings:
    if not _SETTINGS_FILE.exists():
        return AuditSettings()
    try:
        raw = json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
        return _from_dict(raw)
    except Exception:
        return AuditSettings()


def save(settings: AuditSettings) -> None:
    _SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    _SETTINGS_FILE.write_text(
        json.dumps(_to_dict(settings), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _to_dict(s: AuditSettings) -> dict:
    return {
        "sales_gst_ledgers": s.sales_gst_ledgers,
        "purchase_gst_ledgers": s.purchase_gst_ledgers,
        "tds_tax_ledgers": s.tds_tax_ledgers,
        "rcm_tax_ledgers": s.rcm_tax_ledgers,
        "blocked_credit_ledgers": s.blocked_credit_ledgers,
        "gst_ledger_summary_ledgers": s.gst_ledger_summary_ledgers,
        "tds_section_mappings": [
            {"ledger_name": m.ledger_name, "section_code": m.section_code, "custom_rate": m.custom_rate}
            for m in s.tds_section_mappings
        ],
        "tds_annotations": s.tds_annotations,
        "related_parties": [
            {"name": p.name, "category": p.category, "gstin": p.gstin}
            for p in s.related_parties
        ],
        "company_name": s.company_name,
        "fiscal_year": s.fiscal_year,
        "as_of_date": s.as_of_date,
    }


def _from_dict(raw: dict) -> AuditSettings:
    return AuditSettings(
        sales_gst_ledgers=raw.get("sales_gst_ledgers", []),
        purchase_gst_ledgers=raw.get("purchase_gst_ledgers", []),
        tds_tax_ledgers=raw.get("tds_tax_ledgers", []),
        rcm_tax_ledgers=raw.get("rcm_tax_ledgers", []),
        blocked_credit_ledgers=raw.get("blocked_credit_ledgers", []),
        gst_ledger_summary_ledgers=raw.get("gst_ledger_summary_ledgers", []),
        tds_section_mappings=[
            TDSSectionMapping(
                ledger_name=m["ledger_name"],
                section_code=m["section_code"],
                custom_rate=m.get("custom_rate"),
            )
            for m in raw.get("tds_section_mappings", [])
        ],
        tds_annotations=raw.get("tds_annotations", {}),
        related_parties=[
            RelatedPartyProfile(
                name=p["name"],
                category=p.get("category", "Other"),
                gstin=p.get("gstin", ""),
            )
            for p in raw.get("related_parties", [])
        ],
        company_name=raw.get("company_name", ""),
        fiscal_year=raw.get("fiscal_year", ""),
        as_of_date=raw.get("as_of_date", ""),
    )
