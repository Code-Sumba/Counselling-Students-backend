import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export function generatePrefListPDF(student, prefList) {
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4' })
  const entries = prefList.student_order?.length ? prefList.student_order : prefList.entries

  // Header bar
  doc.setFillColor(26, 31, 54)
  doc.rect(0, 0, 210, 28, 'F')

  doc.setTextColor(255, 107, 53)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('MindzSpark', 14, 12)
  doc.setTextColor(200, 210, 230)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Excellence is our Identity', 14, 20)

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('MHT-CET CAP Preference List', 196, 12, { align: 'right' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Version ${prefList.version}`, 196, 20, { align: 'right' })

  // Student info box
  doc.setFillColor(249, 250, 251)
  doc.rect(0, 28, 210, 24, 'F')
  doc.setTextColor(26, 31, 54)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(student.user?.name || student.member_id, 14, 37)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Member ID: ${student.member_id}`, 14, 44)
  doc.text(
    `Category: ${student.category || '—'}   |   Percentile: ${student.percentile || '—'}%ile   |   Branch: ${student.branch_preference || 'All'}`,
    60, 44
  )
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 196, 37, { align: 'right' })
  doc.text(`By: ${prefList.uploaded_by}`, 196, 44, { align: 'right' })

  autoTable(doc, {
    startY: 56,
    head: [['#', 'College Name', 'Branch', 'Type', 'City', 'Cutoff']],
    body: entries.map((e, i) => [
      i + 1,
      e.college_name,
      e.branch || '—',
      e.type || '—',
      e.city || '—',
      e.cutoff ? `${e.cutoff}%ile` : '—'
    ]),
    headStyles: { fillColor: [26, 31, 54], textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 70 },
      2: { cellWidth: 45 },
      3: { cellWidth: 25 },
      4: { cellWidth: 22 },
      5: { cellWidth: 20, halign: 'right' }
    },
    didDrawCell: (data) => {
      if (data.row.index < 3 && data.section === 'body' && data.column.index === 0) {
        doc.setFillColor(255, 107, 53)
        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(8)
        doc.text(String(data.row.index + 1), data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2 + 2, { align: 'center' })
      }
    },
    margin: { top: 56, left: 14, right: 14 }
  })

  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFillColor(26, 31, 54)
    doc.rect(0, 285, 210, 12, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(7)
    doc.text('MindzSpark Counseling | mindzspark.in | Excellence is our Identity', 14, 292)
    doc.text(`Page ${i} of ${pageCount}`, 196, 292, { align: 'right' })

    // Watermark
    doc.setTextColor(220, 220, 220)
    doc.setFontSize(50)
    doc.setFont('helvetica', 'bold')
    doc.text('MindzSpark', 35, 190, { angle: 45 })
  }

  return Buffer.from(doc.output('arraybuffer'))
}
