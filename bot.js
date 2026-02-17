// Load env
import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, ActivityType, EmbedBuilder, REST, Routes, PermissionFlagsBits, ApplicationCommandType, InteractionContextType, IntegrationTypes } from 'discord.js';
import axios from 'axios';
import { load } from 'cheerio';
import winston from 'winston';

// Import helper modules
import { testConnection, initializeDatabase, closeDatabase } from './database.js';
import { testEmbeddingService } from './embeddings.js';
import semanticContextManager from './context-manager.js';

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const LOCAL = process.env.LOCAL === 'true';
const AI_MODEL = process.env.AI_MODEL;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const RANDOM_RESPONSE_CHANCE = parseFloat(process.env.RANDOM_RESPONSE_CHANCE || '0.1');
const PROMPT = process.env.PROMPT || '';
const DEBUG = process.env.DEBUG === 'true';
const ENABLE_MENTIONS = process.env.ENABLE_MENTIONS === 'true';
const ENABLE_SEMANTIC_SEARCH = process.env.ENABLE_SEMANTIC_SEARCH === 'true';
const ENABLE_DATABASE = process.env.ENABLE_DATABASE === 'true';
const DATABASE_URL = process.env.DATABASE_URL;
const FRIENDLY_FIRE = process.env.FRIENDLY_FIRE === 'true';

const START_TIME = Date.now();
let lastResponseTime = 0;
let isSemanticMode = false;

// Spam detection tracking
const userSpamTracking = new Map(); // userId -> { images: [], links: [] }

// Bot configuration
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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers
  ]
});

// Command collection
client.commands = new Collection();

// Define slash commands
const commands = [
  {
    name: 'search',
    description: 'Search UnionCrax for games',
    options: [
      {
        name: 'query',
        description: 'The game to search for',
        type: 3, // STRING type
        required: true
      }
    ],
    integration_types: [0, 1], // GUILD_INSTALL (0) and USER_INSTALL (1)
    contexts: [0, 1, 2] // GUILD (0), BOT_DM (1), PRIVATE_CHANNEL (2)
  },
  {
    name: 'info',
    description: 'Get information about the bot',
    integration_types: [0, 1],
    contexts: [0, 1, 2]
  },
  {
    name: 'location',
    description: 'Get bot location and system information',
    integration_types: [0, 1],
    contexts: [0, 1, 2]
  }
];

// Register slash commands
async function registerSlashCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    
    console.log('Started refreshing application (/) commands.');

    // Register commands globally (for user installs)
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );

    console.log('✅ Successfully registered application commands globally.');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
}

// AI Response Function
async function generateAMResponse(userInput, channelId, guildId, discordMessageId, authorId, authorName) {
  try {
    let contextText = '';
    
    if (isSemanticMode && semanticContextManager.isReady()) {
      const relevantContext = await semanticContextManager.getRelevantContext(userInput, guildId, authorId);
      
      relevantContext.slice(-10).forEach((msg, i) => {
        const speaker = msg.type === 'assistant' ? 'AM' : msg.author;
        const similarity = msg.similarity ? ` (relevance: ${(msg.similarity * 100).toFixed(1)}%)` : '';
        contextText += `${speaker}: ${msg.content}${similarity}\n`;
      });
      
      if (DEBUG) {
        console.log(` Used semantic context: ${relevantContext.length} relevant messages`);
      }
    } else {
      // Fallback to simple recent messages from cache
      contextText = '';
    }

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

    // Store messages in database if semantic mode is enabled
    if (isSemanticMode && discordMessageId && authorId && authorName) {
      // Store user message
      await semanticContextManager.storeUserMessage({
        discordMessageId: discordMessageId,
        content: userInput,
        authorId: authorId,
        authorName: authorName,
        channelId: channelId,
        guildId: guildId
      });

      // Store assistant response
      const assistantMessageId = `assistant_${discordMessageId}`;
      await semanticContextManager.storeAssistantMessage({
        discordMessageId: assistantMessageId,
        content: reply,
        channelId: channelId,
        guildId: guildId
      });
    }

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
  
  // Test database connection if semantic search is enabled
  if (ENABLE_SEMANTIC_SEARCH) {
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.warn(' Database connection failed, falling back to simple mode');
      isSemanticMode = false;
    } else {
      const schemaInitialized = await initializeDatabase();
      if (!schemaInitialized) {
        console.warn(' Database schema initialization failed, falling back to simple mode');
        isSemanticMode = false;
      } else {
        const embeddingWorking = await testEmbeddingService();
        if (!embeddingWorking) {
          console.warn(' Embedding service test failed, but continuing with fallback embeddings');
        }
        
        const contextInitialized = await semanticContextManager.initialize();
        if (contextInitialized) {
          isSemanticMode = true;
        } else {
          console.warn(' Semantic context manager initialization failed, falling back to simple mode');
          isSemanticMode = false;
        }
      }
    }
  }
  
  if (isSemanticMode) {
    console.log(' Semantic Context Mode ENABLED');
    console.log('   - Using PostgreSQL for message storage');
    console.log('   - Using text-based similarity for semantic search');
    console.log('   - Context-aware responses based on message similarity');
  } else if (ENABLE_DATABASE) {
    console.log(' Simple Mode ENABLED (no semantic context)');
    console.log('   - Using basic conversation memory');
  } else {
    console.log(' Simple Mode ENABLED (no database)');
    console.log('   - No conversation memory');
  }
}

