const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const friendRoutes = require('./routes/friends');
const messageRoutes = require('./routes/messages');
const groupRoutes = require('./routes/groups');
const User = require('./models/User');
const Message = require('./models/Message');
const Group = require('./models/Group');
const { buildDirectConversationId } = require('./utils/conversation');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5008;

if (!process.env.JWT_SECRET) {
  console.error('❌ ERROR: JWT_SECRET is not set in environment variables');
  console.error('Please create a .env file with JWT_SECRET=your-secret-key');
  process.exit(1);
}

if (!process.env.MONGO_URI) {
  console.error('❌ ERROR: MONGO_URI is not set in environment variables');
  console.error('Please create a .env file with MONGO_URI=your-mongodb-connection-string');
  process.exit(1);
}

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    message: 'Server is running'
  });
});

app.get('/api/health', async (req, res) => {
  try {
    const dbStatus = mongoose.connection.readyState;
    const dbStates = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: {
        status: dbStates[dbStatus] || 'unknown',
        readyState: dbStatus
      },
      message: 'Server and database are operational'
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      message: 'Health check failed',
      error: error.message
    });
  }
});

app.get('/ping', (req, res) => {
  res.status(200).json({ pong: Date.now() });
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/groups', groupRoutes);

mongoose
  .connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB connected'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

const onlineUsers = new Map();

const emitOnlineStatus = async () => {
  const onlineIds = Array.from(onlineUsers.keys());
  const users = await User.find({ _id: { $in: onlineIds } }).select('username');
  io.emit(
    'online_status',
    users.map((u) => ({ userId: u._id, username: u.username }))
  );
};

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication error'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    return next();
  } catch (error) {
    return next(new Error('Authentication error'));
  }
});

io.on('connection', async (socket) => {
  const userId = socket.user.id;
  onlineUsers.set(userId, socket.id);
  socket.join(userId);
  await User.findByIdAndUpdate(userId, { onlineStatus: true });
  await emitOnlineStatus();

  const groups = await Group.find({ members: userId });
  groups.forEach((group) => socket.join(`group:${group._id}`));

  socket.on('join_group', (groupId) => {
    socket.join(`group:${groupId}`);
  });

  socket.on('typing', ({ recipientId, groupId }) => {
    if (groupId) {
      socket.to(`group:${groupId}`).emit('typing', { groupId, userId });
    } else if (recipientId) {
      socket.to(recipientId).emit('typing', { from: userId });
    }
  });

  socket.on('send_message', async ({ recipientId, groupId, messageText }) => {
    if (!messageText) return;
    try {
      let conversationId;
      let isGroup = false;
      let resolvedGroupId = null;

      if (groupId) {
        conversationId = `group:${groupId}`;
        isGroup = true;
        resolvedGroupId = groupId;
      } else if (recipientId) {
        conversationId = buildDirectConversationId(userId, recipientId);
      } else {
        return;
      }

      const message = await Message.create({
        conversationId,
        senderId: userId,
        messageText,
        isGroup,
        groupId: resolvedGroupId
      });
      await message.populate('senderId', 'username');

      const payload = {
        _id: message._id,
        conversationId,
        messageText,
        sender: {
          id: message.senderId._id,
          username: message.senderId.username
        },
        isGroup,
        groupId: resolvedGroupId,
        createdAt: message.createdAt
      };

      if (isGroup) {
        io.to(`group:${resolvedGroupId}`).emit('receive_message', payload);
      } else {
        io.to(recipientId).emit('receive_message', payload);
        socket.emit('receive_message', payload);
      }
    } catch (error) {
      console.error('Failed to send message', error);
    }
  });

  socket.on('react_message', async ({ messageId, emoji, groupId, recipientId }) => {
    if (!messageId || !emoji) return;
    try {
      const message = await Message.findById(messageId);
      if (!message) return;

      message.reactions = message.reactions.filter((reaction) => reaction.userId.toString() !== userId);
      message.reactions.push({ userId, emoji });
      await message.save();
      await message.populate('reactions.userId', 'username');

      const payload = {
        messageId,
        reactions: message.reactions.map((reaction) => ({
          userId: reaction.userId._id,
          username: reaction.userId.username,
          emoji: reaction.emoji
        }))
      };

      if (groupId) {
        io.to(`group:${groupId}`).emit('message_reaction', payload);
      } else if (recipientId) {
        io.to(recipientId).emit('message_reaction', payload);
        socket.emit('message_reaction', payload);
      } else {
        io.emit('message_reaction', payload);
      }
    } catch (error) {
      console.error('Failed to react to message', error);
    }
  });

  socket.on('disconnect', async () => {
    onlineUsers.delete(userId);
    await User.findByIdAndUpdate(userId, { onlineStatus: false, lastSeen: new Date() });
    await emitOnlineStatus();
  });
});

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
