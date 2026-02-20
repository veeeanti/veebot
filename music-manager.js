import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  getVoiceConnection,
  entersState,
} from '@discordjs/voice';
import play from 'play-dl';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

class MusicManager {
  constructor() {
    this.queues = new Map(); // guildId -> { textChannel, voiceChannel, connection, player, songs: [], volume: 5, playing: true, loop: 'none' }
  }

  async ensureSpotifyAuthorized() {
    try {
      const clientId = process.env.SPOTIFY_CLIENT_ID;
      const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

      if (!clientId || !clientSecret || clientId.includes('your_') || clientSecret.includes('your_')) {
        throw new Error('Spotify credentials missing in environment.');
      }

      // Explicitly set the credentials in play-dl. 
      // This ensures play-dl uses the latest env vars and initializes its internal Spotify state.
      await play.setToken({
        spotify: {
          client_id: clientId,
          client_secret: clientSecret
        }
      });

      // Ensure a valid token is fetched/refreshed. 
      // is_expired('spotify') can throw if no token has ever been fetched.
      try {
        const isExpired = await play.is_expired('spotify');
        if (isExpired) {
          await play.refreshToken();
        }
      } catch (e) {
        // If it throws or is not initialized, we attempt to refresh/fetch the token.
        // This is safe to call after setToken with valid credentials.
        await play.refreshToken();
      }
    } catch (e) {
      // Bubble up so caller can decide how to notify users
      throw e;
    }
  }

  async handlePlay(interaction) {
    const guildId = interaction.guildId;
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply('❌ You need to be in a voice channel to play music!');
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions?.has(PermissionFlagsBits.Speak)) {
      return interaction.reply('❌ I need the permissions to join and speak in your voice channel!');
    }

    const query = interaction.options.getString('query');
    await interaction.deferReply();

