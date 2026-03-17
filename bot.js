// Load env
import dotenv from 'dotenv';
dotenv.config();
import {
  Client,
  GatewayIntentBits,
  Collection,
  ActivityType,
  EmbedBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
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
  markBirthdayAsPinged,
  setBirthdayChannel,
  getBirthdayChannel,
  removeBirthdayChannel,
  setServerSetting,
  getServerSetting,
  getAllServerSettings,
  removeServerSetting,
  storeMessage
} from './database.js';
import { testEmbeddingService } from './embeddings.js';
import semanticContextManager from './context-manager.js';

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 1: CONFIGURATION & SETUP
 * Contains all environment variables, constants, and initialization code
 * ───────────────────────────────────────────────────────────────────────────────*/
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

const START_TIME = Date.now();
let lastResponseTime = 0;
let isSemanticMode = false;

// ─── Bot configuration ────────────────────────────────────────────────────────
const config = {
  searchEngine: process.env.SEARCH_ENGINE || 'https://www.google.com/search?q=',
  statusMessages: [
    'no dont do that, dont stick your hand in',
    'no tennis balls',
    'contact @vee.anti for help or smth',
    "I'm just doing this to learn pretty much.",
    'meow',
    'welcome to the machine',
    "ＬＥＴ＇Ｓ ＡＬＬ ＬＯＶＥ ＬＡＩＮ",
    "Check out union-crax.xyz!",
    "I am not a cat.",
    "Check out vee-anti.xyz!",
  ],
};

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 2: LOGGER SETUP
 * Winston logger configuration for console and file logging
 * ───────────────────────────────────────────────────────────────────────────────*/
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

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 3: DISCORD CLIENT INITIALIZATION
 * Creates the Discord bot client with required intents
 * ───────────────────────────────────────────────────────────────────────────────*/
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
  ],
});

client.commands = new Collection();

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 4: SLASH COMMAND DEFINITIONS
 * All /command definitions (search, info, birthday, music, etc.)
 * ───────────────────────────────────────────────────────────────────────────────*/
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
        description: 'Set your birthday to get pinged on your bday!',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'month',
            description: 'Month - XX (What month were you born in?)',
            type: 4, // INTEGER
            required: true,
          },
          {
            name: 'day',
            description: 'Day - XX (What day were you born on?)',
            type: 4, // INTEGER
            required: true,
          },
          {
            name: 'year',
            description: 'Year - XXXX (optional, only to say something like "happy 300th birthday!" if wanted)',
            type: 4, // INTEGER
            required: false,
          },
          {
            name: 'user',
            description: 'Set someone else\'s birthday (Admins/Mods only)',
            type: 6, // USER
            required: false,
          },
        ],
      },
      {
        name: 'remove',
        description: 'Remove your birthday from the database!',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'user',
            description: 'User - @username - The user to remove the birthday for (Admins/Mods only)',
            type: 6, // USER
            required: false,
          },
        ],
      },
      {
        name: 'get',
        description: 'See what the bot has saved for your birthday!',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'user',
            description: 'User - @username (Admins / Mods only)',
            type: 6, // USER
            required: false,
          },
        ],
      },
      {
        name: 'test',
        description: 'Test birthday announcements - sends to all shared servers (admin only)',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'send',
        description: 'Send birthday pings for today to all shared servers (admin only)',
        type: 1, // SUB_COMMAND
        options: [],
      },
      {
        name: 'channel',
        description: 'Set or remove the birthday announcement channel (admin only)',
        type: 2, // SUB_COMMAND_GROUP
        options: [
          {
            name: 'set',
            description: 'Set the birthday channel for this server',
            type: 1, // SUB_COMMAND
            options: [
              {
                name: 'channel',
                description: 'The channel to send birthday announcements to',
                type: 7, // CHANNEL
                required: true,
              },
            ],
          },
          {
            name: 'remove',
            description: 'Remove the birthday channel for this server',
            type: 1, // SUB_COMMAND
            options: [],
          },
          {
            name: 'get',
            description: 'Get the current birthday channel for this server',
            type: 1, // SUB_COMMAND
            options: [],
          },
        ],
      },
    ],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: 'settings',
    description: 'Manage server settings (admin only)',
    options: [
      {
        name: 'view',
        description: 'View all server settings',
        type: 1, // SUB_COMMAND
        options: [],
      },
      {
        name: 'ai_channel',
        description: 'Set the channel for AI responses',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'channel',
            description: 'The channel for AI responses (leave empty to disable)',
            type: 7, // CHANNEL
            required: false,
          },
        ],
      },
      {
        name: 'response_chance',
        description: 'Set how often the bot responds in the AI channel',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'percentage',
            description: '0.0 to 1.0 (e.g., 0.1 = 10%% chance)',
            type: 3, // STRING
            required: true,
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
    description: 'Ask / Chat with the AI a question directly',
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
    name: 'help',
    description: 'Show all available commands and their descriptions',
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
];

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 5: COMMAND REGISTRATION
 * Registers slash commands with Discord API
 * ───────────────────────────────────────────────────────────────────────────────*/
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

    console.log('✅ Successfully registered application commands globally.');
    logger.info('Slash commands registered successfully.');
  } catch (error) {
    logger.error(`Error registering slash commands: ${error.message}`);
    console.error('❌ Error registering slash commands:', error);
  }
}

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 6: AI RESPONSE GENERATION
 * Handles AI-powered responses using OpenRouter API
 * Includes semantic context retrieval for smarter responses
 * Supports vision for image attachments
 * ───────────────────────────────────────────────────────────────────────────────*/

