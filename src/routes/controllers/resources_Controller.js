// src/routes/controllers/resources_Controller.js
const path = require('path')
const fs   = require('fs')
const supabase = require('../../db/supabase')

// ── Helpers ────────────────────────────────────────────────────────────────

const PUBLIC_DIR = path.join(__dirname, '../../../public')

// Resolves a file_url like '/pdfs/foo.pdf' to an absolute disk path
function urlToDiskPath(fileUrl) {
  if (!fileUrl) return null
  const relative = fileUrl.replace(/^\//, '')
  return path.join(PUBLIC_DIR, relative)
}

const LEGAL_DOCS = [
  { id: 'privacy-policy',        doc: 'Privacy Policy',            icon: '📄', updated: 'Last updated Jan 2025', filename: 'privacy-policy.pdf' },
  { id: 'terms-of-service',      doc: 'Terms of Service',          icon: '📋', updated: 'Last updated Jan 2025', filename: 'terms-of-service.pdf' },
  { id: 'informed-consent',      doc: 'Informed Consent Form',     icon: '✍️',  updated: 'Last updated Mar 2025', filename: 'informed-consent.pdf' },
  { id: 'data-processing',       doc: 'Data Processing Agreement', icon: '🔒', updated: 'Last updated Jan 2025', filename: 'data-processing-agreement.pdf' },
  { id: 'therapist-code',        doc: 'Therapist Code of Conduct', icon: '⚖️',  updated: 'Last updated Feb 2025', filename: 'therapist-code-of-conduct.pdf' },
]

// ── Resource routes ────────────────────────────────────────────────────────

// GET /api/resources
const getResources = async (req, res) => {
  try {
    const { category, search } = req.query
    let query = supabase.from('resources').select('*').order('created_at', { ascending: false })
    if (category && category !== 'All') query = query.eq('category', category)
    if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`)
    const { data, error } = await query
    if (error) throw error
    res.json({ success: true, data: data || [] })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET /api/resources/categories
const getCategories = async (req, res) => {
  try {
    const { data, error } = await supabase.from('resources').select('category')
    if (error) throw error
    const unique = ['All', ...new Set(data.map(r => r.category).filter(Boolean))]
    res.json({ success: true, data: unique })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// POST /api/resources/:id/download
// Streams the actual file — fixes blank file bug
const recordDownload = async (req, res) => {
  try {
    const { data: resource, error: fetchErr } = await supabase
      .from('resources').select('*').eq('id', req.params.id).single()

    if (fetchErr) throw fetchErr
    if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' })
    if (!resource.free) return res.status(403).json({ success: false, message: 'Premium resource' })

    const diskPath = urlToDiskPath(resource.file_url)

    if (!diskPath || !fs.existsSync(diskPath)) {
      console.error(`[download] Missing file — db file_url: "${resource.file_url}" → resolved: "${diskPath}"`)
      return res.status(404).json({
        success: false,
        message: 'File not found on server',
        debug: { file_url: resource.file_url, resolved: diskPath }
      })
    }

    // Increment download count (fire-and-forget)
    supabase.from('resources')
      .update({ downloads: (resource.downloads || 0) + 1 })
      .eq('id', req.params.id)
      .then(() => {})

    const ext = path.extname(diskPath).toLowerCase()
    const contentType = ext === '.mp3' ? 'audio/mpeg'
      : ext === '.mp4' ? 'video/mp4'
      : 'application/pdf'

    const safeFilename = resource.title
      .replace(/[^a-z0-9\s-]/gi, '').trim()
      .replace(/\s+/g, '-').toLowerCase() + ext

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`)
    res.setHeader('Content-Length', fs.statSync(diskPath).size)

    fs.createReadStream(diskPath).pipe(res)

  } catch (err) {
    console.error('[download] Error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
}

// ── Legal doc routes ───────────────────────────────────────────────────────

const getLegalDocs = (req, res) => {
  const docs = LEGAL_DOCS.map(doc => ({
    ...doc,
    has_file: fs.existsSync(path.join(PUBLIC_DIR, 'pdfs', doc.filename))
  }))
  res.json({ success: true, data: docs })
}

const viewLegalDoc = (req, res) => {
  const doc = LEGAL_DOCS.find(d => d.id === req.params.id)
  if (!doc) return res.status(404).json({ success: false, message: 'Document not found' })
  const diskPath = path.join(PUBLIC_DIR, 'pdfs', doc.filename)
  if (!fs.existsSync(diskPath)) return res.status(404).json({ success: false, message: 'PDF not on server yet' })
  res.json({ success: true, file_url: `/pdfs/${doc.filename}` })
}

const downloadLegalDoc = (req, res) => {
  const doc = LEGAL_DOCS.find(d => d.id === req.params.id)
  if (!doc) return res.status(404).json({ success: false, message: 'Document not found' })
  const diskPath = path.join(PUBLIC_DIR, 'pdfs', doc.filename)
  if (!fs.existsSync(diskPath)) return res.status(404).json({ success: false, message: 'PDF not on server yet' })
  res.setHeader('Content-Disposition', `attachment; filename="${doc.filename}"`)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', fs.statSync(diskPath).size)
  fs.createReadStream(diskPath).pipe(res)
}

// ── Admin ──────────────────────────────────────────────────────────────────

const createResource = async (req, res) => {
  try {
    const { data, error } = await supabase.from('resources').insert([req.body]).select().single()
    if (error) throw error
    res.status(201).json({ success: true, data })
  } catch (err) { res.status(500).json({ success: false, message: err.message }) }
}

const updateResource = async (req, res) => {
  try {
    const { data, error } = await supabase.from('resources').update(req.body).eq('id', req.params.id).select().single()
    if (error) throw error
    res.json({ success: true, data })
  } catch (err) { res.status(500).json({ success: false, message: err.message }) }
}

const deleteResource = async (req, res) => {
  try {
    const { error } = await supabase.from('resources').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true, message: 'Resource deleted' })
  } catch (err) { res.status(500).json({ success: false, message: err.message }) }
}

module.exports = {
  getResources, getCategories, recordDownload,
  getLegalDocs, viewLegalDoc, downloadLegalDoc,
  createResource, updateResource, deleteResource,
}