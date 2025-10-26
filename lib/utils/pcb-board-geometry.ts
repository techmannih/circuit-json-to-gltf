import { extrudeLinear } from "@jscad/modeling/src/operations/extrusions"
import {
  polygon,
  rectangle,
  roundedRectangle,
  cylinder,
} from "@jscad/modeling/src/primitives"
import {
  translate,
  rotateZ,
  rotateX,
} from "@jscad/modeling/src/operations/transforms"
import { subtract } from "@jscad/modeling/src/operations/booleans"
import * as geom3 from "@jscad/modeling/src/geometries/geom3"
import measureBoundingBox from "@jscad/modeling/src/measurements/measureBoundingBox"
import type { Geom3 } from "@jscad/modeling/src/geometries/types"
import type { Vec2 } from "@jscad/modeling/src/maths/types"
import type {
  PcbBoard,
  PcbHole,
  PCBPlatedHole,
  PcbCutout,
  Point,
} from "circuit-json"
import type { BoundingBox, STLMesh, Triangle } from "../types"

const DEFAULT_SEGMENTS = 64
const RADIUS_EPSILON = 1e-4

export type BoardCutout = PcbCutout

export interface BoardGeometryOptions {
  thickness: number
  holes?: PcbHole[]
  platedHoles?: PCBPlatedHole[]
  cutouts?: BoardCutout[]
}

const toVec2 = (point: Point, center: { x: number; y: number }): Vec2 => [
  point.x - center.x,
  point.y - center.y,
]

const toBoardSpaceVec2 = (
  point: Point,
  center: { x: number; y: number },
): Vec2 => [point.x - center.x, -(point.y - center.y)]

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

export const arePointsClockwise = (points: Vec2[]): boolean => {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i]![0] * points[j]![1]
    area -= points[j]![0] * points[i]![1]
  }
  const signedArea = area / 2
  return signedArea <= 0
}

const getNumberProperty = (
  obj: Record<string, unknown>,
  key: string,
): number | undefined => {
  const value = obj[key]
  return typeof value === "number" ? value : undefined
}

const resolveLengthValue = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const trimmed = value.trim()
    const match = trimmed.match(/^(-?\d+(?:\.\d+)?)(mm|mil|in)?$/i)
    if (match) {
      const magnitude = Number.parseFloat(match[1]!)
      const unit = match[2]?.toLowerCase()
      if (!unit || unit === "mm") return magnitude
      if (unit === "mil") return magnitude * 0.0254
      if (unit === "in") return magnitude * 25.4
    }
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    if (typeof record.value === "number") {
      const unit = (record.unit ?? record.units) as string | undefined
      if (!unit || unit === "mm") return record.value
      if (unit === "mil") return record.value * 0.0254
      if (unit === "in") return record.value * 25.4
      return record.value
    }
    const mm = record.mm ?? record.millimeters ?? record.millimetres
    if (typeof mm === "number") return mm
    const mil = record.mil ?? record.mils
    if (typeof mil === "number") return mil * 0.0254
    const inch = record.in ?? record.inch ?? record.inches
    if (typeof inch === "number") return inch * 25.4
  }
  return undefined
}

const resolveRotationRadians = (rotation: unknown): number => {
  if (!rotation) return 0
  if (typeof rotation === "number" && Number.isFinite(rotation)) {
    return (rotation * Math.PI) / 180
  }
  if (typeof rotation === "object") {
    const record = rotation as Record<string, unknown>
    const candidates = [
      record.deg,
      record.degs,
      record.degree,
      record.degrees,
      record.ccw,
      record.ccw_degrees,
      record.ccw_degree,
    ]
    for (const value of candidates) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return (value * Math.PI) / 180
      }
    }
    const radCandidates = [
      record.rad,
      record.rads,
      record.radian,
      record.radians,
      record.ccw_radians,
    ]
    for (const value of radCandidates) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value
      }
    }
  }
  return 0
}

