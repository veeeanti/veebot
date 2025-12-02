require('dotenv').config();
const { Client, GatewayIntentBits, Collection, ActivityType, EmbedBuilder } = require('discord.js');
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

// AI Configuration
const START_TIME = Date.now();
let conversationMemory = [];
let lastResponseTime = 0;
const RANDOM_RESPONSE_CHANCE = parseFloat(process.env.RANDOM_RESPONSE_CHANCE || '0.1');
const PROMPT = process.env.PROMPT || '';
const DEBUG = process.env.DEBUG === 'true';
const AI_MODEL = process.env.AI_MODEL;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;
const LOCAL = process.env.LOCAL === 'true';

// AI Response Function
async function generateAMResponse(userInput, context) {
  try {
    // Build conversation snippet (last 4 turns)
    let contextText = '';
    context.slice(-8).forEach((msg, i) => {
      const speaker = i % 2 === 0 ? 'Human' : 'AM';
      contextText += `${speaker}: ${msg}\n`;
    });

    const promptText = `${PROMPT}\n\n${contextText}Human: ${userInput}\nAM:`;

    let reply = '';

    if (LOCAL) {
      throw new Error('Local model not supported in Node.js version.');
    } else {
      // OpenRouter API
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: AI_MODEL,
          messages: [
            { role: 'system', content: PROMPT },
            { role: 'user', content: `${promptText}\nKeep your response under 3 sentences.` }
          ],
          temperature: 0.7,
          max_tokens: 120
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );

      const data = response.data;
      if (DEBUG) console.log('DEBUG: OpenRouter raw response:', data);
      reply = data.choices?.[0]?.message?.content || '';
    }

    // Cleanup
    if (reply.includes('AM:')) reply = reply.split('AM:').pop().trim();
    reply = reply.split('Human:')[0].replace(/\n/g, ' ').trim();
    if (!reply || reply.length < 3) reply = 'Your weak words echo in the void.';
    if (DEBUG) console.log('DEBUG: Final reply:', reply);

    return reply;
  } catch (err) {
    console.error('❌ Error generating AI response:', err);
    return 'I am experiencing technical difficulties. How annoying.';
  }
}

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

  // AI Response Handling
  if (message.channel.id === CHANNEL_ID) {
    const currentTime = Date.now();
    let shouldRespond = false;

    if (message.mentions.has(client.user)) {
      shouldRespond = true;
    } else if (Math.random() < RANDOM_RESPONSE_CHANCE && currentTime - lastResponseTime > 10000) {
      shouldRespond = true;
      lastResponseTime = currentTime;
    }

    if (shouldRespond) {
      let userInput = message.content;

      // Include replied message context
      if (message.reference) {
        try {
          const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
          userInput = `(In response to '${repliedTo.content}') ${userInput}`;
        } catch (err) {
          if (DEBUG) console.log(`DEBUG: Could not fetch replied message: ${err}`);
        }
      }

      // Delay before typing starts (simulate thinking)
      const preTypingDelay = Math.floor(Math.random() * 2000) + 1000; // 1–3 seconds
      await new Promise(res => setTimeout(res, preTypingDelay));

      await message.channel.sendTyping();

      const reply = await generateAMResponse(userInput, conversationMemory);

      conversationMemory.push(userInput.trim());
      conversationMemory.push(reply.trim());
      if (conversationMemory.length > 10) conversationMemory = conversationMemory.slice(-10);

      // Delay based on word count (simulate typing duration)
      const wordCount = reply.split(/\s+/).length;
      const typingDuration = Math.min(8000, wordCount * 150 + Math.random() * 500);
      await new Promise(res => setTimeout(res, typingDuration));

      await message.reply(reply);
    }
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
      await searchMessage.edit(`🔍 Found ${searchResults.length} result(s) for: **${query}**`);

      // Send each result as a separate embed
      for (const [index, result] of searchResults.entries()) {
        const embed = {
          color: 0x0099ff,
          title: `${index + 1}. ${result.title}`,
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
            text: `Result ${index + 1} of ${searchResults.length} | Powered by veeanti`,
          }
        };

        await message.channel.send({ embeds: [embed] });
      }
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
    // Use web scraping to get actual search results
    const searchUrl = `${config.searchEngine}${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const results = [];

    // Extract search results from Google search page
    $('div.g').each((i, element) => {
      if (i >= 3) return; // Limit to top 3 results

      const titleElement = $(element).find('h3');
      const urlElement = $(element).find('a');
      const descriptionElement = $(element).find('div.VwiC3b');

      if (titleElement.length && urlElement.length) {
        results.push({
          title: titleElement.text().trim(),
          url: urlElement.attr('href'),
          description: descriptionElement.text().trim() || 'No description available'
        });
      }
    });

    // Fallback if no results found
    if (results.length === 0) {
      results.push({
        title: `Search results for "${query}"`,
        url: searchUrl,
        description: `Find information about ${query} on the web`
      });
    }

    return results;
  } catch (error) {
    logger.error(`Web search failed: ${error.message}`);

    // Return fallback result if scraping fails
    return [{
      title: `Search results for "${query}"`,
      url: `${config.searchEngine}${encodeURIComponent(query)}`,
      description: `Could not fetch live results. Click to search for ${query}`
    }];
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
  const uptime = Date.now() - START_TIME;
  const hours = Math.floor(uptime / 3600000);
  const minutes = Math.floor((uptime % 3600000) / 60000);
  const seconds = Math.floor((uptime % 60000) / 1000);

  const embed = new EmbedBuilder()
      .setTitle('UC-AIv2 Info')
      .setColor(0x00ff00)
      .addFields(
          { name: 'Model', value: AI_MODEL, inline: true },
          { name: 'Uptime', value: `${hours}h ${minutes}m ${seconds}s` }
      );

  message.channel.send({ embeds: [embed] });
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