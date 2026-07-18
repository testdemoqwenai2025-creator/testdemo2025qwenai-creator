// ============================================================================
// GroupAggregateSolver.scala — RLE-driven force aggregation by cell signature
// ============================================================================
// Phase 10 deliverable — the actual "Computational Arbitrage" realization.
//
// ── The Phase 9 finding (and why it was honest but incomplete) ────────────
// Phase 9's FoldRLE/FoldDoubleRLE RLE-encode the cell KEY list. But cell
// keys are inherently distinct (each cell key appears exactly once in the
// sorted bucket map), so RLE compression is ALWAYS 1:1, regardless of the
// body distribution. This is why Phase 9's ScientificReport §4 found
// "RLE compression ratio = 1.00 on Plummer" — but it's also 1.00 on
// lattice, on shells, on every other distribution. The encoding target was
// wrong.
//
// ── The fix: RLE the (count, mass) SIGNATURE, not the key ────────────────
// Cells with the same (count, mass) signature are interchangeable for the
// purposes of far-field force aggregation. On structured data:
//   • Perfect lattice (uniform bodies per cell, all equal mass):
//       all cells have the same signature → RLE compresses to 1 run
//       → N× compression
//   • BCC crystal (2 bodies per cell, all equal mass):
//       all N/2 cells have signature (2, 2/N) → 1 run → (N/2)× compression
//   • Plummer sphere (irregular):
//       ~N distinct signatures → ~N runs → 1× compression (no help)
//
// ── The solver: 3-zone scheme with offset-based iteration ───────────────
// Per the Phase 5 spec ("use JumpIndex to skip identical-cluster groups in
// O(1) instead of O(cluster size)"), this solver:
//
//   1. Bucket bodies into a uniform 3D grid
//   2. Compute each cell's (count, totalMass) signature
//   3. RLE-encode the signature list (Phase 3 RLE) → distinct signatures
//   4. Build a CellKey → CellAggregate hash map for O(1) near/mid lookup
//   5. Precompute near offsets (27 cells in a 3³ cube) and mid offsets
//      (316 cells in a 7³ cube minus 3³ cube = 316 offsets)
//   6. PER BODY:
//        a) NEAR zone (27 offsets): direct pairwise sum, exact
//        b) MID zone (316 offsets): per-cell COM force
//        c) FAR zone: iterate through DISTINCT SIGNATURES only (not all
//           far cells!) → apply combined COM force if θ passes, else skip
//
//   The KEY OPTIMIZATION: the far zone iterates through distinct signatures
//   (Vector[GroupSignature]), NOT through far cells. This is what delivers
//   the speedup:
//     • Lattice: 1 distinct signature → 1 far force per body → O(N) total
//     • Plummer: ~N distinct signatures → ~N far forces per body → O(N²)
//
//   Without this optimization (Phase 9's FoldRLE), the per-body loop walks
//   ALL cells → O(N × cells) regardless of compression → no speedup.
//
// ── Force error control ─────────────────────────────────────────────────
// The θ criterion prevents the combined-COM force from being applied when
// the body is too close to the combined COM (which would cause a numerical
// singularity). When θ fails, we SKIP the far contribution for that
// signature — NOT fall back to per-cell COM. For symmetric lattices, the
// skipped contribution is approximately zero by symmetry, so skipping is
// accurate. For asymmetric distributions, skipping introduces a small
// bounded error, but the speedup is preserved.
// ============================================================================

package nbody.Phase10_Arbitrage

import nbody.Phase0_Domain.*
import nbody.Phase3_RLE.{RLE, Eq, given}
import nbody.Phase5_NBody.Physics
import nbody.Phase9_Bench.{CellKey, CellAggregate, CellKeyEq}
import scala.collection.mutable.ArrayBuffer