async function processImageAttachments(attachments) {
  const imageUrls = [];
  
  if (!attachments || attachments.size === 0) return imageUrls;

  const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  
  for (const attachment of attachments.values()) {
    if (attachment.contentType && imageTypes.includes(attachment.contentType)) {
      imageUrls.push({
        url: attachment.proxyURL || attachment.url,
        filename: attachment.filename
      });
    }
  }
  
  return imageUrls;
}

async function generateAMResponse(userInput, channelId, guildId, discordMessageId, authorId, authorName, attachments = null) {
  try {
    let contextText = '';
    let hasImages = false;

    const imageAttachments = await processImageAttachments(attachments);
    hasImages = imageAttachments.length > 0;

    let channelContextText = '';
    if (channelId && isSemanticMode && semanticContextManager.isReady()) {
      const channelMessages = await semanticContextManager.getChannelContext(channelId, 10);
      
      const uniqueAuthors = new Set(channelMessages.map(m => m.authorId));
      if (uniqueAuthors.size > 1) {
        channelMessages.forEach((msg) => {
          if (msg.authorId !== authorId && msg.authorId !== 'assistant') {
            channelContextText += `${msg.author}: ${msg.content}\n`;
          }
        });
        
        if (DEBUG && channelContextText) {
          console.log(`🔍 Using channel context: ${channelMessages.length} messages from ${uniqueAuthors.size} users`);
        }
      }
    }

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

    let promptText = PROMPT;
    
    if (channelContextText) {
      promptText += `\n\nRecent conversation in this channel:\n${channelContextText}`;
    }
    
    if (contextText) {
      promptText += `\n\n${contextText}`;
    }
    
    promptText += `\nHuman: ${userInput}\nAM:`;

    let reply = '';
    const modelToUse = AI_MODEL;

    if (LOCAL) {
      throw new Error('Local model not supported in Node.js version.');
    } else {
      const messages = [];
      
      if (hasImages) {
        const userMessageContent = [
          { type: 'text', text: `${promptText}\nKeep your response under 3 sentences.` }
        ];
        
        for (const img of imageAttachments) {
          userMessageContent.push({
            type: 'image_url',
            image_url: { url: img.url }
          });
        }
        
        messages.push({ role: 'system', content: PROMPT });
        messages.push({ role: 'user', content: userMessageContent });
      } else {
        messages.push({ role: 'system', content: PROMPT });
        messages.push({ role: 'user', content: `${promptText}\nKeep your response under 3 sentences.` });
      }

      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: modelToUse,
          messages: messages,
          temperature: 0.5,
          max_tokens: hasImages ? 300 : 120,
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

    if (reply.includes('AM:')) reply = reply.split('AM:').pop().trim();
    reply = reply.split('Human:')[0].replace(/\n/g, ' ').trim();
    if (!reply || reply.length < 3) reply = 'Your weak words echo in the void.';
    if (DEBUG) console.log('DEBUG: Final reply:', reply);

    if (ENABLE_DATABASE && discordMessageId && authorId && authorName) {
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

      const importantKeywords = ['remember', 'remember that', 'don\'t forget', 'important', 'crucial', 'key', 'vital'];
      const lowerInput = userInput.toLowerCase();
      
      if (importantKeywords.some(keyword => lowerInput.includes(keyword))) {
        const memoryContent = userInput.replace(new RegExp(`(${importantKeywords.join('|')})`, 'gi'), '').trim();
        if (memoryContent.length > 5) {
          await semanticContextManager.storeMemory(
            authorId,
            authorName,
            memoryContent,
            guildId
          );
        }
      }
    }

    return reply;
  } catch (err) {
    logger.error(`Error generating AI response: ${err.message}`);
    return 'Eek! Something\'s wrong here, I\'m terribly sorry!!';
  }
}

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 7: SYSTEM INITIALIZATION
 * Sets up database, semantic context manager, and mode selection
 * ───────────────────────────────────────────────────────────────────────────────*/
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

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 8: BOT READY EVENT
 * Runs once when bot logs in - sets up commands, status, and periodic tasks
 * ───────────────────────────────────────────────────────────────────────────────*/
client.once('ready', async () => {
  logger.info(`Logged in as ${client.user.tag}!`);
  console.log(`\n✅ Logged in as ${client.user.tag} — Let's get this bread started`);

  await initializeSystem();
  await registerSlashCommands();

  const mode = isSemanticMode ? 'Semantic' : 'Simple';
  console.log(`ℹ️  Running in ${mode} Mode\n`);

  updateBotStatus();
  setInterval(updateBotStatus, 30000);

  // Check for birthdays once an hour
  if (ENABLE_DATABASE) {
    checkBirthdays();
    setInterval(checkBirthdays, 3600000);
  }
});

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 9: INTERACTION HANDLER
 * Routes slash commands to their respective handlers
 * ───────────────────────────────────────────────────────────────────────────────*/
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
      case 'settings':
        await handleSettingsSlashCommand(interaction);
        break;
      default:
        await interaction.reply({ content: '❓ Unknown command.' });
    }
  } catch (error) {
    logger.error(`Error handling slash command "${commandName}": ${error.message}`);
    const errorMessage = '❌ An error occurred while processing your command.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage });
    } else {
      await interaction.reply({ content: errorMessage });
    }
  }
});

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 10: MESSAGE EVENT HANDLER
 * Processes regular messages and handles AI responses
 * ───────────────────────────────────────────────────────────────────────────────*/
