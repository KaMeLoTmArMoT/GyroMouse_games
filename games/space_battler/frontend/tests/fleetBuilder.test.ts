import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  calculateMaxAffordable,
  clampTargetCount,
  FleetBuilder,
  RosterCountInput,
  ShipSilhouette,
  updateSlotsForStackCount,
} from "../src/components/FleetBuilder";
import { GroupPreview, useDelayedPreview } from "../src/components/FleetPreviews";
import { buildFleetFromSlots, type FleetSlot, GROUP_ANCHORS } from "../src/engine/fleetBuilder";

describe("FleetBuilder presentation", () => {
  it("orders the catalog, groups weapons, and offers independent selectors and carrier controls", () => {
    hooks.value = "";
    hooks.refs = [];
    hooks.refIndex = 0;
    const markup = renderToStaticMarkup(
      React.createElement(FleetBuilder, {
        blueSlots: [
          { id: "carrier1", hullClass: "carrier", groupId: 1 },
          { id: "carrier2", hullClass: "carrier", groupId: 2 },
        ],
        redSlots: [{ id: "red", hullClass: "corvette", groupId: 1 }],
        onUpdateBlueSlots: vi.fn(),
        onUpdateRedSlots: vi.fn(),
        crewVeterancy: { blue: "pilot", red: "ace" },
        onUpdateCrewVeterancy: vi.fn(),
        budgetLimit: 20000,
        enemyPresetId: "custom",
        onSelectEnemyPreset: vi.fn(),
        onStartBattle: vi.fn(),
      }),
    );
    const names = [
      "Artillery Dreadnought",
      "Oceanic Carrier",
      "Sovereign Battleship",
      "Strike Cruiser",
      "Shield Tender",
      "Missile Frigate",
      "Aegis Corvette",
      "Viper Fighter",
    ];
    const positions = names.map((name) => markup.indexOf(name.replaceAll('"', "&quot;")));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(markup).toContain("×4");
    expect(markup).toContain("×3");
    expect(markup).toContain("Opposing Fleet Presets");
    expect(markup).toContain("Tactical Scenarios");
    expect(markup).toContain('aria-label="blue carrier"');
    expect(markup).toContain("Blue Active Roster");
    expect(markup).toContain("Red Active Roster");
    expect(markup).toMatch(/Blue Crew Veterancy · Draft[\s\S]*?value="pilot" selected=""/);
    expect(markup).toMatch(/Red Crew Veterancy · Draft[\s\S]*?value="ace" selected=""/);
    expect(markup).toContain("Blue Budget");
    expect(markup).toContain("Red Budget");
    expect(markup).not.toContain("Armament Loadout");
    expect(markup).not.toContain("suggested Blue vs Red");
    expect(markup).not.toContain("fabrication are not yet simulated");
  });
});

const hooks = vi.hoisted(() => ({
  value: "",
  refs: [] as { current: unknown }[],
  refIndex: 0,
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: string) => [
    hooks.value || initial,
    (value: string) => {
      hooks.value = value;
    },
  ],
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    hooks.refs[index] ??= { current: initial };
    return hooks.refs[index];
  },
  useEffect: () => {},
}));

