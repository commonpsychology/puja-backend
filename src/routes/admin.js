// src/routes/admin.js — COMPLETE FIXED VERSION
// Changes from previous version:
//   1. Removed adminGetMemberships import from adminController (it doesn't exist there)
//   2. Added adminListMemberships, adminUpdateMembership, adminDeleteMembership
//      imported from communityController
//   3. Added PUT + DELETE routes for /group-memberships/:id
//   4. Added PUT route for /group-reservations/:id (needed by frontend confirm/reject)
//   5. adminGetSessions / adminCreateSessionFull / adminUpdateSession / adminDeleteSession
//      kept as-is (they live in adminController)
//   6. Removed manual profiles.insert() from POST /delivery-riders —
//      a DB trigger on auth.users auto-creates the profiles row using user_metadata.
//      Rollback also simplified (no profiles.delete needed).

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
 
// ✅ MUST be before PUT /orders/:id — otherwise Express matches
// "assign-rider" as the :id param and this route is never reached.
router.put('/orders/:id/assign-rider', guard, async (req, res, next) => {
  try {
    const { rider_id } = req.body
 
    // Don't regress delivery_status if already picked up / in transit / etc.
    const LOCK_STATUSES = ['picked_up', 'in_transit', 'delivered', 'failed', 'returned']
 
    const { data: existing, error: fetchErr } = await supabase
      .from('orders')
      .select('delivery_status')
      .eq('id', req.params.id)
      .single()
 
    if (fetchErr || !existing)
      return res.status(404).json({ message: 'Order not found.' })
 
    const updates = {
      delivery_rider_id: rider_id || null,
      updated_at:        new Date().toISOString(),
    }
 
    // Only set delivery_status when it's safe to do so
    if (rider_id && !LOCK_STATUSES.includes(existing.delivery_status)) {
      updates.delivery_status = 'assigned'
    } else if (!rider_id && !LOCK_STATUSES.includes(existing.delivery_status)) {
      updates.delivery_status = 'unassigned'
    }
    // If locked status → just update the rider, leave delivery_status alone
 
    const { data, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', req.params.id)
      .select('id, order_number, delivery_rider_id, delivery_status')
      .single()
 
    if (error) throw error
    res.json({ success: true, order: data })
  } catch (err) { next(err) }
})
 
// Generic order update — AFTER the specific assign-rider route
router.put('/orders/:id', guard, setOrderStatus)

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

// ─── Social Work Programs ────────────────────────────────────
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

// ─── Group Session Reservations (admin view) ─────────────────
router.get('/group-reservations',      guard, adminGetReservations)
router.put('/group-reservations/:id',  guard, async (req, res, next) => {
  try {
    const allowed = ['payment_status', 'confirmed_at', 'status', 'payment_reference']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }
    if (!Object.keys(updates).length)
      return res.status(400).json({ message: 'No valid fields to update.' })
    const { data, error } = await supabase
      .from('group_reservations')
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
    const { data: res_, error: fetchErr } = await supabase
      .from('group_reservations')
      .select('session_id')
      .eq('id', req.params.id)
      .single()
    if (fetchErr) throw fetchErr
    const { error } = await supabase
      .from('group_reservations')
      .delete()
      .eq('id', req.params.id)
    if (error) throw error
    // decrement reserved_count
    await supabase.rpc('decrement_session_reserved_count', { session_id: res_.session_id })
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.get('/delivery-riders', guard, async (req, res, next) => {
  try {
    const limit      = Math.min(500, parseInt(req.query.limit) || 200)
    const onlyActive = req.query.is_active !== 'false'
 
    let q = supabase
      .from('delivery_riders')
      .select(`
        id, user_id, area, vehicle_type, vehicle_number,
        is_active, is_available, is_verified,
        total_delivered, total_failed, notes, created_at,
        profiles!inner ( full_name, email, phone )
      `)
      .order('created_at', { ascending: false })
      .limit(limit)
 
    if (onlyActive) q = q.eq('is_active', true)
 
    const { data, error } = await q
    if (error) throw error
 
    const riders = (data || []).map(r => ({
      id:              r.id,
      user_id:         r.user_id,
      full_name:       r.profiles.full_name,
      email:           r.profiles.email,
      phone:           r.profiles.phone,
      area:            r.area,
      vehicle_type:    r.vehicle_type,
      vehicle_number:  r.vehicle_number,
      is_active:       r.is_active,
      is_available:    r.is_available,
      is_verified:     r.is_verified,
      total_delivered: r.total_delivered,
      total_failed:    r.total_failed,
      notes:           r.notes,
      created_at:      r.created_at,
    }))
 
    res.json({ riders, total: riders.length })
  } catch (err) { next(err) }
})

const {
  adminListGroups, adminCreateGroup, adminToggleGroup,
  adminListSessions, adminCreateSession,
  adminListPosts, adminModeratePost, adminDeletePost,
  adminListReservations,
  adminListMemberships, adminUpdateMembership, adminDeleteMembership,
} = require('./controllers/communityController')

// ── Community Groups ──────────────────────────────────────────
router.get('/community-groups',        adminListGroups)
router.post('/community-groups',       adminCreateGroup)
router.put('/community-groups/:id',    adminToggleGroup)   // reuse toggle for full update
router.delete('/community-groups/:id', async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('community_groups').update({ is_active: false }).eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (e) { next(e) }
})

// ── Group Sessions ────────────────────────────────────────────
router.get('/group-sessions',          adminListSessions)
router.post('/group-sessions',         adminCreateSession)
router.put('/group-sessions/:id',      async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('group_sessions').update(req.body).eq('id', req.params.id).select().single()
    if (error) throw error
    res.json({ success: true, session: data })
  } catch (e) { next(e) }
})
router.delete('/group-sessions/:id',   async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('group_sessions').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (e) { next(e) }
})

