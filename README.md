# OmiiEHR
<img width="1470" height="831" alt="Screenshot 2026-02-22 at 4 02 12 PM" src="https://github.com/user-attachments/assets/81b1027a-099c-4339-8eea-722f004b1bc1" />


Electronic Health Record application with FHIR R4-compliant APIs and HIPAA-aligned controls.

Access here:
https://omni-ehr.vercel.app

## 🔐 Demo Login Credentials

### 👨‍💼 Admin Login
**Email:** admin@omnihealth.com  
**Password:** Abcdefgh@998761

---

### 🩺 Practitioner Login
**Email:** drsonal@omnihealth.com  
**Password:** Abcdefgh@998761

## Compliance note

This repository implements major technical safeguards (access control, audit trail, encryption, validation), but HIPAA compliance is not code-only. Real compliance still requires BAAs, policy/process controls, risk assessment, incident response, training, and secure infrastructure operations.

## Stack

- Backend: Node.js, Express, MongoDB (Mongoose), JWT auth
- Frontend: React + Vite
- Standards: FHIR R4 resources (`Patient`, `Observation`, `Condition`, `AllergyIntolerance`, `MedicationRequest`, `Encounter`, `Appointment`, `Task`). Non-standard data is carried as FHIR extensions rather than ad-hoc fields, so emitted resources conform to the R4 structure:
  - `Patient.extension` — `patient-registration-status`, `patient-registration-source`
  - `Appointment.extension` — `appointment-requested-by-patient`
  - (extension base URL: `https://omiiehr.com/fhir/StructureDefinition`)
- Security controls: RBAC, bcrypt, AES-256-GCM field encryption for PHI, audit logs, rate limiting, input validation

## Major EHR features

- User authentication and role-based access (`admin`, `practitioner`, `auditor`)
- Admin-only user provisioning
- Patient registry with encrypted demographics (at-rest encryption for PHI fields)
- Patient self-registration portal (`/patient-register`) with automatic 7-digit PID assignment
- Automatic 7-digit PID assignment for every new patient (portal + admin-created)
- Longitudinal chart view (`Patient/$everything`) including:
  - Problem list (`Condition`)
  - Allergies (`AllergyIntolerance`)
  - Medications (`MedicationRequest`)
  - Encounters (`Encounter`)
  - Clinical observations/vitals (`Observation`)
  - Scheduling (`Appointment`)
- Global scheduler page with date filtering and appointment creation
  - Admins can book across all active practitioners
  - Practitioners can only book their own schedule
  - Fixed booking windows: Monday-Saturday, 09:00 AM-12:00 PM, 15-minute slots
  - Unavailable slots are disabled in slot dropdowns
  - Overlap conflicts block booking for unavailable practitioners
- Clinical command center for risk stratification, care-gap detection, and service-line demand
- Care-team task management (`Task`) with assignment, due dates, and status workflow
- Audit log review for admin/auditor roles

## API reference

All endpoints are served under `/api`. Protected endpoints require an `Authorization: Bearer <JWT>` header (obtained from `POST /api/auth/login`). Roles are `admin`, `practitioner`, and `auditor`.

### Authentication — `/api/auth`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | Public | Exchange email + password for a JWT and user profile. |
| `GET` | `/api/auth/me` | Authenticated | Return the current authenticated user. |

### Public (patient portal) — `/api/public`

