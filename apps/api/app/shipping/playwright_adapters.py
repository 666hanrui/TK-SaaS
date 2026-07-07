from __future__ import annotations

import os
import re
from pathlib import Path

from ..config import Settings
from ..models import ShippingItem, ShippingOrder
from .adapters import TikTokShippingAdapter, WmsShippingAdapter
from .errors import ConfigurationError, ManualInterventionRequired, RetryableAutomationError
from .pdf_handler import find_tracking_number


SECURITY_CHALLENGE = re.compile(r"验证码|安全验证|verify you are human|captcha|security check", re.I)


class _PersistentBrowser:
    def __init__(self, profile_dir: Path, headless: bool):
        self.profile_dir = profile_dir
        self.headless = headless
        self._playwright = None
        self._context = None

    @property
    def context(self):
        if self._context is None:
            try:
                from playwright.sync_api import sync_playwright
            except ImportError as exc:  # pragma: no cover
                raise ConfigurationError("Playwright is not installed") from exc
            self.profile_dir.mkdir(parents=True, exist_ok=True)
            self._playwright = sync_playwright().start()
            self._context = self._playwright.chromium.launch_persistent_context(
                str(self.profile_dir),
                headless=self.headless,
                accept_downloads=True,
                viewport={"width": 1440, "height": 1000},
            )
        return self._context

    @property
    def page(self):
        pages = self.context.pages
        return pages[0] if pages else self.context.new_page()

    def close(self) -> None:
        if self._context:
            self._context.close()
        if self._playwright:
            self._playwright.stop()
        self._context = None
        self._playwright = None


def _check_security_challenge(page) -> None:
    body = page.locator("body").inner_text(timeout=5_000)
    if SECURITY_CHALLENGE.search(body):
        raise ManualInterventionRequired("Browser security challenge requires a human unlock")


class PlaywrightTikTokAdapter(TikTokShippingAdapter):
    """Initial Seller Center adapter.

    The order-card selectors are environment-configurable because Seller Center markup differs by
    region and account rollout. Actions use visible Chinese/English labels where possible.
    """

    def __init__(self, settings: Settings):
        if not settings.tiktok_orders_url:
            raise ConfigurationError("TK_TIKTOK_ORDERS_URL is required in playwright mode")
        self.settings = settings
        self.browser = _PersistentBrowser(settings.tiktok_profile_dir, settings.headless)

    def discover_orders(self) -> list[ShippingOrder]:
        page = self.browser.page
        page.goto(self.settings.tiktok_orders_url, wait_until="domcontentloaded")
        _check_security_challenge(page)
        card_selector = os.getenv("TK_TIKTOK_ORDER_CARD_SELECTOR", "[data-order-id]")
        cards = page.locator(card_selector)
        orders: list[ShippingOrder] = []
        for index in range(cards.count()):
            card = cards.nth(index)
            order_id = card.get_attribute("data-order-id") or ""
            if not order_id:
                continue
            sku = card.get_attribute("data-sku") or ""
            title = card.get_attribute("data-product-title") or card.inner_text()
            quantity_value = card.get_attribute("data-quantity") or "1"
            country = card.get_attribute("data-country") or "US"
            orders.append(
                ShippingOrder(
                    platform_order_id=order_id,
                    country=country,
                    items=[
                        ShippingItem(
                            platform_sku=sku,
                            product_title=title.strip(),
                            quantity=max(1, int(quantity_value)),
                        )
                    ],
                )
            )
        if not orders:
            raise ManualInterventionRequired(
                "No orders matched TK_TIKTOK_ORDER_CARD_SELECTOR; capture the live Seller Center DOM before enabling unattended runs"
            )
        return orders

    def arrange_shipment(self, order: ShippingOrder) -> str:
        page = self.browser.page
        page.goto(self.settings.tiktok_orders_url, wait_until="domcontentloaded")
        _check_security_challenge(page)
        order_text = page.get_by_text(order.platform_order_id, exact=True).first
        if order_text.count() == 0:
            raise RetryableAutomationError(f"TikTok order row not found: {order.platform_order_id}")
        row = order_text.locator("xpath=ancestor::*[@role='row' or self::tr][1]")
        scope = row if row.count() else order_text.locator("xpath=ancestor::div[1]")
        scope.get_by_role("button", name=re.compile(r"安排发货|Arrange shipment", re.I)).click()
        drawer = page.get_by_text(re.compile(r"安排发货|Arrange shipment", re.I)).last
        drawer.wait_for(state="visible")
        page.get_by_role("button", name=re.compile(r"确认|Confirm", re.I)).last.click()
        page.wait_for_timeout(1_000)
        _check_security_challenge(page)
        body = page.locator("body").inner_text()
        tracking_number = find_tracking_number(body)
        if not tracking_number:
            raise RetryableAutomationError("Shipment was arranged but tracking number was not found")
        return tracking_number

    def download_label(self, order: ShippingOrder, tracking_number: str, output_dir: Path) -> Path:
        page = self.browser.page
        output_dir.mkdir(parents=True, exist_ok=True)
        action = page.get_by_role(
            "button", name=re.compile(r"打印.*面单|下载.*面单|Print.*label|Download.*label|下载", re.I)
        ).last
        mode = os.getenv("TK_TIKTOK_LABEL_OPEN_MODE", "popup").strip().lower()
        if mode == "download":
            with page.expect_download(timeout=30_000) as download_info:
                action.click()
            download = download_info.value
            path = output_dir / (download.suggested_filename or f"{tracking_number}.pdf")
            download.save_as(path)
            return path

        with page.expect_popup(timeout=30_000) as popup_info:
            action.click()
        popup = popup_info.value
        popup.wait_for_load_state("domcontentloaded")
        pdf_url = popup.url
        if not pdf_url.startswith(("http://", "https://")):
            raise ManualInterventionRequired(
                "TikTok label opened in an unsupported browser PDF viewer; capture the PDF response URL"
            )
        response = self.browser.context.request.get(pdf_url)
        if not response.ok:
            raise RetryableAutomationError(f"TikTok label download failed: HTTP {response.status}")
        path = output_dir / f"{tracking_number}.pdf"
        path.write_bytes(response.body())
        popup.close()
        return path

    def close(self) -> None:
        self.browser.close()


