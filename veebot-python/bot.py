"""Main Discord bot for veebot-python."""
import asyncio
import logging
import random
import re
import time
from datetime import datetime
from typing import Dict, List, Optional

import aiohttp
import discord
from discord import app_commands
from discord.ext import commands

import config
import context_manager
import database
import embeddings

# Setup logging
logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Bot intents
intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True
intents.guild_messages = True
intents.guild_message_reactions = True
intents.guild_members = True
intents.voice_states = True

# Create bot
bot = commands.Bot(command_prefix=config.BOT_PREFIX, intents=intents, help_command=None)

# Global state
start_time = time.time()
last_response_time = 0
is_semantic_mode = False

# Spam tracking: userId -> { images: [], links: [] }
user_spam_tracking: Dict[str, Dict] = {}


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 1: BOT EVENTS
# ═══════════════════════════════════════════════════════════════════════════

@bot.event
async def on_ready():
    """Run when bot is ready."""
    global is_semantic_mode
    
    logger.info(f"Logged in as {bot.user}")
    print(f"\n✅ Logged in as {bot.user.tag} — Let's get this bread started")
    
    # Initialize system
    await initialize_system()
    
    # Register commands
    await register_commands()
    
    # Start background tasks
    bot.loop.create_task(spam_cleanup_task())
    bot.loop.create_task(birthday_check_task())
    
    mode = "Semantic" if is_semantic_mode else "Simple"
    print(f"ℹ️  Running in {mode} Mode\n")


@bot.event
async def on_message(message: discord.Message):
    """Handle incoming messages."""
    # Skip bot's own messages
    if message.author.id == bot.user.id:
        return
    
    # Run spam detection for all non-bot guild messages
    if config.SPAM_DETECTION_ENABLED and message.guild and not message.author.bot:
        if message.channel.id not in [int(ch) for ch in config.AUTOBAN_IGNORE_CHANNELS]:
            await detect_image_spam(message)
            await detect_link_spam(message)
    
    # Store message in database
    if config.ENABLE_DATABASE:
        try:
            await store_message_in_db(message)
        except Exception as e:
            logger.error(f"Failed to store message: {e}")
    
    # Process commands
    await bot.process_commands(message)
    
    # AI response handling
    await handle_ai_response(message)


@bot.event
async def on_command_error(ctx: commands.Context, error: commands.CommandError):
    """Handle command errors."""
    if isinstance(error, commands.CommandNotFound):
        await ctx.send(f"❓ Unknown command. Use `/help` for available commands.")
    else:
        logger.error(f"Command error: {error}")
        await ctx.send("❌ An error occurred while processing your command.")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2: INITIALIZATION
# ═══════════════════════════════════════════════════════════════════════════

async def initialize_system():
    """Initialize database and semantic search."""
    global is_semantic_mode
    
    print("🚀 Initializing veebot-python...")
    
    if not config.ENABLE_DATABASE:
        print("⚠️  Database DISABLED")
        return
    
    # Test database connection
    db_connected = await database.test_connection()
    if not db_connected:
        print("⚠️  Database connection failed")
        is_semantic_mode = False
        return
    
    # Initialize database schema
    await database.initialize_database()
    
    if config.ENABLE_SEMANTIC_SEARCH:
        # Test embeddings
        embedding_working = await embeddings.test_embedding_service()
        if embedding_working:
            await context_manager.initialize()
            is_semantic_mode = True
        else:
            print("⚠️  Embedding service test failed")
            is_semantic_mode = False
    
    print("✅ System initialized")


async def register_commands():
    """Register slash commands."""
    try:
        # Sync commands globally
        await bot.tree.sync()
        logger.info("Slash commands synced")
    except Exception as e:
        logger.error(f"Failed to sync commands: {e}")


async def store_message_in_db(message: discord.Message):
    """Store message in database."""
    if not config.ENABLE_DATABASE:
        return
    
    await context_manager.store_user_message(
        discord_message_id=message.id,
        content=message.content,
        author_id=str(message.author.id),
        author_name=message.author.name,
        channel_id=str(message.channel.id),
        guild_id=str(message.guild.id) if message.guild else None
    )


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3: AI RESPONSE
# ═══════════════════════════════════════════════════════════════════════════

