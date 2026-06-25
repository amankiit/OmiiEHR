import { z } from "zod";

const email = z.string().trim().toLowerCase().email();

export const registerSchema = z.object({
  email,
  fullName: z.string().trim().min(2).max(120),
  organization: z.string().trim().max(120).optional().default(""),
  password: z
    .string()
    .min(12)
    .max(128)
    .regex(/[A-Z]/, "Password must include at least one uppercase letter")
    .regex(/[a-z]/, "Password must include at least one lowercase letter")
    .regex(/[0-9]/, "Password must include at least one digit")
    .regex(/[^A-Za-z0-9]/, "Password must include at least one special character"),
  role: z.enum(["admin", "practitioner", "auditor"]).optional().default("practitioner"),
  practitionerRole: z
    .enum([
      "physician",
      "dentist",
      "clinician",
      "nurse",
      "surgeon",
      "pharmacist",
      "technician",
      "therapist",
      "nutritionist"
    ])
    .optional()
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1)
});

const patientReferenceSchema = z
  .string()
  .regex(/^Patient\/[a-fA-F0-9]{24}$/, "reference must be Patient/{id}");

const identifierSchema = z.object({
  system: z.string().trim().min(1),
  value: z.string().trim().min(1)
});

const patientNameSchema = z.object({
  family: z.string().trim().optional(),
  given: z.array(z.string().trim()).optional()
});

const telecomSchema = z.object({
  system: z.enum(["phone", "email"]),
  value: z.string().trim().min(1)
});

const addressSchema = z.object({
  line: z.array(z.string().trim()).optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  postalCode: z.string().trim().optional()
});

export const patientResourceSchema = z.object({
  resourceType: z.literal("Patient"),
  active: z.boolean().optional(),
  identifier: z.array(identifierSchema).optional(),
  name: z.array(patientNameSchema).optional(),
  telecom: z.array(telecomSchema).optional(),
  gender: z.enum(["male", "female", "other", "unknown"]).optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "birthDate must be YYYY-MM-DD")
    .optional(),
  address: z.array(addressSchema).optional()
});

export const patientPortalRegistrationSchema = z.object({
  givenName: z.string().trim().min(1).max(120),
  familyName: z.string().trim().min(1).max(120),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "birthDate must be YYYY-MM-DD"),
  gender: z.enum(["male", "female", "other", "unknown"]).optional().default("unknown"),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.string().trim().email().optional().or(z.literal("")).default(""),
  line1: z.string().trim().max(200).optional().default(""),
  city: z.string().trim().max(80).optional().default(""),
  state: z.string().trim().max(40).optional().default(""),
  postalCode: z.string().trim().max(20).optional().default("")
});

export const patientAppointmentRequestSchema = z.object({
  pid: z.string().trim().min(1, "Patient ID is required"),
  practitionerId: z.string().regex(/^[a-fA-F0-9]{24}$/, "practitionerId must be a valid id"),
  start: z.string().datetime(),
  end: z.string().datetime(),
  serviceCategory: z.string().trim().max(80).optional().default(""),
  reason: z.string().trim().max(200).optional().default("")
});

const observationCodingSchema = z.object({
  system: z.string().trim().optional(),
  code: z.string().trim().min(1),
  display: z.string().trim().optional()
});

export const observationResourceSchema = z.object({
  resourceType: z.literal("Observation"),
  status: z.enum(["registered", "preliminary", "final", "amended"]).optional(),
  code: z.object({
    coding: z.array(observationCodingSchema).min(1)
  }),
  subject: z.object({
    reference: patientReferenceSchema
  }),
  effectiveDateTime: z.string().datetime().optional(),
  issued: z.string().datetime().optional(),
  valueQuantity: z
    .object({
      value: z.number(),
      unit: z.string().trim().optional(),
      system: z.string().trim().optional(),
      code: z.string().trim().optional()
    })
    .optional(),
  note: z.array(z.object({ text: z.string().trim().min(1) })).optional()
});

const conditionCodingSchema = z.object({
  system: z.string().trim().optional(),
  code: z.string().trim().min(1),
  display: z.string().trim().optional()
});

