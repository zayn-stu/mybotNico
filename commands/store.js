const { executeStore } = require('../features/nicoscave/commands');

module.exports = {
  name: 'store',
  description: "Open Nico's Cave store",
  async execute(message) {
    await executeStore(message);
  },
};
