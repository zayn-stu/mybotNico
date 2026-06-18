async function handleMessageReactionRemove(reaction, user) {
  // No storage write needed — participation is derived from live reactions at draw time
  return;
}

module.exports = { handleMessageReactionRemove };
