// Load env
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Collection,
  ActivityType,
  EmbedBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import axios from 'axios';
import { load } from 'cheerio';
import winston from 'winston';

// Import helper modules
import { 
  testConnection, 
  initializeDatabase, 
  closeDatabase,
  setBirthday,
  getBirthday,
  removeBirthday,
  getTodaysBirthdays,
  markBirthdayAsPinged
} from './database.js';
import { testEmbeddingService } from './embeddings.js';
import semanticContextManager from './context-manager.js';
import musicManager from './music-manager.js';

// ─── Configuration ────────────────────────────────────────────────────────────
const DISCORD_TOKEN          = process.env.DISCORD_TOKEN;
const GUILD_ID               = process.env.GUILD_ID;
const CHANNEL_ID             = process.env.CHANNEL_ID;
const LOCAL                  = process.env.LOCAL === 'true';
const AI_MODEL               = process.env.AI_MODEL;
const OPENROUTER_API_KEY     = process.env.OPENROUTER_API_KEY;
const RANDOM_RESPONSE_CHANCE = parseFloat(process.env.RANDOM_RESPONSE_CHANCE || '0.1');
const PROMPT                 = process.env.PROMPT || '';
const DEBUG                  = process.env.DEBUG === 'true';
const ENABLE_MENTIONS        = process.env.ENABLE_MENTIONS === 'true';
const ENABLE_SEMANTIC_SEARCH = process.env.ENABLE_SEMANTIC_SEARCH === 'true';
const ENABLE_DATABASE        = process.env.ENABLE_DATABASE === 'true';
const DATABASE_TYPE          = process.env.DATABASE_TYPE || 'sqlite';
const DATABASE_URL           = process.env.DATABASE_URL;
const FRIENDLY_FIRE          = process.env.FRIENDLY_FIRE === 'true';
const SPAM_DETECTION_ENABLED = process.env.SPAM_DETECTION_ENABLED !== 'false'; // default ON
const MOD_LOG_CHANNEL_ID     = process.env.MOD_LOG_CHANNEL_ID || null;

// Spam detection thresholds (configurable via env)
const SPAM_IMAGE_THRESHOLD   = parseInt(process.env.SPAM_IMAGE_THRESHOLD  || '4', 10);
const SPAM_LINK_THRESHOLD    = parseInt(process.env.SPAM_LINK_THRESHOLD   || '4', 10);
const SPAM_WINDOW_MS         = parseInt(process.env.SPAM_WINDOW_MS        || '30000', 10);

const START_TIME = Date.now();
let lastResponseTime = 0;
let isSemanticMode = false;

// ─── Spam detection tracking ──────────────────────────────────────────────────
const userSpamTracking = new Map(); // userId -> { images: [], links: [] }

// ─── Bot configuration ────────────────────────────────────────────────────────
const config = {
  prefix: process.env.BOT_PREFIX || '!',
  searchEngine: process.env.SEARCH_ENGINE || 'https://www.google.com/search?q=',
  statusMessages: [
    'no dont do that, dont stick your hand in',
    'no tennis balls',
    'contact @vee.anti for help or smth',
    "I'm just doing this to learn pretty much.",
    'meow',
    'welcome to the machine',
  ],
};

// ─── Logger ───────────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/bot.log' }),
  ],
});

// ─── Discord client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.commands = new Collection();

// ─── Slash command definitions ────────────────────────────────────────────────
// Using raw JSON objects so they work with both v13 and v14 REST API
const commands = [
  {
    name: 'search',
    description: 'Search UnionCrax for games',
    options: [
      {
        name: 'query',
        description: 'The game to search for',
        type: 3, // STRING
        required: true,
      },
    ],
    integration_types: [0, 1], // GUILD_INSTALL, USER_INSTALL
    contexts: [0, 1, 2],       // GUILD, BOT_DM, PRIVATE_CHANNEL
  },
  {
    name: 'info',
    description: 'Get information about the bot',
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: 'birthday',
    description: 'Manage your birthday',
    options: [
      {
        name: 'set',
        description: 'Set your birthday or a user\'s birthday (Admins/Mods only)',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'month',
            description: 'The month of the birthday (1-12)',
            type: 4, // INTEGER
            required: true,
            min_value: 1,
            max_value: 12,
          },
          {
            name: 'day',
            description: 'The day of the birthday (1-31)',
            type: 4, // INTEGER
            required: true,
            min_value: 1,
            max_value: 31,
          },
          {
            name: 'year',
            description: 'The year of the birthday (optional)',
            type: 4, // INTEGER
            required: false,
            min_value: 1900,
            max_value: new Date().getFullYear(),
          },
          {
            name: 'user',
            description: 'The user to set the birthday for (Admins/Mods only)',
            type: 6, // USER
            required: false,
          },
        ],
      },
      {
        name: 'remove',
        description: 'Remove your birthday or a user\'s birthday (Admins/Mods only)',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'user',
            description: 'The user to remove the birthday for (Admins/Mods only)',
            type: 6, // USER
            required: false,
          },
        ],
      },
      {
        name: 'get',
        description: 'See your stored birthday or a user\'s birthday (Admins/Mods only)',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'user',
            description: 'The user to see the birthday for (Admins/Mods only)',
            type: 6, // USER
            required: false,
          },
        ],
      },
    ],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: 'location',
    description: 'Get bot location and system information',
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: 'ping',
    description: 'Check the bot\'s latency and API response time',
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: 'ask',
    description: 'Ask the AI a question directly',
    options: [
      {
        name: 'question',
        description: 'Your question for the AI',
        type: 3, // STRING
        required: true,
      },
    ],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: 'stats',
    description: 'Show server statistics',
    integration_types: [0], // Guild only
    contexts: [0],
  },
  {
    name: 'play',
    description: 'Play music from YouTube, Spotify, or SoundCloud',
    options: [
      {
        name: 'query',
        description: 'The song name or URL',
        type: 3, // STRING
        required: true,
      },
    ],
    integration_types: [0],
    contexts: [0],
  },
  {
    name: 'stop',
    description: 'Stop the music and clear the queue',
    integration_types: [0],
    contexts: [0],
  },
  {
    name: 'skip',
    description: 'Skip the current song',
    integration_types: [0],
    contexts: [0],
  },
  {
    name: 'queue',
    description: 'Show the current music queue',
    integration_types: [0],
    contexts: [0],
  },
  {
    name: 'nowplaying',
    description: 'Show what is currently playing',
    integration_types: [0],
    contexts: [0],
  },
  {
    name: 'pause',
    description: 'Pause the current song',
    integration_types: [0],
    contexts: [0],
  },
  {
    name: 'resume',
    description: 'Resume the current song',
    integration_types: [0],
    contexts: [0],
  },
  {
    name: 'volume',
    description: 'Change the music volume',
    options: [
      {
        name: 'volume',
        description: 'Volume level (0-100)',
        type: 4, // INTEGER
        required: true,
        min_value: 0,
        max_value: 100,
      },
    ],
    integration_types: [0],
    contexts: [0],
  },
  {
    name: 'loop',
    description: 'Set the loop mode',
    options: [
      {
        name: 'mode',
        description: 'Loop mode',
        type: 3, // STRING
        required: true,
        choices: [
          { name: 'Off', value: 'none' },
          { name: 'Song', value: 'song' },
          { name: 'Queue', value: 'queue' },
        ],
      },
    ],
    integration_types: [0],
    contexts: [0],
  },
  {
    name: 'shuffle',
    description: 'Shuffle the music queue',
    integration_types: [0],
    contexts: [0],
  },
  {
    name: 'remove',
    description: 'Remove a song from the queue',
    options: [
      {
        name: 'index',
        description: 'The index of the song to remove',
        type: 4, // INTEGER
        required: true,
        min_value: 1,
      },
    ],
    integration_types: [0],
    contexts: [0],
  },
  {
    name: 'clear',
    description: 'Clear the music queue',
    integration_types: [0],
    contexts: [0],
  },
  {
    name: 'help',
    description: 'Show all available commands and their descriptions',
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
];

