// src/routes/controllers/volunteerGalleryController.js
// Handles: volunteer applications + gallery photo submissions

const supabase       = require('../../db/supabase')
const multer         = require('multer')
const path           = require('path')
const { v4: uuidv4 } = require('uuid')

// ─────────────────────────────────────────────────────────────
// MULTER — memory storage (stream directly to Supabase Storage)
// ─────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },          // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only JPG, PNG and WEBP images are allowed.'))
  },
})

// ─────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────
function paginated(data, count, page, limit) {
  return {
    success: true,
    items:   data || [],
    pagination: {
      page:  Number(page),
      limit: Number(limit),
      total: count || 0,
    },
  }
}

// ═════════════════════════════════════════════════════════════
// VOLUNTEER APPLICATIONS — Public
// ═════════════════════════════════════════════════════════════

async function submitVolunteer(req, res, next) {
  try {
    const {
      firstName, lastName, email, phone,
      district, address, profession, organisation, experience,
      role, skills, reference,
      availability, languages, hours, motivation, consent,
    } = req.body

    if (!firstName?.trim()) return res.status(400).json({ success: false, message: 'First name is required.' })
    if (!lastName?.trim())  return res.status(400).json({ success: false, message: 'Last name is required.' })
    if (!email?.trim())     return res.status(400).json({ success: false, message: 'Email is required.' })
    if (!phone?.trim())     return res.status(400).json({ success: false, message: 'Phone is required.' })
    if (!role?.trim())      return res.status(400).json({ success: false, message: 'Role is required.' })
    if (!consent)           return res.status(400).json({ success: false, message: 'Consent is required.' })

    const { data, error } = await supabase
      .from('volunteer_applications')
      .insert({
        first_name:   firstName.trim(),
        last_name:    lastName.trim(),
        email:        email.trim().toLowerCase(),
        phone:        phone.trim(),
        district:     district?.trim()     || null,
        address:      address?.trim()      || null,
        profession:   profession?.trim()   || null,
        organisation: organisation?.trim() || null,
        experience:   experience?.trim()   || null,
        role:         role.trim(),
        skills:       skills?.trim()       || null,
        reference:    reference?.trim()    || null,
        availability: Array.isArray(availability) ? availability : [],
        languages:    Array.isArray(languages)    ? languages    : [],
        hours:        hours?.trim()        || null,
        motivation:   motivation?.trim()   || null,
        consent:      Boolean(consent),
        status:       'new',
      })
      .select('id, first_name, last_name, email, created_at')
      .single()

    if (error) throw error

    return res.status(201).json({
      success:   true,
      message:   'Application submitted successfully.',
      application: data,
      reference: `VOL-${new Date().getFullYear()}-${String(data.id).slice(0, 4).toUpperCase()}`,
    })
  } catch (err) { next(err) }
}

// ═════════════════════════════════════════════════════════════
// VOLUNTEER APPLICATIONS — Admin CRUD
// ═════════════════════════════════════════════════════════════

