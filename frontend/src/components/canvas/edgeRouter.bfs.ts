/**
 * edgeRouter.bfs.ts: グリッド構築 + BFS経路探索 + パス簡略化
 *
 * 障害物グリッドを構築し、Dijkstra的BFS（折れ曲がりペナルティ付き）で
 * 最短直交パスを探索する。交差ペナルティ付きバリアントも提供。
 */

import type { DiagramNode } from '../../types/diagram'
import type { ObstacleGrid, BFSNode, BFSResult, Side, Point } from './edgeRouter.types'
import {
  GRID_SIZE, OBSTACLE_MARGIN, MAX_BFS_CELLS, BEND_PENALTY, CROSS_PENALTY, DIRS,
} from './edgeRouter.types'

// ============================================================
// Grid Construction
// ============================================================

/** 障害物グリッドを構築（アイコン矩形をセルとしてマーク） */
export function buildObstacleGrid(
  obstacles: Array<{ x: number; y: number; w: number; h: number }>,
  nodes: Record<string, DiagramNode>,
): ObstacleGrid {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of Object.values(nodes)) {
    if (n.size.width === 0 && n.size.height === 0) continue
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + n.size.width)
    maxY = Math.max(maxY, n.position.y + n.size.height)
  }

  minX -= 100; minY -= 100; maxX += 100; maxY += 100

  const occupied = new Set<string>()

  for (const ob of obstacles) {
    const gx1 = Math.floor((ob.x - OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)
    const gy1 = Math.floor((ob.y - OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)
    const gx2 = Math.ceil((ob.x + ob.w + OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)
    const gy2 = Math.ceil((ob.y + ob.h + OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)

    for (let gx = gx1; gx <= gx2; gx++) {
      for (let gy = gy1; gy <= gy2; gy++) {
        occupied.add(`${gx},${gy}`)
      }
    }
  }

  return {
    occupied,
    minX: Math.floor(minX / GRID_SIZE),
    minY: Math.floor(minY / GRID_SIZE),
    maxX: Math.ceil(maxX / GRID_SIZE),
    maxY: Math.ceil(maxY / GRID_SIZE),
  }
}

/** 指定矩形の障害物セルを一時的に解除し、削除したキーを返す */
export function unblockRect(
  grid: ObstacleGrid,
  rect: { x: number; y: number; w: number; h: number },
): string[] {
  const removed: string[] = []
  const gx1 = Math.floor((rect.x - OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)
  const gy1 = Math.floor((rect.y - OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)
  const gx2 = Math.ceil((rect.x + rect.w + OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)
  const gy2 = Math.ceil((rect.y + rect.h + OBSTACLE_MARGIN * GRID_SIZE) / GRID_SIZE)

  for (let gx = gx1; gx <= gx2; gx++) {
    for (let gy = gy1; gy <= gy2; gy++) {
      const key = `${gx},${gy}`
      if (grid.occupied.has(key)) {
        grid.occupied.delete(key)
        removed.push(key)
      }
    }
  }
  return removed
}

/** 解除した障害物セルを復元 */
export function reblockCells(grid: ObstacleGrid, cells: string[]): void {
  for (const key of cells) {
    grid.occupied.add(key)
  }
}

// ============================================================
// BFS Routing
// ============================================================

/**
 * BFS 1回で中心→中心の最短直交パスを探索。
 * コスト = 距離 + 折れ曲がりペナルティ（交差ペナルティなし）。
 */
export function bfsSearch(
  srcX: number, srcY: number,
  dstX: number, dstY: number,
  grid: ObstacleGrid,
): BFSResult | null {
  const startGx = Math.round(srcX / GRID_SIZE)
  const startGy = Math.round(srcY / GRID_SIZE)
  const endGx = Math.round(dstX / GRID_SIZE)
  const endGy = Math.round(dstY / GRID_SIZE)

  if (startGx === endGx && startGy === endGy) {
    return { gridPath: [{ gx: startGx, gy: startGy }, { gx: endGx, gy: endGy }], cost: 0 }
  }

  const visited = new Map<string, number>()
  const parent = new Map<string, { gx: number; gy: number; dir: number }>()

  const queue: BFSNode[] = []
  for (let d = 0; d < 4; d++) {
    const ngx = startGx + DIRS[d].dx
    const ngy = startGy + DIRS[d].dy
    if (grid.occupied.has(`${ngx},${ngy}`)) continue
    const key = `${ngx},${ngy},${d}`
    queue.push({ gx: ngx, gy: ngy, dir: d, cost: 1 })
    visited.set(key, 1)
    parent.set(key, { gx: startGx, gy: startGy, dir: -1 })
  }

  let found = false
  let foundDir = -1
  let foundCost = Infinity
  let iterations = 0

  while (queue.length > 0 && iterations < MAX_BFS_CELLS) {
    iterations++

    let minIdx = 0
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].cost < queue[minIdx].cost) minIdx = i
    }
    const curr = queue.splice(minIdx, 1)[0]

    if (curr.cost >= foundCost) continue

    if (curr.gx === endGx && curr.gy === endGy) {
      found = true
      foundDir = curr.dir
      foundCost = curr.cost
      continue
    }

    for (let d = 0; d < 4; d++) {
      const ngx = curr.gx + DIRS[d].dx
      const ngy = curr.gy + DIRS[d].dy

      if (ngx < grid.minX || ngx > grid.maxX || ngy < grid.minY || ngy > grid.maxY) continue
      if (grid.occupied.has(`${ngx},${ngy}`)) continue

      const bendCost = (curr.dir !== -1 && curr.dir !== d) ? BEND_PENALTY : 0
      const newCost = curr.cost + 1 + bendCost

      const nkey = `${ngx},${ngy},${d}`
      const existing = visited.get(nkey)
      if (existing !== undefined && existing <= newCost) continue

      visited.set(nkey, newCost)
      parent.set(nkey, { gx: curr.gx, gy: curr.gy, dir: curr.dir })
      queue.push({ gx: ngx, gy: ngy, dir: d, cost: newCost })
    }
  }

  if (!found) return null

  return reconstructPath(endGx, endGy, foundDir, parent)
}

/**
 * 交差ペナルティ付き BFS。
 * penaltyMap のセルを異なる方向で通過するとき CROSS_PENALTY を加算。
 */
export function bfsSearchWithPenalty(
  srcX: number, srcY: number,
  dstX: number, dstY: number,
  grid: ObstacleGrid,
  penaltyMap: Map<string, 'h' | 'v'>,
): BFSResult | null {
  const startGx = Math.round(srcX / GRID_SIZE)
  const startGy = Math.round(srcY / GRID_SIZE)
  const endGx = Math.round(dstX / GRID_SIZE)
  const endGy = Math.round(dstY / GRID_SIZE)

  if (startGx === endGx && startGy === endGy) {
    return { gridPath: [{ gx: startGx, gy: startGy }, { gx: endGx, gy: endGy }], cost: 0 }
  }

  const visited = new Map<string, number>()
  const parent = new Map<string, { gx: number; gy: number; dir: number }>()
  const queue: BFSNode[] = []

  for (let d = 0; d < 4; d++) {
    const ngx = startGx + DIRS[d].dx
    const ngy = startGy + DIRS[d].dy
    if (grid.occupied.has(`${ngx},${ngy}`)) continue
    const key = `${ngx},${ngy},${d}`
    queue.push({ gx: ngx, gy: ngy, dir: d, cost: 1 })
    visited.set(key, 1)
    parent.set(key, { gx: startGx, gy: startGy, dir: -1 })
  }

  let found = false
  let foundDir = -1
  let foundCost = Infinity
  let iterations = 0

  while (queue.length > 0 && iterations < MAX_BFS_CELLS) {
    iterations++

    let minIdx = 0
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].cost < queue[minIdx].cost) minIdx = i
    }
    const curr = queue.splice(minIdx, 1)[0]

    if (curr.cost >= foundCost) continue

    if (curr.gx === endGx && curr.gy === endGy) {
      found = true
      foundDir = curr.dir
      foundCost = curr.cost
      continue
    }

    for (let d = 0; d < 4; d++) {
      const ngx = curr.gx + DIRS[d].dx
      const ngy = curr.gy + DIRS[d].dy

      if (ngx < grid.minX || ngx > grid.maxX || ngy < grid.minY || ngy > grid.maxY) continue
      if (grid.occupied.has(`${ngx},${ngy}`)) continue

      const bendCost = (curr.dir !== -1 && curr.dir !== d) ? BEND_PENALTY : 0

      // 交差ペナルティ
      let crossCost = 0
      const cellKey = `${ngx},${ngy}`
      const existing = penaltyMap.get(cellKey)
      if (existing !== undefined) {
        const myDir = (d === 0 || d === 2) ? 'v' : 'h'
        if (existing !== myDir) {
          crossCost = CROSS_PENALTY
        }
      }

      const newCost = curr.cost + 1 + bendCost + crossCost

      const nkey = `${ngx},${ngy},${d}`
      const existingCost = visited.get(nkey)
      if (existingCost !== undefined && existingCost <= newCost) continue

      visited.set(nkey, newCost)
      parent.set(nkey, { gx: curr.gx, gy: curr.gy, dir: curr.dir })
      queue.push({ gx: ngx, gy: ngy, dir: d, cost: newCost })
    }
  }

  if (!found) return null

  return reconstructPath(endGx, endGy, foundDir, parent)
}

