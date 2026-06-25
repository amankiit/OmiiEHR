import mongoose from "mongoose";

const encryptedFieldSchema = new mongoose.Schema(
  {
    iv: { type: String, default: "" },
    authTag: { type: String, default: "" },
    content: { type: String, default: "" }
  },
  { _id: false }
);

const patientSchema = new mongoose.Schema(
  {
    resourceType: {
      type: String,
      default: "Patient"
    },
    pid: {
      type: String,
      trim: true
    },
    identifier: [
      {
        system: String,
        value: String
      }
    ],
    active: {
      type: Boolean,
      default: true
    },
    registrationStatus: {
      type: String,
      enum: ["requested", "active"],
      default: "active"
    },
    registrationSource: {
      type: String,
      enum: ["staff", "portal"],
      default: "staff"
    },
    gender: {
      type: String,
      enum: ["male", "female", "other", "unknown"],
      default: "unknown"
    },
    birthDate: Date,
    phi: {
      givenName: encryptedFieldSchema,
      familyName: encryptedFieldSchema,
      phone: encryptedFieldSchema,
      email: encryptedFieldSchema,
      line1: encryptedFieldSchema,
      city: encryptedFieldSchema,
      state: encryptedFieldSchema,
      postalCode: encryptedFieldSchema
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  { timestamps: true }
);

patientSchema.index({ "identifier.value": 1 });
patientSchema.index({ pid: 1 }, { unique: true, sparse: true });
patientSchema.index({ createdAt: -1 });

const Patient = mongoose.model("Patient", patientSchema);

export default Patient;
