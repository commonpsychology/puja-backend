/* eslint-disable no-undef */
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET /api/therapists
const listTherapists = async (req, res) => {
  const { page = 1, limit = 12, specialization, language } = req.query
  const offset = (page - 1) * limit

  let query = supabase
    .from('therapists')
    .select(`
  id, license_type, specializations, experience_years, consultation_fee,
  session_duration, is_available, rating, total_reviews, languages_spoken,
  avatar_url, available_hours,
  profiles:user_id ( full_name, display_name, avatar_url, bio, city, country )
`, { count: 'exact' })
    .eq('is_available', true)
    .eq('is_verified', true)
    .range(offset, offset + limit - 1)

  if (specialization) query = query.contains('specializations', [specialization])
  if (language)       query = query.contains('languages_spoken', [language])

  const { data, error, count } = await query

  if (error) {
    return res.status(500).json({ success: false, message: 'Could not fetch therapists.' })
  }

  return res.status(200).json({
    success: true,
    therapists: data,
    pagination: { page: Number(page), limit: Number(limit), total: count },
  })
}

// GET /api/therapists/search?q=...
const searchTherapists = async (req, res) => {
  const { q } = req.query

  if (!q || q.trim().length < 2) {
    return res.status(400).json({ success: false, message: 'Search query must be at least 2 characters.' })
  }

  const { data, error } = await supabase
    .from('therapists')
    .select(`
      id, specializations, experience_years, consultation_fee, rating,
      available_hours,
      profiles:user_id ( full_name, display_name, avatar_url, city )
    `)
    .eq('is_verified', true)
    .or(`specializations.cs.{${q}}`)
    .limit(20)

  if (error) {
    return res.status(500).json({ success: false, message: 'Search failed.' })
  }

  return res.status(200).json({ success: true, therapists: data })
}

// GET /api/therapists/:id
const getTherapist = async (req, res) => {
  const { id } = req.params

  const { data, error } = await supabase
    .from('therapists')
    .select(`
      *,
      profiles:user_id ( full_name, display_name, avatar_url, bio, city, country, language )
    `)
    .eq('id', id)
    .maybeSingle()

  if (error || !data) {
    return res.status(404).json({ success: false, message: 'Therapist not found.' })
  }

  return res.status(200).json({ success: true, therapist: data })
}

// GET /api/therapists/:id/availability
const getTherapistAvailability = async (req, res) => {
  const { id } = req.params

  const { data, error } = await supabase
    .from('therapist_availability')
    .select('*')
    .eq('therapist_id', id)
    .eq('is_active', true)
    .order('day_of_week')

  if (error) {
    return res.status(500).json({ success: false, message: 'Could not fetch availability.' })
  }

  return res.status(200).json({ success: true, availability: data })
}

// GET /api/therapists/:id/reviews?page=1&limit=10
const listTherapistReviews = async (req, res) => {
  const { id } = req.params
  const { page = 1, limit = 10 } = req.query
  const pageNum  = Math.max(1, Number(page))
  const pageSize = Math.min(50, Math.max(1, Number(limit))) // hard cap so no one requests 100k rows
  const from = (pageNum - 1) * pageSize
  const to   = from + pageSize - 1

  const { data, error, count } = await supabase
    .from('therapist_reviews')
    .select(`
      id, rating, review_text, created_at,
      profiles:user_id ( full_name, display_name, avatar_url )
    `, { count: 'exact' })
    .eq('therapist_id', id)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    return res.status(500).json({ success: false, message: 'Could not fetch reviews.' })
  }

  return res.status(200).json({
    success: true,
    reviews: data,
    pagination: {
      page: pageNum,
      limit: pageSize,
      total: count,
      totalPages: Math.max(1, Math.ceil((count || 0) / pageSize)),
    },
  })
}

// POST /api/therapists/:id/reviews   (auth required)
const createTherapistReview = async (req, res) => {
  const { id } = req.params
  const userId = req.user?.sub || req.user?.id
  const { rating, review_text } = req.body

  const numRating = Number(rating)
  if (!numRating || numRating < 1 || numRating > 5) {
    return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' })
  }
  if (review_text && review_text.length > 2000) {
    return res.status(400).json({ success: false, message: 'Review text is too long.' })
  }

  // Confirm therapist exists
  const { data: therapist, error: tErr } = await supabase
    .from('therapists')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  if (tErr || !therapist) {
    return res.status(404).json({ success: false, message: 'Therapist not found.' })
  }

  // Upsert so a user can edit their existing review instead of erroring on the unique index
  const { data, error } = await supabase
    .from('therapist_reviews')
    .upsert(
      { therapist_id: id, user_id: userId, rating: numRating, review_text: review_text || null },
      { onConflict: 'therapist_id,user_id' }
    )
    .select(`
      id, rating, review_text, created_at,
      profiles:user_id ( full_name, display_name, avatar_url )
    `)
    .single()

  if (error) {
    return res.status(500).json({ success: false, message: 'Could not save review.' })
  }

  return res.status(201).json({ success: true, review: data })
}

module.exports = {
  listTherapists,
  getTherapist,
  getTherapistAvailability,
  searchTherapists,
  listTherapistReviews,
  createTherapistReview,
}