// ─── Register slash commands ──────────────────────────────────────────────────
async function registerSlashCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

    logger.info('Started refreshing application (/) commands.');
    console.log('🔄 Registering slash commands...');

    // Register globally (supports both guild install and user install)
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );

    // Also register to the home guild for instant updates during development
    if (GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, GUILD_ID),
        { body: commands }
      );
      console.log(`✅ Registered guild commands to ${GUILD_ID} (instant update).`);
    }

    console.log('✅ Successfully registered application commands globally.');
    logger.info('Slash commands registered successfully.');
  } catch (error) {
    logger.error(`Error registering slash commands: ${error.message}`);
    console.error('❌ Error registering slash commands:', error);
  }
}

// ─── AI Response Function ─────────────────────────────────────────────────────
async function generateAMResponse(userInput, channelId, guildId, discordMessageId, authorId, authorName) {
  try {
    let contextText = '';

    if (isSemanticMode && semanticContextManager.isReady()) {
      const relevantContext = await semanticContextManager.getRelevantContext(userInput, guildId, authorId);

      relevantContext.slice(-10).forEach((msg) => {
        const speaker = msg.type === 'assistant' ? 'AM' : msg.author;
        const similarity = msg.similarity ? ` (relevance: ${(msg.similarity * 100).toFixed(1)}%)` : '';
        contextText += `${speaker}: ${msg.content}${similarity}\n`;
      });

      if (DEBUG) {
        console.log(`🔍 Used semantic context: ${relevantContext.length} relevant messages`);
      }
    }

    const promptText = `${PROMPT}\n\n${contextText}Human: ${userInput}\nAM:`;

    let reply = '';

    if (LOCAL) {
      throw new Error('Local model not supported in Node.js version.');
    } else {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: AI_MODEL,
          messages: [
            { role: 'system', content: PROMPT },
            { role: 'user', content: `${promptText}\nKeep your response under 3 sentences.` },
          ],
          temperature: 0.7,
          max_tokens: 120,
        },
        {
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
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
      await semanticContextManager.storeUserMessage({
        discordMessageId,
        content: userInput,
        authorId,
        authorName,
        channelId,
        guildId,
      });

      const assistantMessageId = `assistant_${discordMessageId}`;
      await semanticContextManager.storeAssistantMessage({
        discordMessageId: assistantMessageId,
        content: reply,
        channelId,
        guildId,
      });
    }

    return reply;
  } catch (err) {
    logger.error(`Error generating AI response: ${err.message}`);
    return 'I am experiencing technical difficulties. How annoying.';
  }
}

