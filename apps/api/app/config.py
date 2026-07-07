from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    base_dir: Path
    data_dir: Path
    database_path: Path
    artifacts_dir: Path
    sku_mapping_path: Path
    wms_template_path: Path | None
    automation_mode: str
    headless: bool
    tiktok_orders_url: str
    tiktok_profile_dir: Path
    wms_login_url: str
    wms_upload_url: str
    wms_orders_url: str
    wms_label_upload_url: str
    wms_username: str
    wms_password: str
    wms_profile_dir: Path
    dry_run_order_id: str
    wms_placeholder_value: str = "1"
    wms_default_weight: float = 0.1
    wms_declaration_cn: str = "头套"
    wms_declaration_en: str = "wig"
    wms_item_slots: int = 10

    @classmethod
    def from_env(cls) -> "Settings":
        base_dir = Path(__file__).resolve().parents[1]
        data_dir = Path(os.getenv("TK_SAAS_DATA_DIR", base_dir / ".automation-data"))
        template_value = os.getenv("TK_SAAS_WMS_TEMPLATE", "").strip()
        return cls(
            base_dir=base_dir,
            data_dir=data_dir,
            database_path=Path(os.getenv("TK_SAAS_DATABASE_PATH", data_dir / "tk_saas.sqlite3")),
            artifacts_dir=Path(os.getenv("TK_SAAS_ARTIFACTS_DIR", data_dir / "artifacts")),
            sku_mapping_path=Path(
                os.getenv("TK_SAAS_SKU_MAPPING", base_dir / "data" / "sample_product_mapping.csv")
            ),
            wms_template_path=Path(template_value) if template_value else None,
            automation_mode=os.getenv("TK_SAAS_AUTOMATION_MODE", "dry-run").strip().lower(),
            headless=_as_bool(os.getenv("TK_SAAS_HEADLESS"), False),
            tiktok_orders_url=os.getenv("TK_TIKTOK_ORDERS_URL", ""),
            tiktok_profile_dir=Path(
                os.getenv("TK_TIKTOK_PROFILE_DIR", data_dir / "browser-profiles" / "tiktok")
            ),
            wms_login_url=os.getenv("TK_WMS_LOGIN_URL", ""),
            wms_upload_url=os.getenv("TK_WMS_UPLOAD_URL", ""),
            wms_orders_url=os.getenv("TK_WMS_ORDERS_URL", ""),
            wms_label_upload_url=os.getenv("TK_WMS_LABEL_UPLOAD_URL", ""),
            wms_username=os.getenv("TK_WMS_USERNAME", ""),
            wms_password=os.getenv("TK_WMS_PASSWORD", ""),
            wms_profile_dir=Path(
                os.getenv("TK_WMS_PROFILE_DIR", data_dir / "browser-profiles" / "wms")
            ),
            dry_run_order_id=os.getenv("TK_SAAS_DRY_RUN_ORDER_ID", "TKE-DRYRUN-0001"),
            wms_placeholder_value=os.getenv("TK_WMS_PLACEHOLDER_VALUE", "1"),
            wms_default_weight=float(os.getenv("TK_WMS_DEFAULT_WEIGHT", "0.1")),
            wms_declaration_cn=os.getenv("TK_WMS_DECLARATION_CN", "头套"),
            wms_declaration_en=os.getenv("TK_WMS_DECLARATION_EN", "wig"),
            wms_item_slots=max(1, int(os.getenv("TK_WMS_ITEM_SLOTS", "10"))),
        )

    def ensure_directories(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        self.tiktok_profile_dir.mkdir(parents=True, exist_ok=True)
        self.wms_profile_dir.mkdir(parents=True, exist_ok=True)
