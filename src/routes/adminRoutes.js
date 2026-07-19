
const express = require('express')
const router  = express.Router()
const { authenticate, requireRole } = require('../middleware/auth')
const adminNews = require('../controllers/adminNewsController')

const c = require('./controllers/adminController')

const guard = [authenticate, requireRole(['admin', 'staff'])]

// ─── Dashboard ──────────────────────────────────────────────
router.get('/dashboard', guard, c.getDashboard)

// ─── Staff registration ──────────────────────────────────────
router.post('/register-staff', guard, c.registerStaff)

// ─── Users ───────────────────────────────────────────────────
router.get   ('/users',                   guard, c.getUsers)
router.patch ('/users/:id/toggle-active', guard, c.toggleUserActive)
router.patch ('/users/:id/status',        guard, c.setUserStatus)
router.patch ('/users/:id/role',          guard, c.setUserRole)

// ─── Appointments ────────────────────────────────────────────
router.get   ('/appointments',            guard, c.getAllAppointments)
router.patch ('/appointments/:id/status', guard, c.setAppointmentStatus)
router.put   ('/appointments/:id',        guard, c.setAppointmentStatus)

// ─── Orders ──────────────────────────────────────────────────
router.get   ('/orders',            guard, c.getAllOrders)
router.patch ('/orders/:id/status', guard, c.setOrderStatus)
router.put   ('/orders/:id',        guard, c.setOrderStatus)


router.get   ('/news',                   guard, adminNews.listNews)
router.post  ('/news',                   guard, adminNews.createNews)
router.put   ('/news/:id',               guard, adminNews.updateNews)
router.delete('/news/:id',               guard, adminNews.deleteNews)

// ─── News Categories (admin) ─────────────────────────────────
router.get   ('/news-categories',        guard, adminNews.listCategoriesAdmin)
router.post  ('/news-categories',        guard, adminNews.createCategory)
router.put   ('/news-categories/:id',    guard, adminNews.updateCategory)
router.delete('/news-categories/:id',    guard, adminNews.deleteCategory)

// ─── Newsletter Subscribers (admin) ──────────────────────────
router.get   ('/newsletter-subscribers',        guard, adminNews.listSubscribers)
router.delete('/newsletter-subscribers/:id',    guard, adminNews.deleteSubscriber)

// ─── Payments ────────────────────────────────────────────────
router.get  ('/payments',      guard, c.getPayments)
router.put  ('/payments/:id',  guard, c.updatePaymentStatus)
router.patch('/payments/:id',  guard, c.updatePaymentStatus)

// ─── Notifications ───────────────────────────────────────────
router.post('/notifications', guard, c.sendNotificationToClient)

// ─── SMS ──────────────────────────────────────────────────────
router.get ('/sms/templates',  guard, c.getSmsTemplates)
router.get ('/sms/recipients', guard, c.getSmsRecipients)
router.post('/sms/send',       guard, c.sendAdminSms)
router.get ('/sms/logs',       guard, c.getSmsLogs)

// ─── Products ────────────────────────────────────────────────
router.get   ('/products',     guard, c.getProducts)
router.post  ('/products',     guard, c.createProduct)
router.put   ('/products/:id', guard, c.updateProduct)
router.delete('/products/:id', guard, c.deleteProduct)

// ─── Blog Posts ───────────────────────────────────────────────
router.get   ('/posts',     guard, c.getPosts)
router.post  ('/posts',     guard, c.createPost)
router.put   ('/posts/:id', guard, c.updatePost)
router.delete('/posts/:id', guard, c.deletePost)



// ─── Resources ───────────────────────────────────────────────
router.get   ('/resources',     guard, c.getResources)
router.post  ('/resources',     guard, c.createResource)
router.put   ('/resources/:id', guard, c.updateResource)
router.delete('/resources/:id', guard, c.deleteResource)

// ─── Gallery ─────────────────────────────────────────────────
router.get   ('/gallery',     guard, c.getGallery)
router.post  ('/gallery',     guard, c.createGalleryItem)
router.put   ('/gallery/:id', guard, c.updateGalleryItem)
router.delete('/gallery/:id', guard, c.deleteGalleryItem)

// ─── Research Papers ─────────────────────────────────────────
router.get   ('/research',     guard, c.getResearch)
router.post  ('/research',     guard, c.createResearch)
router.put   ('/research/:id', guard, c.updateResearch)
router.delete('/research/:id', guard, c.deleteResearch)