// ─── Initialize System ────────────────────────────────────────────────────────
async function initializeSystem() {
  console.log('🚀 Initializing UC-AIv2...');

  if (!ENABLE_DATABASE) {
    console.log('⚠️  Database DISABLED');
    console.log('   - Running in Simple Mode (no database)');
    console.log('   - Basic conversation without memory');
    return;
  }

  if (ENABLE_SEMANTIC_SEARCH) {
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.warn('⚠️  Database connection failed, falling back to simple mode');
      isSemanticMode = false;
    } else {
      const schemaInitialized = await initializeDatabase();
      if (!schemaInitialized) {
        console.warn('⚠️  Database schema initialization failed, falling back to simple mode');
        isSemanticMode = false;
      } else {
        const embeddingWorking = await testEmbeddingService();
        if (!embeddingWorking) {
          console.warn('⚠️  Embedding service test failed, but continuing with fallback embeddings');
        }

        const contextInitialized = await semanticContextManager.initialize();
        if (contextInitialized) {
          isSemanticMode = true;
        } else {
          console.warn('⚠️  Semantic context manager initialization failed, falling back to simple mode');
          isSemanticMode = false;
        }
      }
    }
  } else {
    // Basic database initialization for non-semantic features like birthdays
    const dbConnected = await testConnection();
    if (dbConnected) {
      await initializeDatabase();
      console.log('✅ Database initialized for basic features (Birthdays, etc.)');
    }
  }

  if (isSemanticMode) {
    console.log('✅ Semantic Context Mode ENABLED');
    console.log(`   - Using ${DATABASE_TYPE.toUpperCase()} for message storage`);
    if (DATABASE_TYPE === 'sqlite') console.log(`   - Storage path: ${process.env.SQLITE_PATH || './database.sqlite'}`);
    console.log('   - Using text-based similarity for semantic search');
    console.log('   - Context-aware responses based on message similarity');
  } else if (ENABLE_DATABASE) {
    console.log('ℹ️  Simple Mode ENABLED (no semantic context)');
    console.log(`   - Using ${DATABASE_TYPE.toUpperCase()} for basic storage`);
  } else {
    console.log('ℹ️  Simple Mode ENABLED (no database)');
    console.log('   - No conversation memory');
  }
}

// ─── Bot ready event ──────────────────────────────────────────────────────────
client.once('ready', async () => {
  logger.info(`Logged in as ${client.user.tag}!`);
  console.log(`\n✅ Logged in as ${client.user.tag} — Let's get this bread started`);

  await initializeSystem();
  await registerSlashCommands();

  const mode = isSemanticMode ? 'Semantic' : 'Simple';
  console.log(`ℹ️  Running in ${mode} Mode\n`);

  updateBotStatus();
  setInterval(updateBotStatus, 30000);

  // Periodically purge stale spam-tracking entries to prevent memory leaks
  setInterval(() => {
    const now = Date.now();
    for (const [userId, tracking] of userSpamTracking.entries()) {
      tracking.images = tracking.images.filter(e => now - e.timestamp < SPAM_WINDOW_MS);
      tracking.links  = tracking.links.filter(e => now - e.timestamp < SPAM_WINDOW_MS);
      if (tracking.images.length === 0 && tracking.links.length === 0) {
        userSpamTracking.delete(userId);
      }
    }
    if (DEBUG) console.log(`DEBUG: Spam tracking map size after cleanup: ${userSpamTracking.size}`);
  }, 60000); // run every minute

  // Check for birthdays once an hour
  if (ENABLE_DATABASE) {
    checkBirthdays();
    setInterval(checkBirthdays, 3600000);
  }
});

// ─── Interaction handler ──────────────────────────────────────────────────────
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
      case 'ping':
        await handlePingSlashCommand(interaction);
        break;
      case 'ask':
        await handleAskSlashCommand(interaction);
        break;
      case 'stats':
        await handleStatsSlashCommand(interaction);
        break;
      case 'help':
        await handleHelpSlashCommand(interaction);
        break;
      case 'birthday':
        await handleBirthdaySlashCommand(interaction);
        break;
      case 'play':
        await musicManager.handlePlay(interaction);
        break;
      case 'stop':
        await musicManager.handleStop(interaction);
        break;
      case 'skip':
        await musicManager.handleSkip(interaction);
        break;
      case 'queue':
        await musicManager.handleQueue(interaction);
        break;
      case 'nowplaying':
        await musicManager.handleNowPlaying(interaction);
        break;
      case 'pause':
        await musicManager.handlePause(interaction);
        break;
      case 'resume':
        await musicManager.handleResume(interaction);
        break;
      case 'volume':
        await musicManager.handleVolume(interaction);
        break;
      case 'loop':
        await musicManager.handleLoop(interaction);
        break;
      case 'shuffle':
        await musicManager.handleShuffle(interaction);
        break;
      case 'remove':
        await musicManager.handleRemove(interaction);
        break;
      case 'clear':
        await musicManager.handleClear(interaction);
        break;
      default:
        await interaction.reply({ content: '❓ Unknown command.', flags: [MessageFlags.Ephemeral] });
    }
  } catch (error) {
    logger.error(`Error handling slash command "${commandName}": ${error.message}`);
    const errorMessage = '❌ An error occurred while processing your command.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, flags: [MessageFlags.Ephemeral] });
    } else {
      await interaction.reply({ content: errorMessage, flags: [MessageFlags.Ephemeral] });
    }
  }
});

// ─── Message event handler ────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  // Run spam detection for ALL non-bot guild messages, regardless of other filters
  if (SPAM_DETECTION_ENABLED && message.guild && !message.author.bot) {
    await detectImageSpam(message);
    await detectLinkSpam(message);
  }

  if (!shouldProcessMessage(message)) return;

  // Legacy prefix commands
  if (message.content.startsWith(config.prefix)) {
    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    try {
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
          message.reply(`❓ Unknown command. Use slash commands: /search, /info, /location, /ping, /ask, /stats, /help`);
      }
    } catch (error) {
      logger.error(`Error handling prefix command: ${error.message}`);
      message.reply('❌ An error occurred while processing your command.');
    }
  }

  // AI Response Handling
  const isCorrectChannel = message.channel.id === CHANNEL_ID;
  const isMentioned = message.mentions.has(client.user);
  
  const currentTime = Date.now();
  let shouldRespond = false;

  if (isMentioned) {
    // Respond to pings in ANY server
    shouldRespond = true;
  } else if (isCorrectChannel) {
    // Respond randomly in the designated channel
    if (Math.random() < RANDOM_RESPONSE_CHANCE && currentTime - lastResponseTime > 10000) {
      shouldRespond = true;
      lastResponseTime = currentTime;
    }
  }

  if (shouldRespond) {
    let userInput = message.content;

    if (message.reference) {
      try {
        const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
        userInput = `(In response to '${repliedTo.content}') ${userInput}`;
      } catch (err) {
        if (DEBUG) console.log(`DEBUG: Could not fetch replied message: ${err}`);
      }
    }

    const preTypingDelay = Math.floor(Math.random() * 2000) + 1000;
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

    const wordCount = reply.split(/\s+/).length;
    const typingDuration = Math.min(8000, wordCount * 150 + Math.random() * 500);
    await new Promise(res => setTimeout(res, typingDuration));

    await message.reply(reply);
  }
});

