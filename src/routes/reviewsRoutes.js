// backend/routes/reviews.js
// Full reviews API — upload, fetch, approve, delete
// Uses Supabase Storage for video files + Supabase DB for metadata

const express = require('express')
const multer  = require('multer')
const { createClient } = require('@supabase/supabase-js')
const { authenticate: authenticateToken, requireRole } = require('../middleware/auth')
const ffprobe = require('ffprobe-static')
const { execFile } = require('child_process')
const path = require('path')
const fs = require('fs')

const router = express.Router()

// ── Supabase client ─────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // service role bypasses RLS for server ops
)



// ── Multer (in-memory, max 100MB) ───────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('video/')) {
      return cb(new Error('Only video files are allowed'))
    }
    cb(null, true)
  },
})

// ── Helpers ─────────────────────────────────────────────────

/**
 * Get video duration using ffprobe (optional — gracefully skips if not available)
 * Returns "M:SS" string or null
 */
function getVideoDuration(buffer) {
  return new Promise((resolve) => {
    try {
      const tmpPath = path.join('/tmp', `review_${Date.now()}.mp4`)
      fs.writeFileSync(tmpPath, buffer)
      execFile(
        ffprobe.path,
        ['-v', 'quiet', '-print_format', 'json', '-show_format', tmpPath],
        (err, stdout) => {
          fs.unlinkSync(tmpPath)
          if (err) return resolve(null)
          try {
            const meta = JSON.parse(stdout)
            const secs = Math.round(parseFloat(meta?.format?.duration || 0))
            const m = Math.floor(secs / 60)
            const s = String(secs % 60).padStart(2, '0')
            resolve(`${m}:${s}`)
          } catch { resolve(null) }
        }
      )
    } catch { resolve(null) }
  })
}

/**
 * Upload buffer to Supabase Storage
 * Returns public URL or throws
 */
async function uploadToStorage(bucket, filePath, buffer, contentType) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, buffer, {
      contentType,
      upsert: false,
      cacheControl: '3600',
    })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath)
  return data.publicUrl
}

// ═══════════════════════════════════════════════════════════
//  POST /api/reviews/upload
//  Authenticated — any logged-in user
// ═══════════════════════════════════════════════════════════
router.post(
  '/upload',
  authenticateToken,
  upload.single('video'),
  async (req, res) => {
    try {
      const { name, city, topic, quote, stars } = req.body
      const userId = req.user?.id

      if (!req.file) return res.status(400).json({ error: 'No video file provided' })
      if (!name || !city || !topic) return res.status(400).json({ error: 'name, city, and topic are required' })

      const starsNum = Math.min(5, Math.max(1, parseInt(stars) || 5))
      const timestamp = Date.now()
      const ext = req.file.originalname.split('.').pop() || 'mp4'
      const filePath = `reviews/${userId || 'anon'}/${timestamp}.${ext}`

      // 1. Upload video to Supabase Storage
      const videoUrl = await uploadToStorage(
        'review-videos',
        filePath,
        req.file.buffer,
        req.file.mimetype
      )

      // 2. Get duration (best-effort)
      const duration = await getVideoDuration(req.file.buffer)

      // 3. Insert metadata into DB
      const { data: review, error: dbErr } = await supabase
        .from('video_reviews')
        .insert({
          user_id: userId || null,
          name: name.trim(),
          city: city.trim(),
          topic: topic.trim(),
          quote: quote?.trim() || null,
          stars: starsNum,
          video_url: videoUrl,
          video_path: filePath,
          duration: duration || null,
          is_approved: false,   // requires admin approval
          is_featured: false,
        })
        .select()
        .single()

      if (dbErr) throw new Error(`DB insert failed: ${dbErr.message}`)

      res.status(201).json({ success: true, review })
    } catch (err) {
      console.error('[reviews/upload]', err)
      res.status(500).json({ error: err.message || 'Upload failed' })
    }
  }
)

// ═══════════════════════════════════════════════════════════
//  GET /api/reviews
//  Public — returns approved reviews
//  Query params: approved, topic, limit, offset, featured
// ═══════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const {
      approved = 'true',
      topic,
      limit = 12,
      offset = 0,
      featured,
    } = req.query

    let query = supabase
      .from('video_reviews')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (approved === 'true') query = query.eq('is_approved', true)
    if (topic && topic !== 'All') query = query.eq('topic', topic)
    if (featured === 'true') query = query.eq('is_featured', true)

    const { data: reviews, error, count } = await query
    if (error) throw error

    // Compute stats (avg stars, total)
    const { data: statsData } = await supabase
      .from('video_reviews')
      .select('stars')
      .eq('is_approved', true)

    const avgStars = statsData?.length
      ? (statsData.reduce((s, r) => s + (r.stars || 5), 0) / statsData.length).toFixed(1)
      : '5.0'

    res.json({
      reviews: reviews || [],
      total: count || 0,
      stats: { total: count || 0, avgStars },
    })
  } catch (err) {
    console.error('[reviews GET]', err)
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════
//  GET /api/reviews/pending
//  Admin only — returns unapproved reviews
// ═══════════════════════════════════════════════════════════
router.get(
  '/pending',
  authenticateToken,
  requireRole(['admin', 'staff']),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('video_reviews')
        .select('*')
        .eq('is_approved', false)
        .order('created_at', { ascending: false })

      if (error) throw error
      res.json({ reviews: data || [] })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// ═══════════════════════════════════════════════════════════
//  PATCH /api/reviews/:id/approve
//  Admin only
// ═══════════════════════════════════════════════════════════
router.patch(
  '/:id/approve',
  authenticateToken,
  requireRole(['admin', 'staff']),
  async (req, res) => {
    try {
      const { id } = req.params
      const { is_featured } = req.body

      const update = { is_approved: true }
      if (is_featured !== undefined) update.is_featured = Boolean(is_featured)

      const { data, error } = await supabase
        .from('video_reviews')
        .update(update)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      res.json({ review: data })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// ═══════════════════════════════════════════════════════════
//  PATCH /api/reviews/:id/reject
//  Admin only — marks rejected (keeps for audit)
// ═══════════════════════════════════════════════════════════
router.patch(
  '/:id/reject',
  authenticateToken,
  requireRole(['admin', 'staff']),
  async (req, res) => {
    try {
      const { id } = req.params
      const { data, error } = await supabase
        .from('video_reviews')
        .update({ is_approved: false, is_rejected: true })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      res.json({ review: data })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

// ═══════════════════════════════════════════════════════════
//  DELETE /api/reviews/:id
//  Admin only — deletes video from storage + DB row
// ═══════════════════════════════════════════════════════════
router.delete(
  '/:id',
  authenticateToken,
  requireRole(['admin', 'staff']),
  async (req, res) => {
    try {
      const { id } = req.params

      // Fetch the review to get the storage path
      const { data: review, error: fetchErr } = await supabase
        .from('video_reviews')
        .select('video_path')
        .eq('id', id)
        .single()

      if (fetchErr) throw fetchErr

      // Delete from Supabase Storage
      if (review?.video_path) {
        await supabase.storage.from('review-videos').remove([review.video_path])
      }

      // Delete DB row
      const { error: delErr } = await supabase
        .from('video_reviews')
        .delete()
        .eq('id', id)

      if (delErr) throw delErr
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  }
)

module.exports = router