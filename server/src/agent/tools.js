import { apiCall } from "./fhirClient.js";

// ---------------------------------------------------------------------------
// Bundle / resource summarisers
//
// FHIR resources are verbose. We hand the model compact summaries instead of raw
// resources: fewer tokens, sharper focus, and a smaller PHI surface. Mongo ids are
// preserved so the model can pass them straight back into other tools.
// ---------------------------------------------------------------------------

const patientName = (resource) => {
  const name = resource.name?.[0] || {};
  return [(name.given || []).join(" "), name.family].filter(Boolean).join(" ").trim() || "Unknown";
};

const pidOf = (resource) =>
  (resource.identifier || []).find((id) => /pid/i.test(id.system || ""))?.value ||
  resource.identifier?.[0]?.value;

const codingText = (concept) =>
  concept?.text ||
  concept?.coding?.[0]?.display ||
  concept?.coding?.[0]?.code ||
  undefined;

const summarizeResource = (resource) => {
  switch (resource.resourceType) {
    case "Patient":
      return {
        type: "Patient",
        id: resource.id,
        pid: pidOf(resource),
        name: patientName(resource),
        gender: resource.gender,
        birthDate: resource.birthDate
      };
    case "Condition":
      return {
        type: "Condition",
        id: resource.id,
        problem: codingText(resource.code),
        clinicalStatus: codingText(resource.clinicalStatus),
        onset: resource.onsetDateTime,
        recorded: resource.recordedDate
      };
    case "AllergyIntolerance":
      return {
        type: "AllergyIntolerance",
        id: resource.id,
        substance: codingText(resource.code),
        criticality: resource.criticality,
        status: codingText(resource.clinicalStatus),
        reactions: (resource.reaction || [])
          .flatMap((r) => (r.manifestation || []).map((m) => m.text))
          .filter(Boolean)
      };
    case "MedicationRequest":
      return {
        type: "MedicationRequest",
        id: resource.id,
        medication: codingText(resource.medicationCodeableConcept),
        status: resource.status,
        dosage: resource.dosageInstruction?.[0]?.text,
        authoredOn: resource.authoredOn
      };
    case "Observation":
      return {
        type: "Observation",
        id: resource.id,
        code: codingText(resource.code),
        value:
          resource.valueQuantity != null
            ? `${resource.valueQuantity.value}${resource.valueQuantity.unit ? " " + resource.valueQuantity.unit : ""}`
            : undefined,
        status: resource.status,
        effective: resource.effectiveDateTime
      };
    case "Encounter":
      return {
        type: "Encounter",
        id: resource.id,
        class: resource.class?.code || codingText(resource.type?.[0]),
        status: resource.status,
        start: resource.period?.start,
        end: resource.period?.end,
        reason: codingText(resource.reasonCode?.[0])
      };
    case "Appointment":
      return {
        type: "Appointment",
        id: resource.id,
        status: resource.status,
        start: resource.start,
        end: resource.end,
        reason: codingText(resource.reasonCode?.[0]),
        participants: (resource.participant || [])
          .map((p) => p.actor?.display || p.actor?.reference)
          .filter(Boolean)
      };
    case "Task":
      return {
        type: "Task",
        id: resource.id,
        description: resource.description,
        status: resource.status,
        priority: resource.priority,
        owner: resource.owner?.display
      };
    default:
      return { type: resource.resourceType, id: resource.id };
  }
};

const summarizeBundle = (bundle) =>
  (bundle?.entry || []).map((entry) => summarizeResource(entry.resource)).filter(Boolean);

// ---------------------------------------------------------------------------
// Tool definitions
//
// Each tool wraps one call to the EHR's own API. `isWrite: true` tools never run
// until a human approves them (see the orchestrator's confirmation flow).
// `roles` mirrors the access table the underlying routes already enforce; filtering
// here is just so the model is never offered a tool it would be rejected for.
// ---------------------------------------------------------------------------

const READ_ROLES = ["admin", "practitioner", "auditor"];
const WRITE_ROLES = ["admin", "practitioner"];

const patientRef = (patientId) => `Patient/${patientId}`;

