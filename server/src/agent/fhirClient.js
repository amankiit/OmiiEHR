import env from "../config/env.js";

// Calls this EHR's own HTTP API on behalf of the signed-in user. Because every call
// carries the caller's JWT and goes through the real routes, the agent automatically
// inherits RBAC, Zod validation, PHI encryption and the audit trail — the agent can
// never do anything the logged-in user could not do manually.
export const apiCall = async ({ method = "GET", path, body, jwt, agentSessionId }) => {
  const response = await fetch(`${env.internalApiBaseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      // Flags this request as AI-initiated for the audit trail. Every call through
      // this client is the assistant acting on the user's behalf.
      "X-Initiated-By": "ai",
      ...(agentSessionId ? { "X-Agent-Session": String(agentSessionId) } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message =
      (data && (data.message || data.error || data.issue?.[0]?.diagnostics)) ||
      `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
};