// ─── Spam detection ───────────────────────────────────────────────────────────
async function detectImageSpam(message) {
  if (!message.guild) return;

  const userId = message.author.id;
  // Count image attachments (including GIFs and other image types)
  const imageCount = message.attachments.filter(att =>
    att.contentType && att.contentType.startsWith('image/')
  ).size;

  if (imageCount === 0) return;

  if (!userSpamTracking.has(userId)) {
    userSpamTracking.set(userId, { images: [], links: [] });
  }

  const tracking = userSpamTracking.get(userId);
  const now = Date.now();

  // Slide the window
  tracking.images = tracking.images.filter(entry => now - entry.timestamp < SPAM_WINDOW_MS);
  tracking.images.push({ channelId: message.channel.id, imageCount, timestamp: now, messageId: message.id });

  const uniqueChannels = new Set(tracking.images.map(entry => entry.channelId));
  const totalImages    = tracking.images.reduce((sum, entry) => sum + entry.imageCount, 0);

  if (DEBUG) {
    console.log(`DEBUG [ImageSpam] ${message.author.tag}: ${totalImages} images across ${uniqueChannels.size} channel(s) in last ${SPAM_WINDOW_MS / 1000}s`);
  }

  // Trigger: threshold images sent across more than one channel within the window
  if (totalImages >= SPAM_IMAGE_THRESHOLD && uniqueChannels.size > 1) {
    await handleSpamDetection(
      message,
      'image spam',
      `Sent ${totalImages} image(s) across ${uniqueChannels.size} channels within ${SPAM_WINDOW_MS / 1000}s`
    );
    userSpamTracking.delete(userId);
  }
}

async function detectLinkSpam(message) {
  if (!message.guild) return;

  const userId    = message.author.id;
  const linkRegex = /(https?:\/\/[^\s]+)/gi;
  const links     = message.content.match(linkRegex) || [];
  const linkCount = links.length;

  if (linkCount === 0) return;

  if (!userSpamTracking.has(userId)) {
    userSpamTracking.set(userId, { images: [], links: [] });
  }

  const tracking = userSpamTracking.get(userId);
  const now = Date.now();

  // Slide the window
  tracking.links = tracking.links.filter(entry => now - entry.timestamp < SPAM_WINDOW_MS);
  tracking.links.push({ channelId: message.channel.id, linkCount, timestamp: now, messageId: message.id });

  if (DEBUG) {
    const uniqueCh   = new Set(tracking.links.map(e => e.channelId));
    const totalLinks = tracking.links.reduce((sum, e) => sum + e.linkCount, 0);
    console.log(`DEBUG [LinkSpam] ${message.author.tag}: ${totalLinks} links across ${uniqueCh.size} channel(s) in last ${SPAM_WINDOW_MS / 1000}s`);
  }

  // Trigger 1: threshold or more links in a single message (mass-link blast)
  if (linkCount >= SPAM_LINK_THRESHOLD) {
    await handleSpamDetection(
      message,
      'link spam',
      `Sent ${linkCount} link(s) in a single message`
    );
    userSpamTracking.delete(userId);
    return;
  }

  // Trigger 2: threshold or more links spread across multiple channels within the window
  const uniqueChannels = new Set(tracking.links.map(entry => entry.channelId));
  const totalLinks     = tracking.links.reduce((sum, entry) => sum + entry.linkCount, 0);

  if (totalLinks >= SPAM_LINK_THRESHOLD && uniqueChannels.size > 1) {
    await handleSpamDetection(
      message,
      'link spam',
      `Sent ${totalLinks} link(s) across ${uniqueChannels.size} channels within ${SPAM_WINDOW_MS / 1000}s`
    );
    userSpamTracking.delete(userId);
  }
}

