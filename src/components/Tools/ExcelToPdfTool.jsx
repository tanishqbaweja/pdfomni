import { useState, useCallback } from 'react'
import { Download, Trash2, Table } from 'lucide-react'
import FileDropZone from '../Common/FileDropZone'
import ProgressBar from '../Common/ProgressBar'
import { useAppStore } from '../../store/appStore'
import { readFileAsArrayBuffer, formatFileSize } from '../../utils/fileHelpers'
import { downloadBlob } from '../../utils/download'

export default function ExcelToPdfTool({ toolId, tool }) {
  const [file, setFile] = useState(null)
  const [workbook, setWorkbook] = useState(null)
  const [xlsxApi, setXlsxApi] = useState(null)
  const [sheetNames, setSheetNames] = useState([])
  const [processing, setProcessing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const addToast = useAppStore((s) => s.addToast)

  const handleFiles = useCallback(async (files) => {
    const f = files[0]
    if (!f) return
    const ext = f.name.split('.').pop().toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      addToast({ type: 'error', message: 'Please upload an Excel (.xlsx, .xls) or CSV file.' })
      return
    }
    setLoading(true)
    setProgress(0)
    setProgressMsg('Reading spreadsheet...')
    try {
      const bytes = await readFileAsArrayBuffer(f)
      setProgress(40)
      setProgressMsg('Parsing data...')

      const XLSX = await import('xlsx')
      const wb = XLSX.read(bytes, { type: 'array' })
      setXlsxApi(XLSX)
      setWorkbook(wb)
      setSheetNames(wb.SheetNames)
      setFile(f)

      setProgress(100)
      setProgressMsg('Ready!')
      addToast({ type: 'success', message: `Loaded ${wb.SheetNames.length} sheet${wb.SheetNames.length !== 1 ? 's' : ''}!` })
    } catch (err) {
      console.error('Excel load error:', err)
      addToast({ type: 'error', message: `Failed to load file: ${err.message}` })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  const handleConvert = useCallback(async () => {
    if (!workbook || !xlsxApi) return
    setProcessing(true)
    setProgress(0)
    setProgressMsg('Creating selectable spreadsheet PDF...')
    try {
      setProgress(70)
      const { workbookToSelectablePdfBytes } = await import('../../utils/textPdf')
      const pdfBytes = workbookToSelectablePdfBytes(
        workbook,
        sheetNames,
        (sheet) => xlsxApi.utils.sheet_to_json(sheet, { header: 1, raw: false }),
      )
      setProgress(90)
      setProgressMsg('Downloading PDF...')
      const pdfName = file ? file.name.replace(/\.(xlsx|xls|csv)$/i, '.pdf') : 'spreadsheet.pdf'
      downloadBlob(pdfBytes, pdfName)

      setProgress(100)
      setProgressMsg('Done!')
      addToast({ type: 'success', message: 'PDF created successfully!' })
    } catch (err) {
      console.error('Conversion error:', err)
      addToast({ type: 'error', message: `Conversion failed: ${err.message}` })
    } finally {
      setProcessing(false)
    }
  }, [workbook, xlsxApi, sheetNames, file, addToast])

  const handleReset = useCallback(() => {
    setFile(null)
    setWorkbook(null)
    setXlsxApi(null)
    setSheetNames([])
  }, [])

  return (
    <div className="animate-fade-in-up" id="excel-to-pdf-tool">
      {!file ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {loading && <ProgressBar progress={progress} message={progressMsg} />}
          <FileDropZone
            onFiles={handleFiles}
            accept=".xlsx,.xls,.csv"
            multiple={false}
            label="Drop your spreadsheet here"
            sublabel="or click to browse (.xlsx, .xls, or .csv)"
            id="excel-to-pdf-dropzone"
            maxFiles={1}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* File info & sheet tabs */}
          <div className="card" style={{ padding: 'var(--space-4) var(--space-5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: sheetNames.length > 1 ? 'var(--space-3)' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <Table size={20} style={{ color: 'var(--color-accent)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{file.name}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {formatFileSize(file.size)} • {sheetNames.length} sheet{sheetNames.length !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={handleReset} disabled={processing} id="excel2pdf-reset">
                <Trash2 size={14} />
                New file
              </button>
            </div>
          </div>

          {/* Progress */}
          {processing && <ProgressBar progress={progress} message={progressMsg} />}

          {/* Action */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-3)' }}>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleConvert}
              disabled={processing || !workbook}
              id="excel2pdf-convert-btn"
            >
              {processing ? (
                <>
                  <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  Converting...
                </>
              ) : (
                <>
                  <Download size={20} />
                  Convert to PDF
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
