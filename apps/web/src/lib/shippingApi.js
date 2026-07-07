const SHIPPING_API_BASE = "/api/shipping";

async function request(path, options = {}) {
  const response = await fetch(`${SHIPPING_API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });

  if (!response.ok) {
    let detail = "发货自动化请求失败";
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {
      // Keep the generic message for non-JSON proxy errors.
    }
    throw new Error(detail);
  }

  return response.json();
}

export function runShippingSweep() {
  return request("/sweeps", { method: "POST" });
}

export function fetchShippingJobs() {
  return request("/jobs");
}
