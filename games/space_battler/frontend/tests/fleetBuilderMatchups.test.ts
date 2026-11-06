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
  return FleetBuilder(builder.props as Parameters<typeof FleetBuilder>[0]);
}

function button(tree: ReactNode, label: string): Element {
  const result = elements(tree).find(
    (element) => element.type === "button" && text(element).includes(label),
  );
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}

function selectMatchup(id: string) {
  const select = elements(renderBuilder()).find((element) => element.type === "select");
  if (!select) throw new Error("Matchup selector not found");
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
    const enlist = elements(tree).filter(
      (element) => element.type === "button" && text(element).includes("Enlist in Group 1"),
    );
    enlist.at(-1)?.props.onClick();
    tree = renderBuilder();
    expect(text(tree)).toContain("3000 / 20000 CR");
    const selects = elements(tree).filter((element) => element.type === "select");
    selects[0].props.onChange({ target: { value: "8" } });
    tree = renderBuilder();
    expect(text(tree)).toContain("3960 / 20000 CR");
    elements(tree).filter((element) => element.type === "select")[1].props.onChange({
      target: { value: "2" },
    });
    tree = renderBuilder();
    expect(text(tree)).toContain("4660 / 20000 CR");
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
    expect(text(tree)).toContain("Blue Active Roster (1 hulls)");
    button(tree, "Opposing Force (Red)").props.onClick();
    tree = renderBuilder();
    expect(text(tree)).toContain("Red Active Roster (27 hulls)");
    expect(text(tree)).toContain("3240 / 20000 CR");
    button(tree, "Clear All").props.onClick();
    tree = renderBuilder();
    expect(text(tree)).toContain("Red Active Roster (0 hulls)");
    expect(button(tree, "Engage Fleet Simulator").props.disabled).toBe(true);
    expect(elements(tree).find((element) => element.type === "select")).toBeUndefined();

    button(tree, "Enlist in Group 1").props.onClick();
    tree = renderBuilder();
    expect(text(tree)).toContain("Red Active Roster (1 hulls)");
    button(tree, "Terran Task Force (Blue)").props.onClick();
    tree = renderBuilder();
    expect(text(tree)).toContain("Blue Active Roster (1 hulls)");
    expect(elements(tree).find((element) => element.type === "select")?.props.value).toBe("custom");
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
    expect(text(tree)).toContain("Blue Active Roster (1 hulls)");
    button(tree, "Opposing Force (Red)").props.onClick();
    tree = renderBuilder();
    expect(text(tree)).toContain("Red Active Roster (3 hulls)");
    button(tree, "Mirror Fleet").props.onClick();
    tree = renderBuilder();
    expect(text(tree)).toContain("Red Active Roster (1 hulls)");
    expect(elements(tree).find((element) => element.type === "select")).toBeUndefined();
    const builder = elements(renderApp()).find((element) => element.type === FleetBuilder);
    expect(builder?.props.redSlots).toEqual(builder?.props.blueSlots);
    expect(builder?.props.redSlots[0]).not.toBe(builder?.props.blueSlots[0]);
    button(tree, "Clear All").props.onClick();
    button(renderBuilder(), "Terran Task Force (Blue)").props.onClick();
    tree = renderBuilder();
    expect(text(tree)).toContain("Blue Active Roster (1 hulls)");
    expect(elements(tree).find((element) => element.type === "select")?.props.value).toBe("custom");
  });

  it("distinguishes scenario IDs from presets and marks a Blue scenario edit as custom", () => {
    selectMatchup("scenario:combined");
    let tree = renderBuilder();
    expect(text(tree)).toContain("Blue Active Roster (10 hulls)");
    button(tree, "Enlist in Group 1").props.onClick();
    tree = renderBuilder();
    expect(elements(tree).find((element) => element.type === "select")?.props.value).toBe("custom");
    selectMatchup("combined");
    tree = renderBuilder();
    expect(text(tree)).toContain("Blue Active Roster (11 hulls)");
    button(tree, "Opposing Force (Red)").props.onClick();
    expect(text(renderBuilder())).toContain("Red Active Roster (9 hulls)");
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
    expect(elements(tree).find((element) => element.type === "select")?.props.value).toBe("custom");
    button(tree, "Opposing Force (Red)").props.onClick();
    tree = renderBuilder();
    expect(text(tree)).toContain("Red Active Roster (0 hulls)");
    expect(button(tree, "Engage Fleet Simulator").props.disabled).toBe(true);
  });
});
