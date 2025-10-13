import express from "express";
import fetch from "node-fetch";
import tmi from "tmi.js";
import { WebSocketServer } from "ws";
import fs from "fs";

const app = express();
const PORT = 3000;
const DATA_FILE = "./data.json";

let allTimeData = {};
if (fs.existsSync(DATA_FILE)) {
  try {
    allTimeData = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    allTimeData = {};
  }
} else {
  fs.writeFileSync(DATA_FILE, "{}");
}

const activeChannels = {}; // { channel: { emotes, users, client } }

app.use(express.static("public"));

// Save leaderboard data every minute
setInterval(() => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(allTimeData, null, 2));
}, 60000);

// Fetch 7TV emotes for a channel
async function get7TVEmotes(channel) {
  try {
    const res = await fetch(`https://7tv.io/v3/users/twitch/${channel}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (
      data.emote_set?.emotes?.map((e) => ({
        name: e.name,
        id: e.id,
      })) || []
    );
  } catch {
    return [];
  }
}

// Get Twitch/7TV user info
async function getTwitchUser(username) {
  try {
    const res = await fetch(`https://7tv.io/v3/users/twitch/${username}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      id: data.id || username,
      avatar: data.avatar_url || null,
      paint: data.style?.paint || null,
    };
  } catch {
    return null;
  }
}

// Start tracking a Twitch channel
async function startTracking(channel) {
  if (activeChannels[channel]) return activeChannels[channel];
  console.log(`🟣 Tracking started for #${channel}`);

  const emotes = await get7TVEmotes(channel);
  const users = allTimeData[channel] || {};

  const client = new tmi.Client({
    connection: { reconnect: true },
    channels: [channel],
  });

  client.connect();

  client.on("message", async (ch, tags, msg, self) => {
    if (self) return;

    const username = tags["display-name"] || tags.username;
    if (!users[username]) {
      const info = await getTwitchUser(username);
      users[username] = {
        username,
        id: info?.id || username,
        avatar:
          info?.avatar ||
          "https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png",
        paint: info?.paint || null,
        count: 0,
        emoteUsage: {},
      };
    }

    const words = msg.split(/\s+/);
    const used = emotes.filter((e) => words.includes(e.name));
    if (used.length > 0) {
      for (const e of used) {
        users[username].count++;
        users[username].emoteUsage[e.name] =
          (users[username].emoteUsage[e.name] || 0) + 1;
      }
      allTimeData[channel] = users;
      broadcast(channel, { type: "update", user: users[username] });
    }
  });

  activeChannels[channel] = { emotes, users, client };
  allTimeData[channel] = users;
  return activeChannels[channel];
}

// WebSocket setup
const wss = new WebSocketServer({ noServer: true });
const sockets = new Set();

function broadcast(channel, data) {
  const msg = JSON.stringify({ channel, ...data });
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

const server = app.listen(PORT, () =>
  console.log(`✅ Running at http://localhost:${PORT}`)
);

server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
  });
});

// API routes
app.get("/api/start/:channel", async (req, res) => {
  const channel = req.params.channel.toLowerCase();
  await startTracking(channel);
  res.json({ success: true });
});

app.get("/api/leaderboard/:channel", async (req, res) => {
  const channel = req.params.channel.toLowerCase();
  res.json(Object.values(allTimeData[channel] || {}));
});
