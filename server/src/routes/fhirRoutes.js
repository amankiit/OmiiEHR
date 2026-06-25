import express from "express";
import { randomUUID } from "node:crypto";
import { authenticate, authorize } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import Patient from "../models/Patient.js";
import Observation from "../models/Observation.js";
import Condition from "../models/Condition.js";
import AllergyIntolerance from "../models/AllergyIntolerance.js";
import MedicationRequest from "../models/MedicationRequest.js";
import Encounter from "../models/Encounter.js";
import Appointment from "../models/Appointment.js";
import Task from "../models/Task.js";
import User from "../models/User.js";
import {
  patientDocToResource,
  patientResourceToDoc,
  observationDocToResource,
  observationResourceToDoc,
  conditionDocToResource,
  conditionResourceToDoc,
  allergyIntoleranceDocToResource,
  allergyIntoleranceResourceToDoc,
  medicationRequestDocToResource,
  medicationRequestResourceToDoc,
  encounterDocToResource,
  encounterResourceToDoc,
  appointmentDocToResource,
  appointmentResourceToDoc,
  taskDocToResource,
  taskResourceToDoc,
  toSearchsetBundle
} from "../services/fhirMapper.js";
import {
  ensurePidIdentifier,
  generateNextPatientPid
} from "../services/patientPidService.js";
import {
  patientResourceSchema,
  observationResourceSchema,
  conditionResourceSchema,
  allergyIntoleranceResourceSchema,
  medicationRequestResourceSchema,
  encounterResourceSchema,
  appointmentResourceSchema,
  taskResourceSchema
} from "../services/validation.js";

const router = express.Router();

// Every response from the FHIR API uses the FHIR JSON media type. Setting it here
// means res.json() (which only defaults the header when unset) keeps it.
router.use((_req, res, next) => {
  res.type("application/fhir+json");
  next();
});

router.use(authenticate);

const readRoles = ["admin", "practitioner", "auditor"];
const writeRoles = ["admin", "practitioner"];
const patientWriteRoles = ["admin"];
// Creating/registering patients stays admin-only, but editing demographics on an
// existing chart is allowed for clinicians too.
const patientEditRoles = ["admin", "practitioner"];

const baseUrl = (req) => `${req.protocol}://${req.get("host")}/api/fhir`;
// Full request URL (including search params) for Bundle.link "self".
const selfUrl = (req) => `${req.protocol}://${req.get("host")}${req.originalUrl}`;

const parsePatientReference = (value, fieldName) => {
  const [resourceType, id] = String(value || "").split("/");
  if (resourceType !== "Patient" || !id) {
    throw new ApiError(400, `${fieldName} must be in Patient/{id} format`);
  }

  return id;
};

const ensurePatientExists = async (patientId) => {
  const patientExists = await Patient.exists({ _id: patientId });

  if (!patientExists) {
    throw new ApiError(400, "Referenced Patient does not exist");
  }
};

// Decrypts and flattens a patient's name for denormalised storage on appointments.
const resolvePatientName = async (patientId) => {
  const patientDoc = await Patient.findById(patientId);
  if (!patientDoc) {
    return undefined;
  }
  const name = patientDocToResource(patientDoc).name?.[0] || {};
  return [(name.given || []).join(" "), name.family].filter(Boolean).join(" ").trim() || undefined;
};

// Statuses that count as an "approved" appointment for practitioner patient visibility.
const APPROVED_APPOINTMENT_STATUSES = ["booked", "arrived", "checked-in", "fulfilled"];

// Patient ids a practitioner is permitted to see: those with an approved appointment
// with them, or a prior encounter they documented.
const visiblePatientIdsForPractitioner = async (practitionerUserId) => {
  const [appointmentPatientIds, encounterPatientIds] = await Promise.all([
    Appointment.find({
      practitionerUserId,
      status: { $in: APPROVED_APPOINTMENT_STATUSES }
    }).distinct("patient.reference"),
    Encounter.find({ "participant.individualUserId": practitionerUserId }).distinct("subject.reference")
  ]);

  return [...new Set([...appointmentPatientIds, ...encounterPatientIds].map(String))];
};