// ============================================================
// Path Processing
// ============================================================

/** BFS の parent マップからパスを復元 */
function reconstructPath(
  endGx: number, endGy: number, foundDir: number,
  parent: Map<string, { gx: number; gy: number; dir: number }>,
): BFSResult {
  const gridPath: Array<{ gx: number; gy: number }> = []
  let currKey = `${endGx},${endGy},${foundDir}`
  gridPath.push({ gx: endGx, gy: endGy })

  while (parent.has(currKey)) {
    const p = parent.get(currKey)!
    gridPath.push({ gx: p.gx, gy: p.gy })
    currKey = `${p.gx},${p.gy},${p.dir}`
  }
  gridPath.reverse()

  // foundDir から cost を復元する手段がないが、呼び出し元では使わないので 0
  return { gridPath, cost: 0 }
}

/**
 * BFS パスの最初/最後のセグメント方向からアイコン接続辺を決定する。
 * 「上から来た矢印は上辺に接続」ルール。
 */
export function determineSide(
  gridPath: Array<{ gx: number; gy: number }>,
  which: 'src' | 'dst',
): Side {
  if (gridPath.length < 2) return 'right'

  let dx: number, dy: number
  if (which === 'src') {
    dx = gridPath[1].gx - gridPath[0].gx
    dy = gridPath[1].gy - gridPath[0].gy
  } else {
    const n = gridPath.length
    dx = gridPath[n - 1].gx - gridPath[n - 2].gx
    dy = gridPath[n - 1].gy - gridPath[n - 2].gy
  }

  if (which === 'src') {
    if (dx > 0) return 'right'
    if (dx < 0) return 'left'
    if (dy > 0) return 'bottom'
    return 'top'
  } else {
    if (dx > 0) return 'left'
    if (dx < 0) return 'right'
    if (dy > 0) return 'top'
    return 'bottom'
  }
}