// Bot ready event
client.once('ready', async () => {
  logger.info(`Logged in as ${client.user.tag}!`);
  console.log(`Logged in as ${client.user.tag} — Lets get this bread started`);
  
  // Initialize the semantic system
  await initializeSystem();
  
  // Register slash commands
  await registerSlashCommands();
  
  const mode = isSemanticMode ? 'Semantic' : 'Simple';
  console.log(` Running in ${mode} Mode`);

  // Set bot status
  updateBotStatus();
  setInterval(updateBotStatus, 30000); // Update status every 30 seconds
});

// Interaction handler for slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    switch (commandName) {
      case 'search':
        await handleSearchSlashCommand(interaction);
        break;
      case 'info':
        await handleInfoSlashCommand(interaction);
        break;
      case 'location':
        await handleLocationSlashCommand(interaction);
        break;
      default:
        await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }
  } catch (error) {
    logger.error(`Error handling slash command: ${error.message}`);
    const errorMessage = 'An error occurred while processing your command.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
});

// Message event handler
client.on('messageCreate', async (message) => {
  if (!shouldProcessMessage(message)) return;

  // Spam detection for images
  await detectImageSpam(message);
  
  // Spam detection for links
  await detectLinkSpam(message);

  // Check if message starts with prefix (legacy command support)
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
          message.reply(`Unknown command. Use slash commands instead: /search, /info, /location`);
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

    // Delay based on word count (simulate typing duration)
    const wordCount = reply.split(/\s+/).length;
    const typingDuration = Math.min(8000, wordCount * 150 + Math.random() * 500);
    await new Promise(res => setTimeout(res, typingDuration));

    await message.reply(reply);
  }
});

// Spam detection for images
async function detectImageSpam(message) {
  if (!message.guild) return; // Only work in guilds
  
  const userId = message.author.id;
  const imageCount = message.attachments.filter(att => 
    att.contentType && att.contentType.startsWith('image/')
  ).size;
  
  if (imageCount === 0) return;
  
  // Initialize tracking for user if not exists
  if (!userSpamTracking.has(userId)) {
    userSpamTracking.set(userId, { images: [], links: [] });
  }
  
  const tracking = userSpamTracking.get(userId);
  const now = Date.now();
  
  // Clean old entries (older than 30 seconds)
  tracking.images = tracking.images.filter(entry => now - entry.timestamp < 30000);
  
  // Add current message
  tracking.images.push({
    channelId: message.channel.id,
    imageCount: imageCount,
    timestamp: now,
    messageId: message.id
  });
  
  // Check if user sent 4+ images across multiple channels
  const uniqueChannels = new Set(tracking.images.map(entry => entry.channelId));
  const totalImages = tracking.images.reduce((sum, entry) => sum + entry.imageCount, 0);
  
  if (totalImages >= 4 && uniqueChannels.size > 1) {
    await handleSpamDetection(message, 'image spam', `Sent ${totalImages} images across ${uniqueChannels.size} channels`);
    userSpamTracking.delete(userId); // Clear tracking after ban
  }
}