// ─── Psych Videos ────────────────────────────────────────────
router.get   ('/psych-videos',     guard, c.getPsychVideos)
router.post  ('/psych-videos',     guard, c.createPsychVideo)
router.put   ('/psych-videos/:id', guard, c.updatePsychVideo)
router.delete('/psych-videos/:id', guard, c.deletePsychVideo)

// ─── Psych Analyses ──────────────────────────────────────────
router.get   ('/psych-analyses',     guard, c.getPsychAnalyses)
router.post  ('/psych-analyses',     guard, c.createPsychAnalysis)
router.put   ('/psych-analyses/:id', guard, c.updatePsychAnalysis)
router.delete('/psych-analyses/:id', guard, c.deletePsychAnalysis)

// ─── Psych Concepts ───────────────────────────────────────────
router.get   ('/psych-concepts',     guard, c.getPsychConcepts)
router.post  ('/psych-concepts',     guard, c.createPsychConcept)
router.put   ('/psych-concepts/:id', guard, c.updatePsychConcept)
router.delete('/psych-concepts/:id', guard, c.deletePsychConcept)

// ─── Courses ─────────────────────────────────────────────────
router.get   ('/courses',     guard, c.getCourses)
router.post  ('/courses',     guard, c.createCourse)
router.put   ('/courses/:id', guard, c.updateCourse)
router.delete('/courses/:id', guard, c.deleteCourse)

// ─── Assessments ─────────────────────────────────────────────
router.get   ('/assessments',     guard, c.getAssessments)
router.post  ('/assessments',     guard, c.createAssessment)
router.put   ('/assessments/:id', guard, c.updateAssessment)
router.delete('/assessments/:id', guard, c.deleteAssessment)

// ─── Community Groups (simple CRUD) ──────────────────────────
router.get   ('/community-groups',     guard, c.getCommunityGroups)
router.post  ('/community-groups',     guard, c.createCommunityGroup)
router.put   ('/community-groups/:id', guard, c.updateCommunityGroup)
router.delete('/community-groups/:id', guard, c.deleteCommunityGroup)

// ─── Community Admin — Groups with member count ───────────────
router.get('/community-groups-admin', guard, c.adminGetCommunityGroups)

// ─── Community Admin — Sessions ──────────────────────────────
router.get   ('/group-sessions',     guard, c.adminGetSessions)
router.post  ('/group-sessions',     guard, c.adminCreateSessionFull)
router.put   ('/group-sessions/:id', guard, c.adminUpdateSession)
router.delete('/group-sessions/:id', guard, c.adminDeleteSession)

// ─── Community Admin — Reservations ──────────────────────────
router.get   ('/group-reservations',     guard, c.adminGetReservations)
router.put   ('/group-reservations/:id', guard, c.adminUpdateReservation)
router.delete('/group-reservations/:id', guard, c.adminDeleteReservation)

// ─── Community Admin — Memberships ───────────────────────────
router.get('/group-memberships', guard, c.adminGetMemberships)

// ─── Therapists ───────────────────────────────────────────────
router.get   ('/therapists',     guard, c.getTherapists)
router.post  ('/therapists',     guard, c.createTherapist)
router.put   ('/therapists/:id', guard, c.updateTherapist)
router.delete('/therapists/:id', guard, c.deleteTherapist)

// ─── FAQs ────────────────────────────────────────────────────
router.get   ('/faqs',     guard, c.getFaqs)
router.post  ('/faqs',     guard, c.createFaq)
router.put   ('/faqs/:id', guard, c.updateFaq)
router.delete('/faqs/:id', guard, c.deleteFaq)

// ─── Coupons ─────────────────────────────────────────────────
router.get   ('/coupons',     guard, c.getCoupons)
router.post  ('/coupons',     guard, c.createCoupon)
router.put   ('/coupons/:id', guard, c.updateCoupon)
router.delete('/coupons/:id', guard, c.deleteCoupon)

// ─── Contact Messages ────────────────────────────────────────
router.get   ('/contacts',     guard, c.getContacts)
router.put   ('/contacts/:id', guard, c.updateContact)
router.delete('/contacts/:id', guard, c.deleteContact)

// ─── Subscriptions ───────────────────────────────────────────
router.get('/subscriptions',     guard, c.getSubscriptions)
router.put('/subscriptions/:id', guard, c.updateSubscription)

// ─── Site Settings ───────────────────────────────────────────
router.get('/settings',     guard, c.getSettings)
router.put('/settings/:id', guard, c.updateSetting)

module.exports = router