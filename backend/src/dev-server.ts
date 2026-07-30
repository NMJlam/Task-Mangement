import app from "./app.js";
import { PORT } from "./env.js";

// Local dev only. On Vercel the app is imported by api/index.ts and never
// listens. `npm run dev:backend` runs this.
app.listen(PORT, () => {
  console.log(`🚀 backend listening on http://localhost:${PORT}`);
});