// Records the documenting practitioner as an encounter participant so that
// "prior encounter with this practitioner" patient visibility works.
const stampEncounterPerformer = async (docPayload, user) => {
  if (user.role !== "practitioner") {
    return docPayload;
  }
  const me = await User.findById(user.sub).select("fullName").lean();
  const participant = [
    ...(docPayload.participant || []).filter((entry) => String(entry.individualUserId) !== String(user.sub)),
    { type: "primary performer", individualDisplay: me?.fullName, individualUserId: user.sub }
  ];
  return { ...docPayload, participant };
};

// When an appointment is checked in, open the clinical encounter for that visit
// (idempotent — one encounter per appointment). Completing the visit closes it.
const syncEncounterWithAppointment = async (appointment) => {
  if (!appointment) {
    return;
  }

  if (appointment.status === "checked-in") {
    const existing = await Encounter.findOne({ "appointment.reference": appointment._id }).select("_id");
    if (existing) {
      return;
    }
    await Encounter.create({
      status: "in-progress",
      classCode: "AMB",
      type: { system: "http://snomed.info/sct", code: "185349003", display: "Outpatient visit" },
      subject: { reference: appointment.patient?.reference },
      appointment: { reference: appointment._id },
      periodStart: new Date(),
      reasonCode: appointment.reason ? { display: appointment.reason } : undefined,
      participant: [
        {
          type: "primary performer",
          individualDisplay: appointment.practitionerName,
          individualUserId: appointment.practitionerUserId
        }
      ]
    });
    return;
  }

  if (appointment.status === "fulfilled") {
    await Encounter.updateOne(
      { "appointment.reference": appointment._id, status: { $ne: "finished" } },
      { status: "finished", periodEnd: new Date() }
    );
  }
};

const ensurePractitionerCanAccessPatient = async (user, patientId) => {
  if (user.role !== "practitioner") {
    return;
  }
  const [hasAppointment, hasEncounter] = await Promise.all([
    Appointment.exists({
      practitionerUserId: user.sub,
      status: { $in: APPROVED_APPOINTMENT_STATUSES },
      "patient.reference": patientId
    }),
    Encounter.exists({ "participant.individualUserId": user.sub, "subject.reference": patientId })
  ]);
  if (!hasAppointment && !hasEncounter) {
    throw new ApiError(403, "You do not have access to this patient");
  }
};

const ensurePractitionerExists = async (practitionerUserId) => {
  const practitionerExists = await User.exists({
    _id: practitionerUserId,
    role: "practitioner",
    active: true
  });

  if (!practitionerExists) {
    throw new ApiError(400, "Referenced Practitioner does not exist or is inactive");
  }
};

const ensureBookingPermission = (requestingUser, practitionerUserId) => {
  if (
    requestingUser.role === "practitioner" &&
    String(practitionerUserId) !== String(requestingUser.sub)
  ) {
    throw new ApiError(403, "Practitioners can only book appointments under their own schedule");
  }
};

const ensureTaskOwnerPermission = (requestingUser, ownerUserId) => {
  if (requestingUser.role !== "practitioner") {
    return;
  }

  if (!ownerUserId || String(ownerUserId) !== String(requestingUser.sub)) {
    throw new ApiError(403, "Practitioners can only assign or update tasks under their own worklist");
  }
};

const slotDurationMinutes = 15;
const slotWindowStartMinutes = 9 * 60;
const slotWindowEndMinutes = 12 * 60;
const allowedBookingDays = new Set([1, 2, 3, 4, 5, 6]);

const ensurePractitionerAvailability = async ({
  practitionerUserId,
  start,
  end,
  excludeAppointmentId
}) => {
  const filter = {
    practitionerUserId,
    // Only confirmed appointments occupy a slot; pending patient requests do not.
    status: { $in: APPROVED_APPOINTMENT_STATUSES },
    start: { $lt: end },
    end: { $gt: start }
  };

  if (excludeAppointmentId) {
    filter._id = { $ne: excludeAppointmentId };
  }

  const conflict = await Appointment.findOne(filter).select("_id start end").lean();

  if (conflict) {
    throw new ApiError(409, "Practitioner is not available in the selected time range");
  }
};

