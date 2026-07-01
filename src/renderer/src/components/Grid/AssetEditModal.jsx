import { useState, useEffect, useRef } from 'react'
import { X, Save, Check, ChevronDown, Sparkles, Loader, AlertCircle, Trash2, Upload } from 'lucide-react'
import useAssetStore from '../../store/useAssetStore'
import lottie from 'lottie-web'
import lottieData from '../../assets/lottie.json'

const TAGGER_TYPES = ['background', 'character', 'animation', 'inspiration']

// ─── REUSABLE PRIMITIVES ──────────────────────────────────────

function Field({ label, children }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] text-c-text-2 font-medium">{label}</label>
      {children}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="space-y-1">
      <h3 className="text-[10px] font-bold text-c-text uppercase tracking-widest border-b border-c-border pb-1">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 bg-c-base border border-c-border rounded-lg
        text-xs text-c-text placeholder-c-text-4
        outline-none focus:border-c-accent transition-colors"
    />
  )
}

function TextArea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2 bg-c-base border border-c-border rounded-lg
        text-xs text-c-text placeholder-c-text-4
        outline-none focus:border-c-accent transition-colors resize-none"
    />
  )
}

function NumberInput({ value, onChange, step = '0.1', min = '0' }) {
  return (
    <input
      type="number"
      step={step}
      min={min}
      value={value ?? 0}
      onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 bg-c-base border border-c-border rounded-lg
        text-xs text-c-text outline-none focus:border-c-accent transition-colors"
    />
  )
}

function BoolToggle({ value, onChange, labelTrue = 'Yes', labelFalse = 'No' }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium
        transition-all w-full justify-center
        ${value
          ? 'bg-c-accent/15 border-c-accent text-c-accent'
          : 'bg-c-raised border-c-border-2 text-c-text-3 hover:border-c-border hover:text-c-text-2'
        }`}
    >
      <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-all
        ${value ? 'border-c-accent bg-c-accent' : 'border-c-border-2'}`}
      >
        {value && <span className="w-1.5 h-1.5 rounded-full bg-c-on-accent block" />}
      </span>
      {value ? labelTrue : labelFalse}
    </button>
  )
}

function TagInput({ values = [], onChange, placeholder }) {
  const [input, setInput] = useState('')
  const inputRef = useRef(null)

  const add = (val) => {
    const trimmed = val.trim()
    if (!trimmed || values.includes(trimmed)) return
    onChange([...values, trimmed])
    setInput('')
  }
  const remove = (idx) => onChange(values.filter((_, i) => i !== idx))
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input) }
    if (e.key === 'Backspace' && !input && values.length > 0) remove(values.length - 1)
  }

  return (
    <div
      className="flex flex-wrap gap-1 p-2 bg-c-base border border-c-border rounded-lg
        min-h-[38px] cursor-text focus-within:border-c-accent transition-colors"
      onClick={() => inputRef.current?.focus()}
    >
      {values.map((tag, i) => (
        <span key={i}
          className="flex items-center gap-1 bg-c-accent/20 text-c-accent
            text-[11px] px-2 py-0.5 rounded-full font-medium"
        >
          {tag}
          <button
            onClick={e => { e.stopPropagation(); remove(i) }}
            className="hover:text-c-error transition-colors leading-none"
          >×</button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (input) add(input) }}
        placeholder={values.length === 0 ? placeholder : ''}
        className="bg-transparent outline-none text-[11px] text-c-text
          placeholder-c-text-4 min-w-[80px] flex-1"
      />
    </div>
  )
}

function CategoryDropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-c-base
          border border-c-border rounded-lg text-xs text-c-text hover:border-c-accent
          transition-colors outline-none"
      >
        <span>{value || <span className="text-c-text-4">Select Category</span>}</span>
        <ChevronDown size={12} className={`text-c-text-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-c-surface border border-c-border
          rounded-xl shadow-xl max-h-48 overflow-y-auto py-1"
        >
          {options.map(opt => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors
                ${opt === value
                  ? 'bg-c-accent/15 text-c-accent font-medium'
                  : 'text-c-text-2 hover:bg-c-raised hover:text-c-text'
                }`}
            >
              {opt}
            </button>
          ))}
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-c-text-4">No categories available</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// BUILD FORM — default value per type
// styleName: nama style dari stylenames.json (misal "Style 19")
// ─────────────────────────────────────────────────────────────
function buildForm(type, data, asset, styleName) {
  const base = {
    FileName: data.FileName || asset.name   || '',
    Detail:   data.Detail   || asset.detail || '',
    Category: data.Category || '',
  }
  const sc = {
    scene_prompt: data.search_context?.scene_prompt || '',
    keywords:     data.search_context?.keywords     || [],
  }
  const descFull = data.description?.full || ''

  if (type === 'animation') {
    return {
      ...base,
      description: { full: descFull },
      metadata: {
        asset_type:   'movement',
        style:        styleName,
        mood:         data.metadata?.mood         || '',
        loopable:     data.metadata?.loopable     ?? true,
        props:        data.metadata?.props        || [],
        duration_sec: data.metadata?.duration_sec ?? 0,
        roles:        data.metadata?.roles        || [],
      },
      search_context: sc,
    }
  }

  if (type === 'background') {
    return {
      ...base,
      description: { full: descFull },
      metadata: {
        asset_type:  'background',
        style:       styleName,
        mood:        data.metadata?.mood        || '',
        lighting:    data.metadata?.lighting    || '',
        time_of_day: data.metadata?.time_of_day || '',
        props:       data.metadata?.props       || [],
        roles:       data.metadata?.roles       || [],
      },
      search_context: sc,
    }
  }

  if (type === 'character') {
    return {
      ...base,
      description: { full: descFull },
      metadata: {
        asset_type: 'character',
        style:      styleName,
        vibe:       data.metadata?.vibe   || '',
        gender:     data.metadata?.gender || '',
        age:        data.metadata?.age    || '',
        props:      data.metadata?.props  || [],
        roles:      data.metadata?.roles  || [],
      },
      search_context: sc,
    }
  }

  // Fallback (inspiration — nanti)
  return {
    ...base,
    description: { full: descFull },
    metadata: {
      mood:  data.metadata?.mood  || '',
      roles: data.metadata?.roles || [],
    },
    search_context: sc,
  }
}

// ─── PREVIEW PANEL ────────────────────────────────────────────
// Tambahkan sebelum: function MovementForm(...)

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
const VIDEO_EXTS = ['.mp4', '.webm']

function getPreviewType(path) {
  if (!path) return null
  const lower = path.toLowerCase()
  if (VIDEO_EXTS.some(e => lower.endsWith(e))) return 'video'
  if (IMAGE_EXTS.some(e => lower.endsWith(e))) return 'image'
  return null
}

function toFileUrl(p) {
  if (!p) return null
  return 'file:///' + p.replace(/\\/g, '/')
}

const TYPE_RATIO = {
  background: [285, 161],
  character:  [340, 500],
  animation:  [170, 250],
}