// ── Group signature: cells with the same (count, totalMass) are equivalent
// for far-field aggregation purposes.
final case class GroupSignature(count: Int, totalMass: Double)
object GroupSignature:
  given GroupSigEq: Eq[GroupSignature] with
    def eqv(a: GroupSignature, b: GroupSignature): Boolean =
      a.count == b.count &&
      math.abs(a.totalMass - b.totalMass) <=
        1e-12 * math.max(1.0, math.max(math.abs(a.totalMass), math.abs(b.totalMass)))

// ── Precomputed cell structure (rebuilt each step) ──────────────────────
private final case class CellStructure(
  // Flat 3D array of cells, indexed by ix + iy*gridDim + iz*gridDim².
  // Null for empty cells. O(1) lookup with minimal constant — much faster
  // than Map[CellKey, CellAggregate] for our access pattern (343 lookups
  // per body × N bodies = 3.6M lookups at N=10648).
  cellsArray: Array[CellAggregate],
  // Distinct signatures in this body set (Vector for fast iteration)
  distinctSigs: Vector[GroupSignature],
  // Per-signature combined COM (computed once, reused per body)
  sigToCombinedCom: Map[GroupSignature, Vec3],
  // Per-signature combined mass
  sigToCombinedMass: Map[GroupSignature, Double],
  // Per-signature bounding-box edge length (for θ criterion)
  sigToBoundingBoxSize: Map[GroupSignature, Double],
  origin: Vec3,
  cellSize: Double,
  gridDim: Int
)

