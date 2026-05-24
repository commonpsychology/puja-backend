// src/routes/admin.js — COMPLETE FIXED VERSION
// Changes from previous version:
//   1. Removed adminGetMemberships import from adminController (it doesn't exist there)
//   2. Added adminListMemberships, adminUpdateMembership, adminDeleteMembership
//      imported from communityController
//   3. Added PUT + DELETE routes for /group-memberships/:id
//   4. Added PUT route for /group-reservations/:id (needed by frontend confirm/reject)
//   5. adminGetSessions / adminCreateSessionFull / adminUpdateSession / adminDeleteSession
//      kept as-is (they live in adminController)

const express = require('express')
const { authenticate } = require('../middleware/auth')

const {
  getDashboard,
  registerStaff,

  getUsers, toggleUserActive, setUserStatus, setUserRole,

  getAllAppointments, setAppointmentStatus,
  getTherapists, createTherapist, updateTherapist, deleteTherapist,

  getAllOrders, setOrderStatus, adminUpdateSession,

  getSocialWorkPrograms, createSocialWorkProgram, updateSocialWorkProgram, deleteSocialWorkProgram,


  getPayments, updatePaymentStatus, adminDeleteSession,

  sendNotificationToClient, adminGetReservations,

  getProducts,  createProduct,  updateProduct,  deleteProduct,
  getPosts,     createPost,     updatePost,     deletePost,
  getNews,      createNews,     updateNews,     deleteNews,
  getResources, createResource, updateResource, deleteResource,
  getGallery,   createGalleryItem, updateGalleryItem, deleteGalleryItem, adminCreateSessionFull,
  getResearch,  createResearch, updateResearch, deleteResearch, adminGetSessions,

  getPsychVideos,   createPsychVideo,   updatePsychVideo,   deletePsychVideo,
  getPsychAnalyses, createPsychAnalysis, updatePsychAnalysis, deletePsychAnalysis,

  getCourses,     createCourse,     updateCourse,     deleteCourse,
  getAssessments, createAssessment, updateAssessment, deleteAssessment,

  getCommunityGroups, createCommunityGroup, updateCommunityGroup, deleteCommunityGroup,

  // ✅ REMOVED: adminGetMemberships — it never existed in adminController
  getFaqs,    createFaq,    updateFaq,    deleteFaq,
  getCoupons, createCoupon, updateCoupon, deleteCoupon,

  getContacts,   updateContact,      deleteContact,
  getPsychConcepts, createPsychConcept, updatePsychConcept, deletePsychConcept,
  getSubscriptions, updateSubscription,
  getSettings,   updateSetting,
} = require('./controllers/adminController')

const {
  adminListGroups, adminCreateGroup, adminToggleGroup,
  adminListSessions, adminCreateSession,
  adminListPosts, adminModeratePost, adminDeletePost,
  adminListReservations,
  // ✅ NEW: membership handlers now imported from communityController
  adminListMemberships,
  adminUpdateMembership,
  adminDeleteMembership,
} = require('./controllers/communityController')

const {
  upload,
  submitVolunteer,
  getVolunteerApplications,
  getVolunteerApplication,
  updateVolunteerApplication,
  deleteVolunteerApplication,
  submitGalleryPhoto,
  getGallerySubmissions,
  updateGallerySubmission,
  deleteGallerySubmission,
  downloadGallerySubmission,
} = require('./controllers/volunteerGalleryController')

const {
  getAllPaymentsAdmin,
  approvePayment,
  rejectPayment,
  confirmCOD,
  flagCOD,
} = require('./controllers/paymentConfirmationController')

const {
  adminListBookings,
  adminGetBooking,
  adminUpdateBookingStatus,
  adminListRooms,
  adminCreateRoom,
  adminUpdateRoom,
  adminDeleteRoom,
} = require('./controllers/roomBookingController')

const supabase = require('../db/supabase')

const router = express.Router()

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated.' })
  if (!['admin', 'staff'].includes(req.user.role))
    return res.status(403).json({ success: false, message: 'Admin or staff access required.' })
  next()
}

const guard = [authenticate, requireAdmin]

// ─── Dashboard ───────────────────────────────────────────────
router.get('/dashboard', guard, getDashboard)

// ─── Staff registration ──────────────────────────────────────
router.post('/register-staff', guard, registerStaff)

