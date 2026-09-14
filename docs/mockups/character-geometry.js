// Shared by the writing exercise and the visual comparison.
function characterPath(points) {
  let d = `M${points[0][0]} ${points[0][1]}`
  if (points.length === 2) return `${d} L${points[1][0]} ${points[1][1]}`
  const clamp = (value) => Math.max(0, Math.min(100, value))
  // Catmull-Rom tangents keep the path continuous through each stroke's centerline.
  for (let index = 0; index < points.length - 1; index++) {
    const before = points[Math.max(0, index - 1)], start = points[index]
    const end = points[index + 1], after = points[Math.min(points.length - 1, index + 2)]
    const c1 = start.map((value, axis) => clamp(value + (end[axis] - before[axis]) / 6))
    const c2 = end.map((value, axis) => clamp(value - (after[axis] - start[axis]) / 6))
    d += ` C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${end[0]} ${end[1]}`
  }
  return d
}
