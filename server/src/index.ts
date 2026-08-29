import "dotenv/config";
import http from "node:http";
import { createApp } from "./app.js";
import { attachWebSocketServer } from "./ws/index.js";

const port = Number(process.env.PORT ?? 4000);
const app = createApp();
const server = http.createServer(app);
attachWebSocketServer(server);

server.listen(port, () => {
  console.log(`SyncSpace server listening on :${port}`);
});