// ─── Users ───────────────────────────────────────────────────
router.get   ('/users',                   guard, getUsers)
router.patch ('/users/:id/toggle-active', guard, toggleUserActive)
router.patch ('/users/:id/status',        guard, setUserStatus)
router.patch ('/users/:id/role',          guard, setUserRole)

// ─── Appointments ────────────────────────────────────────────
router.get   ('/appointments',            guard, getAllAppointments)
router.patch ('/appointments/:id/status', guard, setAppointmentStatus)
router.put   ('/appointments/:id',        guard, setAppointmentStatus)

// ─── Orders ──────────────────────────────────────────────────
router.get   ('/orders',            guard, getAllOrders)
router.patch ('/orders/:id/status', guard, setOrderStatus)
router.put   ('/orders/:id',        guard, setOrderStatus)

// ─── Payments ────────────────────────────────────────────────
router.get  ('/payments/all',             guard, getAllPaymentsAdmin)  // ← MOVED UP
router.get  ('/payments',                 guard, getPayments)
router.put  ('/payments/:id',             guard, updatePaymentStatus)
router.patch('/payments/:id',             guard, updatePaymentStatus)
router.post ('/payments/:id/approve',     guard, approvePayment)
router.post ('/payments/:id/reject',      guard, rejectPayment)
router.post ('/payments/:id/cod-confirm', guard, confirmCOD)
router.post ('/payments/:id/cod-flag',    guard, flagCOD)
// ─── Volunteer Applications ──────────────────────────────────
router.get   ('/volunteers',     guard, getVolunteerApplications)
router.get   ('/volunteers/:id', guard, getVolunteerApplication)
router.put   ('/volunteers/:id', guard, updateVolunteerApplication)
router.delete('/volunteers/:id', guard, deleteVolunteerApplication)

// ─── Gallery Submissions ─────────────────────────────────────
router.get   ('/gallery-submissions',              guard, getGallerySubmissions)
router.put   ('/gallery-submissions/:id',          guard, updateGallerySubmission)
router.delete('/gallery-submissions/:id',          guard, deleteGallerySubmission)
router.get   ('/gallery-submissions/:id/download', guard, downloadGallerySubmission)
router.post  ('/gallery/submit', upload.single('photo'), submitGalleryPhoto)

// ─── Room Bookings ───────────────────────────────────────────
router.get   ('/room-bookings',            guard, adminListBookings)
router.get   ('/room-bookings/:id',        guard, adminGetBooking)
router.put   ('/room-bookings/:id',        guard, adminUpdateBookingStatus)
router.patch ('/room-bookings/:id/status', guard, adminUpdateBookingStatus)
router.delete('/room-bookings/:id',        guard, async (req, res, next) => {
  try {
    const { error } = await supabase.from('room_bookings').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true, message: 'Booking deleted.' })
  } catch (err) { next(err) }
})

// ─── Rooms CRUD ──────────────────────────────────────────────
router.get   ('/rooms',      guard, adminListRooms)
router.post  ('/rooms',      guard, adminCreateRoom)
router.put   ('/rooms/:id',  guard, adminUpdateRoom)
router.patch ('/rooms/:id',  guard, adminUpdateRoom)
router.delete('/rooms/:id',  guard, adminDeleteRoom)

// ─── Therapists ──────────────────────────────────────────────
router.get   ('/therapists',     guard, getTherapists)
router.post  ('/therapists',     guard, createTherapist)
router.put   ('/therapists/:id', guard, updateTherapist)
router.delete('/therapists/:id', guard, deleteTherapist)

// ─── Notifications ───────────────────────────────────────────
router.post('/notifications', guard, sendNotificationToClient)

// ─── Psych Concepts ──────────────────────────────────────────
router.get   ('/psych-concepts',     guard, getPsychConcepts)
router.post  ('/psych-concepts',     guard, createPsychConcept)
router.put   ('/psych-concepts/:id', guard, updatePsychConcept)
router.delete('/psych-concepts/:id', guard, deletePsychConcept)

// ─── Products ────────────────────────────────────────────────
router.get   ('/products',     guard, getProducts)
router.post  ('/products',     guard, createProduct)
router.put   ('/products/:id', guard, updateProduct)
router.patch ('/products/:id', guard, updateProduct)
router.delete('/products/:id', guard, deleteProduct)

// ─── Blog Posts ──────────────────────────────────────────────
router.get   ('/posts',     guard, getPosts)
router.post  ('/posts',     guard, createPost)
router.put   ('/posts/:id', guard, updatePost)
router.delete('/posts/:id', guard, deletePost)

