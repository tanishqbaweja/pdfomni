export default function ToolUploadPlaceholder() {
  return (
    <div className="dropzone tool-upload-placeholder" aria-busy="true" aria-label="Preparing file upload">
      <div className="dropzone-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="dropzone-title">Drop your file here</div>
      <div className="dropzone-subtitle">or click to browse</div>
      <div className="dropzone-subtitle" style={{ fontSize: '0.75rem' }}>Files are processed privately in your browser</div>
    </div>
  )
}