// Spam detection for links
async function detectLinkSpam(message) {
  if (!message.guild) return; // Only work in guilds
  
  const userId = message.author.id;
  
  // Detect links in message (simple regex)
  const linkRegex = /(https?:\/\/[^\s]+)/gi;
  const links = message.content.match(linkRegex) || [];
  const linkCount = links.length;
  
  if (linkCount === 0) return;
  
  // Initialize tracking for user if not exists
  if (!userSpamTracking.has(userId)) {
    userSpamTracking.set(userId, { images: [], links: [] });
  }
  
  const tracking = userSpamTracking.get(userId);
  const now = Date.now();
  
  // Clean old entries (older than 30 seconds)
  tracking.links = tracking.links.filter(entry => now - entry.timestamp < 30000);
  
  // Add current message
  tracking.links.push({
    channelId: message.channel.id,
    linkCount: linkCount,
    timestamp: now,
    messageId: message.id
  });
  
  // Check if user sent 4+ links in one message OR across multiple channels
  if (linkCount >= 4) {
    await handleSpamDetection(message, 'link spam', `Sent ${linkCount} links in one message`);
    userSpamTracking.delete(userId); // Clear tracking after ban
    return;
  }
  
  // Check across multiple channels
  const uniqueChannels = new Set(tracking.links.map(entry => entry.channelId));
  const totalLinks = tracking.links.reduce((sum, entry) => sum + entry.linkCount, 0);
  
  if (totalLinks >= 4 && uniqueChannels.size > 1) {
    await handleSpamDetection(message, 'link spam', `Sent ${totalLinks} links across ${uniqueChannels.size} channels`);
    userSpamTracking.delete(userId); // Clear tracking after ban
  }
}

// Handle spam detection and auto-ban
async function handleSpamDetection(message, spamType, reason) {
  try {
    const member = message.member;
    if (!member) return;
    
    // Check if bot has permission to ban
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
      logger.warn(`Cannot ban ${member.user.tag}: Missing BAN_MEMBERS permission`);
      return;
    }
    
    // Don't ban admins or moderators
    if (member.permissions.has(PermissionFlagsBits.Administrator) || 
        member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      logger.info(`Spam detected from ${member.user.tag} but user has admin/mod permissions`);
      return;
    }
    
    // Log the spam detection
    logger.warn(`🚨 SPAM DETECTED: ${member.user.tag} (${member.id}) - ${spamType}: ${reason}`);
    
    // Try to notify in the channel
    try {
      await message.channel.send(`🚨 **Spam detected**: ${member.user.tag} has been automatically banned for ${spamType}.`);
    } catch (err) {
      logger.error(`Could not send spam notification: ${err.message}`);
    }
    
    // Ban the user
    await member.ban({ 
      reason: `Auto-ban: ${spamType} - ${reason}`,
      deleteMessageSeconds: 60 * 60 * 24 // Delete messages from last 24 hours
    });
    
    logger.info(`✅ Successfully banned ${member.user.tag} for ${spamType}`);
  } catch (error) {
    logger.error(`Error handling spam detection: ${error.message}`);
  }
}

// Determine whether to process an incoming message
function shouldProcessMessage(message) {
  // Never respond to our own messages
  if (message.author.id === client.user?.id) {
    if (DEBUG) console.log('DEBUG: Ignoring own message');
    return false;
  }

  // If author is a bot, only process when FRIENDLY_FIRE is enabled
  if (message.author.bot) {
    if (!FRIENDLY_FIRE) {
      if (DEBUG) console.log(`DEBUG: Ignoring bot message from ${message.author.tag} (FRIENDLY_FIRE off)`);
      return false;
    }
    if (DEBUG) console.log(`DEBUG: Processing bot message from ${message.author.tag} (FRIENDLY_FIRE on)`);
  }

  return true;
}

// Bot status updater
function updateBotStatus() {
  const randomStatus = config.statusMessages[Math.floor(Math.random() * config.statusMessages.length)];
  client.user.setActivity(randomStatus, { type: ActivityType.Watching });
}