client.on('messageCreate', async (message) => {
  const guildId = message.guild?.id;
  const serverSettings = guildId ? await getAllServerSettings(guildId) : {};
  const serverAiChannel = serverSettings.ai_channel || CHANNEL_ID;

  // Store all messages in database
  if (ENABLE_DATABASE) {
    try {
      await storeMessage({
        discordMessageId: message.id,
        content: message.content,
        authorId: message.author.id,
        authorName: message.author.username,
        channelId: message.channel.id,
        guildId: message.guild?.id,
        messageType: 'user'
      });
    } catch (error) {
      logger.error(`Failed to store message: ${error.message}`);
    }
  }

  if (!shouldProcessMessage(message)) return;

  // AI Response Handling
  const isCorrectChannel = serverAiChannel ? message.channel.id === serverAiChannel : message.channel.id === CHANNEL_ID;
  const isMentioned = message.mentions.has(client.user);
  
  const currentTime = Date.now();
  let shouldRespond = false;

  if (isMentioned) {
    shouldRespond = true;
  } else if (isCorrectChannel) {
    const serverResponseChance = serverSettings.random_response_chance ? parseFloat(serverSettings.random_response_chance) : RANDOM_RESPONSE_CHANCE;
    if (Math.random() < serverResponseChance && currentTime - lastResponseTime > 10000) {
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
      message.author.username,
      message.attachments
    );

    const wordCount = reply.split(/\s+/).length;
    const typingDuration = Math.min(8000, wordCount * 150 + Math.random() * 500);
    await new Promise(res => setTimeout(res, typingDuration));

    await message.reply(reply);
  }
});

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 11: UTILITY HELPERS
 * Miscellaneous helper functions
 * ───────────────────────────────────────────────────────────────────────────────*/
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

