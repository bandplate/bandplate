import { defineConfig } from "drizzle-kit";

// Tooling config — Node is fine here (drizzle-kit itself is a Node CLI).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/sqlite/index.ts",
  out: "./migrations/sqlite",
});