async function getVolunteerApplications(req, res, next) {
  try {
    const { page = 1, limit = 20, status, search, q } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('volunteer_applications')
      .select(
        'id, first_name, last_name, email, phone, district, role, status, availability, languages, created_at, admin_notes, reviewed_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (status) query = query.eq('status', status)
    if (search || q) {
      const term = search || q
      query = query.or(
        `first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,role.ilike.%${term}%`
      )
    }

    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

async function getVolunteerApplication(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('volunteer_applications')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Not found.' })
    return res.status(200).json({ success: true, item: data })
  } catch (err) { next(err) }
}

async function updateVolunteerApplication(req, res, next) {
  try {
    const { status, admin_notes } = req.body
    const validStatuses = ['new', 'reviewing', 'approved', 'rejected', 'waitlisted']
    if (status && !validStatuses.includes(status))
      return res.status(400).json({ success: false, message: 'Invalid status.' })

    const update = { updated_at: new Date().toISOString() }
    if (status)                    update.status      = status
    if (admin_notes !== undefined) update.admin_notes = admin_notes
    if (status && status !== 'new') {
      update.reviewed_by = req.user?.sub || req.user?.id || null
      update.reviewed_at = new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('volunteer_applications')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    return res.status(200).json({ success: true, item: data })
  } catch (err) { next(err) }
}

async function deleteVolunteerApplication(req, res, next) {
  try {
    const { error } = await supabase
      .from('volunteer_applications')
      .delete()
      .eq('id', req.params.id)
    if (error) throw error
    return res.status(200).json({ success: true, message: 'Application deleted.' })
  } catch (err) { next(err) }
}

// ═════════════════════════════════════════════════════════════
// GALLERY SUBMISSIONS — Public upload
// POST /api/gallery/submit
// ═════════════════════════════════════════════════════════════

async function submitGalleryPhoto(req, res, next) {
  try {
    const { name, email, message } = req.body
    const file = req.file

    if (!name?.trim())  return res.status(400).json({ success: false, message: 'Name is required.' })
    if (!email?.trim()) return res.status(400).json({ success: false, message: 'Email is required.' })
    if (!file)          return res.status(400).json({ success: false, message: 'Photo file is required.' })

    // Upload to Supabase Storage
    const ext         = path.extname(file.originalname).toLowerCase() || '.jpg'
    const storagePath = `submissions/${uuidv4()}${ext}`

    const { error: uploadError } = await supabase.storage
      .from('gallery-submissions')
      .upload(storagePath, file.buffer, {
        contentType:  file.mimetype,
        cacheControl: '3600',
        upsert:       false,
      })

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

    // Signed URL valid for 1 year
    const { data: urlData } = await supabase.storage
      .from('gallery-submissions')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365)

    const file_url = urlData?.signedUrl || ''

    // Save record to DB
    const { data, error } = await supabase
      .from('gallery_submissions')
      .insert({
        name:         name.trim(),
        email:        email.trim().toLowerCase(),
        message:      message?.trim() || null,
        file_url,
        file_name:    file.originalname,
        file_size:    file.size,
        mime_type:    file.mimetype,
        storage_path: storagePath,
        status:       'pending',
      })
      .select('id, name, email, created_at')
      .single()

    if (error) throw error

    return res.status(201).json({
      success:    true,
      message:    'Photo submitted! Our team will review it shortly.',
      submission: data,
    })
  } catch (err) { next(err) }
}

// ═════════════════════════════════════════════════════════════
// GALLERY SUBMISSIONS — Admin
// ═════════════════════════════════════════════════════════════

async function getGallerySubmissions(req, res, next) {
  try {
    const { page = 1, limit = 20, status } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('gallery_submissions')
      .select(
        'id, name, email, message, file_url, file_name, file_size, mime_type, storage_path, status, admin_notes, created_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (status) query = query.eq('status', status)

    const { data, count, error } = await query
    if (error) throw error

    // Refresh signed URLs (2-hour window for admin viewing)
    const items = await Promise.all(
      (data || []).map(async (item) => {
        if (!item.storage_path) return item
        try {
          const { data: urlData } = await supabase.storage
            .from('gallery-submissions')
            .createSignedUrl(item.storage_path, 60 * 60 * 2)
          return { ...item, file_url: urlData?.signedUrl || item.file_url }
        } catch { return item }
      })
    )

    return res.status(200).json(paginated(items, count, page, limit))
  } catch (err) { next(err) }
}

async function updateGallerySubmission(req, res, next) {
  try {
    const { status, admin_notes } = req.body
    const validStatuses = ['pending', 'approved', 'rejected', 'added_to_gallery']
    if (status && !validStatuses.includes(status))
      return res.status(400).json({ success: false, message: 'Invalid status.' })

    const update = { updated_at: new Date().toISOString() }
    if (status)                    update.status      = status
    if (admin_notes !== undefined) update.admin_notes = admin_notes
    if (status && status !== 'pending') {
      update.reviewed_by = req.user?.sub || req.user?.id || null
      update.reviewed_at = new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('gallery_submissions')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    return res.status(200).json({ success: true, item: data })
  } catch (err) { next(err) }
}

async function deleteGallerySubmission(req, res, next) {
  try {
    const { data: record, error: fe } = await supabase
      .from('gallery_submissions')
      .select('storage_path')
      .eq('id', req.params.id)
      .single()
    if (fe) throw fe

    if (record?.storage_path) {
      await supabase.storage
        .from('gallery-submissions')
        .remove([record.storage_path])
    }

    const { error } = await supabase
      .from('gallery_submissions')
      .delete()
      .eq('id', req.params.id)
    if (error) throw error

    return res.status(200).json({ success: true, message: 'Submission deleted.' })
  } catch (err) { next(err) }
}

async function downloadGallerySubmission(req, res, next) {
  try {
    const { data: record, error: fe } = await supabase
      .from('gallery_submissions')
      .select('storage_path, file_name, mime_type')
      .eq('id', req.params.id)
      .single()
    if (fe) throw fe
    if (!record?.storage_path)
      return res.status(404).json({ success: false, message: 'File not found.' })

    const { data: urlData, error: ue } = await supabase.storage
      .from('gallery-submissions')
      .createSignedUrl(record.storage_path, 60 * 5)   // 5-minute download link
    if (ue) throw ue

    return res.status(200).json({
      success:   true,
      url:       urlData.signedUrl,
      file_name: record.file_name,
    })
  } catch (err) { next(err) }
}

module.exports = {
  upload,

  // volunteer
  submitVolunteer,
  getVolunteerApplications,
  getVolunteerApplication,
  updateVolunteerApplication,
  deleteVolunteerApplication,

  // gallery submissions
  submitGalleryPhoto,
  getGallerySubmissions,
  updateGallerySubmission,
  deleteGallerySubmission,
  downloadGallerySubmission,
}