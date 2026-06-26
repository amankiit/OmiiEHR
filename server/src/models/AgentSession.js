import mongoose from "mongoose";

// Persisted assistant conversation. Stored so a paused turn (awaiting human approval
// of a write) can be resumed on a later request, and so agent activity is traceable.
// The caller's JWT is never persisted — it is supplied per request at runtime.
const agentSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "awaiting_confirmation"],
      default: "active"
    },
    context: { type: mongoose.Schema.Types.Mixed },
    messages: { type: [mongoose.Schema.Types.Mixed], default: [] },
    pendingWrites: { type: [mongoose.Schema.Types.Mixed], default: [] },
    pendingToolResults: { type: [mongoose.Schema.Types.Mixed], default: [] }
  },
  { timestamps: true }
);

export default mongoose.model("AgentSession", agentSessionSchema);
