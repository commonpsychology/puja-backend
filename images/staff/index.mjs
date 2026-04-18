// src/index.mjs
import 'dotenv/config'

import express      from 'express'
import helmet       from 'helmet'
import cors         from 'cors'
import cookieParser from 'cookie-parser'
import rateLimit    from 'express-rate-limit'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

import otpRoutes from './routes/otpRoutes.mjs'

import path from 'path'
import { fileURLToPath } from 'url'

const errorHandler        = require('./middleware/errorHandler')
const volunteerRoutes     = require('./routes/volunteerRoutes')
const authRoutes          = require('./routes/auth')
const profileRoutes       = require('./routes/profile')
const therapistsRoutes    = require('./routes/therapists')
const therapistPortal     = require('./routes/therapistRoutes')
const appointmentsRoutes  = require('./routes/appointments')
const paymentsRoutes      = require('./routes/payments')
const notificationsRoutes = require('./routes/notifications')
const contactRoutes       = require('./routes/contact')
const pollsRoutes         = require('./routes/polls')
const reviewsRoutes       = require('./routes/reviewsRoutes')
const psychRoute          = require('./routes/psychRoute')
const newsRoutes          = require('./routes/newsRoutes')   // ✅ ADDED — was missing, caused all /api/news/* 404s
const blogRoutes          = require('./routes/blogRoute')
const researchRoutes      = require('./routes/researchRoute')
const resourcesRoutes     = require('./routes/resourcesRoute')
const galleryRoutes       = require('./routes/galleryRoute')
const communityRoutes     = require('./routes/communityRoute')
const roomBookingsRoutes  = require('./routes/roomBookings')
const adminRoutes         = require('./routes/admin')
const storeRoutes         = require('./routes/store')
const wellnessRoutes      = require('./routes/wellness')

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

const app  = express()
const PORT = process.env.PORT || 5000

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))
app.set('trust proxy', 1)
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}))
app.use(express.json({ limit: '10kb' }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use('/images', express.static(path.join(__dirname, 'images')))

app.use(rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Slow down.' },
}))

app.get('/health', (req, res) => res.json({
  status: 'ok', service: 'Puja Samargi API',
  version: '2.1.0', timestamp: new Date().toISOString(),
}))

app.use('/api/auth',             authRoutes)
app.use('/api/profile',          profileRoutes)
app.use('/api/therapists',       therapistsRoutes)
app.use('/api/therapist-portal', therapistPortal)
app.use('/api/appointments',     appointmentsRoutes)
app.use('/api/payments',         paymentsRoutes)
app.use('/api/notifications',    notificationsRoutes)
app.use('/api/contact',          contactRoutes)
app.use('/api/reviews',          reviewsRoutes)
app.use('/api/volunteer',        volunteerRoutes)
app.use('/api/polls',            pollsRoutes)
app.use('/api/images',           require('./routes/images'))
app.use('/api/psych',            psychRoute)
app.use('/api/otp',              otpRoutes)
app.use('/api/news',             newsRoutes)             // ✅ ADDED — GET /api/news, /api/news/meta, /api/news/:slug, POST /api/news/subscribe
app.use('/api/blog',             blogRoutes)
app.use('/api/research',         researchRoutes)
app.use('/api/resources',        resourcesRoutes)
app.use('/api/gallery',          galleryRoutes)
app.use('/api/community',        communityRoutes)
app.use('/api/room-bookings',    roomBookingsRoutes)
app.use('/api/admin',            adminRoutes)
app.use('/api',                  storeRoutes)
app.use('/api',                  wellnessRoutes)

app.use((req, res) =>
  res.status(404).json({ success: false, message: `${req.method} ${req.path} not found.` })
)
app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`\n🚀  Puja Samargi API v2.1 — port ${PORT}`)
  console.log(`   Mode    : ${process.env.NODE_ENV || 'development'}`)
  console.log(`   Health  : http://localhost:${PORT}/health\n`)
})

export default app
