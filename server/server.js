import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config({ path: "../.env" });

const app  = express();
const port = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());

// Basic CORS for local development
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Discord OAuth2 token exchange ────────────────────────────────────────────
// Used by the Discord Embedded App SDK to exchange an authorization code for
// an access token.  The client sends { code } and receives { access_token }.
app.post("/api/token", async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: "Missing authorization code" });
  }

  const clientId     = process.env.VITE_DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Missing VITE_DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET in .env");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  try {
    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    "authorization_code",
        code,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Discord token exchange failed:", response.status, errorBody);
      return res.status(response.status).json({ error: "Token exchange failed", details: errorBody });
    }

    const data = await response.json();
    const { access_token, token_type, expires_in, scope } = data;

    // Only forward what the client needs — never expose client_secret
    res.json({ access_token, token_type, expires_in, scope });
  } catch (err) {
    console.error("Token exchange error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Discord user info (optional helper) ─────────────────────────────────────
// Accepts a Bearer token and returns the current Discord user object.
app.get("/api/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  try {
    const response = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: authHeader },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch user info" });
    }

    const user = await response.json();
    res.json(user);
  } catch (err) {
    console.error("User info error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`✅ Server listening at http://localhost:${port}`);
  console.log(`   POST /api/token  — Discord OAuth2 code exchange`);
  console.log(`   GET  /api/me     — Fetch current Discord user`);
  console.log(`   GET  /health     — Health check`);
});
