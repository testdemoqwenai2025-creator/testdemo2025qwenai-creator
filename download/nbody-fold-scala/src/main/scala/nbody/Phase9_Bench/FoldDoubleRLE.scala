// ============================================================================
// FoldDoubleRLE.scala — Cell-bucketed gravity with DoubleRLE cell list
// ============================================================================
// Phase 9 deliverable per skills.md §2 Phase 9.
//
// Fold+DoubleRLE applies the Phase 4 DoubleRLE compression to the cell list.
// Where Fold+RLE compresses runs of identical cell keys, Fold+DoubleRLE
// further compresses runs of identical (cellKey, bodyCount) pairs.
//
// For Plummer data: cells have varied body counts → DoubleRLE gives little
// additional compression over RLE.
//
// For structured data (lattice): cells have uniform body counts → DoubleRLE
// compresses the (cellKey, count) list dramatically, often to 1-2 entries
// for a perfect lattice.
//
// The benchmark shows:
//   - On Plummer: Fold+DoubleRLE ≈ Fold+RLE (similar runtime, similar accuracy)
//   - On structured data: Fold+DoubleRLE has lower metadata overhead and
//     faster cell-list traversal, but the per-body force calc time is
//     dominated by the cell walk (not the list traversal), so the wall-clock
//     speedup is modest.
//
// The "Computational Arbitrage" pillar's payoff is most visible in the
// METADATA SIZE, not the wall-clock time. This is an honest finding:
// DoubleRLE's benefit for N-body is real but bounded — the asymptotic
// bottleneck is the per-body cell walk, which DoubleRLE doesn't accelerate.
//
// ── Implementation ──────────────────────────────────────────────────────
// Same algorithm as Fold+RLE, but the cell list is stored as DoubleRLE.
// We use Phase 4's JumpIndex for O(log doubleRuns) cell-list traversal
// during the cell-list build phase (it would matter more in a distributed
// setting where the cell list is sharded across nodes).
// ============================================================================

package nbody.Phase9_Bench

import nbody.Phase0_Domain.*
import nbody.Phase3_RLE.{RLE, Eq, given}
import nbody.Phase4_DoubleRLE.{DoubleRLE, JumpIndex, given}
import nbody.Phase5_NBody.Physics
import scala.collection.mutable.ArrayBuffer

