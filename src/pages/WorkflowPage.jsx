import { useState, useCallback, useRef, useEffect } from 'react'
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  ConnectionMode,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useAppStore } from '../store/appStore'
import { readFileAsArrayBuffer } from '../utils/fileHelpers'
import { downloadBlob, downloadMultipleAsZip } from '../utils/download'
import * as pdfEngine from '../engine/pdfEngine'
import Seo from '../components/Common/Seo'
import {
  Upload, Scissors, Combine, Minimize2, Stamp, Hash, RotateCw,
  ListFilter, BookOpen, FileText, Download, Eye, Play, Save,
  FolderOpen, Trash2, GripVertical, ChevronDown, ChevronRight,
  Workflow, AlertCircle, CheckCircle2, Loader2, X,
} from 'lucide-react'

// ─── Node Type Definitions ───
const NODE_CATEGORIES = [
  {
    id: 'input',
    label: 'Input',
    nodes: [
      { type: 'fileUpload', label: 'File Upload', icon: Upload, color: '#6366f1' },
    ],
  },
  {
    id: 'process',
    label: 'Process',
    nodes: [
      { type: 'splitPages', label: 'Split Pages', icon: Scissors, color: '#8b5cf6' },
      { type: 'merge', label: 'Merge', icon: Combine, color: '#a855f7' },
      { type: 'compress', label: 'Compress', icon: Minimize2, color: '#c084fc' },
      { type: 'watermark', label: 'Add Watermark', icon: Stamp, color: '#0ea5e9' },
      { type: 'pageNumbers', label: 'Page Numbers', icon: Hash, color: '#e879f9' },
      { type: 'rotate', label: 'Rotate', icon: RotateCw, color: '#d946ef' },
    ],
  },
  {
    id: 'filter',
    label: 'Filter',
    nodes: [
      { type: 'extractOdd', label: 'Extract Odd Pages', icon: ListFilter, color: '#f59e0b' },
      { type: 'extractEven', label: 'Extract Even Pages', icon: BookOpen, color: '#22c55e' },
      { type: 'pageRange', label: 'Page Range', icon: FileText, color: '#14b8a6' },
    ],
  },
  {
    id: 'output',
    label: 'Output',
    nodes: [
      { type: 'download', label: 'Download', icon: Download, color: '#ec4899' },
      { type: 'preview', label: 'Preview', icon: Eye, color: '#06b6d4' },
    ],
  },
]

const ALL_NODE_DEFS = NODE_CATEGORIES.flatMap(c => c.nodes)

// ─── Custom Node Components ───

function BaseNode({ data, id: nodeId, selected, isConnectable }) {
  const def = ALL_NODE_DEFS.find(d => d.type === data.nodeType) || {}
  const Icon = def.icon || FileText
  const color = def.color || '#a855f7'
  const isInput = data.category === 'input'
  const isOutput = data.category === 'output'

  return (
    <div
      id={`wf-node-${nodeId}`}
      style={{
        position: 'relative',
        background: 'var(--color-bg-elevated)',
        border: selected ? `2px solid ${color}` : '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        minWidth: 200,
        boxShadow: selected ? `0 0 20px ${color}33` : 'var(--shadow-md)',
        transition: 'all 150ms ease',
        overflow: 'visible',
      }}
    >
      {/* Input handle */}
      {!isInput && (
        <Handle
          type="target"
          position={Position.Left}
          id="target"
          isConnectable={isConnectable}
          style={{
            width: 18,
            height: 18,
            background: color,
            border: '2px solid var(--color-bg-primary)',
            zIndex: 20,
            pointerEvents: 'all',
            cursor: 'crosshair',
            left: -10,
          }}
        />
      )}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--color-border)',
          background: `${color}10`,
          borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            background: `${color}20`,
            color,
            flexShrink: 0,
          }}
        >
          <Icon size={15} />
        </div>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {data.label}
        </span>
        {data.status === 'running' && <Loader2 size={14} className="animate-spin" style={{ color, marginLeft: 'auto' }} />}
        {data.status === 'done' && <CheckCircle2 size={14} style={{ color: '#22c55e', marginLeft: 'auto' }} />}
        {data.status === 'error' && <AlertCircle size={14} style={{ color: '#ef4444', marginLeft: 'auto' }} />}
      </div>

      {/* Config body */}
      <div style={{ padding: '10px 14px', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
        {data.nodeType === 'fileUpload' && <FileUploadConfig data={data} nodeId={nodeId} />}
        {data.nodeType === 'compress' && <CompressConfig data={data} nodeId={nodeId} />}
        {data.nodeType === 'watermark' && <WatermarkConfig data={data} nodeId={nodeId} />}
        {data.nodeType === 'rotate' && <RotateConfig data={data} nodeId={nodeId} />}
        {data.nodeType === 'pageRange' && <PageRangeConfig data={data} nodeId={nodeId} />}
        {data.nodeType === 'pageNumbers' && <PageNumbersConfig data={data} nodeId={nodeId} />}
        {data.nodeType === 'splitPages' && <SplitConfig data={data} nodeId={nodeId} />}
        {data.nodeType === 'merge' && <div style={{ opacity: 0.7 }}>Merges all inputs into one PDF</div>}
        {data.nodeType === 'extractOdd' && <div style={{ opacity: 0.7 }}>Extracts pages 1, 3, 5…</div>}
        {data.nodeType === 'extractEven' && <div style={{ opacity: 0.7 }}>Extracts pages 2, 4, 6…</div>}
        {data.nodeType === 'download' && <DownloadConfig data={data} nodeId={nodeId} />}
        {data.nodeType === 'preview' && <PreviewConfig data={data} />}
      </div>

      {/* Output handle */}
      {!isOutput && (
        <Handle
          type="source"
          position={Position.Right}
          id="source"
          isConnectable={isConnectable}
          onPointerDownCapture={() => {
            window.__pdfomniWorkflowPendingSource = { nodeId, handleId: 'source' }
          }}
          onMouseDownCapture={() => {
            window.__pdfomniWorkflowPendingSource = { nodeId, handleId: 'source' }
          }}
          style={{
            width: 18,
            height: 18,
            background: color,
            border: '2px solid var(--color-bg-primary)',
            zIndex: 20,
            pointerEvents: 'all',
            cursor: 'crosshair',
            right: -10,
          }}
        />
      )}
    </div>
  )
}

