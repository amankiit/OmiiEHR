import { encryptPhi, decryptPhi } from "./cryptoService.js";
import { ApiError } from "../utils/apiError.js";
import { PID_SYSTEM } from "./patientPidService.js";

// FHIR R4 has no standard element for these locally-meaningful fields, so they are
// carried as extensions (url + value[x]) instead of ad-hoc top-level properties.
// This keeps every emitted resource conformant with the FHIR R4 structure.
const EXTENSION_BASE = "https://omiiehr.com/fhir/StructureDefinition";
export const PATIENT_REGISTRATION_STATUS_EXTENSION = `${EXTENSION_BASE}/patient-registration-status`;
export const PATIENT_REGISTRATION_SOURCE_EXTENSION = `${EXTENSION_BASE}/patient-registration-source`;
export const APPOINTMENT_REQUESTED_BY_PATIENT_EXTENSION = `${EXTENSION_BASE}/appointment-requested-by-patient`;

const dateOnlyToDate = (value) => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
};

const toDateOnly = (value) => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString().slice(0, 10);
};

const toDateTime = (value) => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
};

const sanitize = (value) => {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
};

const pickTelecom = (telecom = [], system) => {
  return telecom.find((entry) => entry.system === system)?.value || "";
};

const pickCoding = (codeableConcept) => {
  return codeableConcept?.coding?.[0] || {};
};

const codingFromDoc = (coding) => ({
  system: coding?.system,
  code: coding?.code,
  display: coding?.display
});

const parseReference = (reference, expectedType, fieldPath) => {
  const parts = String(reference || "").split("/");
  if (parts.length !== 2 || parts[0] !== expectedType || !parts[1]) {
    throw new ApiError(400, `${fieldPath} must be in ${expectedType}/{id} format`);
  }

  return parts[1];
};

const parsePatientReference = (reference, fieldPath = "subject.reference") => {
  return parseReference(reference, "Patient", fieldPath);
};

const parseStatusCode = (codeableConcept, fallback) => {
  return sanitize(codeableConcept?.coding?.[0]?.code) || fallback;
};

const parseDateTime = (value, fallback) => {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed;
};

export const patientResourceToDoc = (resource) => {
  if (resource.resourceType !== "Patient") {
    throw new ApiError(400, "Expected a Patient resource");
  }

  const name = resource.name?.[0] || {};
  const address = resource.address?.[0] || {};

  return {
    identifier: (resource.identifier || []).map((identifier) => ({
      system: sanitize(identifier.system),
      value: sanitize(identifier.value)
    })),
    active: resource.active ?? true,
    gender: resource.gender || "unknown",
    birthDate: dateOnlyToDate(resource.birthDate),
    phi: {
      givenName: encryptPhi(sanitize(name.given?.[0])),
      familyName: encryptPhi(sanitize(name.family)),
      phone: encryptPhi(sanitize(pickTelecom(resource.telecom, "phone"))),
      email: encryptPhi(sanitize(pickTelecom(resource.telecom, "email"))),
      line1: encryptPhi(sanitize(address.line?.[0])),
      city: encryptPhi(sanitize(address.city)),
      state: encryptPhi(sanitize(address.state)),
      postalCode: encryptPhi(sanitize(address.postalCode))
    }
  };
};

