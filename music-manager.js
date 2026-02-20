import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MusicManager {
  constructor() {
    this.pythonProcess = null;
    this.startPythonBot();
  }

  startPythonBot() {
    // Use 'python' or 'python3' based on environment
    const pythonExecutable = 'python';
    const scriptPath = path.join(__dirname, 'music_bot.py');
    
    console.log(`🚀 Starting Python Music Bot: ${scriptPath}`);
    
    this.pythonProcess = spawn(pythonExecutable, [scriptPath], {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: process.env,
    });

    this.pythonProcess.on('close', (code) => {
      console.log(`⚠️ Python Music Bot exited with code ${code}. Restarting in 5s...`);
      setTimeout(() => this.startPythonBot(), 5000);
    });

    this.pythonProcess.on('error', (err) => {
      console.error('Failed to start Python Music Bot:', err);
    });
  }

  sendCommand(data) {
    if (this.pythonProcess && this.pythonProcess.stdin.writable) {
      this.pythonProcess.stdin.write(JSON.stringify(data) + '\n');
    } else {
      console.error('Cannot send command to Python Music Bot: Process not writable');
    }
  }

  async handlePlay(interaction) {
    await interaction.deferReply();
    const query = interaction.options.getString('query');
    this.sendCommand({
      command: 'play',
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      voiceChannelId: interaction.member?.voice?.channelId,
      token: interaction.token,
      interactionId: interaction.id,
      query: query
    });
  }

  async handleStop(interaction) {
    await interaction.deferReply();
    this.sendCommand({
      command: 'stop',
      guildId: interaction.guildId,
      token: interaction.token
    });
  }

  async handleSkip(interaction) {
    await interaction.deferReply();
    this.sendCommand({
      command: 'skip',
      guildId: interaction.guildId,
      token: interaction.token
    });
  }

  async handleQueue(interaction) {
    await interaction.deferReply();
    this.sendCommand({
      command: 'queue',
      guildId: interaction.guildId,
      token: interaction.token
    });
  }

  async handlePause(interaction) {
    await interaction.deferReply();
    this.sendCommand({
      command: 'pause',
      guildId: interaction.guildId,
      token: interaction.token
    });
  }

  async handleResume(interaction) {
    await interaction.deferReply();
    this.sendCommand({
      command: 'resume',
      guildId: interaction.guildId,
      token: interaction.token
    });
  }

  async handleVolume(interaction) {
    await interaction.deferReply();
    const volume = interaction.options.getInteger('volume');
    this.sendCommand({
      command: 'volume',
      guildId: interaction.guildId,
      token: interaction.token,
      volume: volume
    });
  }

  async handleLoop(interaction) {
    await interaction.deferReply();
    const mode = interaction.options.getString('mode');
    this.sendCommand({
      command: 'loop',
      guildId: interaction.guildId,
      token: interaction.token,
      mode: mode
    });
  }

  async handleShuffle(interaction) {
    await interaction.deferReply();
    this.sendCommand({
      command: 'shuffle',
      guildId: interaction.guildId,
      token: interaction.token
    });
  }

  async handleRemove(interaction) {
    await interaction.deferReply();
    const index = interaction.options.getInteger('index');
    this.sendCommand({
      command: 'remove',
      guildId: interaction.guildId,
      token: interaction.token,
      index: index
    });
  }

  async handleClear(interaction) {
    await interaction.deferReply();
    this.sendCommand({
      command: 'clear',
      guildId: interaction.guildId,
      token: interaction.token
    });
  }

  async handleNowPlaying(interaction) {
    await interaction.deferReply();
    this.sendCommand({
      command: 'nowplaying',
      guildId: interaction.guildId,
      token: interaction.token
    });
  }
}

export default new MusicManager();