/** グリッドパスを簡略化: 方向が変わる点（折れ点）のみ残す */
export function simplifyPath(
  gridPath: Array<{ gx: number; gy: number }>,
  p1: Point,
  p2: Point,
): Point[] {
  if (gridPath.length <= 1) return [p1, p2]

  const points: Point[] = [p1]

  for (let i = 1; i < gridPath.length - 1; i++) {
    const prev = gridPath[i - 1]
    const curr = gridPath[i]
    const next = gridPath[i + 1]

    const dx1 = curr.gx - prev.gx
    const dy1 = curr.gy - prev.gy
    const dx2 = next.gx - curr.gx
    const dy2 = next.gy - curr.gy

    if (dx1 !== dx2 || dy1 !== dy2) {
      points.push({ x: curr.gx * GRID_SIZE, y: curr.gy * GRID_SIZE })
    }
  }

  points.push(p2)

  // 折れ点を直交化
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const next = points[i + 1]
    const curr = points[i]

    const fromHorizontal = Math.abs(curr.y - prev.y) < Math.abs(curr.x - prev.x)
    if (fromHorizontal) {
      curr.y = prev.y
      curr.x = next.x
    } else {
      curr.x = prev.x
      curr.y = next.y
    }
  }

  return points
}

/** BFS失敗時のフォールバック（単純な直交ルート） */
export function fallbackRoute(
  p1: Point, srcSide: Side,
  p2: Point, dstSide: Side,
): Point[] {
  const points: Point[] = [p1]
  const isHorizontalSrc = srcSide === 'left' || srcSide === 'right'
  const isHorizontalDst = dstSide === 'left' || dstSide === 'right'

  if (isHorizontalSrc && isHorizontalDst) {
    if (p1.y !== p2.y) {
      const midX = (p1.x + p2.x) / 2
      points.push({ x: midX, y: p1.y })
      points.push({ x: midX, y: p2.y })
    }
  } else if (!isHorizontalSrc && !isHorizontalDst) {
    if (p1.x !== p2.x) {
      const midY = (p1.y + p2.y) / 2
      points.push({ x: p1.x, y: midY })
      points.push({ x: p2.x, y: midY })
    }
  } else {
    if (isHorizontalSrc) {
      points.push({ x: p2.x, y: p1.y })
    } else {
      points.push({ x: p1.x, y: p2.y })
    }
  }

  points.push(p2)
  return points
}