const tools = [
  {
    name: "search_patients",
    description:
      "Find patients in the registry. Provide `query` to search by name, MRN/PID, or birth date, OR omit it entirely to list patients. Returns each patient's id (use it for other tools), pid, name, gender and birth date. Do not invent search terms — if the user did not give a name, call this with no query to browse.",
    isWrite: false,
    roles: READ_ROLES,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional free-text search term (name, PID/MRN, or birth date). Omit to list patients."
        }
      }
    },
    run: async ({ args, jwt, agentSessionId }) => {
      const query = (args.query || "").trim();
      const bundle = await apiCall({
        path: `/api/fhir/Patient${query ? `?search=${encodeURIComponent(query)}` : ""}`,
        jwt,
        agentSessionId
      });
      return { count: bundle.total, patients: summarizeBundle(bundle) };
    }
  },
  {
    name: "get_patient_chart",
    description:
      "Fetch a patient's full longitudinal chart by patient id: problems, allergies, medications, encounters, observations/vitals, appointments and tasks. Use this to answer clinical questions about a specific patient.",
    isWrite: false,
    roles: READ_ROLES,
    parameters: {
      type: "object",
      properties: {
        patientId: { type: "string", description: "The patient's 24-character id (not the PID)." }
      },
      required: ["patientId"]
    },
    run: async ({ args, jwt, agentSessionId }) => {
      const bundle = await apiCall({
        path: `/api/fhir/Patient/${args.patientId}/$everything`,
        jwt,
        agentSessionId
      });
      const records = summarizeBundle(bundle);
      const grouped = {};
      for (const record of records) {
        (grouped[record.type] ||= []).push(record);
      }
      return grouped;
    }
  },
  {
    name: "list_appointments",
    description:
      "List appointments, optionally filtered by patient id and/or a date range (ISO 8601). Practitioners only ever see their own schedule.",
    isWrite: false,
    roles: READ_ROLES,
    parameters: {
      type: "object",
      properties: {
        patientId: { type: "string", description: "Optional patient id to filter by." },
        from: { type: "string", description: "Optional ISO start datetime, e.g. 2026-06-26T00:00:00Z." },
        to: { type: "string", description: "Optional ISO end datetime." }
      }
    },
    run: async ({ args, jwt, agentSessionId }) => {
      const params = new URLSearchParams();
      if (args.patientId) params.set("patient", patientRef(args.patientId));
      if (args.from) params.set("from", args.from);
      if (args.to) params.set("to", args.to);
      const qs = params.toString();
      const bundle = await apiCall({ path: `/api/fhir/Appointment${qs ? `?${qs}` : ""}`, jwt, agentSessionId });
      return { count: bundle.total, appointments: summarizeBundle(bundle) };
    }
  },
  {
    name: "list_practitioners",
    description:
      "List bookable practitioners with their id, name and specialty. Use the id when booking an appointment.",
    isWrite: false,
    roles: READ_ROLES,
    parameters: { type: "object", properties: {} },
    run: async ({ jwt, agentSessionId }) => {
      const list = await apiCall({ path: `/api/admin/practitioners`, jwt, agentSessionId });
      const practitioners = (Array.isArray(list) ? list : list?.practitioners || list?.data || []).map(
        (p) => ({ id: p.id || p._id, name: p.fullName || p.name, specialty: p.practitionerRole || p.specialty })
      );
      return { practitioners };
    }
  },

  // ----- write tools (human-in-the-loop) -----
  {
    name: "create_task",
    description:
      "Create a care-team task for a patient. Proposes the action; a human must approve before it is written.",
    isWrite: true,
    roles: WRITE_ROLES,
    parameters: {
      type: "object",
      properties: {
        patientId: { type: "string", description: "The patient's 24-character id." },
        description: { type: "string", description: "What needs to be done." },
        priority: { type: "string", enum: ["routine", "urgent", "asap", "stat"] },
        status: {
          type: "string",
          enum: ["draft", "requested", "received", "accepted", "ready", "in-progress", "completed"]
        }
      },
      required: ["patientId", "description"]
    },
    summarize: (args) =>
      `Create a ${args.priority || "routine"} task for patient ${args.patientId}: "${args.description}"`,
    run: async ({ args, jwt, agentSessionId }) => {
      const resource = {
        resourceType: "Task",
        status: args.status || "requested",
        intent: "order",
        priority: args.priority,
        description: args.description,
        for: { reference: patientRef(args.patientId) }
      };
      const created = await apiCall({ method: "POST", path: "/api/fhir/Task", body: resource, jwt, agentSessionId });
      return { saved: true, message: "Task created and saved to the record.", created: summarizeResource(created) };
    }
  },
  {
    name: "create_observation",
    description:
      "Record a clinical observation or vital sign for a patient (e.g. blood pressure, heart rate). Proposes the action; a human must approve before it is written.",
    isWrite: true,
    roles: WRITE_ROLES,
    parameters: {
      type: "object",
      properties: {
        patientId: { type: "string", description: "The patient's 24-character id." },
        code: { type: "string", description: "Code or short label for the observation, e.g. '8867-4' or 'heart-rate'." },
        display: { type: "string", description: "Human-readable name, e.g. 'Heart rate'." },
        value: { type: "number", description: "Numeric value, if applicable." },
        unit: { type: "string", description: "Unit for the value, e.g. 'beats/min', 'mmHg'." },
        note: { type: "string", description: "Optional free-text note." }
      },
      required: ["patientId", "code"]
    },
    summarize: (args) =>
      `Record observation "${args.display || args.code}"${
        args.value != null ? ` = ${args.value}${args.unit ? " " + args.unit : ""}` : ""
      } for patient ${args.patientId}`,
    run: async ({ args, jwt, agentSessionId }) => {
      const resource = {
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ code: args.code, display: args.display }] },
        subject: { reference: patientRef(args.patientId) },
        effectiveDateTime: new Date().toISOString(),
        ...(args.value != null
          ? { valueQuantity: { value: args.value, unit: args.unit } }
          : {}),
        ...(args.note ? { note: [{ text: args.note }] } : {})
      };
      const created = await apiCall({
        method: "POST",
        path: "/api/fhir/Observation",
        body: resource,
        jwt,
        agentSessionId
      });
      return {
        saved: true,
        message: "Observation created and saved to the record.",
        created: summarizeResource(created)
      };
    }
  },
  {
    name: "book_appointment",
    description:
      "Book a 15-minute appointment for a patient with a practitioner. Provide the calendar date and the clinic-local start time — do NOT build ISO timestamps yourself. Bookable slots are Mon-Sat, 09:00-12:00 clinic time, on 15-minute boundaries (e.g. 09:00, 09:15, 09:30). Proposes the action; a human must approve before it is written.",
    isWrite: true,
    roles: WRITE_ROLES,
    parameters: {
      type: "object",
      properties: {
        patientId: { type: "string", description: "The patient's 24-character id." },
        practitionerId: { type: "string", description: "The practitioner's 24-character id." },
        date: { type: "string", description: "Calendar date of the appointment, YYYY-MM-DD." },
        startTime: {
          type: "string",
          description: "Clinic-local start time in 24-hour HH:MM, on a 15-minute boundary between 09:00 and 11:45."
        },
        reason: { type: "string", description: "Optional reason for the visit." }
      },
      required: ["patientId", "practitionerId", "date", "startTime"]
    },
    summarize: (args) =>
      `Book appointment for patient ${args.patientId} with practitioner ${args.practitionerId} on ${args.date} at ${args.startTime}${
        args.reason ? ` (${args.reason})` : ""
      }`,
    run: async ({ args, jwt, agentSessionId }) => {
      // Build the slot in clinic-local time (the same wall-clock the booking window is
      // validated against), then serialise to ISO. This removes all timezone guessing:
      // the model only ever deals in plain date + local time.
      const [year, month, day] = String(args.date).split("-").map(Number);
      const [hour, minute] = String(args.startTime).split(":").map(Number);
      if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) {
        throw new Error("date must be YYYY-MM-DD and startTime must be HH:MM.");
      }
      const startLocal = new Date(year, month - 1, day, hour, minute, 0, 0);
      const endLocal = new Date(startLocal.getTime() + 15 * 60 * 1000);

      const resource = {
        resourceType: "Appointment",
        status: "booked",
        start: startLocal.toISOString(),
        end: endLocal.toISOString(),
        minutesDuration: 15,
        participant: [
          { actor: { reference: patientRef(args.patientId) }, status: "accepted" },
          { actor: { reference: `Practitioner/${args.practitionerId}` }, status: "accepted" }
        ],
        ...(args.reason ? { reasonCode: [{ text: args.reason }] } : {})
      };
      const created = await apiCall({
        method: "POST",
        path: "/api/fhir/Appointment",
        body: resource,
        jwt,
        agentSessionId
      });
      return {
        saved: true,
        message: "Appointment booked and saved to the schedule.",
        created: summarizeResource(created)
      };
    }
  }
];

export const getToolsForRole = (role) => tools.filter((tool) => tool.roles.includes(role));

export const findTool = (role, name) => getToolsForRole(role).find((tool) => tool.name === name);

// Convert our tool definition to the OpenAI/Groq function-calling schema.
export const toToolSchema = (tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }
});

export { summarizeResource };
