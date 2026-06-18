const { requestClip } = require('../features/voice/screenRecording/service');

module.exports = {
  name: 'clip',
  description: 'Save a clip from the active screen recording',
  async execute(message, args) {
    return requestClip(message, args.join(' ').trim());
  },
};
