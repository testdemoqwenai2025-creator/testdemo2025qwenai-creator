// ============================================================================
// /api/simulations/[id] — fetch and delete a single simulation
// ============================================================================
// GET    /api/simulations/[id]   → simulation + bodies + latest snapshot
// DELETE /api/simulations/[id]   → delete simulation (cascade bodies, snapshots)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditApiCall, auditContextFromHeaders } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET ───────────────────────────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
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
        req.headers, 'GET', `/api/simulations/${id}`, 404, id, 'not found',
      ))
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    await auditApiCall(auditContextFromHeaders(
      req.headers, 'GET', `/api/simulations/${id}`, 200, id,
    ))
    return NextResponse.json({ simulation: sim })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await auditApiCall(auditContextFromHeaders(
      req.headers, 'GET', `/api/simulations/${id}`, 500, id, msg,
    ))
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    // Cascading delete is configured in the Prisma schema (onDelete: Cascade).
    await db.simulation.delete({ where: { id } })
    await auditApiCall(auditContextFromHeaders(
      req.headers, 'DELETE', `/api/simulations/${id}`, 200, id,
    ))
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await auditApiCall(auditContextFromHeaders(
      req.headers, 'DELETE', `/api/simulations/${id}`, 500, id, msg,
    ))
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