export const patientDocToResource = (doc) => {
  const givenName = decryptPhi(doc.phi?.givenName);
  const familyName = decryptPhi(doc.phi?.familyName);
  const phone = decryptPhi(doc.phi?.phone);
  const email = decryptPhi(doc.phi?.email);
  const line1 = decryptPhi(doc.phi?.line1);
  const city = decryptPhi(doc.phi?.city);
  const state = decryptPhi(doc.phi?.state);
  const postalCode = decryptPhi(doc.phi?.postalCode);

  const telecom = [];
  if (phone) {
    telecom.push({ system: "phone", value: phone, use: "mobile" });
  }
  if (email) {
    telecom.push({ system: "email", value: email, use: "home" });
  }

  const address = [];
  if (line1 || city || state || postalCode) {
    address.push({
      line: line1 ? [line1] : [],
      city,
      state,
      postalCode,
      country: "US"
    });
  }

  const baseIdentifiers = Array.isArray(doc.identifier) ? doc.identifier : [];
  const pidFromIdentifier = baseIdentifiers.find(
    (identifier) => sanitize(identifier?.system) === PID_SYSTEM
  )?.value;
  const pidValue = sanitize(doc.pid) || sanitize(pidFromIdentifier);
  const nonPidIdentifiers = baseIdentifiers.filter(
    (identifier) => sanitize(identifier?.system) !== PID_SYSTEM
  );
  const identifier = pidValue
    ? [{ system: PID_SYSTEM, value: pidValue }, ...nonPidIdentifiers]
    : nonPidIdentifiers;

  return {
    resourceType: "Patient",
    id: String(doc._id),
    meta: {
      versionId: String(doc.__v),
      lastUpdated: doc.updatedAt?.toISOString()
    },
    extension: [
      {
        url: PATIENT_REGISTRATION_STATUS_EXTENSION,
        valueCode: doc.registrationStatus || "active"
      },
      {
        url: PATIENT_REGISTRATION_SOURCE_EXTENSION,
        valueCode: doc.registrationSource || "staff"
      }
    ],
    identifier,
    active: doc.active,
    name: [
      {
        use: "official",
        family: familyName,
        given: givenName ? [givenName] : []
      }
    ],
    telecom,
    gender: doc.gender,
    birthDate: toDateOnly(doc.birthDate),
    address
  };
};

export const observationResourceToDoc = (resource) => {
  if (resource.resourceType !== "Observation") {
    throw new ApiError(400, "Expected an Observation resource");
  }

  const coding = pickCoding(resource.code);

  return {
    status: resource.status || "final",
    code: {
      system: sanitize(coding.system),
      code: sanitize(coding.code),
      display: sanitize(coding.display)
    },
    subject: {
      reference: parsePatientReference(resource.subject?.reference)
    },
    effectiveDateTime: parseDateTime(resource.effectiveDateTime, new Date()),
    issued: parseDateTime(resource.issued, new Date()),
    valueQuantity: resource.valueQuantity
      ? {
          value: Number(resource.valueQuantity.value),
          unit: sanitize(resource.valueQuantity.unit),
          system: sanitize(resource.valueQuantity.system),
          code: sanitize(resource.valueQuantity.code)
        }
      : undefined,
    note: sanitize(resource.note?.[0]?.text)
  };
};

export const observationDocToResource = (doc) => {
  return {
    resourceType: "Observation",
    id: String(doc._id),
    meta: {
      versionId: String(doc.__v),
      lastUpdated: doc.updatedAt?.toISOString()
    },
    status: doc.status,
    code: {
      coding: [codingFromDoc(doc.code)],
      text: doc.code?.display || doc.code?.code
    },
    subject: {
      reference: `Patient/${doc.subject?.reference}`
    },
    effectiveDateTime: toDateTime(doc.effectiveDateTime),
    issued: toDateTime(doc.issued),
    valueQuantity: doc.valueQuantity?.value !== undefined ? doc.valueQuantity : undefined,
    note: doc.note ? [{ text: doc.note }] : undefined
  };
};

export const conditionResourceToDoc = (resource) => {
  if (resource.resourceType !== "Condition") {
    throw new ApiError(400, "Expected a Condition resource");
  }

  const coding = pickCoding(resource.code);
  const reasonStatus = parseStatusCode(resource.clinicalStatus, "active");
  const verificationStatus = parseStatusCode(resource.verificationStatus, "confirmed");

  return {
    clinicalStatus: reasonStatus,
    verificationStatus,
    code: {
      system: sanitize(coding.system),
      code: sanitize(coding.code),
      display: sanitize(coding.display)
    },
    subject: {
      reference: parsePatientReference(resource.subject?.reference)
    },
    onsetDateTime: parseDateTime(resource.onsetDateTime),
    recordedDate: parseDateTime(resource.recordedDate, new Date()),
    note: sanitize(resource.note?.[0]?.text)
  };
};