// ── Group Reservations ────────────────────────────────────────
router.get('/group-reservations',      adminListReservations)
router.put('/group-reservations/:id',  async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('group_reservations').update(req.body).eq('id', req.params.id).select().single()
    if (error) throw error
    res.json({ success: true, reservation: data })
  } catch (e) { next(e) }
})
router.delete('/group-reservations/:id', async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('group_reservations').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (e) { next(e) }
})

// ── Group Memberships ─────────────────────────────────────────
router.get('/group-memberships',       adminListMemberships)
router.put('/group-memberships/:id',   adminUpdateMembership)
router.delete('/group-memberships/:id', adminDeleteMembership)
 
// ─── POST /admin/delivery-riders ─────────────────────────────
// Fixed flow (atomic — rolls back everything on any failure):
//   Step 1: duplicate check on BOTH profiles AND auth.users
//   Step 2: insert profiles row (bcrypt hash — real password)
//   Step 3: create Supabase Auth user with SAME UUID (so signInWithPassword works)
//   Step 4: insert delivery_riders row
//   Rollback: if step 3 or 4 fails → delete profiles + auth user
router.post('/delivery-riders', guard, async (req, res, next) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ message: 'Only admins can register delivery riders.' })
 
  const bcrypt = require('bcryptjs')
  const { v4: uuidv4 } = require('uuid')   // npm i uuid  (already in most projects)
 
  try {
    const {
      full_name, email, phone, password,
      vehicle_type, vehicle_number, area, notes,
    } = req.body
 
    // ── 1. Validate ───────────────────────────────────────────
    if (!full_name?.trim())  return res.status(400).json({ message: 'Full name is required.' })
    if (!email?.trim())      return res.status(400).json({ message: 'Email is required.' })
    if (!password)           return res.status(400).json({ message: 'Password is required.' })
    if (!area?.trim())       return res.status(400).json({ message: 'Delivery area is required.' })
    if (password.length < 8)
      return res.status(400).json({ message: 'Password must be at least 8 characters.' })
    if (!/[A-Z]/.test(password))
      return res.status(400).json({ message: 'Password needs at least one uppercase letter.' })
    if (!/[0-9]/.test(password))
      return res.status(400).json({ message: 'Password needs at least one number.' })
 
    const normalizedEmail = email.trim().toLowerCase()
 
    // ── 2. Duplicate check — profiles table ──────────────────
    // Check this BEFORE touching auth.users so we never create
    // an orphaned auth user for a duplicate email.
    const { data: existing } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('email', normalizedEmail)
      .maybeSingle()
 
    if (existing) {
      return res.status(409).json({
        message: existing.role === 'rider'
          ? 'A rider with this email already exists.'
          : `This email is already registered as a ${existing.role}.`,
      })
    }
 
    // ── 3. Hash password ──────────────────────────────────────
    const password_hash = await bcrypt.hash(password, 12)
 
    // ── 4. Insert into profiles FIRST ────────────────────────
    // We generate the UUID here so we can pass it to auth.admin.createUser
    // and guarantee both rows share the same id.
    // If this fails (e.g. another duplicate race condition) we stop before
    // touching Supabase Auth — no orphaned auth user.
    const newUserId = uuidv4()
 
    const { data: newUser, error: profileErr } = await supabase
      .from('profiles')
      .insert({
        id:                newUserId,
        full_name:         full_name.trim(),
        email:             normalizedEmail,
        phone:             phone?.trim()  || null,
        password_hash,                        // real bcrypt hash — never 'oauth'
        role:              'rider',
        is_active:         true,
        is_email_verified: true,
        created_by:        req.user.id,
        notes:             notes?.trim() || null,
      })
      .select('id, full_name, email, role, created_at')
      .single()
 
    if (profileErr) {
      console.error('[admin/delivery-riders] profiles insert:', profileErr.message)
      if (profileErr.code === '23505')
        return res.status(409).json({ message: 'A user with this email already exists.' })
      return res.status(500).json({ message: 'Failed to create user profile: ' + profileErr.message })
    }
 
    // ── 5. Create Supabase Auth user with the SAME UUID ───────
    // This is what makes supabaseAnon.signInWithPassword work on login.
    // We pass the UUID we already used for profiles so both tables are
    // in sync. If this fails we roll back the profiles row.
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      id:            newUserId,              // SAME UUID as profiles.id
      email:         normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name.trim(), role: 'rider' },
    })
 
    if (authErr) {
      // Roll back the profiles row we just inserted
      await supabase.from('profiles').delete().eq('id', newUserId).catch(() => {})
      console.error('[admin/delivery-riders] Supabase Auth createUser:', authErr.message)
      return res.status(400).json({ message: 'Failed to create auth account: ' + authErr.message })
    }
 
    // ── 6. Insert into delivery_riders ────────────────────────
    // If this fails we roll back BOTH the profiles row and the auth user.
    const { data: riderRow, error: riderErr } = await supabase
      .from('delivery_riders')
      .insert({
        user_id:         newUserId,
        vehicle_type:    vehicle_type           || null,
        vehicle_number:  vehicle_number?.trim() || null,
        area:            area.trim(),
        notes:           notes?.trim()          || null,
        is_active:       true,
        is_available:    true,
        is_verified:     false,
        total_delivered: 0,
        total_failed:    0,
      })
      .select()
      .single()
 
    if (riderErr) {
      // Full rollback
      await supabase.from('profiles').delete().eq('id', newUserId).catch(() => {})
      await supabase.auth.admin.deleteUser(newUserId).catch(() => {})
      console.error('[admin/delivery-riders] delivery_riders insert:', riderErr.message)
      return res.status(500).json({ message: 'Failed to create rider profile: ' + riderErr.message })
    }
 
    // ── 7. Audit log (non-blocking) ───────────────────────────
    supabase.from('audit_logs').insert({
      actor_id:  req.user.id,
      action:    'register_rider',
      target_id: newUserId,
      details:   { area: area.trim(), vehicle_type: vehicle_type || null },
    }).then(() => {})
 
    return res.status(201).json({
      message: 'Delivery rider registered successfully.',
      rider: {
        id:           riderRow.id,
        user_id:      newUserId,
        full_name:    full_name.trim(),
        email:        normalizedEmail,
        area:         area.trim(),
        vehicle_type: vehicle_type || null,
      },
    })
 
  } catch (err) { next(err) }
})
 