class PlaywrightWmsAdapter(WmsShippingAdapter):
    def __init__(self, settings: Settings):
        required = {
            "TK_WMS_UPLOAD_URL": settings.wms_upload_url,
            "TK_WMS_ORDERS_URL": settings.wms_orders_url,
            "TK_WMS_LABEL_UPLOAD_URL": settings.wms_label_upload_url,
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise ConfigurationError("Missing WMS configuration: " + ", ".join(missing))
        self.settings = settings
        self.browser = _PersistentBrowser(settings.wms_profile_dir, settings.headless)

    def _ensure_login(self) -> None:
        if not self.settings.wms_login_url:
            return
        page = self.browser.page
        page.goto(self.settings.wms_login_url, wait_until="domcontentloaded")
        username = page.locator("input[type='text']").first
        password = page.locator("input[type='password']").first
        if password.count() and password.is_visible():
            if not self.settings.wms_username or not self.settings.wms_password:
                raise ManualInterventionRequired("WMS login expired and credentials are not configured")
            username.fill(self.settings.wms_username)
            password.fill(self.settings.wms_password)
            page.get_by_role("button", name=re.compile(r"登录|Log in|Sign in", re.I)).click()
            page.wait_for_load_state("domcontentloaded")
        _check_security_challenge(page)

    def upload_order_excel(self, order: ShippingOrder, tracking_number: str, excel_path: Path) -> None:
        self._ensure_login()
        page = self.browser.page
        page.goto(self.settings.wms_upload_url, wait_until="domcontentloaded")
        _check_security_challenge(page)
        page.locator("input[type='file']").first.set_input_files(str(excel_path))
        transport = page.get_by_label(re.compile(r"运输方式|Shipping method", re.I))
        if transport.count() and order.transport_method:
            transport.select_option(label=order.transport_method)
        package = page.get_by_label(re.compile(r"包裹类型|Package type", re.I))
        if package.count() and order.package_type:
            package.select_option(label=order.package_type)
        page.get_by_role("button", name=re.compile(r"保存|上传|Save|Upload", re.I)).first.click()
        page.get_by_text(re.compile(r"成功|success", re.I)).first.wait_for(state="visible", timeout=30_000)

    def verify_order(self, order: ShippingOrder, tracking_number: str) -> None:
        page = self.browser.page
        page.goto(self.settings.wms_orders_url, wait_until="domcontentloaded")
        _check_security_challenge(page)
        page.get_by_text(order.normalized_customer_order_no(), exact=False).first.wait_for(
            state="visible", timeout=30_000
        )
        page.get_by_text(tracking_number, exact=False).first.wait_for(state="visible", timeout=30_000)

    def upload_label(self, order: ShippingOrder, tracking_number: str, label_path: Path) -> None:
        page = self.browser.page
        page.goto(self.settings.wms_label_upload_url, wait_until="domcontentloaded")
        _check_security_challenge(page)
        page.locator("input[type='file']").first.set_input_files(str(label_path))
        page.get_by_role("button", name=re.compile(r"上传|Upload", re.I)).first.click()
        page.get_by_text(re.compile(r"上传面单成功|label.*success", re.I)).first.wait_for(
            state="visible", timeout=30_000
        )

    def close(self) -> None:
        self.browser.close()
