'use client'

// ============================================================================
// src/app/page.tsx — nbody-fold-scala web control plane
// ============================================================================
// Single-page UI that drives the N-body simulation:
//
//   Left column  — Configuration form (generator, N, dt, softening, etc.)
//                  + Saved runs list (most recent first)
//   Right column — 3D canvas visualization of the latest snapshot
//                  + Energy drift chart (recharts)
//                  + Audit log panel (recent API requests from middleware)
//
// Backend wiring:
//   POST /api/simulations                — create a new simulation
//   GET  /api/simulations                — list all simulations
//   GET  /api/simulations/[id]           — fetch one simulation
//   POST /api/simulations/[id]/step      — advance by N steps
//   DELETE /api/simulations/[id]         — delete a simulation
//   GET  /api/simulations/[id]/snapshots — trajectory snapshots for chart
//   GET  /api/audit?limit=50             — recent API audit log entries
//
// The middleware (src/middleware.ts) gates write endpoints with an API key
// (x-api-key header) and stamps every /api/* request with audit headers,
// which the route handlers then persist to the ApiAudit table.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter,
} from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart'
import { toast } from 'sonner'
import {
  Play, Trash2, RefreshCw, Plus, Activity, Database, Shield,
  Cpu, Zap, Globe, Layers,
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts'

// ── Types ─────────────────────────────────────────────────────────────────

interface Simulation {
  id: string
  name: string
  description: string | null
  bodyCount: number
  dt: number
  softening: number
  algorithm: string
  maxSteps: number
  currentStep: number
  status: string
  initialEnergy: number | null
  currentEnergy: number | null
  createdAt: string
  updatedAt: string
  _count?: { bodies: number, snapshots: number }
  bodies?: Body[]
  snapshots?: Snapshot[]
}

interface Body {
  bodyId: number
  mass: number
  posX: number
  posY: number
  posZ: number
  velX: number
  velY: number
  velZ: number
}

interface Snapshot {
  step: number
  energy: number
  momentumMag: number
  angularMag: number
}

interface AuditEntry {
  id: string
  method: string
  path: string
  status: number
  latencyMs: number
  ipHash: string | null
  apiKey: string | null
  error: string | null
  createdAt: string
}

// ── Constants ─────────────────────────────────────────────────────────────

const API_KEY_STORAGE = 'nbody-api-key'
const STATUS_COLORS: Record<string, string> = {
  created: 'bg-gray-500/15 text-gray-700 dark:text-gray-300',
  running: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  paused: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  error: 'bg-red-500/15 text-red-700 dark:text-red-300',
}

const chartConfig = {
  energy: { label: 'Total Energy', color: 'hsl(var(--chart-1))' },
  momentumMag: { label: '|p|', color: 'hsl(var(--chart-2))' },
  angularMag: { label: '|L|', color: 'hsl(var(--chart-3))' },
} satisfies ChartConfig

// ── Component ─────────────────────────────────────────────────────────────

export default function Home() {
  // ── Form state ──────────────────────────────────────────────────────
  const [name, setName] = useState('Plummer N=64')
  const [description, setDescription] = useState('')
  const [generatorType, setGeneratorType] = useState<'plummer' | 'lattice' | 'two-body'>('plummer')
  const [bodyCount, setBodyCount] = useState(64)
  const [dt, setDt] = useState(0.01)
  const [softening, setSoftening] = useState(0.05)
  const [algorithm, setAlgorithm] = useState('brute-force')
  const [maxSteps, setMaxSteps] = useState(1000)
  const [seed, setSeed] = useState(42)
  const [stepCount, setStepCount] = useState(100)
  const [apiKey, setApiKey] = useState('')

  // ── App state ───────────────────────────────────────────────────────
  const [simulations, setSimulations] = useState<Simulation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedSim, setSelectedSim] = useState<Simulation | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [audits, setAudits] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)

  // ── Canvas ref ──────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rotationRef = useRef({ x: -0.5, y: 0.3, auto: true })

  // ── Load API key from localStorage ──────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem(API_KEY_STORAGE)
    if (saved) setApiKey(saved)
  }, [])

  useEffect(() => {
    localStorage.setItem(API_KEY_STORAGE, apiKey)
  }, [apiKey])

  // ── API helpers ─────────────────────────────────────────────────────
  const apiHeaders = useCallback(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) h['x-api-key'] = apiKey
    return h
  }, [apiKey])

  const refreshSimulations = useCallback(async () => {
    try {
      const res = await fetch('/api/simulations')
      const data = await res.json()
      if (res.ok) {
        setSimulations(data.simulations ?? [])
      } else {
        toast.error('Failed to load simulations', { description: data.error })
      }
    } catch (err) {
      toast.error('Network error', { description: String(err) })
    }
  }, [])

  const refreshAudits = useCallback(async () => {
    try {
      const res = await fetch('/api/audit?limit=30')
      const data = await res.json()
      if (res.ok) {
        setAudits(data.audits ?? [])
      }
    } catch {
      // silent — audit refresh is best-effort
    }
  }, [])

  const selectSimulation = useCallback(async (id: string) => {
    setSelectedId(id)
    try {
      const res = await fetch(`/api/simulations/${id}`)
      const data = await res.json()
      if (res.ok) {
        setSelectedSim(data.simulation)
        // Load snapshots for chart
        const snapRes = await fetch(`/api/simulations/${id}/snapshots?limit=500`)
        const snapData = await snapRes.json()
        if (snapRes.ok) setSnapshots(snapData.snapshots ?? [])
      } else {
        toast.error('Failed to load simulation', { description: data.error })
      }
    } catch (err) {
      toast.error('Network error', { description: String(err) })
    }
  }, [])

  // ── Initial load + periodic audit refresh ──────────────────────────
  useEffect(() => {
    refreshSimulations()
    refreshAudits()
    const interval = setInterval(refreshAudits, 5000)
    return () => clearInterval(interval)
  }, [refreshSimulations, refreshAudits])

  // ── Create simulation ──────────────────────────────────────────────
  const handleCreate = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/simulations', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          name, description,
          generatorType, bodyCount, dt, softening, algorithm, maxSteps, seed,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Simulation created', { description: `${name} (id: ${data.simulation.id.slice(0, 8)}…) — ${data.simulation.bodyCount} bodies` })
        await refreshSimulations()
        await selectSimulation(data.simulation.id)
        await refreshAudits()
      } else {
        toast.error('Create failed', { description: data.error })
      }
    } catch (err) {
      toast.error('Network error', { description: String(err) })
    } finally {
      setLoading(false)
    }
  }

  // ── Step simulation ────────────────────────────────────────────────
  const handleStep = async () => {
    if (!selectedId) {
      toast.error('No simulation selected', { description: 'Create or select one first' })
      return
    }
    setRunning(true)
    try {
      const res = await fetch(`/api/simulations/${selectedId}/step`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ steps: stepCount, snapshotEvery: 5 }),
      })
      const data = await res.json()
      if (res.ok) {
        const driftPct = (data.energyDrift * 100).toExponential(2)
        toast.success(`Stepped +${data.stepsTaken}`, {
          description: `step ${data.currentStep}/${data.maxSteps} · drift ${driftPct}% · status: ${data.status}`,
        })
        await selectSimulation(selectedId)
        await refreshSimulations()
        await refreshAudits()
      } else {
        toast.error('Step failed', { description: data.error })
      }
    } catch (err) {
      toast.error('Network error', { description: String(err) })
    } finally {
      setRunning(false)
    }
  }

  // ── Delete simulation ──────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/simulations/${id}`, {
        method: 'DELETE',
        headers: apiHeaders(),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Deleted')
        if (selectedId === id) {
          setSelectedId(null)
          setSelectedSim(null)
          setSnapshots([])
        }
        await refreshSimulations()
        await refreshAudits()
      } else {
        toast.error('Delete failed', { description: data.error })
      }
    } catch (err) {
      toast.error('Network error', { description: String(err) })
    }
  }

  // ── Canvas rendering ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    const render = () => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      // Clear
      ctx.fillStyle = 'hsl(var(--background))'
      ctx.fillRect(0, 0, w, h)

      // Auto-rotate
      if (rotationRef.current.auto) {
        rotationRef.current.y += 0.005
      }

      const rotX = rotationRef.current.x
      const rotY = rotationRef.current.y
      const cx = w / 2
      const cy = h / 2
      const scale = Math.min(w, h) / 8

      // Draw axes
      ctx.strokeStyle = 'hsl(var(--border))'
      ctx.lineWidth = 1
      const axes: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
      const colors = ['#ef4444', '#22c55e', '#3b82f6']
      axes.forEach((axis, i) => {
        const p1 = project(0, 0, 0, rotX, rotY, cx, cy, scale)
        const p2 = project(axis[0] * 3, axis[1] * 3, axis[2] * 3, rotX, rotY, cx, cy, scale)
        ctx.strokeStyle = colors[i]
        ctx.lineWidth = 1
        ctx.globalAlpha = 0.3
        ctx.beginPath()
        ctx.moveTo(p1.x, p1.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.stroke()
        ctx.globalAlpha = 1
      })

      // Draw bodies
      const bodies = selectedSim?.bodies
      if (bodies && bodies.length > 0) {
        // Project all bodies
        const projected = bodies.map(b => {
          const p = project(b.posX, b.posY, b.posZ, rotX, rotY, cx, cy, scale)
          return { ...p, mass: b.mass }
        })
        // Draw back-to-front (sort by depth z)
        projected.sort((a, b) => a.depth - b.depth)
        for (const p of projected) {
          const radius = Math.max(1.5, Math.min(6, 1 + p.mass * 50))
          // Depth-based alpha
          const alpha = 0.4 + 0.6 * (1 - Math.max(0, Math.min(1, (p.depth + 5) / 10)))
          ctx.fillStyle = `hsla(${(p.x * 0.5) % 360}, 70%, 55%, ${alpha})`
          ctx.beginPath()
          ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
          ctx.fill()
        }
      } else {
        // Empty state hint
        ctx.fillStyle = 'hsl(var(--muted-foreground))'
        ctx.font = '13px system-ui'
        ctx.textAlign = 'center'
        ctx.fillText('No simulation selected — create one to visualize', cx, cy)
      }

      raf = requestAnimationFrame(render)
    }
    render()
    return () => cancelAnimationFrame(raf)
  }, [selectedSim])

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-sm">
              n-body
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                nbody-fold-scala · Control Plane
              </h1>
              <p className="text-xs text-muted-foreground">
                Full-stack web UI · Next.js 16 · Prisma · leapfrog KDK
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <Database className="w-3 h-3" />
              {simulations.length} sims
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Activity className="w-3 h-3" />
              {audits.length} requests
            </Badge>
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* ── Left column: Config + Simulations ─────────────────────── */}
          <section className="lg:col-span-4 space-y-4">
            {/* Config form */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cpu className="w-4 h-4 text-emerald-500" />
                  New Simulation
                </CardTitle>
                <CardDescription>
                  Configure initial conditions and integration parameters.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="desc">Description (optional)</Label>
                  <Textarea
                    id="desc" value={description}
                    onChange={e => setDescription(e.target.value)}
                    rows={2} className="resize-none text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Generator</Label>
                    <Select value={generatorType} onValueChange={(v) => setGeneratorType(v as 'plummer' | 'lattice' | 'two-body')}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="plummer">Plummer sphere</SelectItem>
                        <SelectItem value="lattice">Cubic lattice</SelectItem>
                        <SelectItem value="two-body">Two-body Kepler</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="n">Body count</Label>
                    <Input id="n" type="number" min={1} max={5000} value={bodyCount}
                      onChange={e => setBodyCount(Number(e.target.value))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="dt">dt</Label>
                    <Input id="dt" type="number" step={0.001} min={0.0001} max={1} value={dt}
                      onChange={e => setDt(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="soft">Softening ε</Label>
                    <Input id="soft" type="number" step={0.001} min={0} max={1} value={softening}
                      onChange={e => setSoftening(Number(e.target.value))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="maxSteps">Max steps</Label>
                    <Input id="maxSteps" type="number" min={1} max={100000} value={maxSteps}
                      onChange={e => setMaxSteps(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="seed">Seed</Label>
                    <Input id="seed" type="number" min={1} value={seed}
                      onChange={e => setSeed(Number(e.target.value))} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="algo">Algorithm</Label>
                  <Select value={algorithm} onValueChange={setAlgorithm}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="brute-force">Brute force (O(N²))</SelectItem>
                      <SelectItem value="barnes-hut">Barnes-Hut (O(N log N))</SelectItem>
                      <SelectItem value="group-aggregate">GroupAggregate (Phase 10)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div className="space-y-1">
                  <Label htmlFor="key">API Key (for write endpoints)</Label>
                  <Input id="key" type="password" placeholder="(leave empty in dev)" value={apiKey}
                    onChange={e => setApiKey(e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    Required only if NBODY_API_KEY env var is set on the server.
                  </p>
                </div>
              </CardContent>
              <CardFooter>
                <Button onClick={handleCreate} disabled={loading} className="w-full">
                  <Plus className="w-4 h-4 mr-1" />
                  Create simulation
                </Button>
              </CardFooter>
            </Card>

            {/* Saved simulations list */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-500" />
                    Saved Simulations
                  </span>
                  <Button variant="ghost" size="sm" onClick={refreshSimulations}>
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-72 px-6 pb-4">
                  {simulations.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-8 text-center">
                      No simulations yet. Create one above.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {simulations.map(sim => (
                        <div
                          key={sim.id}
                          className={`rounded-md border p-3 cursor-pointer transition-colors hover:bg-accent/50 ${selectedId === sim.id ? 'border-emerald-500 bg-accent' : 'border-border'}`}
                          onClick={() => selectSimulation(sim.id)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-sm truncate">{sim.name}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                N={sim.bodyCount} · dt={sim.dt} · {sim.currentStep}/{sim.maxSteps} steps
                              </div>
                            </div>
                            <Badge variant="secondary" className={`text-[10px] ${STATUS_COLORS[sim.status] ?? ''}`}>
                              {sim.status}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(sim.createdAt).toLocaleString()}
                            </span>
                            <Button
                              variant="ghost" size="sm" className="h-6 text-xs text-red-600 hover:text-red-700"
                              onClick={(e) => { e.stopPropagation(); handleDelete(sim.id) }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </section>

          {/* ── Right column: Visualization + Chart + Audit ──────────── */}
          <section className="lg:col-span-8 space-y-4">
            {/* Selected simulation header + Step controls */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      {selectedSim ? selectedSim.name : 'No simulation selected'}
                    </CardTitle>
                    <CardDescription>
                      {selectedSim
                        ? `${selectedSim.bodyCount} bodies · ${selectedSim.algorithm} · dt=${selectedSim.dt} · ε=${selectedSim.softening}`
                        : 'Create or select a simulation to begin.'}
                    </CardDescription>
                  </div>
                  {selectedSim && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number" min={1} max={10000} value={stepCount}
                        onChange={e => setStepCount(Number(e.target.value))}
                        className="w-20"
                      />
                      <Button onClick={handleStep} disabled={running || selectedSim.status === 'done'}>
                        {running ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
                        Step +{stepCount}
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              {selectedSim && (
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Stat label="Step" value={`${selectedSim.currentStep} / ${selectedSim.maxSteps}`} />
                    <Stat label="Status" value={selectedSim.status} />
                    <Stat
                      label="Initial E"
                      value={selectedSim.initialEnergy != null ? selectedSim.initialEnergy.toExponential(3) : '—'}
                    />
                    <Stat
                      label="Current E"
                      value={selectedSim.currentEnergy != null ? selectedSim.currentEnergy.toExponential(3) : '—'}
                    />
                  </div>
                  {selectedSim.initialEnergy != null && selectedSim.currentEnergy != null && selectedSim.initialEnergy !== 0 && (
                    <div className="mt-3 text-xs text-muted-foreground">
                      Energy drift:{' '}
                      <span className="font-mono">
                        {(Math.abs(selectedSim.currentEnergy - selectedSim.initialEnergy) / Math.abs(selectedSim.initialEnergy) * 100).toExponential(2)}%
                      </span>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>

            {/* 3D Visualization */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-emerald-500" />
                    3D Visualization
                  </span>
                  <span className="text-xs text-muted-foreground font-normal">
                    Auto-rotating · drag canvas to control rotation
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <canvas
                  ref={canvasRef}
                  className="w-full h-72 block touch-none cursor-grab active:cursor-grabbing"
                  onMouseDown={(e) => {
                    const startX = e.clientX, startY = e.clientY
                    const startRotY = rotationRef.current.y
                    const startRotX = rotationRef.current.x
                    rotationRef.current.auto = false
                    const onMove = (ev: MouseEvent) => {
                      rotationRef.current.y = startRotY + (ev.clientX - startX) * 0.01
                      rotationRef.current.x = startRotX + (ev.clientY - startY) * 0.01
                    }
                    const onUp = () => {
                      window.removeEventListener('mousemove', onMove)
                      window.removeEventListener('mouseup', onUp)
                    }
                    window.addEventListener('mousemove', onMove)
                    window.addEventListener('mouseup', onUp)
                  }}
                  onDoubleClick={() => { rotationRef.current.auto = !rotationRef.current.auto }}
                />
              </CardContent>
            </Card>

            {/* Tabs: Energy chart + Audit log */}
            <Tabs defaultValue="chart" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="chart" className="gap-1">
                  <Zap className="w-3 h-3" /> Energy / Momentum
                </TabsTrigger>
                <TabsTrigger value="audit" className="gap-1">
                  <Shield className="w-3 h-3" /> Audit Log
                </TabsTrigger>
              </TabsList>

              {/* Energy chart */}
              <TabsContent value="chart">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Trajectory Diagnostics</CardTitle>
                    <CardDescription>
                      Total energy, linear momentum magnitude, and angular momentum magnitude vs step.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {snapshots.length === 0 ? (
                      <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                        No snapshots yet. Step the simulation to collect data.
                      </div>
                    ) : (
                      <ChartContainer config={chartConfig} className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={snapshots} margin={{ top: 8, right: 12, left: 12, bottom: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="step" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Line type="monotone" dataKey="energy" stroke="var(--color-energy)" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="momentumMag" stroke="var(--color-momentumMag)" strokeWidth={1.5} dot={false} />
                            <Line type="monotone" dataKey="angularMag" stroke="var(--color-angularMag)" strokeWidth={1.5} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartContainer>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Audit log */}
              <TabsContent value="audit">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                      <span>API Audit Log</span>
                      <Button variant="ghost" size="sm" onClick={refreshAudits}>
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                    </CardTitle>
                    <CardDescription>
                      Last 30 /api/* requests, logged by Next.js middleware (auto-refresh 5s).
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-72">
                      <div className="px-6 pb-4">
                        {audits.length === 0 ? (
                          <div className="text-sm text-muted-foreground py-8 text-center">
                            No API requests yet.
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {audits.map(a => (
                              <div key={a.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-border/50 last:border-0">
                                <span className="font-mono font-semibold w-12" style={{ color: methodColor(a.method) }}>{a.method}</span>
                                <span className="font-mono w-12 text-right" style={{ color: statusColor(a.status) }}>{a.status}</span>
                                <span className="font-mono flex-1 truncate" title={a.path}>{a.path}</span>
                                <span className="text-muted-foreground font-mono w-14 text-right">{a.latencyMs}ms</span>
                                <span className="text-muted-foreground w-32 text-right">
                                  {new Date(a.createdAt).toLocaleTimeString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </main>

      {/* ── Footer (sticky bottom) ─────────────────────────────────────── */}
      <footer className="border-t border-border bg-card/50 mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            nbody-fold-scala · v1.0.0 · Phase 11 release
          </span>
          <span className="flex items-center gap-3">
            <span>Backend: Next.js API + Prisma/SQLite</span>
            <span>·</span>
            <span>Middleware: API-key gate + audit</span>
            <span>·</span>
            <span>Engine: leapfrog KDK (Phase 5 port)</span>
          </span>
        </div>
      </footer>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────

function project(
  x: number, y: number, z: number,
  rotX: number, rotY: number,
  cx: number, cy: number, scale: number,
): { x: number, y: number, depth: number } {
  // Rotate around Y axis (yaw)
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY)
  const x1 = cosY * x + sinY * z
  const z1 = -sinY * x + cosY * z
  // Rotate around X axis (pitch)
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX)
  const y2 = cosX * y - sinX * z1
  const z2 = sinX * y + cosX * z1
  return { x: cx + x1 * scale, y: cy - y2 * scale, depth: z2 }
}

function Stat({ label, value }: { label: string, value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-medium truncate">{value}</div>
    </div>
  )
}

function methodColor(method: string): string {
  switch (method) {
    case 'GET': return '#22c55e'
    case 'POST': return '#3b82f6'
    case 'DELETE': return '#ef4444'
    case 'PUT':
    case 'PATCH': return '#f59e0b'
    default: return '#888'
  }
}

function statusColor(status: number): string {
  if (status >= 500) return '#ef4444'
  if (status >= 400) return '#f59e0b'
  if (status >= 300) return '#a855f7'
  return '#22c55e'
}