// ─── News Articles ───────────────────────────────────────────
router.get   ('/news',     guard, getNews)
router.post  ('/news',     guard, createNews)
router.put   ('/news/:id', guard, updateNews)
router.delete('/news/:id', guard, deleteNews)

// ─── Resources ───────────────────────────────────────────────
router.get   ('/resources',     guard, getResources)
router.post  ('/resources',     guard, createResource)
router.put   ('/resources/:id', guard, updateResource)
router.delete('/resources/:id', guard, deleteResource)

// ─── Gallery ─────────────────────────────────────────────────
router.get   ('/gallery',     guard, getGallery)
router.post  ('/gallery',     guard, createGalleryItem)
router.put   ('/gallery/:id', guard, updateGalleryItem)
router.delete('/gallery/:id', guard, deleteGalleryItem)

// ─── Research Papers ─────────────────────────────────────────
router.get   ('/research',     guard, getResearch)
router.post  ('/research',     guard, createResearch)
router.put   ('/research/:id', guard, updateResearch)
router.delete('/research/:id', guard, deleteResearch)

router.get   ('/social-work-programs',     guard, getSocialWorkPrograms)
router.post  ('/social-work-programs',     guard, createSocialWorkProgram)
router.put   ('/social-work-programs/:id', guard, updateSocialWorkProgram)
router.delete('/social-work-programs/:id', guard, deleteSocialWorkProgram)

// ─── Psych Videos ────────────────────────────────────────────
router.get   ('/psych-videos',     guard, getPsychVideos)
router.post  ('/psych-videos',     guard, createPsychVideo)
router.put   ('/psych-videos/:id', guard, updatePsychVideo)
router.delete('/psych-videos/:id', guard, deletePsychVideo)

// ─── Psych Analyses ──────────────────────────────────────────
router.get   ('/psych-analyses',     guard, getPsychAnalyses)
router.post  ('/psych-analyses',     guard, createPsychAnalysis)
router.put   ('/psych-analyses/:id', guard, updatePsychAnalysis)
router.delete('/psych-analyses/:id', guard, deletePsychAnalysis)

// ─── Courses ─────────────────────────────────────────────────
router.get   ('/courses',     guard, getCourses)
router.post  ('/courses',     guard, createCourse)
router.put   ('/courses/:id', guard, updateCourse)
router.delete('/courses/:id', guard, deleteCourse)

// ─── Assessments ─────────────────────────────────────────────
router.get   ('/assessments',     guard, getAssessments)
router.post  ('/assessments',     guard, createAssessment)
router.put   ('/assessments/:id', guard, updateAssessment)
router.delete('/assessments/:id', guard, deleteAssessment)

// ─── Community Groups ────────────────────────────────────────
router.get   ('/community-groups',     guard, getCommunityGroups)
router.post  ('/community-groups',     guard, createCommunityGroup)
router.put   ('/community-groups/:id', guard, updateCommunityGroup)
router.delete('/community-groups/:id', guard, deleteCommunityGroup)

// ─── Group Sessions ──────────────────────────────────────────
router.get   ('/group-sessions',     guard, adminGetSessions)
router.post  ('/group-sessions',     guard, adminCreateSessionFull)
router.put   ('/group-sessions/:id', guard, adminUpdateSession)
router.delete('/group-sessions/:id', guard, adminDeleteSession)



router.get('/delivery-riders', guard, async (req, res, next) => {
  try {
    const { is_active, limit = 200 } = req.query
    let q = supabase
      .from('delivery_riders')
      .select(`id, user_id, full_name, email, phone,
               vehicle_type, vehicle_number, area,
               is_active, total_delivered, total_failed, created_at`)
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (is_active !== undefined) q = q.eq('is_active', is_active === 'true')

    const { data, error } = await q
    if (error) throw error
    res.json({ riders: data || [], total: data?.length || 0 })
  } catch (err) { next(err) }
})

