"""Music cog for Discord music playback using wavelink."""
import asyncio
import logging
from typing import Optional

import discord
from discord.ext import commands
import wavelink

import config

logger = logging.getLogger(__name__)


class MusicCog(commands.Cog):
    """Music playback cog."""
    
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.player: Optional[wavelink.Player] = None
    
    async def cog_load(self):
        """Initialize wavelink."""
        # Initialize wavelink node
        node = wavelink.Node(
            uri="https://lavalink.dev",
            password="youshallnotpass",
            secure=False
        )
        await wavelink.Pool.connect(node=node, client=self.bot)
        logger.info("Wavelink music node connected")
    
    async def cog_unload(self):
        """Cleanup on unload."""
        await wavelink.Pool.disconnect()
    
    @commands.command(name="join", description="Join voice channel")
    async def join_command(self, ctx: commands.Context):
        """Join a voice channel."""
        if not ctx.author.voice:
            await ctx.send("❌ You must be in a voice channel.")
            return
        
        channel = ctx.author.voice.channel
        player = await channel.connect(cls=wavelink.Player)
        self.player = player
        
        await ctx.send(f"✅ Joined {channel.name}")
    
    @commands.command(name="leave", description="Leave voice channel")
    async def leave_command(self, ctx: commands.Context):
        """Leave the voice channel."""
        if not ctx.voice_client:
            await ctx.send("❌ I'm not in a voice channel.")
            return
        
        await ctx.voice_client.disconnect()
        await ctx.send("👋 Left the voice channel")
    
    @commands.command(name="play", description="Play a song")
    async def play_command(self, ctx: commands.Context, *, query: str):
        """Play a song from URL or search."""
        if not ctx.voice_client:
            if not ctx.author.voice:
                await ctx.send("❌ You must be in a voice channel.")
                return
            
            channel = ctx.author.voice.channel
            player = await channel.connect(cls=wavelink.Player)
            self.player = player
        
        # Search for track
        tracks = await wavelink.YoutubeSearchProvider().search(query)
        
        if not tracks:
            await ctx.send("❌ No tracks found.")
            return
        
        track = tracks[0]
        
        # Convert to wavelink track
        wavelink_track = wavelink.Track(
            id_=track.id,
            info=track.info
        )
        
        await ctx.voice_client.play(wavelink_track)
        await ctx.send(f"🎵 Now playing: {track.title}")
    
    @commands.command(name="pause", description="Pause the current song")
    async def pause_command(self, ctx: commands.Context):
        """Pause playback."""
        if not ctx.voice_client or not ctx.voice_client.playing:
            await ctx.send("❌ Nothing is playing.")
            return
        
        await ctx.voice_client.pause()
        await ctx.send("⏸️ Paused")
    
    @commands.command(name="resume", description="Resume playback")
    async def resume_command(self, ctx: commands.Context):
        """Resume playback."""
        if not ctx.voice_client or not ctx.voice_client.paused:
            await ctx.send("❌ Nothing is paused.")
            return
        
        await ctx.voice_client.resume()
        await ctx.send("▶️ Resumed")
    
    @commands.command(name="stop", description="Stop playback")
    async def stop_command(self, ctx: commands.Context):
        """Stop playback."""
        if not ctx.voice_client:
            await ctx.send("❌ Nothing is playing.")
            return
        
        await ctx.voice_client.stop()
        await ctx.send("⏹️ Stopped")
    
    @commands.command(name="skip", description="Skip the current song")
    async def skip_command(self, ctx: commands.Context):
        """Skip the current track."""
        if not ctx.voice_client or not ctx.voice_client.playing:
            await ctx.send("❌ Nothing is playing.")
            return
        
        await ctx.voice_client.stop()
        await ctx.send("⏭️ Skipped")
    
    @commands.command(name="queue", description="Show the queue")
    async def queue_command(self, ctx: commands.Context):
        """Show the current queue."""
        if not ctx.voice_client or not hasattr(ctx.voice_client, 'queue'):
            await ctx.send("❌ No queue available.")
            return
        
        queue = ctx.voice_client.queue
        
        if not queue:
            await ctx.send("📭 Queue is empty.")
            return
        
        embed = discord.Embed(title="📋 Music Queue", color=discord.Color.blurple())
        
        for i, track in enumerate(queue[:10], 1):
            embed.add_field(name=f"{i}. {track.title}", value=track.author or "Unknown", inline=False)
        
        await ctx.send(embed=embed)
    
    @commands.command(name="volume", description="Set volume (0-100)")
    async def volume_command(self, ctx: commands.Context, volume: int = None):
        """Set the volume."""
        if volume is None:
            if ctx.voice_client:
                await ctx.send(f"🔊 Current volume: {ctx.voice_client.volume}")
            else:
                await ctx.send("❌ Not connected to voice.")
            return
        
        volume = max(0, min(100, volume))
        
        if ctx.voice_client:
            await ctx.voice_client.set_volume(volume)
            await ctx.send(f"🔊 Volume set to {volume}%")


async def setup(bot: commands.Bot):
    """Setup the music cog."""
    await bot.add_cog(MusicCog(bot))