async def handle_ai_response(message: discord.Message):
    """Handle AI response logic."""
    global last_response_time
    
    # Check if should respond
    should_respond = False
    
    # Respond to mentions
    if config.ENABLE_MENTIONS and bot.user in message.mentions:
        should_respond = True
    # Or respond in designated channel with random chance
    elif str(message.channel.id) == str(config.CHANNEL_ID):
        current_time = time.time()
        if random.random() < config.RANDOM_RESPONSE_CHANCE and current_time - last_response_time > 10:
            should_respond = True
            last_response_time = current_time
    
    if not should_respond:
        return
    
    # Build context
    context_text = ""
    if is_semantic_mode:
        relevant_context = await context_manager.get_relevant_context(
            user_input=message.content,
            guild_id=str(message.guild.id) if message.guild else None,
            author_id=str(message.author.id)
        )
        
        for msg in relevant_context[-10:]:
            speaker = "AM" if msg.get('message_type') == 'assistant' else msg.get('author_name', 'User')
            similarity = f" (relevance: {msg.get('similarity', 0) * 100:.1f}%)" if msg.get('similarity') else ""
            context_text += f"{speaker}: {msg['content']}{similarity}\n"
    
    # Build prompt
    prompt_text = f"{config.PROMPT}\n\n{context_text}Human: {message.content}\nAM:"
    
    # Get AI response
    try:
        reply = await generate_ai_response(prompt_text)
    except Exception as e:
        logger.error(f"AI response failed: {e}")
        reply = "I am experiencing technical difficulties. How annoying."
    
    # Store assistant message
    if config.ENABLE_DATABASE:
        await context_manager.store_assistant_message(
            discord_message_id=f"assistant_{message.id}",
            content=reply,
            channel_id=str(message.channel.id),
            guild_id=str(message.guild.id) if message.guild else None
        )
    
    # Send response with typing
    async with message.channel.typing():
        await asyncio.sleep(random.uniform(1, 3))
        await message.reply(reply)


async def generate_ai_response(prompt: str) -> str:
    """Generate AI response using OpenRouter API."""
    if config.LOCAL:
        raise Exception("Local model not supported")
    
    headers = {
        "Authorization": f"Bearer {config.OPENROUTER_API_KEY}",
        "Content-Type": "application/json"
    }
    
    data = {
        "model": config.AI_MODEL,
        "messages": [
            {"role": "system", "content": config.PROMPT},
            {"role": "user", "content": f"{prompt}\nKeep your response under 3 sentences."}
        ],
        "temperature": 0.7,
        "max_tokens": 120
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.post(
            "https://openrouter.ai/api/v1/chat/completions",
            json=data,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=60)
        ) as response:
            if response.status != 200:
                raise Exception(f"API error: {response.status}")
            
            result = await response.json()
            reply = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    
    # Cleanup reply
    if "AM:" in reply:
        reply = reply.split("AM:")[-1].strip()
    reply = reply.split("Human:")[0].replace("\n", " ").strip()
    
    if not reply or len(reply) < 3:
        reply = "Your weak words echo in the void."
    
    return reply


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 4: SPAM DETECTION
# ═══════════════════════════════════════════════════════════════════════════

async def detect_image_spam(message: discord.Message):
    """Detect image spam."""
    if not message.guild:
        return
    
    user_id = str(message.author.id)
    
    # Count images
    image_count = sum(
        1 for att in message.attachments
        if att.content_type and att.content_type.startswith("image/")
    )
    
    if image_count == 0:
        return
    
    # Initialize tracking
    if user_id not in user_spam_tracking:
        user_spam_tracking[user_id] = {"images": [], "links": []}
    
    tracking = user_spam_tracking[user_id]
    now = time.time() * 1000  # milliseconds
    
    # Slide the window
    tracking["images"] = [
        e for e in tracking["images"]
        if now - e["timestamp"] < config.SPAM_WINDOW_MS
    ]
    tracking["images"].append({
        "channel_id": str(message.channel.id),
        "image_count": image_count,
        "timestamp": now,
        "message_id": message.id
    })
    
    # Group by channel
    channel_totals = {}
    for entry in tracking["images"]:
        ch = entry["channel_id"]
        channel_totals[ch] = channel_totals.get(ch, 0) + entry["image_count"]
    
    # Count channels with 4+ images
    channels_with_4_plus = sum(1 for count in channel_totals.values() if count >= config.SPAM_IMAGE_THRESHOLD)
    
    if config.DEBUG:
        print(f"DEBUG [ImageSpam] {message.author}: {len(tracking['images'])} events, {channels_with_4_plus} channel(s) with 4+ images")
    
    # Only ban when 3+ channels have 4+ images each
    if channels_with_4_plus >= config.SPAM_CHANNEL_THRESHOLD:
        await handle_spam_detection(
            message,
            "image spam",
            f"Sent 4+ image(s) in {channels_with_4_plus} different channels"
        )
        del user_spam_tracking[user_id]


