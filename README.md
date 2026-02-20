# Discord Search & Help Bot

A multifunctional Discord bot that can search the web, provide keyword-based help, and more.

## Features

- **Web Search**: Search the internet directly from Discord with rich embed results
- **Keyword-based Help**: Automatically detects keywords and provides relevant help
- **Command System**: Easy-to-use command interface
- **Dynamic Bot Status**: Rotating status messages showing bot activity
- **Logging**: Comprehensive logging for debugging and monitoring
- **Database**: Supports local file-based storage (SQLite) or remote servers (PostgreSQL)
- **Configurable**: Customizable through environment variables
- **Error Handling**: Graceful error handling with user-friendly messages

## Installation

1. Clone this repository
2. Install dependencies: `npm install`
3. Create a `.env` file based on `.env.example`
4. Add your Discord bot token
5. Start the bot: `npm start` or `npm run dev` for development
6. Enable "Message Content Intent" in your Discord Developer Portal

## Commands

### Search Command
```
!search [query]
```
Searches the web for the specified query and returns results in a rich embed format with:
- Search query information
- Result title and description
- Direct link to the source
- Timestamp and footer

### Help Command
```
!help
```
Shows available commands and keyword-based help information.

### Info Command
```
!info
```
Displays information about the bot including current status.

## Keyword-based Help

The bot automatically detects keywords in messages and provides relevant help:

- **help**: Provides information about available commands
- **search**: Explains the search functionality
- **info**: Provides bot information

## Configuration

Create a `.env` file with the following variables:

```env
DISCORD_TOKEN=your_discord_bot_token_here
BOT_PREFIX=!
SEARCH_ENGINE=https://www.google.com/search?q=
LOG_LEVEL=info

# Database Configuration
ENABLE_DATABASE=true
DATABASE_TYPE=sqlite      # Use 'sqlite' for local or 'postgres' for remote
SQLITE_PATH=./database.sqlite
# DATABASE_URL=postgres://user:pass@host:5432/db (only for postgres)
```

## Development

- Use `npm run dev` for development with auto-restart
- Logs are stored in the `logs/` directory
- The bot uses Discord.js v14

## Requirements

- Node.js 16+
- Discord bot token
- Internet connection for web searches

## Music setup

The bot supports playing from YouTube, Spotify, and SoundCloud via `play-dl`.

- For YouTube and SoundCloud, no extra setup is typically required.
- For Spotify links (tracks, playlists, albums), you MUST provide Spotify API credentials so `play-dl` can authorize.

Steps:
1. Create a Spotify app at https://developer.spotify.com/dashboard
2. Copy the Client ID and Client Secret
3. Add the following to your `.env` (or set in your hosting provider):

```
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
```

4. Restart the bot.

Note: The bot does not stream audio directly from Spotify; `play-dl` resolves a playable source (usually YouTube) for the requested Spotify item.

## License

MIT