// routes/playlistRoute.js
const express = require('express')
const router = express.Router()
const supabase = require('../db/supabase')
const { authenticate } = require('../middleware/auth')

// ── GET /api/playlists
router.get('/', authenticate, async (req, res) => {
  try {
    const { data: playlists, error } = await supabase
      .from('course_playlists')
      .select(`
        id, course_id, title, description, emoji, sort_order, is_published,
        access_pin,
        course_videos ( id, duration_secs )
      `)
      .eq('is_published', true)
      .order('sort_order', { ascending: true })

    if (error) throw error

    const { data: unlocks, error: unlockErr } = await supabase
      .from('user_playlist_unlocks')
      .select('playlist_id')
      .eq('user_id', req.user.sub)

    if (unlockErr) throw unlockErr

    const unlockedSet = new Set(unlocks.map(u => u.playlist_id))

    const result = playlists.map(pl => {
      const requires_pin = pl.access_pin !== null
      const videos = pl.course_videos || []
      return {
        id:                   pl.id,
        course_id:            pl.course_id,
        title:                pl.title,
        description:          pl.description,
        emoji:                pl.emoji,
        sort_order:           pl.sort_order,
        requires_pin,
        video_count:          videos.length,
        total_duration_secs:  videos.reduce((s, v) => s + (v.duration_secs || 0), 0),
        is_unlocked:          !requires_pin || unlockedSet.has(pl.id),
      }
    })

    res.json({ success: true, playlists: result })
  } catch (err) {
    console.error('GET /api/playlists error:', err)
    res.status(500).json({ success: false, error: 'Failed to load playlists' })
  }
})


// ── GET /api/playlists/:id/videos
router.get('/:id/videos', authenticate, async (req, res) => {
  const { id } = req.params

  try {
    const { data: playlist, error: plErr } = await supabase
      .from('course_playlists')
      .select('id, access_pin')
      .eq('id', id)
      .single()

    if (plErr || !playlist) return res.status(404).json({ success: false, error: 'Playlist not found' })

    if (playlist.access_pin !== null) {
      const { data: unlock } = await supabase
        .from('user_playlist_unlocks')
        .select('id')
        .eq('user_id', req.user.sub)
        .eq('playlist_id', id)
        .single()

      if (!unlock) {
        return res.status(403).json({ success: false, error: 'PIN required', requires_pin: true })
      }
    }

    const { data: videos, error: vidErr } = await supabase
      .from('course_videos')
      .select('id, title, description, video_url, thumbnail_url, duration_secs, sort_order')
      .eq('playlist_id', id)
      .order('sort_order', { ascending: true })

    if (vidErr) throw vidErr

    res.json({ success: true, videos })
  } catch (err) {
    console.error('GET /api/playlists/:id/videos error:', err)
    res.status(500).json({ success: false, error: 'Failed to load videos' })
  }
})


// ── POST /api/playlists/:id/unlock
router.post('/:id/unlock', authenticate, async (req, res) => {
  const { id } = req.params
  const { pin } = req.body

  if (!pin || typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ success: false, error: 'Invalid PIN format' })
  }

  try {
    // Verify PIN using pgcrypto via raw SQL (Supabase supports rpc)
    const { data, error } = await supabase.rpc('verify_playlist_pin', {
      p_playlist_id: id,
      p_pin: pin,
    })

    if (error) throw error
    if (!data) return res.status(401).json({ success: false, error: 'Incorrect PIN' })

    // Upsert unlock record
    const { error: insertErr } = await supabase
      .from('user_playlist_unlocks')
.upsert({ user_id: req.user.sub, playlist_id: id }, { onConflict: 'user_id,playlist_id' })

    if (insertErr) throw insertErr

    res.json({ success: true, message: 'Playlist unlocked' })
  } catch (err) {
    console.error('POST /api/playlists/:id/unlock error:', err)
    res.status(500).json({ success: false, error: 'Failed to verify PIN' })
  }
})

module.exports = router