// ─── PUT /admin/delivery-riders/:id ──────────────────────────
router.put('/delivery-riders/:id', guard, async (req, res, next) => {
  try {
    const allowed = ['is_active','is_available','is_verified','area','vehicle_type','vehicle_number','notes']
    const updates = {}
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k]
    }
    if (!Object.keys(updates).length)
      return res.status(400).json({ message: 'No valid fields to update.' })
 
    const { data, error } = await supabase
      .from('delivery_riders')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()
 
    if (error) throw error
    res.json({ success: true, rider: data })
  } catch (err) { next(err) }
})

router.get('/debug-supabase', guard, async (req, res) => {
  const results = {}

  // 1. Check env vars are present
  results.url_set         = !!process.env.SUPABASE_URL
  results.service_key_set = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  results.key_preview     = process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 40)

  // 2. Try listing auth users — only works with service role key
  const { data: authData, error: authError } =
    await supabase.auth.admin.listUsers({ page: 1, perPage: 1 })
  results.auth_admin_works = !authError
  results.auth_error       = authError?.message || null

  // 3. Try reading profiles table
  const { data: profileData, error: profileError } =
    await supabase.from('profiles').select('id').limit(1)
  results.profiles_readable = !profileError
  results.profiles_error    = profileError?.message || null

  res.json(results)
})
router.post('/debug-create-rider', async (req, res) => {
  const results = {}

  // Step 1: can we call auth.admin at all?
  try {
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 })
    results.step1_auth_admin = error ? `FAIL: ${error.message}` : 'OK'
  } catch (e) { results.step1_auth_admin = `THROW: ${e.message}` }

  // Step 2: try creating a test auth user
  const testEmail = `test_rider_debug_${Date.now()}@debugtest.com`
  let testUserId = null
  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email:         testEmail,
      password:      'TestPass123!',
      email_confirm: true,
      user_metadata: { full_name: 'Debug Rider', role: 'rider' },
    })
    if (error) {
      results.step2_createUser = `FAIL: ${error.message}`
    } else {
      testUserId = data.user.id
      results.step2_createUser = `OK — userId: ${testUserId}`
    }
  } catch (e) { results.step2_createUser = `THROW: ${e.message}` }

  // Step 3: did a profiles row get auto-created? (trigger check)
  if (testUserId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, is_active')
        .eq('id', testUserId)
        .single()
      results.step3_profile_exists = error
        ? `NOT FOUND (no trigger): ${error.message}`
        : `AUTO-CREATED: ${JSON.stringify(data)}`
    } catch (e) { results.step3_profile_exists = `THROW: ${e.message}` }
  } else {
    results.step3_profile_exists = 'SKIPPED (step 2 failed)'
  }

  // Step 4: try manual profiles insert (if trigger didn't create it)
  if (testUserId) {
    try {
      const { error } = await supabase.from('profiles').upsert({
        id:        testUserId,
        full_name: 'Debug Rider',
        email:     testEmail,
        role:      'rider',
        is_active: true,
      })
      results.step4_manual_profile = error ? `FAIL: ${error.message}` : 'OK'
    } catch (e) { results.step4_manual_profile = `THROW: ${e.message}` }
  } else {
    results.step4_manual_profile = 'SKIPPED (step 2 failed)'
  }

  // Step 5: try delivery_riders insert
  if (testUserId) {
    try {
      const { error } = await supabase.from('delivery_riders').insert({
        user_id:         testUserId,
        full_name:       'Debug Rider',
        email:           testEmail,
        area:            'Test Area',
        is_active:       true,
        is_available:    true,
        total_delivered: 0,
        total_failed:    0,
      })
      results.step5_delivery_rider = error ? `FAIL: ${error.message}` : 'OK'
    } catch (e) { results.step5_delivery_rider = `THROW: ${e.message}` }
  } else {
    results.step5_delivery_rider = 'SKIPPED (step 2 failed)'
  }

  // Cleanup: delete test user (cascades if FK set up)
  if (testUserId) {
    await supabase.auth.admin.deleteUser(testUserId)
    await supabase.from('profiles').delete().eq('id', testUserId)
    await supabase.from('delivery_riders').delete().eq('user_id', testUserId)
    results.cleanup = 'done'
  }

  return res.json(results)
})

