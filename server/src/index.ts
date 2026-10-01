import "dotenv/config";
import { createApp } from "./app.js";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.startsWith("change-me")) {
  console.warn("⚠  JWT_SECRET is not set to a real secret in server/.env — fine for local use, not for deployment.");
}

const port = Number(process.env.PORT) || 4000;
createApp().listen(port, () => {
  console.log(`FridgeTrack API on http://localhost:${port}`);
  console.log(process.env.ANTHROPIC_API_KEY ? "AI health reports: enabled" : "AI health reports: disabled (set ANTHROPIC_API_KEY to enable)");
});