const ensureWithinBookableSlot = ({ start, end, minutesDuration }) => {
  const startDate = new Date(start);
  const endDate = new Date(end);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new ApiError(400, "Appointment start/end must be valid datetime values");
  }

  if (startDate >= endDate) {
    throw new ApiError(400, "Appointment end must be after start");
  }

  if (startDate.toDateString() !== endDate.toDateString()) {
    throw new ApiError(400, "Appointments must start and end on the same day");
  }

  if (!allowedBookingDays.has(startDate.getDay())) {
    throw new ApiError(400, "Appointments are only allowed Monday to Saturday");
  }

  const startTotalMinutes = startDate.getHours() * 60 + startDate.getMinutes();
  const endTotalMinutes = endDate.getHours() * 60 + endDate.getMinutes();
  const duration = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60));

  if (
    startTotalMinutes < slotWindowStartMinutes ||
    endTotalMinutes > slotWindowEndMinutes ||
    startTotalMinutes % slotDurationMinutes !== 0 ||
    endTotalMinutes % slotDurationMinutes !== 0
  ) {
    throw new ApiError(400, "Appointments must be within 09:00-12:00 in 15-minute slot boundaries");
  }

  if (duration !== slotDurationMinutes) {
    throw new ApiError(400, "Appointments must be exactly 15 minutes");
  }

  if (minutesDuration !== undefined && Number(minutesDuration) !== slotDurationMinutes) {
    throw new ApiError(400, "minutesDuration must be 15");
  }
};

const resourceInteractions = [
  { code: "read" },
  { code: "search-type" },
  { code: "create" },
  { code: "update" }
];

router.get(
  "/metadata",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    res.json({
      resourceType: "CapabilityStatement",
      status: "active",
      date: new Date().toISOString(),
      kind: "instance",
      fhirVersion: "4.0.1",
      format: ["application/fhir+json"],
      software: {
        name: "OmiiEHR Core",
        version: "2.0.0"
      },
      implementation: {
        description: "FHIR R4-compatible EHR API",
        url: baseUrl(req)
      },
      rest: [
        {
          mode: "server",
          resource: [
            { type: "Patient", interaction: resourceInteractions },
            { type: "Observation", interaction: resourceInteractions },
            { type: "Condition", interaction: resourceInteractions },
            { type: "AllergyIntolerance", interaction: resourceInteractions },
            { type: "MedicationRequest", interaction: resourceInteractions },
            { type: "Encounter", interaction: resourceInteractions },
            { type: "Appointment", interaction: resourceInteractions },
            { type: "Task", interaction: resourceInteractions }
          ]
        }
      ]
    });
  })
);

router.post(
  "/Patient",
  authorize(...patientWriteRoles),
  asyncHandler(async (req, res) => {
    const resource = patientResourceSchema.parse(req.body);
    const docPayload = patientResourceToDoc(resource);
    const pid = await generateNextPatientPid();
    const identifier = ensurePidIdentifier(docPayload.identifier, pid);

    const patient = await Patient.create({
      ...docPayload,
      pid,
      identifier,
      createdBy: req.user.sub,
      updatedBy: req.user.sub
    });

    res.status(201).json(patientDocToResource(patient));
  })
);

router.get(
  "/Patient",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const filter = {};

    if (req.query.identifier) {
      filter["identifier.value"] = String(req.query.identifier);
    }

    // Practitioners only see patients they have an approved appointment or prior encounter with.
    if (req.user.role === "practitioner") {
      filter._id = { $in: await visiblePatientIdsForPractitioner(req.user.sub) };
    }

    const patients = await Patient.find(filter).sort({ createdAt: -1 }).limit(100);
    let resources = patients.map(patientDocToResource);

    // Free-text search across name, identifiers (MRN/PID), and birth date. Names are
    // encrypted at rest, so matching is done after decryption rather than in Mongo.
    const term = String(req.query.name || req.query.search || "").trim().toLowerCase();
    if (term) {
      resources = resources.filter((patient) => {
        const fullName = [(patient.name?.[0]?.given || []).join(" "), patient.name?.[0]?.family]
          .filter(Boolean)
          .join(" ");
        const haystack = [fullName, ...(patient.identifier || []).map((id) => id.value), patient.birthDate]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(term);
      });
    }

    res.json(
      toSearchsetBundle({
        resourceType: "Patient",
        resources,
        total: resources.length,
        baseUrl: baseUrl(req),
        selfUrl: selfUrl(req),
        searchId: randomUUID()
      })
    );
  })
);

router.get(
  "/Patient/:id",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const patient = await Patient.findById(req.params.id);

    if (!patient) {
      throw new ApiError(404, "Patient not found");
    }

    await ensurePractitionerCanAccessPatient(req.user, req.params.id);

    res.json(patientDocToResource(patient));
  })
);