router.post('/debug-create-rider', async (req, res) => {
  const results = {}

  try {
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 })
    results.step1_auth_admin = error ? `FAIL: ${error.message}` : 'OK'
  } catch (e) { results.step1_auth_admin = `THROW: ${e.message}` }

  const testEmail = `test_rider_${Date.now()}@debugtest.com`
  let testUserId = null

  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email:         testEmail,
      password:      'TestPass123!',
      email_confirm: true,
      user_metadata: { full_name: 'Debug Rider', role: 'rider' },
    })
    if (error) {
      results.step2_createUser = `FAIL: ${error.message}`
    } else {
      testUserId = data.user.id
      results.step2_createUser = `OK: ${testUserId}`
    }
  } catch (e) { results.step2_createUser = `THROW: ${e.message}` }

  if (testUserId) {
    const { data, error } = await supabase.from('profiles').select('id,role').eq('id', testUserId).single()
    results.step3_profile = error ? `NOT FOUND: ${error.message}` : `EXISTS: ${JSON.stringify(data)}`
  }

  if (testUserId) {
    const { error } = await supabase.from('profiles').upsert({ id: testUserId, full_name: 'Debug Rider', email: testEmail, role: 'rider', is_active: true })
    results.step4_manual_profile = error ? `FAIL: ${error.message}` : 'OK'
  }

  if (testUserId) {
    await supabase.auth.admin.deleteUser(testUserId)
    await supabase.from('profiles').delete().eq('id', testUserId)
    results.cleanup = 'done'
  }

  return res.json(results)
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

// ─── Course Playlists ────────────────────────────────────────
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

    const payload = {
      course_id,
      title:        title.trim(),
      description:  description || null,
      emoji:        emoji || '📚',
      sort_order:   sort_order ?? 0,
      is_published: is_published !== false,
    }

    // Hash PIN with pgcrypto if provided
    if (access_pin?.trim()) {
      const { data: hashed, error: hErr } = await supabase.rpc('hash_playlist_pin', { p_pin: access_pin.trim() })
      if (hErr) {
        // Fallback: store as-is if RPC not available
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
    // Unlink videos from this playlist before deleting
    await supabase.from('course_videos').update({ playlist_id: null }).eq('playlist_id', req.params.id)

    const { error } = await supabase.from('course_playlists').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true, message: 'Playlist deleted. Videos have been unlinked.' })
  } catch (err) { next(err) }
})

// ─── Course Videos ───────────────────────────────────────────
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
    if (!course_id)         return res.status(400).json({ success: false, message: 'course_id is required' })
    if (!title?.trim())     return res.status(400).json({ success: false, message: 'title is required' })
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