const createBoardOutlineGeom = (
  board: PcbBoard,
  center: { x: number; y: number },
  thickness: number,
): Geom3 => {
  if (board.outline && board.outline.length >= 3) {
    let outlinePoints: Vec2[] = board.outline.map((pt) => toVec2(pt, center))

    if (arePointsClockwise(outlinePoints)) {
      outlinePoints = outlinePoints.slice().reverse()
    }

    const shape2d = polygon({ points: outlinePoints })
    let geom = extrudeLinear({ height: thickness }, shape2d)
    geom = translate([0, 0, -thickness / 2], geom)
    return geom
  }

  const baseRect = rectangle({ size: [board.width, board.height] })
  let geom = extrudeLinear({ height: thickness }, baseRect)
  geom = translate([0, 0, -thickness / 2], geom)
  return geom
}

const createCircularHole = (
  x: number,
  y: number,
  radius: number,
  thickness: number,
): Geom3 =>
  cylinder({
    center: [x, y, 0],
    height: thickness + 1,
    radius,
    segments: DEFAULT_SEGMENTS,
  })

const createPillHole = (
  x: number,
  y: number,
  width: number,
  height: number,
  thickness: number,
  rotate: boolean,
): Geom3 => {
  const minDimension = Math.min(width, height)
  const maxAllowedRadius = Math.max(0, minDimension / 2 - RADIUS_EPSILON)
  const roundRadius =
    maxAllowedRadius <= 0 ? 0 : Math.min(height / 2, maxAllowedRadius)
  const hole2d = roundedRectangle({
    size: [width, height],
    roundRadius,
    segments: DEFAULT_SEGMENTS,
  })
  let hole3d = extrudeLinear({ height: thickness + 1 }, hole2d)
  hole3d = translate([0, 0, -(thickness + 1) / 2], hole3d)

  if (rotate) {
    hole3d = rotateZ(Math.PI / 2, hole3d)
  }

  return translate([x, y, 0], hole3d)
}