router.put(
  "/Patient/:id",
  authorize(...patientEditRoles),
  asyncHandler(async (req, res) => {
    await ensurePractitionerCanAccessPatient(req.user, req.params.id);
    const resource = patientResourceSchema.parse(req.body);
    const docPayload = patientResourceToDoc(resource);
    const existingPatient = await Patient.findById(req.params.id).select("pid");

    if (!existingPatient) {
      throw new ApiError(404, "Patient not found");
    }

    const pid = existingPatient.pid || (await generateNextPatientPid());
    const identifier = ensurePidIdentifier(docPayload.identifier, pid);

    const patient = await Patient.findByIdAndUpdate(
      req.params.id,
      {
        ...docPayload,
        pid,
        identifier,
        updatedBy: req.user.sub
      },
      {
        new: true,
        runValidators: true
      }
    );

    if (!patient) {
      throw new ApiError(404, "Patient not found");
    }

    res.json(patientDocToResource(patient));
  })
);

router.get(
  ["/Patient/:id/$everything", "/Patient/:id/\\$everything"],
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const patient = await Patient.findById(req.params.id);

    if (!patient) {
      throw new ApiError(404, "Patient not found");
    }

    await ensurePractitionerCanAccessPatient(req.user, req.params.id);

    const [observations, conditions, allergies, medications, encounters, appointments, tasks] =
      await Promise.all([
        Observation.find({ "subject.reference": req.params.id }).sort({ effectiveDateTime: -1 }),
        Condition.find({ "subject.reference": req.params.id }).sort({ recordedDate: -1, createdAt: -1 }),
        AllergyIntolerance.find({ "patient.reference": req.params.id }).sort({ recordedDate: -1, createdAt: -1 }),
        MedicationRequest.find({ "subject.reference": req.params.id }).sort({ authoredOn: -1, createdAt: -1 }),
        Encounter.find({ "subject.reference": req.params.id }).sort({ periodStart: -1, createdAt: -1 }),
        Appointment.find({ "patient.reference": req.params.id }).sort({ start: -1, createdAt: -1 }),
        Task.find({ "for.reference": req.params.id }).sort({ dueDate: 1, authoredOn: -1, createdAt: -1 })
      ]);

    const allResources = [
      patientDocToResource(patient),
      ...conditions.map(conditionDocToResource),
      ...allergies.map(allergyIntoleranceDocToResource),
      ...medications.map(medicationRequestDocToResource),
      ...encounters.map(encounterDocToResource),
      ...observations.map(observationDocToResource),
      ...appointments.map(appointmentDocToResource),
      ...tasks.map(taskDocToResource)
    ];

    res.json({
      resourceType: "Bundle",
      type: "searchset",
      total: allResources.length,
      timestamp: new Date().toISOString(),
      link: [{ relation: "self", url: selfUrl(req) }],
      entry: allResources.map((resource) => ({
        fullUrl: `${baseUrl(req)}/${resource.resourceType}/${resource.id}`,
        resource,
        search: { mode: "match" }
      }))
    });
  })
);

router.post(
  "/Observation",
  authorize(...writeRoles),
  asyncHandler(async (req, res) => {
    const resource = observationResourceSchema.parse(req.body);
    const docPayload = observationResourceToDoc(resource);

    await ensurePatientExists(docPayload.subject.reference);

    const observation = await Observation.create({
      ...docPayload,
      performer: req.user.sub
    });

    res.status(201).json(observationDocToResource(observation));
  })
);

router.get(
  "/Observation",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const filter = {};

    if (req.query.subject) {
      filter["subject.reference"] = parsePatientReference(req.query.subject, "subject");
    }

    const observations = await Observation.find(filter)
      .sort({ effectiveDateTime: -1, createdAt: -1 })
      .limit(200);
    const resources = observations.map(observationDocToResource);

    res.json(
      toSearchsetBundle({
        resourceType: "Observation",
        resources,
        total: resources.length,
        baseUrl: baseUrl(req),
        selfUrl: selfUrl(req),
        searchId: randomUUID()
      })
    );
  })
);

router.get(
  "/Observation/:id",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const observation = await Observation.findById(req.params.id);

    if (!observation) {
      throw new ApiError(404, "Observation not found");
    }

    res.json(observationDocToResource(observation));
  })
);

