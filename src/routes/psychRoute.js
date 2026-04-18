// src/routes/psychRoute.js
const express  = require('express')
// ── FIX: match the path your blog controller already uses ──────────────────
// blog_Controller uses  ../../db/supabase  (i.e.  src/db/supabase.js)
// psychRoute is also inside src/routes/ so the path is identical
const supabase = require('../db/supabase')

const router = express.Router()

// ── GET /api/psych/all ────────────────────────────────────────────────────
router.get('/all', async (req, res) => {
  try {
    const [videosRes, analysesRes, conceptsRes] = await Promise.all([
      supabase
        .from('psych_videos')
        .select('id, youtube_id, title, description, duration, views, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),

      supabase
        .from('psych_analyses')
        .select('id, category, icon, color_var, title, slug, excerpt, concepts, read_time, published_at')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),

      supabase
        .from('psych_concepts')
        .select('id, term, definition, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
    ])

    const errs = [videosRes, analysesRes, conceptsRes]
      .map(r => r.error)
      .filter(Boolean)

    if (errs.length) {
      console.error('[psych/all] Supabase errors:', errs)
      return res.status(500).json({
        success: false,
        message: 'Database error fetching psych content.',
        errors:  errs.map(e => e.message),
      })
    }

    return res.json({
      success:   true,
      videos:    videosRes.data,
      analyses:  analysesRes.data,
      concepts:  conceptsRes.data,
    })
  } catch (err) {
    console.error('[psych/all] Unexpected error:', err)
    return res.status(500).json({ success: false, message: 'Server error.' })
  }
})

// ── GET /api/psych/analyses/:slug ─────────────────────────────────────────
router.get('/:slug', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('psych_analyses')
      .select('*')
      .eq('slug', req.params.slug)
      .eq('is_active', true)
      .single()

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Analysis not found.' })
    }

    return res.json({ success: true, analysis: data })
  } catch (err) {
    console.error('[psych/analyses/:slug]', err)
    return res.status(500).json({ success: false, message: 'Server error.' })
  }
})

module.exports = router