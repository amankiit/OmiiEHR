import mongoose from "mongoose";

const participantSchema = new mongoose.Schema(
  {
    type: String,
    individualDisplay: String,
    individualUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  { _id: false }
);

const encounterSchema = new mongoose.Schema(
  {
    resourceType: {
      type: String,
      default: "Encounter"
    },
    status: {
      type: String,
      enum: [
        "planned",
        "arrived",
        "triaged",
        "in-progress",
        "onleave",
        "finished",
        "cancelled",
        "entered-in-error",
        "unknown"
      ],
      default: "in-progress"
    },
    classCode: {
      type: String,
      default: "AMB"
    },
    type: {
      system: String,
      code: String,
      display: String
    },
    subject: {
      reference: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Patient",
        required: true
      }
    },
    appointment: {
      reference: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Appointment"
      }
    },
    periodStart: Date,
    periodEnd: Date,
    reasonCode: {
      system: String,
      code: String,
      display: String
    },
    location: String,
    serviceProvider: String,
    participant: [participantSchema],
    note: String
  },
  {
    timestamps: true
  }
);

encounterSchema.index({ "subject.reference": 1, createdAt: -1 });
encounterSchema.index({ "appointment.reference": 1 });
encounterSchema.index({ periodStart: -1 });

const Encounter = mongoose.model("Encounter", encounterSchema);

export default Encounter;
