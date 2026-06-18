const { leaveVoice } = require('../features/voice/connection');

module.exports = {
  name: 'leave',
  description: 'Leave the current voice channel',
  execute(message) {
    return leaveVoice(message);
  },
};
