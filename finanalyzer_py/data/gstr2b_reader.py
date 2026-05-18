from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def parse_gstr2b_json(json_path: str | Path) -> dict[str, list[dict]]:
    """
    Parse a GSTR-2B JSON file downloaded from the GST portal.
    Returns {"b2b": [...], "cdn": [...], "isd": [...]} with normalised row dicts.
    Each B2B row contains: gstin, party, invoice_no, invoice_date, taxable, igst, cgst, sgst, tax, month, itc_eligible
    """
    raw: dict = json.loads(Path(json_path).read_text(encoding="utf-8"))

    # Navigate to the actual data (portal format wraps in data.docdata)
    data = raw.get("data", raw)
    doc_data = data.get("docdata", data)

    b2b_rows: list[dict] = []
    for supplier in doc_data.get("b2b", []):
        gstin = (supplier.get("ctin") or "").strip().upper()
        party = (supplier.get("trdnm") or gstin).strip()
        for inv in supplier.get("inv", []):
            taxable = 0.0
            igst = cgst = sgst = 0.0
            for item in inv.get("items", []):
                taxable += float(item.get("txval", 0) or 0)
                igst += float(item.get("igst", 0) or 0)
                cgst += float(item.get("cgst", 0) or 0)
                sgst += float(item.get("sgst", 0) or 0)
            itc = inv.get("itc", {})
            itc_eligible = (itc.get("elg") or "Y").strip().upper() == "Y"
            b2b_rows.append({
                "gstin": gstin,
                "party": party,
                "invoice_no": (inv.get("inum") or "").strip(),
                "invoice_date": _normalise_date(inv.get("idt") or ""),
                "taxable": round(taxable, 2),
                "igst": round(igst, 2),
                "cgst": round(cgst, 2),
                "sgst": round(sgst, 2),
                "tax": round(igst + cgst + sgst, 2),
                "month": (inv.get("rtnprd") or "").strip(),
                "itc_eligible": itc_eligible,
                "supply_type": "B2B",
            })

    return {"b2b": b2b_rows}


def _normalise_date(raw: str) -> str:
    """Convert DD-MM-YYYY or DD/MM/YYYY → YYYY-MM-DD."""
    raw = raw.strip()
    if not raw:
        return ""
    for sep in ("-", "/"):
        if sep in raw:
            parts = raw.split(sep)
            if len(parts) == 3 and len(parts[2]) == 4:
                return f"{parts[2]}-{parts[1].zfill(2)}-{parts[0].zfill(2)}"
    return raw
