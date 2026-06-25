// Curated clinical catalogs so clinicians pick from a list instead of typing raw
// SNOMED / LOINC / RxNorm codes. Manual entry stays available as an "advanced" path.

export const CONDITION_CATALOG = [
  { code: "44054006", display: "Type 2 diabetes mellitus" },
  { code: "38341003", display: "Essential hypertension" },
  { code: "195967001", display: "Asthma" },
  { code: "13645005", display: "Chronic obstructive pulmonary disease" },
  { code: "84114007", display: "Heart failure" },
  { code: "53741008", display: "Coronary artery disease" },
  { code: "49436004", display: "Atrial fibrillation" },
  { code: "431855005", display: "Chronic kidney disease stage 1" },
  { code: "370143000", display: "Major depressive disorder" },
  { code: "48694002", display: "Anxiety disorder" },
  { code: "414916001", display: "Obesity" },
  { code: "55822004", display: "Hyperlipidemia" },
  { code: "396275006", display: "Osteoarthritis" },
  { code: "235595009", display: "Gastroesophageal reflux disease" },
  { code: "73211009", display: "Diabetes mellitus" },
  { code: "195662009", display: "Acute upper respiratory infection" }
];

export const MEDICATION_CATALOG = [
  { code: "860975", display: "Metformin 500 MG Oral Tablet" },
  { code: "314076", display: "Lisinopril 10 MG Oral Tablet" },
  { code: "197361", display: "Amlodipine 5 MG Oral Tablet" },
  { code: "617314", display: "Atorvastatin 20 MG Oral Tablet" },
  { code: "311036", display: "Metoprolol tartrate 50 MG Oral Tablet" },
  { code: "979492", display: "Hydrochlorothiazide 25 MG Oral Tablet" },
  { code: "849574", display: "Omeprazole 20 MG Oral Capsule" },
  { code: "311033", display: "Levothyroxine 50 MCG Oral Tablet" },
  { code: "856917", display: "Albuterol 90 MCG/Actuation Inhaler" },
  { code: "310965", display: "Ibuprofen 200 MG Oral Tablet" },
  { code: "1049221", display: "Acetaminophen 325 MG Oral Tablet" },
  { code: "308136", display: "Amoxicillin 500 MG Oral Capsule" },
  { code: "855332", display: "Warfarin 5 MG Oral Tablet" },
  { code: "1364430", display: "Apixaban 5 MG Oral Tablet" },
  { code: "310798", display: "Gabapentin 300 MG Oral Capsule" },
  { code: "312961", display: "Sertraline 50 MG Oral Tablet" }
];

export const ALLERGEN_CATALOG = [
  { code: "7980", display: "Penicillin", category: "medication" },
  { code: "91936005", display: "Sulfonamide", category: "medication" },
  { code: "387207008", display: "Aspirin", category: "medication" },
  { code: "227493005", display: "Cashew nuts", category: "food" },
  { code: "256349002", display: "Peanut", category: "food" },
  { code: "102263004", display: "Eggs", category: "food" },
  { code: "3718001", display: "Cow's milk", category: "food" },
  { code: "44027008", display: "Shellfish", category: "food" },
  { code: "256277009", display: "Grass pollen", category: "environment" },
  { code: "111088007", display: "Latex", category: "environment" },
  { code: "418689008", display: "Bee venom", category: "biologic" }
];

export const ALLERGY_REACTIONS = [
  "Hives",
  "Anaphylaxis",
  "Rash",
  "Angioedema",
  "Nausea / vomiting",
  "Difficulty breathing",
  "Itching",
  "Swelling"
];

// LOINC-coded observations with units + reference ranges for abnormal flagging.
export const OBSERVATION_CATALOG = [
  { code: "8480-6", display: "Systolic blood pressure", unit: "mmHg", low: 90, high: 130, vital: true },
  { code: "8462-4", display: "Diastolic blood pressure", unit: "mmHg", low: 60, high: 85, vital: true },
  { code: "8867-4", display: "Heart rate", unit: "bpm", low: 60, high: 100, vital: true },
  { code: "8310-5", display: "Body temperature", unit: "°C", low: 36.1, high: 37.5, vital: true },
  { code: "9279-1", display: "Respiratory rate", unit: "/min", low: 12, high: 20, vital: true },
  { code: "59408-5", display: "Oxygen saturation", unit: "%", low: 94, high: 100, vital: true },
  { code: "29463-7", display: "Body weight", unit: "kg", low: null, high: null, vital: true },
  { code: "39156-5", display: "Body mass index", unit: "kg/m²", low: 18.5, high: 25 },
  { code: "4548-4", display: "Hemoglobin A1c", unit: "%", low: 4, high: 5.7 },
  { code: "2339-0", display: "Glucose", unit: "mg/dL", low: 70, high: 99 },
  { code: "2093-3", display: "Total cholesterol", unit: "mg/dL", low: null, high: 200 },
  { code: "2085-9", display: "HDL cholesterol", unit: "mg/dL", low: 40, high: null },
  { code: "2089-1", display: "LDL cholesterol", unit: "mg/dL", low: null, high: 100 },
  { code: "2160-0", display: "Creatinine", unit: "mg/dL", low: 0.6, high: 1.3 },
  { code: "718-7", display: "Hemoglobin", unit: "g/dL", low: 12, high: 17 }
];

