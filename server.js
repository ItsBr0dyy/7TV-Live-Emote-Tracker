import express from "express";
import { WebSocketServer } from "ws";
import WebSocket from "ws";

const app = express();
const PORT = 3000;

// Serve static HTML (index.html, CSS, JS)
app.use(express.static("public"));

// Local memory
let clients = [];
let emoteUsage = {}; // { emoteName: count }
let userUsage = {}; // { username: count }

// Create HTTP + WebSocket server
const server = app.listen(PORT, () =>
  console.log(`💜 Server running at http://localhost:${PORT}`)
);
const wss = new WebSocketServer({ server });

// Broadcast data to all connected clients
function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(message);
  });
}

// Handle client dashboard connections
wss.on("connection", (ws) => {
  clients.push(ws);
  console.log("🟣 New dashboard connected");
  ws.send(JSON.stringify({ type: "init", emoteUsage, userUsage }));

  ws.on("close", () => {
    clients = clients.filter((c) => c !== ws);
  });
});

// 🔹 Connect to StreamElements WebSocket
const seSocket = new WebSocket("wss://realtime.streamelements.com/socket");

// When StreamElements connects
seSocket.on("open", () => {
  console.log("💫 Connected to StreamElements Realtime API");
});

// Handle StreamElements messages
seSocket.on("message", (msg) => {
  try {
    const data = JSON.parse(msg);

    // Welcome event
    if (data.type === "welcome") {
      console.log("✅ Connected to StreamElements Realtime API (Session:", data.payload?.id, ")");
      return;
    }

    // Ping-Pong keepalive
    if (data.type === "ping") {
      seSocket.send(JSON.stringify({ type: "pong" }));
      return;
    }

    // Handle chat messages
    if (data.type === "event" && data.event?.type === "message") {
      const message = data.event.data;
      const username = message.nick || "UnknownUser";
      const emotes = message.emotes || [];

      // Count message as 1 for user
      userUsage[username] = (userUsage[username] || 0) + 1;

      // Count emote usage
      emotes.forEach((em) => {
        const name = em.text || em.name || "unknown";
        emoteUsage[name] = (emoteUsage[name] || 0) + 1;
      });

      // Broadcast updates
      broadcast({
        type: "update",
        userUsage,
        emoteUsage,
      });
    }
  } catch (err) {
    console.error("Error handling StreamElements message:", err);
  }
});

seSocket.on("close", () => {
  console.log("⚠️ Disconnected from StreamElements Realtime API. Reconnecting in 5s...");
  setTimeout(() => reconnectSE(), 5000);
});

seSocket.on("error", (err) => {
  console.error("❌ StreamElements socket error:", err.message);
});

// Auto-reconnect function
function reconnectSE() {
  const newSocket = new WebSocket("wss://realtime.streamelements.com/socket");
  newSocket.on("open", () => {
    console.log("🔄 Reconnected to StreamElements API");
    seSocket = newSocket;
  });
}

// Express API for debugging
app.get("/api/data", (req, res) => {
  res.json({ users: userUsage, emotes: emoteUsage });
});
