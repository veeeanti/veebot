require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const winston = require('winston');
const axios = require('axios');
const cheerio = require('cheerio');

// Initialize logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/bot.log' })
  ]
});

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Command collection
client.commands = new Collection();

// Configuration
const config = {
  prefix: process.env.BOT_PREFIX || '!',
  searchEngine: process.env.SEARCH_ENGINE || 'https://www.google.com/search?q=',
  helpKeywords: {
    'help': 'Provides information about available commands',
    'search': 'Searches the web for information',
    'info': 'Provides bot information'
  }
};

// Bot ready event
client.on('ready', () => {
  logger.info(`Logged in as ${client.user.tag}!`);
  console.log(`Bot is ready! Logged in as ${client.user.tag}`);
});

// Message event handler
client.on('messageCreate', async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Check if message starts with prefix
  if (message.content.startsWith(config.prefix)) {
    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    try {
      // Handle commands
      switch (commandName) {
        case 'search':
          await handleSearchCommand(message, args);
          break;
        case 'help':
          await handleHelpCommand(message, args);
          break;
        case 'info':
          await handleInfoCommand(message);
          break;
        default:
          message.reply(`Unknown command. Type ${config.prefix}help for available commands.`);
      }
    } catch (error) {
      logger.error(`Error handling command: ${error.message}`);
      message.reply('An error occurred while processing your command.');
    }
  } else {
    // Check for keyword-based help
    await checkForKeywordHelp(message);
  }
});

// Command handlers
async function handleSearchCommand(message, args) {
  if (args.length === 0) {
    return message.reply('Please provide a search query.');
  }

  const query = args.join(' ');
  message.reply(`Searching for: ${query}`);

  try {
    const searchUrl = `${config.searchEngine}${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DiscordBot/1.0'
      }
    });

    const $ = cheerio.load(response.data);
    const results = [];

    // Extract search results (basic implementation)
    $('div.g').each((i, element) => {
      const title = $(element).find('h3').text();
      const url = $(element).find('a').attr('href');
      const description = $(element).find('div.VwiC3b').text();

      if (title && url) {
        results.push({ title, url, description });
      }
    });

    if (results.length > 0) {
      const result = results[0];
      message.channel.send(`**${result.title}**\n${result.description}\n${result.url}`);
    } else {
      message.reply('No results found.');
    }
  } catch (error) {
    logger.error(`Search error: ${error.message}`);
    message.reply('An error occurred during the search.');
  }
}

async function handleHelpCommand(message, args) {
  let helpMessage = '**Available Commands:**\n\n';

  // Add command help
  helpMessage += `**${config.prefix}search [query]** - Search the web\n`;
  helpMessage += `**${config.prefix}help** - Show this help message\n`;
  helpMessage += `**${config.prefix}info** - Show bot information\n`;

  // Add keyword help
  helpMessage += '\n**Keyword-based help (automatic):**\n';
  for (const [keyword, description] of Object.entries(config.helpKeywords)) {
    helpMessage += `*${keyword}* - ${description}\n`;
  }

  message.channel.send(helpMessage);
}

async function handleInfoCommand(message) {
  const infoMessage = `
**Bot Information**
- **Name:** ${client.user.username}
- **Prefix:** ${config.prefix}
- **Features:** Web search, keyword-based help, and more!
- **Version:** 1.0.0
  `;

  message.channel.send(infoMessage);
}

async function checkForKeywordHelp(message) {
  const messageContent = message.content.toLowerCase();

  // Check for help keywords
  for (const [keyword, description] of Object.entries(config.helpKeywords)) {
    if (messageContent.includes(keyword)) {
      message.reply(`I noticed you mentioned "${keyword}". ${description} You can use ${config.prefix}help for more information.`);
      break;
    }
  }
}

// Login to Discord
client.login(process.env.DISCORD_TOKEN)
  .then(() => logger.info('Bot login successful'))
  .catch(error => logger.error(`Bot login failed: ${error.message}`));

// Export client for testing
module.exports = client;