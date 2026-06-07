import express from 'express'
import { supabase } from '../lib/supabase.js'
import { authMiddleware, requireRole, requirePermission } from '../middleware/auth.js'
import { generateStudentId } from '../services/memberIdGen.js'
import { generateSetupToken, sendSetupEmail } from '../services/email.js'

const router = express.Router()
router.use(authMiddleware)

const DEFAULT_DOCS = [
  { doc_type: 'ssc', label: 'SSC Marksheet (10th)', required: true },
  { doc_type: 'hssc', label: 'HSSC Marksheet (12th)', required: true },
  { doc_type: 'cet_hall', label: 'CET Hall Ticket', required: true },
  { doc_type: 'cet_score', label: 'CET Score Card', required: true },
  { doc_type: 'domicile', label: 'Domicile Certificate', required: true },
  { doc_type: 'caste', label: 'Caste Certificate', required: false },
  { doc_type: 'ncl', label: 'Non-Creamy Layer (NCL) Certificate', required: false },
  { doc_type: 'income', label: 'Income Certificate', required: false },
  { doc_type: 'aadhar', label: 'Aadhar Card', required: true },
  { doc_type: 'photo', label: 'Passport Size Photo', required: true },
  { doc_type: 'leaving', label: 'School Leaving Certificate', required: true },
]

