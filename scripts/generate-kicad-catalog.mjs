import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const sourceRoot = path.join(repoRoot, 'kicad-symbols-master')
const outDir = path.join(repoRoot, 'client', 'public', 'catalog')
const splitOutDir = path.join(outDir, 'kicad-components')
const librariesOutDir = path.join(splitOutDir, 'libraries')
const jsonOut = path.join(outDir, 'kicad-components.json')
const mdOut = path.join(outDir, 'kicad-components.md')
const indexOut = path.join(splitOutDir, 'index.json')
const searchIndexOut = path.join(splitOutDir, 'search-index.json')
const verificationReportOut = path.join(splitOutDir, 'verification-report.json')
const splitReadmeOut = path.join(splitOutDir, 'README.md')
const verificationOverridesPath = path.join(__dirname, 'kicad-verification-overrides.json')

function tokenizeSExpr(input) {
  const tokens = []
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (ch === '(' || ch === ')') {
      tokens.push(ch)
      i += 1
      continue
    }

    if (/\s/.test(ch)) {
      i += 1
      continue
    }

    if (ch === '"') {
      let value = ''
      i += 1
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          value += input[i + 1]
          i += 2
        } else {
          value += input[i]
          i += 1
        }
      }
      tokens.push(value)
      i += 1
      continue
    }

    let value = ''
    while (i < input.length && !/[\s()]/.test(input[i])) {
      value += input[i]
      i += 1
    }
    tokens.push(value)
  }

  return tokens
}

function parseSExpr(tokens) {
  let i = 0

  function parseNode() {
    if (tokens[i] !== '(') return tokens[i++]
    i += 1
    const list = []
    while (i < tokens.length && tokens[i] !== ')') {
      list.push(parseNode())
    }
    if (tokens[i] === ')') i += 1
    return list
  }

  const root = []
  while (i < tokens.length) root.push(parseNode())
  return root
}

function children(node, type) {
  if (!Array.isArray(node)) return []
  return node.filter((child) => Array.isArray(child) && child[0] === type)
}

function firstChild(node, type) {
  return children(node, type)[0]
}

function collectNodes(node, type, result = []) {
  if (!Array.isArray(node)) return result
  if (node[0] === type) result.push(node)
  for (const child of node) collectNodes(child, type, result)
  return result
}

function getProperties(symbolNode) {
  const properties = {}
  for (const prop of children(symbolNode, 'property')) {
    if (typeof prop[1] === 'string') properties[prop[1]] = prop[2] || ''
  }
  if (properties.ki_keywords && !properties.Keywords) properties.Keywords = properties.ki_keywords
  if (properties.ki_description && !properties.Description) properties.Description = properties.ki_description
  return properties
}

function getFootprintFilters(symbolNode) {
  const fpFilters = firstChild(symbolNode, 'fp_filters')
  const filters = fpFilters ? fpFilters.slice(1).filter((value) => typeof value === 'string') : []
  const properties = getProperties(symbolNode)
  if (properties.ki_fp_filters) filters.push(...properties.ki_fp_filters.split(/\s+/).filter(Boolean))
  return Array.from(new Set(filters))
}

function getExtends(symbolNode) {
  return String(firstChild(symbolNode, 'extends')?.[1] || '')
}

function getPin(pinNode) {
  const at = firstChild(pinNode, 'at')
  const length = firstChild(pinNode, 'length')
  const name = firstChild(pinNode, 'name')
  const number = firstChild(pinNode, 'number')

  return {
    num: String(number?.[1] || ''),
    name: String(name?.[1] || number?.[1] || ''),
    electricalType: String(pinNode[1] || ''),
    shape: String(pinNode[2] || ''),
    x: Number(at?.[1] || 0),
    y: Number(at?.[2] || 0),
    angle: Number(at?.[3] || 0),
    length: Number(length?.[1] || 0),
  }
}

