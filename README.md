# Discord Search & Help Bot

A multifunctional Discord bot that can search the web, provide keyword-based help, and more.

## Features

- **Web Search**: Search the internet directly from Discord
- **Keyword-based Help**: Automatically detects keywords and provides relevant help
- **Command System**: Easy-to-use command interface
- **Logging**: Comprehensive logging for debugging and monitoring
- **Configurable**: Customizable through environment variables

## Installation

1. Clone this repository
2. Install dependencies: `npm install`
3. Create a `.env` file based on `.env.example`
4. Add your Discord bot token
5. Start the bot: `npm start` or `npm run dev` for development

## Commands

### Search Command
```
!search [query]
```
Searches the web for the specified query and returns the top result.

### Help Command
```
!help
```
Shows available commands and keyword-based help information.

### Info Command
```
!info
```
Displays information about the bot.

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