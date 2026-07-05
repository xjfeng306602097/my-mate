import { readConfig } from "./config.js";
import { createApp } from "./app.js";

const config = readConfig();
const app = createApp(config);

app.listen(config.port, () => {
  console.log(`My Mate API gateway listening on http://localhost:${config.port}`);
});
