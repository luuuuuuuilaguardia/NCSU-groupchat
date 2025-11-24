const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { setOtp, verifyOtp } = require('../services/otpStore');
const { sendOtpEmail } = require('../services/mailer');

const router = express.Router();
const OTP_TTL_MINUTES = 10;

const generateToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set in environment variables');
  }
  return jwt.sign(
    {
      id: user._id,
      username: user.username,
      email: user.email
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
};

router.post(
  '/register',
  [
    body('username').isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9._-]+$/),
    body('email').isEmail(),
    body('password').isLength({ min: 8 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array().map(e => ({ field: e.path, msg: e.msg }))
      });
    }

    const { username, email, password } = req.body;

    try {
      const existing = await User.findOne({
        $or: [{ username }, { email }]
      });
      if (existing) {
        return res.status(400).json({ message: 'Username or email already taken' });
      }

      const hashed = await bcrypt.hash(password, 10);
      const user = await User.create({ username, email, password: hashed });
      const token = generateToken(user);
      const safeUser = user.toObject();
      delete safeUser.password;

      return res.status(201).json({ token, user: safeUser });
    } catch (error) {
      console.error('Registration error:', error);
      if (error.code === 11000) {
        return res.status(400).json({ message: 'Username or email already taken' });
      }
      return res.status(500).json({ 
        message: 'Registration failed',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

router.post(
  '/login',
  [body('identifier').notEmpty(), body('password').exists()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array().map(e => ({ field: e.path, msg: e.msg }))
      });
    }

    const { identifier, password } = req.body;

    try {
      const user = await User.findOne({
        $or: [{ username: identifier }, { email: identifier }]
      });

      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const token = generateToken(user);
      const safeUser = user.toObject();
      delete safeUser.password;
      return res.json({ token, user: safeUser });
    } catch (error) {
      console.error('Login error:', error);
      return res.status(500).json({ 
        message: 'Login failed',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

router.post('/forgot-password', [body('email').isEmail()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    setOtp(email, otpCode, OTP_TTL_MINUTES * 60 * 1000);
    await sendOtpEmail({
      to: email,
      appName: process.env.APP_NAME || 'GroupChat',
      otpCode,
      expiresInMinutes: OTP_TTL_MINUTES
    });

    return res.json({ message: 'OTP sent to email' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to send OTP' });
  }
});

router.post(
  '/verify-otp',
  [body('email').isEmail(), body('otp').isLength({ min: 6, max: 6 }), body('newPassword').isLength({ min: 8 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, otp, newPassword } = req.body;

    try {
      const valid = verifyOtp(email, otp);
      if (!valid) {
        return res.status(400).json({ message: 'Invalid or expired OTP' });
      }

      const hashed = await bcrypt.hash(newPassword, 10);
      await User.findOneAndUpdate({ email }, { password: hashed });

      return res.json({ message: 'Password updated' });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to update password' });
    }
  }
);

module.exports = router;