router.post('/delivery-riders', [authenticate, requireAdmin], async (req, res, next) => {
    if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only admins can register delivery riders.' })
  }
  try {
    const {
      full_name, email, phone, password,
      vehicle_type, vehicle_number, area, notes,
    } = req.body

    if (!full_name?.trim()) return res.status(400).json({ message: 'Full name is required.' })
    if (!email?.trim())     return res.status(400).json({ message: 'Email is required.' })
    if (!password)          return res.status(400).json({ message: 'Password is required.' })
    if (!area?.trim())      return res.status(400).json({ message: 'Delivery area is required.' })

    // 1. Create auth user via Supabase Admin API
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email:          email.trim().toLowerCase(),
        password,
        email_confirm:  true,
        user_metadata:  { full_name: full_name.trim(), role: 'rider' },
      })
    if (authError) return res.status(400).json({ message: authError.message })

    const userId = authData.user.id

    // 2. Insert into profiles (same as registerStaff does)
    const { error: profileError } = await supabase
      .from('profiles')
       .insert({
    user_id:         userId,                      // ← FK to profiles.id
    full_name:       full_name.trim(),
    email:           email.trim().toLowerCase(),
    phone:           phone?.trim()          || null,
    vehicle_type:    vehicle_type           || null,
    vehicle_number:  vehicle_number?.trim() || null,
    area:            area.trim(),
    notes:           notes?.trim()          || null,
    is_active:       true,
    is_available:    true,
    total_delivered: 0,
    total_failed:    0,
  })
    if (profileError) {
      // Roll back auth user if profile insert fails
      await supabase.auth.admin.deleteUser(userId)
      return res.status(500).json({ message: profileError.message })
    }

    // 3. Insert into delivery_riders  ← the missing piece
    //    NOTE: user_id is the FK (delivery.js getRider uses .eq('user_id', ...))
    const { data: riderRow, error: riderError } = await supabase
      .from('delivery_riders')
      .insert({
        user_id:        userId,          // FK → profiles.id / auth.users.id
        full_name:      full_name.trim(),
        email:          email.trim().toLowerCase(),
        phone:          phone?.trim()          || null,
        vehicle_type:   vehicle_type           || null,
        vehicle_number: vehicle_number?.trim() || null,
        area:           area.trim(),
        notes:          notes?.trim()          || null,
        is_active:      true,
        is_available:   true,
        total_delivered: 0,
        total_failed:    0,
      })
      .select()
      .single()

    if (riderError) {
      // Roll back both auth user and profile
      await supabase.from('profiles').delete().eq('id', userId)
      await supabase.auth.admin.deleteUser(userId)
      return res.status(500).json({ message: riderError.message })
    }

    return res.status(201).json({
      message: 'Delivery rider registered successfully.',
      rider: {
        id:           riderRow.id,
        user_id:      userId,
        full_name:    full_name.trim(),
        email:        email.trim().toLowerCase(),
        area:         area.trim(),
        vehicle_type: vehicle_type || null,
      },
    })
  } catch (err) { next(err) }
})

