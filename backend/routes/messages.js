const express = require('express');
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const Group = require('../models/Group');
const { buildDirectConversationId } = require('../utils/conversation');

const router = express.Router();

router.get('/:conversationId', auth, async (req, res) => {
  try {
    const messages = await Message.find({ conversationId: req.params.conversationId })
      .sort({ createdAt: 1 })
      .populate('senderId', 'username')
      .populate('reactions.userId', 'username');
    return res.json(messages);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch messages' });
  }
});

router.post('/send', auth, async (req, res) => {
  const { recipientId, groupId, messageText } = req.body;
  if (!messageText) {
    return res.status(400).json({ message: 'messageText required' });
  }

  try {
    let conversationId;
    let isGroup = false;
    let resolvedGroupId = null;

    if (groupId) {
      const group = await Group.findById(groupId);
      if (!group || !group.members.some((member) => member.toString() === req.user.id)) {
        return res.status(403).json({ message: 'Not part of group' });
      }
      conversationId = `group:${groupId}`;
      isGroup = true;
      resolvedGroupId = groupId;
    } else if (recipientId) {
      conversationId = buildDirectConversationId(req.user.id, recipientId);
    } else {
      return res.status(400).json({ message: 'recipientId or groupId required' });
    }

    let message = await Message.create({
      conversationId,
      senderId: req.user.id,
      messageText,
      isGroup,
      groupId: resolvedGroupId
    });

    message = await message.populate('senderId', 'username');
    return res.status(201).json(message);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to send message' });
  }
});

router.post('/:id/react', auth, async (req, res) => {
  const { emoji } = req.body;
  if (!emoji) {
    return res.status(400).json({ message: 'emoji required' });
  }

  try {
    const message = await Message.findByIdAndUpdate(
      req.params.id,
      {
        $pull: { reactions: { userId: req.user.id } }
      },
      { new: true }
    );

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    message.reactions.push({ userId: req.user.id, emoji });
    await message.save();
    await message.populate('reactions.userId', 'username');
    return res.json(message);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to add reaction' });
  }
});

module.exports = router;

