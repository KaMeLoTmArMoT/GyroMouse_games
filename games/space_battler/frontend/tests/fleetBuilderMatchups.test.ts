import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { TacticalCanvas } from "../src/canvas/TacticalCanvas";
import { FleetBuilder } from "../src/components/FleetBuilder";
import type { ClientCombatSimulation } from "../src/engine/simulation";

const hooks = vi.hoisted(() => ({
  scope: "app",
  index: 0,
  values: {} as Record<string, unknown[]>,
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => {
    hooks.values[hooks.scope] ??= [];
    const values = hooks.values[hooks.scope];
    const index = hooks.index++;
    if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
    return [
      values[index],
      (next: unknown) => {
        values[index] = typeof next === "function" ? next(values[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    hooks.values[hooks.scope] ??= [];
    const values = hooks.values[hooks.scope];
    const index = hooks.index++;
    if (!(index in values)) values[index] = { current: initial };
    return values[index];
  },
  useEffect: () => {},
}));

type ElementProps = Parameters<typeof FleetBuilder>[0] & {
  children: ReactNode;
  onClick: () => void;
  onChange: (event: { target: { value: string } }) => void;
  value: string;
  disabled: boolean;
  sim: ClientCombatSimulation;
};
type Element = ReactElement<ElementProps>;

function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isValidElement<ElementProps>(node)) return "";
  return text(node.props.children);
}

function renderApp() {
  hooks.scope = "app";
  hooks.index = 0;
  return App();
}

function renderBuilder() {
  const app = renderApp();
  const builder = elements(app).find((element) => element.type === FleetBuilder);
  if (!builder) throw new Error("Fleet Builder is not open");
  hooks.scope = "builder";
  hooks.index = 0;
  const tree = FleetBuilder(builder.props as Parameters<typeof FleetBuilder>[0]);
  const panel = elements(tree).find((element) => typeof element.type === "function");
  if (!panel || typeof panel.type !== "function") throw new Error("Active fleet panel not found");
  hooks.scope = `panel:${(panel.props as unknown as { team: string }).team}`;
  hooks.index = 0;
  return [tree, (panel.type as (props: ElementProps) => ReactNode)(panel.props)];
}

function button(tree: ReactNode, label: string): Element {
  const result = elements(tree).find(
    (element) => element.type === "button" && text(element).includes(label),
  );
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}

function expectRoster(tree: ReactNode, team: "Blue" | "Red", count: number) {
  expect(text(tree)).toContain(`${team} Active Roster`);
  const builder = elements(renderApp()).find((element) => element.type === FleetBuilder);
  expect(team === "Blue" ? builder?.props.blueSlots : builder?.props.redSlots).toHaveLength(count);
}

function enlist(tree: ReactNode, hullName: string) {
  const card = elements(tree)
    .filter((element) => element.type === "div" && text(element).includes(hullName))
    .findLast((element) =>
      elements(element).some(
        (child) => child.type === "button" && text(child).includes("Enlist in Group 1"),
      ),
    );
  if (!card) throw new Error(`Hull not found: ${hullName}`);
  button(card, "Enlist in Group 1").props.onClick();
}

function selector(tree: ReactNode, label: string): Element {
  const container = elements(tree).find(
    (element) => element.type === "label" && text(element).includes(label),
  );
  const select = container && elements(container).find((element) => element.type === "select");
  if (!select) throw new Error(`Selector not found: ${label}`);
  return select;
}

function selectMatchup(id: string) {
  const select = selector(
    renderBuilder(),
    id.startsWith("scenario:") ? "Tactical Scenarios" : "Opposing Fleet Presets",
  );
  select.props.onChange({ target: { value: id } });
}

describe("fleet builder matchups", () => {
  beforeEach(() => {
    hooks.values = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key === "gyromouse_sb_active_tab" ? "builder" : null),
      setItem: vi.fn(),
    });
  });

  it("prices a carrier's selected craft and deploys them in battle", () => {
    let tree = renderBuilder();
    button(tree, "Clear All").props.onClick();
    tree = renderBuilder();
    enlist(tree, "Oceanic Carrier");
    tree = renderBuilder();
    expect(text(tree)).toContain("3,000 / 30,000 CR");
    selector(tree, "Strike wing").props.onChange({ target: { value: "8" } });
    tree = renderBuilder();
    expect(text(tree)).toContain("3,960 / 30,000 CR");
    selector(tree, "Corvette escorts").props.onChange({
      target: { value: "2" },
    });
    tree = renderBuilder();
    expect(text(tree)).toContain("4,660 / 30,000 CR");
    button(tree, "Engage Fleet Simulator").props.onClick();
    const canvas = elements(renderApp()).find((element) => element.type === TacticalCanvas);
    const blue = canvas?.props.sim.ships.filter((ship) => ship.team === 0) ?? [];
    expect(blue.filter((ship) => ship.hullClass === "carrier")).toHaveLength(1);
    expect(blue.filter((ship) => ship.hullClass === "strike_craft")).toHaveLength(8);
    expect(blue.filter((ship) => ship.hullClass === "corvette")).toHaveLength(2);
  });

  it("loads a complete scenario, edits only the active side, and launches the edited fleets", () => {
    selectMatchup("scenario:1bb-vs-27sc");
    let tree = renderBuilder();
    expectRoster(tree, "Blue", 1);
    button(tree, "Opposing Force (Red)").props.onClick();
    tree = renderBuilder();
    expectRoster(tree, "Red", 27);
    expect(text(tree)).toContain("3,240 / 30,000 CR");
    button(tree, "Clear All").props.onClick();
    tree = renderBuilder();
    expectRoster(tree, "Red", 0);
    expect(button(tree, "Engage Fleet Simulator").props.disabled).toBe(true);
    expect(selector(tree, "Opposing Fleet Presets").props.value).toBe("custom");
    expect(selector(tree, "Tactical Scenarios").props.value).toBe("custom");

    enlist(tree, "Sovereign Battleship");
    tree = renderBuilder();
    expectRoster(tree, "Red", 1);
    button(tree, "Terran Task Force (Blue)").props.onClick();
    tree = renderBuilder();
    expectRoster(tree, "Blue", 1);
    expect(selector(tree, "Tactical Scenarios").props.value).toBe("custom");
    button(tree, "Engage Fleet Simulator").props.onClick();
    const canvas = elements(renderApp()).find((element) => element.type === TacticalCanvas);
    expect(canvas?.props.sim.ships.map((ship) => [ship.team, ship.hullClass])).toEqual([
      [0, "battleship"],
      [1, "battleship"],
    ]);
  });

  it("loads presets only on Red and mirrors Blue without sharing slot objects", () => {
    selectMatchup("scenario:1bb-vs-27sc");
    selectMatchup("test_3_cruisers");
    let tree = renderBuilder();
    expectRoster(tree, "Blue", 1);
    button(tree, "Opposing Force (Red)").props.onClick();
    tree = renderBuilder();
    expectRoster(tree, "Red", 3);
    button(tree, "Mirror Fleet").props.onClick();
    tree = renderBuilder();
    expectRoster(tree, "Red", 1);
    expect(selector(tree, "Opposing Fleet Presets").props.value).toBe("custom");
    const builder = elements(renderApp()).find((element) => element.type === FleetBuilder);
    expect(builder?.props.redSlots).toEqual(builder?.props.blueSlots);
    expect(builder?.props.redSlots[0]).not.toBe(builder?.props.blueSlots[0]);
    button(tree, "Clear All").props.onClick();
    button(renderBuilder(), "Terran Task Force (Blue)").props.onClick();
    tree = renderBuilder();
    expectRoster(tree, "Blue", 1);
    expect(selector(tree, "Tactical Scenarios").props.value).toBe("custom");
  });

  it("distinguishes scenario IDs from presets and marks a Blue scenario edit as custom", () => {
    selectMatchup("scenario:combined");
    let tree = renderBuilder();
    expectRoster(tree, "Blue", 10);
    button(tree, "Enlist in Group 1").props.onClick();
    tree = renderBuilder();
    expect(selector(tree, "Tactical Scenarios").props.value).toBe("custom");
    selectMatchup("combined");
    tree = renderBuilder();
    expectRoster(tree, "Blue", 11);
    button(tree, "Opposing Force (Red)").props.onClick();
    expectRoster(renderBuilder(), "Red", 9);
  });

  it("restores an empty custom Red fleet after reload", () => {
    const saved: Record<string, string> = {
      gyromouse_sb_active_tab: "builder",
      gyromouse_sb_enemy_preset: "custom",
      gyromouse_sb_red_slots: "[]",
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved[key] ?? null,
      setItem: vi.fn(),
    });
    let tree = renderBuilder();
    expect(selector(tree, "Opposing Fleet Presets").props.value).toBe("custom");
    expect(selector(tree, "Tactical Scenarios").props.value).toBe("custom");
    button(tree, "Opposing Force (Red)").props.onClick();
    tree = renderBuilder();
    expectRoster(tree, "Red", 0);
    expect(button(tree, "Engage Fleet Simulator").props.disabled).toBe(true);
  });
});