// ─── Config Sub-Components ───

function FileUploadConfig({ data, nodeId }) {
  const inputRef = useRef(null)
  const updateNodeConfig = useAppStore(s => s._wfUpdateNodeConfig)

  const handleFiles = (e) => {
    const files = Array.from(e.target.files)
    if (files.length > 0 && updateNodeConfig) {
      updateNodeConfig(nodeId, { files })
    }
    e.target.value = ''
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        multiple
        onChange={handleFiles}
        style={{ display: 'none' }}
        id={`wf-upload-${nodeId}`}
      />
      <button
        className="btn btn-sm btn-secondary nodrag"
        onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
        style={{ width: '100%', fontSize: 'var(--text-xs)' }}
      >
        <Upload size={12} />
        {data.config?.files?.length ? `${data.config.files.length} file(s)` : 'Choose PDFs'}
      </button>
      {data.config?.files?.map((f, i) => (
        <div key={i} style={{ marginTop: 4, opacity: 0.7, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          📄 {f.name}
        </div>
      ))}
    </div>
  )
}

function CompressConfig({ data, nodeId }) {
  const update = useAppStore(s => s._wfUpdateNodeConfig)
  const quality = data.config?.quality ?? 0.6
  return (
    <div>
      <label style={{ display: 'block', marginBottom: 4 }}>Quality: {Math.round(quality * 100)}%</label>
      <input
        type="range"
        min="0.1"
        max="1"
        step="0.1"
        value={quality}
        onChange={(e) => { e.stopPropagation(); update?.(nodeId, { quality: parseFloat(e.target.value) }) }}
        style={{ width: '100%', accentColor: '#c084fc' }}
        className="nodrag"
      />
    </div>
  )
}

function WatermarkConfig({ data, nodeId }) {
  const update = useAppStore(s => s._wfUpdateNodeConfig)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input
        className="input nodrag"
        placeholder="Watermark text…"
        value={data.config?.text ?? 'WATERMARK'}
        onChange={(e) => { e.stopPropagation(); update?.(nodeId, { text: e.target.value }) }}
        style={{ fontSize: 11, padding: '4px 8px' }}
        onClick={e => e.stopPropagation()}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <label style={{ minWidth: 50 }}>Opacity:</label>
        <input
          type="range"
          min="0.05"
          max="0.5"
          step="0.05"
          value={data.config?.opacity ?? 0.15}
          onChange={(e) => { e.stopPropagation(); update?.(nodeId, { opacity: parseFloat(e.target.value) }) }}
          style={{ flex: 1, accentColor: '#0ea5e9' }}
          className="nodrag"
        />
        <span style={{ minWidth: 30, textAlign: 'right' }}>{Math.round((data.config?.opacity ?? 0.15) * 100)}%</span>
      </div>
    </div>
  )
}

function RotateConfig({ data, nodeId }) {
  const update = useAppStore(s => s._wfUpdateNodeConfig)
  const angle = data.config?.angle ?? 90
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[90, 180, 270].map(a => (
        <button
          key={a}
          className={`btn btn-sm nodrag ${angle === a ? 'btn-primary' : 'btn-secondary'}`}
          onClick={(e) => { e.stopPropagation(); update?.(nodeId, { angle: a }) }}
          style={{ flex: 1, fontSize: 10, padding: '3px 6px' }}
        >
          {a}°
        </button>
      ))}
    </div>
  )
}

function PageRangeConfig({ data, nodeId }) {
  const update = useAppStore(s => s._wfUpdateNodeConfig)
  return (
    <input
      className="input nodrag"
      placeholder="e.g. 1-3, 5, 7-9"
      value={data.config?.range ?? ''}
      onChange={(e) => { e.stopPropagation(); update?.(nodeId, { range: e.target.value }) }}
      onClick={e => e.stopPropagation()}
      style={{ fontSize: 11, padding: '4px 8px' }}
    />
  )
}

function PageNumbersConfig({ data, nodeId }) {
  const update = useAppStore(s => s._wfUpdateNodeConfig)
  const pos = data.config?.position ?? 'bottom-center'
  return (
    <select
      className="select nodrag"
      value={pos}
      onChange={(e) => { e.stopPropagation(); update?.(nodeId, { position: e.target.value }) }}
      onClick={e => e.stopPropagation()}
      style={{ fontSize: 11, padding: '4px 8px' }}
    >
      <option value="bottom-left">Bottom Left</option>
      <option value="bottom-center">Bottom Center</option>
      <option value="bottom-right">Bottom Right</option>
      <option value="top-left">Top Left</option>
      <option value="top-center">Top Center</option>
      <option value="top-right">Top Right</option>
    </select>
  )
}

function SplitConfig({ data, nodeId }) {
  const update = useAppStore(s => s._wfUpdateNodeConfig)
  const mode = data.config?.mode ?? 'individual'
  return (
    <select
      className="select nodrag"
      value={mode}
      onChange={(e) => { e.stopPropagation(); update?.(nodeId, { mode: e.target.value }) }}
      onClick={e => e.stopPropagation()}
      style={{ fontSize: 11, padding: '4px 8px' }}
    >
      <option value="individual">Each page separately</option>
      <option value="half">Split in half</option>
    </select>
  )
}