function classify({ library, symbol, properties, pins }) {
  const haystack = `${library} ${symbol} ${properties.Description || ''} ${properties.Keywords || ''}`.toUpperCase()
  const libraryName = String(library || '')
  const libraryUpper = libraryName.toUpperCase()
  const symbolUpper = String(symbol || '').toUpperCase()
  const ref = String(properties.Reference || '').toUpperCase()

  if (libraryName === 'power' || ref === '#PWR') {
    if (haystack.includes('GND') || symbolUpper === 'GND' || symbolUpper.includes('GROUND')) return 'ground'
    return 'power'
  }
  if (libraryUpper.startsWith('CONNECTOR') || /^J|^P/.test(ref) || /\b(CONN|HEADER)\b/.test(haystack)) return 'connector'
  if (libraryUpper.startsWith('MCU') || haystack.includes('ESP32') || haystack.includes('ESP8266') || haystack.includes('MICROCONTROLLER')) return 'mcu'
  if (libraryName === 'Switch' || /^SW|^S$/.test(ref) || symbolUpper.startsWith('SW_') || /\b(BUTTON|PUSHBUTTON)\b/.test(haystack)) return 'button'
  if (/^R/.test(ref) || symbol === 'R' || /\bRESISTOR\b/.test(haystack)) return 'resistor'
  if (/^C/.test(ref) || symbol === 'C' || /\bCAPACITOR\b/.test(haystack)) return 'capacitor'
  if (/^D/.test(ref) || /\bDIODE\b/.test(haystack)) return haystack.includes('LED') ? 'led' : 'diode'
  if (/^Q/.test(ref) || /\b(TRANSISTOR|MOSFET|JFET|IGBT)\b/.test(haystack)) return 'transistor'
  if (haystack.includes('DISPLAY') || haystack.includes('OLED') || haystack.includes('LCD')) return 'display'
  if (haystack.includes('SENSOR')) return 'sensor'
  if (pins.length > 8) return 'ic'
  if (pins.length >= 3 && pins.length <= 8) return 'module'
  return 'generic'
}

function rendererFor(kind) {
  return {
    capacitor: 'generated_capacitor',
    button: 'generated_button',
    connector: 'generated_connector',
    diode: 'generated_diode',
    display: 'generated_module',
    generic: 'generated_generic',
    ground: 'generated_ground',
    ic: 'generated_ic',
    led: 'generated_led',
    mcu: 'generated_mcu',
    module: 'generated_module',
    power: 'generated_power',
    resistor: 'generated_resistor',
    sensor: 'generated_module',
    transistor: 'generated_transistor',
  }[kind] || 'generated_generic'
}

function buildVerification(component, overrides) {
  const override = overrides[component.id]
  if (override) {
    return {
      status: override.status || 'manufacturer_verified',
      pinDataSource: 'kicad_symbol',
      evidence: {
        manufacturer: override.manufacturer || '',
        title: override.sourceTitle || '',
        url: override.sourceUrl || '',
        verifiedAt: override.verifiedAt || '',
      },
      notes: override.notes || [],
      displayPinNameOverrides: override.displayPinNameOverrides || {},
      pinWarnings: override.pinWarnings || {},
    }
  }

  const hasDatasheetUrl = /^https?:\/\//i.test(component.datasheet || '')
  return {
    status: hasDatasheetUrl ? 'datasheet_link_available' : 'kicad_metadata_only',
    pinDataSource: 'kicad_symbol',
    evidence: {
      manufacturer: '',
      title: '',
      url: hasDatasheetUrl ? component.datasheet : '',
      verifiedAt: '',
    },
    notes: [
      'Pin data was parsed from KiCad symbols and has not been checked against a manufacturer datasheet by Chip.',
    ],
    displayPinNameOverrides: {},
    pinWarnings: {},
  }
}

function uniquePins(pins) {
  const seen = new Set()
  const result = []
  for (const pin of pins) {
    const key = `${pin.num}:${pin.name}:${pin.x}:${pin.y}:${pin.angle}`
    if (!pin.num && !pin.name) continue
    if (seen.has(key)) continue
    seen.add(key)
    result.push(pin)
  }
  return result.sort((a, b) => {
    const an = Number(a.num)
    const bn = Number(b.num)
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
    return a.num.localeCompare(b.num, undefined, { numeric: true })
  })
}

function extractComponents(ast, library, file) {
  const libNode = ast.find((node) => Array.isArray(node) && node[0] === 'kicad_symbol_lib')
  if (!libNode) return []

  return children(libNode, 'symbol')
    .filter((symbolNode) => typeof symbolNode[1] === 'string')
    .map((symbolNode) => {
      const symbol = symbolNode[1]
      const properties = getProperties(symbolNode)
      const pins = uniquePins(collectNodes(symbolNode, 'pin').map(getPin))
      const kind = classify({ library, symbol, properties, pins })
      return {
        id: `${library}:${symbol}`,
        library,
        symbol,
        extends: getExtends(symbolNode),
        displayName: properties.Value || symbol,
        referencePrefix: properties.Reference || '',
        description: properties.Description || '',
        keywords: properties.Keywords || '',
        datasheet: properties.Datasheet || '',
        footprint: properties.Footprint || '',
        footprintFilters: getFootprintFilters(symbolNode),
        kind,
        renderer: rendererFor(kind),
        pinCount: pins.length,
        pins,
        sourceFile: path.relative(repoRoot, file).replaceAll(path.sep, '/'),
      }
    })
}

