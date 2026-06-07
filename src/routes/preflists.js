import express from 'express'
import { supabase } from '../lib/supabase.js'
import { authMiddleware, requireRole, requirePermission } from '../middleware/auth.js'
import { uploadSingle } from '../middleware/upload.js'
import { extractFromPDF } from '../services/pdfExtract.js'
import { extractFromExcel, generateExcelFromEntries } from '../services/excelParse.js'
import { generatePrefListPDF } from '../services/pdfExport.js'

const router = express.Router()
router.use(authMiddleware)

// GET /api/preflists/student/:studentId
router.get('/student/:studentId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pref_lists')
      .select('*')
      .eq('student_id', req.params.studentId)
      .order('version', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/preflists/student/:studentId/active
router.get('/student/:studentId/active', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pref_lists')
      .select('*')
      .eq('student_id', req.params.studentId)
      .eq('is_published', true)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    if (error) return res.status(404).json({ list: null })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/preflists/admin/all
router.get('/admin/all', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pref_lists')
      .select(`*, student:students(member_id, user:users!students_user_id_fkey(name))`)
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/preflists/student/:studentId/upload
router.post('/student/:studentId/upload', requireRole('counselor', 'admin'), requirePermission('pref_list_manage'), (req, res, next) => {
  uploadSingle(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message })
    next()
  })
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const ext = req.file.originalname.split('.').pop().toLowerCase()
    const filePath = `${req.params.studentId}/v_${Date.now()}.${ext}`

    const { error: storageErr } = await supabase.storage
      .from('pref-lists')
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype })

    if (storageErr) return res.status(400).json({ error: storageErr.message })

    const { data: { publicUrl } } = supabase.storage
      .from('pref-lists').getPublicUrl(filePath)

    let result
    const sourceType = ext === 'pdf' ? 'pdf_upload' : ext === 'csv' ? 'csv_upload' : 'excel_upload'

    if (ext === 'pdf') {
      result = await extractFromPDF(req.file.buffer)
    } else {
      result = extractFromExcel(req.file.buffer)
    }

    res.json({
      entries: result.entries,
      rawText: result.rawText || '',
      fileName: req.file.originalname,
      fileUrl: publicUrl,
      filePath,
      sourceType,
      confidence: result.confidence || 'high'
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/preflists/student/:studentId
router.post('/student/:studentId', requireRole('counselor', 'admin'), requirePermission('pref_list_manage'), async (req, res) => {
  try {
    const { entries, source_type, file_name, file_url, raw_text, notes } = req.body

    // Get current version
    const { count } = await supabase
      .from('pref_lists')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', req.params.studentId)

    const version = (count || 0) + 1

    const { data, error } = await supabase
      .from('pref_lists')
      .insert({
        student_id: req.params.studentId,
        version,
        entries: entries || [],
        source_type,
        file_name,
        file_url,
        raw_text,
        notes,
        uploaded_by: req.user.member_id,
        is_published: false,
        is_locked: false
      })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/preflists/:id
router.put('/:id', requireRole('counselor', 'admin'), requirePermission('pref_list_manage'), async (req, res) => {
  try {
    const { entries, notes } = req.body
    const { data, error } = await supabase
      .from('pref_lists')
      .update({ entries, notes })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/preflists/:id/publish
router.put('/:id/publish', requireRole('counselor', 'admin'), requirePermission('pref_list_manage'), async (req, res) => {
  try {
    const { data: list, error } = await supabase
      .from('pref_lists')
      .update({ is_published: true, published_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    const { data: student } = await supabase
      .from('students')
      .select('user_id, member_id')
      .eq('id', list.student_id)
      .single()

    if (student) {
      await supabase.from('notifications').insert({
        user_id: student.user_id,
        member_id: student.member_id,
        type: 'preflist',
        title: 'Preference List Published',
        message: `Your counselor published Preference List v${list.version} with ${list.entries?.length || 0} colleges`,
        link: '/student/pref-list'
      })
    }

    await supabase.from('activity_log').insert({
      student_id: list.student_id,
      actor_id: req.user.member_id,
      actor_role: req.user.role,
      action: 'PREF_PUBLISH',
      details: { version: list.version, entries_count: list.entries?.length }
    })

    res.json(list)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/preflists/:id/lock
router.put('/:id/lock', requireRole('counselor', 'admin'), async (req, res) => {
  try {
    const { data: current } = await supabase
      .from('pref_lists').select('is_locked').eq('id', req.params.id).single()

    const { data, error } = await supabase
      .from('pref_lists')
      .update({ is_locked: !current.is_locked })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/preflists/:id/student-reorder
router.put('/:id/student-reorder', requireRole('student'), async (req, res) => {
  try {
    const { order } = req.body

    const { data: list } = await supabase
      .from('pref_lists').select('is_locked, student_id').eq('id', req.params.id).single()

    if (list?.is_locked) return res.status(403).json({ error: 'List is locked' })

    const { data, error } = await supabase
      .from('pref_lists')
      .update({ student_order: order, student_reordered_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    // Notify counselor
    const { data: student } = await supabase
      .from('students').select('counselor_id, member_id').eq('id', list.student_id).single()
    if (student?.counselor_id) {
      const { data: cUser } = await supabase
        .from('users').select('id, member_id').eq('id', student.counselor_id).single()
      if (cUser) {
        await supabase.from('notifications').insert({
          user_id: cUser.id,
          member_id: cUser.member_id,
          type: 'preflist',
          title: 'Student Reordered List',
          message: `Student ${student.member_id} reordered their preference list`,
          link: '/counselor/pref-lists'
        })
      }
    }

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/preflists/:id/export/pdf
router.get('/:id/export/pdf', async (req, res) => {
  try {
    const { data: list } = await supabase
      .from('pref_lists').select('*').eq('id', req.params.id).single()
    const { data: student } = await supabase
      .from('students')
      .select('*, user:users!students_user_id_fkey(name, member_id)')
      .eq('id', list.student_id)
      .single()

    const pdfBuffer = generatePrefListPDF(student, list)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="pref_list_${student.member_id}_v${list.version}.pdf"`)
    res.send(pdfBuffer)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/preflists/:id/export/excel
router.get('/:id/export/excel', async (req, res) => {
  try {
    const { data: list } = await supabase
      .from('pref_lists').select('*').eq('id', req.params.id).single()
    const { data: student } = await supabase
      .from('students').select('*, user:users!students_user_id_fkey(name)').eq('id', list.student_id).single()

    const entries = list.student_order?.length ? list.student_order : list.entries
    const excelBuffer = generateExcelFromEntries(entries, student)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="pref_list_${student.member_id}_v${list.version}.xlsx"`)
    res.send(excelBuffer)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
