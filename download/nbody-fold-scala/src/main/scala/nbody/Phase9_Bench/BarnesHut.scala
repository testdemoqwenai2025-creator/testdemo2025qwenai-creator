// ============================================================================
// BarnesHut.scala — O(N log N) octree-based gravity
// ============================================================================
// Phase 9 deliverable per skills.md §2 Phase 9.
//
// Barnes-Hut (Barnes & Hut, 1986) approximates far-field gravity by grouping
// distant bodies into a single center-of-mass particle. The algorithm:
//
//   1. BUILD OCTREE: recursively subdivide the bounding cube into 8 octants.
//      Each leaf node holds ≤1 body. Each internal node stores the total
//      mass and center-of-mass of all bodies within its volume.
//
//   2. WALK TREE PER BODY: for each body i, traverse the tree from the root.
//      At each node:
//        - If the node is a leaf (≤1 body): compute the direct pairwise force.
//        - If the node is internal: compute s/d where s = node edge length
//          and d = distance from body i to node's center-of-mass.
//            * If s/d < θ (opening angle, typically 0.5-1.0): treat the
//              node as a single point mass at its COM — one force calc.
//            * Else: recurse into all 8 children.
//
//   θ = 1.0  → fast, less accurate (~1% relative force error)
//   θ = 0.5  → moderate (~0.1% force error)
//   θ = 0.0  → exact (degenerates to brute force)
//
// Algorithmic complexity: O(N log N) per step
//   - Tree build: O(N log N)
//   - Per-body tree walk: O(log N) average (θ-dependent)
//   - Total: O(N log N)
//
// We use θ = 0.5 as the default — a common production choice balancing
// speed and accuracy. The benchmark reports force error vs brute force
// to verify the approximation stays within acceptable bounds.
//
// ── Implementation notes ────────────────────────────────────────────────
// The tree is built MUTABLY (vars) for performance — purely functional
// tree construction allocates ~5× more objects per build. The tree is
// rebuilt every step (bodies move), so immutability gives no benefit.
// Force computation reads the tree read-only after construction.
//
// Box labeling: each node stores its center (cx, cy, cz) and half-size
// (hx, hy, hz — half the edge length). Children are indexed 0-7 by the
// sign of (x-cx), (y-cy), (z-cz).
// ============================================================================

package nbody.Phase9_Bench

import nbody.Phase0_Domain.*
import nbody.Phase5_NBody.Physics

