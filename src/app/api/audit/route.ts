// ============================================================================
// /api/audit — list recent audit log entries (for the frontend's Audit panel)
// ============================================================================
// GET /api/audit?limit=50  → most recent audit rows (newest first)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditApiCall, auditContextFromHeaders } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? 50)))
    const audits = await db.apiAudit.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    await auditApiCall(auditContextFromHeaders(
      req.headers, 'GET', '/api/audit', 200,
    ))
    return NextResponse.json({ audits, count: audits.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await auditApiCall(auditContextFromHeaders(
      req.headers, 'GET', '/api/audit', 500, null, msg,
    ))
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
