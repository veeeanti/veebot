"""Configuration module for veebot-python."""
import os
from dotenv import load_dotenv

load_dotenv()

# Discord Bot Configuration
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = os.getenv("GUILD_ID")
CHANNEL_ID = os.getenv("CHANNEL_ID")
BOT_PREFIX = os.getenv("BOT_PREFIX", "!")

# AI Configuration
AI_MODEL = os.getenv("AI_MODEL", "meta-llama/llama-3.1-70b-instruct")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
LOCAL = os.getenv("LOCAL", "false").lower() == "true"
RANDOM_RESPONSE_CHANCE = float(os.getenv("RANDOM_RESPONSE_CHANCE", "0.1"))
PROMPT = os.getenv("PROMPT", "You are veebot, a shy affectionate tsundere.")

# Bot Behavior
ENABLE_MENTIONS = os.getenv("ENABLE_MENTIONS", "true").lower() == "true"
FRIENDLY_FIRE = os.getenv("FRIENDLY_FIRE", "false").lower() == "true"
DEBUG = os.getenv("DEBUG", "false").lower() == "true"

# Database Configuration
ENABLE_DATABASE = os.getenv("ENABLE_DATABASE", "false").lower() == "true"
DATABASE_TYPE = os.getenv("DATABASE_TYPE", "sqlite")
SQLITE_PATH = os.getenv("SQLITE_PATH", "./database.sqlite")
DATABASE_URL = os.getenv("DATABASE_URL")

# Semantic Search Configuration
ENABLE_SEMANTIC_SEARCH = os.getenv("ENABLE_SEMANTIC_SEARCH", "true").lower() == "true"
MAX_CONTEXT_MESSAGES = int(os.getenv("MAX_CONTEXT_MESSAGES", "20"))
CONTEXT_SIMILARITY_THRESHOLD = float(os.getenv("CONTEXT_SIMILARITY_THRESHOLD", "0.5"))

# Spam Detection Configuration
SPAM_DETECTION_ENABLED = os.getenv("SPAM_DETECTION_ENABLED", "true").lower() == "true"
SPAM_IMAGE_THRESHOLD = int(os.getenv("SPAM_IMAGE_THRESHOLD", "4"))
SPAM_LINK_THRESHOLD = int(os.getenv("SPAM_LINK_THRESHOLD", "4"))
SPAM_CHANNEL_THRESHOLD = int(os.getenv("SPAM_CHANNEL_THRESHOLD", "3"))
SPAM_WINDOW_MS = int(os.getenv("SPAM_WINDOW_MS", "30000"))

# Channels to ignore for spam detection
AUTOBAN_IGNORE_CHANNELS = [
    ch.strip() for ch in os.getenv("AUTOBAN_IGNORE_CHANNELS", "").split(",")
    if ch.strip()
]

# Mod Log Channel
MOD_LOG_CHANNEL_ID = os.getenv("MOD_LOG_CHANNEL_ID")

# Search Configuration
SEARCH_ENGINE = os.getenv("SEARCH_ENGINE", "https://www.google.com/search?q=")

# Spotify Configuration (for music)
SPOTIFY_CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")

# Logging Configuration
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").lower()

# Status Messages
STATUS_MESSAGES = [
    "no dont do that, dont stick your hand in",
    "no tennis balls",
    "contact @vee.anti for help or smth",
    "I'm just doing this to learn pretty much.",
    "meow",
    "welcome to the machine",
]
