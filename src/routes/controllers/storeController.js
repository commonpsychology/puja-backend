// controllers/storeController.js
// Uses Supabase client created with the SERVICE ROLE key (bypasses RLS).
// Assumes an `authenticate` middleware sets req.user = { id, role }.

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
// ---------- GET /api/store/categories ----------
exports.getCategories = async (req, res) => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (error) return res.status(500).json({ message: error.message })
  res.json({ categories: data })
}

// ---------- GET /api/store/products ----------
exports.getProducts = async (req, res) => {
  try {
    const page  = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Number(req.query.limit) || 12)
    const from  = (page - 1) * limit
    const to    = from + limit - 1

    let query = supabase
      .from('products')
      .select('*', { count: 'exact' })
      .eq('is_active', true)

    if (req.query.category) query = query.eq('category_id', req.query.category)
    if (req.query.q) {
      query = query.or(`name.ilike.%${req.query.q}%,short_description.ilike.%${req.query.q}%`)
    }

    query = query.order('sort_order', { ascending: true }).order('created_at', { ascending: false }).range(from, to)

    const { data, error, count } = await query
    if (error) throw error

    res.json({ products: data || [], pagination: { total: count || 0, page, limit } })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
}

// ---------- GET /api/store/products/:id ----------
exports.getProductDetail = async (req, res) => {
  try {
    const { id } = req.params
    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single()
    if (error || !product) return res.status(404).json({ message: 'Product not found' })

    const { data: reviews } = await supabase
      .from('product_reviews')
      .select('id, author_name, rating, comment, created_at')
      .eq('product_id', id)
      .eq('is_approved', true)
      .order('created_at', { ascending: false })
      .limit(30)

    res.json({ product: { ...product, reviews: reviews || [] } })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
}

// ---------- POST /api/store/products/:id/reviews ----------
exports.addReview = async (req, res) => {
  try {
    const { id } = req.params
    const { rating, comment, author_name } = req.body
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ message: 'Rating 1-5 required' })

    const { error } = await supabase.from('product_reviews').insert({
      product_id: id,
      user_id: req.user.id,
      author_name: author_name || 'Anonymous',
      rating,
      comment: comment || null,
    })
    if (error) throw error
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
}

// ---------- CART ----------
exports.getCart = async (req, res) => {
  const { data, error } = await supabase
    .from('cart_items')
    .select('id, quantity, product_id, variant_id, products(id, name, price, sale_price, stock_quantity, is_digital, images, image_url)')
    .eq('user_id', req.user.id)
  if (error) return res.status(500).json({ message: error.message })

  const cart = (data || []).map(row => ({
    product_id: row.product_id,
    quantity: row.quantity,
    products: {
      ...row.products,
      images: row.products?.images?.length ? row.products.images : (row.products?.image_url ? [row.products.image_url] : []),
    },
  }))
  res.json({ cart })
}

exports.addToCart = async (req, res) => {
  try {
    const { productId, variantId = null, quantity = 1 } = req.body
let existingQuery = supabase
      .from('cart_items').select('id, quantity')
      .eq('user_id', req.user.id).eq('product_id', productId)
    existingQuery = variantId
      ? existingQuery.eq('variant_id', variantId)
      : existingQuery.is('variant_id', null)
    const { data: existing } = await existingQuery.maybeSingle()

    if (existing) {
      const { error } = await supabase.from('cart_items')
        .update({ quantity: existing.quantity + quantity }).eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('cart_items')
        .insert({ user_id: req.user.id, product_id: productId, variant_id: variantId, quantity })
      if (error) throw error
    }
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
}

exports.updateCartItem = async (req, res) => {
  const { productId } = req.params
  const { quantity } = req.body
  const { error } = await supabase.from('cart_items')
    .update({ quantity }).eq('user_id', req.user.id).eq('product_id', productId)
  if (error) return res.status(500).json({ message: error.message })
  res.json({ success: true })
}

exports.removeCartItem = async (req, res) => {
  const { productId } = req.params
  const { error } = await supabase.from('cart_items')
    .delete().eq('user_id', req.user.id).eq('product_id', productId)
  if (error) return res.status(500).json({ message: error.message })
  res.json({ success: true })
}

exports.clearCart = async (req, res) => {
  const { error } = await supabase.from('cart_items').delete().eq('user_id', req.user.id)
  if (error) return res.status(500).json({ message: error.message })
  res.json({ success: true })
}

// ---------- POST /api/store/orders ----------
// Body: { location: { full_name, phone, address_line, city, landmark, notes,
//                      latitude, longitude, formatted_address } }
// Creates the order (client_id, shipping_address jsonb + geo columns via
// trigger) + snapshot order_items, all in one call. Cart quantities/prices
// are re-read server-side so nothing is trusted from the client.
exports.createOrder = async (req, res) => {
  try {
    const { location } = req.body
    if (!location || location.latitude == null || location.longitude == null) {
      return res.status(400).json({ message: 'Please drop a pin on the map for delivery.' })
    }
    if (!location.full_name?.trim() || !location.phone?.trim()) {
      return res.status(400).json({ message: 'Full name and phone are required.' })
    }

    const { data: cartRows, error: cartErr } = await supabase
      .from('cart_items')
      .select('quantity, variant_id, products(id, name, price, sale_price, stock_quantity, is_digital)')
      .eq('user_id', req.user.id)
    if (cartErr) throw cartErr
    if (!cartRows || cartRows.length === 0) return res.status(400).json({ message: 'Cart is empty.' })

    for (const row of cartRows) {
      const p = row.products
      if (!p.is_digital && p.stock_quantity < row.quantity) {
        return res.status(400).json({ message: `${p.name} is out of stock.` })
      }
    }

    const subtotal = cartRows.reduce((s, row) => {
      const price = row.products.sale_price ?? row.products.price ?? 0
      return s + price * row.quantity
    }, 0)

    const shippingAddress = {
      full_name: location.full_name,
      phone: location.phone,
      address_line: location.address_line || null,
      city: location.city || null,
      landmark: location.landmark || null,
      notes: location.notes || null,
      latitude: location.latitude,
      longitude: location.longitude,
      formatted_address: location.formatted_address || null,
    }

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        client_id: req.user.id,
        status: 'pending',
        subtotal,
        discount_amount: 0,
        tax_amount: 0,
        shipping_amount: 0,
        total_amount: subtotal,
        shipping_address: shippingAddress,
        delivery_address: location.address_line || location.formatted_address || null,
      })
      .select().single()
    if (orderErr) throw orderErr

    const itemRows = cartRows.map(row => {
      const unit = row.products.sale_price ?? row.products.price ?? 0
      return {
        order_id: order.id,
        product_id: row.products.id,
        variant_id: row.variant_id || null,
        quantity: row.quantity,
        unit_price: unit,
        total_price: unit * row.quantity,
      }
    })
    const { error: itemsErr } = await supabase.from('order_items').insert(itemRows)
    if (itemsErr) throw itemsErr

    res.json({ order })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
}