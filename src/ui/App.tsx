import { HEIGHT_UNIT, RISE_PER_STEP } from "../core/hex/HeightUnits.ts";
import { JunctionPanel } from "./JunctionPanel.tsx";
import type { RoadAddress } from "../core/roads/HexRoadGraph.ts";
import { useEffect, useRef, useState } from "react";
import { hexToWorld } from "../core/hex/HexCoords.ts";
import { GameState } from "../core/GameState.ts";
import type { Tool } from "../core/GameState.ts";
import type { Level } from "../core/roads/HexRoadGraph.ts";
import { IsoScene } from "../render/IsoScene.ts";
import "./style.css";
const tools: { id: Tool; icon: string; label: string; price: string }[] = [
  { id: "inspect", icon: "↖", label: "Обзор", price: "WASD" },
  { id: "road", icon: "━", label: "Дорога", price: "40 Cr" },
  { id: "overpass", icon: "╤", label: "Эстакада", price: "90 Cr" },
  { id: "ramp", icon: "⤴", label: "Рампа", price: "100 Cr / шаг" },
  { id: "signal", icon: "⋮", label: "Светофор", price: "30 Cr" },
  { id: "Home", icon: "⌂", label: "Жильё", price: "120 Cr" },
  { id: "Shop", icon: "▥", label: "Магазин", price: "120 Cr" },
  { id: "Factory", icon: "▟", label: "Завод", price: "120 Cr" },
  { id: "Warehouse", icon: "▰", label: "Склад", price: "120 Cr" },
  { id: "demolish", icon: "×", label: "Снос", price: "выбранный слой" },
];
export function App() {
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<IsoScene | null>(null),
    [game, setGame] = useState(() => new GameState());
  const [, refresh] = useState(0);
  const [tool, setTool] = useState<Tool>("inspect"),
    [level, setLevel] = useState<Level>("ground"),
    [direction, setDirection] = useState(0),
    [span, setSpan] = useState(3),
    [rampTarget, setRampTarget] = useState<Level>("elevated"),
    [paper, setPaper] = useState(false),
    [hover, setHover] = useState("—"),
    [selected, setSelected] = useState<RoadAddress | undefined>(),
    [seed, setSeed] = useState("23"),
    [error, setError] = useState("");
  useEffect(() => {
    try {
      scene.current = new IsoScene(host.current!, game);
      scene.current.onHover = (h) => {
        const p = h ? hexToWorld(h.q, h.r) : undefined;
        setHover(
          h && p
            ? `${h.q} / ${h.r} · ${game.map.height(h).toFixed(1)} м · уклон ${Math.round(game.map.slopeAt(p.x, p.z) * 100)}%`
            : "—",
        );
      };
      scene.current.onSelect = setSelected;
      scene.current.onChange = () => refresh((n) => n + 1);
    } catch (e) {
      setError(`Не удалось запустить WebGL: ${String(e)}`);
    }
    const timer = setInterval(() => refresh((n) => n + 1), 250);
    return () => {
      clearInterval(timer);
      scene.current?.dispose();
    };
  }, [game]);
  useEffect(() => {
    if (scene.current) {
      scene.current.options = {
        tool,
        level,
        direction,
        span,
        paper,
        rampTarget,
      };
      scene.current.preview();
    }
  }, [tool, level, direction, span, paper, rampTarget, game]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input,select,textarea")) return;
      if (/^Digit[0-9]$/.test(e.code)) {
        const id = tools[Number(e.code.slice(-1))].id;
        setTool(id);
        if (id === "overpass") setLevel("elevated");
        if (id === "road") setLevel("ground");
      }
      if (e.code === "Escape") {
        setTool("inspect");
        setSelected(undefined);
      }
      if (e.code === "KeyM") setPaper((p) => !p);
      if (e.code === "KeyR") scene.current?.rotate();
      if (e.code === "Space") {
        e.preventDefault();
        game.speed = game.speed ? 0 : 1;
        refresh((n) => n + 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [game]);
  const activeTool = tools.find((t) => t.id === tool)!;
  const selectTool = (id: Tool) => {
    setTool(id);
    if (id === "overpass") setLevel("elevated");
    if (id === "road") setLevel("ground");
  };
  return (
    <main className={paper ? "app paper" : "app"}>
      <div
        ref={host}
        className="viewport"
        aria-label="Интерактивная гексагональная карта"
      />
      <header className="menubar">
        <h1>Развязка</h1>
        <span className="region">Долина сосен</span>
        <div className="readouts">
          <span title="Бюджет">
            <b>{Math.floor(game.budget).toLocaleString("ru-RU")}</b> Cr
          </span>
          <span title="Доход за игровую секунду" className="income">
            +{game.throughput.toFixed(1)} Cr/с
          </span>
          <span title="Средняя доля свободной скорости">
            Поток <b>{Math.round(game.sim.freeFlow * 100)}%</b>
          </span>
          <span>
            В пути <b>{game.sim.vehicles.length}</b>
          </span>
        </div>
        <button
          className={paper ? "active" : ""}
          onClick={() => setPaper((p) => !p)}
          title="Стратегическая карта · M"
        >
          Карта <kbd>M</kbd>
        </button>
        <button
          onClick={() => scene.current?.rotate()}
          title="Поворот камеры на 60° · R"
        >
          Поворот <kbd>R</kbd>
        </button>
      </header>
      <aside className="toolbox" aria-label="Панель строительства">
        <div className="toolbox-heading">Строительство</div>
        <nav aria-label="Инструменты строительства">
          {tools.map((t, i) => (
            <button
              key={t.id}
              className={"tool " + (tool === t.id ? "active" : "")}
              aria-pressed={tool === t.id}
              onClick={() => selectTool(t.id)}
              title={t.price}
            >
              <ToolIcon type={t.id} />
              <span>{t.label}</span>
              <kbd>{i}</kbd>
            </button>
          ))}
        </nav>
        <fieldset className="layers">
          <legend>Уровень дороги</legend>
          <button
            className={level === "ground" ? "active" : ""}
            onClick={() => setLevel("ground")}
          >
            Земля
          </button>
          <button
            className={level === "elevated" ? "active" : ""}
            onClick={() => setLevel("elevated")}
          >
            Эстакада
          </button>
        </fieldset>
        {tool === "ramp" && (
          <div className="ramp-settings">
            <label>
              Назначение
              <select
                aria-label="Назначение рампы"
                value={rampTarget}
                onChange={(e) => setRampTarget(e.target.value as Level)}
              >
                <option value="elevated">Поднять на эстакаду</option>
                <option value="ground">Соединить уровни земли</option>
              </select>
            </label>
            <label>
              Подъём
              <select
                aria-label="Длина рампы"
                value={span}
                onChange={(e) => setSpan(Number(e.target.value))}
              >
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} шага
                    {rampTarget === "elevated"
                      ? ` · +${n * RISE_PER_STEP} м`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Направление
              <select
                aria-label="Направление рампы"
                value={direction}
                onChange={(e) => setDirection(Number(e.target.value))}
              >
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n * 60}°
                  </option>
                ))}
              </select>
            </label>
            <p className="junction-note">
              1 ед. высоты = магазин ({HEIGHT_UNIT} м).{" "}
              {rampTarget === "ground"
                ? "Выход — на выбранную площадку через 2–6 гексов."
                : "Продолжайте эстакаду от конца рампы: она сохранит высоту."}
            </p>
          </div>
        )}
        <div className="tool-note">
          <strong>
            {activeTool.label}
            <span>{activeTool.price}</span>
          </strong>
          <p>
            {tool === "road" || tool === "overpass"
              ? "Зажмите ЛКМ и проведите улицу. Для ответвления начните с существующей дороги."
              : tool === "ramp"
                ? "Кликните наземный конец. Подключение — только с торцов."
                : tool === "demolish"
                  ? "Удаляется выбранный уровень. Рампа удаляется целиком."
                  : tool === "inspect"
                    ? "Щелчок по дороге — правила перекрёстка. WASD / ПКМ — перемещение."
                    : "Кликните гекс для размещения."}
          </p>
        </div>
        <details className="terrain-settings">
          <summary>Генерация карты</summary>
          <label>
            Зерно{" "}
            <input
              aria-label="Зерно карты"
              type="number"
              step="1"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
          </label>
          <button
            disabled={!Number.isSafeInteger(Number(seed)) || !seed.trim()}
            onClick={() => {
              setGame(new GameState(Number(seed)));
              setSelected(undefined);
              setHover("—");
              setTool("inspect");
            }}
          >
            Создать новый регион
          </button>
          <p>Начнёт новую игру. Текущие постройки не сохранятся.</p>
        </details>
      </aside>
      {selected && (
        <JunctionPanel
          key={`${game.map.seed}:${selected.q}:${selected.r}:${selected.level}`}
          game={game}
          address={selected}
          onClose={() => setSelected(undefined)}
          onChange={() => refresh((n) => n + 1)}
        />
      )}
      <footer className="statusbar">
        <span className="coordinates">q / r &nbsp; {hover}</span>
        <span role="status" className="message">
          {game.message}
        </span>
        <span className="deliveries">Доставлено: {game.sim.deliveries}</span>
        <div className="speed" aria-label="Скорость симуляции">
          {[0, 1, 2, 4].map((n) => (
            <button
              key={n}
              className={game.speed === n ? "active" : ""}
              aria-label={n ? `Скорость ${n}x` : "Пауза"}
              onClick={() => {
                game.speed = n;
                refresh((k) => k + 1);
              }}
            >
              {n ? `${n}×` : "Пауза"}
            </button>
          ))}
        </div>
      </footer>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
    </main>
  );
}
function ToolIcon({ type }: { type: Tool }) {
  const paths: Record<Tool, string> = {
    inspect: "M5 3v16l4-5 4 6 3-2-4-6 6-1Z",
    road: "M7 2v20M17 2v20M12 3v3m0 4v4m0 4v3",
    overpass: "M2 8h20M2 12h20M6 12v9m12-9v9M7 3h3m4 0h3",
    ramp: "M2 19h5L17 6h5M2 15h3L15 2h7M18 10v11",
    signal: "M8 2h8v15H8zM12 17v5M11 6h2m-2 4h2m-2 4h2",
    Home: "m3 11 9-8 9 8M5 9v12h14V9M10 21v-7h4v7",
    Shop: "M3 9V4h18v5M3 9c0 4 6 4 6 0 0 4 6 4 6 0 0 4 6 4 6 0M5 13v8h14v-8M9 21v-6h6v6",
    Factory: "M3 21V10l6 4V9l6 4V3h4v18ZM6 18h2m3 0h2m3 0h2",
    Warehouse: "M3 21V9l9-6 9 6v12ZM7 21V11h10v10M7 15h10m-10 3h10",
    demolish: "m5 4 15 15M4 17l4 4 13-13-5-5ZM3 22h18",
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[type]} />
    </svg>
  );
}
