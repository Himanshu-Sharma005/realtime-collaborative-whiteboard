import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    // broadcast to everyone else
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === 1) {
        client.send(msg.toString());
      }
    });
  });
});

console.log("WebSocket server running on ws://localhost:8080");
