import { describe, expect, it } from "vitest";
import {
  FRAME_BUDGET_MS, OVER_BUDGET_FRAMES, initialQualityState, qualityFromQuery, qualityStep, resolveQuality,
} from "../src/game/stage/quality";

describe("12.03 rule 5: quality tiers", () => {
  it("reads the query and resolves auto by renderer", () => {
    expect(qualityFromQuery("?quality=low")).toBe("low");
    expect(qualityFromQuery("?quality=high")).toBe("high");
    expect(qualityFromQuery("?quality=ultra")).toBe("auto");
    expect(qualityFromQuery("")).toBe("auto");
    expect(resolveQuality("auto", true)).toBe("high");
    expect(resolveQuality("auto", false)).toBe("low");
    expect(resolveQuality("high", false)).toBe("high");
    expect(resolveQuality("low", true)).toBe("low");
  });

  it("drops to low exactly once after OVER_BUDGET_FRAMES over-budget frames in a row, resets on a good frame", () => {
    let st = initialQualityState("high");
    for (let k = 0; k < OVER_BUDGET_FRAMES - 1; k++) {
      const r = qualityStep(st, FRAME_BUDGET_MS + 1);
      st = r.state;
      expect(r.changed).toBe(false);
    }
    const good = qualityStep(st, 1);
    expect(good.state.over).toBe(0);
    expect(good.state.quality).toBe("high");
    st = good.state;
    let changes = 0;
    for (let k = 0; k < OVER_BUDGET_FRAMES + 30; k++) {
      const r = qualityStep(st, FRAME_BUDGET_MS + 0.5);
      st = r.state;
      if (r.changed) changes += 1;
    }
    expect(changes).toBe(1);
    expect(st.quality).toBe("low");
    expect(st.locked).toBe(true);
    expect(qualityStep(st, 100).changed).toBe(false);
    expect(initialQualityState("low").locked).toBe(true);
  });
});
