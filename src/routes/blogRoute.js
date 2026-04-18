// src/routes/blogRoute.js
const express = require('express')
const router  = express.Router()
const ctrl    = require('./controllers/blog_Controller')

// ── guard against broken middleware import crashing the whole route ──────
let protect, isAdmin
try {
  const auth = require('../middleware/auth')
  protect  = auth.protect
  isAdmin  = auth.isAdmin
} catch (e) {
  console.error('[blogRoute] Could not load auth middleware:', e.message)
  // fallback no-ops so the file at least loads — real requests will 500
  protect = isAdmin = (req, res, next) => res.status(503).json({ message: 'Auth unavailable' })
}

// ── Public ────────────────────────────────────────────────────
router.get('/',           ctrl.getPosts)
router.get('/categories', ctrl.getCategories)   // MUST stay before /:slug
router.get('/:slug',      ctrl.getPostBySlug)

// ── Admin ─────────────────────────────────────────────────────
router.post('/',    protect, isAdmin, ctrl.createPost)
router.put('/:id',  protect, isAdmin, ctrl.updatePost)
router.delete('/:id', protect, isAdmin, ctrl.deletePost)

// POST /api/blog/:slug/view
router.post('/:slug/view', async (req, res) => {
  try {
    const { slug } = req.params
    const { error } = await supabase.rpc('increment_post_views', { post_slug: slug })
    if (error) throw error
    res.json({ ok: true })
  } catch (e) {
    // Silent fail — don't break anything if this fails
    res.json({ ok: false })
  }
})
module.exports = router