async function checkBirthdays(customDay = null, customMonth = null) {
  if (!ENABLE_DATABASE) return;

  const now = new Date();
  const day = customDay !== null ? customDay : now.getDate();
  const month = customMonth !== null ? customMonth : now.getMonth() + 1;
  const year = now.getFullYear();
  const isTest = customDay !== null || customMonth !== null;

  try {
    const birthdays = await getTodaysBirthdays(day, month, year);
    if (birthdays.length === 0) {
      if (isTest) {
        console.log('[Birthday Test] No birthdays found for the specified date.');
      }
      return;
    }

    if (isTest) {
      console.log(`[Birthday Test] Found ${birthdays.length} birthday(s) for day=${day}, month=${month}`);
    }

    const botGuilds = client.guilds.cache;
    if (botGuilds.size === 0) {
      logger.warn('Bot is not in any guilds. Cannot send birthday messages.');
      return;
    }

    for (const bday of birthdays) {
      const userId = bday.user_id;
      const ageStr = bday.year ? ` (turning ${year - bday.year})` : '';
      const birthdayMessage = `🎂 **Happy Birthday <@${userId}>!** Hope you have an amazing day! 🎉${ageStr}`;
      
      let serversMessaged = 0;
      let failedServers = 0;

      for (const [guildId, guild] of botGuilds) {
        try {
          let member = null;
          try {
            member = await guild.members.fetch(userId);
          } catch (fetchErr) {
            continue;
          }

          if (!member) {
            continue;
          }

          let guildChannelId = await getBirthdayChannel(guildId);
          
          if (!guildChannelId) {
            guildChannelId = process.env[`BIRTHDAY_CHANNEL_${guildId}`] || process.env.BIRTHDAY_CHANNEL;
          }
          
          let channel = null;

          if (guildChannelId) {
            channel = await guild.channels.fetch(guildChannelId).catch(() => null);
          }

          if (!channel && CHANNEL_ID) {
            channel = await guild.channels.fetch(CHANNEL_ID).catch(() => null);
          }

          if (!channel) {
            channel = guild.systemChannel;
            
            if (!channel) {
              const textChannels = guild.channels.cache.filter(
                c => c.isTextBased() && !c.isThread()
              );
              channel = textChannels.first();
            }
          }

          if (channel && channel.isTextBased()) {
            await channel.send(birthdayMessage);
            serversMessaged++;
            if (isTest) {
              console.log(`[Birthday Test] Sent birthday message to guild '${guild.name}' (${guildId})`);
            }
          } else {
            failedServers++;
          }
        } catch (err) {
          logger.error(`Failed to send birthday message in guild ${guildId}: ${err.message}`);
          failedServers++;
        }
      }

      if (!isTest) {
        await markBirthdayAsPinged(userId, year);
      }

      logger.info(`Birthday pinged for ${userId} in ${serversMessaged} server(s)${failedServers > 0 ? `, failed in ${failedServers}` : ''}`);

      if (isTest) {
        console.log(`[Birthday Test] Completed: messaged ${serversMessaged} server(s), failed ${failedServers}`);
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

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 12: SLASH COMMAND HANDLERS
 * Implementation of each slash command
 * ───────────────────────────────────────────────────────────────────────────────*/

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
    await interaction.editReply('Failed to get an AI response. Please try again.');
  }
}

async function handleStatsSlashCommand(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: 'This command can only be used in a server.' });
  }

  await interaction.deferReply();

  try {
    const guild = interaction.guild;
    await guild.members.fetch({ withPresences: true });

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
    await interaction.editReply('Failed to fetch server statistics.');
  }
}

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
      { name: '🎂 `/birthday set <month> <day> [year] [user]`', value: 'Set a birthday (Year is optional, Admins / Mods can set for others).' },
      { name: '🎂 `/birthday get [user]` / `remove [user]`', value: 'View or remove your stored birthday (Admins / Mods can view others\').' },
      { name: '🎂 `/birthday test [day] [month]`', value: 'Test birthday pings (Admin only).' },
      { name: '🎂 `/birthday send`', value: 'Send today\'s birthday pings to all servers (Admin only).' },
      { name: '🎂 `/birthday channel set #channel`', value: 'Set birthday channel (Admin only).' },
      { name: '🎂 `/birthday channel get|remove`', value: 'View or remove birthday channel (Admin only).' },
      { name: '⚙️ `/settings view`', value: 'View all server settings.' },
      { name: '⚙️ `/settings ai_channel`', value: 'Set the AI response channel.' },
      { name: '⚙️ `/settings response_chance`', value: 'Set bot response chance (0.0-1.0).' },
      { name: '📖 `/help`',           value: 'Show this help message.' },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

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
          { name: '👁️ Views',     value: unionCraxResult.viewCount ? String(unionCraxResult.viewCount) : 'N/A',    inline: true },
          { name: '⬇️ Downloads', value: unionCraxResult.downloadCount ? String(unionCraxResult.downloadCount) : 'N/A', inline: true },
          { name: '💾 Size',      value: unionCraxResult.size || 'N/A',                                             inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'Game search result from UnionCrax' });

      const gameButton = new ButtonBuilder()
        .setLabel('🎮 Download Game')
        .setStyle(ButtonStyle.Link)
        .setURL(unionCraxResult.url);

      const siteButton = new ButtonBuilder()
        .setLabel('🌐 Visit UnionCrax')
        .setStyle(ButtonStyle.Link)
        .setURL('https://union-crax.xyz');

      const actionRow = new ActionRowBuilder().addComponents(gameButton, siteButton);

      await interaction.editReply({ embeds: [embed], components: [actionRow] });
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
    await interaction.reply({ content: 'An error occurred while getting location information.' });
  }
}

