export default function ProgressBar({ progress = 0, message = '', showPercentage = true }) {
  const boundedProgress = Math.min(100, Math.max(0, progress))

  return (
    <div
      style={{ width: '100%' }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(boundedProgress)}
      aria-label={message || 'PDF processing progress'}
    >
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '8px',
        fontSize: 'var(--text-sm)',
      }}>
        <span style={{ color: 'var(--color-text-secondary)' }}>{message}</span>
        {showPercentage && (
          <span style={{ 
            color: 'var(--color-accent)',
            fontWeight: 600,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
          }}>
            {Math.round(boundedProgress)}%
          </span>
        )}
      </div>
      <div className="progress-bar">
        <div 
          className="progress-bar-fill" 
          style={{ width: `${boundedProgress}%` }}
        />
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {message ? `${message} ` : ''}{Math.round(boundedProgress)}%
      </span>
    </div>
  )
}