function resolveInheritedComponents(components) {
  const byId = new Map(components.map((component) => [component.id, component]))

  function resolve(component, stack = new Set()) {
    if (component._resolved) return component
    if (!component.extends || stack.has(component.id)) {
      component._resolved = true
      return component
    }

    stack.add(component.id)
    const parent = resolve(byId.get(`${component.library}:${component.extends}`) || byId.get(component.extends), stack)
    stack.delete(component.id)

    if (parent) {
      component.inheritedFrom = parent.id
      if (component.pinCount === 0 && parent.pinCount > 0) {
        component.pins = parent.pins
        component.pinCount = parent.pinCount
      }
      if (!component.description && parent.description) component.description = parent.description
      if (!component.keywords && parent.keywords) component.keywords = parent.keywords
      if (!component.footprint && parent.footprint) component.footprint = parent.footprint
      component.footprintFilters = Array.from(new Set([...component.footprintFilters, ...parent.footprintFilters]))
      component.kind = classify({
        library: component.library,
        symbol: component.symbol,
        properties: {
          Reference: component.referencePrefix,
          Description: component.description,
          Keywords: component.keywords,
        },
        pins: component.pins,
      })
      component.renderer = rendererFor(component.kind)
    }

    component._resolved = true
    return component
  }

  for (const component of components) resolve(component)
  return components.map(({ _resolved, ...component }) => component)
}

function mdEscape(value) {
  return String(value || '').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim()
}

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function readVerificationOverrides() {
  try {
    return JSON.parse(await readFile(verificationOverridesPath, 'utf8'))
  } catch {
    return {}
  }
}

