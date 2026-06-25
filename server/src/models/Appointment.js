import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema(
  {
    resourceType: {
      type: String,
      default: "Appointment"
    },
    status: {
      type: String,
      enum: [
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
      ],
      default: "booked"
    },
    description: String,
    serviceCategory: String,
    start: {
      type: Date,
      required: true
    },
    end: {
      type: Date,
      required: true
    },
    minutesDuration: Number,
    patient: {
      reference: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Patient",
        required: true
      }
    },
    patientName: String,
    requestedByPatient: {
      type: Boolean,
      default: false
    },
    practitionerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    practitionerName: String,
    reason: String,
    comment: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  {
    timestamps: true
  }
);

appointmentSchema.index({ "patient.reference": 1, start: -1 });
appointmentSchema.index({ practitionerUserId: 1, start: 1, end: 1 });
appointmentSchema.index({ start: 1 });

const Appointment = mongoose.model("Appointment", appointmentSchema);

export default Appointment;
