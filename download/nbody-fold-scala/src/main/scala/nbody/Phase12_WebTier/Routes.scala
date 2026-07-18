// ============================================================================
// Routes.scala — REST handlers wiring DB ↔ Phase 5 Simulator ↔ JSON
// ============================================================================
// Phase 12 deliverable.
//
// Endpoints (all JSON, all driven by Phase 2 JsonParser AST):
//
//   GET  /api/health              → {"status":"ok","uptimeSec":N,"systems":N}
//   GET  /api/systems             → {"systems":[{id,name,createdAt,dt,softening,steps,bodies:N}]}
//   POST /api/systems             → creates a system from a body list
//                                   body: {"name":"...","dt":0.01,"softening":0.05,
//                                          "bodies":[{"mass":1.0,"x":0,"y":0,"z":0,
//                                                     "vx":0,"vy":0,"vz":0}]}
//                                   returns: {"id":N,"createdAt":N}
//   GET  /api/systems/:id         → full state: meta + bodies + last trajectory
//   POST /api/systems/:id/step    → advance N steps, persisting trajectory samples
//                                   body: {"steps":100,"sampleEvery":10}
//                                   returns: {"step":N,"energy":E,"drift":D}
//   GET  /api/systems/:id/trajectories → all trajectory samples for charting
//   DELETE /api/systems/:id       → cascade delete
//
// The handlers bridge the JSON world (Phase 2) and the Body/System world
// (Phase 0/5) by reconstructing `Vector[Body]` from rows, calling
// `Simulator.stepBodies` once per step (reusing Phase 5's MutableKDK), and
// writing trajectory samples back to the DB.
// ============================================================================

package nbody.Phase12_WebTier

import java.util.concurrent.atomic.AtomicLong
import scala.util.{Try, Success, Failure}

import nbody.Phase0_Domain.{Body, Mass, Vec3}
import nbody.Phase2_Parser.{Json, JsonParser}
import Json.*
import nbody.Phase5_NBody.{Simulator, MutableKDK, Physics}