async function handleSpamDetection(message, spamType, reason) {
  try {
    const member = message.member;
    if (!member) return;

    // Ensure the bot has permission to ban
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
      logger.warn(`Cannot ban ${member.user.tag}: Missing BAN_MEMBERS permission`);
      return;
    }

    // Never auto-ban admins or moderators
    if (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ModerateMembers)
    ) {
      logger.info(`Spam detected from ${member.user.tag} but user has admin/mod permissions — skipping auto-ban`);
      return;
    }

    logger.warn(`🚨 SPAM DETECTED: ${member.user.tag} (${member.id}) - ${spamType}: ${reason}`);

    // Notify the channel where spam was detected
    try {
      await message.channel.send(
        `🚨 **Auto-moderation**: <@${member.id}> has been automatically banned for **${spamType}**.\n> ${reason}`
      );
    } catch (err) {
      logger.error(`Could not send spam notification to channel: ${err.message}`);
    }

    // Execute the ban (delete last 24 h of messages)
    await member.ban({
      reason: `[Auto-ban] ${spamType} — ${reason}`,
      deleteMessageSeconds: 60 * 60 * 24,
    });

    logger.info(`✅ Successfully banned ${member.user.tag} (${member.id}) for ${spamType}`);

    // Post a detailed embed to the mod-log channel if configured
    if (MOD_LOG_CHANNEL_ID) {
      try {
        const modLogChannel = await client.channels.fetch(MOD_LOG_CHANNEL_ID);
        if (modLogChannel && modLogChannel.isTextBased()) {
          const banEmbed = new EmbedBuilder()
            .setTitle('🔨 Auto-Ban — Spam Detection')
            .setColor(0xff0000)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
              { name: '👤 User',       value: `${member.user.tag} (<@${member.id}>)`, inline: true  },
              { name: '🆔 User ID',    value: member.id,                              inline: true  },
              { name: '🚫 Spam Type',  value: spamType,                               inline: true  },
              { name: '📋 Reason',     value: reason,                                 inline: false },
              { name: '📢 Channel',    value: `<#${message.channel.id}>`,             inline: true  },
              { name: '⏱️ Window',     value: `${SPAM_WINDOW_MS / 1000}s`,            inline: true  },
              { name: '🕐 Detected',   value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
            )
            .setFooter({ text: 'Auto-moderation system' })
            .setTimestamp();

          await modLogChannel.send({ embeds: [banEmbed] });
        }
      } catch (err) {
        logger.error(`Could not post to mod-log channel: ${err.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error handling spam detection: ${error.message}`);
  }
}

// ─── Utility helpers ──────────────────────────────────────────────────────────
function shouldProcessMessage(message) {
  if (message.author.id === client.user?.id) {
    if (DEBUG) console.log('DEBUG: Ignoring own message');
    return false;
  }

  if (message.author.bot) {
    if (!FRIENDLY_FIRE) {
      if (DEBUG) console.log(`DEBUG: Ignoring bot message from ${message.author.tag} (FRIENDLY_FIRE off)`);
      return false;
    }
    if (DEBUG) console.log(`DEBUG: Processing bot message from ${message.author.tag} (FRIENDLY_FIRE on)`);
  }

  return true;
}

function updateBotStatus() {
  const randomStatus = config.statusMessages[Math.floor(Math.random() * config.statusMessages.length)];
  client.user.setActivity(randomStatus, { type: ActivityType.Watching });
}

async function checkBirthdays() {
  if (!ENABLE_DATABASE) return;

  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1; // getMonth is 0-indexed
  const year = now.getFullYear();

  try {
    const birthdays = await getTodaysBirthdays(day, month, year);
    if (birthdays.length === 0) return;

    // Use the configured CHANNEL_ID if available
    if (!CHANNEL_ID) {
      logger.warn('CHANNEL_ID not configured. Skipping birthday announcements.');
      return;
    }

    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel) {
      logger.warn(`Could not find channel ${CHANNEL_ID} for birthday announcements.`);
      return;
    }

    for (const bday of birthdays) {
      try {
        const ageStr = bday.year ? ` (turning ${year - bday.year})` : '';
        await channel.send(`🎂 **Happy Birthday <@${bday.user_id}>!** Hope you have an amazing day! 🎉${ageStr}`);
        
        // Mark as pinged for this year
        await markBirthdayAsPinged(bday.user_id, year);
        logger.info(`Birthday pinged for ${bday.user_id}`);
      } catch (err) {
        logger.error(`Failed to send birthday message for ${bday.user_id}: ${err.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error in checkBirthdays: ${error.message}`);
  }
}

function formatUptime(ms) {
  const hours   = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${hours}h ${minutes}m ${seconds}s`;
}

// ─── Slash command handlers ───────────────────────────────────────────────────

/** /ping — latency check */
async function handlePingSlashCommand(interaction) {
  const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
  const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
  const wsLatency = client.ws.ping;

  const embed = new EmbedBuilder()
    .setTitle('🏓 Pong!')
    .setColor(wsLatency < 100 ? 0x00ff00 : wsLatency < 250 ? 0xffff00 : 0xff0000)
    .addFields(
      { name: 'Roundtrip Latency', value: `${roundtrip}ms`, inline: true },
      { name: 'WebSocket Heartbeat', value: `${wsLatency}ms`, inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ content: '', embeds: [embed] });
}

/** /ask — direct AI question */
async function handleAskSlashCommand(interaction) {
  const question = interaction.options.getString('question');

  await interaction.deferReply();

  try {
    const answer = await generateAMResponse(
      question,
      interaction.channelId,
      interaction.guildId,
      `slash_${interaction.id}`,
      interaction.user.id,
      interaction.user.username
    );

    const embed = new EmbedBuilder()
      .setTitle('🤖 AI Response')
      .setColor(0x5865f2)
      .addFields(
        { name: '❓ Question', value: question.length > 1024 ? question.slice(0, 1021) + '...' : question },
        { name: '💬 Answer',   value: answer.length > 1024 ? answer.slice(0, 1021) + '...' : answer },
      )
      .setFooter({ text: `Asked by ${interaction.user.username}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error(`Ask command error: ${error.message}`);
    await interaction.editReply('❌ Failed to get an AI response. Please try again.');
  }
}