    try {
      let songs = [];
      const validation = await play.validate(query);

      // Ensure Spotify is authorized if we're going to work with Spotify URLs
      if (validation && validation.startsWith('sp_')) {
        try {
          await this.ensureSpotifyAuthorized();
        } catch (authErr) {
          console.error('Spotify authorization failed:', authErr?.message || authErr);
          const errorMsg = (authErr.message === 'Spotify credentials missing in environment.')
            ? '❌ Spotify credentials (SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET) are missing in the bot configuration.'
            : `❌ Spotify authorization failed: ${authErr.message}. Please check your credentials.`;
          return interaction.editReply(errorMsg);
        }
      }

      if (validation === 'sp_track') {
        const spData = await play.spotify(query);
        songs.push({
          title: spData.name,
          url: spData.url,
          duration: spData.durationRaw,
          thumbnail: spData.thumbnail?.url,
          source: 'spotify',
        });
      } else if (validation === 'sp_playlist' || validation === 'sp_album') {
        const spPlaylist = await play.spotify(query);
        const allTracks = await spPlaylist.all_tracks();
        songs = allTracks.map(track => ({
          title: track.name,
          url: track.url,
          duration: track.durationRaw,
          thumbnail: track.thumbnail?.url,
          source: 'spotify',
        }));
        await interaction.editReply(`📝 Added **${songs.length}** tracks from Spotify ${validation === 'sp_playlist' ? 'playlist' : 'album'} to the queue.`);
      } else if (validation === 'yt_playlist') {
        const playlist = await play.playlist_info(query, { incomplete: true });
        const videos = await playlist.all_videos();
        songs = videos.map(video => ({
          title: video.title,
          url: video.url,
          duration: video.durationRaw,
          thumbnail: video.thumbnails[0]?.url,
          source: 'youtube',
        }));
        await interaction.editReply(`📝 Added **${songs.length}** tracks from YouTube playlist to the queue.`);
      } else if (validation === 'so_track') {
        const soData = await play.soundcloud(query);
        songs.push({
          title: soData.name,
          url: soData.url,
          duration: soData.durationInMs ? new Date(soData.durationInMs).toISOString().substr(11, 8) : 'N/A',
          thumbnail: soData.thumbnail,
          source: 'soundcloud',
        });
      } else if (validation === 'yt_video' || validation === 'search') {
        const ytResults = await play.search(query, { limit: 1 });
        if (ytResults.length === 0) {
          return interaction.editReply(`❌ No results found for: **${query}**`);
        }
        const ytData = ytResults[0];
        songs.push({
          title: ytData.title,
          url: ytData.url,
          duration: ytData.durationRaw,
          thumbnail: ytData.thumbnails[0]?.url,
          source: 'youtube',
        });
      } else {
        return interaction.editReply('❌ Unsupported URL or search query.');
      }

      let serverQueue = this.queues.get(guildId);

      if (!serverQueue) {
        const queueContruct = {
          textChannel: interaction.channel,
          voiceChannel: voiceChannel,
          connection: null,
          player: null,
          songs: [],
          volume: 5,
          playing: true,
          loop: 'none', // 'none', 'song', 'queue'
        };

        this.queues.set(guildId, queueContruct);
        queueContruct.songs.push(...songs);

        try {
          const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
          });

          queueContruct.connection = connection;
          this.play(guildId, queueContruct.songs[0]);
          
          if (songs.length === 1) {
            const song = songs[0];
            const embed = new EmbedBuilder()
              .setTitle('🎶 Added to Queue')
              .setDescription(`[${song.title}](${song.url})`)
              .setThumbnail(song.thumbnail)
              .addFields(
                { name: 'Source', value: song.source, inline: true },
                { name: 'Duration', value: song.duration, inline: true }
              )
              .setColor(0x00ae86);

            await interaction.editReply({ embeds: [embed] });
          }
        } catch (err) {
          console.error(err);
          this.queues.delete(guildId);
          return interaction.editReply(`❌ Error joining voice channel: ${err.message}`);
        }
      } else {
        serverQueue.songs.push(...songs);
        if (songs.length === 1) {
          const song = songs[0];
          const embed = new EmbedBuilder()
            .setTitle('🎶 Added to Queue')
            .setDescription(`[${song.title}](${song.url})`)
            .setThumbnail(song.thumbnail)
            .addFields(
              { name: 'Source', value: song.source, inline: true },
              { name: 'Duration', value: song.duration, inline: true }
            )
            .setColor(0x00ae86);
          return interaction.editReply({ embeds: [embed] });
        }
      }
    } catch (error) {
      console.error('Play command error:', error);
      const isAuthError = error?.message && /spotify data is missing|authorization/i.test(error.message);
      const msg = isAuthError
        ? `❌ Spotify authorization failed: **${error.message}**. Please ensure SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are correct in your .env file and restart the bot.`
        : `❌ An error occurred while trying to play music: ${error.message}`;
      interaction.editReply(msg);
    }
  }

  async play(guildId, song) {
    const serverQueue = this.queues.get(guildId);
    if (!song) {
      // Wait a bit before leaving
      setTimeout(() => {
        const q = this.queues.get(guildId);
        if (q && q.songs.length === 0) {
           q.connection.destroy();
           this.queues.delete(guildId);
        }
      }, 30000);
      return;
    }

    if (!serverQueue.player) {
      serverQueue.player = createAudioPlayer();
      serverQueue.connection.subscribe(serverQueue.player);

      serverQueue.player.on(AudioPlayerStatus.Idle, () => {
        if (serverQueue.loop === 'song') {
          // Play the same song again
          this.play(guildId, serverQueue.songs[0]);
        } else if (serverQueue.loop === 'queue') {
          // Move finished song to the end
          const finishedSong = serverQueue.songs.shift();
          serverQueue.songs.push(finishedSong);
          this.play(guildId, serverQueue.songs[0]);
        } else {
          // No loop
          serverQueue.songs.shift();
          this.play(guildId, serverQueue.songs[0]);
        }
      });

      serverQueue.player.on('error', (error) => {
        console.error(`Error: ${error.message} with resource`);
        serverQueue.songs.shift();
        this.play(guildId, serverQueue.songs[0]);
      });

      serverQueue.connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(serverQueue.connection, VoiceConnectionStatus.Signalling, 5000),
            entersState(serverQueue.connection, VoiceConnectionStatus.Connecting, 5000),
          ]);
          // Seems to be reconnecting
        } catch (e) {
          // Real disconnect
          serverQueue.connection.destroy();
          this.queues.delete(guildId);
        }
      });
    }

    try {
      const streamResult = await play.stream(song.url);
      const resource = createAudioResource(streamResult.stream, {
        inputType: streamResult.type,
        inlineVolume: true,
      });
      resource.volume.setVolume(serverQueue.volume / 10);
      serverQueue.player.play(resource);

      const embed = new EmbedBuilder()
        .setTitle('🎵 Now Playing')
        .setDescription(`[${song.title}](${song.url})`)
        .setThumbnail(song.thumbnail)
        .addFields(
          { name: 'Source', value: song.source, inline: true },
          { name: 'Duration', value: song.duration, inline: true },
          { name: 'Loop', value: serverQueue.loop.charAt(0).toUpperCase() + serverQueue.loop.slice(1), inline: true }
        )
        .setColor(0x00ff00);

      serverQueue.textChannel.send({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      serverQueue.textChannel.send(`❌ Error playing song: ${err.message}`);
      serverQueue.songs.shift();
      this.play(guildId, serverQueue.songs[0]);
    }
  }

  handleSkip(interaction) {
    const serverQueue = this.queues.get(interaction.guildId);
    if (!interaction.member.voice.channel) {
      return interaction.reply('❌ You have to be in a voice channel to skip the music!');
    }
    if (!serverQueue) {
      return interaction.reply('❌ There is no song that I could skip!');
    }
    serverQueue.player.stop();
    return interaction.reply('⏭️ Skipped the song!');
  }

  handleStop(interaction) {
    const serverQueue = this.queues.get(interaction.guildId);
    if (!interaction.member.voice.channel) {
      return interaction.reply('❌ You have to be in a voice channel to stop the music!');
    }
    if (!serverQueue) {
      return interaction.reply('❌ There is no song that I could stop!');
    }
    serverQueue.songs = [];
    serverQueue.player.stop();
    serverQueue.connection.destroy();
    this.queues.delete(interaction.guildId);
    return interaction.reply('⏹️ Stopped the music and cleared the queue!');
  }

  handleQueue(interaction) {
    const serverQueue = this.queues.get(interaction.guildId);
    if (!serverQueue || serverQueue.songs.length === 0) {
      return interaction.reply('❌ The queue is currently empty.');
    }

    const queueList = serverQueue.songs
      .slice(0, 10)
      .map((song, index) => `${index + 1}. **${song.title}**`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle('🎼 Current Queue')
      .setDescription(queueList + (serverQueue.songs.length > 10 ? `\n...and ${serverQueue.songs.length - 10} more.` : ''))
      .setColor(0x5865f2);

    return interaction.reply({ embeds: [embed] });
  }

  handlePause(interaction) {
    const serverQueue = this.queues.get(interaction.guildId);
    if (!serverQueue) return interaction.reply('❌ There is nothing playing.');
    if (serverQueue.player.state.status === AudioPlayerStatus.Paused) return interaction.reply('⏸️ The music is already paused.');
    serverQueue.player.pause();
    return interaction.reply('⏸️ Paused the music.');
  }

  handleResume(interaction) {
    const serverQueue = this.queues.get(interaction.guildId);
    if (!serverQueue) return interaction.reply('❌ There is nothing playing.');
    if (serverQueue.player.state.status === AudioPlayerStatus.Playing) return interaction.reply('▶️ The music is already playing.');
    serverQueue.player.unpause();
    return interaction.reply('▶️ Resumed the music.');
  }

  handleVolume(interaction) {
    const serverQueue = this.queues.get(interaction.guildId);
    if (!serverQueue) return interaction.reply('❌ There is nothing playing.');
    const volume = interaction.options.getInteger('volume');
    if (volume < 0 || volume > 100) return interaction.reply('❌ Volume must be between 0 and 100.');
    
    serverQueue.volume = volume;
    if (serverQueue.player.state.resource) {
      serverQueue.player.state.resource.volume.setVolume(volume / 10);
    }
    return interaction.reply(`🔊 Volume set to **${volume}%**.`);
  }

  handleLoop(interaction) {
    const serverQueue = this.queues.get(interaction.guildId);
    if (!serverQueue) return interaction.reply('❌ There is nothing playing.');
    const mode = interaction.options.getString('mode'); // 'none', 'song', 'queue'
    serverQueue.loop = mode;
    return interaction.reply(`🔁 Loop mode set to **${mode.charAt(0).toUpperCase() + mode.slice(1)}**.`);
  }

  handleShuffle(interaction) {
    const serverQueue = this.queues.get(interaction.guildId);
    if (!serverQueue || serverQueue.songs.length < 2) return interaction.reply('❌ Not enough songs in the queue to shuffle.');
    
    const currentSong = serverQueue.songs.shift();
    for (let i = serverQueue.songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [serverQueue.songs[i], serverQueue.songs[j]] = [serverQueue.songs[j], serverQueue.songs[i]];
    }
    serverQueue.songs.unshift(currentSong);
    return interaction.reply('🔀 Shuffled the queue!');
  }

  handleRemove(interaction) {
    const serverQueue = this.queues.get(interaction.guildId);
    if (!serverQueue) return interaction.reply('❌ There is no queue.');
    const index = interaction.options.getInteger('index');
    if (index <= 0 || index >= serverQueue.songs.length) return interaction.reply('❌ Invalid song index.');
    
    const removed = serverQueue.songs.splice(index, 1);
    return interaction.reply(`🗑️ Removed **${removed[0].title}** from the queue.`);
  }

  handleClear(interaction) {
    const serverQueue = this.queues.get(interaction.guildId);
    if (!serverQueue) return interaction.reply('❌ There is no queue.');
    serverQueue.songs = [serverQueue.songs[0]]; // Keep current song
    return interaction.reply('🧹 Cleared the queue!');
  }

  handleNowPlaying(interaction) {
    const serverQueue = this.queues.get(interaction.guildId);
    if (!serverQueue || serverQueue.songs.length === 0) {
      return interaction.reply('❌ Nothing is playing right now.');
    }

    const song = serverQueue.songs[0];
    const embed = new EmbedBuilder()
      .setTitle('🎵 Now Playing')
      .setDescription(`[${song.title}](${song.url})`)
      .setThumbnail(song.thumbnail)
      .addFields(
        { name: 'Source', value: song.source, inline: true },
        { name: 'Duration', value: song.duration, inline: true }
      )
      .setColor(0x00ff00);

    return interaction.reply({ embeds: [embed] });
  }
}

export default new MusicManager();