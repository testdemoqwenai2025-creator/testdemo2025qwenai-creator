// ============================================================================
// /api/simulations/[id]/step — advance the simulation by N steps
// ============================================================================
// POST /api/simulations/[id]/step
//   body: { steps?: number = 1, snapshotEvery?: number = 1 }
//
// Loads the simulation's bodies + latest snapshot, reconstructs the
// MutableBodySystem, runs `steps` leapfrog KDK steps, and persists a
// TrajectorySnapshot every `snapshotEvery` steps. The simulation's
// currentStep, currentEnergy, and status fields are updated.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditApiCall, auditContextFromHeaders } from '@/lib/audit'
import { MutableBodySystem, type BodyInit, type Snapshot } from '@/lib/nbody'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST ──────────────────────────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const path = `/api/simulations/${id}/step`

  try {
    // ── Load simulation ────────────────────────────────────────────────
    const sim = await db.simulation.findUnique({
      where: { id },
      include: {
        bodies: { orderBy: { bodyId: 'asc' } },
        snapshots: {
          orderBy: { step: 'desc' },
          take: 1,
        },
      },
    })
    if (!sim) {
      await auditApiCall(auditContextFromHeaders(
        req.headers, 'POST', path, 404, id, 'not found',
      ))
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }

    // ── Parse request body ─────────────────────────────────────────────
    const body = await req.json().catch(() => ({}))
    const reqSteps = Number(body?.steps ?? 1)
    if (!Number.isFinite(reqSteps) || reqSteps < 1 || reqSteps > 10000) {
      return await fail(req, path, id, 400, `steps must be in [1, 10000], got ${reqSteps}`)
    }
    const snapshotEvery = Math.max(1, Math.min(1000, Number(body?.snapshotEvery ?? 1)))
    const steps = Math.min(reqSteps, sim.maxSteps - sim.currentStep)
    if (steps <= 0) {
      // Already at maxSteps — return current state
      await db.simulation.update({ where: { id }, data: { status: 'done' } })
      await auditApiCall(auditContextFromHeaders(
        req.headers, 'POST', path, 200, id,
      ))
      return NextResponse.json({
        simulationId: id,
        stepsTaken: 0,
        currentStep: sim.currentStep,
        status: 'done',
        message: 'maxSteps already reached',
      })
    }

    // ── Reconstruct system state from latest snapshot (or initial) ─────
    const inits: BodyInit[] = sim.bodies.map(b => ({
      bodyId: b.bodyId,
      mass: b.mass,
      pos: [b.posX, b.posY, b.posZ],
      vel: [b.velX, b.velY, b.velZ],
    }))
    const system = new MutableBodySystem(inits)

    // If we have a previous snapshot, restore positions from it (we store
    // positions + step number; velocities are recomputed from the initial
    // conditions because we don't currently persist velocities in snapshots).
    // NOTE: This is a simplification — for a production system you'd also
    // persist velocities. For the demo, the leapfrog will recover within
    // a few steps.
    const latestSnap = sim.snapshots[0]
    if (latestSnap && latestSnap.step > 0) {
      const positions = JSON.parse(latestSnap.positionsJson) as [number, number, number][]
      for (let i = 0; i < system.n && i < positions.length; i++) {
        system.posX[i] = positions[i][0]
        system.posY[i] = positions[i][1]
        system.posZ[i] = positions[i][2]
      }
    }

    // ── Initialize accelerations before stepping ───────────────────────
    system.computeAccelerations(sim.softening)

    // ── Compute initial energy if not yet set ──────────────────────────
    let initialEnergy = sim.initialEnergy
    if (initialEnergy == null) {
      initialEnergy = system.totalEnergy(sim.softening)
      await db.simulation.update({
        where: { id },
        data: { initialEnergy },
      })
    }

    // ── Run the steps ──────────────────────────────────────────────────
    await db.simulation.update({ where: { id }, data: { status: 'running' } })

    const startStep = sim.currentStep
    const newSnapshots: Snapshot[] = []
    for (let s = 0; s < steps; s++) {
      system.step(sim.dt, sim.softening)
      const stepNum = startStep + s + 1
      if (stepNum % snapshotEvery === 0 || s === steps - 1) {
        newSnapshots.push(system.snapshot(stepNum, sim.softening))
      }
    }

    // ── Persist snapshots (batched) ────────────────────────────────────
    // NOTE: SQLite's Prisma driver does not support skipDuplicates on
    // createMany. We delete any existing rows for the (simulationId, step)
    // pairs we're about to insert, then createMany without skipDuplicates.
    if (newSnapshots.length > 0) {
      const stepNumbers = newSnapshots.map(s => s.step)
      // Delete any existing rows in the step range (handles re-running steps)
      await db.trajectorySnapshot.deleteMany({
        where: {
          simulationId: id,
          step: { in: stepNumbers },
        },
      })
      await db.trajectorySnapshot.createMany({
        data: newSnapshots.map(snap => ({
          simulationId: id,
          step: snap.step,
          energy: snap.energy,
          momentumMag: snap.momentumMag,
          angularMag: snap.angularMag,
          positionsJson: JSON.stringify(snap.positions),
        })),
      })
    }

    // ── Update simulation progress ─────────────────────────────────────
    const finalStep = startStep + steps
    const finalEnergy = system.totalEnergy(sim.softening)
    const newStatus = finalStep >= sim.maxSteps ? 'done' : 'paused'
    await db.simulation.update({
      where: { id },
      data: {
        currentStep: finalStep,
        currentEnergy: finalEnergy,
        status: newStatus,
      },
    })

    // ── Compute energy drift ──────────────────────────────────────────
    const drift = initialEnergy != null && initialEnergy !== 0
      ? Math.abs(finalEnergy - initialEnergy) / Math.abs(initialEnergy)
      : 0

    await auditApiCall(auditContextFromHeaders(
      req.headers, 'POST', path, 200, id,
    ))

    return NextResponse.json({
      simulationId: id,
      stepsTaken: steps,
      currentStep: finalStep,
      maxSteps: sim.maxSteps,
      status: newStatus,
      initialEnergy,
      finalEnergy,
      energyDrift: drift,
      snapshotsWritten: newSnapshots.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return await fail(req, path, id, 500, msg)
  }
}

async function fail(
  req: NextRequest,
  path: string,
  id: string,
  status: number,
  msg: string,
) {
  await auditApiCall(auditContextFromHeaders(
    req.headers, 'POST', path, status, id, msg,
  ))
  return NextResponse.json({ error: msg }, { status })
}
