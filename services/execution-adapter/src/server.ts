import { createApp } from "./app.js";
import { PORT } from "./config.js";
import { resumeBackgroundWork } from "./bridge-runtime.js";

const app = createApp();

resumeBackgroundWork();

app.listen(PORT, () => {
  console.log(`[execution-adapter] listening on http://127.0.0.1:${PORT}`);
});
