# Discord Bot Usage Examples

## Basic Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Create .env file**:
   ```bash
   cp .env.example .env
   ```

3. **Add your Discord token** to the `.env` file

4. **Start the bot**:
   ```bash
   npm start
   ```

   For development with auto-restart:
   ```bash
   npm run dev
   ```

## Command Examples

### Search Command
```discord
!search discord.js bot tutorial
```
**Response**:
```
Searching for: discord.js bot tutorial
**Discord.js Guide - Official Documentation**
Learn how to create bots with Discord.js
https://discordjs.guide/
```

### Help Command
```discord
!help
```
**Response**:
```
**Available Commands:**

**!search [query]** - Search the web
**!help** - Show this help message
**!info** - Show bot information

**Keyword-based help (automatic):**
*help* - Provides information about available commands
*search* - Searches the web for information
*info* - Provides bot information
```

### Info Command
```discord
!info
```
**Response**:
```
**Bot Information**
- **Name:** SearchBot
- **Prefix:** !
- **Features:** Web search, keyword-based help, and more!
- **Version:** 1.0.0
```

## Keyword-based Help Examples

### Automatic Help Detection
If you mention keywords in regular messages, the bot will respond with helpful information:

**User message**:
```
I need help with the search feature
```

**Bot response**:
```
I noticed you mentioned "help". Provides information about available commands. You can use !help for more information.
```

**User message**:
```
How do I search for something?
```

**Bot response**:
```
I noticed you mentioned "search". Searches the web for information. You can use !help for more information.
```

## Advanced Usage

### Customizing the Bot

1. **Change command prefix**:
   ```env
   BOT_PREFIX=?
   ```

2. **Change search engine**:
   ```env
   SEARCH_ENGINE=https://duckduckgo.com/?q=
   ```

3. **Adjust logging level**:
   ```env
   LOG_LEVEL=debug
   ```

### Running in Production

For production use, consider:

1. Using PM2 for process management:
   ```bash
   npm install -g pm2
   pm2 start src/bot.js --name discord-bot
   ```

2. Setting up proper logging rotation

3. Implementing rate limiting for API calls

## Troubleshooting

**Bot not responding?**
- Check if the bot is online in Discord
- Verify your token is correct in `.env`
- Check logs in `logs/bot.log`

**Search not working?**
- Ensure you have internet connectivity
- Check if the search engine URL is accessible
- Verify your bot has the Message Content intent enabled in Discord Developer Portal