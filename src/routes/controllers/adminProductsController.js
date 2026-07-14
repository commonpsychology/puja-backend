// controllers/adminProductsController.js
// Assumes an `authenticate` + `requireAdmin` middleware chain upstream,
// and multer configured with memoryStorage for image uploads:
//   const upload = multer({ storage: multer.memoryStorage() })
//   router.post('/admin/products/:id/images', upload.array('images', 6), ctrl.uploadImages)

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BUCKET = 'product-images' // create this bucket in Supabase Storage (public)

// ---------- GET /api/admin/products ----------
exports.list = async (req, res) => {
  try {
    const page  = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Number(req.query.limit) || 20)
    const from  = (page - 1) * limit
    const to    = from + limit - 1

    let query = supabase.from('products').select('*', { count: 'exact' })
    if (req.query.search) query = query.ilike('name', `%${req.query.search}%`)
    if (req.query.category_id) query = query.eq('category_id', req.query.category_id)
    if (req.query.include_inactive !== 'true') query = query.eq('is_active', true)

    query = query.order('created_at', { ascending: false }).range(from, to)
    const { data, error, count } = await query
    if (error) throw error
    res.json({ items: data || [], pagination: { total: count || 0, page, limit } })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// ---------- POST /api/admin/products ----------
exports.create = async (req, res) => {
  try {
    const body = sanitizeBody(req.body)
    const { data, error } = await supabase.from('products').insert(body).select().single()
    if (error) throw error
    res.json({ product: data })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// ---------- PUT /api/admin/products/:id ----------
exports.update = async (req, res) => {
  try {
    const body = sanitizeBody(req.body)
    const { data, error } = await supabase.from('products').update(body).eq('id', req.params.id).select().single()
    if (error) throw error
    res.json({ product: data })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// ---------- DELETE /api/admin/products/:id (soft delete) ----------
exports.remove = async (req, res) => {
  try {
    const { error } = await supabase.from('products').update({ is_active: false }).eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// ---------- POST /api/admin/products/:id/images (multipart upload, appends to images[]) ----------
exports.uploadImages = async (req, res) => {
  try {
    const { id } = req.params
    const files = req.files || []
    if (files.length === 0) return res.status(400).json({ message: 'No files provided' })

    const { data: product } = await supabase.from('products').select('images').eq('id', id).single()
    const existing = product?.images || []
    const uploadedUrls = []

    for (const file of files) {
      const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase()
      const path = `${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file.buffer, {
        contentType: file.mimetype, upsert: false,
      })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
      uploadedUrls.push(pub.publicUrl)
    }

    const images = [...existing, ...uploadedUrls]
    const { data, error } = await supabase.from('products').update({ images }).eq('id', id).select().single()
    if (error) throw error
    res.json({ product: data })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// ---------- DELETE /api/admin/products/:id/images (body: { url }) ----------
exports.removeImage = async (req, res) => {
  try {
    const { id } = req.params
    const { url } = req.body
    const { data: product } = await supabase.from('products').select('images').eq('id', id).single()
    const images = (product?.images || []).filter(u => u !== url)
    const { data, error } = await supabase.from('products').update({ images }).eq('id', id).select().single()
    if (error) throw error
    res.json({ product: data })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// ---------- CATEGORIES ----------
exports.listCategories = async (req, res) => {
  const { data, error } = await supabase.from('product_categories').select('*').order('sort_order')
  if (error) return res.status(500).json({ message: error.message })
  res.json({ categories: data })
}
exports.createCategory = async (req, res) => {
  const { name, slug, sort_order = 0 } = req.body
  if (!name || !slug) return res.status(400).json({ message: 'name and slug are required' })
  const { data, error } = await supabase.from('product_categories').insert({ name, slug, sort_order }).select().single()
  if (error) return res.status(500).json({ message: error.message })
  res.json({ category: data })
}
exports.updateCategory = async (req, res) => {
  const { data, error } = await supabase.from('product_categories').update(req.body).eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ message: error.message })
  res.json({ category: data })
}
exports.deleteCategory = async (req, res) => {
  const { error } = await supabase.from('product_categories').delete().eq('id', req.params.id)
  if (error) return res.status(500).json({ message: error.message })
  res.json({ success: true })
}

// ---------- REVIEW MODERATION ----------
exports.listReviews = async (req, res) => {
  let query = supabase.from('product_reviews').select('*, products(name)').order('created_at', { ascending: false }).limit(200)
  if (req.query.product_id) query = query.eq('product_id', req.query.product_id)
  const { data, error } = await query
  if (error) return res.status(500).json({ message: error.message })
  res.json({ items: data })
}
exports.setReviewApproval = async (req, res) => {
  const { is_approved } = req.body
  const { error } = await supabase.from('product_reviews').update({ is_approved }).eq('id', req.params.id)
  if (error) return res.status(500).json({ message: error.message })
  res.json({ success: true })
}
exports.deleteReview = async (req, res) => {
  const { error } = await supabase.from('product_reviews').delete().eq('id', req.params.id)
  if (error) return res.status(500).json({ message: error.message })
  res.json({ success: true })
}

// ---------- helpers ----------
function sanitizeBody(body) {
  const allowed = [
    'category_id','name','slug','description','short_description','price','sale_price',
    'cost_price','sku','stock_quantity','is_digital','digital_file_url','images','tags',
    'meta_title','meta_description','is_active','is_featured','weight_grams','sort_order','image_url',
  ]
  const out = {}
  for (const k of allowed) if (k in body) out[k] = body[k]
  if (typeof out.tags === 'string') out.tags = out.tags.split(',').map(t => t.trim()).filter(Boolean)
  if (out.price !== undefined) out.price = Number(out.price) || 0
  if (out.sale_price !== undefined && out.sale_price !== '') out.sale_price = Number(out.sale_price)
  if (out.sale_price === '') out.sale_price = null
  if (out.stock_quantity !== undefined) out.stock_quantity = Number(out.stock_quantity) || 0
  return out
}