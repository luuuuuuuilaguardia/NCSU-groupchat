const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
require('dotenv').config();

const createUsers = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const users = [];

  for (let i = 1; i <= 10; i++) {
    users.push({
      username: `friend${i}`,
      email: `friend${i}@example.com`,
      password: await bcrypt.hash(`Password${i}!`, 10)
    });
  }

  await User.deleteMany();
  await User.insertMany(users);
  console.log('10 demo users created!');
  process.exit();
};

createUsers().catch((err) => {
  console.error(err);
  process.exit(1);
});