export const conditionDocToResource = (doc) => {
  return {
    resourceType: "Condition",
    id: String(doc._id),
    meta: {
      versionId: String(doc.__v),
      lastUpdated: doc.updatedAt?.toISOString()
    },
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
          code: doc.clinicalStatus,
          display: doc.clinicalStatus
        }
      ]
    },
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
          code: doc.verificationStatus,
          display: doc.verificationStatus
        }
      ]
    },
    code: {
      coding: [codingFromDoc(doc.code)],
      text: doc.code?.display || doc.code?.code
    },
    subject: {
      reference: `Patient/${doc.subject?.reference}`
    },
    onsetDateTime: toDateTime(doc.onsetDateTime),
    recordedDate: toDateTime(doc.recordedDate),
    note: doc.note ? [{ text: doc.note }] : undefined
  };
};

export const allergyIntoleranceResourceToDoc = (resource) => {
  if (resource.resourceType !== "AllergyIntolerance") {
    throw new ApiError(400, "Expected an AllergyIntolerance resource");
  }

  const coding = pickCoding(resource.code);

  return {
    clinicalStatus: parseStatusCode(resource.clinicalStatus, "active"),
    verificationStatus: parseStatusCode(resource.verificationStatus, "confirmed"),
    type: sanitize(resource.type) || "allergy",
    category: resource.category || [],
    criticality: sanitize(resource.criticality) || "unable-to-assess",
    code: {
      system: sanitize(coding.system),
      code: sanitize(coding.code),
      display: sanitize(coding.display)
    },
    patient: {
      reference: parsePatientReference(resource.patient?.reference, "patient.reference")
    },
    recordedDate: parseDateTime(resource.recordedDate, new Date()),
    reaction: (resource.reaction || []).map((reaction) => ({
      substanceText: sanitize(reaction.substance?.text),
      manifestation: (reaction.manifestation || []).map((item) => sanitize(item.text)).filter(Boolean),
      severity: sanitize(reaction.severity),
      description: sanitize(reaction.description)
    }))
  };
};

export const allergyIntoleranceDocToResource = (doc) => {
  return {
    resourceType: "AllergyIntolerance",
    id: String(doc._id),
    meta: {
      versionId: String(doc.__v),
      lastUpdated: doc.updatedAt?.toISOString()
    },
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
          code: doc.clinicalStatus,
          display: doc.clinicalStatus
        }
      ]
    },
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
          code: doc.verificationStatus,
          display: doc.verificationStatus
        }
      ]
    },
    type: doc.type,
    category: doc.category,
    criticality: doc.criticality,
    code: {
      coding: [codingFromDoc(doc.code)],
      text: doc.code?.display || doc.code?.code
    },
    patient: {
      reference: `Patient/${doc.patient?.reference}`
    },
    recordedDate: toDateTime(doc.recordedDate),
    reaction: (doc.reaction || []).map((reaction) => ({
      substance: reaction.substanceText ? { text: reaction.substanceText } : undefined,
      manifestation: (reaction.manifestation || []).map((text) => ({ text })),
      severity: reaction.severity,
      description: reaction.description
    }))
  };
};

export const medicationRequestResourceToDoc = (resource) => {
  if (resource.resourceType !== "MedicationRequest") {
    throw new ApiError(400, "Expected a MedicationRequest resource");
  }

  const medicationCoding = pickCoding(resource.medicationCodeableConcept);
  const reasonCoding = pickCoding(resource.reasonCode?.[0]);
  const reasonText = sanitize(resource.reasonCode?.[0]?.text);
  const quantity = resource.dispenseRequest?.quantity;

  return {
    status: sanitize(resource.status) || "active",
    intent: sanitize(resource.intent) || "order",
    medication: {
      system: sanitize(medicationCoding.system),
      code: sanitize(medicationCoding.code),
      display: sanitize(medicationCoding.display)
    },
    subject: {
      reference: parsePatientReference(resource.subject?.reference)
    },
    authoredOn: parseDateTime(resource.authoredOn, new Date()),
    dosageInstruction: sanitize(resource.dosageInstruction?.[0]?.text),
    reasonCode: {
      system: sanitize(reasonCoding.system),
      code: sanitize(reasonCoding.code),
      display: sanitize(reasonCoding.display || reasonText)
    },
    dispenseRequest: {
      numberOfRepeatsAllowed:
        resource.dispenseRequest?.numberOfRepeatsAllowed !== undefined
          ? Number(resource.dispenseRequest.numberOfRepeatsAllowed)
          : undefined,
      quantityValue: quantity?.value !== undefined ? Number(quantity.value) : undefined,
      quantityUnit: sanitize(quantity?.unit)
    },
    note: sanitize(resource.note?.[0]?.text)
  };
};