router.put(
  "/Observation/:id",
  authorize(...writeRoles),
  asyncHandler(async (req, res) => {
    const resource = observationResourceSchema.parse(req.body);
    const docPayload = observationResourceToDoc(resource);

    await ensurePatientExists(docPayload.subject.reference);

    const observation = await Observation.findByIdAndUpdate(
      req.params.id,
      {
        ...docPayload,
        performer: req.user.sub
      },
      {
        new: true,
        runValidators: true
      }
    );

    if (!observation) {
      throw new ApiError(404, "Observation not found");
    }

    res.json(observationDocToResource(observation));
  })
);

router.post(
  "/Condition",
  authorize(...writeRoles),
  asyncHandler(async (req, res) => {
    const resource = conditionResourceSchema.parse(req.body);
    const docPayload = conditionResourceToDoc(resource);

    await ensurePatientExists(docPayload.subject.reference);

    const condition = await Condition.create({
      ...docPayload,
      asserter: req.user.sub
    });

    res.status(201).json(conditionDocToResource(condition));
  })
);

router.get(
  "/Condition",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const filter = {};

    if (req.query.subject) {
      filter["subject.reference"] = parsePatientReference(req.query.subject, "subject");
    }

    const records = await Condition.find(filter).sort({ recordedDate: -1, createdAt: -1 }).limit(200);
    const resources = records.map(conditionDocToResource);

    res.json(
      toSearchsetBundle({
        resourceType: "Condition",
        resources,
        total: resources.length,
        baseUrl: baseUrl(req),
        selfUrl: selfUrl(req),
        searchId: randomUUID()
      })
    );
  })
);

router.get(
  "/Condition/:id",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const record = await Condition.findById(req.params.id);

    if (!record) {
      throw new ApiError(404, "Condition not found");
    }

    res.json(conditionDocToResource(record));
  })
);

router.put(
  "/Condition/:id",
  authorize(...writeRoles),
  asyncHandler(async (req, res) => {
    const resource = conditionResourceSchema.parse(req.body);
    const docPayload = conditionResourceToDoc(resource);

    await ensurePatientExists(docPayload.subject.reference);

    const record = await Condition.findByIdAndUpdate(
      req.params.id,
      {
        ...docPayload,
        asserter: req.user.sub
      },
      {
        new: true,
        runValidators: true
      }
    );

    if (!record) {
      throw new ApiError(404, "Condition not found");
    }

    res.json(conditionDocToResource(record));
  })
);

router.post(
  "/AllergyIntolerance",
  authorize(...writeRoles),
  asyncHandler(async (req, res) => {
    const resource = allergyIntoleranceResourceSchema.parse(req.body);
    const docPayload = allergyIntoleranceResourceToDoc(resource);

    await ensurePatientExists(docPayload.patient.reference);

    const record = await AllergyIntolerance.create({
      ...docPayload,
      recorder: req.user.sub
    });

    res.status(201).json(allergyIntoleranceDocToResource(record));
  })
);

router.get(
  "/AllergyIntolerance",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const filter = {};

    if (req.query.patient) {
      filter["patient.reference"] = parsePatientReference(req.query.patient, "patient");
    }

    const records = await AllergyIntolerance.find(filter)
      .sort({ recordedDate: -1, createdAt: -1 })
      .limit(200);
    const resources = records.map(allergyIntoleranceDocToResource);

    res.json(
      toSearchsetBundle({
        resourceType: "AllergyIntolerance",
        resources,
        total: resources.length,
        baseUrl: baseUrl(req),
        selfUrl: selfUrl(req),
        searchId: randomUUID()
      })
    );
  })
);

router.get(
  "/AllergyIntolerance/:id",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const record = await AllergyIntolerance.findById(req.params.id);

    if (!record) {
      throw new ApiError(404, "AllergyIntolerance not found");
    }

    res.json(allergyIntoleranceDocToResource(record));
  })
);

router.put(
  "/AllergyIntolerance/:id",
  authorize(...writeRoles),
  asyncHandler(async (req, res) => {
    const resource = allergyIntoleranceResourceSchema.parse(req.body);
    const docPayload = allergyIntoleranceResourceToDoc(resource);

    await ensurePatientExists(docPayload.patient.reference);

    const record = await AllergyIntolerance.findByIdAndUpdate(
      req.params.id,
      {
        ...docPayload,
        recorder: req.user.sub
      },
      {
        new: true,
        runValidators: true
      }
    );

    if (!record) {
      throw new ApiError(404, "AllergyIntolerance not found");
    }

    res.json(allergyIntoleranceDocToResource(record));
  })
);

