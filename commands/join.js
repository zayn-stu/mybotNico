const { joinVoice } = require('../features/voice/connection');

module.exports = {
  name: 'join',
  description: 'Join a voice channel',
  async execute(message, args) {
    await joinVoice(message, args);
  },
};