async function main() {
  const verificationOverrides = await readVerificationOverrides()
  const dirs = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.kicad_symdir'))
    .map((entry) => entry.name)
    .sort()

  const components = []
  const errors = []

  for (const dir of dirs) {
    const library = dir.replace(/\.kicad_symdir$/, '')
    const dirPath = path.join(sourceRoot, dir)
    const files = (await readdir(dirPath))
      .filter((file) => file.endsWith('.kicad_sym'))
      .sort()

    for (const filename of files) {
      const file = path.join(dirPath, filename)
      try {
        const content = await readFile(file, 'utf8')
        const ast = parseSExpr(tokenizeSExpr(content))
        components.push(...extractComponents(ast, library, file))
      } catch (error) {
        errors.push({
          file: path.relative(repoRoot, file).replaceAll(path.sep, '/'),
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  const resolvedComponents = resolveInheritedComponents(components).map((component) => ({
    ...component,
    verification: buildVerification(component, verificationOverrides),
  }))

  const byKind = resolvedComponents.reduce((acc, component) => {
    acc[component.kind] = (acc[component.kind] || 0) + 1
    return acc
  }, {})

  const componentsByLibrary = new Map()
  for (const component of resolvedComponents) {
    const list = componentsByLibrary.get(component.library) || []
    list.push(component)
    componentsByLibrary.set(component.library, list)
  }

  const libraryIndexes = Array.from(componentsByLibrary.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([library, libraryComponents]) => {
      const libraryByKind = libraryComponents.reduce((acc, component) => {
        acc[component.kind] = (acc[component.kind] || 0) + 1
        return acc
      }, {})
      return {
        library,
        file: `libraries/${safeFileName(library)}.json`,
        componentCount: libraryComponents.length,
        byKind: libraryByKind,
      }
    })

  const catalogIndex = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      type: 'kicad-symbols',
      path: path.relative(repoRoot, sourceRoot).replaceAll(path.sep, '/'),
    },
    totals: {
      libraries: dirs.length,
      components: resolvedComponents.length,
      parseErrors: errors.length,
      byKind,
    },
    libraries: libraryIndexes,
    files: {
      index: 'index.json',
      searchIndex: 'search-index.json',
      verificationReport: 'verification-report.json',
      librariesDirectory: 'libraries',
      markdown: 'README.md',
    },
    errors,
  }

  const searchIndex = {
    schemaVersion: 1,
    generatedAt: catalogIndex.generatedAt,
    source: catalogIndex.source,
    totals: catalogIndex.totals,
    components: resolvedComponents.map((component) => ({
      id: component.id,
      library: component.library,
      symbol: component.symbol,
      displayName: component.displayName,
      referencePrefix: component.referencePrefix,
      description: component.description,
      keywords: component.keywords,
      kind: component.kind,
      renderer: component.renderer,
      pinCount: component.pinCount,
      verificationStatus: component.verification.status,
      file: `libraries/${safeFileName(component.library)}.json`,
    })),
  }

  const verificationReport = {
    schemaVersion: 1,
    generatedAt: catalogIndex.generatedAt,
    source: catalogIndex.source,
    totals: {
      components: resolvedComponents.length,
      byVerificationStatus: resolvedComponents.reduce((acc, component) => {
        acc[component.verification.status] = (acc[component.verification.status] || 0) + 1
        return acc
      }, {}),
      withDatasheetUrl: resolvedComponents.filter((component) => /^https?:\/\//i.test(component.datasheet || '')).length,
      manufacturerVerified: resolvedComponents.filter((component) => component.verification.status === 'manufacturer_verified').length,
      kicadMetadataOnly: resolvedComponents.filter((component) => component.verification.status === 'kicad_metadata_only').length,
      zeroPinComponents: resolvedComponents.filter((component) => component.pinCount === 0).length,
    },
    manufacturerVerified: resolvedComponents
      .filter((component) => component.verification.status === 'manufacturer_verified')
      .map((component) => ({
        id: component.id,
        library: component.library,
        symbol: component.symbol,
        pinCount: component.pinCount,
        evidence: component.verification.evidence,
      })),
    needsVerification: resolvedComponents
      .filter((component) => component.verification.status !== 'manufacturer_verified')
      .map((component) => ({
        id: component.id,
        library: component.library,
        symbol: component.symbol,
        kind: component.kind,
        pinCount: component.pinCount,
        datasheet: component.datasheet,
        status: component.verification.status,
      })),
  }

  const md = [
    '# Chip KiCad Component Catalog',
    '',
    `Generated from \`${catalogIndex.source.path}\`.`,
    '',
    '## Summary',
    '',
    `- Libraries: ${catalogIndex.totals.libraries}`,
    `- Components: ${catalogIndex.totals.components}`,
    `- Parse errors: ${catalogIndex.totals.parseErrors}`,
    `- Split folder: \`public/catalog/kicad-components\``,
    `- Manufacturer verified: ${verificationReport.totals.manufacturerVerified}`,
    `- Datasheet links available: ${verificationReport.totals.withDatasheetUrl}`,
    `- KiCad metadata only: ${verificationReport.totals.kicadMetadataOnly}`,
    '',
    '## Kinds',
    '',
    '| Kind | Count |',
    '|---|---:|',
    ...Object.entries(byKind).sort(([a], [b]) => a.localeCompare(b)).map(([kind, count]) => `| ${kind} | ${count} |`),
    '',
    '## Library Files',
    '',
    '| Library | File | Components |',
    '|---|---|---:|',
    ...libraryIndexes.map((library) => `| ${mdEscape(library.library)} | \`${mdEscape(library.file)}\` | ${library.componentCount} |`),
    '',
    '## Components',
    '',
    '| ID | Kind | Renderer | Pins | Description |',
    '|---|---|---|---:|---|',
    ...resolvedComponents.map((component) => `| \`${mdEscape(component.id)}\` | ${mdEscape(component.kind)} | ${mdEscape(component.renderer)} | ${component.pinCount} | ${mdEscape(component.description)} |`),
    '',
  ].join('\n')

  await mkdir(librariesOutDir, { recursive: true })

  for (const library of libraryIndexes) {
    const libraryComponents = componentsByLibrary.get(library.library) || []
    const libraryCatalog = {
      schemaVersion: 1,
      generatedAt: catalogIndex.generatedAt,
      source: catalogIndex.source,
      library: library.library,
      componentCount: libraryComponents.length,
      byKind: library.byKind,
      components: libraryComponents,
    }
    await writeFile(path.join(splitOutDir, library.file), `${JSON.stringify(libraryCatalog, null, 2)}\n`, 'utf8')
  }

  await writeFile(indexOut, `${JSON.stringify(catalogIndex, null, 2)}\n`, 'utf8')
  await writeFile(searchIndexOut, `${JSON.stringify(searchIndex, null, 2)}\n`, 'utf8')
  await writeFile(verificationReportOut, `${JSON.stringify(verificationReport, null, 2)}\n`, 'utf8')
  await writeFile(jsonOut, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: catalogIndex.generatedAt,
    note: 'Split catalog manifest. Full component records are in public/catalog/kicad-components/libraries/*.json.',
    catalog: 'kicad-components/index.json',
    searchIndex: 'kicad-components/search-index.json',
    totals: catalogIndex.totals,
  }, null, 2)}\n`, 'utf8')
  await writeFile(mdOut, md, 'utf8')
  await writeFile(splitReadmeOut, md, 'utf8')

  console.log(`Generated ${resolvedComponents.length} components from ${dirs.length} libraries.`)
  console.log(`Manifest JSON: ${path.relative(repoRoot, jsonOut)}`)
  console.log(`Split index: ${path.relative(repoRoot, indexOut)}`)
  console.log(`Search index: ${path.relative(repoRoot, searchIndexOut)}`)
  console.log(`Verification report: ${path.relative(repoRoot, verificationReportOut)}`)
  console.log(`Library JSON files: ${path.relative(repoRoot, librariesOutDir)}`)
  console.log(`Markdown: ${path.relative(repoRoot, mdOut)}`)
  if (errors.length > 0) console.log(`Parse errors: ${errors.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