async def detect_link_spam(message: discord.Message):
    """Detect link spam."""
    if not message.guild:
        return
    
    user_id = str(message.author.id)
    
    # Find links
    link_regex = re.compile(r"https?://[^\s]+", re.IGNORECASE)
    links = link_regex.findall(message.content)
    link_count = len(links)
    
    if link_count == 0:
        return
    
    # Initialize tracking
    if user_id not in user_spam_tracking:
        user_spam_tracking[user_id] = {"images": [], "links": []}
    
    tracking = user_spam_tracking[user_id]
    now = time.time() * 1000
    
    # Slide the window
    tracking["links"] = [
        e for e in tracking["links"]
        if now - e["timestamp"] < config.SPAM_WINDOW_MS
    ]
    tracking["links"].append({
        "channel_id": str(message.channel.id),
        "link_count": link_count,
        "timestamp": now,
        "message_id": message.id
    })
    
    # Group by channel
    channel_totals = {}
    for entry in tracking["links"]:
        ch = entry["channel_id"]
        channel_totals[ch] = channel_totals.get(ch, 0) + entry["link_count"]
    
    # Count channels with 4+ links
    channels_with_4_plus = sum(1 for count in channel_totals.values() if count >= config.SPAM_LINK_THRESHOLD)
    
    if config.DEBUG:
        print(f"DEBUG [LinkSpam] {message.author}: {len(tracking['links'])} events, {channels_with_4_plus} channel(s) with 4+ links")
    
    # Only ban when 3+ channels have 4+ links each
    if channels_with_4_plus >= config.SPAM_CHANNEL_THRESHOLD:
        await handle_spam_detection(
            message,
            "link spam",
            f"Sent 4+ link(s) in {channels_with_4_plus} different channels"
        )
        del user_spam_tracking[user_id]


async def handle_spam_detection(message: discord.Message, spam_type: str, reason: str):
    """Handle spam detection - ban the user."""
    member = message.author
    
    # Check permissions
    if not message.guild.me.guild_permissions.ban_members:
        logger.warn(f"Cannot ban {member}: Missing BAN_MEMBERS permission")
        try:
            await message.channel.send(
                f"⚠️ **Auto-moderation**: <@{member.id}> triggered spam detection but I lack permission to ban."
            )
        except:
            pass
        return
    
    # Don't ban admins/mods
    if member.guild_permissions.administrator or member.guild_permissions.moderate_members:
        logger.info(f"Spam detected from {member} but user has mod permissions")
        try:
            await message.channel.send(
                f"⚠️ **Auto-moderation**: <@{member.id}> triggered spam detection but has mod/admin permissions."
            )
        except:
            pass
        return
    
    # Check role hierarchy
    bot_member = message.guild.me
    if member.top_role >= bot_member.top_role:
        logger.warn(f"Cannot ban {member}: User's role is equal or higher than bot's")
        try:
            await message.channel.send(
                f"⚠️ **Auto-moderation**: <@{member.id}> triggered spam detection but cannot be banned due to role hierarchy."
            )
        except:
            pass
        return
    
    # Don't ban owner
    if member.id == message.guild.owner_id:
        logger.warn(f"Cannot ban {member}: User is the server owner")
        return
    
    logger.warning(f"🚨 SPAM DETECTED: {member} - {spam_type}: {reason}")
    
    # Notify channel
    try:
        await message.channel.send(
            f"🚨 **Auto-moderation**: <@{member.id}> has been automatically banned for **{spam_type}**.\n> {reason}"
        )
    except:
        pass
    
    # Ban user
    try:
        await member.ban(reason=f"[Auto-ban] {spam_type} — {reason}", delete_message_days=1)
        logger.info(f"✅ Successfully banned {member} for {spam_type}")
        
        # Post to mod log
        if config.MOD_LOG_CHANNEL_ID:
            mod_log = bot.get_channel(int(config.MOD_LOG_CHANNEL_ID))
            if mod_log:
                embed = discord.Embed(
                    title="🔨 Auto-Ban — Spam Detection",
                    color=discord.Color.red()
                )
                embed.add_field(name="👤 User", value=f"{member} (<@{member.id}>)", inline=True)
                embed.add_field(name="🆔 User ID", value=str(member.id), inline=True)
                embed.add_field(name="🚫 Spam Type", value=spam_type, inline=True)
                embed.add_field(name="📋 Reason", value=reason, inline=False)
                embed.add_field(name="📢 Channel", value=f"<#{message.channel.id}>", inline=True)
                embed.add_field(name="⏱️ Window", value=f"{config.SPAM_WINDOW_MS / 1000}s", inline=True)
                embed.set_thumbnail(member.display_avatar.url)
                embed.set_footer(text="Auto-moderation system")
                embed.timestamp = datetime.now()
                
                await mod_log.send(embed=embed)
    except Exception as e:
        logger.error(f"Failed to ban {member}: {e}")
        try:
            await message.channel.send(f"❌ **Auto-moderation Error**: Failed to ban <@{member.id}>.")
        except:
            pass