// ─── Group Reservations ──────────────────────────────────────
router.get('/group-reservations',      guard, adminGetReservations)
// ✅ NEW: frontend PUT /admin/group-reservations/:id for confirm/reject payment
router.put('/group-reservations/:id',  guard, async (req, res, next) => {
  try {
    const allowed = ['payment_status', 'confirmed_at', 'status', 'payment_reference']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }
    if (Object.keys(updates).length === 0)
      return res.status(400).json({ success: false, message: 'No valid fields to update.' })

    const { data, error } = await supabase
      .from('group_session_reservations')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    res.json({ success: true, reservation: data })
  } catch (err) { next(err) }
})
router.delete('/group-reservations/:id', guard, async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('group_session_reservations')
      .delete()
      .eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.get('/course-playlists', guard, async (req, res, next) => {
  try {
    const { course_id, limit = 200, page = 1 } = req.query

    // Step 1: fetch playlists (no aggregates — Supabase JS doesn't support .sum() in select)
    let query = supabase
      .from('course_playlists')
      .select('id, course_id, title, description, emoji, sort_order, is_published, access_pin, created_at, updated_at', { count: 'exact' })
      .order('sort_order', { ascending: true })
      .range((page - 1) * limit, page * limit - 1)

    if (course_id) query = query.eq('course_id', course_id)

    const { data: playlists, error, count } = await query
    if (error) throw error

    if (!playlists || playlists.length === 0) {
      return res.json({ success: true, items: [], total: 0, pagination: { page: +page, limit: +limit, total: 0 } })
    }

    // Step 2: fetch video counts + total duration per playlist in one query
    const playlistIds = playlists.map(p => p.id)
    const { data: videos, error: vErr } = await supabase
      .from('course_videos')
      .select('playlist_id, duration_secs')
      .in('playlist_id', playlistIds)

    if (vErr) throw vErr

    // Step 3: aggregate in JS (avoids all SQL aggregate issues entirely)
    const statsMap = {}
    for (const v of (videos || [])) {
      if (!statsMap[v.playlist_id]) statsMap[v.playlist_id] = { video_count: 0, total_duration_secs: 0 }
      statsMap[v.playlist_id].video_count++
      statsMap[v.playlist_id].total_duration_secs += Number(v.duration_secs || 0)
    }

    // Step 4: merge and sanitise
    const items = playlists.map(p => ({
      ...p,
      video_count:         statsMap[p.id]?.video_count         ?? 0,
      total_duration_secs: statsMap[p.id]?.total_duration_secs ?? 0,
      requires_pin:        p.access_pin != null && p.access_pin !== '',
      access_pin:          undefined, // never expose hashed PIN to client
    }))

    res.json({
      success: true,
      items,
      total: count || items.length,
      pagination: { page: +page, limit: +limit, total: count || items.length },
    })
  } catch (err) { next(err) }
})
 
router.post('/course-playlists', guard, async (req, res, next) => {
  try {
    const { course_id, title, description, emoji, sort_order, is_published, access_pin } = req.body
    if (!course_id) return res.status(400).json({ success: false, message: 'course_id is required' })
    if (!title?.trim()) return res.status(400).json({ success: false, message: 'title is required' })
 
    const payload = { course_id, title: title.trim(), description: description || null, emoji: emoji || '📚', sort_order: sort_order ?? 0, is_published: is_published !== false }
 
    // Hash PIN with pgcrypto if provided
    if (access_pin?.trim()) {
      // Use supabase RPC to hash (pgcrypto crypt is only available server-side via RPC or SQL)
      // Simple option: store raw and let DB trigger hash it, OR call DB function:
      const { data: hashed, error: hErr } = await supabase.rpc('hash_playlist_pin', { p_pin: access_pin.trim() })
      if (hErr) {
        // Fallback: store as-is if RPC not available (create the RPC below)
        payload.access_pin = access_pin.trim()
      } else {
        payload.access_pin = hashed
      }
    }
 
    const { data, error } = await supabase.from('course_playlists').insert(payload).select().single()
    if (error) throw error
    res.status(201).json({ success: true, playlist: data })
  } catch (err) { next(err) }
})
 
router.put('/course-playlists/:id', guard, async (req, res, next) => {
  try {
    const allowed = ['title', 'description', 'emoji', 'sort_order', 'is_published']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }
 
    // PIN update: hash if provided, remove if explicitly passed as empty string
    if (req.body.access_pin !== undefined) {
      const pin = req.body.access_pin?.trim()
      if (pin) {
        const { data: hashed, error: hErr } = await supabase.rpc('hash_playlist_pin', { p_pin: pin })
        updates.access_pin = hErr ? pin : hashed
      } else {
        // Empty string → remove pin
        updates.access_pin = null
      }
    }
 
    if (Object.keys(updates).length === 0)
      return res.status(400).json({ success: false, message: 'No fields to update' })
 
    const { data, error } = await supabase
      .from('course_playlists')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    res.json({ success: true, playlist: data })
  } catch (err) { next(err) }
})
 
router.delete('/course-playlists/:id', guard, async (req, res, next) => {
  try {
    // Unlink videos from this playlist (ON DELETE SET NULL handles this automatically
    // via the FK, but we make it explicit so videos aren't accidentally orphaned silently)
    await supabase.from('course_videos').update({ playlist_id: null }).eq('playlist_id', req.params.id)
 
    const { error } = await supabase.from('course_playlists').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true, message: 'Playlist deleted. Videos have been unlinked.' })
  } catch (err) { next(err) }
})
 
// ─── Course Videos ───────────────────────────────────────────────────────────
router.get('/course-videos', guard, async (req, res, next) => {
  try {
    const { course_id, playlist_id, limit = 200, page = 1 } = req.query
    let query = supabase
      .from('course_videos')
      .select('*', { count: 'exact' })
      .order('sort_order', { ascending: true })
      .range((page - 1) * limit, page * limit - 1)
 
    if (course_id)   query = query.eq('course_id', course_id)
    if (playlist_id) query = query.eq('playlist_id', playlist_id)
 
    const { data, error, count } = await query
    if (error) throw error
    res.json({ success: true, items: data || [], total: count || 0, pagination: { page: +page, limit: +limit, total: count || 0 } })
  } catch (err) { next(err) }
})
 
