from __future__ import annotations

import re
import shutil
from pathlib import Path

from pypdf import PdfReader

from .errors import RetryableAutomationError


TRACKING_PATTERN = re.compile(
    r"\b(?:SWX|GFUS|SPEEDX|GOFO)[A-Z0-9]{8,}\b|\b(?:\d[ -]?){20,24}\b",
    re.IGNORECASE,
)


def find_tracking_number(text: str) -> str:
    match = TRACKING_PATTERN.search(text or "")
    if not match:
        return ""
    return re.sub(r"[\s-]", "", match.group(0)).upper()


def extract_tracking_number(pdf_path: Path) -> str:
    filename_tracking = find_tracking_number(pdf_path.stem)
    if filename_tracking:
        return filename_tracking
    try:
        text = "\n".join(page.extract_text() or "" for page in PdfReader(pdf_path).pages)
    except Exception as exc:
        raise RetryableAutomationError(f"Unable to read label PDF: {pdf_path}") from exc
    tracking_number = find_tracking_number(text)
    if not tracking_number:
        raise RetryableAutomationError("Tracking number was not found in label PDF")
    return tracking_number


def normalize_label(pdf_path: Path, tracking_number: str, output_dir: Path) -> Path:
    if not pdf_path.exists() or pdf_path.stat().st_size == 0:
        raise RetryableAutomationError(f"Downloaded label is missing or empty: {pdf_path}")
    filename_tracking = find_tracking_number(pdf_path.stem)
    if filename_tracking and filename_tracking != tracking_number:
        raise RetryableAutomationError(
            f"Label tracking mismatch: expected {tracking_number}, file contains {filename_tracking}"
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / f"{tracking_number}.pdf"
    if pdf_path.resolve() != target.resolve():
        shutil.copy2(pdf_path, target)
    return target