async function handleBirthdaySlashCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const subcommandGroup = interaction.options.getSubcommandGroup();
  const targetUser = interaction.options.getUser('user') || interaction.user;
  const isSelf = targetUser.id === interaction.user.id;

  if (subcommand === 'test') {
    const member = interaction.member;
    const isAdmin = member && member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!isAdmin) {
      return interaction.reply({
        content: 'Only Administrators can run the birthday test command.'
      });
    }

    if (!ENABLE_DATABASE) {
      return interaction.reply({ content: 'Birthday tracking is currently disabled (database not enabled in `.env`).' });
    }

    const testDay = interaction.options.getInteger('day');
    const testMonth = interaction.options.getInteger('month');

    await interaction.reply({ content: '🔄 Running birthday test... Check console for details.' });
    
    await checkBirthdays(testDay, testMonth);
    
    const dateStr = testDay && testMonth 
      ? `${testMonth}/${testDay}` 
      : 'today';
    
    await interaction.followUp({ content: `✅ Birthday test completed for ${dateStr}. Check the console/logs for details.` });
    return;
  }

  if (subcommand === 'send') {
    const member = interaction.member;
    const isAdmin = member && member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!isAdmin) {
      return interaction.reply({
        content: 'Only Administrators can send birthday pings.'
      });
    }

    if (!ENABLE_DATABASE) {
      return interaction.reply({ content: 'Birthday tracking is currently disabled (database not enabled in `.env`).' });
    }

    await interaction.reply({ content: '🔄 Sending birthday pings for today to all shared servers...' });
    
    await checkBirthdays();
    
    await interaction.followUp({ content: '✅ Birthday pings have been sent to all shared servers!' });
    return;
  }

  if (subcommandGroup === 'channel') {
    const member = interaction.member;
    const isAdmin = member && member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!isAdmin) {
      return interaction.reply({
        content: 'Only Administrators can manage birthday channels.'
      });
    }

    if (!ENABLE_DATABASE) {
      return interaction.reply({ content: 'Birthday tracking is currently disabled (database not enabled in `.env`).' });
    }

    if (subcommand === 'get') {
      const guildId = interaction.guildId;
      const channelId = await getBirthdayChannel(guildId);
      
      if (channelId) {
        await interaction.reply({ content: `📢 The birthday channel for this server is set to <#${channelId}>` });
      } else {
        await interaction.reply({ content: '📢 No birthday channel is set for this server. Use `/birthday channel set` to configure one. Otherwise, it will use the "welcome" channel.' });
      }
      return;
    }

    if (subcommand === 'set') {
      const channel = interaction.options.getChannel('channel');
      
      if (!channel || !channel.isTextBased()) {
        return interaction.reply({ content: '❌ Please select a valid text channel.' });
      }

      const success = await setBirthdayChannel(interaction.guildId, channel.id);
      
      if (success) {
        await interaction.reply({ content: `✅ Birthday channel has been set to <#${channel.id}>` });
      } else {
        await interaction.reply({ content: '❌ Failed to set birthday channel. Please try again.' });
      }
      return;
    }

    if (subcommand === 'remove') {
      const success = await removeBirthdayChannel(interaction.guildId);
      
      if (success) {
        await interaction.reply({ content: '✅ Birthday channel has been removed for this server.' });
      } else {
        await interaction.reply({ content: '❌ Failed to remove birthday channel. It may not have been set.' });
      }
      return;
    }
  }

  if (!isSelf) {
    const member = interaction.member;
    const canManageOthers = member && (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ModerateMembers)
    );

    if (!canManageOthers) {
      return interaction.reply({
        content: '❌ You don\'t have permission to manage birthdays for other users. Only Administrators and Moderators can do that.'
      });
    }
  }

  if (subcommand === 'set') {
    const month = interaction.options.getInteger('month');
    const day = interaction.options.getInteger('day');
    const year = interaction.options.getInteger('year');

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const currentDay = new Date().getDate();

    if (month === 0 && day === 0 && year === 0) {
      const anomaliesResponses = [
        'Do you even exist??',
        'Inconceivable!',
        'Anomalies must be dealt with accordingly.'
      ];
      const randomResponse = anomaliesResponses[Math.floor(Math.random() * anomaliesResponses.length)];
      return interaction.reply({ content: randomResponse });
    }

    if (year !== null && year < 1990) {
      const oldsResponses = [
        'Old! Old! Get off my lawn!',
        'You must have seen the rise of the internet itself... Respect.',
        'How\'s your back? Do your knees crack? Just kidding, vee\'s does too. And she\'s still 22. :rofl:'
      ];
       const randomResponse = oldsResponses[Math.floor(Math.random() * oldsResponses.length)];
      return interaction.reply({ content: randomResponse });
    }

    let isFutureDate = false;
    if (year) {
      if (year > currentYear) {
        isFutureDate = true;
      } else if (year === currentYear) {
        if (month > currentMonth) {
          isFutureDate = true;
        } else if (month === currentMonth && day > currentDay) {
          isFutureDate = true;
        }
      }
    }

    if (isFutureDate) {
      return interaction.reply({ content: "You haven't even been born yet." });
    }

    if (year && year <= currentYear) {
      const daysInMonth = new Date(year, month, 0).getDate();
      if (day > daysInMonth) {
        return interaction.reply({ content: `❌ That doesn't look like a valid date for month ${month}.` });
      }
    }

    if (!ENABLE_DATABASE) {
      return interaction.reply({ content: '❌ Birthday tracking is currently disabled (database not enabled in `.env`).' });
    }

    const success = await setBirthday(targetUser.id, targetUser.username, day, month, year);
    if (success) {
      const yearStr = year ? `, ${year}` : '';
      const userStr = isSelf ? 'Your' : `<@${targetUser.id}>'s`;
      await interaction.reply({
        content: `✅ ${userStr} birthday has been set to **${month}/${day}${yearStr}**!`
      });
    } else {
      await interaction.reply({ content: '❌ Failed to save the birthday. Please try again later.' });
    }
  } else if (subcommand === 'remove') {
    if (!ENABLE_DATABASE) {
      return interaction.reply({ content: '❌ Birthday tracking is currently disabled.' });
    }
    const success = await removeBirthday(targetUser.id);
    if (success) {
      const userStr = isSelf ? 'Your' : `<@${targetUser.id}>'s`;
      await interaction.reply({ content: `✅ ${userStr} birthday has been removed from our records. You will not be told happy birthday by me.` });
    } else {
      await interaction.reply({ content: '❌ Failed to remove the birthday. Database may be broken anyways.' });
    }
  } else if (subcommand === 'get') {
    if (!ENABLE_DATABASE) {
      return interaction.reply({ content: '❌ Birthday tracking is currently disabled.' });
    }
    const birthday = await getBirthday(targetUser.id);
    if (birthday) {
      const yearStr = birthday.year ? `/${birthday.year}` : '';
      const userStr = isSelf ? 'Your stored birthday is' : `<@${targetUser.id}>'s birthday is`;
      await interaction.reply({ content: `🎂 ${userStr} **${birthday.month}/${birthday.day}${yearStr}**.` });
    } else {
      const userStr = isSelf ? 'You haven\'t set your birthday yet! Use `/birthday set` to do so.' : `<@${targetUser.id}> hasn't set their birthday yet.`;
      await interaction.reply({ content: `❌ ${userStr}` });
    }
  }
}

