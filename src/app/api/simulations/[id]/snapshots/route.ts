// ============================================================================
// /api/simulations/[id]/snapshots — list trajectory snapshots for charting
// ============================================================================
// GET /api/simulations/[id]/snapshots?limit=200  → snapshots ordered by step
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditApiCall, auditContextFromHeaders } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const path = `/api/simulations/${id}/snapshots`
  try {
    const url = req.nextUrl
    const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get('limit') ?? 200)))
    const snapshots = await db.trajectorySnapshot.findMany({
      where: { simulationId: id },
      orderBy: { step: 'asc' },
      take: limit,
      select: {
        step: true,
        energy: true,
        momentumMag: true,
        angularMag: true,
        // Omit positionsJson for the list endpoint (huge payload)
      },
    })
    await auditApiCall(auditContextFromHeaders(
      req.headers, 'GET', path, 200, id,
    ))
    return NextResponse.json({ snapshots, count: snapshots.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await auditApiCall(auditContextFromHeaders(
      req.headers, 'GET', path, 500, id, msg,
    ))
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