function DownloadConfig({ data, nodeId }) {
  const update = useAppStore(s => s._wfUpdateNodeConfig)
  return (
    <input
      className="input nodrag"
      placeholder="output.pdf"
      value={data.config?.filename ?? 'output.pdf'}
      onChange={(e) => { e.stopPropagation(); update?.(nodeId, { filename: e.target.value }) }}
      onClick={e => e.stopPropagation()}
      style={{ fontSize: 11, padding: '4px 8px' }}
    />
  )
}

function PreviewConfig({ data }) {
  if (!data._previewUrl) return <div style={{ opacity: 0.7 }}>Preview will show after execution</div>
  return (
    <div style={{ maxHeight: 120, overflow: 'hidden', borderRadius: 6 }}>
      <iframe
        src={data._previewUrl}
        title="Preview"
        style={{ width: '100%', height: 120, border: 'none', borderRadius: 6 }}
      />
    </div>
  )
}

// ─── Draggable Sidebar Item ───
function SidebarNode({ type, label, icon: Icon, color, onAddNode }) {
  const onDragStart = (e) => {
    e.dataTransfer.setData('application/reactflow', type)
    e.dataTransfer.effectAllowed = 'move'
  }

  const onClick = () => {
    if (window.matchMedia?.('(max-width: 768px)').matches) {
      onAddNode?.(type, { autoConnect: true })
    }
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        cursor: 'grab',
        transition: 'all 150ms ease',
        fontSize: 'var(--text-sm)',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = color
        e.currentTarget.style.background = `${color}10`
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.background = 'var(--color-surface)'
      }}
      id={`wf-sidebar-${type}`}
    >
      <div
        style={{
          width: 26,
          height: 26,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          background: `${color}20`,
          color,
          flexShrink: 0,
        }}
      >
        <Icon size={14} />
      </div>
      <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{label}</span>
      <span
        className="workflow-sidebar-add-hint"
        style={{
          marginLeft: 'auto',
          color: color,
          fontSize: 'var(--text-xs)',
          fontWeight: 700,
        }}
      >
        Tap
      </span>
      <GripVertical size={14} style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }} />
    </div>
  )
}

