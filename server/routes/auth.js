'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const config = require('../config');
const { getDb } = require('../db');
const { generateToken, authenticateToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ApiError, asyncHandler } = require('../errors');

const router = express.Router();

// Pre-computed hash used to equalize response timing when the username does
// not exist (prevents user enumeration via timing).
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-password', config.bcryptRounds);

const loginLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  max: config.rateLimit.loginMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many login attempts, please try again later',
      code: 'RATE_LIMITED',
      requestId: req.id,
    });
  },
});

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(1024),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(1024),
});

// POST /auth/login
router.post(
  '/login',
  loginLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { username, password } = req.valid.body;

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    const match = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !match) {
      throw ApiError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
    }

    const token = generateToken(user);
    req.log?.info({ username: user.username }, 'User logged in');
    res.json({ token, username: user.username, expiresIn: config.jwtExpiresIn });
  })
);

// GET /auth/me — validate token and return user info
router.get('/me', authenticateToken, (req, res) => {
  res.json({ username: req.user.username });
});

// POST /auth/change-password
router.post(
  '/change-password',
  authenticateToken,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.valid.body;

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      throw ApiError.unauthorized('Invalid or expired token', 'INVALID_TOKEN');
    }

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      throw ApiError.unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
    }

    const hash = await bcrypt.hash(newPassword, config.bcryptRounds);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);

    req.log?.info({ username: user.username }, 'User changed password');
    res.json({ message: 'Password updated' });
  })
);

module.exports = router;
