const supabase = require('../../db/supabase')

// GET /api/research?type=&search=&sortBy=year&page=1&limit=12
const getPapers = async (req, res) => {
  try {
    const { type, search, sortBy = 'year', page = 1, limit = 20 } = req.query

    let query = supabase
      .from('research_papers')
      .select('*', { count: 'exact' })

    if (type && type !== 'All') query = query.eq('type', type)
    if (search) {
      query = query.or(`title.ilike.%${search}%,abstract.ilike.%${search}%`)
    }

    const colMap = { year: 'year', citations: 'citations', downloads: 'downloads' }
    const col = colMap[sortBy] || 'year'
    query = query.order(col, { ascending: false })

    const from = (Number(page) - 1) * Number(limit)
    query = query.range(from, from + Number(limit) - 1)

    const { data, error, count } = await query
    if (error) throw error
    res.json({ success: true, data, total: count })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET /api/research/types
const getTypes = async (req, res) => {
  try {
    const { data, error } = await supabase.from('research_papers').select('type')
    if (error) throw error
    const unique = ['All', ...new Set(data.map(r => r.type))]
    res.json({ success: true, data: unique })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET /api/research/stats — keys match ResearchPage.jsx's heroStats exactly
const getStats = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('research_papers')
      .select('type, open_access')
    if (error) throw error

    res.json({
      success: true,
      data: {
        total_papers: data.length,
        open_access: data.filter(r => r.open_access).length,
        study_types: new Set(data.map(r => r.type).filter(Boolean)).size,
      },
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

const getPaperById = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('research_papers').select('*').eq('id', req.params.id).single()
    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Paper not found' })

    const { data: newViews, error: rpcError } = await supabase
      .rpc('increment_research_views', { research_id: req.params.id })
    if (rpcError) console.error('Failed to increment research views:', rpcError.message)

    res.json({ success: true, data: { ...data, views: rpcError ? (data.views || 0) : newViews } })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// POST /api/research/:id/download — call this from the actual download/PDF link, not on card click
const trackDownload = async (req, res) => {
  try {
    const { data: newDownloads, error } = await supabase
      .rpc('increment_research_downloads', { research_id: req.params.id })
    if (error) throw error
    res.json({ success: true, downloads: newDownloads })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

const createPaper = async (req, res) => {
  try {
    const { data, error } = await supabase.from('research_papers').insert([req.body]).select().single()
    if (error) throw error
    res.status(201).json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

const updatePaper = async (req, res) => {
  try {
    const { data, error } = await supabase.from('research_papers').update(req.body).eq('id', req.params.id).select().single()
    if (error) throw error
    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

const deletePaper = async (req, res) => {
  try {
    const { error } = await supabase.from('research_papers').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true, message: 'Paper deleted' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

const proxyPdf = async (req, res) => {
  try {
    const { data: paper, error } = await supabase
      .from('research_papers').select('pdf_url, title').eq('id', req.params.id).single()
    if (error || !paper?.pdf_url) return res.status(404).json({ success: false, message: 'PDF not found' })

    const upstream = await fetch(paper.pdf_url)
    if (!upstream.ok) return res.status(502).json({ success: false, message: 'Could not fetch PDF from storage' })

    const filename = paper.pdf_url.split('/').pop() || `${paper.title ?? 'paper'}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
    res.setHeader('Cache-Control', 'public, max-age=3600')

    const { Readable } = require('stream')
    Readable.fromWeb(upstream.body).pipe(res)
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

module.exports = {
  getPapers, getTypes, getStats, getPaperById, trackDownload,
  proxyPdf, createPaper, updatePaper, deletePaper,
}