/** /stats — server statistics */
async function handleStatsSlashCommand(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: '❌ This command can only be used in a server.', flags: [MessageFlags.Ephemeral] });
  }

  await interaction.deferReply();

  try {
    const guild = interaction.guild;
    await guild.members.fetch(); // ensure member cache is populated

    const totalMembers  = guild.memberCount;
    const onlineMembers = guild.members.cache.filter(m => m.presence?.status !== 'offline' && m.presence?.status !== undefined).size;
    const botCount      = guild.members.cache.filter(m => m.user.bot).size;
    const humanCount    = totalMembers - botCount;
    const channelCount  = guild.channels.cache.size;
    const roleCount     = guild.roles.cache.size;
    const emojiCount    = guild.emojis.cache.size;
    const boostCount    = guild.premiumSubscriptionCount ?? 0;
    const boostTier     = guild.premiumTier ?? 0;

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${guild.name} — Server Stats`)
      .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
      .setColor(0x5865f2)
      .addFields(
        { name: '👥 Total Members', value: String(totalMembers),  inline: true },
        { name: '🟢 Online',        value: String(onlineMembers), inline: true },
        { name: '🤖 Bots',          value: String(botCount),      inline: true },
        { name: '🧑 Humans',        value: String(humanCount),    inline: true },
        { name: '📢 Channels',      value: String(channelCount),  inline: true },
        { name: '🏷️ Roles',         value: String(roleCount),     inline: true },
        { name: '😀 Emojis',        value: String(emojiCount),    inline: true },
        { name: '🚀 Boosts',        value: `${boostCount} (Tier ${boostTier})`, inline: true },
        { name: '📅 Created',       value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
      )
      .setTimestamp()
      .setFooter({ text: `Server ID: ${guild.id}` });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error(`Stats command error: ${error.message}`);
    await interaction.editReply('❌ Failed to fetch server statistics.');
  }
}

/** /help — list all commands */
async function handleHelpSlashCommand(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('📖 Available Commands')
    .setColor(0x5865f2)
    .setDescription('Here are all the slash commands you can use:')
    .addFields(
      { name: '🔍 `/search <query>`', value: 'Search UnionCrax for games by name.' },
      { name: '🤖 `/ask <question>`', value: 'Ask the AI a question and get a direct response.' },
      { name: 'ℹ️ `/info`',           value: 'Show bot information: model, mode, uptime, and database stats.' },
      { name: '📊 `/stats`',          value: 'Display server statistics (members, channels, roles, etc.).' },
      { name: '🏓 `/ping`',           value: 'Check the bot\'s latency and WebSocket heartbeat.' },
      { name: '📍 `/location`',       value: 'Show the bot\'s runtime environment details.' },
      { name: '🎂 `/birthday set <month> <day> [year] [user]`', value: 'Set a birthday (Admins/Mods can set for others).' },
      { name: '🎂 `/birthday get [user]` / `remove [user]`', value: 'View or remove a stored birthday.' },
      { name: '🎵 Music Commands', value: '`/play <query>`, `/stop`, `/skip`, `/queue`, `/nowplaying`, `/pause`, `/resume`, `/volume <0-100>`, `/loop <off|song|queue>`, `/shuffle`, `/remove <index>`, `/clear`' },
      { name: '📖 `/help`',           value: 'Show this help message.' },
    )
    .setFooter({ text: 'Prefix commands also available with ' + config.prefix })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

/** /search — UnionCrax game search */
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
          { name: '🌐 Source',    value: unionCraxResult.source,                                                    inline: true },
          { name: '⬇️ Downloads', value: unionCraxResult.downloadCount ? String(unionCraxResult.downloadCount) : 'N/A', inline: true },
          { name: '💾 Size',      value: unionCraxResult.size || 'N/A',                                             inline: true },
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

/** /info — bot information */
async function handleInfoSlashCommand(interaction) {
  const uptime = Date.now() - START_TIME;

  let dbStats = null;
  if (isSemanticMode && ENABLE_DATABASE) {
    dbStats = await semanticContextManager.getStatistics();
  }

  const embed = new EmbedBuilder()
    .setTitle('🤖 UC-AIv2 Info')
    .setColor(0x00ff00)
    .addFields(
      { name: '🧠 Model',   value: AI_MODEL || 'Not configured', inline: true },
      { name: '⚙️ Mode',    value: isSemanticMode ? '🔮 Semantic' : '💬 Simple', inline: true },
      { name: '⏱️ Uptime',  value: formatUptime(uptime), inline: true },
      { name: '🗄️ Database', value: ENABLE_DATABASE ? `✅ Enabled (${DATABASE_TYPE})` : '❌ Disabled', inline: true },
      { name: '📣 Mentions', value: ENABLE_MENTIONS ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '🔍 Semantic', value: ENABLE_SEMANTIC_SEARCH ? '✅ Enabled' : '❌ Disabled', inline: true },
    );

  if (dbStats) {
    embed.addFields(
      { name: '💬 Total Messages',  value: String(dbStats.total_messages),            inline: true },
      { name: '🔗 With Embeddings', value: String(dbStats.messages_with_embeddings),  inline: true },
      { name: '📢 Channels',        value: String(dbStats.unique_channels),           inline: true },
    );
  }

  embed.setTimestamp().setFooter({ text: `Bot ID: ${client.user.id}` });

  await interaction.reply({ embeds: [embed] });
}

/** /location — runtime environment */
async function handleLocationSlashCommand(interaction) {
  try {
    const mem = process.memoryUsage();

    const embed = new EmbedBuilder()
      .setTitle('📍 Bot Location Information')
      .setColor(0x0099ff)
      .addFields(
        { name: '📁 Working Directory', value: `\`${process.cwd()}\``,                                  inline: false },
        { name: '🖥️ Platform',          value: process.platform,                                        inline: true  },
        { name: '⚙️ Architecture',      value: process.arch,                                            inline: true  },
        { name: '🟢 Node.js Version',   value: process.version,                                         inline: true  },
        { name: '🌍 Environment',       value: process.env.NODE_ENV || 'production',                    inline: true  },
        { name: '⏱️ Process Uptime',    value: `${Math.floor(process.uptime() / 60)} minutes`,          inline: true  },
        { name: '💾 Heap Used',         value: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,          inline: true  },
        { name: '💾 Heap Total',        value: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,         inline: true  },
        { name: '📦 RSS',               value: `${Math.round(mem.rss / 1024 / 1024)} MB`,               inline: true  },
      )
      .setTimestamp()
      .setFooter({ text: 'Bot runtime details' });

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    logger.error(`Location command error: ${error.message}`);
    await interaction.reply({ content: '❌ An error occurred while getting location information.', flags: [MessageFlags.Ephemeral] });
  }
}

