from __future__ import annotations

import json
from pathlib import Path

from ..config import Settings
from ..models import RunStatus, ShippingJob, ShippingOrder, ShippingState
from ..repository import ShippingJobRepository
from .adapters import TikTokShippingAdapter, WmsShippingAdapter, create_adapters
from .errors import ManualInterventionRequired, RetryableAutomationError
from .excel_generator import WmsExcelGenerator
from .pdf_handler import normalize_label
from .sku_mapper import SkuMapper


STATE_ORDER = [
    ShippingState.DISCOVERED,
    ShippingState.ARRANGED_ON_TIKTOK,
    ShippingState.LABEL_DOWNLOADED,
    ShippingState.SKU_MAPPED,
    ShippingState.EXCEL_GENERATED,
    ShippingState.WMS_ORDER_UPLOADED,
    ShippingState.WMS_ORDER_VERIFIED,
    ShippingState.LABEL_UPLOADED,
    ShippingState.COMPLETED,
]


class ShippingOrchestrator:
    def __init__(self, settings: Settings, repository: ShippingJobRepository):
        self.settings = settings
        self.repository = repository
        self.sku_mapper = SkuMapper(settings.sku_mapping_path)
        self.excel_generator = WmsExcelGenerator(
            settings.artifacts_dir / "wms-excel",
            settings.wms_template_path,
            placeholder_value=settings.wms_placeholder_value,
            default_weight=settings.wms_default_weight,
            declaration_cn=settings.wms_declaration_cn,
            declaration_en=settings.wms_declaration_en,
            item_slots=settings.wms_item_slots,
        )

    def create_job(self, order: ShippingOrder) -> ShippingJob:
        return self.repository.create_or_get(order, self.settings.automation_mode)

    def sweep(self) -> list[ShippingJob]:
        tiktok, wms = create_adapters(self.settings)
        try:
            orders = tiktok.discover_orders()
            jobs = [self.create_job(order) for order in orders]
            return [self.run_job(job.id, tiktok=tiktok, wms=wms) for job in jobs]
        finally:
            tiktok.close()
            wms.close()

    def run_job(
        self,
        job_id: str,
        *,
        tiktok: TikTokShippingAdapter | None = None,
        wms: WmsShippingAdapter | None = None,
    ) -> ShippingJob:
        job = self.repository.get(job_id)
        if job.state == ShippingState.COMPLETED:
            return job

        owns_adapters = tiktok is None or wms is None
        if owns_adapters:
            tiktok, wms = create_adapters(self.settings)
        assert tiktok is not None and wms is not None

        self.repository.mark_running(job_id)
        try:
            job = self.repository.get(job_id)
            if self._at(job, ShippingState.DISCOVERED):
                tracking = tiktok.arrange_shipment(job.order)
                job = self.repository.advance(
                    job_id, ShippingState.ARRANGED_ON_TIKTOK, tracking_number=tracking
                )

            if self._at(job, ShippingState.ARRANGED_ON_TIKTOK):
                raw_label = tiktok.download_label(
                    job.order, job.tracking_number, self.settings.artifacts_dir / "raw-labels"
                )
                label = normalize_label(
                    Path(raw_label), job.tracking_number, self.settings.artifacts_dir / "labels"
                )
                job = self.repository.advance(
                    job_id, ShippingState.LABEL_DOWNLOADED, label_path=str(label)
                )

            if self._at(job, ShippingState.LABEL_DOWNLOADED):
                mapped_items = self.sku_mapper.map_items(job.order.items)
                job = self.repository.advance(
                    job_id,
                    ShippingState.SKU_MAPPED,
                    mapped_items_json=json.dumps(mapped_items, ensure_ascii=False),
                )

            if self._at(job, ShippingState.SKU_MAPPED):
                excel = self.excel_generator.generate(
                    job.order, job.tracking_number, job.mapped_items
                )
                job = self.repository.advance(
                    job_id, ShippingState.EXCEL_GENERATED, excel_path=str(excel)
                )

            if self._at(job, ShippingState.EXCEL_GENERATED):
                wms.upload_order_excel(job.order, job.tracking_number, Path(job.excel_path))
                job = self.repository.advance(job_id, ShippingState.WMS_ORDER_UPLOADED)

            if self._at(job, ShippingState.WMS_ORDER_UPLOADED):
                wms.verify_order(job.order, job.tracking_number)
                job = self.repository.advance(job_id, ShippingState.WMS_ORDER_VERIFIED)

            if self._at(job, ShippingState.WMS_ORDER_VERIFIED):
                wms.upload_label(job.order, job.tracking_number, Path(job.label_path))
                job = self.repository.advance(job_id, ShippingState.LABEL_UPLOADED)

            if self._at(job, ShippingState.LABEL_UPLOADED):
                job = self.repository.mark_completed(job_id)
            return job
        except ManualInterventionRequired as exc:
            return self.repository.mark_failure(
                job_id,
                RunStatus.MANUAL_INTERVENTION_REQUIRED,
                getattr(exc, "code", "manual_intervention_required"),
                str(exc),
            )
        except RetryableAutomationError as exc:
            return self.repository.mark_failure(
                job_id,
                RunStatus.FAILED_RETRYABLE,
                getattr(exc, "code", "retryable_automation_error"),
                str(exc),
            )
        except Exception as exc:
            return self.repository.mark_failure(
                job_id, RunStatus.FAILED_RETRYABLE, "unexpected_error", str(exc)
            )
        finally:
            if owns_adapters:
                tiktok.close()
                wms.close()

    @staticmethod
    def _at(job: ShippingJob, state: ShippingState) -> bool:
        return STATE_ORDER.index(job.state) == STATE_ORDER.index(state)