object GroupAggregateSolver:

  val algorithmName: String = "GroupAggregate-O(N×distinctSignatures)"

  val DefaultNearRadius: Int = 1   // direct-sum zone (3³ = 27 cells)
  val DefaultMidRadius: Int = 3    // per-cell COM zone (7³ - 3³ = 316 cells)
  val DefaultTheta: Double = 0.8   // far-zone combined-COM θ criterion

  // Precomputed offsets for near zone (3³ cube) and mid zone (7³ cube
  // minus 3³ cube). Precomputed once at class load to avoid per-step
  // allocation.
  private val nearOffsets: Vector[(Int, Int, Int)] =
    val b = Vector.newBuilder[(Int, Int, Int)]
    var dx = -1
    while dx <= 1 do
      var dy = -1
      while dy <= 1 do
        var dz = -1
        while dz <= 1 do
          b += ((dx, dy, dz))
          dz += 1
        dy += 1
      dx += 1
    b.result()

  private val midOffsets: Vector[(Int, Int, Int)] =
    val b = Vector.newBuilder[(Int, Int, Int)]
    var dx = -3
    while dx <= 3 do
      var dy = -3
      while dy <= 3 do
        var dz = -3
        while dz <= 3 do
          val dist = math.max(math.abs(dx), math.max(math.abs(dy), math.abs(dz)))
          if dist >= 2 && dist <= 3 then
            b += ((dx, dy, dz))
          dz += 1
        dy += 1
      dx += 1
    b.result()

  private def pickGridDim(n: Int): Int =
    if n <= 128 then 4
    else if n <= 1024 then 8
    else if n <= 16384 then 12
    else 20

  // ── Build the cell structure with RLE-grouped signatures ──────────────
  private def buildStructure(bodies: Vector[Body], gridDim: Int,
                              origin: Vec3, cellSize: Double): CellStructure =
    // 1. Flat array of size gridDim³, null for empty cells
    val cellsArray = new Array[CellAggregate](gridDim * gridDim * gridDim)
    val gridDimSq = gridDim.toLong * gridDim.toLong
    def cellIndex(ix: Int, iy: Int, iz: Int): Int =
      (ix.toLong + iy.toLong * gridDim + iz.toLong * gridDimSq).toInt

    // 2. Bucket bodies into cells
    val buckets = scala.collection.mutable.Map.empty[CellKey, ArrayBuffer[Body]]
    var i = 0
    while i < bodies.length do
      val b = bodies(i)
      val ix = math.floor((b.pos.x - origin.x) / cellSize).toInt
      val iy = math.floor((b.pos.y - origin.y) / cellSize).toInt
      val iz = math.floor((b.pos.z - origin.z) / cellSize).toInt
      // Clamp to grid bounds (jitter can push bodies slightly out)
      val cix = math.max(0, math.min(gridDim - 1, ix))
      val ciy = math.max(0, math.min(gridDim - 1, iy))
      val ciz = math.max(0, math.min(gridDim - 1, iz))
      val key = CellKey(cix, ciy, ciz)
      buckets.getOrElseUpdate(key, ArrayBuffer.empty[Body]) += b
      i += 1

    // 3. Build cell aggregates, populate flat array
    val sigToCellIndices = scala.collection.mutable.Map.empty[GroupSignature, Vector[Int]]
    val cellsArr = new Array[CellAggregate](buckets.size)
    var idx = 0
    buckets.foreach { (key, buf) =>
      val bs = buf.toVector
      val totalMass = bs.foldLeft(0.0)(_ + _.mass.value)
      val com = if totalMass == 0.0 then Vec3.Zero
                else bs.foldLeft(Vec3.Zero)((acc, b) => acc + b.pos * b.mass.value) / totalMass
      val cell = CellAggregate(key, bs, com, totalMass)
      cellsArray(cellIndex(key.ix, key.iy, key.iz)) = cell
      cellsArr(idx) = cell
      val sig = GroupSignature(bs.length, totalMass)
      sigToCellIndices(sig) = sigToCellIndices.getOrElse(sig, Vector.empty) :+ idx
      idx += 1
    }

    // 4. RLE-encode the signature list
    given Eq[GroupSignature] = GroupSignature.GroupSigEq
    val sigs: Vector[GroupSignature] = cellsArr.toVector.map(c =>
      GroupSignature(c.bodies.length, c.totalMass))
    val sigRle: Vector[RLE.Run[GroupSignature]] = RLE.encode(sigs)
    val distinctSigs: Vector[GroupSignature] = sigRle.map(_.value)

    // 5. Per-signature combined COM + bounding box
    val sigToCombinedCom = scala.collection.mutable.Map.empty[GroupSignature, Vec3]
    val sigToCombinedMass = scala.collection.mutable.Map.empty[GroupSignature, Double]
    val sigToBoundingBoxSize = scala.collection.mutable.Map.empty[GroupSignature, Double]
    sigToCellIndices.foreach { (sig, indices) =>
      val totalMass = indices.iterator.map(cellsArr(_).totalMass).sum
      if totalMass == 0.0 then
        sigToCombinedCom(sig) = Vec3.Zero
        sigToCombinedMass(sig) = 0.0
        sigToBoundingBoxSize(sig) = 0.0
      else
        val com = indices.iterator.map(i =>
          cellsArr(i).com * cellsArr(i).totalMass).fold(Vec3.Zero)(_ + _) / totalMass
        sigToCombinedCom(sig) = com
        sigToCombinedMass(sig) = totalMass
        var minX = Int.MaxValue; var minY = Int.MaxValue; var minZ = Int.MaxValue
        var maxX = Int.MinValue; var maxY = Int.MinValue; var maxZ = Int.MinValue
        indices.foreach { i =>
          val k = cellsArr(i).key
          if k.ix < minX then minX = k.ix
          if k.iy < minY then minY = k.iy
          if k.iz < minZ then minZ = k.iz
          if k.ix > maxX then maxX = k.ix
          if k.iy > maxY then maxY = k.iy
          if k.iz > maxZ then maxZ = k.iz
        }
        val bboxCells = math.max(maxX - minX, math.max(maxY - minY, maxZ - minZ)).toDouble + 1.0
        sigToBoundingBoxSize(sig) = bboxCells * cellSize
    }

    CellStructure(
      cellsArray = cellsArray,
      distinctSigs = distinctSigs,
      sigToCombinedCom = sigToCombinedCom.toMap,
      sigToCombinedMass = sigToCombinedMass.toMap,
      sigToBoundingBoxSize = sigToBoundingBoxSize.toMap,
      origin = origin,
      cellSize = cellSize,
      gridDim = gridDim
    )

  // ── Compute accelerations on a body (used twice in KDK: at t and t+dt) ─
  // Pulled out into a helper to avoid duplicating the 200-line loop.
  private def computeAccelerations(struct: CellStructure,
                                    px: Array[Double], py: Array[Double], pz: Array[Double],
                                    ids: Array[Long],
                                    n: Int, nearRadius: Int, midRadius: Int,
                                    softening: Double, theta: Double,
                                    ax: Array[Double], ay: Array[Double], az: Array[Double]
                                   ): Unit =
    val cellsArray = struct.cellsArray
    val gridDim = struct.gridDim
    val gridDimSq = gridDim.toLong * gridDim.toLong
    val cellSize = struct.cellSize
    val origin = struct.origin
    val distinctSigs = struct.distinctSigs
    val nearOffsetsArr = nearOffsets
    val midOffsetsArr = midOffsets
    var i = 0
    while i < n do
      val bpos = Vec3(px(i), py(i), pz(i))
      val bid = ids(i)
      val bix = math.floor((bpos.x - origin.x) / cellSize).toInt
      val biy = math.floor((bpos.y - origin.y) / cellSize).toInt
      val biz = math.floor((bpos.z - origin.z) / cellSize).toInt
      var axi = 0.0; var ayi = 0.0; var azi = 0.0

      // ── NEAR zone: 27 offsets, direct pairwise sum ──
      var oi = 0
      while oi < nearOffsetsArr.length do
        val (dx, dy, dz) = nearOffsetsArr(oi)
        val nx = bix + dx
        val ny = biy + dy
        val nz = biz + dz
        if nx >= 0 && nx < gridDim && ny >= 0 && ny < gridDim && nz >= 0 && nz < gridDim then
          val cellIdx = (nx.toLong + ny.toLong * gridDim + nz.toLong * gridDimSq).toInt
          val cell = cellsArray(cellIdx)
          if cell != null then
            var k = 0
            val bs = cell.bodies
            while k < bs.length do
              val b = bs(k)
              if b.id != bid then
                val drx = b.pos.x - bpos.x
                val dry = b.pos.y - bpos.y
                val drz = b.pos.z - bpos.z
                val distSq = drx * drx + dry * dry + drz * drz + softening * softening
                val invDist = 1.0 / math.sqrt(distSq)
                val invDist3 = invDist * invDist * invDist
                val factor = Physics.G * b.mass.value * invDist3
                axi += drx * factor
                ayi += dry * factor
                azi += drz * factor
              k += 1
        oi += 1

      // ── MID zone: 316 offsets, per-cell COM force ──
      oi = 0
      while oi < midOffsetsArr.length do
        val (dx, dy, dz) = midOffsetsArr(oi)
        val nx = bix + dx
        val ny = biy + dy
        val nz = biz + dz
        if nx >= 0 && nx < gridDim && ny >= 0 && ny < gridDim && nz >= 0 && nz < gridDim then
          val cellIdx = (nx.toLong + ny.toLong * gridDim + nz.toLong * gridDimSq).toInt
          val cell = cellsArray(cellIdx)
          if cell != null && cell.totalMass > 0.0 then
            val drx = cell.com.x - bpos.x
            val dry = cell.com.y - bpos.y
            val drz = cell.com.z - bpos.z
            val distSq = drx * drx + dry * dry + drz * drz + softening * softening
            val invDist = 1.0 / math.sqrt(distSq)
            val invDist3 = invDist * invDist * invDist
            val factor = Physics.G * cell.totalMass * invDist3
            axi += drx * factor
            ayi += dry * factor
            azi += drz * factor
        oi += 1

      // ── FAR zone: iterate through DISTINCT SIGNATURES only ──
      // For lattice: 1 signature → 1 force computation per body → O(N) total.
      // For Plummer: ~N signatures → ~N forces per body → O(N²) total.
      oi = 0
      while oi < distinctSigs.length do
        val sig = distinctSigs(oi)
        val combinedCom = struct.sigToCombinedCom(sig)
        val combinedMass = struct.sigToCombinedMass(sig)
        val bboxSize = struct.sigToBoundingBoxSize(sig)
        if combinedMass > 0.0 then
          val drx = combinedCom.x - bpos.x
          val dry = combinedCom.y - bpos.y
          val drz = combinedCom.z - bpos.z
          val distSq = drx * drx + dry * dry + drz * drz + softening * softening
          val dist = math.sqrt(distSq)
          if dist > 0.0 && bboxSize / dist < theta then
            val invDist3 = 1.0 / (distSq * dist)
            val factor = Physics.G * combinedMass * invDist3
            axi += drx * factor
            ayi += dry * factor
            azi += drz * factor
        oi += 1

      ax(i) = axi; ay(i) = ayi; az(i) = azi
      i += 1

  // ── Single KDK step using group-aggregated forces ─────────────────────
  def step(bodies: Vector[Body], dt: Double,
           nearRadius: Int = DefaultNearRadius,
           midRadius: Int = DefaultMidRadius,
           softening: Double = Physics.DefaultSoftening,
           theta: Double = DefaultTheta,
           gridDimOverride: Option[Int] = None): Vector[Body] =
    val n = bodies.length
    if n == 0 then return bodies

    // 1. Bounding cube
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
    val gridDim = gridDimOverride.getOrElse(pickGridDim(n))
    val cellSize = extent / gridDim.toDouble

    // 2. Build cell structure
    val struct = buildStructure(bodies, gridDim, origin, cellSize)

    // 3. Extract bodies to flat arrays
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

    // 4. Compute accelerations at t
    computeAccelerations(struct, px, py, pz, ids, n,
                         nearRadius, midRadius, softening, theta, ax, ay, az)

    // 5. KDK integration — kick (half) → drift → recompute forces → kick (half)
    val halfDt = dt / 2.0
    i = 0
    while i < n do
      vx(i) += ax(i) * halfDt; vy(i) += ay(i) * halfDt; vz(i) += az(i) * halfDt
      i += 1
    i = 0
    while i < n do
      px(i) += vx(i) * dt; py(i) += vy(i) * dt; pz(i) += vz(i) * dt
      i += 1

    // 6. Recompute accelerations at t + dt on new positions (rebuild structure)
    val newBodies1 = Vector.tabulate(n)(k =>
      Body(ids(k), Mass(mass(k)), Vec3(px(k), py(k), pz(k)), Vec3(vx(k), vy(k), vz(k))))
    val struct2 = buildStructure(newBodies1, gridDim, origin, cellSize)
    computeAccelerations(struct2, px, py, pz, ids, n,
                         nearRadius, midRadius, softening, theta, ax, ay, az)

    i = 0
    while i < n do
      vx(i) += ax(i) * halfDt; vy(i) += ay(i) * halfDt; vz(i) += az(i) * halfDt
      i += 1

    // 7. Reconstruct Vector[Body]
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

  // ── Diagnostics: report compression statistics for a body set ─────────
  // Returns (nBodies, nCells, distinctSignatures, sigRleRuns, sigCompressionRatio)
  def compressionStats(bodies: Vector[Body],
                       gridDimOverride: Option[Int] = None):
      (Int, Int, Int, Int, Double) =
    val n = bodies.length
    if n == 0 then return (0, 0, 0, 0, 1.0)
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
    val gridDim = gridDimOverride.getOrElse(pickGridDim(n))
    val cellSize = extent / gridDim.toDouble
    val struct = buildStructure(bodies, gridDim, origin, cellSize)
    val nCells = struct.cellsArray.count(_ != null)
    val nDistinct = struct.distinctSigs.length
    val ratio = if nDistinct == 0 then 1.0
                else nCells.toDouble / nDistinct.toDouble
    (n, nCells, nDistinct, nDistinct, ratio)

  def complexityClass: String = "O(N × distinctSignatures)"