final class Routes(db: Database, startedAt: Long):

  // ── GET /api/health ────────────────────────────────────────────────────
  val health: Handler = req =>
    val uptime = (java.lang.System.currentTimeMillis() - startedAt) / 1000L
    Response(200).json(JObj(List(
      "status"     -> JStr("ok"),
      "uptimeSec"  -> JInt(uptime),
      "systems"    -> JInt(db.listSystems.length.toLong),
      "bodies"     -> JInt(db.listSystems.flatMap(s => db.bodiesOf(s.id)).length.toLong),
      "trajectories" -> JInt(db.listSystems.flatMap(s => db.trajectoriesOf(s.id)).length.toLong)
    )))

  // ── GET /api/systems ───────────────────────────────────────────────────
  val listSystems: Handler = req =>
    val arr = db.listSystems.map { s =>
      JObj(List(
        "id"        -> JInt(s.id),
        "name"      -> JStr(s.name),
        "createdAt" -> JInt(s.createdAt),
        "dt"        -> JStr(s.dt.toString),
        "softening" -> JStr(s.softening.toString),
        "steps"     -> JInt(s.steps.toLong),
        "bodies"    -> JInt(db.bodiesOf(s.id).length.toLong),
        "trajectories" -> JInt(db.trajectoriesOf(s.id).length.toLong)
      ))
    }
    Response(200).json(JObj(List("systems" -> JArr(arr.toList))))

  // ── POST /api/systems ──────────────────────────────────────────────────
  // Body: { "name":"...", "dt":0.01, "softening":0.05,
  //         "bodies":[{"mass":1.0,"x":0,"y":0,"z":0,"vx":0,"vy":0,"vz":0}, ...] }
  val createSystem: Handler = req =>
    req.jsonBody match
      case None =>
        Response(400).json(errorJson("missing_json_body"))
      case Some(JObj(m)) =>
        val name      = strField(m, "name").getOrElse("unnamed")
        val dt        = dblField(m, "dt").getOrElse(0.01)
        val softening = dblField(m, "softening").getOrElse(Physics.DefaultSoftening)
        val bodiesArr = m.find(_._1 == "bodies").map(_._2).collect { case JArr(items) => items }
                           .getOrElse(List.empty)

        if bodiesArr.isEmpty then
          Response(400).json(errorJson("empty_bodies"))
        else
          val sysId = db.insertSystem(name, dt, softening, 0)
          // Insert bodies, retaining the assigned DB id as the Body.id
          bodiesArr.zipWithIndex.foreach { (bj, i) =>
            bj match
              case JObj(bm) =>
                val mass = dblField(bm, "mass").getOrElse(1.0)
                val x = dblField(bm, "x").getOrElse(0.0)
                val y = dblField(bm, "y").getOrElse(0.0)
                val z = dblField(bm, "z").getOrElse(0.0)
                val vx = dblField(bm, "vx").getOrElse(0.0)
                val vy = dblField(bm, "vy").getOrElse(0.0)
                val vz = dblField(bm, "vz").getOrElse(0.0)
                db.insertBody(sysId, mass, x, y, z, vx, vy, vz)
              case _ => ()
          }
          // Persist initial state as step 0 trajectory
          val initBodies = rebuildBodies(db.bodiesOf(sysId))
          val e0         = totalEnergy(initBodies, softening)
          // Use the first body's pos as a representative point for the chart
          if initBodies.nonEmpty then
            val b = initBodies.head
            db.insertTrajectory(sysId, 0, b.pos.x, b.pos.y, b.pos.z,
                                b.vel.x, b.vel.y, b.vel.z, e0)
          Response(201).json(JObj(List(
            "id"        -> JInt(sysId),
            "createdAt" -> JInt(db.getSystem(sysId).get.createdAt),
            "bodies"    -> JInt(bodiesArr.length.toLong),
            "energy0"   -> JStr(e0.toString)
          )))
      case _ =>
        Response(400).json(errorJson("invalid_body_shape"))

  // ── GET /api/systems/:id ───────────────────────────────────────────────
  val getSystem: Handler = req =>
    pathId(req, 2) match
      case None =>
        Response(400).json(errorJson("invalid_id"))
      case Some(id) =>
        db.getSystem(id) match
          case None =>
            Response(404).json(errorJson("not_found"))
          case Some(s) =>
            val bodies = db.bodiesOf(id).map { b =>
              JObj(List(
                "id"   -> JInt(b.id),
                "mass" -> JStr(b.mass.toString),
                "x" -> JStr(b.x.toString), "y" -> JStr(b.y.toString), "z" -> JStr(b.z.toString),
                "vx" -> JStr(b.vx.toString), "vy" -> JStr(b.vy.toString), "vz" -> JStr(b.vz.toString)
              ))
            }
            val last = db.lastTrajectoryOf(id).map { t =>
              JObj(List(
                "step"   -> JInt(t.step.toLong),
                "x" -> JStr(t.x.toString), "y" -> JStr(t.y.toString), "z" -> JStr(t.z.toString),
                "energy" -> JStr(t.energy.toString)
              ))
            }.getOrElse(JNull)
            Response(200).json(JObj(List(
              "id"        -> JInt(s.id),
              "name"      -> JStr(s.name),
              "createdAt" -> JInt(s.createdAt),
              "dt"        -> JStr(s.dt.toString),
              "softening" -> JStr(s.softening.toString),
              "steps"     -> JInt(s.steps.toLong),
              "bodies"    -> JArr(bodies.toList),
              "last"      -> last
            )))

  // ── POST /api/systems/:id/step ─────────────────────────────────────────
  // Body: { "steps":100, "sampleEvery":10 }
  val stepSystem: Handler = req =>
    pathId(req, 2) match
      case None => Response(400).json(errorJson("invalid_id"))
      case Some(id) =>
        db.getSystem(id) match
          case None => Response(404).json(errorJson("not_found"))
          case Some(s) =>
            val steps       = req.jsonBody.flatMap(j => jsonInt(j, "steps")).getOrElse(100)
            val sampleEvery = req.jsonBody.flatMap(j => jsonInt(j, "sampleEvery")).getOrElse(10)
            val e0          = db.lastTrajectoryOf(id).map(_.energy).getOrElse {
              totalEnergy(rebuildBodies(db.bodiesOf(id)), s.softening)
            }

            // The hot path: rebuild bodies, evolve, persist trajectory samples.
            var bodies      = rebuildBodies(db.bodiesOf(id))
            var lastEnergy  = e0
            var stepIdx     = 0
            while stepIdx < steps do
              bodies = Simulator.stepBodies(bodies, s.dt, s.softening)
              stepIdx += 1
              if stepIdx % sampleEvery == 0 || stepIdx == steps then
                lastEnergy = totalEnergy(bodies, s.softening)
                // Sample the first body's pos/vel as a representative trajectory point.
                // A more general API would persist all bodies, but that explodes the
                // log size by N×; defer to Phase 13 (multi-body trajectory API).
                val b = bodies.head
                db.insertTrajectory(id, stepIdx,
                                    b.pos.x, b.pos.y, b.pos.z,
                                    b.vel.x, b.vel.y, b.vel.z,
                                    lastEnergy)
            // Update system row's `steps` counter
            val drift = if e0 == 0.0 then math.abs(lastEnergy) else math.abs(lastEnergy - e0) / math.abs(e0)
            Response(200).json(JObj(List(
              "step"        -> JInt(stepIdx.toLong),
              "energy0"     -> JStr(e0.toString),
              "energyFinal" -> JStr(lastEnergy.toString),
              "drift"       -> JStr(drift.toString),
              "sampled"     -> JInt((steps / math.max(1, sampleEvery)).toLong)
            )))

  // ── GET /api/systems/:id/trajectories ──────────────────────────────────
  val trajectories: Handler = req =>
    pathId(req, 2) match
      case None => Response(400).json(errorJson("invalid_id"))
      case Some(id) =>
        db.getSystem(id) match
          case None => Response(404).json(errorJson("not_found"))
          case Some(_) =>
            val arr = db.trajectoriesOf(id).map { t =>
              JObj(List(
                "step"   -> JInt(t.step.toLong),
                "x" -> JStr(t.x.toString), "y" -> JStr(t.y.toString), "z" -> JStr(t.z.toString),
                "vx" -> JStr(t.vx.toString), "vy" -> JStr(t.vy.toString), "vz" -> JStr(t.vz.toString),
                "energy" -> JStr(t.energy.toString)
              ))
            }
            Response(200).json(JObj(List(
              "systemId"    -> JInt(id),
              "trajectories" -> JArr(arr.toList)
            )))

  // ── DELETE /api/systems/:id ────────────────────────────────────────────
  val deleteSystem: Handler = req =>
    pathId(req, 2) match
      case None => Response(400).json(errorJson("invalid_id"))
      case Some(id) =>
        if db.deleteSystem(id) then
          Response(200).json(JObj(List("deleted" -> JInt(id))))
        else
          Response(404).json(errorJson("not_found"))

  // ── Static frontend handler (serves / and /index.html) ─────────────────
  val frontend: Handler = req =>
    Response(200, Map("Content-Type" -> "text/html; charset=utf-8"), Frontend.html)

  // ── 404 fallback ───────────────────────────────────────────────────────
  val notFound: Handler = req =>
    Response(404).json(errorJson("no_route"))

  // ── Routing dispatcher: matches method + path prefix ───────────────────
  def dispatch: Handler = req =>
    val segs = req.path.stripPrefix("/").split("/").filter(_.nonEmpty)
    (req.method, segs) match
      case ("GET",  Array("api", "health"))                           => health(req)
      case ("GET",  Array("api", "systems"))                          => listSystems(req)
      case ("POST", Array("api", "systems"))                          => createSystem(req)
      case ("GET",  Array("api", "systems", id))                      => getSystem(req)
      case ("POST", Array("api", "systems", id, "step"))              => stepSystem(req)
      case ("GET",  Array("api", "systems", id, "trajectories"))      => trajectories(req)
      case ("DELETE", Array("api", "systems", id))                    => deleteSystem(req)
      case ("GET",  Array("") | Array("index.html") | Array())        => frontend(req)
      case _                                                           => notFound(req)

  // ── Helpers ────────────────────────────────────────────────────────────
  private def errorJson(msg: String): Json = JObj(List("error" -> JStr(msg)))

  private def strField(m: List[(String, Json)], k: String): Option[String] =
    m.find(_._1 == k).map(_._2).collect { case JStr(s) => s }
  private def dblField(m: List[(String, Json)], k: String): Option[Double] =
    m.find(_._1 == k).map(_._2).collect {
      case JStr(s) => s.toDouble
      case JInt(n) => n.toDouble
      case JNum(d) => d
    }
  private def jsonInt(j: Json, k: String): Option[Int] = j match
    case JObj(m) => m.find(_._1 == k).map(_._2).collect { case JInt(n) => n.toInt }
    case _ => None

  private def pathId(req: Request, idx: Int): Option[Long] =
    val segs = req.path.stripPrefix("/").split("/").filter(_.nonEmpty)
    if segs.length > idx then Try(segs(idx).toLong).toOption else None

  // Rebuild the Phase 0 Body Vector from Phase 12 BodyRow rows
  private def rebuildBodies(rows: Vector[BodyRow]): Vector[Body] =
    rows.map { r =>
      Body(
        id   = r.id,
        mass = Mass(r.mass),
        pos  = Vec3(r.x, r.y, r.z),
        vel  = Vec3(r.vx, r.vy, r.vz)
      )
    }

  // Total potential + kinetic energy of a body set
  private def totalEnergy(bodies: Vector[Body], softening: Double): Double =
    var ke = 0.0
    var pe = 0.0
    val n  = bodies.length
    var i  = 0
    while i < n do
      ke += 0.5 * bodies(i).mass.value * bodies(i).vel.normSq
      var j = i + 1
      while j < n do
        val r  = (bodies(i).pos - bodies(j).pos).norm
        val d2 = r * r + softening * softening
        pe -= Physics.G * bodies(i).mass.value * bodies(j).mass.value / math.sqrt(d2)
        j += 1
      i += 1
    ke + pe

end Routes
