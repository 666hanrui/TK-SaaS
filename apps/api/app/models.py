from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, model_validator


HC_US_QUANTITY_THRESHOLD = 5
HC_US_TRANSPORT_METHOD = "HC-US"


class ShippingState(str, Enum):
    DISCOVERED = "DISCOVERED"
    ARRANGED_ON_TIKTOK = "ARRANGED_ON_TIKTOK"
    LABEL_DOWNLOADED = "LABEL_DOWNLOADED"
    SKU_MAPPED = "SKU_MAPPED"
    EXCEL_GENERATED = "EXCEL_GENERATED"
    WMS_ORDER_UPLOADED = "WMS_ORDER_UPLOADED"
    WMS_ORDER_VERIFIED = "WMS_ORDER_VERIFIED"
    LABEL_UPLOADED = "LABEL_UPLOADED"
    COMPLETED = "COMPLETED"


class RunStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED_RETRYABLE = "failed_retryable"
    MANUAL_INTERVENTION_REQUIRED = "manual_intervention_required"


class ShippingItem(BaseModel):
    platform_sku: str = ""
    product_title: str
    variant_name: str = ""
    quantity: int = Field(default=1, ge=1)
    internal_product_code: str = ""
    declaration_name: str = "Hair product"
    declaration_value: float = Field(default=1.0, ge=0)
    declaration_quantity: Optional[int] = Field(default=None, ge=1)


class Recipient(BaseModel):
    name: str = ""
    phone: str = ""
    postal_code: str = ""
    state: str = ""
    city: str = ""
    address_line_1: str = ""
    address_line_2: str = ""


class ShippingOrder(BaseModel):
    platform_order_id: str
    customer_order_no: str = ""
    shop_code: str = ""
    country: str = "US"
    transport_method: str = "CBT-DF"
    package_type: str = ""
    recipient: Recipient = Field(default_factory=Recipient)
    items: list[ShippingItem]

    @model_validator(mode="after")
    def apply_transport_method_rule(self) -> "ShippingOrder":
        if self.total_quantity() > HC_US_QUANTITY_THRESHOLD:
            self.transport_method = HC_US_TRANSPORT_METHOD
        return self

    def total_quantity(self) -> int:
        return sum(item.quantity for item in self.items)

    def normalized_customer_order_no(self) -> str:
        return self.customer_order_no or self.platform_order_id


class ShippingJob(BaseModel):
    id: str
    platform_order_id: str
    state: ShippingState
    run_status: RunStatus
    run_mode: str
    order: ShippingOrder
    mapped_items: list[dict[str, Any]] = Field(default_factory=list)
    tracking_number: str = ""
    label_path: str = ""
    excel_path: str = ""
    error_code: str = ""
    error_message: str = ""
    created_at: str
    updated_at: str
    events: list[dict[str, Any]] = Field(default_factory=list)


class CreateShippingJobRequest(BaseModel):
    order: ShippingOrder
    run_immediately: bool = True


class ShippingSweepResponse(BaseModel):
    mode: str
    discovered: int
    completed: int
    jobs: list[ShippingJob]
