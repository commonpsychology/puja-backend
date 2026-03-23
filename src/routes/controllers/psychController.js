// ============================================================
// src/controllers/psychController.js
// ============================================================
const { supabase } = require('../config/supabase')

// GET /api/psych/videos
async function getVideos(req, res) {
  try {
    const { data, error } = await supabase
      .from('psych_videos')
      .select('id, youtube_id, title, description, duration, views, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    if (error) throw error
    res.json({ videos: data || [] })
  } catch (err) {
    console.error('[psych/videos]', err.message)
    res.status(500).json({ error: 'Failed to fetch videos' })
  }
}

// GET /api/psych/analyses
async function getAnalyses(req, res) {
  try {
    const { data, error } = await supabase
      .from('psych_analyses')
      .select('id, category, icon, color_var, title, slug, excerpt, concepts, read_time, published_at')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    if (error) throw error
    res.json({ analyses: data || [] })
  } catch (err) {
    console.error('[psych/analyses]', err.message)
    res.status(500).json({ error: 'Failed to fetch analyses' })
  }
}

// GET /api/psych/analyses/:slug
async function getAnalysisBySlug(req, res) {
  const { slug } = req.params
  try {
    const { data, error } = await supabase
      .from('psych_analyses')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()
    if (error || !data) return res.status(404).json({ error: 'Article not found' })
    res.json({ analysis: data })
  } catch (err) {
    console.error('[psych/analyses/:slug]', err.message)
    res.status(500).json({ error: 'Failed to fetch article' })
  }
}

// GET /api/psych/concepts
async function getConcepts(req, res) {
  try {
    const { data, error } = await supabase
      .from('psych_concepts')
      .select('id, term, definition, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    if (error) throw error
    res.json({ concepts: data || [] })
  } catch (err) {
    console.error('[psych/concepts]', err.message)
    res.status(500).json({ error: 'Failed to fetch concepts' })
  }
}

// GET /api/psych/all  — single call fetches everything
async function getAll(req, res) {
  try {
    const [vR, aR, cR] = await Promise.all([
      supabase.from('psych_videos')
        .select('id, youtube_id, title, description, duration, views, sort_order')
        .eq('is_active', true).order('sort_order', { ascending: true }),
      supabase.from('psych_analyses')
        .select('id, category, icon, color_var, title, slug, excerpt, concepts, read_time, published_at')
        .eq('is_active', true).order('sort_order', { ascending: true }),
      supabase.from('psych_concepts')
        .select('id, term, definition, sort_order')
        .eq('is_active', true).order('sort_order', { ascending: true }),
    ])
    if (vR.error) throw vR.error
    if (aR.error) throw aR.error
    if (cR.error) throw cR.error
    res.json({ videos: vR.data || [], analyses: aR.data || [], concepts: cR.data || [] })
  } catch (err) {
    console.error('[psych/all]', err.message)
    res.status(500).json({ error: 'Failed to fetch psychological view data' })
  }
}

module.exports = { getVideos, getAnalyses, getAnalysisBySlug, getConcepts, getAll }


// ============================================================
// src/routes/psychRoutes.js  — paste into a new file
// ============================================================
/*
const express  = require('express')
const router   = express.Router()
const psych    = require('../controllers/psychController')

router.get('/all',            psych.getAll)
router.get('/videos',         psych.getVideos)
router.get('/analyses',       psych.getAnalyses)
router.get('/analyses/:slug', psych.getAnalysisBySlug)
router.get('/concepts',       psych.getConcepts)

module.exports = router
*/

// ============================================================
// In your main app.js / server.js add:
// ============================================================
/*
const psychRoutes = require('./routes/psychRoutes')
app.use('/api/psych', psychRoutes)
*/