export const conditionResourceSchema = z.object({
  resourceType: z.literal("Condition"),
  clinicalStatus: z
    .object({
      coding: z
        .array(
          z.object({
            system: z.string().trim().optional(),
            code: z
              .enum(["active", "recurrence", "relapse", "inactive", "remission", "resolved"])
              .optional(),
            display: z.string().trim().optional()
          })
        )
        .optional()
    })
    .optional(),
  verificationStatus: z
    .object({
      coding: z
        .array(
          z.object({
            system: z.string().trim().optional(),
            code: z
              .enum(["unconfirmed", "provisional", "differential", "confirmed", "refuted", "entered-in-error"])
              .optional(),
            display: z.string().trim().optional()
          })
        )
        .optional()
    })
    .optional(),
  code: z.object({
    coding: z.array(conditionCodingSchema).min(1)
  }),
  subject: z.object({
    reference: patientReferenceSchema
  }),
  onsetDateTime: z.string().datetime().optional(),
  recordedDate: z.string().datetime().optional(),
  note: z.array(z.object({ text: z.string().trim().min(1) })).optional()
});

const allergyCodingSchema = z.object({
  system: z.string().trim().optional(),
  code: z.string().trim().min(1),
  display: z.string().trim().optional()
});

export const allergyIntoleranceResourceSchema = z.object({
  resourceType: z.literal("AllergyIntolerance"),
  clinicalStatus: z
    .object({
      coding: z
        .array(
          z.object({
            system: z.string().trim().optional(),
            code: z.enum(["active", "inactive", "resolved"]).optional(),
            display: z.string().trim().optional()
          })
        )
        .optional()
    })
    .optional(),
  verificationStatus: z
    .object({
      coding: z
        .array(
          z.object({
            system: z.string().trim().optional(),
            code: z.enum(["unconfirmed", "confirmed", "refuted", "entered-in-error"]).optional(),
            display: z.string().trim().optional()
          })
        )
        .optional()
    })
    .optional(),
  type: z.enum(["allergy", "intolerance"]).optional(),
  category: z.array(z.enum(["food", "medication", "environment", "biologic"])) .optional(),
  criticality: z.enum(["low", "high", "unable-to-assess"]).optional(),
  code: z.object({
    coding: z.array(allergyCodingSchema).min(1)
  }),
  patient: z.object({
    reference: patientReferenceSchema
  }),
  recordedDate: z.string().datetime().optional(),
  reaction: z
    .array(
      z.object({
        substance: z.object({ text: z.string().trim().optional() }).optional(),
        manifestation: z.array(z.object({ text: z.string().trim().min(1) })).optional(),
        severity: z.enum(["mild", "moderate", "severe"]).optional(),
        description: z.string().trim().optional()
      })
    )
    .optional()
});

const medicationCodingSchema = z.object({
  system: z.string().trim().optional(),
  code: z.string().trim().min(1),
  display: z.string().trim().optional()
});

const reasonCodeSchema = z
  .object({
    text: z.string().trim().min(1).optional(),
    coding: z.array(conditionCodingSchema).min(1).optional()
  })
  .refine((value) => Boolean(value.text) || Boolean(value.coding?.length), {
    message: "reasonCode item must include text or coding"
  });

export const medicationRequestResourceSchema = z.object({
  resourceType: z.literal("MedicationRequest"),
  status: z
    .enum([
      "active",
      "on-hold",
      "cancelled",
      "completed",
      "entered-in-error",
      "stopped",
      "draft",
      "unknown"
    ])
    .optional(),
  intent: z
    .enum([
      "proposal",
      "plan",
      "order",
      "original-order",
      "reflex-order",
      "filler-order",
      "instance-order",
      "option"
    ])
    .optional(),
  medicationCodeableConcept: z.object({
    coding: z.array(medicationCodingSchema).min(1)
  }),
  subject: z.object({
    reference: patientReferenceSchema
  }),
  authoredOn: z.string().datetime().optional(),
  dosageInstruction: z
    .array(
      z.object({
        text: z.string().trim().min(1)
      })
    )
    .optional(),
  reasonCode: z
    .array(reasonCodeSchema)
    .optional(),
  dispenseRequest: z
    .object({
      numberOfRepeatsAllowed: z.number().optional(),
      quantity: z
        .object({
          value: z.number(),
          unit: z.string().trim().optional()
        })
        .optional()
    })
    .optional(),
  note: z.array(z.object({ text: z.string().trim().min(1) })).optional()
});

const encounterCodingSchema = z.object({
  system: z.string().trim().optional(),
  code: z.string().trim().optional(),
  display: z.string().trim().optional()
});

