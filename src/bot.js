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
const GUILD_ID = process.env.GUILD_ID;
const LOCAL = process.env.LOCAL === 'true';
const ENABLE_MENTIONS = process.env.ENABLE_MENTIONS === 'true';
const ENABLE_SEMANTIC_SEARCH = process.env.ENABLE_SEMANTIC_SEARCH === 'true';
const ENABLE_DATABASE = process.env.ENABLE_DATABASE === 'true';

// AI Response Function
async function generateAMResponse(userInput, channelId, guildId, discordMessageId, authorId, authorName) {
  try {
    // Build conversation snippet (last 4 turns)
    let contextText = '';
    conversationMemory.slice(-8).forEach((msg, i) => {
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

// Initialize System
async function initializeSystem() {
  console.log('Initializing UC-AIv2...');

  // Check if database is enabled
  if (!ENABLE_DATABASE) {
    console.log(' Database DISABLED');
    console.log('   - Running in Simple Mode (no database)');
    console.log('   - Basic conversation without memory');
    return;
  }

  // Check if semantic search is enabled
  if (ENABLE_SEMANTIC_SEARCH) {
    console.log(' Semantic Context Mode ENABLED (simulated)');
    console.log('   - Using basic conversation memory');
    console.log('   - Context-aware responses based on recent messages');
  } else {
    console.log(' Simple Mode ENABLED (no semantic context)');
    console.log('   - Using basic conversation memory');
  }
}

// Bot ready event
client.on('ready', async () => {
  logger.info(`Logged in as ${client.user.tag}!`);
  console.log(`Logged in as ${client.user.tag} — Lets get this bread started`);

  // Initialize the system
  await initializeSystem();

  console.log(` Running in Simple Mode`);

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
        case 'info':
          await handleInfoCommand(message);
          break;
        case 'location':
          await handleLocationCommand(message);
          break;
        default:
          message.reply(`Unknown command. Available commands: search, info, location`);
      }
    } catch (error) {
      logger.error(`Error handling command: ${error.message}`);
      message.reply('An error occurred while processing your command.');
    }
  }

  // AI Response Handling
  const isCorrectChannel = message.channel.id === CHANNEL_ID;
  const isMentioned = message.mentions.has(client.user);
  const isInMainGuild = message.guild && message.guild.id === GUILD_ID;

  const currentTime = Date.now();
  let shouldRespond = false;

  if (ENABLE_MENTIONS && isMentioned && isInMainGuild) {
    shouldRespond = true;
  } else if (isCorrectChannel) {
    if (isMentioned) {
      shouldRespond = true;
    } else if (Math.random() < RANDOM_RESPONSE_CHANCE && currentTime - lastResponseTime > 10000) {
      shouldRespond = true;
      lastResponseTime = currentTime;
    }
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

    const reply = await generateAMResponse(
      userInput,
      message.channel.id,
      message.guild?.id,
      message.id,
      message.author.id,
      message.author.username
    );

    conversationMemory.push(userInput.trim());
    conversationMemory.push(reply.trim());
    if (conversationMemory.length > 10) conversationMemory = conversationMemory.slice(-10);

    // Delay based on word count (simulate typing duration)
    const wordCount = reply.split(/\s+/).length;
    const typingDuration = Math.min(8000, wordCount * 150 + Math.random() * 500);
    await new Promise(res => setTimeout(res, typingDuration));

    await message.reply(reply);
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
  const searchMessage = await message.reply(`🔍 Searching Google for games matching UnionCrax listings: **${query}**...`);

  try {
    // Search Google for games that match UnionCrax listings
    const searchResult = await searchGoogleForUnionCraxGames(query);

    if (searchResult) {
      await searchMessage.edit(`🔍 Found top result for: **${query}**`);

      // Create and send embed with the search result
      const embed = new EmbedBuilder()
        .setTitle(`🎮 ${searchResult.title}`)
        .setURL(searchResult.url)
        .setColor(0x0099ff)
        .setDescription(searchResult.description || 'No description available')
        .addFields(
          { name: 'Source', value: searchResult.source, inline: true },
          { name: 'Downloads', value: searchResult.downloadCount ? String(searchResult.downloadCount) : 'N/A', inline: true },
          { name: 'Size', value: searchResult.size || 'N/A', inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Game search result from UnionCrax' });

      await message.channel.send({ embeds: [embed] });
    } else {
      await searchMessage.edit('🔍 No matching games found on UnionCrax for that query.');
    }
  } catch (error) {
    logger.error(`Search error: ${error.message}`);
    await searchMessage.edit('❌ An error occurred during the search. Please try again.');
  }
}

// UnionCrax API configuration
const UNION_CRAX_API_BASE = 'https://union-crax.xyz';

// Function to search Google for games that match UnionCrax listings
async function searchGoogleForUnionCraxGames(query) {
  try {
    // First, search UnionCrax for games matching the query
    const unionCraxGames = await searchUnionCraxGames(query);

    if (unionCraxGames.length === 0) {
      return null; // No matching games found on UnionCrax
    }

    // Get the top matching game from UnionCrax
    const topUnionCraxGame = unionCraxGames[0];

    // Now search Google for this specific game to get the best web result
    const googleQuery = `${topUnionCraxGame.title} site:union-crax.xyz`;
    const googleResults = await performWebSearch(googleQuery);

    if (googleResults.length > 0) {
      // Combine UnionCrax data with Google search result
      return {
        title: topUnionCraxGame.title,
        url: topUnionCraxGame.url,
        description: topUnionCraxGame.description,
        source: 'UnionCrax via Google',
        downloadCount: topUnionCraxGame.downloadCount,
        size: topUnionCraxGame.size
      };
    }

    // If no Google results, return the UnionCrax data directly
    return topUnionCraxGame;
  } catch (error) {
    logger.error(`Google search for UnionCrax games failed: ${error.message}`);
    return null;
  }
}

// Helper function to normalize strings for comparison
function normalizeString(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

// Function to search UnionCrax games
async function searchUnionCraxGames(query) {
  try {
    const normalizedQuery = normalizeString(query);

    // Fetch games and stats from UnionCrax API
    const [games, gameStats] = await Promise.all([
      axios.get(`${UNION_CRAX_API_BASE}/api/games`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      }),
      axios.get(`${UNION_CRAX_API_BASE}/api/downloads/all`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      })
    ]);

    const gamesData = games.data || [];
    const statsData = gameStats.data || {};

    if (!Array.isArray(gamesData) || gamesData.length === 0) {
      return [];
    }

    // Score games based on query relevance
    const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 2);

    const scoredGames = gamesData.map(game => {
      const normalizedName = normalizeString(game.name || '');
      const normalizedDesc = normalizeString(game.description || '');
      let score = 0;

      // Exact match
      if (normalizedName === normalizedQuery) score += 100;
      if (normalizedName.includes(normalizedQuery) && Math.abs(normalizedName.length - normalizedQuery.length) < 10) score += 60;
      if (normalizedQuery.includes(normalizedName) && normalizedName.length > 4) score += 40;

      // Word matching
      queryWords.forEach(word => {
        if (word.length > 3) {
          if (normalizedName.includes(word)) score += 25;
          else if (normalizedDesc.includes(word)) score += 8;
        }
      });

      if (normalizedName.startsWith(normalizedQuery)) score += 30;

      // App ID match
      if ((game.appid && String(game.appid) === normalizedQuery) || (String(game.appid) === normalizedQuery)) score += 20;

      return { game, score };
    }).sort((a, b) => b.score - a.score);

    // Filter high-scoring games
    const filtered = scoredGames.filter(item => item.score >= 60);

    // Format results for display
    return filtered.slice(0, 3).map(item => {
      const game = item.game;
      const stats = statsData[game.appid] || statsData[game.id] || {};

      return {
        title: `${game.name} - Free Download on UnionCrax`,
        url: `${UNION_CRAX_API_BASE}/game/${encodeURIComponent(game.appid || game.id || '')}`,
        description: game.description || 'No description available',
        source: 'UnionCrax',
        downloadCount: stats.downloads || stats.download_count || stats.count || 0,
        size: game.size || 'Unknown'
      };
    });
  } catch (error) {
    logger.error(`UnionCrax search failed: ${error.message}`);
    return [];
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
          description: descriptionElement.text().trim() || 'No description available',
          source: 'Web Search'
        });
      }
    });

    // Fallback if no results found
    if (results.length === 0) {
      results.push({
        title: `Search results for "${query}"`,
        url: searchUrl,
        description: `Find information about ${query} on the web`,
        source: 'Web Search'
      });
    }

    return results;
  } catch (error) {
    logger.error(`Web search failed: ${error.message}`);

    // Return fallback result if scraping fails
    return [{
      title: `Search results for "${query}"`,
      url: `${config.searchEngine}${encodeURIComponent(query)}`,
      description: `Could not fetch live results. Click to search for ${query}`,
      source: 'Web Search'
    }];
  }
}

