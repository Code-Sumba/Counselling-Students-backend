import * as XLSX from 'xlsx'

export function extractFromExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  if (rows.length < 2) throw new Error('Excel file appears empty')

  const headers = rows[0].map(h => String(h || '').toLowerCase().trim())
  const colMap = {
    rank: headers.findIndex(h => h.includes('rank') || h.includes('sr') || h === 'no' || h === '#'),
    collegeName: headers.findIndex(h => h.includes('college') || h.includes('institute') || h.includes('name')),
    branch: headers.findIndex(h => h.includes('branch') || h.includes('course')),
    type: headers.findIndex(h => h.includes('type') || h.includes('category')),
    city: headers.findIndex(h => h.includes('city') || h.includes('district') || h.includes('location')),
    cutoff: headers.findIndex(h => h.includes('cutoff') || h.includes('percentile') || h.includes('closing')),
  }

  if (colMap.collegeName < 0) throw new Error('Could not find college name column')

  const entries = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !row[colMap.collegeName]) continue

    entries.push({
      id: `entry_${i}_${Date.now()}`,
      rank: colMap.rank >= 0 ? parseInt(row[colMap.rank]) || i : i,
      college_name: String(row[colMap.collegeName] || '').trim(),
      branch: colMap.branch >= 0 ? String(row[colMap.branch] || '').trim() : '',
      type: colMap.type >= 0 ? String(row[colMap.type] || 'Unaided').trim() : 'Unaided',
      city: colMap.city >= 0 ? String(row[colMap.city] || '').trim() : '',
      cutoff: colMap.cutoff >= 0 ? parseFloat(row[colMap.cutoff]) || null : null,
      zone: '',
      confidence: 'high'
    })
  }

  return { entries, rawText: '', totalRows: entries.length }
}

export function generateExcelFromEntries(entries, student) {
  const wb = XLSX.utils.book_new()

  const header = [['#', 'College Name', 'Branch', 'Type', 'City', 'Last Cutoff (%ile)']]
  const dataRows = entries.map((e, i) => [
    i + 1,
    e.college_name,
    e.branch || '',
    e.type || '',
    e.city || '',
    e.cutoff || ''
  ])

  const ws = XLSX.utils.aoa_to_sheet([...header, ...dataRows])
  ws['!cols'] = [{ wch: 5 }, { wch: 50 }, { wch: 35 }, { wch: 20 }, { wch: 15 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Preference List')

  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
}
