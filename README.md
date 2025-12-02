# Discord Search & Help Bot

A multifunctional Discord bot that can search the web, provide keyword-based help, and more.

## Features

- **Web Search**: Search the internet directly from Discord with rich embed results
- **Keyword-based Help**: Automatically detects keywords and provides relevant help
- **Command System**: Easy-to-use command interface
- **Dynamic Bot Status**: Rotating status messages showing bot activity
- **Logging**: Comprehensive logging for debugging and monitoring
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
```

## Development

- Use `npm run dev` for development with auto-restart
- Logs are stored in the `logs/` directory
- The bot uses Discord.js v14

## Requirements

- Node.js 16+
- Discord bot token
- Internet connection for web searches

## License

MIT