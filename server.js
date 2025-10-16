import express from "express";
import fetch from "node-fetch";
import tmi from "tmi.js";
import { WebSocketServer } from "ws";
import path from "path";

const app = express();
const PORT = 3000;
const __dirname = process.cwd();

const activeChannels = {}; // { channel: { emotes:[], users:{}, emoteUsage:{} } }

app.use(express.static("public"));

// 🔹 Get 7TV emotes for a channel
async function get7TVEmotes(channel) {
  try {
    const res = await fetch(`https://7tv.io/v3/users/twitch/${channel}`);
    const data = await res.json();
    return data.emote_set?.emotes?.map(e => ({
      name: e.name,
      id: e.id,
      url: `https://cdn.7tv.app/emote/${e.id}/4x.webp`
    })) || [];
  } catch (e) {
    console.log("7TV fetch failed:", e);
    return [];
  }
}

// 🔹 Get Twitch user info
async function getTwitchUser(username) {
  try {
    const res = await fetch(`https://7tv.io/v3/users/twitch/${username}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      id: data.id,
      avatar: data.avatar_url || "https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png",
      paint: data.style?.paint_id || null
    };
  } catch {
    return null;
  }
}

// 🔹 Connect and track emotes in a channel
async function startTracking(channel) {
  if (activeChannels[channel]) return activeChannels[channel];
  console.log(`Starting tracking for ${channel}`);

  const emotes = await get7TVEmotes(channel);
  const users = {};
  const emoteUsage = {};

  const client = new tmi.Client({
    connection: { reconnect: true },
    channels: [channel]
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
        avatar: info?.avatar,
        paint: info?.paint,
        count: 0
      };
    }

    const words = msg.split(/\s+/);
    const used = emotes.filter(e => words.includes(e.name));

    if (used.length > 0) {
      for (const e of used) {
        users[username].count++;
        emoteUsage[e.name] = (emoteUsage[e.name] || 0) + 1;
      }
      broadcast(channel, { type: "update", user: users[username], emoteUsage });
    }
  });

  activeChannels[channel] = { emotes, users, emoteUsage, client };
  return activeChannels[channel];
}

// 🔹 WebSocket setup
const wss = new WebSocketServer({ noServer: true });
const sockets = new Set();

function broadcast(channel, data) {
  const msg = JSON.stringify({ channel, ...data });
  for (const ws of sockets) ws.send(msg);
}

const server = app.listen(PORT, () => {
  console.log(`✅ Running at http://localhost:${PORT}`);
});

server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
  });
});

// 🔹 API Routes
app.get("/api/channel/:channel", async (req, res) => {
  const channel = req.params.channel.toLowerCase();
  const tracker = await startTracking(channel);
  res.json({
    emotes: tracker.emotes,
    users: Object.values(tracker.users),
    emoteUsage: tracker.emoteUsage
  });
});

app.use(express.static(path.join(__dirname, "public")));
