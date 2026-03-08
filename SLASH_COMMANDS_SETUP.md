# Slash Commands Setup Guide

## Available Commands

| Command | Description | Works In |
|---------|-------------|----------|
| `/search <query>` | Search UnionCrax for games | Guild, DM, Private |
| `/ask <question>` | Ask the AI a direct question | Guild, DM, Private |
| `/info` | Bot information (model, mode, uptime, DB stats) | Guild, DM, Private |
| `/stats` | Server statistics (members, channels, roles…) | Guild only |
| `/ping` | Check bot latency and WebSocket heartbeat | Guild, DM, Private |
| `/location` | Bot runtime environment details | Guild, DM, Private |
| `/help` | List all available commands | Guild, DM, Private |

---

## Prerequisites

Your bot needs specific permissions and settings in the Discord Developer Portal.

---

## Step 1: Update Bot Settings in Discord Developer Portal

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application/bot
3. Navigate to the **Installation** tab (left sidebar)

### Configure Installation Settings

#### Guild Install (Server Install)
- **Default Install Settings** → Check "Guild Install"
- **Install Link**: Select "Discord Provided Link"
- **Scopes**:
  - ✅ `bot`
  - ✅ `applications.commands`
- **Permissions**:
  - ✅ `Send Messages`
  - ✅ `Read Messages / View Channels`
  - ✅ `Read Message History`
  - ✅ `Ban Members` (for spam auto-ban)
  - ✅ `Manage Messages` (optional)

#### User Install (for DMs and user context)
- **User Install** → Check "User Install"
- **Install Link**: Select "Discord Provided Link"
- **Scopes**:
  - ✅ `applications.commands`

---

## Step 2: Enable Privileged Gateway Intents

1. In the Developer Portal, go to the **Bot** tab
2. Scroll to **Privileged Gateway Intents**
3. Enable:
   - ✅ `Server Members Intent` (required for `/stats` and ban functionality)
   - ✅ `Message Content Intent` (required for reading messages)
   - ✅ `Presence Intent` (optional, for online member count in `/stats`)

---

## Step 3: Environment Variables

Create a `.env` file in the project root (copy from `.env.example` if present):

```env
# Required
DISCORD_TOKEN="token"
CHANNEL_ID=channel_id_for_random_ai_responses

# AI (OpenRouter)
OPENROUTER_API_KEY=your_openrouter_key
AI_MODEL=openai/gpt-4o-mini

# Optional features
ENABLE_DATABASE=false
ENABLE_SEMANTIC_SEARCH=false
ENABLE_MENTIONS=true
FRIENDLY_FIRE=false
DEBUG=false
RANDOM_RESPONSE_CHANCE=0.1
BOT_PREFIX=!

# For the server/ OAuth helper (Discord Embedded App SDK)
VITE_DISCORD_CLIENT_ID=1389633809389060236
DISCORD_CLIENT_SECRET=zXyflT5HPNh2iNqrfqpSyej7TalR4MRZ
```

---

## Step 4: Install Dependencies & Start

```bash
# Install dependencies (discord.js v14 required)
npm install

# Start the bot
npm start

# Or for development with auto-restart
npm run dev
```

You should see:
```
✅ Logged in as YourBot#1234 — Let's get this bread started
🔄 Registering slash commands...
✅ Registered guild commands to <GUILD_ID> (instant update).
✅ Successfully registered application commands globally.
```

---

## Step 5: Test Slash Commands

### In a Server (Guild Install)
1. Type `/` in any channel
2. You should see your bot's commands listed

### In DMs (User Install)
1. Add the bot to your account using the User Install link
2. Open a DM with the bot
3. Type `/` — the same commands should appear

---

## Step 6: Running the OAuth Server (for Embedded App SDK)

The `server/` folder contains an Express server that handles Discord OAuth2 token exchange for the Discord Embedded App SDK.

```bash
cd server
npm install
npm run dev
```

The server exposes:
- `POST /api/token` — Exchange an authorization code for an access token
- `GET  /api/me`    — Fetch the current Discord user (requires Bearer token)
- `GET  /health`    — Health check

---

## Troubleshooting

### Commands Not Showing Up?
- Wait 1–5 minutes for Discord to sync global commands
- Guild commands (registered to `GUILD_ID`) update instantly
- Check that `applications.commands` scope is enabled
- Verify the bot has proper permissions in the channel

### "Application did not respond" Error?
- Check the bot's console for errors
- Ensure the bot is online and connected
- Verify the `interactionCreate` handler is running

### `/stats` Shows 0 Online Members?
- Enable **Presence Intent** in the Developer Portal
- Add `GatewayIntentBits.GuildPresences` to the client intents in `bot.js`

### Ban Functionality Not Working?
- Ensure **Server Members Intent** is enabled
- Bot needs **Ban Members** permission
- Bot's role must be higher than the user being banned

### `/ask` Returns "Technical Difficulties"?
- Check `OPENROUTER_API_KEY` is set in `.env`
- Check `AI_MODEL` is a valid OpenRouter model name
- Review bot console logs for the actual API error

---

## Notes

- Global commands can take up to 1 hour to propagate across all Discord servers
- Guild-specific commands (registered to `GUILD_ID`) update instantly
- User Install allows users to use your bot's commands anywhere, even in servers where the bot isn't installed
- The `@discord/embedded-app-sdk` is a **browser/Vite** dependency — it belongs in the `client/` folder of an activity project, not in the Node.js bot
