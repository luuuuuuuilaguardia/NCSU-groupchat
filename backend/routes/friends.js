const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const FriendRequest = require('../models/FriendRequest');

const router = express.Router();

router.post('/request', auth, async (req, res) => {
  const { receiverId } = req.body;
  if (!receiverId) {
    return res.status(400).json({ message: 'receiverId required' });
  }

  if (receiverId === req.user.id) {
    return res.status(400).json({ message: 'Cannot send request to yourself' });
  }

  try {
    const currentUser = await User.findById(req.user.id);
    if (currentUser.friends && currentUser.friends.some(friendId => friendId.toString() === receiverId)) {
      return res.status(400).json({ message: 'Already friends with this user' });
    }

    const existing = await FriendRequest.findOne({
      $or: [
        { senderId: req.user.id, receiverId, status: 'pending' },
        { senderId: receiverId, receiverId: req.user.id, status: 'pending' }
      ]
    });

    if (existing) {
      return res.status(400).json({ message: 'Request already pending' });
    }

    const acceptedRequest = await FriendRequest.findOne({
      $or: [
        { senderId: req.user.id, receiverId, status: 'accepted' },
        { senderId: receiverId, receiverId: req.user.id, status: 'accepted' }
      ]
    });

    if (acceptedRequest) {
      return res.status(400).json({ message: 'Already friends with this user' });
    }

    await FriendRequest.create({ senderId: req.user.id, receiverId });
    return res.status(201).json({ message: 'Request sent' });
  } catch (error) {
    console.error('Friend request error:', error);
    return res.status(500).json({ message: 'Failed to send request' });
  }
});

router.post('/accept', auth, async (req, res) => {
  const { requestId } = req.body;
  if (!requestId) {
    return res.status(400).json({ message: 'requestId required' });
  }

  try {
    const request = await FriendRequest.findOne({
      _id: requestId,
      receiverId: req.user.id,
      status: 'pending'
    });

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    await FriendRequest.findByIdAndUpdate(requestId, { status: 'accepted' });
    await User.findByIdAndUpdate(req.user.id, { $addToSet: { friends: request.senderId } });
    await User.findByIdAndUpdate(request.senderId, { $addToSet: { friends: req.user.id } });

    return res.json({ message: 'Request accepted' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to accept request' });
  }
});

router.post('/decline', auth, async (req, res) => {
  const { requestId } = req.body;
  if (!requestId) {
    return res.status(400).json({ message: 'requestId required' });
  }

  try {
    const request = await FriendRequest.findOne({
      _id: requestId,
      receiverId: req.user.id,
      status: 'pending'
    });

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    await FriendRequest.findByIdAndUpdate(requestId, { status: 'declined' });
    return res.json({ message: 'Request declined' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to decline request' });
  }
});

router.get('/list', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('friends', 'username email onlineStatus lastSeen');
    return res.json(user.friends || []);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch friends' });
  }
});

router.get('/requests', auth, async (req, res) => {
  try {
    const requests = await FriendRequest.find({
      receiverId: req.user.id,
      status: 'pending'
    }).populate('senderId', 'username email');

    return res.json(requests);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch requests' });
  }
});

module.exports = router;

