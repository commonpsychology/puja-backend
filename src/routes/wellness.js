const express = require('express')
const { authenticate } = require('../middleware/auth')
const {
  listAssessments,
  getAssessment,
  submitAssessment,
  getMyAssessmentResults,
  getMoodLogs,
  addMoodLog,
  getJournalEntries,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  getHabits,
  createHabit,
  logHabit,
} = require('./controllers/wellnessController')

const router = express.Router()

// ── Assessments ───────────────────────────────────────────────
router.get('/assessments',              listAssessments)
router.get('/assessments/:id',          getAssessment)
router.post('/assessments/:id/submit',  authenticate, submitAssessment)
router.get('/assessments/results/me',   authenticate, getMyAssessmentResults)

// ── Mood ──────────────────────────────────────────────────────
router.get('/mood',    authenticate, getMoodLogs)
router.post('/mood',   authenticate, addMoodLog)

// ── Journal ───────────────────────────────────────────────────
router.get('/journal',       authenticate, getJournalEntries)
router.post('/journal',      authenticate, createJournalEntry)
router.put('/journal/:id',   authenticate, updateJournalEntry)
router.delete('/journal/:id',authenticate, deleteJournalEntry)

// ── Habits ────────────────────────────────────────────────────
router.get('/habits',          authenticate, getHabits)
router.post('/habits',         authenticate, createHabit)
router.post('/habits/:id/log', authenticate, logHabit)

module.exports = router