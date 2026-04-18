// ============================================================
// src/controllers/psychController.js
// ============================================================
const { supabase } = require('../../db/supabase')

// GET /api/psych/videos
async function getVideos(req, res) {
  try {
    const { data, error } = await supabase
      .from('psych_videos')
      .select('id, youtube_id, title, description, duration, views, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    if (error) throw error
    res.json({ success: true, videos: data || [] })
  } catch (err) {
    console.error('[psych/videos]', err.message)
    res.status(500).json({ success: false, error: 'Failed to fetch videos' })
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
    res.json({ success: true, analyses: data || [] })
  } catch (err) {
    console.error('[psych/analyses]', err.message)
    res.status(500).json({ success: false, error: 'Failed to fetch analyses' })
  }
}

// GET /api/psych/:slug
// Frontend fetches /api/psych/:slug — no /analyses/ prefix
async function getAnalysisBySlug(req, res) {
  const { slug } = req.params
  try {
    const { data, error } = await supabase
      .from('psych_analyses')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()
    if (error || !data) return res.status(404).json({ success: false, error: 'Analysis not found' })
    res.json({ success: true, analysis: data })
  } catch (err) {
    console.error('[psych/:slug]', err.message)
    res.status(500).json({ success: false, error: 'Failed to fetch analysis' })
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
    res.json({ success: true, concepts: data || [] })
  } catch (err) {
    console.error('[psych/concepts]', err.message)
    res.status(500).json({ success: false, error: 'Failed to fetch concepts' })
  }
}

// GET /api/psych/all — single call fetches everything for PsychologicalViewPage
// FIX: added success:true — frontend checks json.success before using data
async function getAll(req, res) {
  try {
    const [vR, aR, cR] = await Promise.all([
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
    if (vR.error) throw vR.error
    if (aR.error) throw aR.error
    if (cR.error) throw cR.error
    res.json({
      success: true,          // ← FIX: was missing, caused frontend to always use fallback
      videos:   vR.data || [],
      analyses: aR.data || [],
      concepts: cR.data || [],
    })
  } catch (err) {
    console.error('[psych/all]', err.message)
    res.status(500).json({ success: false, error: 'Failed to fetch psychological view data' })
  }
}

module.exports = { getVideos, getAnalyses, getAnalysisBySlug, getConcepts, getAll }