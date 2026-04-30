import { createServer } from "node:http";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const app = createApp();

createServer(app).listen(port, host, () => {
  console.log(`Codex Manager API listening on http://${host}:${port}`);
});
