import type { Vec2 } from "@jscad/modeling/src/maths/types"

/**
 * Converts vertices with optional bulge values into a series of points
 * that approximate the shape including arc segments.
 *
 * Bulge is a value that creates an arc between two vertices:
 * - bulge = 0: straight line
 * - bulge > 0: arc bulges to the right (when traveling from v1 to v2)
 * - bulge < 0: arc bulges to the left
 * - bulge = 1: semicircle
 * - bulge = tan(theta/4) where theta is the included angle of the arc
 */
export function convertBrepRingToPoints(
  vertices: Array<{ x: number; y: number; bulge?: number }>,
  segmentsPerArc = 32,
): Vec2[] {
  const points: Vec2[] = []

  for (let i = 0; i < vertices.length; i++) {
    const startVertex = vertices[i]!
    const endVertex = vertices[(i + 1) % vertices.length]!
    const bulge = startVertex.bulge ?? 0

    if (Math.abs(bulge) < 0.0001) {
      // Straight line segment
      points.push([startVertex.x, startVertex.y])
    } else {
      // Arc segment using standard DXF/CAD bulge formula
      const dx = endVertex.x - startVertex.x
      const dy = endVertex.y - startVertex.y
      const chordLength = Math.sqrt(dx * dx + dy * dy)

      if (chordLength < 0.0001) {
        // Degenerate case: start and end vertices are identical
        points.push([startVertex.x, startVertex.y])
        continue
      }

      // Calculate arc geometry from bulge value
      const includedAngle = 4 * Math.atan(bulge)
      const radius = Math.abs(chordLength / 2 / Math.sin(includedAngle / 2))
      const sagitta = Math.abs(bulge) * (chordLength / 2)

      // Find chord midpoint
      const chordMidX = (startVertex.x + endVertex.x) / 2
      const chordMidY = (startVertex.y + endVertex.y) / 2

      // Calculate perpendicular direction (90° rotation of chord)
      const perpUnitX = -dy / chordLength
      const perpUnitY = dx / chordLength

      // Arc center is offset from chord midpoint by sagitta distance
      const arcCenterX = chordMidX + perpUnitX * sagitta
      const arcCenterY = chordMidY + perpUnitY * sagitta

      // Calculate angular positions
      const startAngle = Math.atan2(
        startVertex.y - arcCenterY,
        startVertex.x - arcCenterX,
      )
      const endAngle = Math.atan2(
        endVertex.y - arcCenterY,
        endVertex.x - arcCenterX,
      )

      // Determine sweep angle and direction
      let sweepAngle = endAngle - startAngle

      if (bulge > 0) {
        // Positive bulge: counterclockwise arc
        if (sweepAngle < 0) sweepAngle += 2 * Math.PI
      } else {
        // Negative bulge: clockwise arc
        if (sweepAngle > 0) sweepAngle -= 2 * Math.PI
      }

      // Generate interpolated points along the arc
      const segmentCount = Math.max(
        3,
        Math.ceil((Math.abs(sweepAngle) * segmentsPerArc) / Math.PI),
      )

      for (let j = 0; j < segmentCount; j++) {
        const t = j / segmentCount
        const currentAngle = startAngle + sweepAngle * t
        const x = arcCenterX + radius * Math.cos(currentAngle)
        const y = arcCenterY + radius * Math.sin(currentAngle)
        points.push([x, y])
      }
    }
  }

  return points
}

/**
 * Checks if points are in clockwise order
 */
export function arePointsClockwise(points: Vec2[]): boolean {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i]![0] * points[j]![1]
    area -= points[j]![0] * points[i]![1]
  }
  return area / 2 <= 0
}