/** /birthday — manage birthdays */
async function handleBirthdaySlashCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const targetUser = interaction.options.getUser('user') || interaction.user;
  const isSelf = targetUser.id === interaction.user.id;

  // Permission check: only admins and moderators can manage other users' birthdays
  if (!isSelf) {
    const member = interaction.member;
    const canManageOthers = member && (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ModerateMembers)
    );

    if (!canManageOthers) {
      return interaction.reply({
        content: '❌ You don\'t have permission to manage birthdays for other users. Only Administrators and Moderators can do that.',
        flags: [MessageFlags.Ephemeral]
      });
    }
  }

  if (subcommand === 'set') {
    const month = interaction.options.getInteger('month');
    const day = interaction.options.getInteger('day');
    const year = interaction.options.getInteger('year');

    // Basic date validation
    const currentYear = new Date().getFullYear();
    const daysInMonth = new Date(year || currentYear, month, 0).getDate();

    if (day > daysInMonth) {
      return interaction.reply({ content: `❌ That doesn't look like a valid date for month ${month}.`, flags: [MessageFlags.Ephemeral] });
    }

    if (!ENABLE_DATABASE) {
      return interaction.reply({ content: '❌ Birthday tracking is currently disabled (database not enabled in `.env`).', flags: [MessageFlags.Ephemeral] });
    }

    const success = await setBirthday(targetUser.id, targetUser.username, day, month, year);
    if (success) {
      const yearStr = year ? `, ${year}` : '';
      const userStr = isSelf ? 'Your' : `<@${targetUser.id}>'s`;
      await interaction.reply({
        content: `✅ ${userStr} birthday has been set to **${month}/${day}${yearStr}**!`,
        flags: [MessageFlags.Ephemeral]
      });
    } else {
      await interaction.reply({ content: '❌ Failed to save the birthday. Please try again later.', flags: [MessageFlags.Ephemeral] });
    }
  } else if (subcommand === 'remove') {
    if (!ENABLE_DATABASE) {
      return interaction.reply({ content: '❌ Birthday tracking is currently disabled.', flags: [MessageFlags.Ephemeral] });
    }
    const success = await removeBirthday(targetUser.id);
    if (success) {
      const userStr = isSelf ? 'Your' : `<@${targetUser.id}>'s`;
      await interaction.reply({ content: `✅ ${userStr} birthday has been removed from our records.`, flags: [MessageFlags.Ephemeral] });
    } else {
      await interaction.reply({ content: '❌ Failed to remove the birthday.', flags: [MessageFlags.Ephemeral] });
    }
  } else if (subcommand === 'get') {
    if (!ENABLE_DATABASE) {
      return interaction.reply({ content: '❌ Birthday tracking is currently disabled.', flags: [MessageFlags.Ephemeral] });
    }
    const birthday = await getBirthday(targetUser.id);
    if (birthday) {
      const yearStr = birthday.year ? `/${birthday.year}` : '';
      const userStr = isSelf ? 'Your stored birthday is' : `<@${targetUser.id}>'s birthday is`;
      await interaction.reply({ content: `🎂 ${userStr} **${birthday.month}/${birthday.day}${yearStr}**.`, flags: [MessageFlags.Ephemeral] });
    } else {
      const userStr = isSelf ? 'You haven\'t set your birthday yet! Use `/birthday set` to do so.' : `<@${targetUser.id}> hasn't set their birthday yet.`;
      await interaction.reply({ content: `❌ ${userStr}`, flags: [MessageFlags.Ephemeral] });
    }
  }
}

// ─── Legacy prefix command handlers ──────────────────────────────────────────

