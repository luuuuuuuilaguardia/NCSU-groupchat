const express = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/search', auth, async (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ message: 'Query missing' });
  }

  try {
    const users = await User.find({
      _id: { $ne: req.user.id },
      $or: [{ username: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }]
    }).select('username email');

    return res.json(users);
  } catch (error) {
    return res.status(500).json({ message: 'Search failed' });
  }
});

router.get('/profile/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json(user);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch profile' });
  }
});

router.get('/status/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('onlineStatus lastSeen');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json(user);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch status' });
  }
});

module.exports = router;