const createHoleGeoms = (
  boardCenter: { x: number; y: number },
  thickness: number,
  holes: PcbHole[] = [],
  platedHoles: PCBPlatedHole[] = [],
): Geom3[] => {
  const holeGeoms: Geom3[] = []

  for (const hole of holes) {
    const holeRecord = hole as unknown as Record<string, unknown>
    const relX = hole.x - boardCenter.x
    const relY = -(hole.y - boardCenter.y) // Negate y to account for rotateX(-PI/2)

    const holeShape = holeRecord.hole_shape as string | undefined

    // Handle pill-shaped holes (non-rotated)
    if (holeShape === "pill") {
      const holeWidth = getNumberProperty(holeRecord, "hole_width")
      const holeHeight = getNumberProperty(holeRecord, "hole_height")
      if (!holeWidth || !holeHeight) continue

      const rotate = holeHeight > holeWidth
      const width = rotate ? holeHeight : holeWidth
      const height = rotate ? holeWidth : holeHeight

      const pillHole = createPillHole(
        relX,
        relY,
        width,
        height,
        thickness,
        rotate,
      )
      holeGeoms.push(pillHole)
      continue
    }

    // Handle rotated pill-shaped holes
    if (holeShape === "rotated_pill") {
      const holeWidth = getNumberProperty(holeRecord, "hole_width")
      const holeHeight = getNumberProperty(holeRecord, "hole_height")
      if (!holeWidth || !holeHeight) continue

      const rotation = getNumberProperty(holeRecord, "ccw_rotation") ?? 0
      // Negate rotation because the board is flipped (rotateX(-PI/2) at the end)
      // This converts CCW rotation in circuit coordinates to correct rotation in 3D
      const rotationRad = -(rotation * Math.PI) / 180

      // For rotated pill, don't auto-rotate based on dimensions
      // The pill shape is always created with the specified width/height
      // and then rotated by ccw_rotation
      const minDimension = Math.min(holeWidth, holeHeight)
      const maxAllowedRadius = Math.max(0, minDimension / 2 - RADIUS_EPSILON)
      const roundRadius =
        maxAllowedRadius <= 0 ? 0 : Math.min(holeHeight / 2, maxAllowedRadius)

      const hole2d = roundedRectangle({
        size: [holeWidth, holeHeight],
        roundRadius,
        segments: DEFAULT_SEGMENTS,
      })

      let hole3d = extrudeLinear({ height: thickness + 1 }, hole2d)
      hole3d = translate([0, 0, -(thickness + 1) / 2], hole3d)

      // Apply rotation around center before positioning
      if (rotationRad !== 0) {
        hole3d = rotateZ(rotationRad, hole3d)
      }

      // Finally translate to position
      hole3d = translate([relX, relY, 0], hole3d)

      holeGeoms.push(hole3d)
      continue
    }

    // Handle circular holes
    const diameter =
      getNumberProperty(holeRecord, "hole_diameter") ??
      getNumberProperty(holeRecord, "diameter")
    if (!diameter) continue

    const radius = diameter / 2
    holeGeoms.push(createCircularHole(relX, relY, radius, thickness))
  }

  for (const plated of platedHoles) {
    const platedRecord = plated as unknown as Record<string, unknown>

    // Get hole offset (for cases where hole is offset from pad center)
    const holeOffsetX = getNumberProperty(platedRecord, "hole_offset_x") ?? 0
    const holeOffsetY = getNumberProperty(platedRecord, "hole_offset_y") ?? 0

    const relX = plated.x - boardCenter.x + holeOffsetX
    const relY = -(plated.y - boardCenter.y + holeOffsetY) // Negate y to account for rotateX(-PI/2)

    if (plated.shape === "pill" || plated.shape === "pill_hole_with_rect_pad") {
      const holeWidth =
        getNumberProperty(platedRecord, "hole_width") ??
        getNumberProperty(platedRecord, "outer_diameter") ??
        0
      const holeHeight =
        getNumberProperty(platedRecord, "hole_height") ??
        getNumberProperty(platedRecord, "hole_diameter") ??
        0
      if (!holeWidth || !holeHeight) continue
      const rotate = holeHeight > holeWidth
      const width = rotate ? holeHeight : holeWidth
      const height = rotate ? holeWidth : holeHeight
      holeGeoms.push(
        createPillHole(relX, relY, width, height, thickness, rotate),
      )
      continue
    }

    const diameter =
      getNumberProperty(platedRecord, "hole_diameter") ??
      getNumberProperty(platedRecord, "outer_diameter")
    if (!diameter) continue
    holeGeoms.push(createCircularHole(relX, relY, diameter / 2, thickness))
  }

  return holeGeoms
}

const createCutoutGeoms = (
  boardCenter: { x: number; y: number },
  thickness: number,
  cutouts: BoardCutout[] = [],
): Geom3[] => {
  const geoms: Geom3[] = []

  for (const cutout of cutouts) {
    if (!cutout) continue

    switch (cutout.shape) {
      case "rect": {
        const { center } = cutout
        if (!center || !isFiniteNumber(center.x) || !isFiniteNumber(center.y)) {
          continue
        }

        const width = resolveLengthValue(cutout.width)
        const height = resolveLengthValue(cutout.height)
        if (!width || !height) continue

        const relX = center.x - boardCenter.x
        const relY = -(center.y - boardCenter.y)

        const rect2d = rectangle({ size: [width, height] })
        let geom = extrudeLinear({ height: thickness + 1 }, rect2d)
        geom = translate([0, 0, -(thickness + 1) / 2], geom)

        const rotationRad = resolveRotationRadians(cutout.rotation)
        if (rotationRad) {
          geom = rotateZ(-rotationRad, geom)
        }

        geoms.push(translate([relX, relY, 0], geom))
        break
      }
      case "circle": {
        const { center } = cutout
        if (!center || !isFiniteNumber(center.x) || !isFiniteNumber(center.y)) {
          continue
        }

        const radius =
          resolveLengthValue(cutout.radius) ??
          ("diameter" in cutout
            ? (() => {
                const diameter = resolveLengthValue(
                  (cutout as { diameter?: unknown }).diameter,
                )
                return typeof diameter === "number" ? diameter / 2 : undefined
              })()
            : undefined)

        if (!radius) continue

        const relX = center.x - boardCenter.x
        const relY = -(center.y - boardCenter.y)

        geoms.push(createCircularHole(relX, relY, radius, thickness))
        break
      }
      case "polygon": {
        const { points } = cutout
        if (!Array.isArray(points) || points.length < 3) continue

        let polygonPoints = points
          .filter(
            (point): point is Point =>
              point !== undefined &&
              isFiniteNumber(point.x) &&
              isFiniteNumber(point.y),
          )
          .map((point) => toBoardSpaceVec2(point, boardCenter))

        if (polygonPoints.length < 3) continue

        if (arePointsClockwise(polygonPoints)) {
          polygonPoints = polygonPoints.slice().reverse()
        }

        const polygon2d = polygon({ points: polygonPoints })
        let geom = extrudeLinear({ height: thickness + 1 }, polygon2d)
        geom = translate([0, 0, -(thickness + 1) / 2], geom)
        geoms.push(geom)
        break
      }
      default:
        break
    }
  }

  return geoms
}

