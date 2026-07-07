from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import RunStatus, ShippingJob, ShippingOrder, ShippingState


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ShippingJobRepository:
    _UPDATABLE_FIELDS = {
        "state",
        "run_status",
        "mapped_items_json",
        "tracking_number",
        "label_path",
        "excel_path",
        "error_code",
        "error_message",
    }

    def __init__(self, database_path: Path):
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS shipping_jobs (
                    id TEXT PRIMARY KEY,
                    platform_order_id TEXT NOT NULL UNIQUE,
                    state TEXT NOT NULL,
                    run_status TEXT NOT NULL,
                    run_mode TEXT NOT NULL,
                    order_json TEXT NOT NULL,
                    mapped_items_json TEXT NOT NULL DEFAULT '[]',
                    tracking_number TEXT NOT NULL DEFAULT '',
                    label_path TEXT NOT NULL DEFAULT '',
                    excel_path TEXT NOT NULL DEFAULT '',
                    error_code TEXT NOT NULL DEFAULT '',
                    error_message TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS shipping_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    state TEXT NOT NULL,
                    details_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(job_id) REFERENCES shipping_jobs(id)
                );
                """
            )

    def create_or_get(self, order: ShippingOrder, run_mode: str) -> ShippingJob:
        existing = self.get_by_order_id(order.platform_order_id)
        if existing:
            return existing

        job_id = str(uuid.uuid4())
        now = _now()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO shipping_jobs (
                    id, platform_order_id, state, run_status, run_mode,
                    order_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    order.platform_order_id,
                    ShippingState.DISCOVERED.value,
                    RunStatus.QUEUED.value,
                    run_mode,
                    order.model_dump_json(),
                    now,
                    now,
                ),
            )
            self._insert_event(
                connection,
                job_id,
                "job_created",
                ShippingState.DISCOVERED.value,
                {"platform_order_id": order.platform_order_id, "run_mode": run_mode},
            )
        return self.get(job_id)

    def get(self, job_id: str) -> ShippingJob:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM shipping_jobs WHERE id = ?", (job_id,)).fetchone()
            if not row:
                raise KeyError(job_id)
            events = connection.execute(
                "SELECT event_type, state, details_json, created_at FROM shipping_events "
                "WHERE job_id = ? ORDER BY id",
                (job_id,),
            ).fetchall()
        return self._row_to_model(row, events)

    def get_by_order_id(self, platform_order_id: str) -> ShippingJob | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id FROM shipping_jobs WHERE platform_order_id = ?", (platform_order_id,)
            ).fetchone()
        return self.get(row["id"]) if row else None

    def list(self, limit: int = 100) -> list[ShippingJob]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id FROM shipping_jobs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [self.get(row["id"]) for row in rows]

    def mark_running(self, job_id: str) -> ShippingJob:
        return self.update(job_id, "run_started", run_status=RunStatus.RUNNING.value)

    def advance(self, job_id: str, state: ShippingState, **fields: Any) -> ShippingJob:
        return self.update(job_id, "step_completed", state=state.value, **fields)

    def mark_completed(self, job_id: str) -> ShippingJob:
        return self.update(
            job_id,
            "job_completed",
            state=ShippingState.COMPLETED.value,
            run_status=RunStatus.COMPLETED.value,
            error_code="",
            error_message="",
        )

    def mark_failure(
        self, job_id: str, status: RunStatus, error_code: str, error_message: str
    ) -> ShippingJob:
        return self.update(
            job_id,
            "job_failed",
            run_status=status.value,
            error_code=error_code,
            error_message=error_message,
        )

    def update(self, job_id: str, event_type: str, **fields: Any) -> ShippingJob:
        invalid = set(fields) - self._UPDATABLE_FIELDS
        if invalid:
            raise ValueError(f"Unsupported job fields: {sorted(invalid)}")
        fields["updated_at"] = _now()
        assignments = ", ".join(f"{name} = ?" for name in fields)
        values = list(fields.values()) + [job_id]
        with self._connect() as connection:
            current = connection.execute(
                "SELECT state FROM shipping_jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if not current:
                raise KeyError(job_id)
            connection.execute(f"UPDATE shipping_jobs SET {assignments} WHERE id = ?", values)
            state = str(fields.get("state", current["state"]))
            details = {key: value for key, value in fields.items() if key != "updated_at"}
            self._insert_event(connection, job_id, event_type, state, details)
        return self.get(job_id)

    @staticmethod
    def _insert_event(
        connection: sqlite3.Connection,
        job_id: str,
        event_type: str,
        state: str,
        details: dict[str, Any],
    ) -> None:
        connection.execute(
            "INSERT INTO shipping_events (job_id, event_type, state, details_json, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (job_id, event_type, state, json.dumps(details, ensure_ascii=False), _now()),
        )

    @staticmethod
    def _row_to_model(row: sqlite3.Row, events: list[sqlite3.Row]) -> ShippingJob:
        return ShippingJob(
            id=row["id"],
            platform_order_id=row["platform_order_id"],
            state=row["state"],
            run_status=row["run_status"],
            run_mode=row["run_mode"],
            order=ShippingOrder.model_validate_json(row["order_json"]),
            mapped_items=json.loads(row["mapped_items_json"] or "[]"),
            tracking_number=row["tracking_number"],
            label_path=row["label_path"],
            excel_path=row["excel_path"],
            error_code=row["error_code"],
            error_message=row["error_message"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            events=[
                {
                    "event_type": event["event_type"],
                    "state": event["state"],
                    "details": json.loads(event["details_json"] or "{}"),
                    "created_at": event["created_at"],
                }
                for event in events
            ],
        )
