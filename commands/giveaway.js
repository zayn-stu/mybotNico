const { execute } = require('../features/giveaways/setupCommand');

module.exports = {
  name: 'giveaway',
  description: 'Create and manage giveaways',
  execute,
};
