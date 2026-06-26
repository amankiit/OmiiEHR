import dotenv from "dotenv";

dotenv.config();

const required = [
  "NODE_ENV",
  "PORT",
  "MONGODB_URI",
  "JWT_SECRET",
  "JWT_EXPIRES_IN",
  "PHI_ENCRYPTION_KEY"
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const env = {
  nodeEnv: process.env.NODE_ENV,
  port: Number(process.env.PORT),
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN,
  phiEncryptionKey: process.env.PHI_ENCRYPTION_KEY,
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",

  // Agentic AI (Groq via its OpenAI-compatible API). Optional: when GROQ_API_KEY is
  // unset the assistant endpoints return 503 and the rest of the app runs unchanged.
  agentEnabled: Boolean(process.env.GROQ_API_KEY),
  groqApiKey: process.env.GROQ_API_KEY || "",
  agentModel: process.env.AGENT_MODEL || "llama-3.3-70b-versatile",
  agentBaseUrl: process.env.AGENT_BASE_URL || "https://api.groq.com/openai/v1",
  // The agent's tools call this EHR's own HTTP API so RBAC, validation, audit and
  // PHI encryption all run exactly as for a normal request.
  internalApiBaseUrl:
    process.env.INTERNAL_API_BASE_URL || `http://127.0.0.1:${Number(process.env.PORT)}`
};

export default env;