describe("fleet previews", () => {
  it("renders a distinct SVG hull and details for every hull and faction", () => {
    for (const hullClass of [
      "strike_craft",
      "corvette",
      "cruiser",
      "battleship",
      "dreadnought",
      "missile_frigate",
      "carrier",
    ] as const) {
      const blue = renderToStaticMarkup(ShipSilhouette({ hullClass, team: 0 }));
      const red = renderToStaticMarkup(ShipSilhouette({ hullClass, team: 1 }));
      for (const markup of [blue, red]) {
        expect(markup).toContain('<svg viewBox="0 0 48 48"');
        expect(markup).toContain('transform="translate(24 24) rotate(-90) scale(16)"');
        expect(markup.match(/<path /g)).toHaveLength(2);
        expect(markup).not.toContain('d="undefined"');
      }
      expect(blue).not.toBe(red);
    }
  });

  it.each([200, 250])("waits %ims and cancels a preview on leave or a new hover", (delay) => {
    vi.useFakeTimers();
    try {
      hooks.value = "";
      hooks.refs = [];
      const render = () => {
        hooks.refIndex = 0;
        // biome-ignore lint/correctness/useHookAtTopLevel: This test invokes mocked hooks directly.
        return useDelayedPreview<string>(delay);
      };
      render().show("first");
      vi.advanceTimersByTime(delay - 1);
      expect(render().active).toBeNull();
      render().show("second");
      vi.advanceTimersByTime(delay);
      expect(render().active).toBe("second");
      render().show("third");
      render().hide();
      vi.advanceTimersByTime(delay);
      expect(render().active).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("diagrams the real blue spawn anchors with exactly one highlighted group", () => {
    const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
    for (let group = 1; group <= 5; group++) {
      const [ship] = buildFleetFromSlots(
        [{ id: "anchor", hullClass: "battleship", groupId: group }],
        0,
        0,
        0,
      );
      expect(ship.pos).toEqual(GROUP_ANCHORS[group]);
      const markup = renderToStaticMarkup(GroupPreview({ group }));
      expect(markup).toContain(names[group - 1]);
      expect(markup.match(/fill="#475569"/g)).toHaveLength(4);
      expect(markup.match(/fill="#67e8f9"/g)).toHaveLength(1);
      const [x, y] = ship.pos;
      expect(markup).toContain(`cx="${80 + x * 0.12}" cy="${55 + y * 0.09}" r="5"`);
    }
  });

  it("preserves mirrored spawn anchors for both teams, including preset-only groups", () => {
    for (let group = 1; group <= 10; group++) {
      const slots: FleetSlot[] = [{ id: "anchor", hullClass: "battleship", groupId: group }];
      const [x, y] = GROUP_ANCHORS[group];
      expect(buildFleetFromSlots(slots, 0, 100, 0)[0].pos).toEqual([100 + x, y]);
      expect(buildFleetFromSlots(slots, 1, 100, Math.PI)[0].pos).toEqual([100 - x, y]);
    }
  });
});

describe("RosterCountInput", () => {
  function setup(initialCount = 3) {
    hooks.value = String(initialCount);
    hooks.refs = [];
    let count = initialCount;
    const onChangeCount = vi.fn((value: number) => {
      count = value;
    });
    const render = () => {
      hooks.refIndex = 0;
      return RosterCountInput({
        count,
        maxAffordable: 20,
        themeText: "",
        hullName: "Cruiser",
        groupId: 1,
        onChangeCount,
      });
    };
    return { render, onChangeCount };
  }

  it("restores the count captured on focus after live edits", () => {
    const { render, onChangeCount } = setup();
    render().props.onFocus({
      target: { select: vi.fn() },
    } as unknown as React.FocusEvent<HTMLInputElement>);
    render().props.onChange({ target: { value: "5" } } as React.ChangeEvent<HTMLInputElement>);
    expect(onChangeCount).toHaveBeenLastCalledWith(5);

    const blur = vi.fn(() => render().props.onBlur());
    render().props.onKeyDown({
      key: "Escape",
      stopPropagation: vi.fn(),
      currentTarget: { blur },
    } as unknown as React.KeyboardEvent<HTMLInputElement>);
    expect(onChangeCount).toHaveBeenLastCalledWith(3);
    expect(onChangeCount).toHaveBeenCalledTimes(2);
    expect(render().props.value).toBe("3");
    expect(blur).toHaveBeenCalledOnce();
  });

  it("rejects invalid characters while allowing digits, navigation and shortcuts", () => {
    const { render } = setup();
    for (const key of ["-", "+", ".", "e", "E", "a"]) {
      const preventDefault = vi.fn();
      render().props.onKeyDown({
        key,
        preventDefault,
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
      expect(preventDefault, key).toHaveBeenCalledOnce();
    }
    for (const key of [
      "0",
      "5",
      "Backspace",
      "Delete",
      "Tab",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
    ]) {
      const preventDefault = vi.fn();
      render().props.onKeyDown({
        key,
        preventDefault,
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
      expect(preventDefault, key).not.toHaveBeenCalled();
    }
    const preventDefault = vi.fn();
    render().props.onKeyDown({
      key: "v",
      ctrlKey: true,
      preventDefault,
    } as unknown as React.KeyboardEvent<HTMLInputElement>);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe("FleetBuilder direct numeric stepper logic", () => {
  describe("calculateMaxAffordable", () => {
    it("computes max affordable hulls based on current count and remaining budget", () => {
      // count 2, remaining budget 2500, cruiser cost 1100 -> 2 + floor(2500/1100) = 2 + 2 = 4
      expect(calculateMaxAffordable(2, 2500, 1100)).toBe(4);
    });

    it("handles exact budget boundaries cleanly", () => {
      // count 3, remaining budget 2200, cruiser cost 1100 -> 3 + 2 = 5
      expect(calculateMaxAffordable(3, 2200, 1100)).toBe(5);
      // count 3, remaining budget 2199, cruiser cost 1100 -> 3 + 1 = 4
      expect(calculateMaxAffordable(3, 2199, 1100)).toBe(4);
    });

    it("returns current count when remaining budget is zero", () => {
      expect(calculateMaxAffordable(5, 0, 350)).toBe(5);
    });

    it("reduces affordable count when remaining budget is negative", () => {
      // count 5, remaining budget -700, corvette cost 350 -> 5 + floor(-700/350) = 5 - 2 = 3
      expect(calculateMaxAffordable(5, -700, 350)).toBe(3);
    });

    it("never returns negative values even under severe budget deficit", () => {
      // count 1, remaining budget -10000, corvette cost 350 -> clamped to 0
      expect(calculateMaxAffordable(1, -10000, 350)).toBe(0);
    });

    it("safely handles zero unit cost without crashing", () => {
      expect(calculateMaxAffordable(4, 1000, 0)).toBe(4);
    });
  });

  describe("clampTargetCount", () => {
    it("accepts valid numbers within budget", () => {
      expect(clampTargetCount(4, 8)).toBe(4);
      expect(clampTargetCount(0, 8)).toBe(0);
      expect(clampTargetCount(8, 8)).toBe(8);
    });

    it("clamps values that exceed maxAffordable limit", () => {
      expect(clampTargetCount(25, 6)).toBe(6);
      expect(clampTargetCount(999, 12)).toBe(12);
    });

    it("clamps negative numbers to 0", () => {
      expect(clampTargetCount(-1, 10)).toBe(0);
      expect(clampTargetCount(-99, 10)).toBe(0);
    });

    it("handles NaN safely by falling back to 0", () => {
      expect(clampTargetCount(Number.NaN, 10)).toBe(0);
    });

    it("floors floating point numbers to integers", () => {
      expect(clampTargetCount(3.7, 10)).toBe(3);
      expect(clampTargetCount(5.99, 10)).toBe(5);
    });
  });

  describe("updateSlotsForStackCount", () => {
    const createBaseSlots = (): FleetSlot[] => [
      { id: "bb_1", hullClass: "battleship", groupId: 1 },
      { id: "cr_1", hullClass: "cruiser", groupId: 1 },
      { id: "cv_1", hullClass: "corvette", groupId: 1 },
      { id: "cv_2", hullClass: "corvette", groupId: 1 },
      { id: "cv_3", hullClass: "corvette", groupId: 1 },
      { id: "cr_2", hullClass: "cruiser", groupId: 2 },
    ];

    it("returns unchanged slots when targetCount equals currentCount", () => {
      const base = createBaseSlots();
      const updated = updateSlotsForStackCount(base, 1, "corvette", 3);
      expect(updated).toEqual(base);
    });

    it("increases count by adding new slots with unique IDs and matching group/hull", () => {
      const base = createBaseSlots();
      // Increase Group 1 corvettes from 3 to 5 (+2)
      const updated = updateSlotsForStackCount(base, 1, "corvette", 5);

      expect(updated).toHaveLength(8);
      const group1Corvettes = updated.filter((s) => s.groupId === 1 && s.hullClass === "corvette");
      expect(group1Corvettes).toHaveLength(5);

      // Verify new slots have unique IDs
      const ids = new Set(updated.map((s) => s.id));
      expect(ids.size).toBe(8);

      // Verify original first 3 corvettes are preserved in place
      expect(group1Corvettes[0].id).toBe("cv_1");
      expect(group1Corvettes[1].id).toBe("cv_2");
      expect(group1Corvettes[2].id).toBe("cv_3");
    });

    it("decreases count by removing difference from the end of matching slots", () => {
      const base = createBaseSlots();
      // Decrease Group 1 corvettes from 3 to 1 (-2). Should remove cv_3 then cv_2.
      const updated = updateSlotsForStackCount(base, 1, "corvette", 1);

      expect(updated).toHaveLength(4);
      const remainingCorvettes = updated.filter(
        (s) => s.groupId === 1 && s.hullClass === "corvette",
      );
      expect(remainingCorvettes).toHaveLength(1);
      expect(remainingCorvettes[0].id).toBe("cv_1");

      // Verify other vessels were not disturbed
      expect(updated.find((s) => s.id === "bb_1")).toBeDefined();
      expect(updated.find((s) => s.id === "cr_1")).toBeDefined();
      expect(updated.find((s) => s.id === "cr_2")).toBeDefined();
    });

    it("removes the stack completely when targetCount reaches 0", () => {
      const base = createBaseSlots();
      // Set Group 1 corvettes to 0
      const updated = updateSlotsForStackCount(base, 1, "corvette", 0);

      expect(updated).toHaveLength(3);
      const remainingCorvettes = updated.filter(
        (s) => s.groupId === 1 && s.hullClass === "corvette",
      );
      expect(remainingCorvettes).toHaveLength(0);

      // Verify other groups/hulls remain intact
      expect(updated.map((s) => s.id)).toEqual(["bb_1", "cr_1", "cr_2"]);
    });

    it("preserves isolation between different groups sharing the same hull class", () => {
      const slots: FleetSlot[] = [
        { id: "g1_cr_1", hullClass: "cruiser", groupId: 1 },
        { id: "g2_cr_1", hullClass: "cruiser", groupId: 2 },
        { id: "g1_cr_2", hullClass: "cruiser", groupId: 1 },
      ];

      // Update Group 1 cruisers to 1 (should remove g1_cr_2, leave g1_cr_1 and g2_cr_1)
      const updated = updateSlotsForStackCount(slots, 1, "cruiser", 1);
      expect(updated.map((s) => s.id)).toEqual(["g1_cr_1", "g2_cr_1"]);
    });

    it("handles targetCount of 0 when multiple hulls and groups are interleaved", () => {
      const slots: FleetSlot[] = [
        { id: "s1", hullClass: "strike_craft", groupId: 3 },
        { id: "c1", hullClass: "corvette", groupId: 1 },
        { id: "s2", hullClass: "strike_craft", groupId: 3 },
      ];

      const updated = updateSlotsForStackCount(slots, 3, "strike_craft", 0);
      expect(updated).toEqual([{ id: "c1", hullClass: "corvette", groupId: 1 }]);
    });
  });
});
