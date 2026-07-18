// ============================================================================
// src/lib/audit.ts — Server-side audit log writer
// ============================================================================
// Called by API route handlers AFTER they finish computing the response.
// Reads the audit headers stamped by middleware (start-ms, ip-hash, api-key)
// and writes one row to the ApiAudit table.
//
// Why this split: Next.js Edge middleware cannot use Prisma directly
// (Prisma needs Node runtime). So the middleware stamps headers, and the
// route handler (which runs on Node runtime) writes the DB row.
// ============================================================================

import { db } from '@/lib/db'

export interface AuditContext {
  method: string
  path: string
  status: number
  latencyMs: number
  ipHash?: string | null
  apiKey?: string | null
  simulationId?: string | null
  error?: string | null
  userAgent?: string | null
}

/** Write an audit row. Failures are swallowed (audit must not break the request). */
export async function auditApiCall(ctx: AuditContext): Promise<void> {
  try {
    await db.apiAudit.create({
      data: {
        method: ctx.method,
        path: ctx.path,
        status: ctx.status,
        latencyMs: ctx.latencyMs,
        ipHash: ctx.ipHash ?? null,
        apiKey: ctx.apiKey ?? null,
        simulationId: ctx.simulationId ?? null,
        error: ctx.error ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    })
  } catch (err) {
    // Swallow — audit failure must not propagate to the caller
    console.error('[audit] failed to write audit row:', err)
  }
}

/** Parse the audit headers stamped by middleware into an AuditContext. */
export function auditContextFromHeaders(
  reqHeaders: Headers,
  method: string,
  path: string,
  status: number,
  simulationId?: string | null,
  error?: string | null,
): AuditContext {
  const startMs = Number(reqHeaders.get('x-nbody-start-ms') ?? Date.now())
  return {
    method,
    path,
    status,
    latencyMs: Date.now() - startMs,
    ipHash: reqHeaders.get('x-nbody-ip-hash') ?? null,
    apiKey: reqHeaders.get('x-nbody-api-key') ?? null,
    userAgent: reqHeaders.get('user-agent') ?? null,
    simulationId: simulationId ?? null,
    error: error ?? null,
  }
}
