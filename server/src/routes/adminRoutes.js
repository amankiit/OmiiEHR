import express from "express";
import bcrypt from "bcryptjs";
import { authenticate, authorize } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import Patient from "../models/Patient.js";
import { patientDocToResource } from "../services/fhirMapper.js";
import { paginationSchema, registerSchema } from "../services/validation.js";

const router = express.Router();

const formatUser = (user) => ({
  id: String(user._id),
  email: user.email,
  fullName: user.fullName,
  organization: user.organization,
  role: user.role,
  practitionerRole: user.practitionerRole || null,
  active: user.active,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
});

router.use(authenticate);

router.get(
  "/users",
  authorize("admin"),
  asyncHandler(async (_req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({
      data: users.map(formatUser),
      total: users.length
    });
  })
);

router.post(
  "/users",
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const payload = registerSchema.parse(req.body);

    const emailInUse = await User.findOne({ email: payload.email });
    if (emailInUse) {
      throw new ApiError(409, "Email is already in use");
    }

    const passwordHash = await bcrypt.hash(payload.password, 12);

    const user = await User.create({
      email: payload.email,
      fullName: payload.fullName,
      organization: payload.organization,
      passwordHash,
      role: payload.role,
      // Specialty only applies to practitioner accounts.
      practitionerRole: payload.role === "practitioner" ? payload.practitionerRole : undefined
    });

    res.status(201).json({ user: formatUser(user) });
  })
);

router.post(
  "/patients/:id/approve",
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const patient = await Patient.findByIdAndUpdate(
      req.params.id,
      { registrationStatus: "active", active: true, updatedBy: req.user.sub },
      { new: true }
    );

    if (!patient) {
      throw new ApiError(404, "Patient not found");
    }

    res.json({ patient: patientDocToResource(patient) });
  })
);

router.get(
  "/practitioners",
  authorize("admin", "practitioner"),
  asyncHandler(async (req, res) => {
    const filter =
      req.user.role === "practitioner"
        ? { _id: req.user.sub, role: "practitioner", active: true }
        : { role: "practitioner", active: true };

    const practitioners = await User.find(filter).sort({ fullName: 1 });

    res.json({
      data: practitioners.map(formatUser),
      total: practitioners.length
    });
  })
);

router.get(
  "/audit-logs",
  authorize("admin", "auditor"),
  asyncHandler(async (req, res) => {
    const pagination = paginationSchema.parse(req.query);
    const filter = {};

    if (req.query.outcome) {
      filter.outcome = req.query.outcome;
    }

    if (req.query.resourceType) {
      filter.resourceType = req.query.resourceType;
    }

    if (req.query.actorEmail) {
      filter.actorEmail = String(req.query.actorEmail).toLowerCase();
    }

    const skip = (pagination.page - 1) * pagination.limit;

    const [total, logs] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pagination.limit)
        .lean()
    ]);

    res.json({
      page: pagination.page,
      limit: pagination.limit,
      total,
      data: logs
    });
  })
);

export default router;
