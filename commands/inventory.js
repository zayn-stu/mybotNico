const { executeInventory } = require('../features/nicoscave/commands');

module.exports = {
  name: 'inventory',
  description: "Open your Nico's Cave inventory",
  async execute(message) {
    await executeInventory(message);
  },
};
