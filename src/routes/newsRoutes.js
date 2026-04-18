// src/routes/newsRoutes.js
const express = require('express')
const router  = express.Router()
const news    = require('./controllers/newsController')

// ORDER MATTERS — specific routes before param routes
router.get('/meta',      news.getNewsMeta)    // GET  /api/news/meta
router.post('/subscribe', news.subscribe)     // POST /api/news/subscribe
router.get('/',          news.getNews)        // GET  /api/news
router.get('/:slug',     news.getNewsBySlug)  // GET  /api/news/:slug

module.exports = router