// ─── Sidebar Category ───
function SidebarCategory({ category, onAddNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 8,
          fontSize: 'var(--text-xs)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--color-text-muted)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          width: '100%',
        }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {category.label}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {category.nodes.map(n => (
            <SidebarNode key={n.type} {...n} onAddNode={onAddNode} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Workflow Execution Engine ───
async function executeWorkflow(nodes, edges, updateNode, addToast) {
  // Build adjacency — map nodeId -> [connected target nodeIds]
  const adjacency = {}
  for (const edge of edges) {
    if (!adjacency[edge.source]) adjacency[edge.source] = []
    adjacency[edge.source].push(edge.target)
  }

  // Find input nodes (fileUpload nodes)
  const inputNodes = nodes.filter(n => n.data.nodeType === 'fileUpload')
  if (inputNodes.length === 0) {
    addToast({ type: 'error', message: 'No File Upload node found in workflow' })
    return
  }

  // Check all input nodes have files
  for (const inp of inputNodes) {
    if (!inp.data.config?.files?.length) {
      addToast({ type: 'error', message: `"${inp.data.label}" has no files attached` })
      return
    }
  }

  // Topological sort with BFS
  const inDegree = {}
  nodes.forEach(n => { inDegree[n.id] = 0 })
  edges.forEach(e => { inDegree[e.target] = (inDegree[e.target] || 0) + 1 })

  const queue = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id)
  const sorted = []
  while (queue.length > 0) {
    const id = queue.shift()
    sorted.push(id)
    for (const targetId of (adjacency[id] || [])) {
      inDegree[targetId]--
      if (inDegree[targetId] === 0) queue.push(targetId)
    }
  }

  // Data map: nodeId => Uint8Array[] (pdf bytes arrays)
  const dataMap = {}

  // Process in topological order
  for (const nodeId of sorted) {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) continue

    updateNode(nodeId, { status: 'running' })

    try {
      // Collect inputs from parents
      const parentEdges = edges.filter(e => e.target === nodeId)
      let inputBytesArrays = []
      for (const pe of parentEdges) {
        const parentData = dataMap[pe.source]
        if (parentData) inputBytesArrays.push(...parentData)
      }

      const config = node.data.config || {}
      let outputBytes = []

      switch (node.data.nodeType) {
        case 'fileUpload': {
          const results = []
          for (const f of (config.files || [])) {
            const bytes = await readFileAsArrayBuffer(f)
            results.push(bytes)
          }
          outputBytes = results
          break
        }

        case 'merge': {
          if (inputBytesArrays.length >= 1) {
            const merged = await pdfEngine.mergePDFs(inputBytesArrays)
            outputBytes = [merged]
          }
          break
        }

        case 'splitPages': {
          for (const pdfBytes of inputBytesArrays) {
            if (config.mode === 'half') {
              const info = await pdfEngine.getPDFInfo(pdfBytes)
              const mid = Math.ceil(info.pageCount / 2)
              const parts = await pdfEngine.splitPDF(pdfBytes, [
                { start: 1, end: mid },
                { start: mid + 1, end: info.pageCount },
              ])
              outputBytes.push(...parts.map(p => p.bytes))
            } else {
              const parts = await pdfEngine.splitIntoPages(pdfBytes)
              outputBytes.push(...parts.map(p => p.bytes))
            }
          }
          break
        }

        case 'compress': {
          for (const pdfBytes of inputBytesArrays) {
            const compressed = await pdfEngine.compressPDF(pdfBytes, config.quality ?? 0.6)
            outputBytes.push(compressed)
          }
          break
        }

        case 'watermark': {
          for (const pdfBytes of inputBytesArrays) {
            const result = await pdfEngine.addWatermark(pdfBytes, {
              text: config.text || 'WATERMARK',
              opacity: config.opacity ?? 0.15,
            })
            outputBytes.push(result)
          }
          break
        }

        case 'pageNumbers': {
          for (const pdfBytes of inputBytesArrays) {
            const result = await pdfEngine.addPageNumbers(pdfBytes, {
              position: config.position || 'bottom-center',
            })
            outputBytes.push(result)
          }
          break
        }

        case 'rotate': {
          for (const pdfBytes of inputBytesArrays) {
            const info = await pdfEngine.getPDFInfo(pdfBytes)
            const rotations = info.pages.map((_, idx) => ({
              index: idx,
              degrees: config.angle ?? 90,
            }))
            const result = await pdfEngine.rotatePages(pdfBytes, rotations)
            outputBytes.push(result)
          }
          break
        }

        case 'extractOdd': {
          for (const pdfBytes of inputBytesArrays) {
            const info = await pdfEngine.getPDFInfo(pdfBytes)
            const oddIndices = []
            for (let i = 0; i < info.pageCount; i += 2) oddIndices.push(i)
            const result = await pdfEngine.extractPages(pdfBytes, oddIndices)
            outputBytes.push(result)
          }
          break
        }

        case 'extractEven': {
          for (const pdfBytes of inputBytesArrays) {
            const info = await pdfEngine.getPDFInfo(pdfBytes)
            const evenIndices = []
            for (let i = 1; i < info.pageCount; i += 2) evenIndices.push(i)
            if (evenIndices.length > 0) {
              const result = await pdfEngine.extractPages(pdfBytes, evenIndices)
              outputBytes.push(result)
            }
          }
          break
        }

        case 'pageRange': {
          for (const pdfBytes of inputBytesArrays) {
            if (!config.range) {
              outputBytes.push(pdfBytes)
              continue
            }
            const info = await pdfEngine.getPDFInfo(pdfBytes)
            const { parsePageRanges } = await import('../utils/fileHelpers')
            const indices = parsePageRanges(config.range, info.pageCount)
            if (indices.length > 0) {
              const result = await pdfEngine.extractPages(pdfBytes, indices)
              outputBytes.push(result)
            }
          }
          break
        }

        case 'download': {
          if (inputBytesArrays.length === 1) {
            await downloadBlob(inputBytesArrays[0], config.filename || 'output.pdf')
          } else if (inputBytesArrays.length > 1) {
            const files = inputBytesArrays.map((b, i) => ({
              name: `${(config.filename || 'output').replace('.pdf', '')}_${i + 1}.pdf`,
              bytes: b,
            }))
            await downloadMultipleAsZip(files, 'workflow-output.zip')
          }
          outputBytes = inputBytesArrays
          break
        }

        case 'preview': {
          if (inputBytesArrays.length > 0) {
            const blob = new Blob([inputBytesArrays[0]], { type: 'application/pdf' })
            const url = URL.createObjectURL(blob)
            updateNode(nodeId, { _previewUrl: url })
          }
          outputBytes = inputBytesArrays
          break
        }

        default:
          outputBytes = inputBytesArrays
      }

      dataMap[nodeId] = outputBytes
      updateNode(nodeId, { status: 'done' })
    } catch (err) {
      console.error(`Node ${nodeId} error:`, err)
      updateNode(nodeId, { status: 'error' })
      addToast({ type: 'error', message: `Error in "${node.data.label}": ${err.message}` })
      return
    }
  }

  addToast({ type: 'success', message: 'Workflow executed successfully!' })
}

// ─── Main Component ───
const nodeTypes = { workflowNode: BaseNode }

const STORAGE_KEY = 'pdfomni_workflows'

function getWorkflowPointerPoint(event) {
  const point = event.changedTouches?.[0] || event.touches?.[0] || event
  if (typeof point.clientX !== 'number' || typeof point.clientY !== 'number') return null
  return { x: point.clientX, y: point.clientY }
}

export default function WorkflowPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [savedWorkflows, setSavedWorkflows] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    } catch { return {} }
  })
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [showLoadModal, setShowLoadModal] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [edgeOverlays, setEdgeOverlays] = useState([])
  const reactFlowWrapper = useRef(null)
  const [reactFlowInstance, setReactFlowInstance] = useState(null)
  const lastDropRef = useRef({ x: 320, y: 220 })
  const pendingConnectionRef = useRef(null)
  const connectionCompletedRef = useRef(false)
  const addToast = useAppStore(s => s.addToast)
  const hasDownloadNode = nodes.some(node => node.data?.nodeType === 'download')

  // Expose the node config updater via store for nested components
  useEffect(() => {
    useAppStore.setState({
      _wfUpdateNodeConfig: (nodeId, configUpdate) => {
        setNodes(nds => {
          const next = nds.map(n =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, config: { ...(n.data.config || {}), ...configUpdate } } }
              : n
          )
          return next;
        })
      },
    })
    return () => {
      useAppStore.setState({ _wfUpdateNodeConfig: null })
    }
  }, [setNodes])

  const addWorkflowEdge = useCallback(
    (params) => {
      if (!params.source || !params.target || params.source === params.target) return false
      setEdges((eds) =>
        eds.some((edge) => edge.source === params.source && edge.target === params.target)
          ? eds
          : addEdge(
              {
                ...params,
                sourceHandle: params.sourceHandle || 'source',
                targetHandle: params.targetHandle || 'target',
                type: 'default',
                animated: false,
                zIndex: 50,
                style: { stroke: '#4f46e5', strokeWidth: 4 },
                interactionWidth: 28,
                markerEnd: { type: MarkerType.ArrowClosed, color: '#4f46e5' },
              },
              eds
            )
      )
      return true
    },
    [setEdges]
  )

  // Connect edges
  const onConnect = useCallback(
    (params) => {
      connectionCompletedRef.current = addWorkflowEdge(params)
      window.__pdfomniWorkflowPendingSource = null
    },
    [addWorkflowEdge]
  )

  const onConnectStart = useCallback((_, params) => {
    connectionCompletedRef.current = false
    pendingConnectionRef.current = params?.handleType === 'source' ? params : null
    window.__pdfomniWorkflowPendingSource = pendingConnectionRef.current
  }, [])

  const onConnectEnd = useCallback(
    (event) => {
      const pending = pendingConnectionRef.current || window.__pdfomniWorkflowPendingSource
      pendingConnectionRef.current = null
      window.__pdfomniWorkflowPendingSource = null
      if (!pending || connectionCompletedRef.current || !pending.nodeId) return

      const point = getWorkflowPointerPoint(event)
      if (!point) return

      const targetElement = document
        .elementsFromPoint(point.x, point.y)
        .map((el) => el.closest?.('.react-flow__node'))
        .find(Boolean)
      let targetId = targetElement?.getAttribute('data-id')

      if (!targetId) {
        let nearest = null
        document.querySelectorAll('.react-flow__handle.target').forEach((handle) => {
          const rect = handle.getBoundingClientRect()
          const centerX = rect.left + rect.width / 2
          const centerY = rect.top + rect.height / 2
          const distance = Math.hypot(centerX - point.x, centerY - point.y)
          if (distance <= 72 && (!nearest || distance < nearest.distance)) {
            nearest = { distance, node: handle.closest('.react-flow__node') }
          }
        })
        targetId = nearest?.node?.getAttribute('data-id')
      }

      const targetNode = nodes.find((node) => node.id === targetId)

      if (!targetNode || targetNode.id === pending.nodeId || targetNode.data?.category === 'input') return
      addWorkflowEdge({
        source: pending.nodeId,
        sourceHandle: pending.handleId || 'source',
        target: targetNode.id,
        targetHandle: 'target',
      })
    },
    [addWorkflowEdge, nodes]
  )

  const isValidConnection = useCallback(
    (connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return false
      const targetNode = nodes.find((node) => node.id === connection.target)
      return targetNode?.data?.category !== 'input'
    },
    [nodes]
  )

  const refreshEdgeOverlays = useCallback(() => {
    window.requestAnimationFrame(() => {
      const shell = reactFlowWrapper.current
      if (!shell) return

      const shellRect = shell.getBoundingClientRect()
      const next = edges.flatMap((edge) => {
        const sourceHandle = shell.querySelector(`.react-flow__node[data-id="${edge.source}"] .react-flow__handle.source`)
        const targetHandle = shell.querySelector(`.react-flow__node[data-id="${edge.target}"] .react-flow__handle.target`)
        if (!sourceHandle || !targetHandle) return []

        const sourceRect = sourceHandle.getBoundingClientRect()
        const targetRect = targetHandle.getBoundingClientRect()
        const x1 = sourceRect.left + sourceRect.width / 2 - shellRect.left
        const y1 = sourceRect.top + sourceRect.height / 2 - shellRect.top
        const x2 = targetRect.left + targetRect.width / 2 - shellRect.left
        const y2 = targetRect.top + targetRect.height / 2 - shellRect.top
        const curve = Math.max(56, Math.abs(x2 - x1) * 0.45)

        return [{
          id: edge.id,
          d: `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`,
        }]
      })

      setEdgeOverlays(next)
    })
  }, [edges])

  useEffect(() => {
    refreshEdgeOverlays()
  }, [nodes, edges, refreshEdgeOverlays])

  useEffect(() => {
    window.addEventListener('resize', refreshEdgeOverlays)
    return () => window.removeEventListener('resize', refreshEdgeOverlays)
  }, [refreshEdgeOverlays])

  useEffect(() => {
    const completePendingConnection = (event) => {
      if (connectionCompletedRef.current) {
        window.__pdfomniWorkflowPendingSource = null
        return
      }
      if (!window.__pdfomniWorkflowPendingSource) return
      onConnectEnd(event)
    }

    window.addEventListener('pointerup', completePendingConnection)
    window.addEventListener('mouseup', completePendingConnection)
    window.addEventListener('touchend', completePendingConnection)
    return () => {
      window.removeEventListener('pointerup', completePendingConnection)
      window.removeEventListener('mouseup', completePendingConnection)
      window.removeEventListener('touchend', completePendingConnection)
    }
  }, [onConnectEnd])

  const addWorkflowNode = useCallback(
    (type, options = {}) => {
      if (!reactFlowInstance) return

      const def = ALL_NODE_DEFS.find(d => d.type === type)
      if (!def) return

      const cat = NODE_CATEGORIES.find(c => c.nodes.some(n => n.type === type))
      setNodes((nds) => {
        const wrapperRect = reactFlowWrapper.current?.getBoundingClientRect()
        const centerPoint = wrapperRect
          ? { x: wrapperRect.left + wrapperRect.width / 2, y: wrapperRect.top + Math.min(wrapperRect.height * 0.42, 260) }
          : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
        const basePosition = options.position || reactFlowInstance.screenToFlowPosition(centerPoint)
        const minGapX = 260
        const minGapY = 140

        let position = { ...basePosition }
        const overlapsExisting = (candidate) => nds.some((node) => (
          Math.abs(node.position.x - candidate.x) < minGapX &&
          Math.abs(node.position.y - candidate.y) < minGapY
        ))

        if (overlapsExisting(position)) {
          position = {
            x: lastDropRef.current.x + minGapX,
            y: lastDropRef.current.y + 30,
          }
          while (overlapsExisting(position)) {
            position = { x: position.x + 40, y: position.y + minGapY }
          }
        }

        lastDropRef.current = position

        const newNode = {
          id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: 'workflowNode',
          position,
          selected: true,
          data: {
            label: def.label,
            nodeType: type,
            category: cat?.id || 'process',
            config: {},
            status: null,
          },
        }

        if (options.autoConnect) {
          const previous = [...nds].reverse().find((node) => (
            node.data?.category !== 'output' &&
            (cat?.id || 'process') !== 'input' &&
            node.id !== newNode.id
          ))
          if (previous) {
            setEdges((eds) => {
              const exists = eds.some((edge) => edge.source === previous.id && edge.target === newNode.id)
              if (exists) return eds
              return addEdge(
                {
                  id: `edge_${previous.id}_${newNode.id}`,
                  source: previous.id,
                  sourceHandle: 'source',
                  target: newNode.id,
                  targetHandle: 'target',
                  type: 'default',
                  animated: false,
                  zIndex: 50,
                  style: { stroke: '#4f46e5', strokeWidth: 4 },
                  interactionWidth: 28,
                  markerEnd: { type: MarkerType.ArrowClosed, color: '#4f46e5' },
                },
                eds
              )
            })
          }
        }

        return [...nds.map(n => ({ ...n, selected: false })), newNode]
      })
    },
    [reactFlowInstance, setEdges, setNodes]
  )

  // Drop handler
  const onDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e) => {
      e.preventDefault()
      const type = e.dataTransfer.getData('application/reactflow')
      if (!type || !reactFlowInstance) return

      const position = reactFlowInstance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      })

      addWorkflowNode(type, { position })
    },
    [addWorkflowNode, reactFlowInstance]
  )

  // Update node data helper
  const updateNodeData = useCallback(
    (nodeId, dataUpdate) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...dataUpdate } } : n
        )
      )
    },
    [setNodes]
  )

  // Execute
  const handleExecute = useCallback(async () => {
    if (isExecuting) return
    setIsExecuting(true)

    // Reset statuses
    setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, status: null, _previewUrl: undefined } })))

    await executeWorkflow(nodes, edges, updateNodeData, addToast)
    setIsExecuting(false)
  }, [nodes, edges, isExecuting, updateNodeData, addToast, setNodes])

  // Save workflow
  const handleSave = useCallback(() => {
    if (!saveName.trim()) return
    const serializable = {
      nodes: nodes.map(n => ({
        ...n,
        data: {
          ...n.data,
          config: { ...(n.data.config || {}), files: undefined },
          status: null,
          _previewUrl: undefined,
        },
      })),
      edges,
      savedAt: new Date().toISOString(),
    }
    const updated = { ...savedWorkflows, [saveName.trim()]: serializable }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    setSavedWorkflows(updated)
    setShowSaveModal(false)
    setSaveName('')
    addToast({ type: 'success', message: `Workflow "${saveName.trim()}" saved!` })
  }, [saveName, nodes, edges, savedWorkflows, addToast])

  // Load workflow
  const handleLoad = useCallback(
    (name) => {
      const wf = savedWorkflows[name]
      if (!wf) return
      setNodes(wf.nodes)
      setEdges(wf.edges)
      setShowLoadModal(false)
      addToast({ type: 'success', message: `Workflow "${name}" loaded!` })
    },
    [savedWorkflows, setNodes, setEdges, addToast]
  )

  // Delete saved workflow
  const handleDeleteWorkflow = useCallback(
    (name) => {
      const updated = { ...savedWorkflows }
      delete updated[name]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      setSavedWorkflows(updated)
    },
    [savedWorkflows]
  )

  // Clear canvas
  const handleClear = useCallback(() => {
    setNodes([])
    setEdges([])
  }, [setNodes, setEdges])

  return (
    <>
    <div
      id="workflow-page"
      style={{
        display: 'flex',
        height: 'calc(100vh - var(--header-height))',
        overflow: 'hidden',
        background: 'var(--color-bg-primary)',
      }}
    >
      <Seo
        title="Build Private PDF Workflows Locally | PDFOmni"
        description="Create client-side PDF workflows for merge, split, rotate, watermark, page numbering, and batch document automation directly in your browser."
        canonicalPath="/workflow"
        structuredData={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'SoftwareApplication',
              name: 'PDFOmni Workflow Builder',
              applicationCategory: 'BusinessApplication',
              operatingSystem: 'Web Browser',
              description: 'Create private browser-based PDF workflows without uploading files to a server.',
              url: 'https://pdfomni.com/workflow',
            },
            {
              '@type': 'HowTo',
              name: 'Build a private PDF workflow',
              description: 'Create a local PDF automation pipeline in PDFOmni.',
              step: [
                { '@type': 'HowToStep', position: 1, text: 'Drag an input node onto the workflow canvas.' },
                { '@type': 'HowToStep', position: 2, text: 'Add PDF actions such as split, rotate, watermark, page numbering, or export.' },
                { '@type': 'HowToStep', position: 3, text: 'Connect the nodes and execute the workflow in your browser.' },
              ],
            },
            {
              '@type': 'FAQPage',
              mainEntity: [
                {
                  '@type': 'Question',
                  name: 'Are workflow files uploaded to a server?',
                  acceptedAnswer: { '@type': 'Answer', text: 'No. PDFOmni workflows are designed to run in the browser, so the core PDF processing stays on your device.' },
                },
                {
                  '@type': 'Question',
                  name: 'What can I automate with the workflow builder?',
                  acceptedAnswer: { '@type': 'Answer', text: 'You can chain common PDF actions such as splitting pages, rotating pages, adding watermarks, numbering pages, previewing output, and downloading results.' },
                },
                {
                  '@type': 'Question',
                  name: 'Can I save a workflow and reuse it?',
                  acceptedAnswer: { '@type': 'Answer', text: 'Yes. The workflow page includes save and load controls so repeated PDF pipelines can be reused locally.' },
                },
              ],
            },
          ],
        }}
      />
      {/* Sidebar */}
      <div
        id="workflow-sidebar"
        style={{
          width: sidebarCollapsed ? 0 : 280,
          minWidth: sidebarCollapsed ? 0 : 280,
          background: 'var(--color-bg-secondary)',
          borderRight: '1px solid var(--color-border)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'all 250ms ease',
          overflow: 'hidden',
        }}
      >
        {/* Sidebar header */}
        <div
          style={{
            padding: '16px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Workflow size={20} style={{ color: 'var(--color-accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>Node Library</span>
        </div>

        <div className="workflow-sidebar-body">
          {/* Node list */}
          <div className="workflow-sidebar-scroll">
            <div className="workflow-mobile-tip">
              Tap nodes to add them. New action nodes connect to the previous node automatically.
            </div>
            {NODE_CATEGORIES.map(cat => (
              <SidebarCategory key={cat.id} category={cat} onAddNode={addWorkflowNode} />
            ))}
          </div>

        </div>

        {/* Sidebar footer */}
        <div style={{ padding: 12, borderTop: '1px solid var(--color-border)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textAlign: 'center', lineHeight: 1.4 }}>
          Scroll to Output and add a Download node to save workflow files.
        </div>
      </div>

      {/* Main canvas area */}
      <div className="workflow-main" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Toolbar */}
        <div
          id="workflow-toolbar"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-bg-secondary)',
          }}
        >
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>

          <div className="workflow-toolbar-spacer" style={{ flex: 1 }} />

          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setShowSaveModal(true)}
            id="wf-save-btn"
          >
            <Save size={14} />
            <span>Save</span>
          </button>

          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setShowLoadModal(true)}
            id="wf-load-btn"
          >
            <FolderOpen size={14} />
            <span>Load</span>
          </button>

          <button
            className="btn btn-sm btn-danger"
            onClick={handleClear}
            id="wf-clear-btn"
          >
            <Trash2 size={14} />
            <span>Clear</span>
          </button>

          <div style={{ width: 1, height: 24, background: 'var(--color-border)' }} />

          <button
            className="btn btn-sm btn-primary"
            onClick={handleExecute}
            disabled={isExecuting || nodes.length === 0}
            id="wf-execute-btn"
            style={{ minWidth: 140 }}
            aria-label={isExecuting ? 'Workflow is running' : 'Execute workflow'}
          >
            {isExecuting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Running…</span>
              </>
            ) : (
              <>
                <Play size={14} />
                <span>Execute Workflow</span>
              </>
            )}
          </button>
        </div>

        {/* ReactFlow canvas */}
        <div className="workflow-canvas-shell" ref={reactFlowWrapper} style={{ flex: 1 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            onInit={setReactFlowInstance}
            onMove={refreshEdgeOverlays}
            onNodeDrag={refreshEdgeOverlays}
            onNodeDragStop={refreshEdgeOverlays}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
          snapToGrid
          snapGrid={[16, 16]}
          nodesConnectable
          connectionMode={ConnectionMode.Loose}
          connectionRadius={30}
          connectOnClick
          deleteKeyCode={['Backspace', 'Delete']}
            style={{ background: 'var(--color-bg-primary)' }}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              type: 'default',
              animated: false,
              zIndex: 50,
              style: { stroke: '#4f46e5', strokeWidth: 4 },
              interactionWidth: 28,
              markerEnd: { type: MarkerType.ArrowClosed, color: '#4f46e5' },
            }}
          >
            <Controls
              style={{
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
              }}
            />
            <MiniMap
              style={{
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
              }}
              nodeColor={(n) => {
                const def = ALL_NODE_DEFS.find(d => d.type === n.data?.nodeType)
                return def?.color || '#a855f7'
              }}
              maskColor="rgba(0,0,0,0.6)"
            />
            <Background
              variant="dots"
              gap={20}
              size={1}
              color="rgba(255,255,255,0.05)"
            />
          </ReactFlow>
          {!hasDownloadNode && (
            <div className="workflow-download-callout" aria-live="polite">
              <div className="workflow-download-callout-icon">
                <Download size={18} />
              </div>
              <div>
                <strong>Add a Download node</strong>
                <span>Scroll the sidebar to Output and place Download to save workflow files.</span>
              </div>
            </div>
          )}
          <svg className="workflow-edge-overlay" aria-hidden="true">
            <defs>
              <marker id="workflow-edge-overlay-arrow" markerWidth="12" markerHeight="12" viewBox="-10 -10 20 20" refX="0" refY="0" orient="auto-start-reverse">
                <polyline points="-5,-4 0,0 -5,4 -5,-4" />
              </marker>
            </defs>
            {edgeOverlays.map((edge) => (
              <path key={edge.id} d={edge.d} markerEnd="url(#workflow-edge-overlay-arrow)" />
            ))}
          </svg>
        </div>

        {/* Empty state */}
        {nodes.length === 0 && (
          <div
            className="workflow-empty-state"
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            <Workflow size={64} style={{ color: 'var(--color-text-muted)', opacity: 0.3, marginBottom: 16 }} />
            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 8 }}>
              Build Your Workflow
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', opacity: 0.7 }}>
              Drag nodes from the sidebar and connect them to create a PDF pipeline
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', opacity: 0.7, marginTop: 8 }}>
              Scroll the sidebar to Output and add a Download node when you want the workflow to save files.
            </div>
          </div>
        )}
      </div>

      {/* Save Modal */}
      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2 className="modal-title">Save Workflow</h2>
              <button className="modal-close" onClick={() => setShowSaveModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="input-group">
                <label className="input-label">Workflow Name</label>
                <input
                  className="input"
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  placeholder="My Workflow"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                  id="wf-save-name-input"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!saveName.trim()}>
                <Save size={14} />
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Modal */}
      {showLoadModal && (
        <div className="modal-overlay" onClick={() => setShowLoadModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2 className="modal-title">Load Workflow</h2>
              <button className="modal-close" onClick={() => setShowLoadModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {Object.keys(savedWorkflows).length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--color-text-muted)' }}>
                  No saved workflows yet
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.entries(savedWorkflows).map(([name, wf]) => (
                    <div
                      key={name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 14px',
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                      }}
                    >
                      <Workflow size={18} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{name}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                          {wf.nodes?.length || 0} nodes • {new Date(wf.savedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleLoad(name)}
                      >
                        Load
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDeleteWorkflow(name)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>

    <section className="container workflow-seo-section" aria-labelledby="workflow-seo-title">
      <div className="tool-seo-kicker">Private PDF automation</div>
      <h1 id="workflow-seo-title">Build Private PDF Workflows Locally in Your Browser</h1>
      <p className="tool-seo-lead">
        PDFOmni's workflow builder lets you chain PDF actions into a repeatable pipeline without sending documents to a server. It is built for users who regularly prepare, clean, organize, or export PDFs and want a faster path than running each tool manually.
      </p>
      <p className="tool-seo-lead">
        Instead of switching between separate pages for every operation, you can connect the steps once and run them as a single visual process. That keeps the workflow understandable for non-technical users while still supporting repeatable PDF automation.
      </p>

      <div className="tool-seo-grid tool-seo-steps" aria-label="How to build a PDF workflow">
        <div className="tool-seo-item"><span className="tool-seo-step">1</span><p>Add a file upload node or another starting point to the canvas.</p></div>
        <div className="tool-seo-item"><span className="tool-seo-step">2</span><p>Drag in actions such as split pages, rotate pages, watermark, page numbers, preview, or download.</p></div>
        <div className="tool-seo-item"><span className="tool-seo-step">3</span><p>Connect the nodes, run the workflow, and export the processed PDF result.</p></div>
      </div>

      <div className="tool-seo-copy">
        <div>
          <h2 className="tool-seo-subheading">Why Use This Workflow Builder?</h2>
          <p>
            Repeated PDF work can get tedious when every file needs the same sequence of steps. The workflow page turns those steps into a visual pipeline, while PDFOmni's local-first architecture keeps the core document processing in your browser.
          </p>
          <p>
            This is useful for private files, large document sets, and recurring tasks where upload-first tools add unnecessary waiting. Your workflow runs against local files, so speed depends mostly on your device instead of a remote queue.
          </p>
        </div>
        <div>
          <h2 className="tool-seo-subheading">Advanced Capabilities</h2>
          <p>
            The builder connects multiple PDFOmni actions together, making it easier to move from raw documents to prepared output. You can save workflows for reuse, load previous pipelines, preview results, and combine automation with other tools like compression, editing, redaction, signing, or AI Copilot review.
          </p>
          <p>
            It is especially helpful when you want a repeatable PDF process without creating scripts or trusting a server-side document automation service.
          </p>
        </div>
      </div>

      <div className="tool-seo-use-cases">
        <h2 className="tool-seo-subheading">Common Use Cases</h2>
        <ul>
          <li>Preparing batches of PDFs with the same page operations</li>
          <li>Creating reusable pipelines for reports, packets, or scans</li>
          <li>Combining preview, processing, and download steps in one workspace</li>
        </ul>
      </div>

      <div className="tool-seo-copy">
        <div>
          <h2 className="tool-seo-subheading">Repeated PDF Tasks Without a Cloud Queue</h2>
          <p>
            Repeated work often includes the same few jobs: combine a group of files, rotate scanned pages, add a watermark, prepare a preview, and save the result. PDFOmni makes those steps visual. Supported operations run in the browser, and the finished output is prepared locally instead of waiting in a document-processing queue.
          </p>
          <p>
            This matters for invoices, class packets, client reports, scanned records, internal forms, and drafts that should not leave the device unless the user chooses to share them. The 500 MB per-file limit gives the page a clear boundary, while lazy previews keep large PDFs from forcing every page into memory at once.
          </p>
        </div>
        <div>
          <h2 className="tool-seo-subheading">When a Local Workflow Makes Sense</h2>
          <p>
            A local workflow makes sense when the files should stay on the device and the required actions can run in a modern browser. A cloud service may be more suitable when a team needs shared storage, account approvals, server automation, or another feature that depends on remote infrastructure.
          </p>
          <p>
            Use PDFOmni when the priority is keeping files on your device, repeating common document steps, and reviewing the exported result yourself. Test a saved workflow on a few sample files before using it on a large set because PDFs that look similar can contain different fonts, forms, scans, and permissions.
          </p>
          <p>
            The visual builder is useful when several actions belong together and you expect to repeat them. A one-step job is usually simpler on the dedicated tool page. Automation should remove repeated clicks, while a person still checks privacy, layout, accessibility, and the final downloaded files.
          </p>
        </div>
      </div>

      <div className="tool-seo-faq">
        <h2 className="tool-seo-subheading">Frequently Asked Questions</h2>
        <details><summary>Are workflow files uploaded to a server?</summary><p>No. PDFOmni is designed around client-side processing, so core PDF workflow operations happen in your browser.</p></details>
        <details><summary>Can I save and reuse workflows?</summary><p>Yes. You can save a workflow locally and load it again when you need to repeat the same PDF process.</p></details>
        <details><summary>Who is the workflow builder for?</summary><p>It is for people who repeatedly split, rotate, watermark, number, preview, or export PDFs and want one visual process instead of many manual steps.</p></details>
      </div>
    </section>
    </>
  )
}
