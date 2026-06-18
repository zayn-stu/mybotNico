const {
  sendRecordingStatus,
  startRecording,
  stopRecording,
} = require('../features/voice/screenRecording/service');

module.exports = {
  name: 'record',
  description: 'Manage screen recording',
  async execute(message, args) {
    const subcommand = args[0]?.toLowerCase();

    if (subcommand === 'on') return startRecording(message);
    if (subcommand === 'off') return stopRecording(message);

    return sendRecordingStatus(message);
  },
};