export const encounterResourceSchema = z.object({
  resourceType: z.literal("Encounter"),
  status: z
    .enum([
      "planned",
      "arrived",
      "triaged",
      "in-progress",
      "onleave",
      "finished",
      "cancelled",
      "entered-in-error",
      "unknown"
    ])
    .optional(),
  class: z
    .object({
      code: z.string().trim().min(1),
      system: z.string().trim().optional(),
      display: z.string().trim().optional()
    })
    .optional(),
  type: z
    .array(
      z.object({
        coding: z.array(encounterCodingSchema).min(1)
      })
    )
    .optional(),
  subject: z.object({
    reference: patientReferenceSchema
  }),
  period: z
    .object({
      start: z.string().datetime().optional(),
      end: z.string().datetime().optional()
    })
    .optional(),
  reasonCode: z
    .array(reasonCodeSchema)
    .optional(),
  location: z
    .array(
      z.object({
        location: z.object({ display: z.string().trim().optional() }).optional()
      })
    )
    .optional(),
  serviceProvider: z.object({ display: z.string().trim().optional() }).optional(),
  participant: z
    .array(
      z.object({
        type: z
          .array(
            z.object({
              text: z.string().trim().optional()
            })
          )
          .optional(),
        individual: z.object({ display: z.string().trim().optional() }).optional()
      })
    )
    .optional(),
  note: z.array(z.object({ text: z.string().trim().min(1) })).optional()
});

export const appointmentResourceSchema = z
  .object({
    resourceType: z.literal("Appointment"),
    status: z
      .enum([
        "proposed",
        "pending",
        "booked",
        "arrived",
        "fulfilled",
        "cancelled",
        "noshow",
        "entered-in-error",
        "checked-in",
        "waitlist"
      ])
      .optional(),
    description: z.string().trim().optional(),
    serviceCategory: z
      .array(
        z.object({
          coding: z.array(encounterCodingSchema).optional(),
          text: z.string().trim().optional()
        })
      )
      .optional(),
    start: z.string().datetime(),
    end: z.string().datetime(),
    minutesDuration: z.number().optional(),
    participant: z.array(
      z.object({
        actor: z
          .object({
            reference: z.string().trim().optional(),
            display: z.string().trim().optional()
          })
          .optional(),
        status: z.string().trim().optional()
      })
    ),
    reasonCode: z
      .array(
        z.object({
          text: z.string().trim().optional(),
          coding: z.array(encounterCodingSchema).optional()
        })
      )
      .optional(),
    comment: z.string().trim().optional()
  })
  .refine(
    (value) => {
      const patientParticipant = value.participant.some((participant) =>
        /^Patient\/[a-fA-F0-9]{24}$/.test(participant.actor?.reference || "")
      );
      return patientParticipant;
    },
    {
      path: ["participant"],
      message: "At least one participant.actor.reference must be Patient/{id}"
    }
  )
  .refine(
    (value) => {
      const practitionerParticipant = value.participant.some((participant) =>
        /^Practitioner\/[a-fA-F0-9]{24}$/.test(participant.actor?.reference || "")
      );
      return practitionerParticipant;
    },
    {
      path: ["participant"],
      message: "At least one participant.actor.reference must be Practitioner/{id}"
    }
  )
  .refine(
    (value) => {
      const start = new Date(value.start);
      const end = new Date(value.end);
      return start < end;
    },
    {
      path: ["end"],
      message: "end must be after start"
    }
  );

const taskOwnerReferenceSchema = z
  .string()
  .regex(/^Practitioner\/[a-fA-F0-9]{24}$/, "owner.reference must be Practitioner/{id}");

const taskPatientReferenceSchema = z
  .string()
  .regex(/^Patient\/[a-fA-F0-9]{24}$/, "for.reference must be Patient/{id}");

export const taskResourceSchema = z.object({
  resourceType: z.literal("Task"),
  status: z
    .enum([
      "draft",
      "requested",
      "received",
      "accepted",
      "rejected",
      "ready",
      "cancelled",
      "in-progress",
      "on-hold",
      "failed",
      "completed",
      "entered-in-error"
    ])
    .optional(),
  intent: z.string().trim().optional(),
  priority: z.enum(["routine", "urgent", "asap", "stat"]).optional(),
  code: z
    .object({
      text: z.string().trim().optional(),
      coding: z.array(encounterCodingSchema).optional()
    })
    .optional(),
  description: z.string().trim().min(1),
  for: z.object({
    reference: taskPatientReferenceSchema
  }),
  owner: z
    .object({
      reference: taskOwnerReferenceSchema.optional(),
      display: z.string().trim().optional()
    })
    .optional(),
  authoredOn: z.string().datetime().optional(),
  executionPeriod: z
    .object({
      start: z.string().datetime().optional(),
      end: z.string().datetime().optional()
    })
    .optional(),
  note: z.array(z.object({ text: z.string().trim().min(1) })).optional()
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25)
});
