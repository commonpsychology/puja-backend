// src/routes/coursesRoute.js

const express  = require('express')
const router   = express.Router()
const supabase = require('../db/supabase')

// ── GET /api/courses ──────────────────────────────────────────────────────────
// Returns all published courses with their videos nested inside.
// Public — no auth required.
router.get('/', async (req, res, next) => {
  try {
    const { data: courses, error } = await supabase
      .from('courses')
      .select(`
        id, title, slug, description, emoji,
        level, duration_hours, lessons_count,
        is_free, price, price_label,
        color, tags, cover_image_url, thumbnail_url,
        created_at,
        course_videos (
          id, course_id, title, description,
          video_url, thumbnail_url, duration_secs,
          sort_order, is_free_preview
        )
      `)
      .eq('is_published', true)
      .order('created_at', { ascending: true })

    if (error) throw error

    // Sort nested videos by sort_order (Supabase doesn't order nested selects)
    const result = (courses || []).map(c => ({
      ...c,
      course_videos: (c.course_videos || []).sort((a, b) => a.sort_order - b.sort_order),
    }))

    res.json({ success: true, courses: result })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/courses/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { data: course, error } = await supabase
      .from('courses')
      .select(`
        *,
        course_videos (
          id, course_id, title, description,
          video_url, thumbnail_url, duration_secs,
          sort_order, is_free_preview
        )
      `)
      .eq('id', req.params.id)
      .eq('is_published', true)
      .single()

    if (error || !course) {
      return res.status(404).json({ success: false, message: 'Course not found.' })
    }

    course.course_videos = (course.course_videos || []).sort((a, b) => a.sort_order - b.sort_order)

    res.json({ success: true, course })
  } catch (err) {
    next(err)
  }
})

module.exports = router