async function handleSearchCommand(message, args) {
  if (args.length === 0) {
    return message.reply('Please provide a search query. Usage: `!search <query>` or use `/search`');
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
          { name: '🌐 Source',    value: unionCraxResult.source,                                                    inline: true },
          { name: '⬇️ Downloads', value: unionCraxResult.downloadCount ? String(unionCraxResult.downloadCount) : 'N/A', inline: true },
          { name: '💾 Size',      value: unionCraxResult.size || 'N/A',                                             inline: true },
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

async function handleInfoCommand(message) {
  const uptime = Date.now() - START_TIME;

  let dbStats = null;
  if (isSemanticMode && ENABLE_DATABASE) {
    dbStats = await semanticContextManager.getStatistics();
  }

  const embed = new EmbedBuilder()
    .setTitle('🤖 UC-AIv2 Info')
    .setColor(0x00ff00)
    .addFields(
      { name: '🧠 Model',    value: AI_MODEL || 'Not configured', inline: true },
      { name: '⚙️ Mode',     value: isSemanticMode ? '🔮 Semantic' : '💬 Simple', inline: true },
      { name: '⏱️ Uptime',   value: formatUptime(uptime), inline: true },
      { name: '🗄️ Database', value: ENABLE_DATABASE ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '📣 Mentions', value: ENABLE_MENTIONS ? '✅ Enabled' : '❌ Disabled', inline: true },
    );

  if (dbStats) {
    embed.addFields(
      { name: '💬 Total Messages',  value: String(dbStats.total_messages),           inline: true },
      { name: '🔗 With Embeddings', value: String(dbStats.messages_with_embeddings), inline: true },
      { name: '📢 Channels',        value: String(dbStats.unique_channels),          inline: true },
    );
  }

  message.channel.send({ embeds: [embed] });
}

async function handleLocationCommand(message) {
  try {
    const mem = process.memoryUsage();

    const embed = new EmbedBuilder()
      .setTitle('📍 Bot Location Information')
      .setColor(0x0099ff)
      .addFields(
        { name: '📁 Working Directory', value: `\`${process.cwd()}\``,                         inline: false },
        { name: '🖥️ Platform',          value: process.platform,                               inline: true  },
        { name: '⚙️ Architecture',      value: process.arch,                                   inline: true  },
        { name: '🟢 Node.js Version',   value: process.version,                                inline: true  },
        { name: '🌍 Environment',       value: process.env.NODE_ENV || 'production',           inline: true  },
        { name: '⏱️ Process Uptime',    value: `${Math.floor(process.uptime() / 60)} minutes`, inline: true  },
        { name: '💾 Memory Usage',      value: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`, inline: true  },
      )
      .setTimestamp()
      .setFooter({ text: 'Bot runtime details' });

    message.channel.send({ embeds: [embed] });
  } catch (error) {
    logger.error(`Location command error: ${error.message}`);
    message.reply('❌ An error occurred while getting location information.');
  }
}

// ─── UnionCrax search helpers ─────────────────────────────────────────────────
const UNION_CRAX_API_BASE = 'https://union-crax.xyz';

function normalizeString(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .trim();
}

async function searchGoogleForUnionCraxGames(query) {
  try {
    const unionCraxGames = await searchUnionCraxGames(query);

    if (unionCraxGames.length === 0) return null;

    const topGame = unionCraxGames[0];
    const googleQuery = `${topGame.title} site:union-crax.xyz`;
    const googleResults = await performWebSearch(googleQuery);

    if (googleResults.length > 0) {
      return {
        title:         topGame.title,
        url:           topGame.url,
        description:   topGame.description,
        source:        'UnionCrax via Google',
        downloadCount: topGame.downloadCount,
        size:          topGame.size,
      };
    }

    return topGame;
  } catch (error) {
    logger.error(`Google search for UnionCrax games failed: ${error.message}`);
    return null;
  }
}

async function searchUnionCraxGames(query) {
  try {
    const normalizedQuery = normalizeString(query);

    const [games, gameStats] = await Promise.all([
      axios.get(`${UNION_CRAX_API_BASE}/api/games`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 10000,
      }),
      axios.get(`${UNION_CRAX_API_BASE}/api/downloads/all`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 10000,
      }),
    ]);

    const gamesData = games.data || [];
    const statsData = gameStats.data || {};

    if (!Array.isArray(gamesData) || gamesData.length === 0) return [];

    const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 2);

    const scoredGames = gamesData.map(game => {
      const normalizedName = normalizeString(game.name || '');
      const normalizedDesc = normalizeString(game.description || '');
      let score = 0;

      if (normalizedName === normalizedQuery) score += 100;
      if (normalizedName.includes(normalizedQuery) && Math.abs(normalizedName.length - normalizedQuery.length) < 10) score += 60;
      if (normalizedQuery.includes(normalizedName) && normalizedName.length > 4) score += 40;

      queryWords.forEach(word => {
        if (word.length > 3) {
          if (normalizedName.includes(word)) score += 25;
          else if (normalizedDesc.includes(word)) score += 8;
        }
      });

      if (normalizedName.startsWith(normalizedQuery)) score += 30;
      if ((game.appid && String(game.appid) === normalizedQuery) || String(game.appid) === normalizedQuery) score += 20;

      return { game, score };
    }).sort((a, b) => b.score - a.score);

    const filtered = scoredGames.filter(item => item.score >= 60);

    return filtered.slice(0, 3).map(item => {
      const game  = item.game;
      const stats = statsData[game.appid] || statsData[game.id] || {};

      return {
        title:         `${game.name} - Free Download on UnionCrax`,
        url:           `${UNION_CRAX_API_BASE}/game/${encodeURIComponent(game.appid || game.id || '')}`,
        description:   game.description || 'No description available',
        source:        'UnionCrax',
        downloadCount: stats.downloads || stats.download_count || stats.count || 0,
        size:          game.size || 'Unknown',
      };
    });
  } catch (error) {
    logger.error(`UnionCrax search failed: ${error.message}`);
    return [];
  }
}

async function performWebSearch(query) {
  try {
    const searchUrl = `${config.searchEngine}${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 10000,
    });

    const $ = load(response.data);
    const results = [];

    $('div.g').each((i, element) => {
      if (i >= 3) return;

      const titleElement       = $(element).find('h3');
      const urlElement         = $(element).find('a');
      const descriptionElement = $(element).find('div.VwiC3b');

      if (titleElement.length && urlElement.length) {
        results.push({
          title:       titleElement.text().trim(),
          url:         urlElement.attr('href'),
          description: descriptionElement.text().trim() || 'No description available',
          source:      'Web Search',
        });
      }
    });

    if (results.length === 0) {
      results.push({
        title:       `Search results for "${query}"`,
        url:         searchUrl,
        description: `Find information about ${query} on the web`,
        source:      'Web Search',
      });
    }

    return results;
  } catch (error) {
    logger.error(`Web search failed: ${error.message}`);
    return [{
      title:       `Search results for "${query}"`,
      url:         `${config.searchEngine}${encodeURIComponent(query)}`,
      description: `Could not fetch live results. Click to search for ${query}`,
      source:      'Web Search',
    }];
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown() {
  console.log('\n🛑 Shutting down, bye-byee...');
  if (ENABLE_DATABASE) {
    await closeDatabase();
  }
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

// ─── Login ────────────────────────────────────────────────────────────────────
client.login(DISCORD_TOKEN)
  .then(() => logger.info('Bot login successful'))
  .catch(error => logger.error(`Bot login failed: ${error.message}`));

export default client;