object BarnesHut:

  val algorithmName: String = "BarnesHut-O(N log N)"

  // Default opening angle θ — common production choice
  val DefaultTheta: Double = 0.5

  // ── Tree node ────────────────────────────────────────────────────────
  // A node is either:
  //   - Empty (no body, no children)
  //   - Leaf (single body)
  //   - Internal (8 children + aggregate mass/COM)
  //
  // We use a single class with mutable fields for simplicity; the `body`
  // field is non-null only for leaves, `children` is non-null only for
  // internal nodes.
  private final class Node(
    var cx: Double, var cy: Double, var cz: Double,   // box center
    var hx: Double, var hy: Double, var hz: Double,   // box half-extents
  ):
    var mass: Double = 0.0                            // aggregate mass
    var comX: Double = 0.0                            // center of mass
    var comY: Double = 0.0
    var comZ: Double = 0.0
    var body: Body = null                             // non-null for leaf
    var children: Array[Node] = null                  // non-null for internal

    def isLeaf: Boolean = body != null
    def isInternal: Boolean = children != null
    def isEmpty: Boolean = body == null && children == null

  // ── Build octree from bodies ─────────────────────────────────────────
  // Computes bounding box, creates root, inserts each body.
  private def buildTree(bodies: Vector[Body]): Node =
    require(bodies.nonEmpty, "BarnesHut.buildTree: empty body list")
    // 1. Compute bounding cube (use cube, not box, so octree subdivision works)
    var minX = Double.PositiveInfinity
    var minY = Double.PositiveInfinity
    var minZ = Double.PositiveInfinity
    var maxX = Double.NegativeInfinity
    var maxY = Double.NegativeInfinity
    var maxZ = Double.NegativeInfinity
    var i = 0
    while i < bodies.length do
      val p = bodies(i).pos
      if p.x < minX then minX = p.x
      if p.y < minY then minY = p.y
      if p.z < minZ then minZ = p.z
      if p.x > maxX then maxX = p.x
      if p.y > maxY then maxY = p.y
      if p.z > maxZ then maxZ = p.z
      i += 1
    // Use a cube with a small epsilon margin to avoid edge cases
    val cx = (minX + maxX) / 2.0
    val cy = (minY + maxY) / 2.0
    val cz = (minZ + maxZ) / 2.0
    val hx = math.max(maxX - minX, math.max(maxY - minY, maxZ - minZ)) / 2.0 * 1.0001 + 1e-12
    val hy = hx
    val hz = hx
    val root = Node(cx, cy, cz, hx, hy, hz)
    // 2. Insert each body
    i = 0
    while i < bodies.length do
      insert(root, bodies(i))
      i += 1
    root

  // ── Insert a body into the (sub)tree rooted at `node` ────────────────
  // Recursively subdivides as needed. Updates aggregate mass/COM on the
  // way down (so after insertion, every node's mass/COM reflects all
  // bodies in its subtree).
  private def insert(node: Node, body: Body): Unit =
    // Update aggregate mass and COM at this node (running average)
    val newMass = node.mass + body.mass.value
    node.comX = (node.comX * node.mass + body.pos.x * body.mass.value) / newMass
    node.comY = (node.comY * node.mass + body.pos.y * body.mass.value) / newMass
    node.comZ = (node.comZ * node.mass + body.pos.z * body.mass.value) / newMass
    node.mass = newMass

    if node.isEmpty then
      // Empty leaf → become a leaf holding this body
      node.body = body
    else if node.isLeaf then
      // Existing leaf → subdivide, push both bodies down
      val existing = node.body
      node.body = null
      node.children = new Array[Node](8)
      subdivideInsert(node, existing)
      subdivideInsert(node, body)
    else
      // Internal node → recurse into the appropriate child
      subdivideInsert(node, body)

  // Pick the correct octant for `body` and recurse, creating the child
  // node if needed.
  private def subdivideInsert(node: Node, body: Body): Unit =
    val idx = childIndex(node, body.pos)
    if node.children(idx) == null then
      val (ccx, ccy, ccz) = childCenter(node, idx)
      node.children(idx) = Node(ccx, ccy, ccz, node.hx / 2.0, node.hy / 2.0, node.hz / 2.0)
    insert(node.children(idx), body)

  // Octant index 0-7 by sign of (pos - center)
  private def childIndex(node: Node, pos: Vec3): Int =
    val bx = if pos.x >= node.cx then 1 else 0
    val by = if pos.y >= node.cy then 2 else 0
    val bz = if pos.z >= node.cz then 4 else 0
    bx | by | bz

  // Child center for octant idx
  private def childCenter(node: Node, idx: Int): (Double, Double, Double) =
    val dx = (if (idx & 1) != 0 then 1.0 else -1.0) * node.hx / 2.0
    val dy = (if (idx & 2) != 0 then 1.0 else -1.0) * node.hy / 2.0
    val dz = (if (idx & 4) != 0 then 1.0 else -1.0) * node.hz / 2.0
    (node.cx + dx, node.cy + dy, node.cz + dz)

  // ── Walk tree computing force on body at position `pos` (excluding self) ─
  // The `selfId` is the body's ID — we skip the leaf that holds it to avoid
  // self-gravity.
  private def walkTree(node: Node, pos: Vec3, selfId: Long,
                       theta: Double, softening: Double): Vec3 =
    if node.isEmpty then
      Vec3.Zero
    else if node.isLeaf then
      if node.body.id == selfId then Vec3.Zero
      else Physics.accelerationOn(Body(0, Mass(0), pos, Vec3.Zero), node.body, softening)
    else
      // Internal node: check θ criterion
      val dx = node.comX - pos.x
      val dy = node.comY - pos.y
      val dz = node.comZ - pos.z
      val distSq = dx * dx + dy * dy + dz * dz + softening * softening
      val dist = math.sqrt(distSq)
      // s/d where s = node edge length (use max of hx,hy,hz — they're equal in our cube)
      val s = node.hx * 2.0
      if s / dist < theta then
        // Far enough: treat as point mass at COM
        val invDist = 1.0 / dist
        val invDist3 = invDist * invDist * invDist
        val factor = Physics.G * node.mass * invDist3
        Vec3(dx * factor, dy * factor, dz * factor)
      else
        // Too close: recurse into children
        var ax = 0.0; var ay = 0.0; var az = 0.0
        var i = 0
        while i < 8 do
          if node.children(i) != null then
            val a = walkTree(node.children(i), pos, selfId, theta, softening)
            ax += a.x; ay += a.y; az += a.z
          i += 1
        Vec3(ax, ay, az)

  // ── Single KDK step using Barnes-Hut force computation ───────────────
  // Same KDK structure as MutableKDK but with tree-walk forces instead of
  // pairwise forces.
  def step(bodies: Vector[Body], dt: Double,
           theta: Double = DefaultTheta,
           softening: Double = Physics.DefaultSoftening): Vector[Body] =
    val n = bodies.length
    if n == 0 then return bodies

    // 1. Build tree
    val root = buildTree(bodies)

    // 2. Extract into flat arrays
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
    var i = 0
    while i < n do
      val b = bodies(i)
      px(i) = b.pos.x; py(i) = b.pos.y; pz(i) = b.pos.z
      vx(i) = b.vel.x; vy(i) = b.vel.y; vz(i) = b.vel.z
      mass(i) = b.mass.value
      ids(i) = b.id
      i += 1

    // 3. Compute accelerations via tree walk
    i = 0
    while i < n do
      val a = walkTree(root, Vec3(px(i), py(i), pz(i)), ids(i), theta, softening)
      ax(i) = a.x; ay(i) = a.y; az(i) = a.z
      i += 1

    // 4. KDK integration (same as MutableKDK)
    val halfDt = dt / 2.0
    i = 0
    while i < n do
      vx(i) += ax(i) * halfDt
      vy(i) += ay(i) * halfDt
      vz(i) += az(i) * halfDt
      i += 1
    i = 0
    while i < n do
      px(i) += vx(i) * dt
      py(i) += vy(i) * dt
      pz(i) += vz(i) * dt
      i += 1
    // Recompute accelerations at t + dt (tree rebuilt on positions)
    val root2 = buildTree(
      Vector.tabulate(n)(k =>
        Body(ids(k), Mass(mass(k)), Vec3(px(k), py(k), pz(k)), Vec3(vx(k), vy(k), vz(k))))
    )
    i = 0
    while i < n do
      val a = walkTree(root2, Vec3(px(i), py(i), pz(i)), ids(i), theta, softening)
      ax(i) = a.x; ay(i) = a.y; az(i) = a.z
      i += 1
    i = 0
    while i < n do
      vx(i) += ax(i) * halfDt
      vy(i) += ay(i) * halfDt
      vz(i) += az(i) * halfDt
      i += 1

    // 5. Reconstruct Vector[Body]
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

  def complexityClass: String = "O(N log N)"
