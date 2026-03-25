// src/routes/community.js
const express = require('express')
const { authenticate, optionalAuth } = require('../middleware/auth')
const {
  listGroups, getGroup, joinGroup, leaveGroup, checkMembership, myGroups,
  listSessions, reserveSession, cancelReservation, myReservations,
  listPosts, createPost, likePost, deletePost,
} = require('./controllers/communityController')

const router = express.Router()

// ── Groups ────────────────────────────────────────────────────
router.get('/groups',                      optionalAuth, listGroups)
router.get('/groups/:id',                  optionalAuth, getGroup)
router.get('/groups/:id/membership',       optionalAuth, checkMembership)
router.post('/groups/:id/join',            optionalAuth, joinGroup)
router.delete('/groups/:id/leave',         authenticate, leaveGroup)
router.get('/my-groups',                   authenticate, myGroups)

// ── Sessions ──────────────────────────────────────────────────
router.get('/sessions',                    optionalAuth, listSessions)
router.get('/my-reservations',             authenticate, myReservations)
router.post('/sessions/:id/reserve',       optionalAuth, reserveSession)
router.delete('/sessions/:id/cancel-reservation', authenticate, cancelReservation)

// ── Posts ─────────────────────────────────────────────────────
router.get('/posts',                       optionalAuth, listPosts)
router.post('/posts',                      optionalAuth, createPost)
router.post('/posts/:id/like',             optionalAuth, likePost)
router.delete('/posts/:id',                authenticate, deletePost)

module.exports = router