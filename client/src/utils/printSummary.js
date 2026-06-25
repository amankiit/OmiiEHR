import {
  patientFullName,
  patientMrn,
  patientPid,
  patientContact,
  patientAddress,
  pickCodingDisplay,
  medicationDisplay,
  observationValue
} from "./fhir.js";
import { calculateAge } from "./display.js";

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const rows = (items, render) =>
  items.length ? items.map(render).join("") : `<tr><td colspan="9" class="muted">None recorded</td></tr>`;

export const printPatientSummary = (patient, chart) => {
  const age = calculateAge(patient.birthDate);
  const contact = patientContact(patient);

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Clinical summary — ${escapeHtml(
    patientFullName(patient)
  )}</title>
  <style>
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #14202b; margin: 32px; }
    h1 { font-size: 20px; margin: 0; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #41525f; margin: 22px 0 6px; border-bottom: 1px solid #dde5ec; padding-bottom: 4px; }
    .meta { color: #41525f; font-size: 13px; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #eef2f6; }
    th { color: #6b7b88; font-size: 11px; text-transform: uppercase; }
    .muted { color: #6b7b88; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #14202b; padding-bottom: 10px; }
    .brand { font-weight: 800; color: #1769b5; }
    @media print { body { margin: 12mm; } }
  </style></head><body>
  <div class="head">
    <div>
      <h1>${escapeHtml(patientFullName(patient))}</h1>
      <p class="meta">${age != null ? `${age}y` : ""} · ${escapeHtml(patient.gender || "")} · DOB ${escapeHtml(
    patient.birthDate || "—"
  )}</p>
      <p class="meta">MRN ${escapeHtml(patientMrn(patient))} · PID ${escapeHtml(patientPid(patient))}</p>
      <p class="meta">${escapeHtml(contact.phone)} · ${escapeHtml(contact.email)}</p>
      <p class="meta">${escapeHtml(patientAddress(patient))}</p>
    </div>
    <div style="text-align:right">
      <div class="brand">OmiiEHR</div>
      <p class="meta">Clinical summary<br/>${new Date().toLocaleString()}</p>
    </div>
  </div>

  <h2>Allergies</h2>
  <table><thead><tr><th>Substance</th><th>Criticality</th><th>Reaction</th></tr></thead><tbody>
  ${rows(
    chart.allergies,
    (a) =>
      `<tr><td>${escapeHtml(pickCodingDisplay(a))}</td><td>${escapeHtml(a.criticality || "-")}</td><td>${escapeHtml(
        a.reaction?.[0]?.manifestation?.[0]?.text || a.reaction?.[0]?.description || "-"
      )}</td></tr>`
  )}
  </tbody></table>

  <h2>Problem list</h2>
  <table><thead><tr><th>Condition</th><th>Status</th></tr></thead><tbody>
  ${rows(
    chart.conditions,
    (c) =>
      `<tr><td>${escapeHtml(pickCodingDisplay(c))}</td><td>${escapeHtml(
        c.clinicalStatus?.coding?.[0]?.code || "-"
      )}</td></tr>`
  )}
  </tbody></table>

  <h2>Medications</h2>
  <table><thead><tr><th>Medication</th><th>Status</th><th>Dosage</th></tr></thead><tbody>
  ${rows(
    chart.medications,
    (m) =>
      `<tr><td>${escapeHtml(medicationDisplay(m))}</td><td>${escapeHtml(m.status || "-")}</td><td>${escapeHtml(
        m.dosageInstruction?.[0]?.text || "-"
      )}</td></tr>`
  )}
  </tbody></table>

  <h2>Recent observations</h2>
  <table><thead><tr><th>Date</th><th>Test</th><th>Value</th></tr></thead><tbody>
  ${rows(
    chart.observations.slice(0, 20),
    (o) =>
      `<tr><td>${escapeHtml((o.effectiveDateTime || "").slice(0, 10))}</td><td>${escapeHtml(
        o.code?.coding?.[0]?.display || "-"
      )}</td><td>${escapeHtml(observationValue(o))}</td></tr>`
  )}
  </tbody></table>
  </body></html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
};
