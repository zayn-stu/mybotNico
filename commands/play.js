const { executePlay } = require('../features/nicoscave/commands');

module.exports = {
  name: 'play',
  description: "Raid Nico's Cave",
  async execute(message) {
    await executePlay(message);
  },
};
