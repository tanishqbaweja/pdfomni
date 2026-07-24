import { useCallback, useState, useRef } from 'react'
import { Upload } from 'lucide-react'

export default function FileDropZone({
  onFiles,
  accept = '.pdf',
  multiple = true,
  label = 'Drop your PDF files here',
  sublabel = 'or click to browse',
  maxFiles = 50,
  maxFileSizeMb = 500,
  id = 'file-dropzone'
}) {
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024

  const handleFiles = useCallback((fileList) => {
    const incoming = Array.from(fileList).slice(0, maxFiles)
    const oversized = incoming.filter((file) => file.size > maxFileSizeBytes)
    const files = incoming.filter((file) => file.size <= maxFileSizeBytes)
    setError(oversized.length ? `${oversized.length} file${oversized.length === 1 ? '' : 's'} exceeded the ${maxFileSizeMb} MB limit.` : '')
    if (files.length > 0) {
      onFiles(files)
    }
  }, [onFiles, maxFiles, maxFileSizeBytes, maxFileSizeMb])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleChange = (e) => {
    handleFiles(e.target.files)
    e.target.value = ''
  }

  return (
    <div
      className={`dropzone ${dragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      id={id}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleClick()
        }
      }}
      aria-label={label}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        style={{ display: 'none' }}
        id={`${id}-input`}
        aria-label={label}
      />
      <div className="dropzone-icon">
        <Upload size={28} aria-hidden="true" />
      </div>
      <div className="dropzone-title">{label}</div>
      <div className="dropzone-subtitle">{sublabel}</div>
      <div className="dropzone-subtitle" style={{ fontSize: '0.75rem' }}>
        {accept === '.pdf' ? 'PDF files only' : `Accepted: ${accept}`} - Max {maxFiles} files - {maxFileSizeMb} MB each
      </div>
      {error && <div className="dropzone-error" id={`${id}-error`} role="alert">{error}</div>}
    </div>
  )
}