// Slash command handlers
async function handleSearchSlashCommand(interaction) {
  const query = interaction.options.getString('query');
  
  await interaction.deferReply();
  
  try {
    const unionCraxResult = await searchGoogleForUnionCraxGames(query);

    if (unionCraxResult) {
      const embed = new EmbedBuilder()
        .setTitle(`🎮 ${unionCraxResult.title}`)
        .setURL(unionCraxResult.url)
        .setColor(0x0099ff)
        .setDescription(unionCraxResult.description || 'No description available')
        .addFields(
          { name: 'Source', value: unionCraxResult.source, inline: true },
          { name: 'Downloads', value: unionCraxResult.downloadCount ? String(unionCraxResult.downloadCount) : 'N/A', inline: true },
          { name: 'Size', value: unionCraxResult.size || 'N/A', inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Game search result from UnionCrax' });

      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.editReply(`🔍 No matching games found on UnionCrax for: **${query}**`);
    }
  } catch (error) {
    logger.error(`Search error: ${error.message}`);
    await interaction.editReply('❌ An error occurred during the search. Please try again.');
  }
}

async function handleInfoSlashCommand(interaction) {
  const uptime = Date.now() - START_TIME;
  const hours = Math.floor(uptime / 3600000);
  const minutes = Math.floor((uptime % 3600000) / 60000);
  const seconds = Math.floor((uptime % 60000) / 1000);

  let dbStats = null;
  if (isSemanticMode && ENABLE_DATABASE) {
    dbStats = await semanticContextManager.getStatistics();
  }

  const embed = new EmbedBuilder()
      .setTitle('UC-AIv2 Info')
      .setColor(0x00ff00)
      .addFields(
          { name: 'Model', value: AI_MODEL, inline: true },
          { name: 'Mode', value: isSemanticMode ? 'Semantic' : 'Simple', inline: true },
          { name: 'Uptime', value: `${hours}h ${minutes}m ${seconds}s`, inline: true }
      );

  if (ENABLE_DATABASE) {
    embed.addFields({ name: 'Database', value: 'Enabled', inline: true });
    if (dbStats) {
      embed.addFields(
          { name: 'Total Messages', value: dbStats.total_messages, inline: true },
          { name: 'With Embeddings', value: dbStats.messages_with_embeddings, inline: true },
          { name: 'Channels', value: dbStats.unique_channels, inline: true }
      );
    }
  } else {
    embed.addFields({ name: 'Database', value: 'Disabled', inline: true });
  }

  embed.addFields(
    { name: 'Mentions Enabled', value: ENABLE_MENTIONS ? 'Yes' : 'No', inline: true }
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleLocationSlashCommand(interaction) {
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

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    logger.error(`Location command error: ${error.message}`);
    await interaction.reply({ content: '❌ An error occurred while getting location information.', ephemeral: true });
  }
}

// Legacy command handlers (for prefix commands)
async function handleSearchCommand(message, args) {
  if (args.length === 0) {
    return message.reply('Please provide a search query. Usage: `!search <query>` or use `/search` slash command');
  }

  const query = args.join(' ');
  const searchMessage = await message.reply(`🔍 Searching UnionCrax for: **${query}**...`);

  try {
    const unionCraxResult = await searchGoogleForUnionCraxGames(query);

    if (unionCraxResult) {
      await searchMessage.edit(`🔍 Found result on UnionCrax for: **${query}**`);

      const embed = new EmbedBuilder()
        .setTitle(`🎮 ${unionCraxResult.title}`)
        .setURL(unionCraxResult.url)
        .setColor(0x0099ff)
        .setDescription(unionCraxResult.description || 'No description available')
        .addFields(
          { name: 'Source', value: unionCraxResult.source, inline: true },
          { name: 'Downloads', value: unionCraxResult.downloadCount ? String(unionCraxResult.downloadCount) : 'N/A', inline: true },
          { name: 'Size', value: unionCraxResult.size || 'N/A', inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Game search result from UnionCrax' });

      await message.channel.send({ embeds: [embed] });
    } else {
      await searchMessage.edit(`🔍 No matching games found on UnionCrax for: **${query}**`);
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

    const $ = load(response.data);
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

async function handleInfoCommand(message) {
  const uptime = Date.now() - START_TIME;
  const hours = Math.floor(uptime / 3600000);
  const minutes = Math.floor((uptime % 3600000) / 60000);
  const seconds = Math.floor((uptime % 60000) / 1000);

  let dbStats = null;
  if (isSemanticMode && ENABLE_DATABASE) {
    dbStats = await semanticContextManager.getStatistics();
  }

  const embed = new EmbedBuilder()
      .setTitle('UC-AIv2 Info')
      .setColor(0x00ff00)
      .addFields(
          { name: 'Model', value: AI_MODEL, inline: true },
          { name: 'Mode', value: isSemanticMode ? 'Semantic' : 'Simple', inline: true },
          { name: 'Uptime', value: `${hours}h ${minutes}m ${seconds}s`, inline: true }
      );

  if (ENABLE_DATABASE) {
    embed.addFields({ name: 'Database', value: 'Enabled', inline: true });
    if (dbStats) {
      embed.addFields(
          { name: 'Total Messages', value: dbStats.total_messages, inline: true },
          { name: 'With Embeddings', value: dbStats.messages_with_embeddings, inline: true },
          { name: 'Channels', value: dbStats.unique_channels, inline: true }
      );
    }
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

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down, bye-byee...');
  if (ENABLE_DATABASE) {
    await closeDatabase();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down, bye-byee...');
  if (ENABLE_DATABASE) {
    await closeDatabase();
  }
  process.exit(0);
});

// Login to Discord
client.login(DISCORD_TOKEN)
  .then(() => logger.info('Bot login successful'))
  .catch(error => logger.error(`Bot login failed: ${error.message}`));

// Export client for testing
export default client;
