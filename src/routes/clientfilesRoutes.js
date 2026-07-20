// server/routes/clientFiles.routes.js
//
// Mount this in your main app with:
//   const clientFilesRouter = require('./routes/clientFiles.routes')
//   app.use('/api/therapist-portal', clientFilesRouter)
//
// ⚠️ Adjust the two lines below to match your actual auth middleware and
// where your Supabase admin client already lives — this file assumes the
// same conventions used by your existing /therapist-portal/appointments
// routes (JWT in Authorization header → req.user.role / req.user.id).

const express = require('express')
const multer  = require('multer')            // npm install multer
const { createClient } = require('@supabase/supabase-js')

const router = express.Router()

// ── Auth middleware — replace with your project's real import ──────
const { authenticate, requireRole } = require('../middleware/auth')

// ── Supabase admin client (service role — server-side only) ────────
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const BUCKET = 'client-files'
const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
})

function categoryFromMime(mime) {
  if (!mime) return 'other'
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (
    mime === 'application/msword' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'text/plain'
  ) return 'document'
  return 'other'
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150)
}

// ════════════════════════════════════════════════════════════════
// GET /clients/:clientId/files — list a client's files
// ════════════════════════════════════════════════════════════════
router.get(
  '/clients/:clientId/files',
  authenticate,
  requireRole(['therapist', 'admin', 'staff']),
  async (req, res) => {
    const { clientId } = req.params
    try {
      const { data, error } = await supabaseAdmin
        .from('client_files')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })

      if (error) throw error
      res.json({ files: data })
    } catch (err) {
      console.error('list client files error:', err)
      res.status(500).json({ message: 'Failed to load files.' })
    }
  }
)

// ════════════════════════════════════════════════════════════════
// POST /clients/:clientId/files — upload a file (multipart/form-data, field "file")
// ════════════════════════════════════════════════════════════════
router.post(
  '/clients/:clientId/files',
  authenticate,
  requireRole(['therapist', 'admin', 'staff']),
  upload.single('file'),
  async (req, res) => {
    const { clientId } = req.params
    const file = req.file
    if (!file) return res.status(400).json({ message: 'No file provided.' })

    try {
      const safeName    = sanitizeFileName(file.originalname)
      const storagePath = `${clientId}/${Date.now()}-${safeName}`

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        })
      if (uploadError) throw uploadError

      const { data: row, error: dbError } = await supabaseAdmin
        .from('client_files')
        .insert({
          client_id:    clientId,
          therapist_id: req.user?.therapistId || null,
          uploaded_by:  req.user?.id || null,
          file_name:    file.originalname,
          storage_path: storagePath,
          mime_type:    file.mimetype,
          file_size:    file.size,
          category:     categoryFromMime(file.mimetype),
        })
        .select()
        .single()

      if (dbError) {
        // Roll back the uploaded object so storage doesn't accumulate orphans.
        await supabaseAdmin.storage.from(BUCKET).remove([storagePath])
        throw dbError
      }

      res.status(201).json({ file: row })
    } catch (err) {
      console.error('upload client file error:', err)
      res.status(500).json({ message: 'Failed to upload file.' })
    }
  }
)

// ════════════════════════════════════════════════════════════════
// GET /files/:fileId/url — short-lived signed URL for viewing or downloading
// Pass ?download=1 to force a Content-Disposition: attachment response.
// ════════════════════════════════════════════════════════════════
router.get(
  '/files/:fileId/url',
  authenticate,
  requireRole(['therapist', 'admin', 'staff']),
  async (req, res) => {
    const { fileId } = req.params
    try {
      const { data: fileRow, error: fetchError } = await supabaseAdmin
        .from('client_files')
        .select('storage_path, file_name, mime_type')
        .eq('id', fileId)
        .single()
      if (fetchError || !fileRow) return res.status(404).json({ message: 'File not found.' })

      const wantsDownload = req.query.download === '1'
      const { data, error } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(
          fileRow.storage_path,
          60 * 5, // 5 minutes
          wantsDownload ? { download: fileRow.file_name } : undefined
        )
      if (error) throw error

      res.json({ url: data.signedUrl, fileName: fileRow.file_name, mimeType: fileRow.mime_type })
    } catch (err) {
      console.error('signed url error:', err)
      res.status(500).json({ message: 'Failed to generate file URL.' })
    }
  }
)

// ════════════════════════════════════════════════════════════════
// DELETE /files/:fileId — remove a file (therapist/admin only)
// ════════════════════════════════════════════════════════════════
router.delete(
  '/files/:fileId',
  authenticate,
  requireRole(['therapist', 'admin']),
  async (req, res) => {
    const { fileId } = req.params
    try {
      const { data: fileRow, error: fetchError } = await supabaseAdmin
        .from('client_files')
        .select('storage_path')
        .eq('id', fileId)
        .single()
      if (fetchError || !fileRow) return res.status(404).json({ message: 'File not found.' })

      await supabaseAdmin.storage.from(BUCKET).remove([fileRow.storage_path])

      const { error: delError } = await supabaseAdmin
        .from('client_files')
        .delete()
        .eq('id', fileId)
      if (delError) throw delError

      res.json({ success: true })
    } catch (err) {
      console.error('delete client file error:', err)
      res.status(500).json({ message: 'Failed to delete file.' })
    }
  }
)

module.exports = router