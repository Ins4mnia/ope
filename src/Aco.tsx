import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Flame,
  Zap,
  TrendingDown,
  Check,
  X,
  Edit3,
  MousePointer,
  DoorOpen,
  Eraser,
  Square,
  MapPin,
  Trash2,
  StepForward,
  Sparkles,
  Calculator,
  Plus,
  BarChart3,
  BookOpen,
  ChevronDown,
} from "lucide-react";

const TOOLS = {
  NONE: "none",
  FIRE: "fire",
  WALL: "wall",
  EXIT: "exit",
  START: "start",
  ERASE: "erase",
};

const MODES = {
  NORMAL: "normal", // обычная итерация всеми муравьями
  STEP_ANT: "step_ant", // один муравей пошагово
};

export default function SchoolEvacuationACO() {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const animationRef = useRef(null);

  const [isRunning, setIsRunning] = useState(false);
  const [iteration, setIteration] = useState(0);
  const [bestCost, setBestCost] = useState(null);
  const [bestLength, setBestLength] = useState(null);
  const [bestFireDist, setBestFireDist] = useState(null);
  const [successRate, setSuccessRate] = useState(0);
  const [improvement, setImprovement] = useState(0);
  const [firstCost, setFirstCost] = useState(null);
  const [convergedAt, setConvergedAt] = useState(null);
  const [iterStats, setIterStats] = useState(null);
  const [stepAutoRunning, setStepAutoRunning] = useState(false);
  const stepAutoRef = useRef(null);
  const [showPheromone, setShowPheromone] = useState(true);
  const [showAnts, setShowAnts] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [fireMode, setFireMode] = useState('static'); // 'static' | 'dynamic'

  // Метрики: какие отслеживаются + меню выбора
  const [selectedMetrics, setSelectedMetrics] = useState(['iterations', 'length', 'cost']);
  const [metricsMenuOpen, setMetricsMenuOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(null); // index открытого пункта или null

  // Редактор
  const [editMode, setEditMode] = useState(false);
  const [activeTool, setActiveTool] = useState(TOOLS.FIRE);
  const [isDrawing, setIsDrawing] = useState(false);

  // Режим работы
  const [mode, setMode] = useState(MODES.NORMAL);

  // Пошаговый режим: текущий муравей и состояние
  const [stepAntState, setStepAntState] = useState(null);

  // Подсказки клеток
  const [hoveredCell, setHoveredCell] = useState(null);
  const [pinnedCell, setPinnedCell] = useState(null); // зафиксированная клетка для разбора формулы

  // Параметры
  const [alpha, setAlpha] = useState(1.0);
  const [beta, setBeta] = useState(3.0);
  const [rho, setRho] = useState(0.1);
  const [Q, setQ] = useState(100);
  const [numAnts, setNumAnts] = useState(20);
  const [eliteWeight, setEliteWeight] = useState(2); // вес элитного муравья

  const W = 720;
  const H = 480;
  const COLS = 36;
  const ROWS = 24;
  const CELL = 20;
  const OFFSET_X = (W - COLS * CELL) / 2;
  const OFFSET_Y = (H - ROWS * CELL) / 2;

  const stateRef = useRef({
    grid: [],
    pheromone: [], // феромон на клетках (для совместимости с отображением)
    pheromoneEdges: {}, // ИСПРАВЛЕНО: феромон на рёбрах "r,c-r,c"
    starts: [],
    exits: [],
    fires: [],
    bestPath: null,
    bestCost: Infinity,
    ants: [],
    iter: 0,
    convergenceHistory: [],
    iterBestHistory: [],
    activeStart: null,
    firstCost: null,
    stagnantIters: 0,
  });

  // === Утилиты ===
  const edgeKey = (r1, c1, r2, c2) => {
    // Сортируем, чтобы ребро (A,B) = (B,A)
    if (r1 < r2 || (r1 === r2 && c1 < c2)) return `${r1},${c1}-${r2},${c2}`;
    return `${r2},${c2}-${r1},${c1}`;
  };

  const getEdgePheromone = (r1, c1, r2, c2) => {
    const key = edgeKey(r1, c1, r2, c2);
    return stateRef.current.pheromoneEdges[key] ?? 1.0;
  };

  const setEdgePheromone = (r1, c1, r2, c2, value) => {
    const key = edgeKey(r1, c1, r2, c2);
    stateRef.current.pheromoneEdges[key] = value;
  };

  // === ИНИЦИАЛИЗАЦИЯ ===
  const applyFires = (grid, fires) => {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === 2) grid[r][c] = 0;
      }
    }
    for (const fire of fires) {
      for (let dy = -fire.radius; dy <= fire.radius; dy++) {
        for (let dx = -fire.radius; dx <= fire.radius; dx++) {
          const r = fire.row + dy;
          const c = fire.col + dx;
          if (r > 0 && r < ROWS - 1 && c > 0 && c < COLS - 1) {
            const distSq = dx * dx + dy * dy;
            if (distSq <= fire.radius * fire.radius && grid[r][c] === 0) {
              grid[r][c] = 2;
            }
          }
        }
      }
    }
  };

  const initSchool = useCallback(() => {
    const grid = Array(ROWS)
      .fill(null)
      .map(() => Array(COLS).fill(0));

    for (let x = 0; x < COLS; x++) {
      grid[0][x] = 1;
      grid[ROWS - 1][x] = 1;
    }
    for (let y = 0; y < ROWS; y++) {
      grid[y][0] = 1;
      grid[y][COLS - 1] = 1;
    }

    const doorsTop = [3, 13, 18, 26, 32];
    for (let x = 1; x < COLS - 1; x++) {
      if (!doorsTop.includes(x)) grid[7][x] = 1;
    }
    const doorsBot = [4, 9, 16, 26, 30];
    grid[16][4] = 0; // ensure (16,4) is open
    for (let x = 1; x < COLS - 1; x++) {
      if (!doorsBot.includes(x)) grid[16][x] = 1;
    }

    const verticalWalls = [8, 15, 22, 29];
    for (const x of verticalWalls) {
      for (let y = 1; y < 7; y++) grid[y][x] = 1;
      for (let y = 17; y < ROWS - 1; y++) grid[y][x] = 1;
    }

    const starts = [
      { row: 4, col: 18, name: "103" },
      { row: 4, col: 4, name: "101" },
      { row: 4, col: 11, name: "102" },
      { row: 4, col: 25, name: "104" },
      { row: 4, col: 32, name: "105" },
      { row: 20, col: 4, name: "201" },
      { row: 20, col: 11, name: "202" },
      { row: 20, col: 18, name: "203" },
      { row: 20, col: 25, name: "204" },
      { row: 20, col: 32, name: "205" },
    ];

    const exits = [
      { row: 0, col: 4, name: "A" },
      { row: 0, col: 31, name: "B" },
      { row: ROWS - 1, col: 4, name: "C" },
      { row: ROWS - 1, col: 31, name: "D" },
    ];

    exits.forEach((e) => {
      grid[e.row][e.col] = 3;
    });

    const fires = [
      { row: 11, col: 17, radius: 2 },
      { row: 12, col: 23, radius: 2 },
      { row: 5, col: 12, radius: 1 },
      { row: 15, col: 19, radius: 2 },
    ];

    applyFires(grid, fires);
    starts.forEach((s) => {
      grid[s.row][s.col] = 4;
    });

    const pheromone = Array(ROWS)
      .fill(null)
      .map(() => Array(COLS).fill(1.0));

    stateRef.current = {
      grid,
      pheromone,
      pheromoneEdges: {},
      starts,
      exits,
      fires,
      bestPath: null,
      bestCost: Infinity,
      ants: [],
      iter: 0,
      convergenceHistory: [],
      iterBestHistory: [],
      activeStart: starts[0],
      firstCost: null,
      stagnantIters: 0,
    };

    resetMetrics();
    setStepAntState(null);
  }, []);

  const resetMetrics = () => {
    setIteration(0);
    setBestCost(null);
    setBestLength(null);
    setBestFireDist(null);
    setSuccessRate(0);
    setImprovement(0);
    setFirstCost(null);
    setConvergedAt(null);
    setIterStats(null);
  };

  const resetSimulation = () => {
    setIsRunning(false);
    const state = stateRef.current;
    state.pheromone = Array(ROWS)
      .fill(null)
      .map(() => Array(COLS).fill(1.0));
    state.pheromoneEdges = {};
    state.bestPath = null;
    state.bestCost = Infinity;
    state.ants = [];
    state.iter = 0;
    state.convergenceHistory = [];
    state.iterBestHistory = [];
    state.firstCost = null;
    state.stagnantIters = 0;
    resetMetrics();
    setStepAntState(null);
  };

  const fullReset = () => {
    setIsRunning(false);
    initSchool();
  };

  useEffect(() => {
    initSchool();
  }, [initSchool]);

  // === АЛГОРИТМ ===
  const heuristicValue = (row, col) => {
    const { exits, fires } = stateRef.current;
    if (exits.length === 0) return 0.01;

    let minExit = Infinity;
    for (const e of exits) {
      const d = Math.abs(row - e.row) + Math.abs(col - e.col);
      if (d < minExit) minExit = d;
    }
    let minFire = Infinity;
    for (const f of fires) {
      const d = Math.hypot(row - f.row, col - f.col);
      if (d < minFire) minFire = d;
    }
    if (minFire === Infinity) minFire = 100;
    return (1 / (minExit + 1)) * Math.min(1, minFire / 4) + 0.01;
  };

  // ИСПРАВЛЕНО: получение соседей с использованием рёбер
  const getNeighborProbabilities = (row, col, visitedSet) => {
    const { grid } = stateRef.current;
    const moves = [
      { dr: -1, dc: 0, name: "север" },
      { dr: 1, dc: 0, name: "юг" },
      { dr: 0, dc: -1, name: "запад" },
      { dr: 0, dc: 1, name: "восток" },
    ];

    const candidates = [];
    let totalProb = 0;

    for (const m of moves) {
      const nr = row + m.dr;
      const nc = col + m.dc;
      const key = `${nr},${nc}`;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      const cell = grid[nr][nc];
      if (cell === 1 || cell === 2) continue;
      if (visitedSet && visitedSet.has(key)) continue;

      const tau = getEdgePheromone(row, col, nr, nc);
      const eta = heuristicValue(nr, nc);
      const f = Math.pow(tau, alpha) * Math.pow(eta, beta);
      candidates.push({ nr, nc, tau, eta, f, direction: m.name });
      totalProb += f;
    }

    // Нормализуем
    candidates.forEach((c) => {
      c.prob = totalProb > 0 ? c.f / totalProb : 0;
    });
    return { candidates, totalProb };
  };

  // ИСПРАВЛЕНО: тупики не сбрасывают visited, а откатываются назад
  const buildAntPath = () => {
    const { grid, activeStart } = stateRef.current;
    if (!activeStart) return { path: [], success: false };

    let row = activeStart.row;
    let col = activeStart.col;
    const path = [{ row, col }];
    const visited = new Set();
    visited.add(`${row},${col}`);

    for (let step = 0; step < 200; step++) {
      if (grid[row][col] === 3) return { path, success: true };

      const { candidates } = getNeighborProbabilities(row, col, visited);

      if (candidates.length === 0) {
        // ИСПРАВЛЕНО: откат на шаг назад вместо сброса visited
        if (path.length <= 1) return { path, success: false };
        path.pop();
        const prev = path[path.length - 1];
        row = prev.row;
        col = prev.col;
        // visited НЕ очищаем — клетки-тупики помечены и больше не попадут в путь
        continue;
      }

      let totalProb = candidates.reduce((s, c) => s + c.f, 0);
      let r = Math.random() * totalProb;
      let chosen = candidates[0];
      for (const c of candidates) {
        r -= c.f;
        if (r <= 0) {
          chosen = c;
          break;
        }
      }

      row = chosen.nr;
      col = chosen.nc;
      path.push({ row, col });
      visited.add(`${row},${col}`);
    }
    return { path, success: false };
  };

  const minDistanceToFire = (path) => {
    const { fires } = stateRef.current;
    if (fires.length === 0) return Infinity;
    let min = Infinity;
    for (const p of path) {
      for (const f of fires) {
        const d = Math.hypot(p.row - f.row, p.col - f.col);
        if (d < min) min = d;
      }
    }
    return min;
  };

  const evaluatePath = (path, success) => {
    if (!success) return Infinity;
    const { fires } = stateRef.current;
    let cost = path.length;
    for (const p of path) {
      for (const f of fires) {
        const d = Math.hypot(p.row - f.row, p.col - f.col);
        if (d < 4) cost += (4 - d) * 2;
      }
    }
    return cost;
  };

  // Обновление матрицы феромона на клетках (для визуализации) из рёбер
  const syncPheromoneMatrix = () => {
    const state = stateRef.current;
    const matrix = Array(ROWS)
      .fill(null)
      .map(() => Array(COLS).fill(0));
    const counts = Array(ROWS)
      .fill(null)
      .map(() => Array(COLS).fill(0));

    for (const key in state.pheromoneEdges) {
      const [a, b] = key.split("-");
      const [r1, c1] = a.split(",").map(Number);
      const [r2, c2] = b.split(",").map(Number);
      const val = state.pheromoneEdges[key];
      matrix[r1][c1] += val;
      matrix[r2][c2] += val;
      counts[r1][c1]++;
      counts[r2][c2]++;
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (counts[r][c] > 0) {
          state.pheromone[r][c] = matrix[r][c] / counts[r][c];
        } else {
          state.pheromone[r][c] = 1.0;
        }
      }
    }
  };

  const runIteration = () => {
    const state = stateRef.current;
    if (!state.activeStart || state.exits.length === 0) return;

    const solutions = [];
    let successCount = 0;
    for (let k = 0; k < numAnts; k++) {
      const result = buildAntPath();
      result.cost = evaluatePath(result.path, result.success);
      if (result.success) successCount++;
      solutions.push(result);
    }

    const validSolutions = solutions.filter((s) => s.success);

    if (validSolutions.length > 0) {
      validSolutions.sort((a, b) => a.cost - b.cost);
      const iterBest = validSolutions[0];

      if (iterBest.cost < state.bestCost) {
        state.bestCost = iterBest.cost;
        state.bestPath = iterBest.path;
        state.stagnantIters = 0;
      } else {
        state.stagnantIters++;
      }

      if (state.firstCost === null) {
        state.firstCost = iterBest.cost;
        setFirstCost(iterBest.cost);
      }

      if (state.stagnantIters === 10 && convergedAt === null) {
        setConvergedAt(state.iter);
      }

      state.iterBestHistory.push(iterBest.cost);

      // Live values for best ant this iteration
      {
        const bp = iterBest.path;
        let tauSum = 0,
          etaSum = 0,
          edgeCount = 0;
        for (let i = 0; i < bp.length - 1; i++) {
          const p1 = bp[i],
            p2 = bp[i + 1];
          tauSum += getEdgePheromone(p1.row, p1.col, p2.row, p2.col);
          etaSum += heuristicValue(p2.row, p2.col);
          edgeCount++;
        }
        const tauAvg = edgeCount > 0 ? tauSum / edgeCount : 1;
        const etaAvg = edgeCount > 0 ? etaSum / edgeCount : 0;
        const fAvg = Math.pow(tauAvg, alpha) * Math.pow(etaAvg, beta);
        const deltaT = Q / iterBest.cost;
        const tauNew = (1 - rho) * tauAvg + deltaT;
        setIterStats({
          tauAvg,
          etaAvg,
          fAvg,
          deltaT,
          tauNew,
          pathLen: bp.length,
          cost: iterBest.cost,
          alpha,
          beta,
          rho,
          Q,
        });
      }

      // ИСПРАВЛЕНО: испарение на рёбрах
      for (const key in state.pheromoneEdges) {
        state.pheromoneEdges[key] *= 1 - rho;
        if (state.pheromoneEdges[key] < 0.05) state.pheromoneEdges[key] = 0.05;
      }

      // Отложение на рёбрах
      const topK = Math.max(1, Math.floor(validSolutions.length * 0.3));
      for (let k = 0; k < topK; k++) {
        const sol = validSolutions[k];
        const deposit = Q / sol.cost;
        for (let i = 0; i < sol.path.length - 1; i++) {
          const p1 = sol.path[i];
          const p2 = sol.path[i + 1];
          const cur = getEdgePheromone(p1.row, p1.col, p2.row, p2.col);
          setEdgePheromone(p1.row, p1.col, p2.row, p2.col, cur + deposit);
        }
      }

      // ИСПРАВЛЕНО: элитная стратегия — глобально лучший откладывает дополнительно
      if (state.bestPath) {
        const eliteDeposit = (Q / state.bestCost) * eliteWeight;
        for (let i = 0; i < state.bestPath.length - 1; i++) {
          const p1 = state.bestPath[i];
          const p2 = state.bestPath[i + 1];
          const cur = getEdgePheromone(p1.row, p1.col, p2.row, p2.col);
          setEdgePheromone(p1.row, p1.col, p2.row, p2.col, cur + eliteDeposit);
        }
      }

      // Ограничение сверху
      for (const key in state.pheromoneEdges) {
        if (state.pheromoneEdges[key] > 15) state.pheromoneEdges[key] = 15;
      }

      syncPheromoneMatrix();

      const fireDist = minDistanceToFire(state.bestPath);
      setBestLength(state.bestPath.length);
      setBestFireDist(fireDist);

      if (state.firstCost) {
        const imp =
          ((state.firstCost - state.bestCost) / state.firstCost) * 100;
        setImprovement(imp);
      }
    } else {
      state.iterBestHistory.push(null);
    }

    setSuccessRate((successCount / numAnts) * 100);
    state.iter++;
    state.ants = solutions.slice(0, 6);
    state.convergenceHistory.push(
      state.bestCost === Infinity ? null : state.bestCost,
    );
    if (state.convergenceHistory.length > 100) {
      state.convergenceHistory.shift();
      state.iterBestHistory.shift();
    }

    // === Динамический пожар: каждые 5 итераций сдвигаем очаги ===
    if (fireMode === 'dynamic' && state.iter % 5 === 0 && state.fires.length > 0) {
      const dirs = [[-1,0],[1,0],[0,-1],[0,1],[0,0]];
      const newFires = state.fires.map((f) => {
        for (let tries = 0; tries < 8; tries++) {
          const [dr, dc] = dirs[Math.floor(Math.random() * dirs.length)];
          const nr = f.row + dr;
          const nc = f.col + dc;
          if (nr > 1 && nr < ROWS - 2 && nc > 1 && nc < COLS - 2 &&
              state.grid[nr][nc] !== 1 && state.grid[nr][nc] !== 3 &&
              state.grid[nr][nc] !== 4) {
            return { ...f, row: nr, col: nc };
          }
        }
        return f;
      });
      state.fires = newFires;
      applyFires(state.grid, state.fires);
      state.starts.forEach((s) => {
        if (state.grid[s.row][s.col] === 0) state.grid[s.row][s.col] = 4;
      });
      state.exits.forEach((e) => { state.grid[e.row][e.col] = 3; });
      // Сбросим лучший путь — он может теперь проходить через огонь
      state.bestPath = null;
      state.bestCost = Infinity;
    }

    setIteration(state.iter);
    setBestCost(state.bestCost === Infinity ? null : state.bestCost);
  };

  // === ПОШАГОВЫЙ РЕЖИМ ===
  const startStepAnt = () => {
    const state = stateRef.current;
    if (!state.activeStart) return;

    setStepAntState({
      row: state.activeStart.row,
      col: state.activeStart.col,
      path: [{ row: state.activeStart.row, col: state.activeStart.col }],
      visited: new Set([`${state.activeStart.row},${state.activeStart.col}`]),
      candidates: [],
      done: false,
      success: false,
      lastChosen: null,
      stepNumber: 0, // номер шага
      log: [], // журнал шагов с математикой
      randomR: null, // случайное число r для рулетки последнего шага
    });

    setTimeout(() => updateStepCandidates(), 50);
  };

  const updateStepCandidates = () => {
    setStepAntState((prev) => {
      if (!prev || prev.done) return prev;
      const { candidates } = getNeighborProbabilities(
        prev.row,
        prev.col,
        prev.visited,
      );
      return { ...prev, candidates };
    });
  };

  const stepAntNext = () => {
    setStepAntState((prev) => {
      if (!prev || prev.done) return prev;

      const state = stateRef.current;

      if (state.grid[prev.row][prev.col] === 3) {
        return { ...prev, done: true, success: true, candidates: [] };
      }

      const { candidates } = getNeighborProbabilities(
        prev.row,
        prev.col,
        prev.visited,
      );

      if (candidates.length === 0) {
        // Тупик — откат
        if (prev.path.length <= 1) {
          const logEntry = {
            step: prev.stepNumber + 1,
            from: { row: prev.row, col: prev.col },
            to: null,
            type: "dead_end_terminal",
            description:
              "Тупик в стартовой клетке — муравей не может двигаться",
            candidates: [],
          };
          return {
            ...prev,
            done: true,
            success: false,
            candidates: [],
            stepNumber: prev.stepNumber + 1,
            log: [...prev.log, logEntry],
          };
        }
        const newPath = prev.path.slice(0, -1);
        const newPos = newPath[newPath.length - 1];
        const logEntry = {
          step: prev.stepNumber + 1,
          from: { row: prev.row, col: prev.col },
          to: newPos,
          type: "backtrack",
          description:
            "Все соседи — стены, огонь или уже посещены. Откат на шаг назад.",
          candidates: [],
        };
        return {
          ...prev,
          row: newPos.row,
          col: newPos.col,
          path: newPath,
          candidates: [],
          lastChosen: { ...prev, isBacktrack: true },
          stepNumber: prev.stepNumber + 1,
          log: [...prev.log, logEntry],
        };
      }

      const totalProb = candidates.reduce((s, c) => s + c.f, 0);
      const randomR = Math.random() * totalProb;
      let r = randomR;
      let chosen = candidates[0];
      let chosenIndex = 0;
      for (let i = 0; i < candidates.length; i++) {
        r -= candidates[i].f;
        if (r <= 0) {
          chosen = candidates[i];
          chosenIndex = i;
          break;
        }
      }

      const newPath = [...prev.path, { row: chosen.nr, col: chosen.nc }];
      const newVisited = new Set(prev.visited);
      newVisited.add(`${chosen.nr},${chosen.nc}`);

      // === Логируем шаг ===
      const logEntry = {
        step: prev.stepNumber + 1,
        from: { row: prev.row, col: prev.col },
        to: { row: chosen.nr, col: chosen.nc },
        type: "move",
        direction: chosen.direction,
        candidates: candidates.map((c) => ({
          direction: c.direction,
          tau: c.tau,
          eta: c.eta,
          f: c.f,
          prob: c.prob,
          chosen: c === chosen,
          to: { row: c.nr, col: c.nc },
        })),
        totalProb,
        randomR,
        chosen,
        alpha,
        beta,
      };

      const newState = {
        row: chosen.nr,
        col: chosen.nc,
        path: newPath,
        visited: newVisited,
        candidates: [],
        done: false,
        success: false,
        lastChosen: chosen,
        stepNumber: prev.stepNumber + 1,
        log: [...prev.log, logEntry],
        randomR,
      };

      if (state.grid[chosen.nr][chosen.nc] === 3) {
        newState.done = true;
        newState.success = true;
      }

      if (!newState.done) {
        const { candidates: next } = getNeighborProbabilities(
          newState.row,
          newState.col,
          newState.visited,
        );
        newState.candidates = next;
      }

      return newState;
    });
  };

  useEffect(() => {
    if (
      mode === MODES.STEP_ANT &&
      stepAntState &&
      stepAntState.candidates.length === 0 &&
      !stepAntState.done
    ) {
      updateStepCandidates();
    }
  }, [stepAntState, mode]);

  // Deposit pheromone when step ant reaches exit
  useEffect(() => {
    if (
      mode === MODES.STEP_ANT &&
      stepAntState &&
      stepAntState.done &&
      stepAntState.success
    ) {
      const path = stepAntState.path;
      const deposit = Q / path.length;
      for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i],
          p2 = path[i + 1];
        const cur = getEdgePheromone(p1.row, p1.col, p2.row, p2.col);
        setEdgePheromone(
          p1.row,
          p1.col,
          p2.row,
          p2.col,
          Math.min(15, cur + deposit),
        );
      }
      syncPheromoneMatrix();
    }
  }, [stepAntState]);

  // Auto-step for step ant mode
  useEffect(() => {
    if (!stepAutoRunning || mode !== MODES.STEP_ANT) return;
    const ms = Math.round(400 / speed);
    stepAutoRef.current = setInterval(() => {
      stepAntNext();
    }, ms);
    return () => clearInterval(stepAutoRef.current);
  }, [stepAutoRunning, mode, speed, alpha, beta]);

  // === АНИМАЦИЯ ===
  useEffect(() => {
    if (!isRunning || editMode || mode !== MODES.NORMAL) return;
    let lastTime = 0;
    const interval = 500 / speed;
    const tick = (time) => {
      if (time - lastTime > interval) {
        runIteration();
        lastTime = time;
      }
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationRef.current);
  }, [
    isRunning,
    editMode,
    mode,
    speed,
    alpha,
    beta,
    rho,
    Q,
    numAnts,
    eliteWeight,
    convergedAt,
    fireMode,
  ]);

  // === РЕДАКТОР ===
  const handleCanvasInteraction = (e, isClick = false) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const col = Math.floor((x - OFFSET_X) / CELL);
    const row = Math.floor((y - OFFSET_Y) / CELL);

    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;

    if (editMode) {
      applyTool(row, col, isClick);
      return null;
    }

    return { row, col };
  };

  const applyTool = (row, col, isClick) => {
    const state = stateRef.current;

    if (row === 0 || row === ROWS - 1 || col === 0 || col === COLS - 1) {
      if (activeTool === TOOLS.EXIT && isClick) {
        if (
          !((row === 0 || row === ROWS - 1) && (col === 0 || col === COLS - 1))
        ) {
          addExit(row, col);
        }
      }
      return;
    }

    switch (activeTool) {
      case TOOLS.FIRE:
        if (isClick) addFire(row, col);
        break;
      case TOOLS.WALL:
        if (state.grid[row][col] === 0) {
          state.grid[row][col] = 1;
          applyFires(state.grid, state.fires);
        }
        break;
      case TOOLS.START:
        if (
          isClick &&
          state.grid[row][col] !== 1 &&
          state.grid[row][col] !== 2
        ) {
          setStart(row, col);
        }
        break;
      case TOOLS.ERASE:
        eraseAt(row, col);
        break;
    }

    if (isClick || activeTool === TOOLS.WALL || activeTool === TOOLS.ERASE) {
      resetSimulation();
    }
  };

  const addFire = (row, col) => {
    const state = stateRef.current;
    if (
      state.grid[row][col] === 1 ||
      state.grid[row][col] === 4 ||
      state.grid[row][col] === 3
    )
      return;
    state.fires.push({ row, col, radius: 1 });
    applyFires(state.grid, state.fires);
    state.starts.forEach((s) => {
      if (state.grid[s.row][s.col] === 0) state.grid[s.row][s.col] = 4;
    });
    state.exits.forEach((e) => {
      state.grid[e.row][e.col] = 3;
    });
  };

  const addExit = (row, col) => {
    const state = stateRef.current;
    if (state.exits.find((e) => e.row === row && e.col === col)) return;
    const name = String.fromCharCode(65 + state.exits.length);
    state.exits.push({ row, col, name });
    state.grid[row][col] = 3;
  };

  const setStart = (row, col) => {
    const state = stateRef.current;
    if (state.activeStart) {
      const oldR = state.activeStart.row;
      const oldC = state.activeStart.col;
      state.starts = state.starts.filter(
        (s) => !(s.row === oldR && s.col === oldC),
      );
      if (state.grid[oldR][oldC] === 4) state.grid[oldR][oldC] = 0;
    }
    const newStart = { row, col, name: "★" };
    state.starts.push(newStart);
    state.activeStart = newStart;
    state.grid[row][col] = 4;
  };

  const eraseAt = (row, col) => {
    const state = stateRef.current;
    const fireIdx = state.fires.findIndex(
      (f) =>
        Math.abs(f.row - row) <= f.radius && Math.abs(f.col - col) <= f.radius,
    );
    if (fireIdx !== -1) {
      state.fires.splice(fireIdx, 1);
      applyFires(state.grid, state.fires);
      state.starts.forEach((s) => {
        if (state.grid[s.row][s.col] === 0) state.grid[s.row][s.col] = 4;
      });
      state.exits.forEach((e) => {
        state.grid[e.row][e.col] = 3;
      });
      return;
    }
    const exitIdx = state.exits.findIndex(
      (e) => e.row === row && e.col === col,
    );
    if (exitIdx !== -1) {
      state.exits.splice(exitIdx, 1);
      if (row === 0 || row === ROWS - 1 || col === 0 || col === COLS - 1) {
        state.grid[row][col] = 1;
      } else state.grid[row][col] = 0;
      return;
    }
    if (state.grid[row][col] === 1) state.grid[row][col] = 0;
  };

  const clearFires = () => {
    const state = stateRef.current;
    state.fires = [];
    applyFires(state.grid, state.fires);
    state.starts.forEach((s) => {
      if (state.grid[s.row][s.col] === 0) state.grid[s.row][s.col] = 4;
    });
    state.exits.forEach((e) => {
      state.grid[e.row][e.col] = 3;
    });
    resetSimulation();
  };

  const handleMouseDown = (e) => {
    if (editMode) {
      setIsDrawing(true);
      handleCanvasInteraction(e, true);
    } else {
      // Клик по клетке
      const cell = handleCanvasInteraction(e);
      if (cell) {
        const state = stateRef.current;
        const { grid } = state;
        // Если клик по классу — переключаем активный старт
        const clickedStart = state.starts.find(
          (s) => s.row === cell.row && s.col === cell.col,
        );
        if (clickedStart) {
          state.activeStart = clickedStart;
          resetSimulation();
          return;
        }
        // Иначе закрепляем клетку для разбора формулы
        if (grid[cell.row][cell.col] !== 1 && grid[cell.row][cell.col] !== 2) {
          setPinnedCell(cell);
        }
      }
    }
  };

  const handleMouseMove = (e) => {
    if (editMode && isDrawing) {
      if (activeTool === TOOLS.WALL || activeTool === TOOLS.ERASE) {
        handleCanvasInteraction(e, false);
      }
    } else if (!editMode) {
      // Отслеживаем наведение для подсказок
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      const col = Math.floor((x - OFFSET_X) / CELL);
      const row = Math.floor((y - OFFSET_Y) / CELL);
      if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
        setHoveredCell({
          row,
          col,
          mouseX: e.clientX - rect.left,
          mouseY: e.clientY - rect.top,
        });
      } else setHoveredCell(null);
    }
  };

  const handleMouseUp = () => setIsDrawing(false);
  const handleMouseLeave = () => {
    setIsDrawing(false);
    setHoveredCell(null);
  };

  // === ОТРИСОВКА ===
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let fireFrame = 0;

    const draw = () => {
      const { grid, pheromone, starts, exits, bestPath, ants, activeStart } =
        stateRef.current;
      fireFrame++;

      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, W, H);

      // Феромон
      if (showPheromone && !editMode && pheromone.length > 0) {
        let maxPher = 1;
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (pheromone[r][c] > maxPher) maxPher = pheromone[r][c];
          }
        }
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (grid[r][c] === 1 || grid[r][c] === 2) continue;
            const intensity = (pheromone[r][c] - 1) / (maxPher - 1 + 0.001);
            if (intensity > 0.05) {
              ctx.fillStyle = `rgba(255, 200, 50, ${intensity * 0.4})`;
              ctx.fillRect(
                OFFSET_X + c * CELL,
                OFFSET_Y + r * CELL,
                CELL,
                CELL,
              );
            }
          }
        }
      }

      // Стены и огонь
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = grid[r][c];
          const x = OFFSET_X + c * CELL;
          const y = OFFSET_Y + r * CELL;
          if (cell === 1) {
            ctx.fillStyle = "#2a2a35";
            ctx.fillRect(x, y, CELL, CELL);
            ctx.fillStyle = "#3a3a48";
            ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
          } else if (cell === 2) {
            const flicker =
              0.7 + 0.3 * Math.sin(fireFrame / 5 + r * 0.7 + c * 0.5);
            ctx.fillStyle = `rgba(80, 10, 5, 0.9)`;
            ctx.fillRect(x, y, CELL, CELL);
            const grad = ctx.createRadialGradient(
              x + CELL / 2,
              y + CELL / 2,
              0,
              x + CELL / 2,
              y + CELL / 2,
              CELL / 1.2,
            );
            grad.addColorStop(0, `rgba(255, 220, 100, ${flicker})`);
            grad.addColorStop(0.4, `rgba(255, 100, 30, ${flicker * 0.85})`);
            grad.addColorStop(1, "rgba(180, 30, 10, 0.1)");
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, CELL, CELL);
          }
        }
      }

      // Сетка
      ctx.strokeStyle = editMode
        ? "rgba(255, 137, 6, 0.12)"
        : "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;
      for (let r = 0; r <= ROWS; r++) {
        ctx.beginPath();
        ctx.moveTo(OFFSET_X, OFFSET_Y + r * CELL);
        ctx.lineTo(OFFSET_X + COLS * CELL, OFFSET_Y + r * CELL);
        ctx.stroke();
      }
      for (let c = 0; c <= COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(OFFSET_X + c * CELL, OFFSET_Y);
        ctx.lineTo(OFFSET_X + c * CELL, OFFSET_Y + ROWS * CELL);
        ctx.stroke();
      }

      // Лучший путь (только нормальный режим)
      if (!editMode && mode === MODES.NORMAL && bestPath) {
        ctx.strokeStyle = "#7fdbff";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (let i = 0; i < bestPath.length; i++) {
          const p = bestPath[i];
          const x = OFFSET_X + p.col * CELL + CELL / 2;
          const y = OFFSET_Y + p.row * CELL + CELL / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Муравьи
      if (showAnts && !editMode && mode === MODES.NORMAL && ants.length > 0) {
        ants.forEach((ant) => {
          if (!ant.path || ant.path.length < 2) return;
          ctx.strokeStyle = ant.success
            ? "rgba(150, 220, 100, 0.45)"
            : "rgba(220, 100, 100, 0.25)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let i = 0; i < ant.path.length; i++) {
            const p = ant.path[i];
            const x = OFFSET_X + p.col * CELL + CELL / 2;
            const y = OFFSET_Y + p.row * CELL + CELL / 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        });
      }

      // === ПОШАГОВЫЙ МУРАВЕЙ ===
      if (mode === MODES.STEP_ANT && stepAntState) {
        // Уже пройденный путь
        if (stepAntState.path.length > 1) {
          ctx.strokeStyle = stepAntState.success
            ? "rgba(150, 220, 100, 0.9)"
            : "rgba(255, 137, 6, 0.7)";
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          for (let i = 0; i < stepAntState.path.length; i++) {
            const p = stepAntState.path[i];
            const x = OFFSET_X + p.col * CELL + CELL / 2;
            const y = OFFSET_Y + p.row * CELL + CELL / 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }

        // Подсветка кандидатов с вероятностями
        if (!stepAntState.done && stepAntState.candidates.length > 0) {
          stepAntState.candidates.forEach((cand) => {
            const x = OFFSET_X + cand.nc * CELL;
            const y = OFFSET_Y + cand.nr * CELL;
            const intensity = Math.min(1, cand.prob * 1.5);

            ctx.fillStyle = `rgba(127, 219, 255, ${intensity * 0.5})`;
            ctx.fillRect(x, y, CELL, CELL);
            ctx.strokeStyle = "#7fdbff";
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);

            // Процент
            ctx.fillStyle = "#fffffe";
            ctx.font = "bold 10px ui-monospace, monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
              `${(cand.prob * 100).toFixed(0)}%`,
              x + CELL / 2,
              y + CELL / 2,
            );
          });
        }

        // Текущая позиция муравья
        const curX = OFFSET_X + stepAntState.col * CELL + CELL / 2;
        const curY = OFFSET_Y + stepAntState.row * CELL + CELL / 2;
        const pulse = 0.7 + 0.3 * Math.sin(fireFrame / 6);

        ctx.fillStyle = `rgba(255, 137, 6, ${pulse})`;
        ctx.beginPath();
        ctx.arc(curX, curY, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#fffffe";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(curX, curY, 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Активный класс
      if (activeStart && mode === MODES.NORMAL) {
        const x = OFFSET_X + activeStart.col * CELL + CELL / 2;
        const y = OFFSET_Y + activeStart.row * CELL + CELL / 2;
        const pulse = 0.7 + 0.3 * Math.sin(fireFrame / 8);
        ctx.fillStyle = `rgba(255, 137, 6, ${pulse})`;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fffffe";
        ctx.font = "bold 11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(activeStart.name, x, y);
      }

      // Остальные классы (кликабельные)
      starts.forEach((s) => {
        if (s === activeStart && mode === MODES.NORMAL) return;
        if (mode === MODES.STEP_ANT && s === activeStart) return;
        const x = OFFSET_X + s.col * CELL + CELL / 2;
        const y = OFFSET_Y + s.row * CELL + CELL / 2;
        ctx.fillStyle = "rgba(167, 169, 190, 0.35)";
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 137, 6, 0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.font = "bold 9px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(s.name, x, y);
      });

      // Выходы
      exits.forEach((e) => {
        const x = OFFSET_X + e.col * CELL;
        const y = OFFSET_Y + e.row * CELL;
        ctx.fillStyle = "#2ec27e";
        ctx.fillRect(x, y, CELL, CELL);
        ctx.fillStyle = "#fffffe";
        ctx.font = "bold 14px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const arrow =
          e.row === 0
            ? "↑"
            : e.row === ROWS - 1
              ? "↓"
              : e.col === 0
                ? "←"
                : "→";
        ctx.fillText(arrow, x + CELL / 2, y + CELL / 2);
        ctx.fillStyle = "#2ec27e";
        ctx.font = "bold 10px ui-monospace, monospace";
        const labelY =
          e.row === 0
            ? y - 6
            : e.row === ROWS - 1
              ? y + CELL + 12
              : y + CELL / 2;
        ctx.fillText(e.name, x + CELL / 2, labelY);
      });

      // === Подсветка зафиксированной клетки ===
      if (pinnedCell && !editMode) {
        const x = OFFSET_X + pinnedCell.col * CELL;
        const y = OFFSET_Y + pinnedCell.row * CELL;
        const pulse = 0.6 + 0.4 * Math.sin(fireFrame / 10);
        ctx.strokeStyle = `rgba(255, 137, 6, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
        ctx.fillStyle = `rgba(255, 137, 6, ${pulse * 0.15})`;
        ctx.fillRect(x, y, CELL, CELL);
      }

      // === Подсветка hover ===
      if (
        hoveredCell &&
        !editMode &&
        (!pinnedCell ||
          pinnedCell.row !== hoveredCell.row ||
          pinnedCell.col !== hoveredCell.col)
      ) {
        const x = OFFSET_X + hoveredCell.col * CELL;
        const y = OFFSET_Y + hoveredCell.row * CELL;
        ctx.strokeStyle = "rgba(127, 219, 255, 0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
      }

      // === Оверлей редактора ===
      if (editMode && hoveredCell) {
        const x = OFFSET_X + hoveredCell.col * CELL;
        const y = OFFSET_Y + hoveredCell.row * CELL;
        let color = "#ff8906";
        if (activeTool === TOOLS.FIRE) color = "#ff5020";
        else if (activeTool === TOOLS.WALL) color = "#7a7a8a";
        else if (activeTool === TOOLS.EXIT) color = "#2ec27e";
        else if (activeTool === TOOLS.ERASE) color = "#dc6464";
        ctx.fillStyle = `${color}40`;
        ctx.fillRect(x, y, CELL, CELL);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
      }

      // Бейдж режима
      if (editMode) {
        ctx.fillStyle = "rgba(255, 137, 6, 0.95)";
        ctx.fillRect(12, 12, 170, 28);
        ctx.fillStyle = "#0a0a0f";
        ctx.font = "bold 12px ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("РЕДАКТОР КАРТЫ", 22, 26);
      } else if (mode === MODES.STEP_ANT) {
        ctx.fillStyle = "rgba(127, 219, 255, 0.95)";
        ctx.fillRect(12, 12, 180, 28);
        ctx.fillStyle = "#0a0a0f";
        ctx.font = "bold 12px ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("ПОШАГОВЫЙ МУРАВЕЙ", 22, 26);
      }
    };

    let raf;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [
    showPheromone,
    showAnts,
    editMode,
    activeTool,
    mode,
    stepAntState,
    hoveredCell,
    pinnedCell,
  ]);

  // График сходимости
  useEffect(() => {
    const canvas = chartRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const draw = () => {
      const { convergenceHistory, iterBestHistory } = stateRef.current;
      const cw = canvas.width;
      const ch = canvas.height;
      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, cw, ch);

      if (convergenceHistory.length < 2) {
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.font = "11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("запустите алгоритм", cw / 2, ch / 2);
        return;
      }

      const validValues = convergenceHistory.filter(
        (v) => v !== null && v !== Infinity,
      );
      if (validValues.length === 0) return;
      const allVals = [
        ...iterBestHistory.filter((v) => v !== null),
        ...validValues,
      ];
      const maxVal = Math.max(...allVals) * 1.05;
      const minVal = Math.min(...validValues) * 0.95;
      const padL = 38,
        padR = 10,
        padT = 14,
        padB = 22;
      const plotW = cw - padL - padR;
      const plotH = ch - padT - padB;

      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padT + (plotH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(cw - padR, y);
        ctx.stroke();
        const val = maxVal - ((maxVal - minVal) / 4) * i;
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "9px ui-monospace, monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(val.toFixed(0), padL - 4, y);
      }

      const xPos = (i) =>
        padL + (i / (convergenceHistory.length - 1 || 1)) * plotW;
      const yPos = (v) =>
        padT + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;

      ctx.strokeStyle = "rgba(150, 220, 100, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      let started = false;
      iterBestHistory.forEach((v, i) => {
        if (v === null) return;
        const x = xPos(i);
        const y = yPos(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.strokeStyle = "#ff8906";
      ctx.lineWidth = 2;
      ctx.beginPath();
      started = false;
      convergenceHistory.forEach((v, i) => {
        if (v === null || v === Infinity) return;
        const x = xPos(i);
        const y = yPos(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.fillStyle = "#ff8906";
      convergenceHistory.forEach((v, i) => {
        if (v === null || v === Infinity) return;
        ctx.beginPath();
        ctx.arc(xPos(i), yPos(v), 2, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText("итерация →", padL, ch - 4);
      ctx.save();
      ctx.translate(10, padT + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillText("стоимость F", 0, 0);
      ctx.restore();
    };
    let raf;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  // === Данные для разбора формулы ===
  const getFormulaBreakdown = () => {
    const cell = pinnedCell || hoveredCell;
    if (!cell) return null;

    const state = stateRef.current;
    const { grid } = state;
    if (grid[cell.row][cell.col] === 1 || grid[cell.row][cell.col] === 2)
      return null;

    const { candidates } = getNeighborProbabilities(cell.row, cell.col, null);

    return {
      cell,
      eta: heuristicValue(cell.row, cell.col),
      tauAvg: state.pheromone[cell.row][cell.col],
      candidates,
      cellType: grid[cell.row][cell.col],
    };
  };

  const breakdown = getFormulaBreakdown();

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background:
          "linear-gradient(135deg, #0a0a0f 0%, #15151f 50%, #0a0a0f 100%)",
        fontFamily: '"Fraunces", Georgia, serif',
        padding: "24px 16px",
        color: "#fffffe",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,600;9..144,800&family=JetBrains+Mono:wght@400;500;700&display=swap');
        .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        .display { font-family: 'Fraunces', Georgia, serif; }
        input[type="range"] {
          -webkit-appearance: none; appearance: none;
          background: rgba(255,255,255,0.08);
          height: 4px; border-radius: 2px; outline: none;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 14px; height: 14px; border-radius: 50%;
          background: #ff8906; cursor: pointer; border: 2px solid #fffffe;
        }
        input[type="range"]::-moz-range-thumb {
          width: 14px; height: 14px; border-radius: 50%;
          background: #ff8906; cursor: pointer; border: 2px solid #fffffe;
        }
      `}</style>

      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-end justify-between flex-wrap gap-4">
          <div>
            
            <h1 className="display text-4xl md:text-5xl font-light leading-tight">
              Эвакуация из школы
              <br />
              <span style={{ fontStyle: "italic", color: "#a7a9be" }}>
                муравьиный алгоритм
              </span>
            </h1>
          </div>
          <div className="mono text-xs text-right" style={{ color: "#a7a9be" }}>
            α={alpha.toFixed(1)} {"·"} β={beta.toFixed(1)} {"·"} ρ=
            {rho.toFixed(2)} {"·"} Q={Q} {"·"} m={numAnts} {"·"} e={eliteWeight}
          </div>
        </div>

        {/* Переключатель режимов */}
        <div
          className="mb-4 flex gap-2 flex-wrap items-center p-2 rounded-lg"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <button
            onClick={() => {
              setMode(MODES.NORMAL);
              setStepAntState(null);
            }}
            className="mono text-sm px-4 py-2 rounded-md flex items-center gap-2"
            style={{
              background:
                mode === MODES.NORMAL ? "#ff8906" : "rgba(255,255,255,0.04)",
              color: mode === MODES.NORMAL ? "#0a0a0f" : "#a7a9be",
              fontWeight: mode === MODES.NORMAL ? 600 : 400,
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <Sparkles size={14} /> Колония (все муравьи)
          </button>
          <button
            onClick={() => {
              setMode(MODES.STEP_ANT);
              setIsRunning(false);
            }}
            className="mono text-sm px-4 py-2 rounded-md flex items-center gap-2"
            style={{
              background:
                mode === MODES.STEP_ANT ? "#7fdbff" : "rgba(255,255,255,0.04)",
              color: mode === MODES.STEP_ANT ? "#0a0a0f" : "#a7a9be",
              fontWeight: mode === MODES.STEP_ANT ? 600 : 400,
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <StepForward size={14} /> Один муравей (пошагово)
          </button>

          
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {/* Панель редактора */}
            <div
              className="p-3 rounded-lg flex flex-wrap items-center gap-2"
              style={{
                background: editMode
                  ? "rgba(255, 137, 6, 0.1)"
                  : "rgba(255,255,255,0.03)",
                border: `1px solid ${editMode ? "rgba(255, 137, 6, 0.3)" : "rgba(255,255,255,0.08)"}`,
              }}
            >
              <button
                onClick={() => {
                  setEditMode(!editMode);
                  setIsRunning(false);
                }}
                className="mono text-sm px-4 py-2 rounded-md flex items-center gap-2"
                style={{
                  background: editMode ? "#ff8906" : "rgba(255,255,255,0.06)",
                  color: editMode ? "#0a0a0f" : "#fffffe",
                  fontWeight: 600,
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                {editMode ? <MousePointer size={14} /> : <Edit3 size={14} />}
                {editMode ? "Завершить" : "Редактор карты"}
              </button>

              {editMode && (
                <>
                  <div
                    className="h-6 w-px"
                    style={{ background: "rgba(255,255,255,0.1)" }}
                  />
                  <ToolButton
                    tool={TOOLS.FIRE}
                    active={activeTool}
                    setActive={setActiveTool}
                    icon={<Flame size={14} />}
                    label="огонь"
                    color="#ff5020"
                  />
                  <ToolButton
                    tool={TOOLS.WALL}
                    active={activeTool}
                    setActive={setActiveTool}
                    icon={<Square size={14} />}
                    label="стена"
                    color="#7a7a8a"
                  />
                  <ToolButton
                    tool={TOOLS.EXIT}
                    active={activeTool}
                    setActive={setActiveTool}
                    icon={<DoorOpen size={14} />}
                    label="выход"
                    color="#2ec27e"
                  />
                  <ToolButton
                    tool={TOOLS.START}
                    active={activeTool}
                    setActive={setActiveTool}
                    icon={<MapPin size={14} />}
                    label="класс"
                    color="#ff8906"
                  />
                  <ToolButton
                    tool={TOOLS.ERASE}
                    active={activeTool}
                    setActive={setActiveTool}
                    icon={<Eraser size={14} />}
                    label="удалить"
                    color="#dc6464"
                  />
                  <div
                    className="h-6 w-px"
                    style={{ background: "rgba(255,255,255,0.1)" }}
                  />
                  <button
                    onClick={clearFires}
                    className="mono text-xs px-3 py-2 rounded-md flex items-center gap-1"
                    style={{
                      background: "rgba(220,100,100,0.1)",
                      color: "#dc6464",
                      border: "1px solid rgba(220,100,100,0.2)",
                    }}
                  >
                    <Trash2 size={12} /> убрать огонь
                  </button>
                </>
              )}
              {!editMode && (
                <div className="mono text-xs ml-2" style={{ color: "#a7a9be" }}>
                  {mode === MODES.NORMAL
                    ? "Клик по номеру класса — выбрать стартовую точку. Клик по другой клетке — разбор формулы"
                    : "Включите редактор, чтобы расставить элементы вручную"}
                </div>
              )}
            </div>

            {/* Карта */}
            <div
              className="rounded-lg overflow-hidden relative"
              style={{
                border: `1px solid ${editMode ? "rgba(255, 137, 6, 0.3)" : mode === MODES.STEP_ANT ? "rgba(127,219,255,0.3)" : "rgba(255,255,255,0.08)"}`,
                boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
                cursor: editMode
                  ? "crosshair"
                  : mode === MODES.NORMAL
                    ? "pointer"
                    : "default",
              }}
            >
              <canvas
                ref={canvasRef}
                width={W}
                height={H}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                style={{ width: "100%", height: "auto", display: "block" }}
              />

              {/* Tooltip при наведении */}
              {hoveredCell &&
                !editMode &&
                breakdown &&
                breakdown.cellType !== 1 &&
                breakdown.cellType !== 2 && (
                  <div
                    className="absolute pointer-events-none mono text-xs px-3 py-2 rounded-md"
                    style={{
                      left: Math.min(hoveredCell.mouseX + 15, W * 0.6),
                      top: Math.max(hoveredCell.mouseY - 60, 10),
                      background: "rgba(0,0,0,0.92)",
                      border: "1px solid rgba(255,137,6,0.3)",
                      color: "#fffffe",
                      minWidth: 140,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                    }}
                  >
                    <div
                      style={{
                        color: "#ff8906",
                        fontWeight: 600,
                        marginBottom: 4,
                      }}
                    >
                      клетка ({hoveredCell.row}, {hoveredCell.col})
                    </div>
                    <div>
                      τ ={" "}
                      <b style={{ color: "#ffc832" }}>
                        {breakdown.tauAvg.toFixed(3)}
                      </b>
                    </div>
                    <div>
                      η ={" "}
                      <b style={{ color: "#96dc64" }}>
                        {breakdown.eta.toFixed(3)}
                      </b>
                    </div>
                    <div
                      style={{
                        color: "#a7a9be",
                        marginTop: 4,
                        fontSize: "10px",
                      }}
                    >
                      кликните, чтобы зафиксировать
                    </div>
                  </div>
                )}
            </div>

            {/* Управление */}
            <div className="flex gap-2 flex-wrap">
              {mode === MODES.NORMAL ? (
                <>
                  <button
                    onClick={() => setIsRunning(!isRunning)}
                    disabled={editMode}
                    className="mono text-sm px-5 py-2.5 rounded-md flex items-center gap-2"
                    style={{
                      background: isRunning
                        ? "rgba(255,255,255,0.08)"
                        : "#ff8906",
                      color: isRunning ? "#fffffe" : "#0f0e17",
                      fontWeight: 600,
                      opacity: editMode ? 0.4 : 1,
                    }}
                  >
                    {isRunning ? <Pause size={14} /> : <Play size={14} />}
                    {isRunning ? "Пауза" : "Запуск"}
                  </button>
                  <button
                    onClick={() => !isRunning && !editMode && runIteration()}
                    disabled={isRunning || editMode}
                    className="mono text-sm px-4 py-2.5 rounded-md flex items-center gap-2"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      color: "#fffffe",
                      border: "1px solid rgba(255,255,255,0.1)",
                      opacity: isRunning || editMode ? 0.4 : 1,
                    }}
                  >
                    <Zap size={14} /> Итерация
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setStepAutoRunning(false);
                      startStepAnt();
                    }}
                    disabled={editMode}
                    className="mono text-sm px-5 py-2.5 rounded-md flex items-center gap-2"
                    style={{
                      background: "#7fdbff",
                      color: "#0a0a0f",
                      fontWeight: 600,
                      opacity: editMode ? 0.4 : 1,
                    }}
                  >
                    <RotateCcw size={14} /> Новый муравей
                  </button>
                  <button
                    onClick={stepAntNext}
                    disabled={
                      editMode ||
                      !stepAntState ||
                      stepAntState.done ||
                      stepAutoRunning
                    }
                    className="mono text-sm px-4 py-2.5 rounded-md flex items-center gap-2"
                    style={{
                      background: "rgba(127,219,255,0.15)",
                      color: "#7fdbff",
                      border: "1px solid rgba(127,219,255,0.3)",
                      fontWeight: 600,
                      opacity:
                        editMode ||
                        !stepAntState ||
                        stepAntState.done ||
                        stepAutoRunning
                          ? 0.4
                          : 1,
                    }}
                  >
                    <StepForward size={14} /> Шаг
                  </button>
                  <button
                    onClick={() => setStepAutoRunning((r) => !r)}
                    disabled={editMode || !stepAntState || stepAntState.done}
                    className="mono text-sm px-4 py-2.5 rounded-md flex items-center gap-2"
                    style={{
                      background: stepAutoRunning
                        ? "#ff8906"
                        : "rgba(255,137,6,0.15)",
                      color: stepAutoRunning ? "#0a0a0f" : "#ff8906",
                      border: "1px solid rgba(255,137,6,0.4)",
                      fontWeight: 600,
                      opacity:
                        editMode || !stepAntState || stepAntState.done
                          ? 0.4
                          : 1,
                    }}
                  >
                    {stepAutoRunning ? <Pause size={14} /> : <Play size={14} />}
                    {stepAutoRunning ? "Стоп" : "Авто"}
                  </button>
                </>
              )}

              <button
                onClick={resetSimulation}
                className="mono text-sm px-4 py-2.5 rounded-md flex items-center gap-2"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: "#fffffe",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <RotateCcw size={14} /> Сброс
              </button>
              <button
                onClick={fullReset}
                className="mono text-sm px-4 py-2.5 rounded-md flex items-center gap-2"
                style={{
                  background: "rgba(220,100,100,0.08)",
                  color: "#dc6464",
                  border: "1px solid rgba(220,100,100,0.2)",
                }}
              >
                <Trash2 size={14} /> Новая карта
              </button>

              <div className="ml-auto flex gap-2">
                <div
                  className="flex items-center rounded-md overflow-hidden"
                  style={{ border: "1px solid rgba(255,80,32,0.3)" }}
                >
                  <button
                    onClick={() => setFireMode('static')}
                    className="mono text-xs px-3 py-2.5 flex items-center gap-1"
                    style={{
                      background: fireMode === 'static' ? "rgba(255,80,32,0.2)" : "transparent",
                      color: fireMode === 'static' ? "#ff5020" : "#a7a9be",
                      fontWeight: fireMode === 'static' ? 600 : 400,
                    }}
                  >
                    <Flame size={12} /> статичный
                  </button>
                  <button
                    onClick={() => setFireMode('dynamic')}
                    className="mono text-xs px-3 py-2.5 flex items-center gap-1"
                    style={{
                      background: fireMode === 'dynamic' ? "rgba(255,80,32,0.2)" : "transparent",
                      color: fireMode === 'dynamic' ? "#ff5020" : "#a7a9be",
                      fontWeight: fireMode === 'dynamic' ? 600 : 400,
                      borderLeft: "1px solid rgba(255,80,32,0.2)",
                    }}
                  >
                    <Flame size={12} /> динамический
                  </button>
                </div>
                <button
                  onClick={() => setShowPheromone(!showPheromone)}
                  className="mono text-xs px-3 py-2.5 rounded-md"
                  style={{
                    background: showPheromone
                      ? "rgba(255,200,50,0.15)"
                      : "rgba(255,255,255,0.04)",
                    color: showPheromone ? "#ffc832" : "#a7a9be",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  феромон
                </button>
                <button
                  onClick={() => setShowAnts(!showAnts)}
                  className="mono text-xs px-3 py-2.5 rounded-md"
                  style={{
                    background: showAnts
                      ? "rgba(150,220,100,0.15)"
                      : "rgba(255,255,255,0.04)",
                    color: showAnts ? "#96dc64" : "#a7a9be",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  муравьи
                </button>
              </div>
            </div>

            {/* === ПОШАГОВАЯ ПАНЕЛЬ === */}
            {mode === MODES.STEP_ANT && (
              <div
                className="rounded-lg p-5"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(127,219,255,0.08), rgba(255,137,6,0.04))",
                  border: "1px solid rgba(127,219,255,0.2)",
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <StepForward size={16} style={{ color: "#7fdbff" }} />
                  <div
                    className="mono text-xs uppercase tracking-widest"
                    style={{ color: "#7fdbff" }}
                  >
                    Что делает муравей прямо сейчас
                  </div>
                </div>
                <div
                  className="text-xs mb-3"
                  style={{ color: "rgba(167,169,190,0.85)", lineHeight: 1.7 }}
                >
                  Муравей стоит в текущей клетке и смотрит на соседей. Для
                  каждого считает{" "}
                  <b style={{ color: "#fffffe" }}>{"τᵜᵃ · ηᵜᵇ"}</b> — желание
                  туда попасть, затем делит на сумму всех желаний. Выбор
                  случайный но взвешенный. После достижения выхода феромон
                  откладывается — следующий муравей видит этот след.
                </div>
                {!stepAntState ? (
                  <div className="text-sm" style={{ color: "#a7a9be" }}>
                    Нажмите{" "}
                    <b style={{ color: "#7fdbff" }}>{"«Новый муравей»"}</b>,
                    затем <b style={{ color: "#7fdbff" }}>{"«Шаг»"}</b> или{" "}
                    <b style={{ color: "#ff8906" }}>{"«Авто»"}</b>.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-4 text-xs">
                      <div>
                        <span style={{ color: "#a7a9be" }}>Позиция:</span>{" "}
                        <span className="mono" style={{ color: "#fffffe" }}>
                          ({stepAntState.row}, {stepAntState.col})
                        </span>
                      </div>
                      <div>
                        <span style={{ color: "#a7a9be" }}>
                          Пройдено клеток:
                        </span>{" "}
                        <span className="mono" style={{ color: "#fffffe" }}>
                          {stepAntState.path.length}
                        </span>
                      </div>
                      {stepAntState.done && (
                        <div
                          className="mono px-2 py-0.5 rounded"
                          style={{
                            background: stepAntState.success
                              ? "rgba(46,194,126,0.15)"
                              : "rgba(220,100,100,0.15)",
                            color: stepAntState.success ? "#2ec27e" : "#dc6464",
                          }}
                        >
                          {stepAntState.success
                            ? "✓ дошёл до выхода — феромон отложен"
                            : "✗ застрял"}
                        </div>
                      )}
                    </div>
                    {!stepAntState.done &&
                      stepAntState.candidates.length > 0 && (
                        <div>
                          <div
                            className="mono text-xs mb-2"
                            style={{ color: "#a7a9be" }}
                          >
                            Разбор P(i{"→"}j) для клетки ({stepAntState.row},{" "}
                            {stepAntState.col}):
                          </div>
                          <div className="overflow-x-auto">
                            <table
                              className="w-full mono text-xs"
                              style={{ borderCollapse: "collapse" }}
                            >
                              <thead>
                                <tr
                                  style={{
                                    color: "#a7a9be",
                                    borderBottom:
                                      "1px solid rgba(255,255,255,0.1)",
                                  }}
                                >
                                  <th className="text-left py-2 px-2">
                                    направление
                                  </th>
                                  <th className="text-right py-2 px-2">
                                    {"τ"}
                                  </th>
                                  <th className="text-right py-2 px-2">
                                    {"η"}
                                  </th>
                                  <th className="text-right py-2 px-2">
                                    {"τ"}
                                    <sup>{"α"}</sup>
                                    {"·η"}
                                    <sup>{"β"}</sup>
                                  </th>
                                  <th
                                    className="text-right py-2 px-2"
                                    style={{ color: "#7fdbff" }}
                                  >
                                    P
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {stepAntState.candidates
                                  .slice()
                                  .sort((a, b) => b.prob - a.prob)
                                  .map((c, i) => (
                                    <tr
                                      key={i}
                                      style={{
                                        borderBottom:
                                          "1px solid rgba(255,255,255,0.05)",
                                        background:
                                          i === 0
                                            ? "rgba(127,219,255,0.06)"
                                            : "transparent",
                                      }}
                                    >
                                      <td
                                        className="py-2 px-2"
                                        style={{ color: "#7fdbff" }}
                                      >
                                        {c.direction}
                                      </td>
                                      <td
                                        className="text-right py-2 px-2"
                                        style={{ color: "#ffc832" }}
                                      >
                                        {c.tau.toFixed(3)}
                                      </td>
                                      <td
                                        className="text-right py-2 px-2"
                                        style={{ color: "#96dc64" }}
                                      >
                                        {c.eta.toFixed(3)}
                                      </td>
                                      <td
                                        className="text-right py-2 px-2"
                                        style={{ color: "#a7a9be" }}
                                      >
                                        {c.f.toFixed(5)}
                                      </td>
                                      <td
                                        className="text-right py-2 px-2"
                                        style={{
                                          color: "#7fdbff",
                                          fontWeight: 600,
                                          fontSize: i === 0 ? "14px" : "12px",
                                        }}
                                      >
                                        {(c.prob * 100).toFixed(1)}%
                                      </td>
                                    </tr>
                                  ))}
                                <tr
                                  style={{ color: "#a7a9be", fontSize: "11px" }}
                                >
                                  <td
                                    colSpan="3"
                                    className="py-2 px-2"
                                    style={{ textAlign: "right" }}
                                  >
                                    {"Σ"}:
                                  </td>
                                  <td className="text-right py-2 px-2">
                                    {stepAntState.candidates
                                      .reduce((s, c) => s + c.f, 0)
                                      .toFixed(5)}
                                  </td>
                                  <td className="text-right py-2 px-2">100%</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    {!stepAntState.done &&
                      stepAntState.candidates.length === 0 && (
                        <div
                          className="mono text-xs px-3 py-2 rounded"
                          style={{
                            background: "rgba(220,100,100,0.1)",
                            color: "#dc6464",
                          }}
                        >
                          Тупик — на следующем шаге муравей откатится назад
                        </div>
                      )}
                    {stepAntState.done && stepAntState.success && (
                      <div
                        className="mono text-xs px-3 py-2 rounded"
                        style={{
                          background: "rgba(46,194,126,0.08)",
                          border: "1px solid rgba(46,194,126,0.2)",
                          color: "#a7a9be",
                        }}
                      >
                        Феромон отложен на {stepAntState.path.length - 1} рёбер.{" "}
                        {"Δτ"} = {Q}/{stepAntState.path.length} ={" "}
                        <b style={{ color: "#ffc832" }}>
                          {(Q / stepAntState.path.length).toFixed(3)}
                        </b>
                        . Запустите нового муравья — он увидит этот след.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div
              className="p-4 rounded-lg"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                className="mono text-xs uppercase tracking-widest mb-4"
                style={{ color: "#a7a9be" }}
              >
                Параметры
              </div>
              <div className="space-y-3">
                <ParamSlider
                  label="α — феромон"
                  value={alpha}
                  setValue={setAlpha}
                  min={0}
                  max={3}
                  step={0.1}
                  upHint="Сильнее влияние опыта колонии"
                  downHint="Слабее влияние опыта колонии"
                />
                <ParamSlider
                  label="β — эвристика"
                  value={beta}
                  setValue={setBeta}
                  min={0}
                  max={6}
                  step={0.1}
                  upHint="Сильнее тяга к выходу"
                  downHint="Слабее тяга к выходу"
                />
                <ParamSlider
                  label="ρ — испарение"
                  value={rho}
                  setValue={setRho}
                  min={0.01}
                  max={0.5}
                  step={0.01}
                  upHint="Быстрее забывание старых путей"
                  downHint="Медленнее забывание старых путей"
                />
                <ParamSlider
                  label="Q — отложение"
                  value={Q}
                  setValue={setQ}
                  min={10}
                  max={300}
                  step={10}
                  upHint="Сильнее закрепление хороших путей"
                  downHint="Слабее закрепление хороших путей"
                />
                <ParamSlider
                  label="e — элита"
                  value={eliteWeight}
                  setValue={setEliteWeight}
                  min={0}
                  max={5}
                  step={1}
                  upHint="Сильнее влияние лучшего маршрута"
                  downHint="Слабее влияние лучшего маршрута"
                />
                <ParamSlider
                  label="муравьёв"
                  value={numAnts}
                  setValue={setNumAnts}
                  min={5}
                  max={50}
                  step={1}
                  upHint="Выше точность поиска"
                  downHint="Ниже точность поиска"
                />
                <ParamSlider
                  label="скорость"
                  value={speed}
                  setValue={setSpeed}
                  min={0.5}
                  max={5}
                  step={0.5}
                  upHint="Быстрее анимация"
                  downHint="Медленнее анимация"
                />
              </div>
            </div>





            {/* === МЕТОДИЧКА === */}
            <div
              className="rounded-lg p-5"
              style={{
                background: "rgba(127,219,255,0.04)",
                border: "1px solid rgba(127,219,255,0.15)",
              }}
            >
              <div className="flex items-center gap-2 mb-4">
                <BookOpen size={16} style={{ color: "#7fdbff" }} />
                <div
                  className="mono text-xs uppercase tracking-widest"
                  style={{ color: "#7fdbff" }}
                >
                  Краткое руководство
                </div>
              </div>

              <div className="space-y-2">
                {[
                  {
                    title: "1. Дано",
                    body: (
                      <>
                        <p className="mb-2">
                          Перед вами карта школы — сетка 36 на 24 клетки.
                          На ней расположены коридоры, классы (отмечены
                          номерами), эвакуационные выходы и очаги пожара.
                        </p>
                        <p>
                          Цель алгоритма — найти из выбранного класса
                          (отмечен оранжевой звездой) кратчайший и безопасный
                          путь к ближайшему выходу, обходя огонь.
                        </p>
                      </>
                    ),
                  },
                  {
                    title: "2. Первоначальная настройка",
                    body: (
                      <>
                        <p className="mb-2">
                          Выберите стартовый класс — кликните на любой номер
                          на карте, и он станет активным.
                        </p>
                        <p className="mb-2">
                          Выберите тип пожара справа от кнопок: статичный
                          (очаги стоят на месте) или динамический (очаги
                          случайно смещаются каждые 5 итераций).
                        </p>
                        <p className="mb-2">
                          Под картой задайте параметры алгоритма с помощью
                          ползунков. Под каждым из них написано, как
                          изменение влияет на поведение муравьёв.
                        </p>
                        <p>
                          В блоке «Метрики» справа нажмите «+ добавить» и
                          выберите показатели, которые хотите отслеживать.
                        </p>
                      </>
                    ),
                  },
                  {
                    title: "3. Запуск",
                    body: (
                      <>
                        <p className="mb-2">
                          Нажмите кнопку «Запуск» — колония муравьёв начнёт
                          непрерывно работать. На каждой итерации все
                          муравьи одновременно ищут путь к выходу.
                        </p>
                        <p className="mb-2">
                          Кнопка «Итерация» выполняет один шаг алгоритма
                          вручную — удобно, если хочется наблюдать
                          постепенное обучение колонии.
                        </p>
                        <p>
                          На карте вы увидите: жёлтое свечение — следы
                          феромона, синяя линия — лучший найденный маршрут,
                          движущиеся точки — сами муравьи.
                        </p>
                      </>
                    ),
                  },
                  {
                    title: "4. Анализ результатов",
                    body: (
                      <>
                        <p className="mb-2">
                          Следите за блоком «Метрики». Главный показатель —
                          стоимость F. Она должна постепенно уменьшаться
                          с каждой итерацией.
                        </p>
                        <p className="mb-2">
                          Показатель «Улучшение» в процентах говорит,
                          насколько колония превзошла свой первый
                          результат.
                        </p>
                        <p className="mb-2">
                          «Успешных муравьёв» показывает, какая доля
                          колонии доходит до выхода. Если их меньше
                          половины — возможно, карта слишком сложная или
                          параметры подобраны неудачно.
                        </p>
                        <p>
                          Когда метрика «Сошлось» покажет номер итерации,
                          это значит, что алгоритм нашёл оптимум и больше
                          не находит улучшений.
                        </p>
                      </>
                    ),
                  },
                  {
                    title: "5. Другая настройка",
                    body: (
                      <>
                        <p className="mb-2">
                          Попробуйте изменить параметры и сравнить
                          результаты. Например, увеличьте β до 5 — муравьи
                          станут жаднее и быстрее найдут путь, но он
                          не всегда будет оптимальным.
                        </p>
                        <p className="mb-2">
                          Поставьте e в ноль, чтобы отключить элитную
                          стратегию. Сходимость замедлится, но алгоритм
                          станет ближе к классическому Ant System.
                        </p>
                        <p className="mb-2">
                          Увеличьте ρ до 0.4 — феромон будет быстро
                          забываться, и колония станет менее стабильной
                          в выборе маршрута.
                        </p>
                        <p>
                          После каждого изменения параметров нажимайте
                          «Сброс», чтобы алгоритм начал поиск с чистого
                          феромона.
                        </p>
                      </>
                    ),
                  },
                  {
                    title: "6. Дополнительно",
                    body: (
                      <>
                        <p className="mb-2">
                          Откройте редактор карты кнопкой сверху. В нём
                          можно ставить и убирать стены, очаги пожара,
                          выходы и перемещать стартовые точки классов.
                        </p>
                        <p className="mb-2">
                          Наведите курсор на любую свободную клетку — справа
                          в блоке «Разбор формулы» появится таблица с
                          расчётом вероятностей перехода в каждого соседа.
                          Чтобы зафиксировать клетку, кликните по ней.
                        </p>
                        <p>
                          Переключитесь в пошаговый режим, чтобы наблюдать
                          работу одного муравья. Вы увидите каждый его шаг
                          и значения вероятностей на каждом ходу.
                        </p>
                      </>
                    ),
                  },
                ].map((item, idx) => {
                  const isOpen = guideOpen === idx;
                  return (
                    <div
                      key={idx}
                      className="rounded-md overflow-hidden"
                      style={{
                        background: isOpen
                          ? "rgba(127,219,255,0.06)"
                          : "rgba(0,0,0,0.2)",
                        border: "1px solid rgba(127,219,255,0.1)",
                      }}
                    >
                      <button
                        onClick={() => setGuideOpen(isOpen ? null : idx)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left"
                        style={{
                          background: "transparent",
                          color: isOpen ? "#7fdbff" : "#fffffe",
                        }}
                      >
                        <span
                          className="mono text-sm"
                          style={{ fontWeight: isOpen ? 600 : 500 }}
                        >
                          {item.title}
                        </span>
                        <ChevronDown
                          size={16}
                          style={{
                            transition: "transform 0.2s",
                            transform: isOpen ? "rotate(180deg)" : "rotate(0)",
                            color: "#a7a9be",
                          }}
                        />
                      </button>
                      {isOpen && (
                        <div
                          className="px-4 pb-4 text-sm"
                          style={{
                            color: "rgba(255,255,255,0.85)",
                            lineHeight: 1.6,
                          }}
                        >
                          {item.body}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Правая колонка */}
          <div className="space-y-4">
            {editMode && (
              <div
                className="p-4 rounded-lg"
                style={{
                  background: "rgba(255,137,6,0.08)",
                  border: "1px solid rgba(255,137,6,0.25)",
                }}
              >
                <div
                  className="mono text-xs uppercase tracking-widest mb-3"
                  style={{ color: "#ff8906" }}
                >
                  Инструкция
                </div>
                <div
                  className="text-xs space-y-2"
                  style={{ color: "#a7a9be", lineHeight: 1.6 }}
                >
                  <div>
                    <b style={{ color: "#ff5020" }}>🔥 Огонь</b> — клик ставит
                    очаг
                  </div>
                  <div>
                    <b style={{ color: "#7a7a8a" }}>▮ Стена</b> — клик/протяг
                    рисует стены
                  </div>
                  <div>
                    <b style={{ color: "#2ec27e" }}>↑ Выход</b> — клик по
                    внешней стене
                  </div>
                  <div>
                    <b style={{ color: "#ff8906" }}>★ Класс</b> — клик
                    перемещает старт
                  </div>
                  <div>
                    <b style={{ color: "#dc6464" }}>✕ Удалить</b> — убирает
                    огонь, стены, выходы
                  </div>
                </div>
              </div>
            )}

            {/* === РАЗБОР ФОРМУЛЫ === */}
            {mode === MODES.NORMAL && (
              <div
                className="rounded-lg p-5"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(255,137,6,0.06), rgba(127,219,255,0.04))",
                  border: "1px solid rgba(255,137,6,0.2)",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Calculator size={16} style={{ color: "#ff8906" }} />
                    <div
                      className="mono text-sm uppercase tracking-widest"
                      style={{ color: "#ff8906" }}
                    >
                      {breakdown && breakdown.cellType !== 1 && breakdown.cellType !== 2
                        ? `Разбор формулы для клетки (${breakdown.cell.row}, ${breakdown.cell.col})`
                        : "Разбор формулы для клетки"}
                    </div>
                  </div>
                  {pinnedCell && (
                    <button
                      onClick={() => setPinnedCell(null)}
                      className="mono text-xs px-2 py-1 rounded"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        color: "#a7a9be",
                      }}
                    >
                      × открепить
                    </button>
                  )}
                </div>

                {!breakdown || breakdown.cellType === 1 || breakdown.cellType === 2 ? (
                  <div
                    className="mono text-xs py-8 text-center"
                    style={{ color: "rgba(167,169,190,0.6)" }}
                  >
                    Наведите курсор на свободную клетку карты или кликните по
                    ней — здесь появится таблица с вычислением вероятностей
                    P(i→j) для каждого направления.
                  </div>
                ) : (
                  <BreakdownContent breakdown={breakdown} alpha={alpha} beta={beta} />
                )}
              </div>
            )}
            {/* === МЕТРИКИ === */}
            <div
              className="rounded-lg p-5 relative"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 size={16} style={{ color: "#a7a9be" }} />
                  <div
                    className="mono text-xs uppercase tracking-widest"
                    style={{ color: "#a7a9be" }}
                  >
                    Метрики
                  </div>
                </div>
                <button
                  onClick={() => setMetricsMenuOpen(!metricsMenuOpen)}
                  className="mono text-xs px-2 py-1 rounded-md flex items-center gap-1"
                  style={{
                    background: metricsMenuOpen
                      ? "rgba(255,137,6,0.2)"
                      : "rgba(255,255,255,0.05)",
                    color: metricsMenuOpen ? "#ff8906" : "#a7a9be",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <Plus size={12} /> добавить
                </button>
              </div>

              {/* Выпадающее меню */}
              {metricsMenuOpen && (
                <div
                  className="absolute right-5 top-12 rounded-md p-2 z-10"
                  style={{
                    background: "rgba(15,15,25,0.98)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
                    minWidth: 280,
                  }}
                >
                  <div
                    className="mono text-xs mb-2 px-2 py-1"
                    style={{ color: "#a7a9be" }}
                  >
                    Выберите метрики:
                  </div>
                  {[
                    { id: "iterations", label: "Итераций" },
                    { id: "length", label: "Длина лучшего маршрута" },
                    { id: "cost", label: "Стоимость F (длина + штраф)" },
                    { id: "fireDist", label: "Расстояние до огня" },
                    { id: "success", label: "Успешных муравьёв (%)" },
                    { id: "improvement", label: "Улучшение от старта (%)" },
                    { id: "converged", label: "Сошлось на итерации" },
                  ].map((m) => {
                    const checked = selectedMetrics.includes(m.id);
                    return (
                      <label
                        key={m.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer mono text-xs"
                        style={{
                          background: checked
                            ? "rgba(255,137,6,0.08)"
                            : "transparent",
                          color: checked ? "#ff8906" : "#fffffe",
                        }}
                        onClick={() => {
                          setSelectedMetrics((prev) =>
                            checked
                              ? prev.filter((x) => x !== m.id)
                              : [...prev, m.id],
                          );
                        }}
                      >
                        <div
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            border: `1.5px solid ${checked ? "#ff8906" : "rgba(255,255,255,0.3)"}`,
                            background: checked ? "#ff8906" : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {checked && <Check size={10} color="#0a0a0f" />}
                        </div>
                        {m.label}
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Карточки выбранных метрик */}
              {selectedMetrics.length === 0 ? (
                <div
                  className="mono text-xs text-center py-6"
                  style={{ color: "rgba(167,169,190,0.5)" }}
                >
                  Нажмите «+ добавить» для выбора метрик
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {selectedMetrics.includes("iterations") && (
                    <Metric
                      label="Итераций"
                      value={iteration}
                      hint="выполнено"
                      explanation="Сколько раз вся колония муравьёв прошла маршрут. С каждой итерацией решение улучшается."
                    />
                  )}
                  {selectedMetrics.includes("length") && (
                    <Metric
                      label="Длина маршрута"
                      value={bestLength !== null ? `${bestLength}` : "—"}
                      hint="клеток"
                      color="#7fdbff"
                      explanation="Сколько клеток занимает лучший найденный путь от класса до выхода. Меньше — короче маршрут."
                    />
                  )}
                  {selectedMetrics.includes("cost") && (
                    <Metric
                      label="Стоимость F"
                      value={bestCost ? bestCost.toFixed(1) : "—"}
                      hint="длина + штраф"
                      color="#ff8906"
                      explanation="Главная оценка маршрута: длина пути плюс штраф за близость к огню. Именно это число минимизирует алгоритм."
                    />
                  )}
                  {selectedMetrics.includes("fireDist") && (
                    <Metric
                      label="До огня"
                      value={
                        bestFireDist !== null && bestFireDist !== Infinity
                          ? bestFireDist.toFixed(2)
                          : "—"
                      }
                      hint="мин. расстояние"
                      color="#ff5020"
                      explanation="Насколько близко лучший путь подходит к ближайшему очагу пожара. Больше — безопаснее маршрут."
                    />
                  )}
                  {selectedMetrics.includes("success") && (
                    <Metric
                      label="Успешных муравьёв"
                      value={`${successRate.toFixed(0)}%`}
                      hint={`из ${numAnts} в итерации`}
                      color="#96dc64"
                      explanation="Сколько муравьёв дошли до выхода в последней итерации. Остальные застряли в тупиках или вышли за лимит шагов."
                    />
                  )}
                  {selectedMetrics.includes("improvement") && (
                    <Metric
                      label="Улучшение"
                      value={
                        improvement > 0 ? `${improvement.toFixed(1)}%` : "—"
                      }
                      hint="от стартовой стоимости"
                      color="#96dc64"
                      explanation="На сколько процентов лучший путь стал короче по сравнению с первой итерацией. Показывает прогресс обучения колонии."
                    />
                  )}
                  {selectedMetrics.includes("converged") && (
                    <Metric
                      label="Сошлось"
                      value={
                        convergedAt !== null ? `на ${convergedAt}` : "—"
                      }
                      hint="итерации"
                      color="#7fdbff"
                      explanation="На какой итерации алгоритм перестал находить улучшения. После этого можно остановить поиск — лучшего пути уже не будет."
                    />
                  )}
                </div>
              )}
            </div>
            {/* === ВЫВОД РАСЧЁТОВ (описание) добавлено в основной блок === */}

            <div
              className="p-4 rounded-lg"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                className="mono text-xs uppercase tracking-widest mb-3"
                style={{ color: "#a7a9be" }}
              >
                Условные обозначения
              </div>
              <div className="space-y-2 text-xs">
                <LegendItem color="#ff8906" label="старт (класс)" />
                <LegendItem color="#2ec27e" label="эвакуационный выход" />
                <LegendItem color="#ff5020" label="очаг пожара" />
                <LegendItem color="#7fdbff" label="лучший маршрут" />
                <LegendItem color="#ffc832" label="след феромона" />
                <LegendItem color="#96dc64" label="успешный муравей" />
                <LegendItem color="#dc6464" label="в тупике" />
                <LegendItem color="#3a3a48" label="стена" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BreakdownContent({ breakdown, alpha, beta }) {
  return (
    <>
      <div
        className="text-xs mb-3"
        style={{ color: "rgba(167,169,190,0.85)", lineHeight: 1.7 }}
      >
        Здесь показано, как муравей выбирал бы следующий шаг, стоя в этой
        клетке. <b style={{ color: "#ffc832" }}>τ</b> — феромон на ребре,{" "}
        <b style={{ color: "#96dc64" }}>η</b> — эвристика,{" "}
        <b style={{ color: "#ff8906" }}>P</b> — итоговая вероятность. Строка
        с наибольшим P выделена.
      </div>
      <div
        className="rounded-md p-3 mb-3 mono text-xs text-center"
        style={{
          background: "rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.05)",
          color: "#fffffe",
        }}
      >
        P(j) = τ(j)<sup>α</sup> · η(j)<sup>β</sup> / Σ&nbsp;&nbsp;&nbsp;|
        &nbsp;&nbsp;&nbsp;
        <span style={{ color: "#ffc832" }}>α={alpha.toFixed(1)}</span> ·
        <span style={{ color: "#96dc64" }}> β={beta.toFixed(1)}</span>
      </div>
      {breakdown.candidates.length > 0 ? (
        <div className="overflow-x-auto">
          <table
            className="w-full mono text-xs"
            style={{ borderCollapse: "collapse" }}
          >
            <thead>
              <tr
                style={{
                  color: "#a7a9be",
                  borderBottom: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <th className="text-left py-2 px-2">направление</th>
                <th className="text-right py-2 px-2">τ</th>
                <th className="text-right py-2 px-2">η</th>
                <th className="text-right py-2 px-2">
                  τ<sup>α</sup>·η<sup>β</sup>
                </th>
                <th
                  className="text-right py-2 px-2"
                  style={{ color: "#ff8906" }}
                >
                  P
                </th>
              </tr>
            </thead>
            <tbody>
              {breakdown.candidates
                .slice()
                .sort((a, b) => b.prob - a.prob)
                .map((c, i) => (
                  <tr
                    key={i}
                    style={{
                      color: "#fffffe",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                      background:
                        i === 0 ? "rgba(255,137,6,0.05)" : "transparent",
                    }}
                  >
                    <td className="py-2 px-2">{c.direction}</td>
                    <td
                      className="text-right py-2 px-2"
                      style={{ color: "#ffc832" }}
                    >
                      {c.tau.toFixed(3)}
                    </td>
                    <td
                      className="text-right py-2 px-2"
                      style={{ color: "#96dc64" }}
                    >
                      {c.eta.toFixed(3)}
                    </td>
                    <td
                      className="text-right py-2 px-2"
                      style={{ color: "#a7a9be" }}
                    >
                      {c.f.toFixed(5)}
                    </td>
                    <td
                      className="text-right py-2 px-2"
                      style={{
                        color: "#ff8906",
                        fontWeight: 600,
                        fontSize: i === 0 ? "14px" : "12px",
                      }}
                    >
                      {(c.prob * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              <tr style={{ color: "#a7a9be", fontSize: "11px" }}>
                <td
                  className="py-2 px-2"
                  colSpan="3"
                  style={{ textAlign: "right" }}
                >
                  сумма Σ:
                </td>
                <td className="text-right py-2 px-2">
                  {breakdown.candidates
                    .reduce((s, c) => s + c.f, 0)
                    .toFixed(5)}
                </td>
                <td className="text-right py-2 px-2">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mono text-xs" style={{ color: "#dc6464" }}>
          Клетка изолирована — все соседи заблокированы (стена/огонь).
        </div>
      )}
    </>
  );
}

function ToolButton({ tool, active, setActive, icon, label, color }) {
  const isActive = active === tool;
  return (
    <button
      onClick={() => setActive(tool)}
      className="mono text-xs px-3 py-2 rounded-md flex items-center gap-1.5"
      style={{
        background: isActive ? `${color}25` : "rgba(255,255,255,0.04)",
        color: isActive ? color : "#a7a9be",
        border: `1px solid ${isActive ? `${color}60` : "rgba(255,255,255,0.08)"}`,
        fontWeight: isActive ? 600 : 400,
      }}
    >
      {icon} {label}
    </button>
  );
}

function Metric({ label, value, hint, color, small, explanation }) {
  return (
    <div>
      <div className="mono text-xs mb-1" style={{ color: "#a7a9be" }}>
        {label}
      </div>
      <div
        className="display font-light"
        style={{
          color: color || "#fffffe",
          fontSize: small ? "20px" : "28px",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          className="mono text-xs mt-0.5"
          style={{ color: "rgba(167,169,190,0.6)" }}
        >
          {hint}
        </div>
      )}
      {explanation && (
        <div
          className="text-xs mt-2"
          style={{
            color: "rgba(167,169,190,0.85)",
            lineHeight: 1.5,
            paddingTop: 6,
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {explanation}
        </div>
      )}
    </div>
  );
}

function Interpretation({ ok, label, detail }) {
  return (
    <div
      className="flex items-start gap-2 p-2 rounded"
      style={{
        background: ok ? "rgba(46,194,126,0.08)" : "rgba(220,100,100,0.06)",
        border: `1px solid ${ok ? "rgba(46,194,126,0.2)" : "rgba(220,100,100,0.2)"}`,
      }}
    >
      <div style={{ color: ok ? "#2ec27e" : "#dc6464", marginTop: 1 }}>
        {ok ? <Check size={12} /> : <X size={12} />}
      </div>
      <div>
        <div className="mono" style={{ color: "#fffffe", fontSize: "11px" }}>
          {label}
        </div>
        <div className="mono" style={{ color: "#a7a9be", fontSize: "10px" }}>
          {detail}
        </div>
      </div>
    </div>
  );
}

function LegendItem({ color, label }) {
  return (
    <div className="flex items-center gap-2">
      <div
        style={{
          width: 12,
          height: 12,
          background: color,
          borderRadius: 2,
          boxShadow: `0 0 8px ${color}40`,
        }}
      />
      <span style={{ color: "#a7a9be" }}>{label}</span>
    </div>
  );
}

function ParamSlider({
  label,
  value,
  setValue,
  min,
  max,
  step,
  upHint,
  downHint,
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="mono text-sm" style={{ color: "#a7a9be" }}>
          {label}
        </span>
        <span
          className="mono text-sm"
          style={{ color: "#ff8906", fontWeight: 600 }}
        >
          {typeof value === "number" && value % 1 !== 0
            ? value.toFixed(2)
            : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => setValue(parseFloat(e.target.value))}
        style={{ width: "100%" }}
      />
      {(upHint || downHint) && (
        <div className="flex justify-between mt-1">
          {downHint && (
            <span
              className="mono"
              style={{ fontSize: "12px", color: "rgba(167,169,190,0.55)" }}
            >
              {"↓"} {downHint}
            </span>
          )}
          {upHint && (
            <span
              className="mono"
              style={{ fontSize: "12px", color: "rgba(167,169,190,0.55)" }}
            >
              {"↑"} {upHint}
            </span>
          )}
        </div>
      )}
    </div>
  );
}