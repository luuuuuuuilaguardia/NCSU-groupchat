const buildDirectConversationId = (userIdA, userIdB) => {
  const ids = [userIdA.toString(), userIdB.toString()].sort();
  return `direct:${ids[0]}:${ids[1]}`;
};

module.exports = {
  buildDirectConversationId
};

