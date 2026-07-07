from __future__ import annotations

import hashlib
import shutil
from abc import ABC, abstractmethod
from pathlib import Path

from pypdf import PdfWriter

from ..config import Settings
from ..models import ShippingItem, ShippingOrder
from .errors import RetryableAutomationError


class TikTokShippingAdapter(ABC):
    @abstractmethod
    def discover_orders(self) -> list[ShippingOrder]:
        raise NotImplementedError

    @abstractmethod
    def arrange_shipment(self, order: ShippingOrder) -> str:
        raise NotImplementedError

    @abstractmethod
    def download_label(self, order: ShippingOrder, tracking_number: str, output_dir: Path) -> Path:
        raise NotImplementedError

    def close(self) -> None:
        return None


class WmsShippingAdapter(ABC):
    @abstractmethod
    def upload_order_excel(self, order: ShippingOrder, tracking_number: str, excel_path: Path) -> None:
        raise NotImplementedError

    @abstractmethod
    def verify_order(self, order: ShippingOrder, tracking_number: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def upload_label(self, order: ShippingOrder, tracking_number: str, label_path: Path) -> None:
        raise NotImplementedError

    def close(self) -> None:
        return None


class DryRunTikTokAdapter(TikTokShippingAdapter):
    def __init__(self, settings: Settings):
        self.settings = settings

    def discover_orders(self) -> list[ShippingOrder]:
        return [
            ShippingOrder(
                platform_order_id=self.settings.dry_run_order_id,
                customer_order_no=self.settings.dry_run_order_id,
                shop_code="M",
                country="US",
                transport_method="CBT-DF",
                items=[
                    ShippingItem(
                        platform_sku="XCGLM-GLM851",
                        product_title="Estrella Hair Kinky Curly Bundles 14A 18 inch",
                        variant_name="14A-Kinky curly-18",
                        quantity=1,
                    ),
                    ShippingItem(
                        platform_sku="BONUS-LASH",
                        product_title="Limited Free Bonus Eyelash Clusters",
                        quantity=1,
                    ),
                ],
            )
        ]

    def arrange_shipment(self, order: ShippingOrder) -> str:
        digest = hashlib.sha256(order.platform_order_id.encode("utf-8")).hexdigest()
        digits = str(int(digest[:18], 16)).zfill(20)[-20:]
        return f"SWX{digits}"

    def download_label(self, order: ShippingOrder, tracking_number: str, output_dir: Path) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / f"raw-{order.platform_order_id}.pdf"
        writer = PdfWriter()
        writer.add_blank_page(width=288, height=432)
        writer.add_metadata(
            {
                "/Title": f"Shipping label {tracking_number}",
                "/Subject": f"Order {order.platform_order_id}",
                "/Keywords": tracking_number,
            }
        )
        with path.open("wb") as handle:
            writer.write(handle)
        return path


class DryRunWmsAdapter(WmsShippingAdapter):
    def __init__(self, settings: Settings):
        self.inbox_dir = settings.artifacts_dir / "dry-run-wms"
        self.inbox_dir.mkdir(parents=True, exist_ok=True)

    def upload_order_excel(self, order: ShippingOrder, tracking_number: str, excel_path: Path) -> None:
        if not excel_path.exists():
            raise RetryableAutomationError(f"WMS upload file does not exist: {excel_path}")
        shutil.copy2(excel_path, self.inbox_dir / excel_path.name)

    def verify_order(self, order: ShippingOrder, tracking_number: str) -> None:
        expected = list(self.inbox_dir.glob(f"*{tracking_number}*.xlsx"))
        if not expected:
            raise RetryableAutomationError("Dry-run WMS order verification failed")

    def upload_label(self, order: ShippingOrder, tracking_number: str, label_path: Path) -> None:
        if not label_path.exists():
            raise RetryableAutomationError(f"Label file does not exist: {label_path}")
        shutil.copy2(label_path, self.inbox_dir / label_path.name)


def create_adapters(settings: Settings) -> tuple[TikTokShippingAdapter, WmsShippingAdapter]:
    if settings.automation_mode == "dry-run":
        return DryRunTikTokAdapter(settings), DryRunWmsAdapter(settings)
    if settings.automation_mode == "playwright":
        from .playwright_adapters import PlaywrightTikTokAdapter, PlaywrightWmsAdapter

        return PlaywrightTikTokAdapter(settings), PlaywrightWmsAdapter(settings)
    raise ValueError(f"Unsupported automation mode: {settings.automation_mode}")
