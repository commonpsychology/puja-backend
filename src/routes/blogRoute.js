// src/routes/blogRoute.js
const express = require('express')
const router  = express.Router()
const ctrl    = require('./controllers/blog_Controller')

let protect, isAdmin
try {
  const auth = require('../middleware/auth')
  protect  = auth.protect
  isAdmin  = auth.isAdmin
} catch (e) {
  console.error('[blogRoute] Could not load auth middleware:', e.message)
  protect = isAdmin = (req, res, next) => res.status(503).json({ message: 'Auth unavailable' })
}

router.get('/',           ctrl.getPosts)
router.get('/categories', ctrl.getCategories)
router.get('/:slug',      ctrl.getPostBySlug)   // ← already increments views, this is your one source of truth

router.post('/',    protect, isAdmin, ctrl.createPost)
router.put('/:id',  protect, isAdmin, ctrl.updatePost)
router.delete('/:id', protect, isAdmin, ctrl.deletePost)

module.exports = router