function PreviewPanel({ asset, type, onPreviewUpdated }) {
  const [previewPath, setPreviewPath] = useState(asset.mp4_path || asset.thumbnail_path || null)
  const [previewErr,  setPreviewErr]  = useState(false)
  const [isDragging,  setIsDragging]  = useState(false)
  const [dropStatus,  setDropStatus]  = useState(null)
  const videoRef = useRef(null)

  const previewType = previewErr ? null : getPreviewType(previewPath)
  const previewUrl  = toFileUrl(previewPath)
  const [rw, rh]    = TYPE_RATIO[type] || [16, 9]

  useEffect(() => {
    if (previewType === 'video' && videoRef.current) {
      videoRef.current.play().catch(() => {})
    }
  }, [previewType, previewPath])

  // Auto-detect preview saat mount jika belum ada
  useEffect(() => {
    if (previewPath && !previewErr) return
    const folderPath = (asset.json_path || asset.raw_path || '')
      .split('\\').slice(0, -1).join('\\')
    if (!folderPath) return
    window.api.scanPreviewFile({ folderPath, assetName: asset.name })
      .then(result => {
        if (result.success && result.data) {
          // Found file — update DB immediately
          return window.api.setAssetPreview({ assetId: asset.id, previewPath: result.data })
            .then(updateResult => {
              if (updateResult.success) {
                setPreviewPath(result.data)
                setPreviewErr(false)
                onPreviewUpdated?.(result.data)
              }
            })
        }
      }).catch(() => {})
  }, [])

  const handleDragOver  = (e) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = () => setIsDragging(false)
  const handleDrop = async (e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const PREVIEW_EXTS = ['.mp4', '.webm', '.jpg', '.jpeg', '.png', '.gif', '.webp']
    const ext = '.' + file.name.split('.').pop().toLowerCase()
    if (!PREVIEW_EXTS.includes(ext)) {
      setDropStatus('error'); setTimeout(() => setDropStatus(null), 2000); return
    }
    const filePath = file.path
    if (!filePath) return
    const result = await window.api.setAssetPreview({ assetId: asset.id, previewPath: filePath })
    if (result.success) {
      setPreviewPath(filePath); setPreviewErr(false)
      setDropStatus('ok'); onPreviewUpdated?.(filePath)
      setTimeout(() => setDropStatus(null), 2000)
    } else {
      setDropStatus('error'); setTimeout(() => setDropStatus(null), 2000)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-center justify-center p-4">
        <div
          onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
          className={`w-full rounded-xl overflow-hidden bg-c-raised border transition-all relative
            ${isDragging ? 'border-c-accent border-2 bg-c-accent/5' : 'border-c-border'}`}
          style={{ aspectRatio: `${rw} / ${rh}` }}
        >
          {!previewErr && previewType === 'image' && (
            <img src={previewUrl} alt={asset.name}
              onError={() => setPreviewErr(true)} className="w-full h-full object-cover" />
          )}
          {!previewErr && previewType === 'video' && (
            <video ref={videoRef} src={previewUrl} loop muted playsInline preload="auto"
              onError={() => setPreviewErr(true)} className="w-full h-full object-cover" />
          )}
          {(previewErr || !previewType) && !isDragging && (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-c-text-4">
              <Upload size={24} strokeWidth={1.5} />
              <span className="text-[10px] text-center px-2">No Preview\nDrop file here</span>
            </div>
          )}
          {isDragging && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2
              bg-c-accent/10 text-c-accent pointer-events-none">
              <Upload size={24} />
              <span className="text-xs font-medium">Drop to set preview</span>
            </div>
          )}
          {dropStatus && (
            <div className={`absolute inset-0 flex items-center justify-center
              ${dropStatus === 'ok' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
              <span className={`text-xs font-semibold px-3 py-1.5 rounded-lg
                ${dropStatus === 'ok' ? 'text-green-400 bg-green-500/20' : 'text-red-400 bg-red-500/20'}`}>
                {dropStatus === 'ok' ? '✓ Preview updated' : '✕ Unsupported format'}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="px-4 pb-4 space-y-1.5 flex-shrink-0">
        <p className="text-xs font-semibold text-c-text truncate" title={asset.name}>{asset.name}</p>
        {asset.detail && (
          <p className="text-[10px] text-c-text-3 leading-relaxed line-clamp-2">{asset.detail}</p>
        )}
        {asset.raw_path && (
          <p className="text-[9px] text-c-text-4 font-mono truncate" title={asset.raw_path}>
            {asset.raw_path.split('\\').pop()}
          </p>
        )}
        <p className="text-[9px] text-c-text-4 italic">Drop mp4/jpg/png to update preview</p>
      </div>
    </div>
  )
}

// ─── LOTTIE LOADING OVERLAY ───────────────────────────────────
function LottieOverlay({ visible }) {
  const containerRef = useRef(null)
  const animRef      = useRef(null)

  useEffect(() => {
    if (!visible) {
      if (animRef.current) {
        animRef.current.destroy()
        animRef.current = null
      }
      return
    }

    // Delay sedikit untuk memastikan DOM sudah siap
    const timer = setTimeout(() => {
      if (!containerRef.current) {
        console.warn('[LottieOverlay] Container ref not found')
        return
      }

      try {
        if (!lottieData || !lottieData.v) {
          console.warn('[LottieOverlay] Invalid animation data:', lottieData)
          return
        }

        console.log('[LottieOverlay] Loading animation...')
        animRef.current = lottie.loadAnimation({
          container:     containerRef.current,
          renderer:      'svg',
          loop:          true,
          autoplay:      true,
          animationData: lottieData,
        })
        console.log('[LottieOverlay] Animation loaded successfully')
      } catch (err) {
        console.error('[LottieOverlay] Error loading animation:', err)
      }
    }, 50)

    return () => {
      clearTimeout(timer)
      if (animRef.current) {
        animRef.current.destroy()
        animRef.current = null
      }
    }
  }, [visible])

  if (!visible) return null

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center
      backdrop-brightness-50 rounded-2xl">
      <div ref={containerRef} className="w-40 h-40" />
      <p className="text-c-text text-xs mt-4 font-medium">Generating Tags...</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// MOVEMENT FORM
// ─────────────────────────────────────────────────────────────
function MovementForm({ form, setField, categories }) {
  return (
    <>
      <BasicInfoSection form={form} setField={setField} categories={categories} />
      <DescriptionSection form={form} setField={setField} />
      <Section title="Metadata">
        <MetaHeader assetType={form.metadata.asset_type} styleName={form.metadata.style} />

        <div className="grid grid-cols-2 gap-2">
          <Field label="Mood">
            <TextInput
              value={form.metadata.mood}
              onChange={v => setField('metadata.mood', v)}
              placeholder="positive, negative, neutral..."
            />
          </Field>
          <Field label="Duration (sec)">
            <NumberInput
              value={form.metadata.duration_sec}
              onChange={v => setField('metadata.duration_sec', v)}
            />
          </Field>
        </div>

        <Field label="Loopable">
          <BoolToggle
            value={form.metadata.loopable}
            onChange={v => setField('metadata.loopable', v)}
            labelTrue="Loopable"
            labelFalse="Not Loopable"
          />
        </Field>

        <Field label="Props">
          <TagInput
            values={form.metadata.props}
            onChange={v => setField('metadata.props', v)}
            placeholder="chair, table, phone... (Enter to add)"
          />
        </Field>

        <Field label="Roles / Context">
          <TagInput
            values={form.metadata.roles}
            onChange={v => setField('metadata.roles', v)}
            placeholder="meeting, decision, presentation... (Enter to add)"
          />
        </Field>
      </Section>

      <Section title="Search Context (RAG)">
        <Field label="Scene Prompt">
          <TextArea
            value={form.search_context.scene_prompt}
            onChange={v => setField('search_context.scene_prompt', v)}
            placeholder="Describe the scene for RAG search..."
            rows={2}
          />
        </Field>
        <Field label="Keywords">
          <TagInput
            values={form.search_context.keywords}
            onChange={v => setField('search_context.keywords', v)}
            placeholder="walk, agree, nod, positive... (Enter to add)"
          />
        </Field>
      </Section>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// DEFAULT FORM (background, character, inspiration — nanti)
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// SHARED — Basic Info + Description + Search Context
// (dipakai semua form untuk konsistensi)
// ─────────────────────────────────────────────────────────────
function BasicInfoSection({ form, setField, categories }) {
  return (
    <Section title="Basic Info">
      <div className="grid grid-cols-2 gap-2">
        <Field label="File Name">
          <TextInput value={form.FileName} onChange={v => setField('FileName', v)} />
        </Field>
        <Field label="Category">
          <CategoryDropdown value={form.Category} options={categories} onChange={v => setField('Category', v)} />
        </Field>
      </div>
      <Field label="Detail">
        <TextInput value={form.Detail} onChange={v => setField('Detail', v)} placeholder="Short description..." />
      </Field>
    </Section>
  )
}

function DescriptionSection({ form, setField }) {
  return (
    <Section title="Description">
      <Field label="Full">
        <TextArea value={form.description?.full || ''} onChange={v => setField('description.full', v)} rows={3} placeholder="Full description for RAG context..." />
      </Field>
    </Section>
  )
}

function SearchContextSection({ form, setField }) {
  return (
    <Section title="Search Context (RAG)">
      <Field label="Scene Prompt">
        <TextArea value={form.search_context?.scene_prompt || ''} onChange={v => setField('search_context.scene_prompt', v)} rows={2} placeholder="Describe the scene for RAG search..." />
      </Field>
      <Field label="Keywords">
        <TagInput values={form.search_context?.keywords || []} onChange={v => setField('search_context.keywords', v)} placeholder="keyword... (Enter to add)" />
      </Field>
    </Section>
  )
}

function MetaHeader({ assetType, styleName }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="px-3 py-2 bg-c-raised/60 rounded-lg border border-c-border">
        <p className="text-[10px] text-c-text-4 mb-0.5">Asset Type</p>
        <p className="text-xs text-c-text-3 font-medium">{assetType}</p>
      </div>
      <div className="px-3 py-2 bg-c-raised/60 rounded-lg border border-c-border">
        <p className="text-[10px] text-c-text-4 mb-0.5">Style</p>
        <p className="text-xs text-c-text font-semibold truncate">
          {styleName || <span className="text-c-text-4 font-normal italic">Unnamed</span>}
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// BACKGROUND FORM
// ─────────────────────────────────────────────────────────────
function BackgroundForm({ form, setField, categories }) {
  return (
    <>
      <BasicInfoSection form={form} setField={setField} categories={categories} />
      <DescriptionSection form={form} setField={setField} />
      <Section title="Metadata">
        <MetaHeader assetType={form.metadata.asset_type} styleName={form.metadata.style} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Mood">
            <TextInput value={form.metadata.mood} onChange={v => setField('metadata.mood', v)} placeholder="sporty, calm, professional..." />
          </Field>
          <Field label="Time of Day">
            <TextInput value={form.metadata.time_of_day} onChange={v => setField('metadata.time_of_day', v)} placeholder="day, night, golden hour..." />
          </Field>
        </div>
        <Field label="Lighting">
          <TextInput value={form.metadata.lighting} onChange={v => setField('metadata.lighting', v)} placeholder="Sunny, natural light / Indoor, warm..." />
        </Field>
        <Field label="Props">
          <TagInput values={form.metadata.props} onChange={v => setField('metadata.props', v)} placeholder="bicycle, table, plant... (Enter to add)" />
        </Field>
        <Field label="Roles / Context">
          <TagInput values={form.metadata.roles} onChange={v => setField('metadata.roles', v)} placeholder="Sports, Transportation, Outdoor... (Enter to add)" />
        </Field>
      </Section>
      <SearchContextSection form={form} setField={setField} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// CHARACTER FORM
// ─────────────────────────────────────────────────────────────
const GENDER_OPTIONS   = ['male', 'female']
const AGE_OPTIONS      = ['adult', 'kid', 'fat', 'old']

function OptionPills({ value, options, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt === value ? '' : opt)}
          className={`px-3 py-1 rounded-full text-[11px] font-medium border transition-all capitalize
            ${opt === value
              ? 'bg-c-accent/15 border-c-accent text-c-accent'
              : 'bg-c-raised border-c-border text-c-text-3 hover:border-c-border-2 hover:text-c-text'
            }`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

function CharacterForm({ form, setField, categories }) {
  return (
    <>
      <BasicInfoSection form={form} setField={setField} categories={categories} />
      <DescriptionSection form={form} setField={setField} />
      <Section title="Metadata">
        <MetaHeader assetType={form.metadata.asset_type} styleName={form.metadata.style} />
        <Field label="Vibe">
          <TextInput value={form.metadata.vibe} onChange={v => setField('metadata.vibe', v)} placeholder="professional, casual, friendly..." />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Gender">
            <OptionPills value={form.metadata.gender} options={GENDER_OPTIONS} onChange={v => setField('metadata.gender', v)} />
          </Field>
          <Field label="Age">
            <OptionPills value={form.metadata.age} options={AGE_OPTIONS} onChange={v => setField('metadata.age', v)} />
          </Field>
        </div>
        <Field label="Props / Accessories">
          <TagInput values={form.metadata.props} onChange={v => setField('metadata.props', v)} placeholder="blazer, briefcase, laptop... (Enter to add)" />
        </Field>
        <Field label="Roles">
          <TagInput values={form.metadata.roles} onChange={v => setField('metadata.roles', v)} placeholder="presenter, employee, narrator... (Enter to add)" />
        </Field>
      </Section>
      <SearchContextSection form={form} setField={setField} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// DEFAULT FORM (inspiration, fallback)
// ─────────────────────────────────────────────────────────────
function DefaultForm({ form, setField, categories }) {
  return (
    <>
      <BasicInfoSection form={form} setField={setField} categories={categories} />
      <DescriptionSection form={form} setField={setField} />
      <Section title="Metadata">
        <Field label="Mood">
          <TextInput value={form.metadata?.mood || ''} onChange={v => setField('metadata.mood', v)} placeholder="positive, neutral..." />
        </Field>
        <Field label="Roles">
          <TagInput values={form.metadata?.roles || []} onChange={v => setField('metadata.roles', v)} placeholder="tag... (Enter to add)" />
        </Field>
      </Section>
      <SearchContextSection form={form} setField={setField} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// MAIN MODAL
// ─────────────────────────────────────────────────────────────
const TYPE_LABEL = {
  animation:   'Movement',
  background:  'Background',
  character:   'Character',
  inspiration: 'Inspiration',
}

export default function AssetEditModal({ asset, type, styleTypeId, onClose, onSaved }) {
  // ── Ambil style name dari tree store ─────────────────────────
  // selectedCategory.styleId → cari di tree → ambil name dari stylenames.json
  const { tree, selectedCategory } = useAssetStore()
  const styleId   = selectedCategory?.styleId ?? null
  const styleObj  = tree.find(s => s.id === styleId)
  const styleName = styleObj?.name ?? (styleId !== null ? `Style ${styleId}` : '')

  const [form, setForm]         = useState(null)
  const [categories, setCategories] = useState([])
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [error, setError]         = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting]   = useState(false)

  // ── AI Tagger ─────────────────────────────────────────────────
  const [tagging,      setTagging]      = useState(false)
  const [taggerError,  setTaggerError]  = useState(null)
  const [taggerDone,   setTaggerDone]   = useState(false)
  const canGenerateTag = TAGGER_TYPES.includes(type)

  // ── Preview path resolution ──────────────────────────────────
  // Image tagger (background/character): needs jpg/png, skip mp4
  // Video tagger (animation): needs mp4 path directly
  const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
  const VIDEO_EXTS_TAGGER = ['.mp4', '.mov', '.webm', '.avi']
  const isImage = (p) => p && IMAGE_EXTS.some(e => p.toLowerCase().endsWith(e))
  const isVideo = (p) => p && VIDEO_EXTS_TAGGER.some(e => p.toLowerCase().endsWith(e))

  // For image tagger
  const previewImagePath = isImage(asset.thumbnail_path)
    ? asset.thumbnail_path
    : isImage(asset.mp4_path)
      ? asset.mp4_path
      : null

  // For video tagger — prefer mp4_path, fallback to raw_path if it's a video
  const previewVideoPath = isVideo(asset.mp4_path)
    ? asset.mp4_path
    : isVideo(asset.raw_path)
      ? asset.raw_path
      : null

  const handleGenerateTag = async () => {
    setTagging(true)
    setTaggerError(null)
    setTaggerDone(false)

    let result

    if (type === 'animation') {
      // ── Video tagger path ──────────────────────────────────
      if (!previewVideoPath) {
        setTagging(false)
        setTaggerError('No mp4 preview found. Add a video preview first.')
        return
      }
      result = await window.api.taggerGenerateVideo({
        videoPath: previewVideoPath,
        jsonPath:  asset.json_path,
        filename:  asset.name,
      })
    } else {
      // ── Image tagger path (background / character) ─────────
      result = await window.api.taggerGenerate({
        thumbnailPath: previewImagePath,
        assetType:     type,
        jsonPath:      asset.json_path,
      })
    }

    setTagging(false)

    if (!result.success) {
      // FastAPI validation errors can return objects — always coerce to string
      const errMsg = typeof result.error === 'string'
        ? result.error
        : JSON.stringify(result.error)
      setTaggerError(errMsg)
      return
    }

    // ── Merge AI result into form ──────────────────────────
    const d = result.data
    if (d.FileName)                             setField('FileName',                     d.FileName)
    if (d.Detail)                               setField('Detail',                       d.Detail)
    if (d.Category)                             setField('Category',                     d.Category)
    if (d.description?.full)                    setField('description.full',             d.description.full)
    if (d.search_context?.scene_prompt)         setField('search_context.scene_prompt',  d.search_context.scene_prompt)
    if (d.search_context?.keywords?.length)     setField('search_context.keywords',      d.search_context.keywords)

    if (type === 'background' && d.metadata) {
      if (d.metadata.mood)                      setField('metadata.mood',        d.metadata.mood)
      if (d.metadata.lighting)                  setField('metadata.lighting',    d.metadata.lighting)
      if (d.metadata.time_of_day)               setField('metadata.time_of_day', d.metadata.time_of_day)
      if (d.metadata.props?.length)             setField('metadata.props',       d.metadata.props)
      if (d.metadata.roles?.length)             setField('metadata.roles',       d.metadata.roles)
      if (d.metadata.duration_sec != null)      setField('metadata.duration_sec', d.metadata.duration_sec)
    }
    if (type === 'character' && d.metadata) {
      if (d.metadata.vibe)                      setField('metadata.vibe',        d.metadata.vibe)
      if (d.metadata.gender)                    setField('metadata.gender',      d.metadata.gender)
      if (d.metadata.age)                       setField('metadata.age',         d.metadata.age)
      if (d.metadata.props?.length)             setField('metadata.props',       d.metadata.props)
      if (d.metadata.roles?.length)             setField('metadata.roles',       d.metadata.roles)
      if (d.metadata.duration_sec != null)      setField('metadata.duration_sec', d.metadata.duration_sec)
    }
    if (type === 'animation' && d.metadata) {
      if (d.metadata.mood)                      setField('metadata.mood',        d.metadata.mood)
      if (d.metadata.action)                    setField('metadata.action',      d.metadata.action)
      if (d.metadata.loopable != null)          setField('metadata.loopable',    d.metadata.loopable)
      if (d.metadata.duration_sec != null)      setField('metadata.duration_sec', d.metadata.duration_sec)
      if (d.metadata.roles?.length)             setField('metadata.roles',       d.metadata.roles)
    }
    if (type === 'inspiration' && d.metadata) {
      if (d.metadata.mood)                      setField('metadata.mood',        d.metadata.mood)
      if (d.metadata.roles?.length)             setField('metadata.roles',       d.metadata.roles)
      if (d.search_context?.scene_prompt)       setField('search_context.scene_prompt', d.search_context.scene_prompt)
    }

    setTaggerDone(true)
    setTimeout(() => setTaggerDone(false), 3000)
  }

  useEffect(() => {
    const load = async () => {
      let data = {}
      if (asset?.json_path) {
        const result = await window.api.readAssetJson(asset.json_path)
        if (result.success) data = result.data
      }
      // styleName di-inject saat build form
      setForm(buildForm(type, data, asset, styleName))
    }

    const loadCategories = async () => {
      if (!styleTypeId) return
      const result = await window.api.getTypeCategories(styleTypeId)
      if (result.success) setCategories(result.data)
    }

    load()
    loadCategories()
  }, [asset, type, styleTypeId, styleName])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (!form) return null

  const setField = (path, value) => {
    setForm(prev => {
      const next  = { ...prev }
      const parts = path.split('.')
      let cur     = next
      for (let i = 0; i < parts.length - 1; i++) {
        cur[parts[i]] = { ...cur[parts[i]] }
        cur = cur[parts[i]]
      }
      cur[parts[parts.length - 1]] = value
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const data = {
        ...form,
        metadata: {
          ...form.metadata,
          duration_sec: parseFloat(form.metadata?.duration_sec) || 0,
          // Pastikan style & asset_type selalu tersimpan dari data terkini
          ...(type === 'animation'  ? { style: styleName, asset_type: 'movement'    } : {}),
          ...(type === 'background' ? { style: styleName, asset_type: 'background'  } : {}),
          ...(type === 'character'  ? { style: styleName, asset_type: 'character'   } : {}),
        }
      }

      const result = await window.api.writeAssetJson({
        jsonPath: asset.json_path,
        assetId:  asset.id,
        data,
      })

      if (result.success) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
        if (onSaved) onSaved({
          ...asset,
          name:    data.FileName,
          detail:  data.Detail,
        })
      } else {
        setError(result.error)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    const result = await window.api.deleteAsset({ assetId: asset.id })
    setDeleting(false)
    if (result.success) {
      onSaved?.({ ...asset, _deleted: true })
      onClose()
    } else {
      setError(result.error)
      setConfirmDelete(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-c-surface border border-c-border rounded-2xl shadow-2xl
          w-full max-w-5xl mx-4 overflow-hidden flex flex-col max-h-[90vh] relative"
        onClick={e => e.stopPropagation()}
      >
        {/* Lottie overlay saat generating */}
        <LottieOverlay visible={tagging} />
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-c-border flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-c-text">Edit Asset</h2>
              {type && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-c-accent/15 text-c-accent font-semibold">
                  {TYPE_LABEL[type] || type}
                </span>
              )}
            </div>
            <p className="text-[10px] text-c-text-4 mt-0.5 font-mono truncate max-w-sm">
              {asset.json_path || 'No JSON file'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Generate Tag — hanya untuk background & character */}
            {canGenerateTag && (
              <button
                onClick={handleGenerateTag}
                disabled={tagging || (type === 'animation' ? !previewVideoPath : !previewImagePath)}
                title={
                  type === 'animation'
                    ? (!previewVideoPath ? 'No mp4 preview found' : 'Generate tags with AI (video)')
                    : (!previewImagePath ? 'No preview image (jpg/png only)' : 'Generate tags with AI')
                }
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                  border transition-all
                  ${taggerDone
                    ? 'bg-green-500/15 border-green-500/40 text-green-400'
                    : tagging
                      ? 'bg-c-raised border-c-border text-c-text cursor-not-allowed'
                      : 'bg-c-accent/10 border-c-accent/40 text-c-accent hover:bg-c-accent/20'
                  }
                  disabled:opacity-100 disabled:cursor-not-allowed`}
              >
                {tagging ? (
                  <><Loader size={12} className="animate-spin" /> Generating...</>
                ) : taggerDone ? (
                  <><Check size={12} /> Tags Applied!</>
                ) : (
                  <><Sparkles size={12} /> Generate Tag</>
                )}
              </button>
            )}

            <button
              onClick={onClose}
              className="text-c-text-3 hover:text-c-text p-1 rounded-lg hover:bg-c-raised transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body — 2 kolom */}
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* Kolom Kiri — Preview */}
          <div className="w-64 flex-shrink-0 border-r border-c-border bg-c-base">
            <PreviewPanel asset={asset} type={type} onPreviewUpdated={(path) => {
              // Preview path sudah diupdate di DB via IPC, tidak perlu action extra
            }} />
          </div>

          {/* Kolom Kanan — Form */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Tagger error */}
          {taggerError && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-c-error-bg/20 border border-c-error/30">
              <AlertCircle size={13} className="text-c-error flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-c-error font-medium">Tagger failed</p>
                <p className="text-[11px] text-c-error/80 mt-0.5">{taggerError}</p>
              </div>
              <button onClick={() => setTaggerError(null)} className="text-c-error/60 hover:text-c-error flex-shrink-0">
                <X size={11} />
              </button>
            </div>
          )}

          {type === 'animation'  && <MovementForm    form={form} setField={setField} categories={categories} />}
          {type === 'background' && <BackgroundForm   form={form} setField={setField} categories={categories} />}
          {type === 'character'  && <CharacterForm    form={form} setField={setField} categories={categories} />}
          {(type === 'inspiration' || (!type || !['animation','background','character'].includes(type))) &&
            <DefaultForm form={form} setField={setField} categories={categories} />}
          {error && (
            <div className="bg-c-error-bg/30 border border-c-error/30 rounded-lg px-3 py-2">
              <p className="text-xs text-c-error">{error}</p>
            </div>
          )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-c-border bg-c-base/40 flex-shrink-0">

          {/* Delete kiri */}
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                text-c-error/70 hover:text-c-error hover:bg-c-error/10 border border-transparent
                hover:border-c-error/30 transition-all disabled:opacity-30"
            >
              <Trash2 size={12} />
              Delete
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-c-error font-medium">Delete this asset?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold
                  bg-red-600 text-white hover:bg-red-700 transition-all disabled:opacity-50"
              >
                {deleting ? <Loader size={11} className="animate-spin" /> : <Trash2 size={11} />}
                {deleting ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2.5 py-1 rounded-lg text-xs text-c-text-3 hover:text-c-text
                  hover:bg-c-raised transition-all"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="flex-1" />

          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs text-c-text-3
              hover:bg-c-raised hover:text-c-text transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold
              bg-c-accent text-c-on-accent hover:bg-c-accent-h transition-all disabled:opacity-50"
          >
            {saved
              ? <><Check size={12} /> Saved</>
              : <><Save  size={12} /> {saving ? 'Saving...' : 'Save'}</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}