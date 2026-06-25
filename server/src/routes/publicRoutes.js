import express from "express";
import Patient from "../models/Patient.js";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { patientDocToResource, patientResourceToDoc } from "../services/fhirMapper.js";
import {
  patientPortalRegistrationSchema,
  patientAppointmentRequestSchema
} from "../services/validation.js";
import { ensurePidIdentifier, generateNextPatientPid } from "../services/patientPidService.js";

const router = express.Router();

const SLOT_MINUTES = 15;
const WINDOW_START_MIN = 9 * 60;
const WINDOW_END_MIN = 12 * 60;
const BOOKABLE_DAYS = new Set([1, 2, 3, 4, 5, 6]); // Mon–Sat
const CONFIRMED_STATUSES = ["booked", "arrived", "checked-in", "fulfilled"];
const pad = (value) => String(value).padStart(2, "0");

const fullNameFromDoc = (patientDoc) => {
  const resource = patientDocToResource(patientDoc);
  const name = resource.name?.[0] || {};
  return [(name.given || []).join(" "), name.family].filter(Boolean).join(" ").trim();
};

// Lighter slot check for patient-requested appointments (no availability conflict —
// multiple patients may request the same slot; approval resolves conflicts).
const assertRequestableSlot = (start, end) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate >= endDate) {
    throw new ApiError(400, "Invalid appointment time range");
  }
  if (startDate.toDateString() !== endDate.toDateString()) {
    throw new ApiError(400, "Appointment must start and end on the same day");
  }
  if (!BOOKABLE_DAYS.has(startDate.getDay())) {
    throw new ApiError(400, "Appointments are only available Monday to Saturday");
  }
  const startMin = startDate.getHours() * 60 + startDate.getMinutes();
  const endMin = endDate.getHours() * 60 + endDate.getMinutes();
  if (
    startMin < WINDOW_START_MIN ||
    endMin > WINDOW_END_MIN ||
    startMin % SLOT_MINUTES !== 0 ||
    endMin - startMin !== SLOT_MINUTES
  ) {
    throw new ApiError(400, "Appointments must be a 15-minute slot within 09:00–12:00");
  }
};

router.post(
  "/patient-register",
  asyncHandler(async (req, res) => {
    const payload = patientPortalRegistrationSchema.parse(req.body);
    const pid = await generateNextPatientPid();

    const telecom = [];
    if (payload.phone) {
      telecom.push({ system: "phone", value: payload.phone });
    }
    if (payload.email) {
      telecom.push({ system: "email", value: payload.email });
    }

    const hasAddress = payload.line1 || payload.city || payload.state || payload.postalCode;
    const address = hasAddress
      ? [
          {
            line: payload.line1 ? [payload.line1] : [],
            city: payload.city,
            state: payload.state,
            postalCode: payload.postalCode
          }
        ]
      : [];

    const resource = {
      resourceType: "Patient",
      active: false,
      name: [{ family: payload.familyName, given: [payload.givenName] }],
      telecom,
      gender: payload.gender,
      birthDate: payload.birthDate,
      address
    };

    const docPayload = patientResourceToDoc(resource);
    const identifier = ensurePidIdentifier(docPayload.identifier, pid);

    const patient = await Patient.create({
      ...docPayload,
      pid,
      identifier,
      active: false,
      registrationStatus: "requested",
      registrationSource: "portal"
    });

    const patientResource = patientDocToResource(patient);

    res.status(201).json({
      message: "Registration submitted for approval",
      pid,
      patientId: patientResource.id,
      patient: patientResource
    });
  })
);

// Public list of bookable practitioners (no PHI).
router.get(
  "/practitioners",
  asyncHandler(async (_req, res) => {
    const practitioners = await User.find({ role: "practitioner", active: true })
      .select("fullName practitionerRole")
      .sort({ fullName: 1 })
      .lean();

    res.json({
      data: practitioners.map((practitioner) => ({
        id: String(practitioner._id),
        fullName: practitioner.fullName,
        practitionerRole: practitioner.practitionerRole || null
      }))
    });
  })
);

// Slot availability for a practitioner on a date (no PHI) — used to hide taken slots.
router.get(
  "/availability",
  asyncHandler(async (req, res) => {
    const practitionerId = String(req.query.practitionerId || "");
    const date = String(req.query.date || "");

    if (!/^[a-fA-F0-9]{24}$/.test(practitionerId)) {
      throw new ApiError(400, "A valid practitionerId is required");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ApiError(400, "date must be YYYY-MM-DD");
    }

    const exists = await User.exists({ _id: practitionerId, role: "practitioner", active: true });
    if (!exists) {
      throw new ApiError(400, "Selected practitioner is unavailable");
    }

    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59.999`);
    const confirmed = await Appointment.find({
      practitionerUserId: practitionerId,
      status: { $in: CONFIRMED_STATUSES },
      start: { $gte: dayStart, $lte: dayEnd }
    })
      .select("start")
      .lean();

    const unavailable = confirmed.map((appointment) => {
      const start = new Date(appointment.start);
      return `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    });

    res.json({ date, unavailable });
  })
);

// Patient-initiated appointment request → created as "proposed" for staff approval.
router.post(
  "/appointment-request",
  asyncHandler(async (req, res) => {
    const payload = patientAppointmentRequestSchema.parse(req.body);

    const patient = await Patient.findOne({ pid: payload.pid });
    if (!patient) {
      throw new ApiError(404, "No patient found for that Patient ID (PID)");
    }

    const practitioner = await User.findOne({
      _id: payload.practitionerId,
      role: "practitioner",
      active: true
    })
      .select("fullName")
      .lean();
    if (!practitioner) {
      throw new ApiError(400, "Selected practitioner is unavailable");
    }

    assertRequestableSlot(payload.start, payload.end);

    const appointment = await Appointment.create({
      status: "proposed",
      requestedByPatient: true,
      serviceCategory: payload.serviceCategory || "Patient request",
      start: new Date(payload.start),
      end: new Date(payload.end),
      minutesDuration: SLOT_MINUTES,
      patient: { reference: patient._id },
      patientName: fullNameFromDoc(patient),
      practitionerUserId: practitioner._id,
      practitionerName: practitioner.fullName,
      reason: payload.reason || undefined
    });

    res.status(201).json({
      message: "Appointment request submitted",
      appointmentId: String(appointment._id),
      status: appointment.status
    });
  })
);

export default router;