router.post(
  "/MedicationRequest",
  authorize(...writeRoles),
  asyncHandler(async (req, res) => {
    const resource = medicationRequestResourceSchema.parse(req.body);
    const docPayload = medicationRequestResourceToDoc(resource);

    await ensurePatientExists(docPayload.subject.reference);

    const record = await MedicationRequest.create({
      ...docPayload,
      requester: req.user.sub
    });

    res.status(201).json(medicationRequestDocToResource(record));
  })
);

router.get(
  "/MedicationRequest",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const filter = {};

    if (req.query.subject) {
      filter["subject.reference"] = parsePatientReference(req.query.subject, "subject");
    }

    const records = await MedicationRequest.find(filter)
      .sort({ authoredOn: -1, createdAt: -1 })
      .limit(200);
    const resources = records.map(medicationRequestDocToResource);

    res.json(
      toSearchsetBundle({
        resourceType: "MedicationRequest",
        resources,
        total: resources.length,
        baseUrl: baseUrl(req),
        selfUrl: selfUrl(req),
        searchId: randomUUID()
      })
    );
  })
);

router.get(
  "/MedicationRequest/:id",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const record = await MedicationRequest.findById(req.params.id);

    if (!record) {
      throw new ApiError(404, "MedicationRequest not found");
    }

    res.json(medicationRequestDocToResource(record));
  })
);

router.put(
  "/MedicationRequest/:id",
  authorize(...writeRoles),
  asyncHandler(async (req, res) => {
    const resource = medicationRequestResourceSchema.parse(req.body);
    const docPayload = medicationRequestResourceToDoc(resource);

    await ensurePatientExists(docPayload.subject.reference);

    const record = await MedicationRequest.findByIdAndUpdate(
      req.params.id,
      {
        ...docPayload,
        requester: req.user.sub
      },
      {
        new: true,
        runValidators: true
      }
    );

    if (!record) {
      throw new ApiError(404, "MedicationRequest not found");
    }

    res.json(medicationRequestDocToResource(record));
  })
);

router.post(
  "/Encounter",
  authorize(...writeRoles),
  asyncHandler(async (req, res) => {
    const resource = encounterResourceSchema.parse(req.body);
    const docPayload = encounterResourceToDoc(resource);

    await ensurePatientExists(docPayload.subject.reference);

    const record = await Encounter.create(await stampEncounterPerformer(docPayload, req.user));

    res.status(201).json(encounterDocToResource(record));
  })
);

router.get(
  "/Encounter",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const filter = {};

    if (req.query.subject) {
      filter["subject.reference"] = parsePatientReference(req.query.subject, "subject");
    }

    if (req.query.appointment) {
      const [resourceType, appointmentId] = String(req.query.appointment).split("/");
      if (resourceType !== "Appointment" || !appointmentId) {
        throw new ApiError(400, "appointment must be in Appointment/{id} format");
      }
      filter["appointment.reference"] = appointmentId;
    }

    const records = await Encounter.find(filter).sort({ periodStart: -1, createdAt: -1 }).limit(200);
    const resources = records.map(encounterDocToResource);

    res.json(
      toSearchsetBundle({
        resourceType: "Encounter",
        resources,
        total: resources.length,
        baseUrl: baseUrl(req),
        selfUrl: selfUrl(req),
        searchId: randomUUID()
      })
    );
  })
);

router.get(
  "/Encounter/:id",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const record = await Encounter.findById(req.params.id);

    if (!record) {
      throw new ApiError(404, "Encounter not found");
    }

    res.json(encounterDocToResource(record));
  })
);

router.put(
  "/Encounter/:id",
  authorize(...writeRoles),
  asyncHandler(async (req, res) => {
    const resource = encounterResourceSchema.parse(req.body);
    const docPayload = encounterResourceToDoc(resource);

    const existing = await Encounter.findById(req.params.id).select("appointment participant");
    if (!existing) {
      throw new ApiError(404, "Encounter not found");
    }

    await ensurePatientExists(docPayload.subject.reference);

    // Preserve the appointment link and recorded performers (which carry individualUserId
    // used for practitioner patient visibility) — these are not round-tripped via the resource.
    if (existing.appointment?.reference) {
      docPayload.appointment = { reference: existing.appointment.reference };
    }
    if (existing.participant?.length) {
      docPayload.participant = existing.participant;
    }

    const record = await Encounter.findByIdAndUpdate(
      req.params.id,
      await stampEncounterPerformer(docPayload, req.user),
      {
        new: true,
        runValidators: true
      }
    );

    res.json(encounterDocToResource(record));
  })
);

