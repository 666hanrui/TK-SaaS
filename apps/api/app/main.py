from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings
from .models import CreateShippingJobRequest, ShippingJob, ShippingSweepResponse
from .repository import ShippingJobRepository
from .shipping.orchestrator import ShippingOrchestrator


settings = Settings.from_env()
settings.ensure_directories()
repository = ShippingJobRepository(settings.database_path)
orchestrator = ShippingOrchestrator(settings, repository)

app = FastAPI(title="TK-SaaS Execution API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "automation_mode": settings.automation_mode}


@app.get("/api/shipping/jobs", response_model=list[ShippingJob])
def list_shipping_jobs(limit: int = 100) -> list[ShippingJob]:
    return repository.list(max(1, min(limit, 500)))


@app.get("/api/shipping/jobs/{job_id}", response_model=ShippingJob)
def get_shipping_job(job_id: str) -> ShippingJob:
    try:
        return repository.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Shipping job not found") from exc


@app.post("/api/shipping/jobs", response_model=ShippingJob)
def create_shipping_job(request: CreateShippingJobRequest) -> ShippingJob:
    job = orchestrator.create_job(request.order)
    return orchestrator.run_job(job.id) if request.run_immediately else job


@app.post("/api/shipping/jobs/{job_id}/run", response_model=ShippingJob)
def run_shipping_job(job_id: str) -> ShippingJob:
    try:
        return orchestrator.run_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Shipping job not found") from exc


@app.post("/api/shipping/sweeps", response_model=ShippingSweepResponse)
def run_shipping_sweep() -> ShippingSweepResponse:
    jobs = orchestrator.sweep()
    return ShippingSweepResponse(
        mode=settings.automation_mode,
        discovered=len(jobs),
        completed=sum(job.run_status.value == "completed" for job in jobs),
        jobs=jobs,
    )
