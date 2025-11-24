const express = require('express');
const auth = require('../middleware/auth');
const Group = require('../models/Group');
const User = require('../models/User');

const router = express.Router();

router.post('/', auth, async (req, res) => {
  const { groupName, memberIds } = req.body;
  if (!groupName) {
    return res.status(400).json({ message: 'groupName required' });
  }

  const members = Array.isArray(memberIds) ? memberIds : [];
  if (!members.includes(req.user.id)) {
    members.push(req.user.id);
  }

  try {
    const group = await Group.create({
      groupName,
      members,
      createdBy: req.user.id
    });

    return res.status(201).json(group);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create group' });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user.id }).populate('members', 'username onlineStatus');
    return res.json(groups);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch groups' });
  }
});

router.post('/:id/members', auth, async (req, res) => {
  const { id } = req.params;
  const { memberIds = [] } = req.body;

  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ message: 'memberIds array required' });
  }

  try {
    const group = await Group.findById(id);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const isMember = group.members.some(memberId => memberId.toString() === req.user.id);
    if (!isMember) {
      return res.status(403).json({ message: 'You must be a member of the group to add members' });
    }

    const currentUser = await User.findById(req.user.id);
    const invalidMembers = memberIds.filter(memberId => 
      !currentUser.friends || !currentUser.friends.some(friendId => friendId.toString() === memberId)
    );

    if (invalidMembers.length > 0) {
      return res.status(400).json({ message: 'Can only add friends to the group' });
    }

    const updateResult = await Group.findByIdAndUpdate(
      id,
      { $addToSet: { members: { $each: memberIds } } },
      { new: true }
    ).populate('members', 'username onlineStatus');

    return res.json({ message: 'Members added', group: updateResult });
  } catch (error) {
    console.error('Add members error:', error);
    return res.status(500).json({ message: 'Failed to add members' });
  }
});

router.delete('/:id/members/:memberId', auth, async (req, res) => {
  const { id, memberId } = req.params;

  try {
    const group = await Group.findOne({
      _id: id,
      createdBy: req.user.id
    });

    if (!group) {
      return res.status(404).json({ message: 'Group not found or not owner' });
    }

    await Group.findByIdAndUpdate(id, { $pull: { members: memberId } });
    return res.json({ message: 'Member removed' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to remove member' });
  }
});

module.exports = router;