export const medicationRequestDocToResource = (doc) => {
  const reasonCoding = doc.reasonCode?.code ? [codingFromDoc(doc.reasonCode)] : [];
  const reasonText = sanitize(doc.reasonCode?.display || doc.reasonCode?.code);

  return {
    resourceType: "MedicationRequest",
    id: String(doc._id),
    meta: {
      versionId: String(doc.__v),
      lastUpdated: doc.updatedAt?.toISOString()
    },
    status: doc.status,
    intent: doc.intent,
    medicationCodeableConcept: {
      coding: [codingFromDoc(doc.medication)],
      text: doc.medication?.display || doc.medication?.code
    },
    subject: {
      reference: `Patient/${doc.subject?.reference}`
    },
    authoredOn: toDateTime(doc.authoredOn),
    dosageInstruction: doc.dosageInstruction ? [{ text: doc.dosageInstruction }] : undefined,
    reasonCode:
      reasonCoding.length > 0 || reasonText
        ? [
            {
              coding: reasonCoding.length > 0 ? reasonCoding : undefined,
              text: reasonText || undefined
            }
          ]
        : undefined,
    dispenseRequest:
      doc.dispenseRequest?.numberOfRepeatsAllowed !== undefined ||
      doc.dispenseRequest?.quantityValue !== undefined
        ? {
            numberOfRepeatsAllowed: doc.dispenseRequest.numberOfRepeatsAllowed,
            quantity:
              doc.dispenseRequest.quantityValue !== undefined
                ? {
                    value: doc.dispenseRequest.quantityValue,
                    unit: doc.dispenseRequest.quantityUnit
                  }
                : undefined
          }
        : undefined,
    note: doc.note ? [{ text: doc.note }] : undefined
  };
};

// FHIR Encounter.participant.type uses the v3 ParticipationType code system.
const PARTICIPATION_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ParticipationType";
const PARTICIPATION_TYPE_BY_TEXT = {
  "primary performer": { code: "PPRF", display: "primary performer" },
  "secondary performer": { code: "SPRF", display: "secondary performer" },
  attender: { code: "ATND", display: "attender" }
};

const practitionerIdFromReference = (reference) => {
  const match = /^Practitioner\/([a-fA-F0-9]{24})$/.exec(String(reference || ""));
  return match ? match[1] : undefined;
};

export const encounterResourceToDoc = (resource) => {
  if (resource.resourceType !== "Encounter") {
    throw new ApiError(400, "Expected an Encounter resource");
  }

  const typeCoding = pickCoding(resource.type?.[0]);
  const reasonCoding = pickCoding(resource.reasonCode?.[0]);
  const reasonText = sanitize(resource.reasonCode?.[0]?.text);

  return {
    status: sanitize(resource.status) || "in-progress",
    classCode: sanitize(resource.class?.code) || "AMB",
    type: {
      system: sanitize(typeCoding.system),
      code: sanitize(typeCoding.code),
      display: sanitize(typeCoding.display)
    },
    subject: {
      reference: parsePatientReference(resource.subject?.reference)
    },
    periodStart: parseDateTime(resource.period?.start, new Date()),
    periodEnd: parseDateTime(resource.period?.end),
    reasonCode: {
      system: sanitize(reasonCoding.system),
      code: sanitize(reasonCoding.code),
      display: sanitize(reasonCoding.display || reasonText)
    },
    location: sanitize(resource.location?.[0]?.location?.display),
    serviceProvider: sanitize(resource.serviceProvider?.display),
    participant: (resource.participant || []).map((participant) => ({
      type: sanitize(participant.type?.[0]?.text || participant.type?.[0]?.coding?.[0]?.display),
      individualDisplay: sanitize(participant.individual?.display),
      individualUserId: practitionerIdFromReference(participant.individual?.reference)
    })),
    note: sanitize(resource.note?.[0]?.text)
  };
};

