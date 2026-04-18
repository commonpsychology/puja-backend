// src/routes/psychRoutes.js
const express = require('express')
const router  = express.Router()
const psych   = require('./controllers/psychController')

// ORDER MATTERS — specific routes before param routes
router.get('/all',      psych.getAll)       // GET /api/psych/all
router.get('/videos',   psych.getVideos)    // GET /api/psych/videos
router.get('/analyses', psych.getAnalyses)  // GET /api/psych/analyses
router.get('/concepts', psych.getConcepts)  // GET /api/psych/concepts

// FIX: frontend fetches /api/psych/:slug (not /api/psych/analyses/:slug)
// PsychDetailPage does: fetch(`${API_BASE}/psych/${slug}`)
router.get('/:slug',    psych.getAnalysisBySlug)  // GET /api/psych/:slug

module.exports = router