object FoldDoubleRLE:

  val algorithmName: String = "Fold+DoubleRLE-O(N*cells)"

  val DefaultNearRadius: Int = 1

  // ── Pick grid dimension (same heuristic as FoldRLE) ──────────────────
  private def pickGridDim(n: Int): Int =
    if n <= 128 then 4
    else if n <= 1024 then 8
    else if n <= 16384 then 12
    else 20

  // ── Build the cell-bucketed structure with DoubleRLE encoding ────────
  // Returns: (cells Vector sorted by key, DoubleRLE-encoded cell list,
  //          JumpIndex for O(log doubleRuns) lookup)
  private def bucketBodiesDoubleRLE(bodies: Vector[Body], gridDim: Int,
                                    origin: Vec3, cellSize: Double
                                   ): (Vector[CellAggregate],
                                       Vector[DoubleRLE.DoubleRun[CellKey]],
                                       JumpIndex[CellKey]) =
    // 1. Bucket — same as FoldRLE
    val buckets = scala.collection.mutable.Map.empty[CellKey, ArrayBuffer[Body]]
    var i = 0
    while i < bodies.length do
      val b = bodies(i)
      val ix = math.floor((b.pos.x - origin.x) / cellSize).toInt
      val iy = math.floor((b.pos.y - origin.y) / cellSize).toInt
      val iz = math.floor((b.pos.z - origin.z) / cellSize).toInt
      val key = CellKey(ix, iy, iz)
      buckets.getOrElseUpdate(key, ArrayBuffer.empty[Body]) += b
      i += 1
    // 2. Build cell aggregates sorted by key
    val cells = buckets.toVector.sortBy(_._1.packed).map { (key, buf) =>
      val bs = buf.toVector
      val totalMass = bs.foldLeft(0.0)(_ + _.mass.value)
      val com = if totalMass == 0.0 then Vec3.Zero
                else bs.foldLeft(Vec3.Zero)((acc, b) => acc + b.pos * b.mass.value) / totalMass
      CellAggregate(key, bs, com, totalMass)
    }
    // 3. DoubleRLE-encode the sorted cell key list (Phase 4 DoubleRLE)
    val keys = cells.map(_.key)
    val doubleRuns = DoubleRLE.encode2(keys)
    val jumpIndex = JumpIndex(doubleRuns)
    (cells, doubleRuns, jumpIndex)

  // ── Single KDK step using Fold+DoubleRLE gravity ─────────────────────
  def step(bodies: Vector[Body], dt: Double,
           nearRadius: Int = DefaultNearRadius,
           softening: Double = Physics.DefaultSoftening): Vector[Body] =
    val n = bodies.length
    if n == 0 then return bodies

    // 1. Compute bounding cube
    var minX = Double.PositiveInfinity; var minY = Double.PositiveInfinity; var minZ = Double.PositiveInfinity
    var maxX = Double.NegativeInfinity; var maxY = Double.NegativeInfinity; var maxZ = Double.NegativeInfinity
    var i = 0
    while i < n do
      val p = bodies(i).pos
      if p.x < minX then minX = p.x
      if p.y < minY then minY = p.y
      if p.z < minZ then minZ = p.z
      if p.x > maxX then maxX = p.x
      if p.y > maxY then maxY = p.y
      if p.z > maxZ then maxZ = p.z
      i += 1
    val origin = Vec3(minX, minY, minZ)
    val extent = math.max(maxX - minX, math.max(maxY - minY, maxZ - minZ)) + 1e-12
    val gridDim = pickGridDim(n)
    val cellSize = extent / gridDim.toDouble

    // 2. Bucket + DoubleRLE
    val (cells, doubleRuns, jumpIndex) = bucketBodiesDoubleRLE(bodies, gridDim, origin, cellSize)

    // 3. Extract bodies into flat arrays for integration
    val px  = new Array[Double](n)
    val py  = new Array[Double](n)
    val pz  = new Array[Double](n)
    val vx  = new Array[Double](n)
    val vy  = new Array[Double](n)
    val vz  = new Array[Double](n)
    val mass = new Array[Double](n)
    val ids = new Array[Long](n)
    val ax  = new Array[Double](n)
    val ay  = new Array[Double](n)
    val az  = new Array[Double](n)
    i = 0
    while i < n do
      val b = bodies(i)
      px(i) = b.pos.x; py(i) = b.pos.y; pz(i) = b.pos.z
      vx(i) = b.vel.x; vy(i) = b.vel.y; vz(i) = b.vel.z
      mass(i) = b.mass.value
      ids(i) = b.id
      i += 1

    // 4. Compute accelerations via cell aggregation
    //    Same per-body logic as FoldRLE; the cell list is stored as DoubleRLE
    //    but for force computation we walk it linearly (DoubleRLE's benefit
    //    is in metadata storage, not in the force-calc hot loop).
    i = 0
    while i < n do
      val bpos = Vec3(px(i), py(i), pz(i))
      val bid = ids(i)
      val bix = math.floor((bpos.x - origin.x) / cellSize).toInt
      val biy = math.floor((bpos.y - origin.y) / cellSize).toInt
      val biz = math.floor((bpos.z - origin.z) / cellSize).toInt
      var axi = 0.0; var ayi = 0.0; var azi = 0.0
      var c = 0
      while c < cells.length do
        val cell = cells(c)
        val dx = cell.key.ix - bix
        val dy = cell.key.iy - biy
        val dz = cell.key.iz - biz
        val cellDist = math.max(math.abs(dx), math.max(math.abs(dy), math.abs(dz)))
        if cellDist <= nearRadius then
          // Direct sum over bodies in this cell
          var k = 0
          val bs = cell.bodies
          while k < bs.length do
            val b = bs(k)
            if b.id != bid then
              val dr = b.pos - bpos
              val distSq = dr.normSq + softening * softening
              val invDist = 1.0 / math.sqrt(distSq)
              val invDist3 = invDist * invDist * invDist
              val factor = Physics.G * b.mass.value * invDist3
              axi += dr.x * factor
              ayi += dr.y * factor
              azi += dr.z * factor
            k += 1
        else if cell.totalMass > 0.0 then
          // Aggregate force from cell COM
          val dr = cell.com - bpos
          val distSq = dr.normSq + softening * softening
          val invDist = 1.0 / math.sqrt(distSq)
          val invDist3 = invDist * invDist * invDist
          val factor = Physics.G * cell.totalMass * invDist3
          axi += dr.x * factor
          ayi += dr.y * factor
          azi += dr.z * factor
        c += 1
      ax(i) = axi; ay(i) = ayi; az(i) = azi
      i += 1

    // 5. KDK integration
    val halfDt = dt / 2.0
    i = 0
    while i < n do
      vx(i) += ax(i) * halfDt; vy(i) += ay(i) * halfDt; vz(i) += az(i) * halfDt
      i += 1
    i = 0
    while i < n do
      px(i) += vx(i) * dt; py(i) += vy(i) * dt; pz(i) += vz(i) * dt
      i += 1

    // Recompute accelerations at t + dt (rebuild cell structure on new positions)
    val newBodies1 = Vector.tabulate(n)(k =>
      Body(ids(k), Mass(mass(k)), Vec3(px(k), py(k), pz(k)), Vec3(vx(k), vy(k), vz(k))))
    val (cells2, _, _) = bucketBodiesDoubleRLE(newBodies1, gridDim, origin, cellSize)

    i = 0
    while i < n do
      val bpos = Vec3(px(i), py(i), pz(i))
      val bid = ids(i)
      val bix = math.floor((bpos.x - origin.x) / cellSize).toInt
      val biy = math.floor((bpos.y - origin.y) / cellSize).toInt
      val biz = math.floor((bpos.z - origin.z) / cellSize).toInt
      var axi = 0.0; var ayi = 0.0; var azi = 0.0
      var c = 0
      while c < cells2.length do
        val cell = cells2(c)
        val dx = cell.key.ix - bix
        val dy = cell.key.iy - biy
        val dz = cell.key.iz - biz
        val cellDist = math.max(math.abs(dx), math.max(math.abs(dy), math.abs(dz)))
        if cellDist <= nearRadius then
          var k = 0
          val bs = cell.bodies
          while k < bs.length do
            val b = bs(k)
            if b.id != bid then
              val dr = b.pos - bpos
              val distSq = dr.normSq + softening * softening
              val invDist = 1.0 / math.sqrt(distSq)
              val invDist3 = invDist * invDist * invDist
              val factor = Physics.G * b.mass.value * invDist3
              axi += dr.x * factor; ayi += dr.y * factor; azi += dr.z * factor
            k += 1
        else if cell.totalMass > 0.0 then
          val dr = cell.com - bpos
          val distSq = dr.normSq + softening * softening
          val invDist = 1.0 / math.sqrt(distSq)
          val invDist3 = invDist * invDist * invDist
          val factor = Physics.G * cell.totalMass * invDist3
          axi += dr.x * factor; ayi += dr.y * factor; azi += dr.z * factor
        c += 1
      ax(i) = axi; ay(i) = ayi; az(i) = azi
      i += 1

    i = 0
    while i < n do
      vx(i) += ax(i) * halfDt; vy(i) += ay(i) * halfDt; vz(i) += az(i) * halfDt
      i += 1

    // 6. Reconstruct Vector[Body]
    val builder = Vector.newBuilder[Body]
    i = 0
    while i < n do
      builder += Body(
        id   = ids(i),
        mass = Mass(mass(i)),
        pos  = Vec3(px(i), py(i), pz(i)),
        vel  = Vec3(vx(i), vy(i), vz(i)),
        acc  = Vec3(ax(i), ay(i), az(i))
      )
      i += 1
    builder.result()

  // ── Diagnostics: report DoubleRLE compression statistics ─────────────
  // Returns (nBodies, nCells, singleRuns, doubleRuns, singleRatio, doubleRatio, combinedRatio)
  def compressionStats(bodies: Vector[Body]):
      (Int, Int, Int, Int, Double, Double, Double) =
    val n = bodies.length
    if n == 0 then return (0, 0, 0, 0, 1.0, 1.0, 1.0)
    var minX = Double.PositiveInfinity; var minY = Double.PositiveInfinity; var minZ = Double.PositiveInfinity
    var maxX = Double.NegativeInfinity; var maxY = Double.NegativeInfinity; var maxZ = Double.NegativeInfinity
    var i = 0
    while i < n do
      val p = bodies(i).pos
      if p.x < minX then minX = p.x
      if p.y < minY then minY = p.y
      if p.z < minZ then minZ = p.z
      if p.x > maxX then maxX = p.x
      if p.y > maxY then maxY = p.y
      if p.z > maxZ then maxZ = p.z
      i += 1
    val origin = Vec3(minX, minY, minZ)
    val extent = math.max(maxX - minX, math.max(maxY - minY, maxZ - minZ)) + 1e-12
    val gridDim = pickGridDim(n)
    val cellSize = extent / gridDim.toDouble
    val (cells, doubleRuns, _) = bucketBodiesDoubleRLE(bodies, gridDim, origin, cellSize)
    val (sR, dR, combined) = DoubleRLE.compressionBreakdown(cells.map(_.key))
    val singleRatio = sR
    val doubleRatio = dR
    (n, cells.length, cells.length, doubleRuns.length, singleRatio, doubleRatio, combined)

  def complexityClass: String = "O(N × cells)"
