const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api";

const readResponse = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload || "Request failed"
        : payload.message || payload.error || "Request failed";

    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
};

const toQueryString = (params = {}) => {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : "";
};

export const apiRequest = async (path, { method = "GET", body, token } = {}) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  return readResponse(response);
};

export const authApi = {
  login: (payload) => apiRequest("/auth/login", { method: "POST", body: payload }),
  me: (token) => apiRequest("/auth/me", { token })
};

export const publicApi = {
  registerPatient: (payload) =>
    apiRequest("/public/patient-register", { method: "POST", body: payload }),
  listPractitioners: () => apiRequest("/public/practitioners"),
  getAvailability: (practitionerId, date) =>
    apiRequest(`/public/availability${toQueryString({ practitionerId, date })}`),
  requestAppointment: (payload) =>
    apiRequest("/public/appointment-request", { method: "POST", body: payload })
};

export const fhirApi = {
  capability: (token) => apiRequest("/fhir/metadata", { token }),

  listPatients: (token) => apiRequest("/fhir/Patient", { token }),
  searchPatients: (token, name) => apiRequest(`/fhir/Patient${toQueryString({ name })}`, { token }),
  getPatient: (token, id) => apiRequest(`/fhir/Patient/${id}`, { token }),
  getPatientEverything: (token, id) => apiRequest(`/fhir/Patient/${id}/$everything`, { token }),
  createPatient: (token, resource) =>
    apiRequest("/fhir/Patient", { method: "POST", token, body: resource }),
  updatePatient: (token, id, resource) =>
    apiRequest(`/fhir/Patient/${id}`, { method: "PUT", token, body: resource }),

  listObservations: (token, params = {}) =>
    apiRequest(`/fhir/Observation${toQueryString(params)}`, { token }),
  createObservation: (token, resource) =>
    apiRequest("/fhir/Observation", { method: "POST", token, body: resource }),
  updateObservation: (token, id, resource) =>
    apiRequest(`/fhir/Observation/${id}`, { method: "PUT", token, body: resource }),

  listConditions: (token, params = {}) =>
    apiRequest(`/fhir/Condition${toQueryString(params)}`, { token }),
  createCondition: (token, resource) =>
    apiRequest("/fhir/Condition", { method: "POST", token, body: resource }),
  updateCondition: (token, id, resource) =>
    apiRequest(`/fhir/Condition/${id}`, { method: "PUT", token, body: resource }),

  listAllergies: (token, params = {}) =>
    apiRequest(`/fhir/AllergyIntolerance${toQueryString(params)}`, { token }),
  createAllergy: (token, resource) =>
    apiRequest("/fhir/AllergyIntolerance", { method: "POST", token, body: resource }),
  updateAllergy: (token, id, resource) =>
    apiRequest(`/fhir/AllergyIntolerance/${id}`, { method: "PUT", token, body: resource }),

  listMedicationRequests: (token, params = {}) =>
    apiRequest(`/fhir/MedicationRequest${toQueryString(params)}`, { token }),
  createMedicationRequest: (token, resource) =>
    apiRequest("/fhir/MedicationRequest", { method: "POST", token, body: resource }),
  updateMedicationRequest: (token, id, resource) =>
    apiRequest(`/fhir/MedicationRequest/${id}`, { method: "PUT", token, body: resource }),

  listEncounters: (token, params = {}) =>
    apiRequest(`/fhir/Encounter${toQueryString(params)}`, { token }),
  createEncounter: (token, resource) =>
    apiRequest("/fhir/Encounter", { method: "POST", token, body: resource }),
  updateEncounter: (token, id, resource) =>
    apiRequest(`/fhir/Encounter/${id}`, { method: "PUT", token, body: resource }),

  listAppointments: (token, params = {}) =>
    apiRequest(`/fhir/Appointment${toQueryString(params)}`, { token }),
  createAppointment: (token, resource) =>
    apiRequest("/fhir/Appointment", { method: "POST", token, body: resource }),
  updateAppointment: (token, id, resource) =>
    apiRequest(`/fhir/Appointment/${id}`, { method: "PUT", token, body: resource }),

  listTasks: (token, params = {}) => apiRequest(`/fhir/Task${toQueryString(params)}`, { token }),
  createTask: (token, resource) =>
    apiRequest("/fhir/Task", { method: "POST", token, body: resource }),
  updateTask: (token, id, resource) =>
    apiRequest(`/fhir/Task/${id}`, { method: "PUT", token, body: resource })
};

export const adminApi = {
  listUsers: (token) => apiRequest("/admin/users", { token }),
  listPractitioners: (token) => apiRequest("/admin/practitioners", { token }),
  createUser: (token, payload) =>
    apiRequest("/admin/users", { method: "POST", token, body: payload }),
  approvePatient: (token, id) =>
    apiRequest(`/admin/patients/${id}/approve`, { method: "POST", token }),
  listAuditLogs: (token, params = "") => apiRequest(`/admin/audit-logs${params}`, { token })
};