router.post(
  "/Appointment",
  authorize(...writeRoles),
  asyncHandler(async (req, res) => {
    const resource = appointmentResourceSchema.parse(req.body);
    const docPayload = appointmentResourceToDoc(resource);

    ensureWithinBookableSlot(docPayload);
    await ensurePatientExists(docPayload.patient.reference);
    await ensurePractitionerExists(docPayload.practitionerUserId);
    ensureBookingPermission(req.user, docPayload.practitionerUserId);
    await ensurePractitionerAvailability({
      practitionerUserId: docPayload.practitionerUserId,
      start: docPayload.start,
      end: docPayload.end
    });

    const practitioner = await User.findById(docPayload.practitionerUserId)
      .select("fullName")
      .lean();

    const record = await Appointment.create({
      ...docPayload,
      patientName: await resolvePatientName(docPayload.patient.reference),
      practitionerName: practitioner?.fullName || docPayload.practitionerName,
      createdBy: req.user.sub
    });

    res.status(201).json(appointmentDocToResource(record));
  })
);

router.get(
  "/Appointment",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const filter = {};

    if (req.user.role === "practitioner") {
      filter.practitionerUserId = req.user.sub;
    }

    if (req.query.patient) {
      filter["patient.reference"] = parsePatientReference(req.query.patient, "patient");
    }

    if (req.query.practitioner) {
      const [resourceType, id] = String(req.query.practitioner).split("/");
      if (resourceType !== "Practitioner" || !id) {
        throw new ApiError(400, "practitioner must be in Practitioner/{id} format");
      }
      if (req.user.role === "practitioner" && String(id) !== String(req.user.sub)) {
        throw new ApiError(403, "Practitioners can only access their own schedule");
      }
      filter.practitionerUserId = id;
    }

    if (req.query.from || req.query.to) {
      filter.start = {};

      if (req.query.from) {
        const from = new Date(String(req.query.from));
        if (Number.isNaN(from.getTime())) {
          throw new ApiError(400, "from must be a valid datetime");
        }
        filter.start.$gte = from;
      }

      if (req.query.to) {
        const to = new Date(String(req.query.to));
        if (Number.isNaN(to.getTime())) {
          throw new ApiError(400, "to must be a valid datetime");
        }
        filter.start.$lte = to;
      }
    }

    const records = await Appointment.find(filter).sort({ start: 1 }).limit(300);
    const resources = records.map(appointmentDocToResource);

    res.json(
      toSearchsetBundle({
        resourceType: "Appointment",
        resources,
        total: resources.length,
        baseUrl: baseUrl(req),
        selfUrl: selfUrl(req),
        searchId: randomUUID()
      })
    );
  })
);

router.get(
  "/Appointment/:id",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const record = await Appointment.findById(req.params.id);

    if (!record) {
      throw new ApiError(404, "Appointment not found");
    }

    if (
      req.user.role === "practitioner" &&
      String(record.practitionerUserId) !== String(req.user.sub)
    ) {
      throw new ApiError(403, "Practitioners can only access their own schedule");
    }

    res.json(appointmentDocToResource(record));
  })
);

router.put(
  "/Appointment/:id",
  authorize(...writeRoles),
  asyncHandler(async (req, res) => {
    const resource = appointmentResourceSchema.parse(req.body);
    const docPayload = appointmentResourceToDoc(resource);
    const existingRecord = await Appointment.findById(req.params.id).select("practitionerUserId");

    if (!existingRecord) {
      throw new ApiError(404, "Appointment not found");
    }

    if (
      req.user.role === "practitioner" &&
      String(existingRecord.practitionerUserId) !== String(req.user.sub)
    ) {
      throw new ApiError(403, "Practitioners can only modify their own schedule");
    }

    ensureWithinBookableSlot(docPayload);
    await ensurePatientExists(docPayload.patient.reference);
    await ensurePractitionerExists(docPayload.practitionerUserId);
    ensureBookingPermission(req.user, docPayload.practitionerUserId);
    await ensurePractitionerAvailability({
      practitionerUserId: docPayload.practitionerUserId,
      start: docPayload.start,
      end: docPayload.end,
      excludeAppointmentId: req.params.id
    });

    const practitioner = await User.findById(docPayload.practitionerUserId)
      .select("fullName")
      .lean();

    const record = await Appointment.findByIdAndUpdate(
      req.params.id,
      {
        ...docPayload,
        patientName: await resolvePatientName(docPayload.patient.reference),
        practitionerName: practitioner?.fullName || docPayload.practitionerName,
        createdBy: req.user.sub
      },
      {
        new: true,
        runValidators: true
      }
    );

    if (!record) {
      throw new ApiError(404, "Appointment not found");
    }

    await syncEncounterWithAppointment(record);

    res.json(appointmentDocToResource(record));
  })
);

