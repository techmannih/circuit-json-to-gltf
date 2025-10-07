import { test, expect } from "bun:test"
import { convertCircuitJsonTo3D } from "../../lib"

test("convertCircuitJsonTo3D should work without textures", async () => {
  const simpleCircuit = [
    {
      type: "pcb_board",
      pcb_board_id: "board1",
      center: { x: 0, y: 0 },
      width: 50,
      height: 30,
      thickness: 1.6,
    },
  ]

  const scene = await convertCircuitJsonTo3D(simpleCircuit as any, {
    renderBoardTextures: false, // Skip texture rendering
  })

  expect(scene).toBeDefined()
  expect(scene.boxes).toHaveLength(1)
  expect(scene.boxes[0]!.size.x).toBe(50)
  expect(scene.boxes[0]!.size.z).toBe(30)
  expect(scene.boxes[0]!.size.y).toBe(1.6)
})

test("bottom CAD components are positioned below the PCB", async () => {
  const originalFetch = globalThis.fetch

  const asciiStl = `solid test
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid test`

  const encoder = new TextEncoder()
  const buffer = encoder.encode(asciiStl).buffer

  globalThis.fetch = async () => ({
    arrayBuffer: async () => buffer,
  }) as any

  const circuit = [
    {
      type: "pcb_board",
      pcb_board_id: "board1",
      center: { x: 0, y: 0 },
      width: 20,
      height: 20,
      thickness: 1.6,
    },
    {
      type: "pcb_component",
      pcb_component_id: "pc_bottom",
      source_component_id: "sc1",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      layer: "bottom",
    },
    {
      type: "cad_component",
      cad_component_id: "cad_bottom",
      pcb_component_id: "pc_bottom",
      model_stl_url: "https://example.com/model.stl",
      size: { x: 4, y: 2, z: 4 },
      position: { x: 0, y: 0, z: 0 },
    },
  ]

  try {
    const scene = await convertCircuitJsonTo3D(circuit as any, {
      renderBoardTextures: false,
    })

    const componentBox = scene.boxes.find(
      (box) => box.meshUrl === "https://example.com/model.stl",
    )

    expect(componentBox).toBeDefined()
    expect(componentBox!.center.y).toBeCloseTo(-1.8)
  } finally {
    globalThis.fetch = originalFetch
  }
})
