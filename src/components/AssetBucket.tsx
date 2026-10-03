import { useEffect, useRef, useState } from 'react'

interface AssetRecord {
  id: string
  name: string
  width: number
  height: number
  dataUrl: string
  createdAt: string
}

const STORAGE_KEY = 'chip_asset_bucket'

function readAssets(): AssetRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function AssetBucket() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [assets, setAssets] = useState<AssetRecord[]>([])
  const [name, setName] = useState('')
  const [width, setWidth] = useState('128')
  const [height, setHeight] = useState('64')
  const [source, setSource] = useState<HTMLImageElement | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [preview, setPreview] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<AssetRecord | null>(null)
  const [error, setError] = useState('')

  useEffect(() => setAssets(readAssets()), [])

  const crop = (image: HTMLImageElement, targetWidth: number, targetHeight: number) => {
    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''

    const sourceRatio = image.naturalWidth / image.naturalHeight
    const targetRatio = targetWidth / targetHeight
    let sx = 0
    let sy = 0
    let sw = image.naturalWidth
    let sh = image.naturalHeight
    if (sourceRatio > targetRatio) {
      sw = Math.round(image.naturalHeight * targetRatio)
      sx = Math.round((image.naturalWidth - sw) / 2)
    } else {
      sh = Math.round(image.naturalWidth / targetRatio)
      sy = Math.round((image.naturalHeight - sh) / 2)
    }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)
    return canvas.toDataURL('image/png')
  }

  const refreshPreview = (image = source) => {
    const targetWidth = Number(width)
    const targetHeight = Number(height)
    if (!image || !Number.isInteger(targetWidth) || !Number.isInteger(targetHeight) || targetWidth < 1 || targetHeight < 1) {
      setPreview('')
      return
    }
    if (targetWidth > 2048 || targetHeight > 2048) {
      setError('Use dimensions up to 2048 × 2048.')
      return
    }
    setError('')
    setPreview(crop(image, targetWidth, targetHeight))
  }

  const pickImage = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Choose a PNG, JPG, GIF, or WebP image.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Images must be smaller than 10 MB.')
      return
    }
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      setSource(image)
      setSourceName(file.name)
      if (!name) setName(file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase())
      refreshPreview(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      setError('That image could not be read.')
    }
    image.src = url
  }

  const saveAsset = () => {
    const targetWidth = Number(width)
    const targetHeight = Number(height)
    const cleanName = name.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
    if (!preview || !source || !cleanName || !Number.isInteger(targetWidth) || !Number.isInteger(targetHeight)) {
      setError('Choose an image, enter valid dimensions, and name the asset.')
      return
    }
    const next: AssetRecord = {
      id: crypto.randomUUID(),
      name: cleanName,
      width: targetWidth,
      height: targetHeight,
      dataUrl: preview,
      createdAt: new Date().toISOString(),
    }
    const updated = [next, ...assets.filter((asset) => asset.name !== cleanName)]
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      setAssets(updated)
      setError('')
    } catch {
      setError('Browser storage is full. Delete an asset or use a smaller image.')
    }
  }

  const deleteAsset = (id: string) => {
    const updated = assets.filter((asset) => asset.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    setAssets(updated)
    if (selectedAsset?.id === id) setSelectedAsset(null)
  }

  const assetBytes = (dataUrl: string) => Math.max(0, Math.round((dataUrl.length * 3) / 4))
  const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`

  return (
    <div className="space-y-4 max-w-5xl">
      <section className="card">
        <div className="step">
          <div className="grow">
            <h2>Asset Bucket</h2>
            <p className="sub">Crop images to board-friendly dimensions, then keep them ready for generated firmware.</p>
          </div>
          <span className="pill">Local bucket</span>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px] mt-4">
          <button type="button" className="border border-dashed border-[#bdbdbd] bg-white min-h-48 flex flex-col items-center justify-center gap-2 rounded cursor-pointer hover:border-black" onClick={() => inputRef.current?.click()}>
            {preview ? <img src={preview} alt="Cropped preview" className="max-h-40 max-w-full object-contain image-render-pixelated" /> : <span className="text-sm text-[#666]">Choose an image to crop</span>}
            <span className="text-[11px] text-[#888]">{sourceName || 'PNG, JPG, GIF, or WebP · 10 MB max'}</span>
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) pickImage(file); event.currentTarget.value = '' }} />
          </button>

          <div className="space-y-2">
            <label className="field">Asset name
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="niledex-logo" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="field">Width
                <input type="number" min="1" max="2048" value={width} onChange={(event) => { setWidth(event.target.value); setTimeout(() => refreshPreview(), 0) }} />
              </label>
              <label className="field">Height
                <input type="number" min="1" max="2048" value={height} onChange={(event) => { setHeight(event.target.value); setTimeout(() => refreshPreview(), 0) }} />
              </label>
            </div>
            <p className="hint">The crop is centered and resized to exactly W × H. OLED preset: 128 × 64.</p>
            <button type="button" className="h-8 px-3 bg-black text-white text-xs font-medium rounded cursor-pointer disabled:opacity-40" onClick={saveAsset} disabled={!preview}>Save cropped asset</button>
            {error && <p className="text-xs text-[#b91c1c]">{error}</p>}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="step"><div className="grow"><h2>Bucket objects</h2><p className="sub">Browse uploaded image objects and preview them before using their names with Claude.</p></div><span className="pill">{assets.length} objects</span></div>
        {assets.length === 0 ? <p className="hint mt-3">This bucket is empty.</p> : (
          <div className="border border-[#e5e5e5] bg-white rounded mt-3 overflow-x-auto">
            <div className="min-w-[620px]">
              <div className="grid grid-cols-[42px_minmax(170px,1fr)_90px_100px_110px_120px] gap-3 px-3 py-2 border-b border-[#e5e5e5] text-[10px] uppercase tracking-wider text-[#888] font-semibold">
                <span /> <span>Name</span><span>Type</span><span>Dimensions</span><span>Size</span><span>Updated</span>
              </div>
              {assets.map((asset) => <div key={asset.id} className="grid grid-cols-[42px_minmax(170px,1fr)_90px_100px_110px_120px] gap-3 items-center px-3 py-2 border-b last:border-b-0 border-[#f0f0f0] text-xs hover:bg-[#fafafa]">
                <button type="button" className="w-8 h-8 bg-[#f5f5f5] border border-[#e5e5e5] rounded flex items-center justify-center cursor-pointer" onClick={() => setSelectedAsset(asset)} title={`Preview ${asset.name}`} aria-label={`Preview ${asset.name}`}>
                  <img src={asset.dataUrl} alt="" className="max-w-full max-h-full object-contain image-render-pixelated" />
                </button>
                <button type="button" className="font-mono text-left truncate text-black hover:underline cursor-pointer" onClick={() => setSelectedAsset(asset)}>{asset.name}.png</button>
                <span className="text-[#666]">image/png</span>
                <span className="font-mono text-[#666]">{asset.width} × {asset.height}</span>
                <span className="font-mono text-[#666]">{formatBytes(assetBytes(asset.dataUrl))}</span>
                <div className="flex items-center gap-2 text-[#666]"><span>{new Date(asset.createdAt).toLocaleDateString()}</span><button type="button" className="text-[#b91c1c] cursor-pointer" onClick={() => deleteAsset(asset.id)} title="Delete object" aria-label={`Delete ${asset.name}`}>Delete</button></div>
              </div>)}
            </div>
          </div>
        )}
      </section>

      {selectedAsset && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Preview ${selectedAsset.name}`} onClick={() => setSelectedAsset(null)}>
          <div className="bg-white border border-[#e5e5e5] rounded shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e5e5]">
              <div><h2 className="text-sm font-semibold font-mono">{selectedAsset.name}.png</h2><p className="text-[11px] text-[#888]">{selectedAsset.width} × {selectedAsset.height} · image/png</p></div>
              <button type="button" className="ghost sm" onClick={() => setSelectedAsset(null)} aria-label="Close preview">Close</button>
            </div>
            <div className="p-6 bg-[#f5f5f5] flex items-center justify-center min-h-72"><img src={selectedAsset.dataUrl} alt={selectedAsset.name} className="max-w-full max-h-[55vh] object-contain image-render-pixelated" /></div>
          </div>
        </div>
      )}
    </div>
  )
}
