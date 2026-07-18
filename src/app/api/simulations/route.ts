// ============================================================================
// /api/simulations — list and create simulations
// ============================================================================
// GET  /api/simulations         → list all simulations (most recent first)
// POST /api/simulations         → create a new simulation with initial conditions
//                                 body: { name, description?, generatorType, bodyCount, dt, softening, algorithm, maxSteps, seed }
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditApiCall, auditContextFromHeaders } from '@/lib/audit'
import { generateInitialConditions } from '@/lib/nbody'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/simulations ─────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const startedAt = Date.now()
  try {
    const sims = await db.simulation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        _count: { select: { bodies: true, snapshots: true } },
      },
    })
    const res = NextResponse.json({ simulations: sims })
    await auditApiCall(auditContextFromHeaders(
      req.headers, 'GET', '/api/simulations', 200,
    ))
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const res = NextResponse.json({ error: msg }, { status: 500 })
    await auditApiCall(auditContextFromHeaders(
      req.headers, 'GET', '/api/simulations', 500, null, msg,
    ))
    return res
  }
}

// ── POST /api/simulations ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      name, description,
      generatorType, bodyCount, dt, softening, algorithm, maxSteps, seed,
    } = body ?? {}

    // ── Validate ──────────────────────────────────────────────────────
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return await fail(req, 400, 'name is required', null)
    }
    if (!['plummer', 'lattice', 'two-body'].includes(generatorType)) {
      return await fail(req, 400, `generatorType must be plummer|lattice|two-body, got ${generatorType}`, null)
    }
    const n = Number(bodyCount)
    if (!Number.isFinite(n) || n < 1 || n > 5000) {
      return await fail(req, 400, `bodyCount must be in [1, 5000], got ${n}`, null)
    }
    const dtN = Number(dt)
    if (!Number.isFinite(dtN) || dtN <= 0 || dtN > 1) {
      return await fail(req, 400, `dt must be in (0, 1], got ${dtN}`, null)
    }
    const softN = Number(softening)
    if (!Number.isFinite(softN) || softN < 0 || softN > 1) {
      return await fail(req, 400, `softening must be in [0, 1], got ${softN}`, null)
    }
    const maxStepsN = Number(maxSteps ?? 1000)
    if (!Number.isFinite(maxStepsN) || maxStepsN < 1 || maxStepsN > 100000) {
      return await fail(req, 400, `maxSteps must be in [1, 100000], got ${maxStepsN}`, null)
    }
    const seedN = Number(seed ?? 1)

    // ── Generate initial conditions ───────────────────────────────────
    const bodies = generateInitialConditions(generatorType, n, seedN)

    // ── Persist ───────────────────────────────────────────────────────
    const sim = await db.simulation.create({
      data: {
        name: name.trim(),
        description: description ?? null,
        bodyCount: bodies.length,
        dt: dtN,
        softening: softN,
        algorithm: algorithm ?? 'brute-force',
        maxSteps: maxStepsN,
        status: 'created',
        bodies: {
          create: bodies.map(b => ({
            bodyId: b.bodyId,
            mass: b.mass,
            posX: b.pos[0], posY: b.pos[1], posZ: b.pos[2],
            velX: b.vel[0], velY: b.vel[1], velZ: b.vel[2],
          })),
        },
      },
      include: { bodies: true },
    })

    const res = NextResponse.json({ simulation: sim }, { status: 201 })
    await auditApiCall(auditContextFromHeaders(
      req.headers, 'POST', '/api/simulations', 201, sim.id,
    ))
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return await fail(req, 500, msg, null)
  }
}

async function fail(req: NextRequest, status: number, msg: string, simId: string | null) {
  await auditApiCall(auditContextFromHeaders(
    req.headers, 'POST', '/api/simulations', status, simId, msg,
  ))
  return NextResponse.json({ error: msg }, { status })
}