const geom3ToTriangles = (geometry: Geom3, polygons?: any[]): Triangle[] => {
  const sourcePolygons = polygons ?? geom3.toPolygons(geometry)
  const triangles: Triangle[] = []

  for (const poly of sourcePolygons) {
    if (!poly || poly.vertices.length < 3) continue
    const base = poly.vertices[0]!
    const next = poly.vertices[1]!
    const next2 = poly.vertices[2]!

    const ab = [next[0]! - base[0]!, next[1]! - base[1]!, next[2]! - base[2]!]
    const ac = [
      next2[0]! - base[0]!,
      next2[1]! - base[1]!,
      next2[2]! - base[2]!,
    ]
    const cross = [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!,
    ]
    const length =
      Math.sqrt(cross[0]! ** 2 + cross[1]! ** 2 + cross[2]! ** 2) || 1
    const normal = {
      x: cross[0]! / length,
      y: cross[1]! / length,
      z: cross[2]! / length,
    }

    for (let i = 1; i < poly.vertices.length - 1; i++) {
      const v1 = poly.vertices[i]!
      const v2 = poly.vertices[i + 1]!
      const triangle: Triangle = {
        vertices: [
          { x: base[0]!, y: base[1]!, z: base[2]! },
          { x: v1[0]!, y: v1[1]!, z: v1[2]! },
          { x: v2[0]!, y: v2[1]!, z: v2[2]! },
        ],
        normal,
      }
      triangles.push(triangle)
    }
  }

  return triangles
}

const createBoundingBox = (bbox: [number[], number[]]): BoundingBox => {
  const [min, max] = bbox
  return {
    min: { x: min[0]!, y: min[1]!, z: min[2]! },
    max: { x: max[0]!, y: max[1]!, z: max[2]! },
  }
}

export const createBoardMesh = (
  board: PcbBoard,
  options: BoardGeometryOptions,
): STLMesh => {
  const { thickness, holes = [], platedHoles = [], cutouts = [] } = options
  const center = board.center ?? { x: 0, y: 0 }

  let boardGeom = createBoardOutlineGeom(board, center, thickness)

  const holeGeoms = createHoleGeoms(center, thickness, holes, platedHoles)
  const cutoutGeoms = createCutoutGeoms(center, thickness, cutouts)
  const subtractGeoms = [...holeGeoms, ...cutoutGeoms]
  if (subtractGeoms.length > 0) {
    boardGeom = subtract(boardGeom, ...subtractGeoms)
  }

  boardGeom = rotateX(-Math.PI / 2, boardGeom)

  const polygons = geom3.toPolygons(boardGeom)
  const triangles = geom3ToTriangles(boardGeom, polygons)

  const bboxValues = measureBoundingBox(boardGeom)
  const boundingBox = createBoundingBox(bboxValues)

  return {
    triangles,
    boundingBox,
  }
}