router.post('/course-videos', guard, async (req, res, next) => {
  try {
    const { course_id, playlist_id, title, description, video_url, thumbnail_url, duration_secs, sort_order, is_free_preview } = req.body
    if (!course_id)        return res.status(400).json({ success: false, message: 'course_id is required' })
    if (!title?.trim())    return res.status(400).json({ success: false, message: 'title is required' })
    if (!video_url?.trim()) return res.status(400).json({ success: false, message: 'video_url is required' })
 
    const { data, error } = await supabase.from('course_videos').insert({
      course_id,
      playlist_id:     playlist_id || null,
      title:           title.trim(),
      description:     description || null,
      video_url:       video_url.trim(),
      thumbnail_url:   thumbnail_url || null,
      duration_secs:   duration_secs ? Number(duration_secs) : null,
      sort_order:      sort_order != null ? Number(sort_order) : 0,
      is_free_preview: is_free_preview === true,
    }).select().single()
 
    if (error) throw error
    res.status(201).json({ success: true, video: data })
  } catch (err) { next(err) }
})
 
router.put('/course-videos/:id', guard, async (req, res, next) => {
  try {
    const allowed = ['course_id', 'playlist_id', 'title', 'description', 'video_url', 'thumbnail_url', 'duration_secs', 'sort_order', 'is_free_preview']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (key === 'duration_secs' && req.body[key] !== null) updates[key] = Number(req.body[key])
        else if (key === 'sort_order') updates[key] = Number(req.body[key])
        else updates[key] = req.body[key]
      }
    }
    if (Object.keys(updates).length === 0)
      return res.status(400).json({ success: false, message: 'No fields to update' })
 
    const { data, error } = await supabase
      .from('course_videos')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    res.json({ success: true, video: data })
  } catch (err) { next(err) }
})
 
router.delete('/course-videos/:id', guard, async (req, res, next) => {
  try {
    const { error } = await supabase.from('course_videos').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (err) { next(err) }
})

// ─── Group Memberships ───────────────────────────────────────
// ✅ FIXED: was router.get('/group-memberships', guard, adminGetMemberships)
//    adminGetMemberships does NOT exist in adminController — moved to communityController
router.get   ('/group-memberships',     guard, adminListMemberships)
router.put   ('/group-memberships/:id', guard, adminUpdateMembership)   // ✅ NEW
router.delete('/group-memberships/:id', guard, adminDeleteMembership)   // ✅ NEW

// ─── FAQs ────────────────────────────────────────────────────
router.get   ('/faqs',     guard, getFaqs)
router.post  ('/faqs',     guard, createFaq)
router.put   ('/faqs/:id', guard, updateFaq)
router.delete('/faqs/:id', guard, deleteFaq)

// ─── Coupons ─────────────────────────────────────────────────
router.get   ('/coupons',     guard, getCoupons)
router.post  ('/coupons',     guard, createCoupon)
router.put   ('/coupons/:id', guard, updateCoupon)
router.delete('/coupons/:id', guard, deleteCoupon)

// ─── Contact Messages ────────────────────────────────────────
router.get   ('/contacts',     guard, getContacts)
router.put   ('/contacts/:id', guard, updateContact)
router.delete('/contacts/:id', guard, deleteContact)

// ─── Subscriptions ───────────────────────────────────────────
router.get('/subscriptions',     guard, getSubscriptions)
router.put('/subscriptions/:id', guard, updateSubscription)

// ─── Site Settings ───────────────────────────────────────────
router.get('/settings',     guard, getSettings)
router.put('/settings/:id', guard, updateSetting)

// ─── Community (legacy sub-routes) ───────────────────────────
router.get   ('/community/groups',             guard, adminListGroups)
router.post  ('/community/groups',             guard, adminCreateGroup)
router.patch ('/community/groups/:id/toggle',  guard, adminToggleGroup)
router.get   ('/community/sessions',           guard, adminListSessions)
router.post  ('/community/sessions',           guard, adminCreateSession)
router.get   ('/community/posts',              guard, adminListPosts)
router.patch ('/community/posts/:id/moderate', guard, adminModeratePost)
router.delete('/community/posts/:id',          guard, adminDeletePost)
router.get   ('/community/reservations',       guard, adminListReservations)

module.exports = router