// Combined search function
async function performCombinedSearch(query) {
  try {
    // Perform both searches in parallel
    const [webResults, unionCraxResults] = await Promise.all([
      performWebSearch(query),
      searchUnionCraxGames(query)
    ]);

    // Combine results, prioritizing UnionCrax games
    const combinedResults = [...unionCraxResults, ...webResults];

    // Return only the top result
    return combinedResults.slice(0, 1);
  } catch (error) {
    logger.error(`Combined search failed: ${error.message}`);
    // Fallback to web search only, but still return only top result
    const webResults = await performWebSearch(query);
    return webResults.slice(0, 1);
  }
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
          { name: 'Mode', value: 'Simple', inline: true },
          { name: 'Uptime', value: `${hours}h ${minutes}m ${seconds}s`, inline: true }
      );

  if (ENABLE_DATABASE) {
    embed.addFields({ name: 'Database', value: 'Enabled', inline: true });
  } else {
    embed.addFields({ name: 'Database', value: 'Disabled', inline: true });
  }

  embed.addFields(
    { name: 'Mentions Enabled', value: ENABLE_MENTIONS ? 'Yes' : 'No', inline: true }
  );

  message.channel.send({ embeds: [embed] });
}

async function handleLocationCommand(message) {
  try {
    const locationInfo = {
      workingDirectory: process.cwd(),
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'production'
    };

    const embed = new EmbedBuilder()
      .setTitle('📍 Bot Location Information')
      .setColor(0x0099ff)
      .addFields(
        { name: 'Working Directory', value: `\`${locationInfo.workingDirectory}\``, inline: false },
        { name: 'Platform', value: locationInfo.platform, inline: true },
        { name: 'Architecture', value: locationInfo.architecture, inline: true },
        { name: 'Node.js Version', value: locationInfo.nodeVersion, inline: true },
        { name: 'Environment', value: locationInfo.environment, inline: true },
        { name: 'Uptime', value: `${Math.floor(locationInfo.uptime / 60)} minutes`, inline: true },
        { name: 'Memory Usage', value: `${Math.round(locationInfo.memoryUsage.heapUsed / 1024 / 1024)} MB`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Bot location details' });

    message.channel.send({ embeds: [embed] });
  } catch (error) {
    logger.error(`Location command error: ${error.message}`);
    message.reply('❌ An error occurred while getting location information.');
  }
}


// Login to Discord
client.login(process.env.DISCORD_TOKEN)
  .then(() => logger.info('Bot login successful'))
  .catch(error => logger.error(`Bot login failed: ${error.message}`));

// Export client for testing
module.exports = client;