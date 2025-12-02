require('dotenv').config();
const { Client, GatewayIntentBits, Collection, ActivityType } = require('discord.js');
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
  },
  statusMessages: [
    'no dont do that, dont stick your hand in',
    'no tennis balls',
    'contact @vee.anti for help or smth',
    "I'm just doing this to learn pretty much.",
    'meow'
  ]
};

// Bot ready event
client.on('ready', () => {
  logger.info(`Logged in as ${client.user.tag}!`);
  console.log(`Bot is ready! Logged in as ${client.user.tag}`);

  // Set bot status
  updateBotStatus();
  setInterval(updateBotStatus, 30000); // Update status every 30 seconds
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

// Bot status updater
function updateBotStatus() {
  const randomStatus = config.statusMessages[Math.floor(Math.random() * config.statusMessages.length)];
  client.user.setActivity(randomStatus, { type: ActivityType.Watching });
}

// Command handlers
async function handleSearchCommand(message, args) {
  if (args.length === 0) {
    return message.reply('Please provide a search query.');
  }

  const query = args.join(' ');
  const searchMessage = await message.reply(`🔍 Searching for: **${query}**...`);

  try {
    // Use a more reliable search approach
    const searchResults = await performWebSearch(query);

    if (searchResults && searchResults.length > 0) {
      const result = searchResults[0];
      await searchMessage.edit(`🔍 Found results for: **${query}**`);

      const embed = {
        color: 0x0099ff,
        title: result.title,
        url: result.url,
        description: result.description || 'No description available',
        fields: [
          {
            name: 'Search Query',
            value: query,
            inline: true
          },
          {
            name: 'Source',
            value: 'Web Search',
            inline: true
          }
        ],
        timestamp: new Date(),
        footer: {
          text: 'Powered by Discord Search Bot',
        }
      };

      await message.channel.send({ embeds: [embed] });
    } else {
      await searchMessage.edit('🔍 No results found for that query.');
    }
  } catch (error) {
    logger.error(`Search error: ${error.message}`);
    await searchMessage.edit('❌ An error occurred during the search. Please try again.');
  }
}

async function performWebSearch(query) {
  try {
    // Use a more reliable approach - mock search for now
    // In production, you would use a proper search API
    const mockResults = [
      {
        title: `Search results for "${query}"`,
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        description: `Find information about ${query} on the web`
      }
    ];

    return mockResults;
  } catch (error) {
    logger.error(`Web search failed: ${error.message}`);
    return [];
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