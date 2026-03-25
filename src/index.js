require('dotenv').config()

const express      = require('express')
const helmet       = require('helmet')
const cors         = require('cors')
const cookieParser = require('cookie-parser')
const rateLimit    = require('express-rate-limit')

const errorHandler    = require('./middleware/errorHandler')
const therapistRoutes = require('./routes/therapistRoutes')

const app  = express()
const PORT = process.env.PORT || 5000

// ── Security ──────────────────────────────────────────────────
app.use(helmet())
app.set('trust proxy', 1)

// ── CORS ──────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// ── Parsers ───────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// ── Global rate limit ─────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Slow down.' },
}))

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok', service: 'Puja Samargi API',
  version: '2.0.0', timestamp: new Date().toISOString(),
}))

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',              require('./routes/auth'))
app.use('/api/profile',           require('./routes/profile'))
app.use('/api/therapists',        require('./routes/therapists'))
app.use('/api/therapist-portal',  therapistRoutes)          // ← therapist dashboard
app.use('/api/appointments',      require('./routes/appointments'))
app.use('/api',                   require('./routes/store'))       // /api/products, /api/cart, /api/orders
app.use('/api/payments',          require('./routes/payments'))
app.use('/api',                   require('./routes/wellness'))    // /api/assessments, /api/mood, /api/journal
app.use('/api/notifications',     require('./routes/notifications'))
app.use('/api/admin',             require('./routes/admin'))
app.use('/api/contact',           require('./routes/contact'))
app.use('/api/polls',             require('./routes/polls'))
app.use('/api/reviews',           require('./routes/reviews'))
app.use('/api/community', require('./routes/communityRoute'))
// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) =>
  res.status(404).json({ success: false, message: `${req.method} ${req.path} not found.` })
)

// ── Error handler (must be last) ─────────────────────────────
app.use(errorHandler)

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  Puja Samargi API v2 — port ${PORT}`)
  console.log(`   Mode    : ${process.env.NODE_ENV || 'development'}`)
  console.log(`   Health  : http://localhost:${PORT}/health\n`)
})

module.exports = app