No authentication; rate-limited. Returns no PHI except to the registering patient.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/public/patient-register` | Patient self-registration; assigns a 7-digit PID and creates a pending (`requested`) patient. |
| `GET` | `/api/public/practitioners` | List bookable active practitioners (id, name, specialty). |
| `GET` | `/api/public/availability?practitionerId=&date=` | Taken 15-minute slots for a practitioner on a `YYYY-MM-DD` date. |
| `POST` | `/api/public/appointment-request` | Patient-initiated appointment request (created as `proposed` for staff approval). |

### FHIR R4 — `/api/fhir`

Bearer JWT required. Access roles: **read** = `admin`, `practitioner`, `auditor`; **write** = `admin`, `practitioner`; **Patient create** = `admin` only; **Patient edit** = `admin`, `practitioner`. Responses use `application/fhir+json`.

Conformance notes:
- All responses use the FHIR media type `application/fhir+json` (requests in `application/json` or `application/fhir+json` are accepted).
- Errors are returned as `OperationOutcome` resources (with `issue[].severity/code/diagnostics`, and `expression` FHIRPath pointers for validation failures).
- Search responses are `searchset` `Bundle`s with `total` and a `self` `Bundle.link`.

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/fhir/metadata` | read | `CapabilityStatement` (FHIR version 4.0.1). |
| `POST` | `/api/fhir/Patient` | admin | Create patient (auto-assigns PID identifier). |
| `GET` | `/api/fhir/Patient` | read | Search. Params: `identifier`, `name`/`search` (free text). |
| `GET` | `/api/fhir/Patient/:id` | read | Read one patient. |
| `PUT` | `/api/fhir/Patient/:id` | admin, practitioner | Update demographics. |
| `GET` | `/api/fhir/Patient/:id/$everything` | read | Longitudinal record `Bundle` (all linked resources). |
| `POST` | `/api/fhir/Observation` | write | Create observation/vital. |
| `GET` | `/api/fhir/Observation` | read | Search. Params: `subject=Patient/{id}`. |
| `GET` | `/api/fhir/Observation/:id` | read | Read one. |
| `PUT` | `/api/fhir/Observation/:id` | write | Update. |
| `POST` | `/api/fhir/Condition` | write | Create problem-list entry. |
| `GET` | `/api/fhir/Condition` | read | Search. Params: `subject=Patient/{id}`. |
| `GET` | `/api/fhir/Condition/:id` | read | Read one. |
| `PUT` | `/api/fhir/Condition/:id` | write | Update. |
| `POST` | `/api/fhir/AllergyIntolerance` | write | Create allergy. |
| `GET` | `/api/fhir/AllergyIntolerance` | read | Search. Params: `patient=Patient/{id}`. |
| `GET` | `/api/fhir/AllergyIntolerance/:id` | read | Read one. |
| `PUT` | `/api/fhir/AllergyIntolerance/:id` | write | Update. |
| `POST` | `/api/fhir/MedicationRequest` | write | Create medication order. |
| `GET` | `/api/fhir/MedicationRequest` | read | Search. Params: `subject=Patient/{id}`. |
| `GET` | `/api/fhir/MedicationRequest/:id` | read | Read one. |
| `PUT` | `/api/fhir/MedicationRequest/:id` | write | Update. |
| `POST` | `/api/fhir/Encounter` | write | Create encounter. |
| `GET` | `/api/fhir/Encounter` | read | Search. Params: `subject=Patient/{id}`, `appointment=Appointment/{id}`. |
| `GET` | `/api/fhir/Encounter/:id` | read | Read one. |
| `PUT` | `/api/fhir/Encounter/:id` | write | Update. |
| `POST` | `/api/fhir/Appointment` | write | Book appointment (enforces slot/availability rules). |
| `GET` | `/api/fhir/Appointment` | read | Search. Params: `patient=Patient/{id}`, `practitioner=Practitioner/{id}`, `from`, `to`. Practitioners see only their own schedule. |
| `GET` | `/api/fhir/Appointment/:id` | read | Read one. |
| `PUT` | `/api/fhir/Appointment/:id` | write | Update/reschedule (syncs encounter on check-in/fulfilment). |
| `POST` | `/api/fhir/Task` | write | Create care-team task. |
| `GET` | `/api/fhir/Task` | read | Search. Params: `for=Patient/{id}`, `status`, `owner=Practitioner/{id}`. |
| `GET` | `/api/fhir/Task/:id` | read | Read one. |
| `PUT` | `/api/fhir/Task/:id` | write | Update status/assignment. |

### Admin — `/api/admin`

Bearer JWT required.

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/api/admin/users` | admin | List all users. |
| `POST` | `/api/admin/users` | admin | Provision a user (including additional admins). |
| `POST` | `/api/admin/patients/:id/approve` | admin | Approve a portal-registered patient (sets `active`). |
| `GET` | `/api/admin/practitioners` | admin, practitioner | List practitioners (practitioners see only themselves). |
| `GET` | `/api/admin/audit-logs` | admin, auditor | Paginated audit log. Params: `page`, `limit`, `outcome`, `resourceType`, `actorEmail`. |

### System

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Liveness check. |

## HIPAA-aligned controls in code

- Authentication + authorization:
  - JWT bearer tokens
  - RBAC middleware by role
- Access provisioning:
  - Admin endpoint for creating users (including additional admins)
  - Patient creation through FHIR is admin-only
- Encryption:
  - AES-256-GCM for patient PHI fields (name/contact/address)
- Audit controls:
  - Automatic audit events for `/api/fhir/*` and `/api/admin/*`
  - Audit review endpoint with pagination/filter hooks
- Security hardening:
  - `helmet`, CORS control, auth rate limiting, strict Zod validation

## Local setup

### 1) Start MongoDB

```bash
docker compose up -d
```

Or point `MONGODB_URI` to an existing Mongo instance.

### 2) Install dependencies

```bash
npm install
```

### 3) Configure env

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Generate and set `PHI_ENCRYPTION_KEY` (64 hex chars):

```bash
openssl rand -hex 32
```

### 4) Run

```bash
npm run dev
```

- API: `http://localhost:4000`
- UI: `http://localhost:5173`

## Quality checks

```bash
npm run lint
npm run build --workspace client
```

## Real-world hardening still recommended

- Enforce TLS everywhere and use secure secret management/HSM/KMS
- Add MFA, token revocation, and refresh token rotation
- Implement consent directives and break-glass access workflow
- Integrate immutable audit sink/SIEM monitoring
- Add formal test suite (unit, integration, API conformance) and security scanning