// GET /api/students
router.get('/', async (req, res) => {
  try {
    let query = supabase
      .from('students')
      .select(`*, user:users!students_user_id_fkey(id, name, email, phone, member_id, role, is_active),
               counselor:users!students_counselor_id_fkey(id, name, member_id, email, phone)`)
      .order('created_at', { ascending: false })

    if (req.user.role === 'counselor') {
      query = query.eq('counselor_id', req.user.id)
    }
    if (req.user.role === 'student') {
      query = query.eq('user_id', req.user.id)
    }

    const { stage, status, category, payment_status, search } = req.query
    if (stage !== undefined) query = query.eq('stage', parseInt(stage))
    if (status) query = query.eq('status', status)
    if (category) query = query.eq('category', category)
    if (payment_status) query = query.eq('payment_status', payment_status)

    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })

    let students = data
    if (search) {
      const s = search.toLowerCase()
      students = students.filter(st =>
        st.user?.name?.toLowerCase().includes(s) ||
        st.member_id?.toLowerCase().includes(s) ||
        st.user?.phone?.includes(s)
      )
    }

    res.json(students)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/students
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, email, phone, category, percentile, cet_score, hssc_marks,
      branch_preference, city, counselor_id, payment_status, payment_amount,
      dob, address, parent_name, parent_phone } = req.body

    if (!name || !email) return res.status(400).json({ error: 'Name and email required' })

    const member_id = await generateStudentId(supabase)

    // Create Supabase auth user
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      password: `Temp${Math.random().toString(36).slice(2)}!`
    })
    if (authErr) return res.status(400).json({ error: authErr.message })

    // Insert into users table
    const { error: userErr } = await supabase.from('users').insert({
      id: authUser.user.id,
      member_id,
      name,
      email,
      phone,
      role: 'student',
      password_set: false,
      is_active: true
    })
    if (userErr) {
      await supabase.auth.admin.deleteUser(authUser.user.id)
      return res.status(400).json({ error: userErr.message })
    }

    // Insert into students table
    const { data: student, error: studentErr } = await supabase.from('students').insert({
      user_id: authUser.user.id,
      member_id,
      cet_score: cet_score || null,
      percentile: percentile || null,
      hssc_marks: hssc_marks || null,
      category: category || null,
      branch_preference: branch_preference || null,
      city: city || null,
      dob: dob || null,
      address: address || null,
      parent_name: parent_name || null,
      parent_phone: parent_phone || null,
      counselor_id: counselor_id || null,
      payment_status: payment_status || 'Pending',
      payment_amount: payment_amount || 0
    }).select().single()

    if (studentErr) {
      await supabase.auth.admin.deleteUser(authUser.user.id)
      await supabase.from('users').delete().eq('id', authUser.user.id)
      return res.status(400).json({ error: studentErr.message })
    }

    // Insert default document rows
    await supabase.from('documents').insert(
      DEFAULT_DOCS.map(d => ({ ...d, student_id: student.id, status: 'Pending' }))
    )

    // Send setup email
    const token = generateSetupToken(email, member_id)
    try {
      await sendSetupEmail(name, email, member_id, token)
    } catch (emailErr) {
      console.error('Email send failed:', emailErr.message)
    }

    // Log activity
    await supabase.from('activity_log').insert({
      student_id: student.id,
      actor_id: req.user.member_id,
      actor_role: req.user.role,
      action: 'STUDENT_CREATED',
      details: { member_id, name, email }
    })

    res.status(201).json({ student, setup_token: token })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/students/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('students')
      .select(`*, user:users!students_user_id_fkey(id, name, email, phone, member_id),
               counselor:users!students_counselor_id_fkey(id, name, member_id, email, phone)`)
      .eq('id', req.params.id)
      .single()

    if (error) return res.status(404).json({ error: 'Student not found' })

    if (req.user.role === 'student') {
      const { data: myStudent } = await supabase
        .from('students').select('id').eq('user_id', req.user.id).single()
      if (!myStudent || myStudent.id !== req.params.id)
        return res.status(403).json({ error: 'Forbidden' })
    }

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/students/:id
router.put('/:id', async (req, res) => {
  try {
    const allowed = ['cet_score', 'percentile', 'hssc_marks', 'jee_score', 'dob', 'category',
      'domicile', 'caste', 'annual_income', 'address', 'city', 'parent_name',
      'parent_phone', 'parent_occupation', 'branch_preference', 'status', 'custom_stages']
    const updates = {}
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k]
    }

    const { data, error } = await supabase
      .from('students')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    // Also update users table if name/phone provided
    const userUpdates = {}
    if (req.body.name) userUpdates.name = req.body.name
    if (req.body.phone) userUpdates.phone = req.body.phone
    if (Object.keys(userUpdates).length) {
      await supabase.from('users').update(userUpdates).eq('id', data.user_id)
    }

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/students/:id/stage
router.put('/:id/stage', requireRole('counselor', 'admin'), requirePermission('stage_update'), async (req, res) => {
  try {
    const { stage } = req.body
    if (stage === undefined || stage < 0 || stage > 5)
      return res.status(400).json({ error: 'Stage must be 0-5' })

    const { data, error } = await supabase
      .from('students')
      .update({ stage })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    // Notify student
    const { data: user } = await supabase
      .from('users').select('id, member_id').eq('id', data.user_id).single()

    const stageLabels = ['Registration', 'Documents', 'Pref List', 'CAP Round 1', 'Seat Acceptance', 'Admitted']
    await supabase.from('notifications').insert({
      user_id: user.id,
      member_id: user.member_id,
      type: 'system',
      title: 'Stage Updated',
      message: `Your counseling stage has been updated to: ${stageLabels[stage] || stage}`,
      link: '/student/home'
    })

    await supabase.from('activity_log').insert({
      student_id: req.params.id,
      actor_id: req.user.member_id,
      actor_role: req.user.role,
      action: 'STAGE_UPDATE',
      details: { stage, label: stageLabels[stage] }
    })

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/students/:id/counselor
router.put('/:id/counselor', requireRole('admin'), async (req, res) => {
  try {
    const { counselor_id } = req.body
    const { data, error } = await supabase
      .from('students')
      .update({ counselor_id })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/students/:id/payment
router.put('/:id/payment', requireRole('admin'), async (req, res) => {
  try {
    const { payment_status, payment_amount, payment_date } = req.body
    const { data, error } = await supabase
      .from('students')
      .update({ payment_status, payment_amount, payment_date: payment_date || new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    await supabase.from('activity_log').insert({
      student_id: req.params.id,
      actor_id: req.user.member_id,
      actor_role: req.user.role,
      action: 'PAYMENT_UPDATE',
      details: { payment_status, payment_amount }
    })

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/students/:id/stats
router.get('/:id/stats', async (req, res) => {
  try {
    const [{ count: docsDone }, { count: docsTotal }, { count: sessions }, { data: lists }] =
      await Promise.all([
        supabase.from('documents').select('*', { count: 'exact', head: true })
          .eq('student_id', req.params.id).eq('status', 'Verified'),
        supabase.from('documents').select('*', { count: 'exact', head: true })
          .eq('student_id', req.params.id),
        supabase.from('sessions').select('*', { count: 'exact', head: true })
          .eq('student_id', req.params.id),
        supabase.from('pref_lists').select('version').eq('student_id', req.params.id)
          .order('version', { ascending: false }).limit(1)
      ])

    res.json({
      docs_done: docsDone || 0,
      docs_total: docsTotal || 0,
      sessions_count: sessions || 0,
      list_version: lists?.[0]?.version || 0
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
