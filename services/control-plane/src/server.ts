import { PORT } from "./config.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(PORT, () => {
  console.log(`My Mate control-plane listening on http://localhost:${PORT}`);
});
