import os
import sys
import asyncio
import json
import logging
import discord
from discord import app_commands
import yt_dlp
from dotenv import load_dotenv

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('MusicBot')

load_dotenv()
TOKEN = os.getenv('DISCORD_TOKEN')

# yt-dlp configuration
YDL_OPTIONS = {
    'format': 'bestaudio/best',
    'noplaylist': True,
    'nocheckcertificate': True,
    'ignoreerrors': False,
    'logtostderr': False,
    'quiet': True,
    'no_warnings': True,
    'default_search': 'auto',
    'source_address': '0.0.0.0'
}

FFMPEG_OPTIONS = {
    'before_options': '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5',
    'options': '-vn'
}

# Find ffmpeg
ffmpeg_path = os.path.join('node_modules', 'ffmpeg-static', 'ffmpeg.exe')
if not os.path.exists(ffmpeg_path):
    logger.info("ffmpeg-static not found at node_modules, falling back to system ffmpeg")
    ffmpeg_path = 'ffmpeg'
else:
    logger.info(f"Using ffmpeg-static at: {ffmpeg_path}")

class GuildState:
    def __init__(self, guild_id, bot):
        self.guild_id = guild_id
        self.bot = bot
        self.queue = []
        self.voice_client = None
        self.loop = 'none' # 'none', 'song', 'queue'
        self.volume = 0.5
        self.current_song = None
        self.text_channel = None

    async def play_next(self):
        if self.loop == 'song' and self.current_song:
            # Re-queue the same song
            pass 
        elif self.loop == 'queue' and self.current_song:
            self.queue.append(self.current_song)
            if self.queue:
                self.current_song = self.queue.pop(0)
            else:
                self.current_song = None
        else:
            if self.queue:
                self.current_song = self.queue.pop(0)
            else:
                self.current_song = None

        if self.current_song:
            await self.start_playback()
        else:
            
            await asyncio.sleep(30)
            if not self.queue and not self.current_song and self.voice_client:
                await self.voice_client.disconnect()
                self.voice_client = None

    async def start_playback(self):
        if not self.voice_client or not self.voice_client.is_connected():
            return

        try:
            with yt_dlp.YoutubeDL(YDL_OPTIONS) as ydl:
                info = ydl.extract_info(self.current_song['url'], download=False)
                url2 = info['url']
                
            source = discord.FFmpegPCMAudio(url2, executable=ffmpeg_path, **FFMPEG_OPTIONS)
            # Apply volume
            transformed_source = discord.PCMVolumeTransformer(source, volume=self.volume)
            
            self.voice_client.play(transformed_source, after=lambda e: self.bot.loop.create_task(self.play_next()))
            
            # Send Now Playing embed
            if self.text_channel:
                embed = discord.Embed(title="🎵 Now Playing", description=f"[{self.current_song['title']}]({self.current_song['url']})", color=0x00ff00)
                if self.current_song.get('thumbnail'):
                    embed.set_thumbnail(url=self.current_song['thumbnail'])
                embed.add_field(name="Source", value=self.current_song.get('source', 'Unknown'), inline=True)
                embed.add_field(name="Duration", value=self.current_song.get('duration', 'N/A'), inline=True)
                embed.add_field(name="Loop", value=self.loop.capitalize(), inline=True)
                await self.text_channel.send(embed=embed)
                
        except Exception as e:
            logger.error(f"Error in start_playback: {e}")
            if self.text_channel:
                await self.text_channel.send(f"❌ Error playing song: {e}")
            await self.play_next()

class MusicBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        intents.guilds = True
        intents.voice_states = True
        super().__init__(intents=intents)
        self.guild_states = {}

    async def on_ready(self):
        logger.info(f'Logged in as {self.user} (ID: {self.user.id})')
        # Start reading from stdin for commands from JS
        asyncio.create_task(self.read_stdin())

    async def get_guild_state(self, guild_id):
        guild_id = str(guild_id)
        if guild_id not in self.guild_states:
            self.guild_states[guild_id] = GuildState(guild_id, self)
        return self.guild_states[guild_id]

    async def read_stdin(self):
        # Set up stdin reading
        if sys.platform == 'win32':
            # On Windows, we need a different approach for non-blocking stdin
            while True:
                line = await asyncio.to_thread(sys.stdin.readline)
                if not line:
                    break
                try:
                    data = json.loads(line.strip())
                    await self.process_command(data)
                except Exception as e:
                    logger.error(f"Error processing stdin command: {e}")
        else:
            loop = asyncio.get_event_loop()
            reader = asyncio.StreamReader()
            protocol = asyncio.StreamReaderProtocol(reader)
            await loop.connect_read_pipe(lambda: protocol, sys.stdin)
            while True:
                line = await reader.readline()
                if not line:
                    break
                try:
                    data = json.loads(line.decode().strip())
                    await self.process_command(data)
                except Exception as e:
                    logger.error(f"Error processing stdin command: {e}")

    async def process_command(self, data):
        await self.wait_until_ready()
        command = data.get('command')
        guild_id = data.get('guildId')
        channel_id = data.get('channelId')
        user_id = data.get('userId')
        interaction_token = data.get('token')
        interaction_id = data.get('interactionId')
        
        logger.info(f"Received command: {command} for guild {guild_id}")
        
        guild = self.get_guild(int(guild_id))
        if not guild:
            logger.error(f"Guild {guild_id} not found")
            return

        state = await self.get_guild_state(guild_id)
        if channel_id:
            state.text_channel = self.get_channel(int(channel_id))

        if command == 'play':
            await self.handle_play(data, state)
        elif command == 'stop':
            await self.handle_stop(data, state)
        elif command == 'skip':
            await self.handle_skip(data, state)
        elif command == 'queue':
            await self.handle_queue(data, state)
        elif command == 'pause':
            await self.handle_pause(data, state)
        elif command == 'resume':
            await self.handle_resume(data, state)
        elif command == 'volume':
            await self.handle_volume(data, state)
        elif command == 'loop':
            await self.handle_loop(data, state)
        elif command == 'shuffle':
            await self.handle_shuffle(data, state)
        elif command == 'remove':
            await self.handle_remove(data, state)
        elif command == 'clear':
            await self.handle_clear(data, state)
        elif command == 'nowplaying':
            await self.handle_now_playing(data, state)

    async def send_interaction_response(self, token, content=None, embed=None):
        # Use a webhook to send the response back via the interaction token
        try:
            webhook = discord.Webhook.from_url(f"https://discord.com/api/webhooks/{self.user.id}/{token}", client=self)
            # Since we deferred in JS, we need to edit the original response
            if embed:
                await webhook.edit_message("@original", embed=embed)
            else:
                await webhook.edit_message("@original", content=content)
        except Exception as e:
            logger.error(f"Failed to send interaction response: {e}")
            # Fallback to sending a new message if editing fails
            try:
                webhook = discord.Webhook.from_url(f"https://discord.com/api/webhooks/{self.user.id}/{token}", client=self)
                if embed:
                    await webhook.send(embed=embed)
                else:
                    await webhook.send(content=content)
            except Exception as e2:
                logger.error(f"Failed to send fallback interaction response: {e2}")

    async def handle_play(self, data, state):
        query = data.get('query')
        voice_channel_id = data.get('voiceChannelId')
        token = data.get('token')
        
        if not voice_channel_id:
            await self.send_interaction_response(token, "❌ You need to be in a voice channel!")
            return

        voice_channel = self.get_channel(int(voice_channel_id))
        
        # Join voice
        if not state.voice_client or not state.voice_client.is_connected():
            state.voice_client = await voice_channel.connect()
        
        
        try:
            with yt_dlp.YoutubeDL(YDL_OPTIONS) as ydl:
                # Handle playlists vs. single tracks
                if 'youtube.com/playlist' in query or 'soundcloud.com/' in query and '/sets/' in query:
                    # Simplified playlist handling for now
                    info = ydl.extract_info(query, download=False, process=False)
                    if 'entries' in info:
                        # It's a playlist
                        entries = list(info['entries'])
                        added_count = 0
                        for entry in entries:
                            state.queue.append({
                                'title': entry.get('title', 'Unknown'),
                                'url': entry.get('url') or entry.get('webpage_url'),
                                'thumbnail': entry.get('thumbnail'),
                                'duration': str(entry.get('duration', 'N/A')),
                                'source': 'youtube' if 'youtube' in query else 'soundcloud'
                            })
                            added_count += 1
                        await self.send_interaction_response(token, f"📝 Added **{added_count}** tracks to the queue.")
                    else:
                        # Single track
                        self._add_single_track(info, state)
                        await self._send_added_embed(token, state.queue[-1])
                else:
                    # Search or single URL
                    info = ydl.extract_info(query, download=False)
                    if 'entries' in info: # Search result
                        video = info['entries'][0]
                    else:
                        video = info
                    
                    track = {
                        'title': video.get('title', 'Unknown'),
                        'url': video.get('webpage_url') or video.get('url'),
                        'thumbnail': video.get('thumbnail'),
                        'duration': str(video.get('duration', 'N/A')),
                        'source': 'youtube' if 'youtube' in video.get('extractor', '') else 'soundcloud'
                    }
                    state.queue.append(track)
                    await self._send_added_embed(token, track)

            if not state.voice_client.is_playing() and not state.current_song:
                await state.play_next()

        except Exception as e:
            logger.error(f"Play error: {e}")
            await self.send_interaction_response(token, f"❌ Error: {e}")

    def _add_single_track(self, info, state):
        state.queue.append({
            'title': info.get('title', 'Unknown'),
            'url': info.get('url') or info.get('webpage_url'),
            'thumbnail': info.get('thumbnail'),
            'duration': str(info.get('duration', 'N/A')),
            'source': 'youtube' if 'youtube' in info.get('webpage_url', '') else 'soundcloud'
        })

    async def _send_added_embed(self, token, track):
        embed = discord.Embed(title="🎶 Added to Queue", description=f"[{track['title']}]({track['url']})", color=0x00ae86)
        if track.get('thumbnail'):
            embed.set_thumbnail(url=track['thumbnail'])
        embed.add_field(name="Source", value=track.get('source', 'Unknown'), inline=True)
        embed.add_field(name="Duration", value=track.get('duration', 'N/A'), inline=True)
        await self.send_interaction_response(token, embed=embed)

    async def handle_stop(self, data, state):
        token = data.get('token')
        state.queue = []
        state.current_song = None
        if state.voice_client:
            await state.voice_client.disconnect()
            state.voice_client = None
        await self.send_interaction_response(token, "⏹️ Stopped the music and cleared the queue!")

    async def handle_skip(self, data, state):
        token = data.get('token')
        if state.voice_client and state.voice_client.is_playing():
            state.voice_client.stop()
            await self.send_interaction_response(token, "⏭️ Skipped the song!")
        else:
            await self.send_interaction_response(token, "❌ Nothing is playing.")

    async def handle_queue(self, data, state):
        token = data.get('token')
        if not state.queue and not state.current_song:
            await self.send_interaction_response(token, "❌ The queue is currently empty.")
            return

        q_list = []
        if state.current_song:
            q_list.append(f"Now Playing: **{state.current_song['title']}**")
        
        for i, song in enumerate(state.queue[:10]):
            q_list.append(f"{i+1}. **{song['title']}**")
            
        if len(state.queue) > 10:
            q_list.append(f"...and {len(state.queue)-10} more.")
            
        embed = discord.Embed(title="🎼 Current Queue", description="\n".join(q_list), color=0x5865f2)
        await self.send_interaction_response(token, embed=embed)

    async def handle_pause(self, data, state):
        token = data.get('token')
        if state.voice_client and state.voice_client.is_playing():
            state.voice_client.pause()
            await self.send_interaction_response(token, "⏸️ Paused the music.")
        else:
            await self.send_interaction_response(token, "❌ Nothing is playing.")

    async def handle_resume(self, data, state):
        token = data.get('token')
        if state.voice_client and state.voice_client.is_paused():
            state.voice_client.resume()
            await self.send_interaction_response(token, "▶️ Resumed the music.")
        else:
            await self.send_interaction_response(token, "❌ Music is not paused.")

    async def handle_volume(self, data, state):
        token = data.get('token')
        volume = data.get('volume')
        state.volume = volume / 100
        if state.voice_client and state.voice_client.source:
            state.voice_client.source.volume = state.volume
        await self.send_interaction_response(token, f"🔊 Volume set to **{volume}%**.")

    async def handle_loop(self, data, state):
        token = data.get('token')
        mode = data.get('mode')
        state.loop = mode
        await self.send_interaction_response(token, f"🔁 Loop mode set to **{mode.capitalize()}**.")

    async def handle_shuffle(self, data, state):
        token = data.get('token')
        import random
        random.shuffle(state.queue)
        await self.send_interaction_response(token, "🔀 Shuffled the queue!")

    async def handle_remove(self, data, state):
        token = data.get('token')
        index = data.get('index') - 1
        if 0 <= index < len(state.queue):
            removed = state.queue.pop(index)
            await self.send_interaction_response(token, f"🗑️ Removed **{removed['title']}** from the queue.")
        else:
            await self.send_interaction_response(token, "❌ Invalid index.")

    async def handle_clear(self, data, state):
        token = data.get('token')
        state.queue = []
        await self.send_interaction_response(token, "🧹 Cleared the queue!")

    async def handle_now_playing(self, data, state):
        token = data.get('token')
        if not state.current_song:
            await self.send_interaction_response(token, "❌ Nothing is playing.")
            return
            
        track = state.current_song
        embed = discord.Embed(title="🎵 Now Playing", description=f"[{track['title']}]({track['url']})", color=0x00ff00)
        if track.get('thumbnail'):
            embed.set_thumbnail(url=track['thumbnail'])
        embed.add_field(name="Source", value=track.get('source', 'Unknown'), inline=True)
        embed.add_field(name="Duration", value=track.get('duration', 'N/A'), inline=True)
        await self.send_interaction_response(token, embed=embed)

if __name__ == '__main__':
    bot = MusicBot()
    bot.run(TOKEN)
