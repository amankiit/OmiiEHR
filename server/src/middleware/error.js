import { ZodError } from "zod";
import { toOperationOutcome } from "../services/fhirMapper.js";

// FHIR routes must return errors as OperationOutcome resources with the FHIR media
// type. Non-FHIR routes (auth/admin/public) keep the existing app error shape.
const isFhirRequest = (req) => String(req.originalUrl || "").startsWith("/api/fhir");

const sendFhirError = (res, statusCode, issues) =>
  res
    .status(statusCode)
    .type("application/fhir+json")
    .json(toOperationOutcome(statusCode, issues));

export const notFoundHandler = (req, res) => {
  if (isFhirRequest(req)) {
    return sendFhirError(res, 404, [
      { code: "not-found", diagnostics: "Resource or route not found" }
    ]);
  }

  res.status(404).json({ message: "Route not found" });
};

export const errorHandler = (error, req, res, _next) => {
  const fhir = isFhirRequest(req);

  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({
      code: "invalid",
      diagnostics: issue.message,
      expression: issue.path.length ? [issue.path.join(".")] : undefined
    }));

    if (fhir) {
      return sendFhirError(res, 400, issues);
    }

    return res.status(400).json({
      message: "Validation error",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }

  if (error?.name === "CastError") {
    if (fhir) {
      return sendFhirError(res, 400, [
        { code: "value", diagnostics: "Invalid resource identifier" }
      ]);
    }

    return res.status(400).json({ message: "Invalid resource identifier" });
  }

  const statusCode = error.statusCode || 500;
  const message = statusCode === 500 ? "Internal server error" : error.message;

  if (fhir) {
    return sendFhirError(res, statusCode, [{ diagnostics: message }]);
  }

  return res.status(statusCode).json({ message });
};
