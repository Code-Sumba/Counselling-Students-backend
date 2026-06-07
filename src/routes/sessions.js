import express from 'express'
import { supabase } from '../lib/supabase.js'
import { authMiddleware, requireRole, requirePermission } from '../middleware/auth.js'

const router = express.Router()
router.use(authMiddleware)

// GET /api/sessions/student/:studentId
router.get('/student/:studentId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('*, counselor:users!sessions_counselor_id_fkey(name, member_id)')
      .eq('student_id', req.params.studentId)
      .order('date', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/sessions/counselor/mine
router.get('/counselor/mine', requireRole('counselor'), async (req, res) => {
  try {
    const { data: students } = await supabase
      .from('students').select('id').eq('counselor_id', req.user.id)

    const studentIds = students?.map(s => s.id) || []

    const { data, error } = await supabase
      .from('sessions')
      .select('*, student:students(member_id, user:users!students_user_id_fkey(name, phone))')
      .in('student_id', studentIds)
      .order('date', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/sessions/admin/all
router.get('/admin/all', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select(`*,
        student:students(member_id, user:users!students_user_id_fkey(name)),
        counselor:users!sessions_counselor_id_fkey(name, member_id)`)
      .order('date', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/sessions
router.post('/', requireRole('student'), async (req, res) => {
  try {
    const { type, date, time, note } = req.body

    const { data: myStudent } = await supabase
      .from('students').select('id, counselor_id, member_id')
      .eq('user_id', req.user.id).single()

    if (!myStudent) return res.status(404).json({ error: 'Student profile not found' })

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        student_id: myStudent.id,
        counselor_id: myStudent.counselor_id,
        type,
        date,
        time,
        note,
        status: 'Pending',
        booked_by: req.user.member_id
      })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    if (myStudent.counselor_id) {
      const { data: cUser } = await supabase
        .from('users').select('id, member_id').eq('id', myStudent.counselor_id).single()
      if (cUser) {
        await supabase.from('notifications').insert({
          user_id: cUser.id,
          member_id: cUser.member_id,
          type: 'session',
          title: 'Session Booking Request',
          message: `${req.user.name} requested a ${type} session on ${date} at ${time}`,
          link: '/counselor/sessions'
        })
      }
    }

    await supabase.from('activity_log').insert({
      student_id: myStudent.id,
      actor_id: req.user.member_id,
      actor_role: req.user.role,
      action: 'SESSION_BOOKED',
      details: { type, date, time }
    })

    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/sessions/:id/status
router.put('/:id/status', requireRole('counselor', 'admin'), requirePermission('sessions_manage'), async (req, res) => {
  try {
    const { status, meet_link } = req.body
    const updates = { status }
    if (meet_link !== undefined) updates.meet_link = meet_link || null

    const { data, error } = await supabase
      .from('sessions')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    // Notify student
    const { data: student } = await supabase
      .from('students').select('user_id, member_id').eq('id', data.student_id).single()
    if (student) {
      const meetNote = data.meet_link && status === 'Confirmed' ? ' A Google Meet link has been added.' : ''
      await supabase.from('notifications').insert({
        user_id: student.user_id,
        member_id: student.member_id,
        type: 'session',
        title: `Session ${status}`,
        message: `Your session on ${data.date} at ${data.time} has been ${status.toLowerCase()}.${meetNote}`,
        link: '/student/sessions'
      })
    }

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/sessions/:id/outcome
router.put('/:id/outcome', requireRole('counselor', 'admin'), requirePermission('sessions_manage'), async (req, res) => {
  try {
    const { outcome, outcome_note, recording_link } = req.body
    const updates = { outcome, outcome_note, status: 'Completed' }
    if (recording_link !== undefined) updates.recording_link = recording_link || null

    const { data, error } = await supabase
      .from('sessions')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/sessions/:id/rating
router.put('/:id/rating', requireRole('student'), async (req, res) => {
  try {
    const { rating, rating_note } = req.body
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ error: 'Rating must be 1-5' })

    const { data, error } = await supabase
      .from('sessions')
      .update({ rating, rating_note })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