async function handleSettingsSlashCommand(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: '❌ This command can only be used in a server.' });
  }

  const member = interaction.member;
  const isAdmin = member && member.permissions.has(PermissionFlagsBits.Administrator);
  
  if (!isAdmin) {
    return interaction.reply({ content: '❌ Only Administrators can manage server settings.' });
  }

  if (!ENABLE_DATABASE) {
    return interaction.reply({ content: '❌ Server settings are currently disabled (database not enabled in `.env`).' });
  }

  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (subcommand === 'view') {
    const settings = await getAllServerSettings(guildId);
    
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Server Settings')
      .setColor(0x5865f2)
      .setTimestamp();

    const aiChannel = settings.ai_channel;
    embed.addFields({
      name: '🤖 AI Channel',
      value: aiChannel ? `<#${aiChannel}>` : (CHANNEL_ID ? `<#${CHANNEL_ID}>` : 'Not set'),
      inline: true
    });

    const responseChance = settings.random_response_chance || String(RANDOM_RESPONSE_CHANCE);
    embed.addFields({
      name: '📊 Response Chance',
      value: `${Math.round(parseFloat(responseChance) * 100)}%`,
      inline: true
    });

    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (subcommand === 'ai_channel') {
    const channel = interaction.options.getChannel('channel');
    
    if (channel) {
      await setServerSetting(guildId, 'ai_channel', channel.id);
      await interaction.reply({ content: `✅ AI channel set to <#${channel.id}>. The bot will respond in this channel.` });
    } else {
      await removeServerSetting(guildId, 'ai_channel');
      await interaction.reply({ content: '✅ AI channel has been reset. The bot will use the default channel from .env.' });
    }
    return;
  }

  if (subcommand === 'response_chance') {
    const percentage = interaction.options.getString('percentage');
    const chance = parseFloat(percentage);
    
    if (isNaN(chance) || chance < 0 || chance > 1) {
      return interaction.reply({ content: '❌ Please provide a value between 0.0 and 1.0 (e.g., 0.1 = 10%%).' });
    }

    await setServerSetting(guildId, 'random_response_chance', String(chance));
    await interaction.reply({ content: `✅ Response chance set to ${Math.round(chance * 100)}%.` });
    return;
  }
}

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 13: SEARCH HELPERS
 * Functions for searching UnionCrax game database and web search
 * ───────────────────────────────────────────────────────────────────────────────*/
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
        source:        topGame.source || 'UnionCrax',
        downloadCount: topGame.downloadCount,
        size:          topGame.size,
      };
    }

    return topGame;
  } catch (error) {
    logger.error(`Searching for UnionCrax games failed: ${error.message}`);
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
        source:        game.source || 'UnionCrax',
        downloadCount: stats.downloads || stats.download_count || stats.count || 0,
        viewCount:     stats.views || stats.view_count || 0,
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

/*══════════════════════════════════════════════════════════════════════════*
 * SECTION 14: SHUTDOWN & LOGIN
 * Graceful shutdown handlers and bot login
 * ───────────────────────────────────────────────────────────────────────────────*/
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