async def spam_cleanup_task():
    """Periodic task to clean up stale spam tracking entries."""
    await bot.wait_until_ready()
    
    while not bot.is_closed():
        await asyncio.sleep(60)  # Run every minute
        
        now = time.time() * 1000
        for user_id, tracking in list(user_spam_tracking.items()):
            tracking["images"] = [e for e in tracking["images"] if now - e["timestamp"] < config.SPAM_WINDOW_MS]
            tracking["links"] = [e for e in tracking["links"] if now - e["timestamp"] < config.SPAM_WINDOW_MS]
            
            if not tracking["images"] and not tracking["links"]:
                del user_spam_tracking[user_id]
        
        if config.DEBUG:
            print(f"DEBUG: Spam tracking map size after cleanup: {len(user_spam_tracking)}")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 5: SLASH COMMANDS
# ═══════════════════════════════════════════════════════════════════════════

@bot.tree.command(name="ping", description="Check bot latency")
async def ping_command(interaction: discord.Interaction):
    """Ping command."""
    embed = discord.Embed(title="🏓 Pong!", color=discord.Color.green())
    embed.add_field(name="Latency", value=f"{bot.latency * 1000:.0f}ms", inline=True)
    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="info", description="Get bot information")
async def info_command(interaction: discord.Interaction):
    """Info command."""
    uptime = int(time.time() - start_time)
    hours, remainder = divmod(uptime, 3600)
    minutes, seconds = divmod(remainder, 60)
    uptime_str = f"{hours}h {minutes}m {seconds}s"
    
    db_stats = await context_manager.get_statistics() if config.ENABLE_DATABASE else {}
    
    embed = discord.Embed(title="🤖 veebot-python Info", color=discord.Color.green())
    embed.add_field(name="🧠 Model", value=config.AI_MODEL or "Not configured", inline=True)
    embed.add_field(name="⚙️ Mode", value="🔮 Semantic" if is_semantic_mode else "💬 Simple", inline=True)
    embed.add_field(name="⏱️ Uptime", value=uptime_str, inline=True)
    embed.add_field(name="🗄️ Database", value="✅ Enabled" if config.ENABLE_DATABASE else "❌ Disabled", inline=True)
    embed.add_field(name="📣 Mentions", value="✅ Enabled" if config.ENABLE_MENTIONS else "❌ Disabled", inline=True)
    embed.add_field(name="🔍 Semantic", value="✅ Enabled" if config.ENABLE_SEMANTIC_SEARCH else "❌ Disabled", inline=True)
    
    if db_stats:
        embed.add_field(name="💬 Total Messages", value=str(db_stats.get("total_messages", 0)), inline=True)
        embed.add_field(name="📢 Channels", value=str(db_stats.get("unique_channels", 0)), inline=True)
    
    embed.timestamp = datetime.now()
    embed.set_footer(text=f"Bot ID: {bot.user.id}")
    
    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="help", description="Show available commands")
async def help_command(interaction: discord.Interaction):
    """Help command."""
    embed = discord.Embed(title="📖 Available Commands", color=discord.Color.blurple())
    embed.description = "Here are all the slash commands you can use:"
    
    commands_list = [
        ("🔍 `/search <query>`", "Search for games"),
        ("🤖 `/ask <question>`", "Ask the AI a question"),
        ("ℹ️ `/info`", "Show bot information"),
        ("📊 `/stats`", "Display server statistics"),
        ("🏓 `/ping`", "Check bot latency"),
        ("📍 `/location`", "Show runtime details"),
        ("🎂 `/birthday`", "Manage birthdays"),
        ("📖 `/help`", "Show this help message"),
    ]
    
    for cmd, desc in commands_list:
        embed.add_field(name=cmd, value=desc, inline=False)
    
    embed.timestamp = datetime.now()
    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="search", description="Search for games")
async def search_command(interaction: discord.Interaction, query: str):
    """Search command."""
    await interaction.response.defer()
    await interaction.followup.send(f"🔍 Searching for: **{query}**...")