export const encounterDocToResource = (doc) => {
  const reasonCoding = doc.reasonCode?.code ? [codingFromDoc(doc.reasonCode)] : [];
  const reasonText = sanitize(doc.reasonCode?.display || doc.reasonCode?.code);

  return {
    resourceType: "Encounter",
    id: String(doc._id),
    meta: {
      versionId: String(doc.__v),
      lastUpdated: doc.updatedAt?.toISOString()
    },
    status: doc.status,
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: doc.classCode,
      display: doc.classCode
    },
    type: doc.type?.code
      ? [
          {
            coding: [codingFromDoc(doc.type)],
            text: doc.type?.display || doc.type?.code
          }
        ]
      : undefined,
    subject: {
      reference: `Patient/${doc.subject?.reference}`
    },
    appointment: doc.appointment?.reference
      ? [{ reference: `Appointment/${doc.appointment.reference}` }]
      : undefined,
    period: {
      start: toDateTime(doc.periodStart),
      end: toDateTime(doc.periodEnd)
    },
    reasonCode:
      reasonCoding.length > 0 || reasonText
        ? [
            {
              coding: reasonCoding.length > 0 ? reasonCoding : undefined,
              text: reasonText || undefined
            }
          ]
        : undefined,
    location: doc.location ? [{ location: { display: doc.location } }] : undefined,
    serviceProvider: doc.serviceProvider ? { display: doc.serviceProvider } : undefined,
    participant: (doc.participant || []).map((participant) => {
      const coded = PARTICIPATION_TYPE_BY_TEXT[participant.type];
      const individual = {};
      if (participant.individualUserId) {
        individual.reference = `Practitioner/${participant.individualUserId}`;
      }
      if (participant.individualDisplay) {
        individual.display = participant.individualDisplay;
      }
      return {
        type: participant.type
          ? [
              {
                coding: coded ? [{ system: PARTICIPATION_TYPE_SYSTEM, ...coded }] : undefined,
                text: participant.type
              }
            ]
          : undefined,
        individual: Object.keys(individual).length > 0 ? individual : undefined
      };
    }),
    note: doc.note ? [{ text: doc.note }] : undefined
  };
};

export const appointmentResourceToDoc = (resource) => {
  if (resource.resourceType !== "Appointment") {
    throw new ApiError(400, "Expected an Appointment resource");
  }

  const patientParticipant = resource.participant.find((participant) =>
    String(participant.actor?.reference || "").startsWith("Patient/")
  );
  const practitionerParticipant = resource.participant.find((participant) => {
    return String(participant.actor?.reference || "").startsWith("Practitioner/");
  });
  const serviceCategory = resource.serviceCategory?.[0];

  return {
    status: sanitize(resource.status) || "booked",
    description: sanitize(resource.description),
    serviceCategory: sanitize(serviceCategory?.text || pickCoding(serviceCategory)?.display),
    start: parseDateTime(resource.start, new Date()),
    end: parseDateTime(resource.end, new Date()),
    minutesDuration:
      resource.minutesDuration !== undefined ? Number(resource.minutesDuration) : undefined,
    patient: {
      reference: parsePatientReference(patientParticipant?.actor?.reference, "participant.actor.reference")
    },
    practitionerUserId: parseReference(
      practitionerParticipant?.actor?.reference,
      "Practitioner",
      "participant.actor.reference"
    ),
    practitionerName: sanitize(
      practitionerParticipant?.actor?.display ||
        practitionerParticipant?.actor?.reference
    ),
    reason: sanitize(resource.reasonCode?.[0]?.text || pickCoding(resource.reasonCode?.[0])?.display),
    comment: sanitize(resource.comment)
  };
};

export const appointmentDocToResource = (doc) => {
  const participant = [
    {
      actor: {
        reference: `Patient/${doc.patient?.reference}`,
        display: doc.patientName || undefined
      },
      status: "accepted"
    }
  ];

  if (doc.practitionerName || doc.practitionerUserId) {
    participant.push({
      actor: {
        reference: doc.practitionerUserId ? `Practitioner/${doc.practitionerUserId}` : undefined,
        display: doc.practitionerName
      },
      status: "accepted"
    });
  }

  return {
    resourceType: "Appointment",
    id: String(doc._id),
    meta: {
      versionId: String(doc.__v),
      lastUpdated: doc.updatedAt?.toISOString()
    },
    extension: [
      {
        url: APPOINTMENT_REQUESTED_BY_PATIENT_EXTENSION,
        valueBoolean: Boolean(doc.requestedByPatient)
      }
    ],
    status: doc.status,
    description: doc.description,
    serviceCategory: doc.serviceCategory ? [{ text: doc.serviceCategory }] : undefined,
    start: toDateTime(doc.start),
    end: toDateTime(doc.end),
    minutesDuration: doc.minutesDuration,
    participant,
    reasonCode: doc.reason ? [{ text: doc.reason }] : undefined,
    comment: doc.comment
  };
};

