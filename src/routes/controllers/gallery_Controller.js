// src/routes/controllers/gallery_Controller.js
const supabase = require('../../db/supabase')

// GET /api/gallery?category=
const getItems = async (req, res) => {
  try {
    const { category } = req.query

    let query = supabase
      .from('gallery_items')
      .select('*')
      .order('created_at', { ascending: false })

    if (category && category !== 'All') query = query.eq('category', category)

    const { data, error } = await query
    if (error) throw error
    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET /api/gallery/categories
const getCategories = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('gallery_items')
      .select('category')
    if (error) throw error
    const unique = ['All', ...new Set(data.map(r => r.category))]
    res.json({ success: true, data: unique })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// GET /api/gallery/:id
const getItemById = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('gallery_items')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Item not found' })
    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// POST /api/gallery  (admin)
const createItem = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('gallery_items')
      .insert([req.body])
      .select()
      .single()
    if (error) throw error
    res.status(201).json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// PUT /api/gallery/:id  (admin)
const updateItem = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('gallery_items')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// DELETE /api/gallery/:id  (admin)
const deleteItem = async (req, res) => {
  try {
    const { error } = await supabase
      .from('gallery_items')
      .delete()
      .eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true, message: 'Item deleted' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

const adminUploadItem = async (req, res) => {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ success: false, message: 'No photo file provided.' })
 
    const { title, description, category, date_label, emoji } = req.body
    if (!title?.trim())    return res.status(400).json({ success: false, message: 'Title is required.' })
    if (!category?.trim()) return res.status(400).json({ success: false, message: 'Category is required.' })
 
    // ── 1. Upload to Supabase Storage ───────────────────────────────
    const path  = require('path')
    const { v4: uuidv4 } = require('uuid')
 
    const ext         = path.extname(file.originalname).toLowerCase() || '.jpg'
    const storagePath = `gallery/${uuidv4()}${ext}`
 
    const { error: uploadError } = await supabase.storage
      .from('gallery-images')          // ← create this bucket in Supabase dashboard
      .upload(storagePath, file.buffer, {
        contentType:  file.mimetype,
        cacheControl: '31536000',      // 1 year cache
        upsert:       false,
      })
 
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)
 
    // ── 2. Get public URL ────────────────────────────────────────────
    const { data: urlData } = supabase.storage
      .from('gallery-images')
      .getPublicUrl(storagePath)
 
    const image_url = urlData?.publicUrl || ''
 
    // ── 3. Insert into gallery_items ─────────────────────────────────
    const { data, error } = await supabase
      .from('gallery_items')
      .insert([{
        title:        title.trim(),
        description:  description?.trim() || '',
        category:     category.trim(),
        image_url,
        date_label:   date_label?.trim() || String(new Date().getFullYear()),
        emoji:        emoji?.trim()       || '📸',
        cols:         1,
        rows:         1,
        storage_path: storagePath,        // store so we can delete later
        created_at:   new Date().toISOString(),
      }])
      .select()
      .single()
 
    if (error) throw error
 
    return res.status(201).json({ success: true, data })
  } catch (err) {
    console.error('[adminUploadItem]', err)
    res.status(500).json({ success: false, message: err.message })
  }
}

const replacePhoto = async (req, res) => {
  try {
    const file = req.file
    const { itemId } = req.body
    if (!file)   return res.status(400).json({ success: false, message: 'No photo provided.' })
    if (!itemId) return res.status(400).json({ success: false, message: 'No itemId provided.' })

    const path  = require('path')
    const { v4: uuidv4 } = require('uuid')
    const ext         = path.extname(file.originalname).toLowerCase() || '.jpg'
    const storagePath = `gallery/${uuidv4()}${ext}`

    const { error: uploadError } = await supabase.storage
      .from('gallery-images')
      .upload(storagePath, file.buffer, { contentType: file.mimetype, cacheControl: '31536000', upsert: false })
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

    const { data: urlData } = supabase.storage.from('gallery-images').getPublicUrl(storagePath)
    const image_url = urlData?.publicUrl || ''

    const { data, error } = await supabase
      .from('gallery_items')
      .update({ image_url, image_storage_path: storagePath, updated_at: new Date().toISOString() })
      .eq('id', itemId)
      .select().single()
    if (error) throw error

    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}



module.exports = {
  getItems,
  getCategories,
  adminUploadItem,
  replacePhoto,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
}