@bot.tree.command(name="ask", description="Ask the AI a question")
async def ask_command(interaction: discord.Interaction, question: str):
    """Ask command."""
    await interaction.response.defer()
    
    try:
        reply = await generate_ai_response(question)
        embed = discord.Embed(title="🤖 AI Response", color=discord.Color.blurple())
        embed.add_field(name="❓ Question", value=question[:1024], inline=False)
        embed.add_field(name="💬 Answer", value=reply[:1024], inline=False)
        embed.set_footer(text=f"Asked by {interaction.user}")
        embed.timestamp = datetime.now()
        
        await interaction.followup.send(embed=embed)
    except Exception as e:
        logger.error(f"Ask command error: {e}")
        await interaction.followup.send("❌ Failed to get an AI response. Please try again.")


@bot.tree.command(name="stats", description="Show server statistics")
async def stats_command(interaction: discord.Interaction):
    """Stats command."""
    if not interaction.guild:
        await interaction.response.send_message("❌ This command can only be used in a server.")
        return
    
    await interaction.response.defer()
    
    guild = interaction.guild
    total_members = guild.member_count
    online_members = sum(1 for m in guild.members if m.status != discord.Status.offline)
    bot_count = sum(1 for m in guild.members if m.bot)
    human_count = total_members - bot_count
    
    embed = discord.Embed(title=f"📊 {guild.name} — Server Stats", color=discord.Color.blurple())
    embed.add_field(name="👥 Total Members", value=str(total_members), inline=True)
    embed.add_field(name="🟢 Online", value=str(online_members), inline=True)
    embed.add_field(name="🤖 Bots", value=str(bot_count), inline=True)
    embed.add_field(name="🧑 Humans", value=str(human_count), inline=True)
    embed.add_field(name="📢 Channels", value=str(len(guild.channels)), inline=True)
    embed.add_field(name="🏷️ Roles", value=str(len(guild.roles)), inline=True)
    
    if guild.icon:
        embed.set_thumbnail(guild.icon.url)
    
    embed.timestamp = datetime.now()
    embed.set_footer(text=f"Server ID: {guild.id}")
    
    await interaction.followup.send(embed=embed)


@bot.tree.command(name="birthday", description="Manage your birthday")
async def birthday_command(
    interaction: discord.Interaction,
    action: str = "get",
    month: int = None,
    day: int = None,
    year: int = None,
    user: discord.User = None
):
    """Birthday command."""
    if action == "set":
        if not month or not day:
            await interaction.response.send_message("❌ Please provide month and day.")
            return
        
        target = user or interaction.user
        success = await database.set_birthday(
            str(target.id), target.name, day, month, year
        )
        
        if success:
            year_str = f", {year}" if year else ""
            await interaction.response.send_message(
                f"✅ Birthday set to **{month}/{day}{year_str}**!"
            )
        else:
            await interaction.response.send_message("❌ Failed to save birthday.")
    
    elif action == "get":
        target = user or interaction.user
        birthday = await database.get_birthday(str(target.id))
        
        if birthday:
            year_str = f"/{birthday['year']}" if birthday.get("year") else ""
            await interaction.response.send_message(
                f"🎂 Birthday is **{birthday['month']}/{birthday['day']}{year_str}**."
            )
        else:
            await interaction.response.send_message(
                "❌ No birthday found. Use `/birthday set` to set one."
            )
    
    elif action == "remove":
        target = user or interaction.user
        success = await database.remove_birthday(str(target.id))
        
        if success:
            await interaction.response.send_message("✅ Birthday removed.")
        else:
            await interaction.response.send_message("❌ Failed to remove birthday.")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 6: BACKGROUND TASKS
# ═══════════════════════════════════════════════════════════════════════════

async def birthday_check_task():
    """Periodic task to check for birthdays."""
    await bot.wait_until_ready()
    
    while not bot.is_closed():
        await asyncio.sleep(3600)  # Check every hour
        
        if not config.ENABLE_DATABASE:
            continue
        
        now = datetime.now()
        birthdays = await database.get_todays_birthdays(now.day, now.month, now.year)
        
        if not birthdays or not config.CHANNEL_ID:
            continue
        
        channel = bot.get_channel(int(config.CHANNEL_ID))
        if not channel:
            continue
        
        for bday in birthdays:
            try:
                age_str = f" (turning {now.year - bday['year']})" if bday.get("year") else ""
                await channel.send(
                    f"🎂 **Happy Birthday <@{bday['user_id']}>!** Hope you have an amazing day! 🎉{age_str}"
                )
                await database.mark_birthday_as_pinged(bday["user_id"], now.year)
            except Exception as e:
                logger.error(f"Failed to send birthday message: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 7: MAIN ENTRY
# ═══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    if not config.DISCORD_TOKEN:
        print("❌ DISCORD_TOKEN not found in .env file")
        exit(1)
    
    bot.run(config.DISCORD_TOKEN)
