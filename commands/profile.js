const { executeProfile } = require('../features/nicoscave/commands');

module.exports = {
  name: 'profile',
  description: "Show your Nico's Cave profile",
  async execute(message) {
    await executeProfile(message);
  },
};