export const VITALS = OBSERVATION_CATALOG.filter((item) => item.vital);

const byCode = (catalog) => {
  const map = new Map();
  catalog.forEach((item) => map.set(item.code, item));
  return map;
};

export const OBSERVATION_BY_CODE = byCode(OBSERVATION_CATALOG);

export const findObservationMeta = (code) => OBSERVATION_BY_CODE.get(String(code || "")) || null;

// Returns { flag: 'H'|'L'|'N'|null, label } based on reference range.
export const flagObservation = (code, value) => {
  const meta = findObservationMeta(code);
  const numeric = Number(value);
  if (!meta || !Number.isFinite(numeric)) {
    return { flag: null, label: "" };
  }

  if (meta.high !== null && meta.high !== undefined && numeric > meta.high) {
    return { flag: "H", label: "High" };
  }
  if (meta.low !== null && meta.low !== undefined && numeric < meta.low) {
    return { flag: "L", label: "Low" };
  }
  if (meta.low === null && meta.low === undefined && meta.high === null && meta.high === undefined) {
    return { flag: null, label: "" };
  }
  return { flag: "N", label: "Normal" };
};

export const referenceRangeText = (code) => {
  const meta = findObservationMeta(code);
  if (!meta) {
    return "";
  }
  if (meta.low != null && meta.high != null) {
    return `${meta.low}–${meta.high} ${meta.unit}`;
  }
  if (meta.high != null) {
    return `< ${meta.high} ${meta.unit}`;
  }
  if (meta.low != null) {
    return `> ${meta.low} ${meta.unit}`;
  }
  return "";
};

export const SERVICE_CATEGORY_OPTIONS = [
  "Outpatient",
  "Follow-up",
  "Primary Care",
  "Preventive Care",
  "Annual Wellness Visit",
  "Chronic Disease Management",
  "Medication Review",
  "Post-Discharge Follow-up",
  "Urgent Care",
  "Behavioral Health",
  "Telehealth Visit",
  "Immunization"
];

export const ENCOUNTER_TYPES = [
  { code: "185349003", display: "Outpatient visit", classCode: "AMB" },
  { code: "270427003", display: "Follow-up visit", classCode: "AMB" },
  { code: "50849002", display: "Emergency room visit", classCode: "EMER" },
  { code: "32485007", display: "Hospital admission", classCode: "IMP" },
  { code: "390906007", display: "Telehealth consultation", classCode: "VR" },
  { code: "11429006", display: "Consultation", classCode: "AMB" }
];

// Practitioner specialties (FHIR PractitionerRole-style classification). `plural`
// is used for filter labels ("All practitioners", "Physicians", …).
export const PRACTITIONER_ROLES = [
  { value: "physician", label: "Physician", plural: "Physicians" },
  { value: "dentist", label: "Dentist", plural: "Dentists" },
  { value: "clinician", label: "Clinician", plural: "Clinicians" },
  { value: "nurse", label: "Nurse", plural: "Nurses" },
  { value: "surgeon", label: "Surgeon", plural: "Surgeons" },
  { value: "pharmacist", label: "Pharmacist", plural: "Pharmacists" },
  { value: "technician", label: "Technician", plural: "Technicians" },
  { value: "therapist", label: "Therapist", plural: "Therapists" },
  { value: "nutritionist", label: "Nutritionist", plural: "Nutritionists" }
];

export const PRACTITIONER_ROLE_LABELS = PRACTITIONER_ROLES.reduce((map, role) => {
  map[role.value] = role.label;
  return map;
}, {});

export const TASK_CATEGORY_OPTIONS = [
  "Care coordination",
  "Medication reconciliation",
  "Lab follow-up",
  "Preventive screening",
  "Discharge outreach",
  "Referral management"
];