export const taskResourceToDoc = (resource) => {
  if (resource.resourceType !== "Task") {
    throw new ApiError(400, "Expected a Task resource");
  }

  const coding = pickCoding(resource.code);
  const ownerReference = sanitize(resource.owner?.reference);

  return {
    status: sanitize(resource.status) || "requested",
    intent: sanitize(resource.intent) || "order",
    priority: sanitize(resource.priority) || "routine",
    codeText: sanitize(resource.code?.text || coding?.display || coding?.code),
    description: sanitize(resource.description),
    for: {
      reference: parsePatientReference(resource.for?.reference, "for.reference")
    },
    ownerUserId: ownerReference
      ? parseReference(ownerReference, "Practitioner", "owner.reference")
      : undefined,
    ownerName: sanitize(resource.owner?.display),
    authoredOn: parseDateTime(resource.authoredOn, new Date()),
    dueDate: parseDateTime(resource.executionPeriod?.end),
    note: sanitize(resource.note?.[0]?.text)
  };
};

export const taskDocToResource = (doc) => {
  return {
    resourceType: "Task",
    id: String(doc._id),
    meta: {
      versionId: String(doc.__v),
      lastUpdated: doc.updatedAt?.toISOString()
    },
    status: doc.status,
    intent: doc.intent,
    priority: doc.priority,
    code: doc.codeText ? { text: doc.codeText } : undefined,
    description: doc.description,
    for: {
      reference: `Patient/${doc.for?.reference}`
    },
    owner:
      doc.ownerUserId || doc.ownerName
        ? {
            reference: doc.ownerUserId ? `Practitioner/${doc.ownerUserId}` : undefined,
            display: doc.ownerName
          }
        : undefined,
    authoredOn: toDateTime(doc.authoredOn),
    executionPeriod: doc.dueDate ? { end: toDateTime(doc.dueDate) } : undefined,
    note: doc.note ? [{ text: doc.note }] : undefined
  };
};

export const toSearchsetBundle = ({
  resourceType,
  resources,
  baseUrl,
  total,
  searchId,
  selfUrl
}) => {
  return {
    resourceType: "Bundle",
    id: searchId || undefined,
    type: "searchset",
    timestamp: new Date().toISOString(),
    total,
    link: selfUrl ? [{ relation: "self", url: selfUrl }] : undefined,
    entry: resources.map((resource) => ({
      fullUrl: `${baseUrl}/${resourceType}/${resource.id}`,
      resource,
      search: { mode: "match" }
    }))
  };
};

// Maps an HTTP status to an OperationOutcome issue type so that FHIR error
// responses are themselves valid FHIR resources, as required by the R4 REST spec.
const ISSUE_CODE_BY_STATUS = {
  400: "invalid",
  401: "login",
  403: "forbidden",
  404: "not-found",
  405: "not-supported",
  409: "conflict",
  415: "not-supported",
  422: "processing",
  429: "throttled",
  500: "exception"
};

export const toOperationOutcome = (statusCode, issues = []) => {
  const fallbackCode = ISSUE_CODE_BY_STATUS[statusCode] || "processing";
  const defaultSeverity = statusCode >= 500 ? "fatal" : "error";
  const list = issues.length > 0 ? issues : [{ diagnostics: "Unexpected error" }];

  return {
    resourceType: "OperationOutcome",
    issue: list.map((issue) => ({
      severity: issue.severity || defaultSeverity,
      code: issue.code || fallbackCode,
      ...(issue.diagnostics ? { diagnostics: issue.diagnostics } : {}),
      ...(issue.expression ? { expression: issue.expression } : {})
    }))
  };
};