router.post(
  "/Task",
  authorize(...writeRoles),
  asyncHandler(async (req, res) => {
    const resource = taskResourceSchema.parse(req.body);
    const docPayload = taskResourceToDoc(resource);

    await ensurePatientExists(docPayload.for.reference);

    let ownerUserId = docPayload.ownerUserId;
    if (req.user.role === "practitioner") {
      ownerUserId = req.user.sub;
    }
    ensureTaskOwnerPermission(req.user, ownerUserId);

    let ownerName = docPayload.ownerName;
    if (ownerUserId) {
      await ensurePractitionerExists(ownerUserId);
      const owner = await User.findById(ownerUserId).select("fullName").lean();
      ownerName = owner?.fullName || ownerName;
    }

    const record = await Task.create({
      ...docPayload,
      ownerUserId,
      ownerName,
      createdBy: req.user.sub
    });

    res.status(201).json(taskDocToResource(record));
  })
);

router.get(
  "/Task",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const filter = {};

    if (req.query.for) {
      filter["for.reference"] = parsePatientReference(req.query.for, "for");
    }

    if (req.query.status) {
      filter.status = String(req.query.status);
    }

    if (req.user.role === "practitioner") {
      filter.ownerUserId = req.user.sub;
    }

    if (req.query.owner) {
      const [resourceType, ownerId] = String(req.query.owner).split("/");
      if (resourceType !== "Practitioner" || !ownerId) {
        throw new ApiError(400, "owner must be in Practitioner/{id} format");
      }

      ensureTaskOwnerPermission(req.user, ownerId);
      filter.ownerUserId = ownerId;
    }

    const records = await Task.find(filter).sort({ dueDate: 1, authoredOn: -1, createdAt: -1 }).limit(300);
    const resources = records.map(taskDocToResource);

    res.json(
      toSearchsetBundle({
        resourceType: "Task",
        resources,
        total: resources.length,
        baseUrl: baseUrl(req),
        selfUrl: selfUrl(req),
        searchId: randomUUID()
      })
    );
  })
);

router.get(
  "/Task/:id",
  authorize(...readRoles),
  asyncHandler(async (req, res) => {
    const record = await Task.findById(req.params.id);

    if (!record) {
      throw new ApiError(404, "Task not found");
    }

    ensureTaskOwnerPermission(req.user, record.ownerUserId);

    res.json(taskDocToResource(record));
  })
);

router.put(
  "/Task/:id",
  authorize(...writeRoles),
  asyncHandler(async (req, res) => {
    const resource = taskResourceSchema.parse(req.body);
    const docPayload = taskResourceToDoc(resource);
    const existingRecord = await Task.findById(req.params.id).select("ownerUserId");

    if (!existingRecord) {
      throw new ApiError(404, "Task not found");
    }

    ensureTaskOwnerPermission(req.user, existingRecord.ownerUserId);
    await ensurePatientExists(docPayload.for.reference);

    let ownerUserId = docPayload.ownerUserId;
    if (req.user.role === "practitioner") {
      ownerUserId = req.user.sub;
    }
    ensureTaskOwnerPermission(req.user, ownerUserId);

    let ownerName = docPayload.ownerName;
    if (ownerUserId) {
      await ensurePractitionerExists(ownerUserId);
      const owner = await User.findById(ownerUserId).select("fullName").lean();
      ownerName = owner?.fullName || ownerName;
    }

    const record = await Task.findByIdAndUpdate(
      req.params.id,
      {
        ...docPayload,
        ownerUserId,
        ownerName
      },
      {
        new: true,
        runValidators: true
      }
    );

    if (!record) {
      throw new ApiError(404, "Task not found");
    }

    res.json(taskDocToResource(record));
  })
);

export default router;
