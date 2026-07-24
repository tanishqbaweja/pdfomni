import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Send, Key, Sparkles, SquarePen, Upload, FileText, Loader2, Copy, Check, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { extractAllText } from '../../engine/pdfRenderer'
import { MAX_FILE_SIZE_MB, MAX_FILE_SIZE_BYTES, readFileAsArrayBuffer } from '../../utils/fileHelpers'
import Modal from '../Common/Modal'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { ingestPdfPagesLocally, retrieveLocalContext, updateLocalMemory } from '../../ai/localCopilot'

const FALLBACK_FREE_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
]
const DEFAULT_CHAT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free'

function formatRagProgress(progress) {
  if (!progress) return 'Indexing PDF...'

  if (progress.phase === 'reading') return `Reading PDF (${progress.current}/${progress.total})...`
  if (progress.phase === 'chunking') return `Preparing text (${progress.current}/${progress.total})...`
  if (progress.phase === 'embedding') return `Building AI index (${progress.current}/${progress.total})...`
  if (progress.phase === 'download') return `Downloading AI model (${progress.pct}%)...`
  if (progress.message) return progress.message
  return 'Indexing PDF...'
}

function estimateTokens(text = '') {
  return Math.ceil(text.length / 4)
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString()
}

export default function ChatSidebar() {
  const {
    chatOpen,
    setChatOpen,
    apiKey,
    setApiKey,
    chatModel,
    setChatModel,
    chatMessages,
    addChatMessage,
    updateChatMessage,
    deleteChatMessage,
    clearChat,
    addToast,
  } = useAppStore()

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [chatDocs, setChatDocs] = useState([]) // { name, pageCount, useInAi, index }
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [ragProgress, setRagProgress] = useState(null)
  const [showContextModal, setShowContextModal] = useState(false)
  const [lastAiRequest, setLastAiRequest] = useState(null)
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editingValue, setEditingValue] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState(null)

  // Register progress callback to track local AI model loading/download updates
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window._ragProgressCallback = (data) => {
        if (data.status === 'downloading') {
          setRagProgress({
            phase: 'download',
            file: data.file,
            pct: Math.round(data.progress || 0),
          })
        } else if (data.status === 'ready' || data.status === 'done') {
          setRagProgress((prev) => (
            prev?.phase === 'download'
              ? { phase: 'embedding', message: 'Preparing local AI model...' }
              : prev
          ))
        }
      }
    }
    return () => {
      if (typeof window !== 'undefined') {
        window._ragProgressCallback = null
      }
    }
  }, [])
  const [freeModels, setFreeModels] = useState(FALLBACK_FREE_MODELS)
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [localMemory, setLocalMemory] = useState({ turns: [], activeDocs: new Set(), importantSections: new Set() })

  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const modelsLoadedRef = useRef(false)
  const modelsLoadingRef = useRef(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  useEffect(() => {
    if (showKeyModal) {
      setKeyInput(apiKey || '')
    }
  }, [showKeyModal, apiKey])

  const loadFreeModels = useCallback(async () => {
    if (modelsLoadedRef.current || modelsLoadingRef.current) return
    modelsLoadingRef.current = true
    setLoadingModels(true)
    setModelsError('')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`Model list request failed with ${response.status}`)
      }
      const data = await response.json()
      const models = (data?.data || [])
        .filter((model) => {
          const promptCost = Number(model?.pricing?.prompt ?? 1)
          const completionCost = Number(model?.pricing?.completion ?? 1)
          return promptCost === 0 && completionCost === 0 && model?.id?.endsWith(':free')
        })
        .map((model) => model.id)
        .sort((a, b) => a.localeCompare(b))

      const resolvedModels = models.length > 0 ? models : FALLBACK_FREE_MODELS
      setFreeModels(resolvedModels)
      modelsLoadedRef.current = true

      if (!resolvedModels.includes(chatModel)) {
        if (resolvedModels.includes(DEFAULT_CHAT_MODEL)) {
          setChatModel(DEFAULT_CHAT_MODEL)
        } else {
          setChatModel(resolvedModels[0])
        }
      }
    } catch (err) {
      console.error('Free model fetch error:', err)
      setModelsError(err.message)
      setFreeModels((prev) => (prev.length > 0 ? prev : FALLBACK_FREE_MODELS))
      if (!FALLBACK_FREE_MODELS.includes(chatModel)) {
        setChatModel(FALLBACK_FREE_MODELS[0])
      }
      modelsLoadedRef.current = true
    } finally {
      clearTimeout(timeoutId)
      modelsLoadingRef.current = false
      setLoadingModels(false)
    }
  }, [chatModel, setChatModel])

  useEffect(() => {
    if (showKeyModal) {
      loadFreeModels()
    }
  }, [showKeyModal, loadFreeModels])

  const handleDocUpload = useCallback(async (eventOrFiles) => {
    const files = eventOrFiles?.target?.files || eventOrFiles
    if (!files || files.length === 0) return

    setLoadingDoc(true)
    try {
      for (const file of files) {
        if (!file.name?.toLowerCase().endsWith('.pdf')) continue
        if (file.size > MAX_FILE_SIZE_BYTES) {
          addChatMessage({
            role: 'assistant',
            content: `${file.name} is larger than PDFOmni's ${MAX_FILE_SIZE_MB} MB per-file limit.`,
          })
          continue
        }
        setRagProgress({ phase: 'reading', current: 0, total: '?' })
        const bytes = await readFileAsArrayBuffer(file, false)
        const pages = await extractAllText(bytes, (current, total) => {
          setRagProgress({ phase: 'reading', current, total })
        })
        const index = await ingestPdfPagesLocally({
          name: file.name,
          pages,
          onProgress: setRagProgress,
        })
        setChatDocs((prev) => [
          ...prev,
          {
            name: file.name,
            pageCount: pages.length,
            useInAi: true,
            index,
          },
        ])
        if (index.embeddingStatus === 'failed') {
          addToast?.({
            type: 'warning',
            message: `Indexed ${file.name} with lexical retrieval because local AI embeddings failed in this browser.`,
            duration: 7000,
          })
        } else if (index.embeddingStatus === 'partial') {
          addToast?.({
            type: 'info',
            message: `Indexed ${file.name}. Full text is searchable; ${index.embeddedChunkCount}/${index.totalChunkCount} chunks were semantic-indexed for speed.`,
            duration: 7000,
          })
        } else {
          addToast?.({
            type: 'success',
            message: `Indexed ${file.name} for AI chat.`,
          })
        }
      }
    } catch (err) {
      console.error('Doc upload error:', err)
      addToast?.({
        type: 'error',
        message: `Failed to index document: ${err.message}. Please check your browser connection or incognito mode settings.`,
        duration: 7000
      })
    } finally {
      setLoadingDoc(false)
      setRagProgress(null)
      if (eventOrFiles?.target) eventOrFiles.target.value = ''
    }
  }, [addChatMessage, addToast])

  const removeDoc = (index) => {
    setChatDocs((prev) => prev.filter((_, i) => i !== index))
  }

  const toggleDocUsage = (index) => {
    setChatDocs((prev) => prev.map((doc, i) => (
      i === index ? { ...doc, useInAi: !doc.useInAi } : doc
    )))
  }

  const handleSend = async () => {
    if (!input.trim() || loading) return

    if (!apiKey) {
      setShowKeyModal(true)
      return
    }

    const userMsg = input.trim()
    setInput('')
    addChatMessage({ role: 'user', content: userMsg })
    setLoading(true)

    try {
      let context = ''
      let retrieval = { contextText: '', citations: [], debug: { candidates: [], topChunks: [] } }
      if (chatDocs.some((doc) => doc.useInAi)) {
        retrieval = await retrieveLocalContext({
          documents: chatDocs,
          query: userMsg,
          memory: localMemory,
        })
        context = retrieval.contextText
      }

      const systemPrompt = context
        ? `You are PDFOmni AI - a helpful assistant for PDF documents. You help users understand, summarize, and work with their PDF content.

The following locally retrieved evidence was selected on the user's machine:
${context}

Instructions:
- Answer only from the retrieved evidence when the user asks document-specific questions.
- Say clearly when the evidence is missing or insufficient.
- Preserve citations when helpful using the provided source/page labels.
- Use markdown for readability.
- Be concise but helpful.`
        : `You are PDFOmni AI - a helpful assistant for PDF-related tasks.

You can help with:
- general PDF questions
- which PDFOmni tool to use
- uploaded PDF summaries and analysis once the user adds PDFs`

      const recentMessages = chatMessages
        .slice(-20)
        .map((message) => ({ role: message.role, content: message.content }))
      const requestMessages = [
        { role: 'system', content: systemPrompt },
        ...recentMessages,
        { role: 'user', content: userMsg },
      ]
      const promptText = requestMessages.map((message) => message.content).join('\n\n')
      setLastAiRequest({
        query: userMsg,
        model: chatModel || DEFAULT_CHAT_MODEL,
        retrievalMode: retrieval.debug?.mode || (context ? 'hybrid-retrieval' : 'no-document-context'),
        contextText: context,
        contextChars: context.length,
        contextTokenEstimate: estimateTokens(context),
        promptTokenEstimate: estimateTokens(promptText),
        messageCount: requestMessages.length,
        recentMessageCount: recentMessages.length,
        citations: retrieval.citations || [],
        topChunks: retrieval.debug?.topChunks || [],
        candidates: retrieval.debug?.candidates || [],
        queryEmbeddingError: retrieval.debug?.queryEmbeddingError || '',
        messages: requestMessages,
      })

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-OpenRouter-Title': 'PDFOmni',
        },
        body: JSON.stringify({
          model: chatModel || DEFAULT_CHAT_MODEL,
          messages: requestMessages,
          max_tokens: 2048,
        }),
      })

      if (!response.ok) {
        const errBody = await response.text().catch(() => '')
        if (response.status === 401) throw new Error('Invalid API key. Please check your OpenRouter key.')
        if (response.status === 429) {
          throw new Error('Rate limited. Free models can be temporarily unavailable or randomly throttled; try selecting another model in AI Copilot Settings and sending again.')
        }
        throw new Error(`API error ${response.status}: ${errBody.substring(0, 200)}`)
      }

      const data = await response.json()
      const reply = data.choices?.[0]?.message?.content
      if (!reply) throw new Error('Empty response from AI model')
      addChatMessage({ role: 'assistant', content: reply })
      setLocalMemory((prev) => updateLocalMemory(prev, {
        question: userMsg,
        answer: reply,
        citations: retrieval.citations,
      }))
    } catch (err) {
      addChatMessage({
        role: 'assistant',
        content: `**Error:** ${err.message}\n\nTips:\n- Try another free model in AI Copilot Settings; free model availability and rate limits can change quickly.\n- Make sure your OpenRouter API key is valid.\n- Check [OpenRouter status](https://openrouter.ai) for outages.`,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSettings = () => {
    setApiKey(keyInput.trim())
    setShowKeyModal(false)
  }

  const handleNewChat = () => {
    clearChat()
    setLocalMemory({ turns: [], activeDocs: new Set(), importantSections: new Set() })
    setLastAiRequest(null)
    setEditingMessageId(null)
    setEditingValue('')
  }

  const invalidateDerivedChatState = () => {
    setLocalMemory({ turns: [], activeDocs: new Set(), importantSections: new Set() })
    setLastAiRequest(null)
  }

  const handleCopyMessage = async (message) => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopiedMessageId(message.id)
      setTimeout(() => setCopiedMessageId(null), 1200)
    } catch (err) {
      console.error('Copy message failed:', err)
      addToast?.({ type: 'error', message: 'Failed to copy message.' })
    }
  }

  const handleStartEditMessage = (message) => {
    setEditingMessageId(message.id)
    setEditingValue(message.content)
  }

  const handleCancelEditMessage = () => {
    setEditingMessageId(null)
    setEditingValue('')
  }

  const handleSaveEditMessage = (messageId) => {
    const nextContent = editingValue.trim()
    if (!nextContent) {
      addToast?.({ type: 'warning', message: 'Message cannot be empty.' })
      return
    }
    updateChatMessage(messageId, { content: nextContent })
    setEditingMessageId(null)
    setEditingValue('')
    invalidateDerivedChatState()
  }

  const handleDeleteMessage = (messageId) => {
    deleteChatMessage(messageId)
    if (editingMessageId === messageId) handleCancelEditMessage()
    invalidateDerivedChatState()
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    const files = e.dataTransfer?.files
    if (files?.length > 0) handleDocUpload(files)
  }, [handleDocUpload])

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const renderMessage = (message) => {
    if (message.role === 'assistant') {
      try {
        const html = marked.parse(message.content)
        const clean = DOMPurify.sanitize(html)
        return <div dangerouslySetInnerHTML={{ __html: clean }} />
      } catch {
        return <span>{message.content}</span>
      }
    }
    return <span>{message.content}</span>
  }

  return (
    <>
      <aside
        className={`sidebar chat-sidebar ${chatOpen ? 'open' : ''}`}
        id="chat-sidebar"
        aria-label="AI Copilot"
        style={{ display: chatOpen ? 'flex' : 'none' }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Sparkles size={18} style={{ color: 'var(--color-accent)' }} aria-hidden="true" />
            <span style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>AI Copilot</span>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => setShowContextModal(true)}
              title="View Last AI Context"
              aria-label="View last AI context"
              id="chat-context-btn"
              disabled={!lastAiRequest}
            >
              <FileText size={14} aria-hidden="true" />
            </button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowKeyModal(true)} title="AI Copilot Settings" aria-label="AI Copilot settings" id="chat-key-btn"><Key size={14} aria-hidden="true" /></button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={handleNewChat} title="New Chat" aria-label="Start a new chat" id="chat-clear-btn"><SquarePen size={14} aria-hidden="true" /></button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setChatOpen(false)} aria-label="Close chat" id="chat-close-btn"><X size={16} aria-hidden="true" /></button>
          </div>
        </div>

        <div
          style={{
            padding: 'var(--space-2) var(--space-3)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            flexWrap: 'wrap',
            background: 'var(--color-surface)',
          }}
        >
          <input ref={fileInputRef} type="file" accept=".pdf" multiple onChange={handleDocUpload} style={{ display: 'none' }} id="chat-doc-input" />
          <button className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()} disabled={loadingDoc} id="chat-upload-btn" style={{ fontSize: 'var(--text-xs)', padding: '4px 8px' }}>
            {loadingDoc ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {loadingDoc ? formatRagProgress(ragProgress) : 'Add PDF'}
          </button>
          {chatDocs.map((doc, index) => (
            <div
              key={`${doc.name}-${index}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                background: doc.useInAi ? 'var(--color-accent-dim)' : 'var(--color-surface-hover)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-primary)',
                maxWidth: 240,
              }}
            >
              <FileText size={10} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flexShrink: 0 }}>
                <input
                  type="checkbox"
                  checked={doc.useInAi}
                  onChange={() => toggleDocUsage(index)}
                  id={`chat-doc-use-${index}`}
                />
                <span>Use in AI</span>
              </label>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</span>
              <button aria-label={`Remove ${doc.name}`} onClick={() => removeDoc(index)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1 }}>
                <X size={10} aria-hidden="true" />
              </button>
            </div>
          ))}
          {chatDocs.length === 0 && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Upload PDFs to start chatting with local document context
            </span>
          )}
        </div>

        <div className="chat-messages">
          {chatMessages.length === 0 && (
            <div className="chat-empty-state">
              <div className="chat-empty-copy">
                <Sparkles size={28} style={{ margin: '0 auto var(--space-3)', opacity: 0.4 }} />
                <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)', fontWeight: 500 }}>
                  PDFOmni Copilot
                </p>
                <p style={{ fontSize: 'var(--text-xs)', lineHeight: 1.5, maxWidth: 260, margin: '0 auto' }}>
                  Upload PDFs into the sidebar to ask questions, summarize content, or compare documents.
                </p>
              </div>
            </div>
          )}
          {chatMessages.map((message) => (
            <div key={message.id} className={`chat-message-shell ${message.role}`}>
              {editingMessageId === message.id ? (
                <div className={`chat-message ${message.role} editing`}>
                  <textarea
                    className="chat-message-editor"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSaveEditMessage(message.id)
                      if (e.key === 'Escape') handleCancelEditMessage()
                    }}
                    autoFocus
                  />
                </div>
              ) : (
                <div className={`chat-message ${message.role}`}>
                  {renderMessage(message)}
                  {message.editedAt && <span className="chat-message-edited">edited</span>}
                </div>
              )}
              <div className="chat-message-actions">
                {editingMessageId === message.id ? (
                  <>
                    <button className="chat-message-action" onClick={() => handleSaveEditMessage(message.id)} title="Save edit" aria-label="Save edit">
                      <Check size={12} />
                    </button>
                    <button className="chat-message-action" onClick={handleCancelEditMessage} title="Cancel edit" aria-label="Cancel edit">
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <button className="chat-message-action" onClick={() => handleCopyMessage(message)} title="Copy message" aria-label="Copy message">
                      {copiedMessageId === message.id ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                    <button className="chat-message-action" onClick={() => handleStartEditMessage(message)} title="Edit message" aria-label="Edit message">
                      <SquarePen size={12} />
                    </button>
                    <button className="chat-message-action danger" onClick={() => handleDeleteMessage(message.id)} title="Delete message" aria-label="Delete message">
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="chat-message assistant" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <div className="spinner" style={{ width: 14, height: 14 }} />
              <span style={{ fontSize: 'var(--text-sm)' }}>Thinking...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area">
          <input
            className="input chat-input"
            aria-label="Chat message"
            placeholder={apiKey ? (chatDocs.some((doc) => doc.useInAi) ? 'Ask about your PDFs...' : 'Ask anything about PDFs...') : 'Set API key first...'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            disabled={loading}
            id="chat-input"
          />
          <button className="btn btn-primary btn-icon" onClick={handleSend} disabled={loading || !input.trim()} id="chat-send" aria-label="Send message">
            <Send size={16} />
          </button>
        </div>
      </aside>

      <Modal
        isOpen={showKeyModal}
        onClose={() => setShowKeyModal(false)}
        title="OpenRouter API Key & Model"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setShowKeyModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveSettings} id="chat-settings-save">Save Settings</button>
          </>
        )}
      >
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)', lineHeight: 'var(--leading-relaxed)' }}>
          Configure your AI model and OpenRouter API key. Everything is stored locally in your browser.
        </p>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)', lineHeight: 'var(--leading-relaxed)' }}>
          Get a free OpenRouter key: <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>openrouter.ai/keys</a>
        </p>

        <div className="input-group" style={{ marginBottom: 'var(--space-4)' }}>
          <label className="input-label" htmlFor="api-key-input">OpenRouter API Key</label>
          <input
            className="input"
            type="password"
            placeholder="sk-or-v1-..."
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveSettings()}
            id="api-key-input"
            style={{ width: '100%' }}
          />
        </div>

        <div className="input-group" style={{ marginBottom: 'var(--space-2)' }}>
          <label className="input-label" htmlFor="api-model-select">AI Completion Model</label>
          <select
            className="select"
            value={chatModel || DEFAULT_CHAT_MODEL}
            onChange={(e) => setChatModel(e.target.value)}
            id="api-model-select"
            style={{ width: '100%' }}
            disabled={loadingModels}
          >
            {freeModels.map((modelId) => (
              <option key={modelId} value={modelId}>
                {modelId.replace(/:free$/i, '')}
              </option>
            ))}
          </select>
          {loadingModels && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Querying OpenRouter for models...
            </div>
          )}
          {!loadingModels && modelsError && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Could not refresh the live model list: {modelsError}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={showContextModal}
        onClose={() => setShowContextModal(false)}
        title="Last AI Context"
        maxWidth={760}
        footer={(
          <button className="btn btn-secondary" onClick={() => setShowContextModal(false)}>Close</button>
        )}
      >
        {lastAiRequest ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-3)' }}>
              <div className="rag-debug-stat">
                <span>Mode</span>
                <strong>{lastAiRequest.retrievalMode}</strong>
              </div>
              <div className="rag-debug-stat">
                <span>Model</span>
                <strong>{lastAiRequest.model}</strong>
              </div>
              <div className="rag-debug-stat">
                <span>Context Estimate</span>
                <strong>{formatNumber(lastAiRequest.contextTokenEstimate)} tokens</strong>
              </div>
              <div className="rag-debug-stat">
                <span>Total Prompt Estimate</span>
                <strong>{formatNumber(lastAiRequest.promptTokenEstimate)} tokens</strong>
              </div>
              <div className="rag-debug-stat">
                <span>Context Size</span>
                <strong>{formatNumber(lastAiRequest.contextChars)} chars</strong>
              </div>
              <div className="rag-debug-stat">
                <span>Messages Sent</span>
                <strong>{lastAiRequest.messageCount} ({lastAiRequest.recentMessageCount} history)</strong>
              </div>
            </div>

            <div>
              <div className="input-label" style={{ marginBottom: 'var(--space-2)' }}>Query</div>
              <pre className="rag-debug-code">{lastAiRequest.query}</pre>
            </div>

            {lastAiRequest.queryEmbeddingError && (
              <div className="rag-debug-warning">
                Query embedding failed, so retrieval used lexical and metadata scoring: {lastAiRequest.queryEmbeddingError}
              </div>
            )}

            <div>
              <div className="input-label" style={{ marginBottom: 'var(--space-2)' }}>
                Chunks Sent ({lastAiRequest.citations.length})
              </div>
              {lastAiRequest.citations.length > 0 ? (
                <div className="rag-debug-list">
                  {lastAiRequest.citations.map((citation) => (
                    <div key={citation.chunkId} className="rag-debug-row">
                      <strong>{citation.sourcePdf}</strong>
                      <span>page {citation.pageNumber} - {citation.section}</span>
                      <code>{citation.chunkId}</code>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                  No document chunks were sent for this request.
                </div>
              )}
            </div>

            {lastAiRequest.candidates.length > 0 && (
              <details>
                <summary className="rag-debug-summary">Candidate scores</summary>
                <div className="rag-debug-list" style={{ marginTop: 'var(--space-2)' }}>
                  {lastAiRequest.candidates.slice(0, 12).map((candidate) => (
                    <div key={candidate.chunkId} className="rag-debug-row">
                      <code>{candidate.chunkId}</code>
                      <span>
                        score {candidate.score?.toFixed?.(3) ?? candidate.score} - dense {candidate.dense?.toFixed?.(3) ?? candidate.dense} - sparse {candidate.sparse?.toFixed?.(3) ?? candidate.sparse}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <details open>
              <summary className="rag-debug-summary">Exact retrieved context sent</summary>
              <pre className="rag-debug-code rag-debug-context">{lastAiRequest.contextText || 'No document context was sent.'}</pre>
            </details>

            <details>
              <summary className="rag-debug-summary">Full messages payload</summary>
              <pre className="rag-debug-code rag-debug-context">
                {JSON.stringify(lastAiRequest.messages, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            Send a message first, then the exact retrieved context and prompt estimate will appear here.
          </p>
        )}
      </Modal>
    </>
  )
}
