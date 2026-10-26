import { useState } from "react";
import type { PointerEvent } from "react";
import type { GameState } from "../core/GameState.ts";
import type { RoadAddress } from "../core/roads/HexRoadGraph.ts";
import type { JunctionSettings } from "../core/roads/JunctionControl.ts";
export function JunctionPanel({
  game,
  address,
  onClose,
  onChange,
}: {
  game: GameState;
  address: RoadAddress;
  onClose: () => void;
  onChange: () => void;
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const node = game.roads.get(address);
  if (!node || node.rampId) return null;
  const settings = game.roads.junctionSettings(address),
    main = game.roads.mainRoadMask(address),
    on = settings.mode !== "off";
  const edges = Array.from({ length: 6 }, (_, e) => e).filter(
    (e) => node.connectionsMask & (1 << e),
  );
  const update = (patch: Partial<JunctionSettings>) => {
    game.configureJunction(address, patch);
    onChange();
  };
  const drag = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const element = e.currentTarget;
    element.setPointerCapture(e.pointerId);
    const origin = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    element.onpointermove = (move) =>
      setOffset({
        x: Math.max(
          -window.innerWidth + 350,
          Math.min(10, move.clientX - origin.x),
        ),
        y: Math.max(
          -5,
          Math.min(window.innerHeight - 520, move.clientY - origin.y),
        ),
      });
    element.onpointerup = () => {
      element.onpointermove = null;
    };
    element.onpointercancel = () => {
      element.onpointermove = null;
    };
  };
  return (
    <section
      className="junction-panel"
      aria-label="Настройки перекрёстка"
      style={{ transform: `translate(${offset.x}px,${offset.y}px)` }}
    >
      <header onPointerDown={drag}>
        <div>
          <strong>
            Перекрёсток {address.q} / {address.r}
          </strong>
          <small>
            {address.level === "ground" ? "Наземная дорога" : "Эстакада"}
          </small>
        </div>
        <button aria-label="Закрыть настройки перекрёстка" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="junction-body">
        <label className="junction-field">
          Регулирование
          <select
            aria-label="Режим светофора"
            value={settings.mode}
            onChange={(e) =>
              update({ mode: e.target.value as JunctionSettings["mode"] })
            }
          >
            <option value="off">Без светофора</option>
            <option value="paired">Встречные направления вместе</option>
            <option value="individual">Каждый въезд отдельно</option>
          </select>
        </label>
        {on && (
          <>
            <label className="junction-field">
              Зелёный, секунд
              <select
                aria-label="Длительность зелёного"
                value={settings.greenSeconds}
                onChange={(e) =>
                  update({ greenSeconds: Number(e.target.value) })
                }
              >
                {Array.from({ length: 28 }, (_, i) => i + 3).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <p className="junction-note">
              Затем 1 с жёлтого и 1 с красного для всех. Приоритет главной
              дороги не учитывается.
            </p>
          </>
        )}
        <p className="junction-note">Схема сверху · номера въездов</p>
        <svg
          className="junction-diagram"
          viewBox="0 0 250 150"
          role="img"
          aria-label="Въезды и текущие сигналы перекрёстка"
        >
          <polygon
            points="125,40 151,55 151,85 125,100 99,85 99,55"
            fill="#303a36"
            stroke="#718078"
          />
          {edges.map((e) => {
            const a = (e * Math.PI) / 3,
              x = 125 + 85 * Math.cos(a),
              y = 70 + 52 * Math.sin(a),
              state = game.roads.signalState(address, e, game.sim.time);
            return (
              <g key={e}>
                <path
                  d={`M125,70 L${x},${y}`}
                  stroke={!on && main & (1 << e) ? "#d8bd7d" : "#748079"}
                  strokeWidth="9"
                />
                <circle
                  cx={x}
                  cy={y}
                  r="10"
                  fill={
                    state === "green"
                      ? "#85c58b"
                      : state === "yellow"
                        ? "#e6c35b"
                        : state === "red"
                          ? "#e37468"
                          : "#26302a"
                  }
                />
                <text
                  x={x}
                  y={y + 4}
                  textAnchor="middle"
                  fill={state === "off" ? "#e2e5df" : "#18231d"}
                >
                  {e + 1}
                </text>
              </g>
            );
          })}
        </svg>
        <fieldset disabled={on} className="junction-priority">
          <legend>Главная дорога</legend>
          <label className="junction-check">
            <input
              type="checkbox"
              checked={settings.mainRoadMask === null}
              onChange={(e) =>
                update({ mainRoadMask: e.target.checked ? null : main })
              }
            />
            Автоматически: построена раньше
          </label>
          <div className="entry-buttons">
            {edges.map((e) => (
              <button
                key={e}
                aria-label={`Въезд ${e + 1}: главная дорога`}
                aria-pressed={!!(main & (1 << e))}
                className={main & (1 << e) ? "main-entry" : ""}
                onClick={() => update({ mainRoadMask: main ^ (1 << e) })}
              >
                {e + 1}
              </button>
            ))}
          </div>
          <p className="junction-note">
            Выберите главные въезды. Остальные уступают. При равенстве — помеха
            справа.
          </p>
        </fieldset>
        <label className="junction-check">
          <input
            type="checkbox"
            checked={settings.allowLeft}
            onChange={(e) => update({ allowLeft: e.target.checked })}
          />
          Разрешить поворот налево
        </label>
        <p className="junction-note">
          При повороте налево уступать встречным, в том числе на зелёный.
          Настройки применяются сразу; въехавшие машины завершают проезд.
        </p>
      </div>
    </section>
  );
}
