import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || "30s";
const ADMIN_USER = __ENV.ADMIN_USER || "admin";
const ADMIN_PASS = __ENV.ADMIN_PASS || "AdminPass123!";

export const options = {
  vus: VUS,
  duration: DURATION,
};

interface AuthData {
  token: string;
  userId: string;
}

/**
 * k6 setup() runs once before the load: register a dedicated user and, when an
 * admin account exists (seeded), upgrade that user to enterprise tier so the
 * per-user rate limiter doesn't cap the load. All VUs share this token.
 */
export function setup(): AuthData {
  const username = `load_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const registerRes = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({
      username,
      email: `${username}@example.com`,
      password: "LoadTest123!",
    }),
    { headers: { "Content-Type": "application/json" } },
  );

  if (registerRes.status !== 201) {
    throw new Error(`register failed: ${registerRes.status} ${registerRes.body}`);
  }

  const body = registerRes.json() as {
    data: { user: { id: string }; accessToken: string };
  };

  // Best-effort: upgrade the load-test user to enterprise tier (500 req/min).
  try {
    const loginRes = http.post(
      `${BASE_URL}/auth/login`,
      JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
      { headers: { "Content-Type": "application/json" } },
    );
    if (loginRes.status === 200) {
      const admin = loginRes.json() as { data: { accessToken: string } };
      http.post(
        `${BASE_URL}/admin/users/${body.data.user.id}/upgrade`,
        JSON.stringify({ newTier: "enterprise" }),
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${admin.data.accessToken}`,
          },
        },
      );
    }
  } catch {
    // ignore — falls back to free-tier rate limit
  }

  return { token: body.data.accessToken, userId: body.data.user.id };
}

interface SubmitPayload {
  language: string;
  code: string;
  stdin?: string;
}

interface SubmitResponseBody {
  job_id?: string;
  data?: {
    id?: string;
    status?: string;
  };
  status?: string;
}

function submitJob(payload: SubmitPayload, headers: Record<string, string>) {
  return http.post(`${BASE_URL}/submit`, JSON.stringify(payload), { headers });
}

function pollResult(jobId: string, headers: Record<string, string>) {
  return http.get(`${BASE_URL}/result/${jobId}`, { headers });
}

export default function (data: AuthData) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.token}`,
  };

  const payload = {
    language: "python",
    code: "print('ok')",
    stdin: "",
  };

  const submitRes = submitJob(payload, headers);
  check(submitRes, {
    "submit status 201": (r) => r.status === 201,
  });

  if (submitRes.status !== 201) {
    sleep(1);
    return;
  }

  const body = submitRes.json<SubmitResponseBody>();
  const jobId = body?.job_id || body?.data?.id;
  if (!jobId) {
    sleep(1);
    return;
  }

  for (let i = 0; i < 10; i++) {
    const resultRes = pollResult(jobId, headers);
    if (resultRes.status === 200) {
      const resultBody = resultRes.json<SubmitResponseBody>();
      const status = resultBody?.status || resultBody?.data?.status;
      if (status && status !== "QUEUED" && status !== "RUNNING") {
        check(resultRes, {
          "result completed": (r) => r.status === 200,
        });
        break;
      }
    }
    sleep(0.2);
  }

  sleep(0.1);
}
