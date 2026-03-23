/* eslint-disable no-undef */
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Assessments ───────────────────────────────────────────────

// GET /api/assessments
const listAssessments = async (req, res) => {
  const { data, error } = await supabase
    .from('assessments')
    .select('id, title, slug, description, type, is_free')
    .eq('is_active', true)
    .order('created_at')

  if (error) return res.status(500).json({ success: false, message: 'Could not fetch assessments.' })
  return res.status(200).json({ success: true, assessments: data })
}

// GET /api/assessments/:id
const getAssessment = async (req, res) => {
  const { data, error } = await supabase
    .from('assessments')
    .select('*')
    .or(`id.eq.${req.params.id},slug.eq.${req.params.id}`)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data) return res.status(404).json({ success: false, message: 'Assessment not found.' })
  return res.status(200).json({ success: true, assessment: data })
}

// POST /api/assessments/:id/submit
const submitAssessment = async (req, res) => {
  const { answers } = req.body

  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ success: false, message: 'answers object is required.' })
  }

  const { data: assessment } = await supabase
    .from('assessments')
    .select('id, scoring')
    .eq('id', req.params.id)
    .maybeSingle()

  if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found.' })

  const totalScore = Object.values(answers).reduce((sum, val) => sum + Number(val), 0)

  let resultLabel    = 'Result unavailable'
  let recommendation = ''

  if (Array.isArray(assessment.scoring)) {
    const match = assessment.scoring.find(
      (s) => totalScore >= s.range[0] && totalScore <= s.range[1]
    )
    if (match) {
      resultLabel    = match.label
      recommendation = match.recommendation
    }
  }

  const { data: result, error } = await supabase
    .from('assessment_results')
    .insert({
      assessment_id: assessment.id,
      user_id:       req.user.sub,
      answers,
      total_score:   totalScore,
      result_label:  resultLabel,
      result_detail: '',
      recommendation,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ success: false, message: 'Could not save result.' })
  return res.status(201).json({ success: true, result })
}

// GET /api/assessments/results/me
const getMyAssessmentResults = async (req, res) => {
  const { data, error } = await supabase
    .from('assessment_results')
    .select('*, assessments:assessment_id(title, type)')
    .eq('user_id', req.user.sub)
    .order('taken_at', { ascending: false })

  if (error) return res.status(500).json({ success: false, message: 'Could not fetch results.' })
  return res.status(200).json({ success: true, results: data })
}

// ── Mood ──────────────────────────────────────────────────────

// GET /api/mood
const getMoodLogs = async (req, res) => {
  const { from, to, limit = 30 } = req.query

  let query = supabase
    .from('mood_logs')
    .select('*')
    .eq('user_id', req.user.sub)
    .order('logged_at', { ascending: false })
    .limit(Number(limit))

  if (from) query = query.gte('logged_at', from)
  if (to)   query = query.lte('logged_at', to)

  const { data, error } = await query

  if (error) return res.status(500).json({ success: false, message: 'Could not fetch mood logs.' })
  return res.status(200).json({ success: true, logs: data })
}

// POST /api/mood
const addMoodLog = async (req, res) => {
  const { moodScore, emotions = [], notes, activities = [], sleepHours } = req.body

  if (!moodScore || moodScore < 1 || moodScore > 10) {
    return res.status(400).json({ success: false, message: 'moodScore must be between 1 and 10.' })
  }

  const { data, error } = await supabase
    .from('mood_logs')
    .insert({
      user_id:     req.user.sub,
      mood_score:  moodScore,
      emotions,
      notes:       notes || null,
      activities,
      sleep_hours: sleepHours || null,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ success: false, message: 'Could not save mood log.' })
  return res.status(201).json({ success: true, log: data })
}

// ── Journal ───────────────────────────────────────────────────

// GET /api/journal
const getJournalEntries = async (req, res) => {
  const { page = 1, limit = 10 } = req.query
  const offset = (page - 1) * limit

  const { data, error, count } = await supabase
    .from('journal_entries')
    .select('id, title, mood_score, tags, is_private, created_at', { count: 'exact' })
    .eq('user_id', req.user.sub)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return res.status(500).json({ success: false, message: 'Could not fetch journal.' })
  return res.status(200).json({
    success: true,
    entries: data,
    pagination: { page: Number(page), limit: Number(limit), total: count },
  })
}

// POST /api/journal
const createJournalEntry = async (req, res) => {
  const { title, content, moodScore, tags = [], isPrivate = true, promptUsed } = req.body

  if (!content) return res.status(400).json({ success: false, message: 'content is required.' })

  const { data, error } = await supabase
    .from('journal_entries')
    .insert({
      user_id:     req.user.sub,
      title:       title || null,
      content,
      mood_score:  moodScore || null,
      tags,
      is_private:  isPrivate,
      prompt_used: promptUsed || null,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ success: false, message: 'Could not create journal entry.' })
  return res.status(201).json({ success: true, entry: data })
}

// PUT /api/journal/:id
const updateJournalEntry = async (req, res) => {
  const { title, content, moodScore, tags, isPrivate } = req.body

  const updates = {}
  if (title     !== undefined) updates.title      = title
  if (content   !== undefined) updates.content    = content
  if (moodScore !== undefined) updates.mood_score = moodScore
  if (tags      !== undefined) updates.tags       = tags
  if (isPrivate !== undefined) updates.is_private = isPrivate

  const { data, error } = await supabase
    .from('journal_entries')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user.sub)
    .select()
    .single()

  if (error || !data) return res.status(404).json({ success: false, message: 'Journal entry not found.' })
  return res.status(200).json({ success: true, entry: data })
}

// DELETE /api/journal/:id
const deleteJournalEntry = async (req, res) => {
  const { error } = await supabase
    .from('journal_entries')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.sub)

  if (error) return res.status(500).json({ success: false, message: 'Could not delete entry.' })
  return res.status(200).json({ success: true, message: 'Journal entry deleted.' })
}

// ── Habits ────────────────────────────────────────────────────

// GET /api/habits
const getHabits = async (req, res) => {
  const { data, error } = await supabase
    .from('habit_trackers')
    .select('*, habit_logs(id, logged_at, notes)')
    .eq('user_id', req.user.sub)
    .eq('is_active', true)
    .order('created_at')

  if (error) return res.status(500).json({ success: false, message: 'Could not fetch habits.' })
  return res.status(200).json({ success: true, habits: data })
}

// POST /api/habits
const createHabit = async (req, res) => {
  const { habitName, frequency = 'daily', goal = 1 } = req.body

  if (!habitName) return res.status(400).json({ success: false, message: 'habitName is required.' })

  const { data, error } = await supabase
    .from('habit_trackers')
    .insert({ user_id: req.user.sub, habit_name: habitName, frequency, goal })
    .select()
    .single()

  if (error) return res.status(500).json({ success: false, message: 'Could not create habit.' })
  return res.status(201).json({ success: true, habit: data })
}

// POST /api/habits/:id/log
const logHabit = async (req, res) => {
  const { notes } = req.body

  const { data: habit } = await supabase
    .from('habit_trackers')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', req.user.sub)
    .maybeSingle()

  if (!habit) return res.status(404).json({ success: false, message: 'Habit not found.' })

  const { data, error } = await supabase
    .from('habit_logs')
    .insert({ habit_id: req.params.id, user_id: req.user.sub, notes: notes || null })
    .select()
    .single()

  if (error) return res.status(500).json({ success: false, message: 'Could not log habit.' })
  return res.status(201).json({ success: true, log: data })
}

module.exports = {
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
}