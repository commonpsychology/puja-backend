// src/routes/controllers/research_Controller.js
const supabase = require('../../db/supabase')

// GET /api/research?type=&search=&sortBy=year
const getPapers = async (req, res) => {
  try {
    const { type, search, sortBy = 'year' } = req.query

    let query = supabase
      .from('research_papers')
      .select('*')

    if (type && type !== 'All') query = query.eq('type', type)
    if (search) {
      query = query.or(`title.ilike.%${search}%,abstract.ilike.%${search}%`)
    }

    const colMap = { year: 'year', citations: 'citations', downloads: 'downloads' }
    const col = colMap[sortBy] || 'year'
    query = query.order(col, { ascending: false })

    const { data, error } = await query
    if (error) throw error
    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET /api/research/types   ← must be registered BEFORE /:id in the router
const getTypes = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('research_papers')
      .select('type')
    if (error) throw error
    const unique = ['All', ...new Set(data.map(r => r.type))]
    res.json({ success: true, data: unique })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET /api/research/stats   ← must be registered BEFORE /:id in the router
const getStats = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('research_papers')
      .select('citations, downloads, views')
    if (error) throw error

    const totalCitations = data.reduce((s, r) => s + (r.citations || 0), 0)
    const totalDownloads = data.reduce((s, r) => s + (r.downloads || 0), 0)
    const totalViews     = data.reduce((s, r) => s + (r.views || 0), 0)

    res.json({
      success: true,
      data: {
        publications: data.length,
        citations: totalCitations,
        downloads: totalDownloads,
        views: totalViews,
      },
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET /api/research/:id
const getPaperById = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('research_papers')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Paper not found' })

    // Atomic view increment — separate column from downloads, no more double-counting
    const { data: newViews, error: rpcError } = await supabase
      .rpc('increment_research_views', { research_id: req.params.id })

    if (rpcError) console.error('Failed to increment research views:', rpcError.message)

    res.json({
      success: true,
      data: { ...data, views: rpcError ? (data.views || 0) : newViews },
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// POST /api/research  (admin)
const createPaper = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('research_papers')
      .insert([req.body])
      .select()
      .single()
    if (error) throw error
    res.status(201).json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// PUT /api/research/:id  (admin)
const updatePaper = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('research_papers')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// DELETE /api/research/:id  (admin)
const deletePaper = async (req, res) => {
  try {
    const { error } = await supabase
      .from('research_papers')
      .delete()
      .eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true, message: 'Paper deleted' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET /api/research/:id/pdf  ← streams PDF through your backend, fixing CORS + CSP
const proxyPdf = async (req, res) => {
  try {
    const { data: paper, error } = await supabase
      .from('research_papers')
      .select('pdf_url, title')
      .eq('id', req.params.id)
      .single()

    if (error || !paper?.pdf_url) {
      return res.status(404).json({ success: false, message: 'PDF not found' })
    }

    const upstream = await fetch(paper.pdf_url)
    if (!upstream.ok) {
      return res.status(502).json({ success: false, message: 'Could not fetch PDF from storage' })
    }

    const filename = paper.pdf_url.split('/').pop() || `${paper.title ?? 'paper'}.pdf`

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
    res.setHeader('Cache-Control', 'public, max-age=3600')

    // Stream directly — no buffering the whole file in memory
    const { Readable } = require('stream')
    Readable.fromWeb(upstream.body).pipe(res)
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}


module.exports = {
  getPapers,
  getTypes,
  getStats,
  getPaperById,
  proxyPdf,
  createPaper,
  updatePaper,
  deletePaper,
}