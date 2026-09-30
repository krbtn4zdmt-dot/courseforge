// Loads .env.local into process.env for CLI scripts (Next.js does this for the app).
// Variables already set in the environment win.
import { existsSync } from "node:fs";

export function loadLocalEnv(file = ".env.local"): void {
  if (existsSync(file)) process.loadEnvFile(file);
}
