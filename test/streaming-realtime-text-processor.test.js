const test = require("node:test");
const assert = require("node:assert/strict");

const { StreamingRealtimeTextProcessor } = require("../dist-electron/streaming-realtime-text-processor.js");
const { TextNormalizationEngine } = require("../dist-electron/text-normalization-engine.js");

function createSettings() {
  return {
    custom_dictionary: [],
    voice_formatting_enabled: true,
  };
}

test("StreamingRealtimeTextProcessor keeps partial work inside the tail window", () => {
  const lengths = [];
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      lengths.push(text.length);
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  }, { tailWindowChars: 120 });

  const raw = `${"前".repeat(180)}我的手机号是一三八一二三四五六七八`;
  const result = processor.processPartial(raw, createSettings());

  assert.equal(result.displayDelta.includes("我的手机号是一三八"), true);
  assert.equal(result.stableText.includes("我的手机号是13812345678"), true);
  assert.equal(result.tailCorrection?.replacementText.includes("13812345678"), true);
  assert.equal(Math.max(...lengths) <= 120, true);
  assert.equal(result.metrics.tail_chars_processed, 120);
});

test("StreamingRealtimeTextProcessor accumulates monotonic display deltas", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  assert.equal(processor.processPartial("今天开", createSettings()).displayDelta, "今天开");
  assert.equal(processor.processPartial("今天开 meeting", createSettings()).displayDelta, "meeting");
  assert.equal(processor.getRealtimeText(), "今天开meeting");
});

test("StreamingRealtimeTextProcessor applies lightweight code-switch protection to the tail", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return {
        text: text.replace(/密厅/gu, "meeting").replace(/皮皮踢/gu, "PPT"),
        matchedTerms: ["meeting", "PPT"],
        replacementCount: 2,
        highRiskCount: 0,
      };
    },
  });

  const result = processor.processPartial("今天开个密厅看一下皮皮踢", createSettings());

  assert.equal(result.realtimeText.includes("密厅"), true);
  assert.equal(result.stableText.includes("meeting"), true);
  assert.equal(result.stableText.includes("PPT"), true);
  assert.notEqual(result.tailCorrection, null);
});

test("StreamingRealtimeTextProcessor uses comma for stable pauses instead of mechanical periods", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  const result = processor.processPartial(
    "下一个重点是讨论一下要怎么让更新通过线上更新来处理",
    createSettings(),
    { stablePause: true }
  );

  assert.equal(result.stableText.endsWith("。"), false);
  assert.equal(result.stableText.includes("。重点是"), false);
  assert.equal(/[，,]$/.test(result.stableText), true);
});

test("StreamingRealtimeTextProcessor applies soft and hard pause punctuation differently", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  const soft = processor.processStableSegment("阴天了那就是快下了", createSettings(), {
    stablePause: true,
    pauseMs: 420,
    pauseReason: "soft_pause",
  });
  const hard = processor.processStableSegment("那就是快下了", createSettings(), {
    stablePause: true,
    pauseMs: 760,
    pauseReason: "hard_pause",
  });

  assert.equal(soft, "阴天了，那就是快下了");
  assert.equal(hard, "那就是快下了。");
});

test("StreamingRealtimeTextProcessor uses semantic punctuation for final stable text", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  const result = processor.processStableSegment(
    "下一个重点是讨论一下要怎么让更新通过线上更新来处理也就是说就算有报错也可以通过线上下载",
    createSettings(),
    { final: true }
  );

  assert.match(result, /下一个重点是/);
  assert.match(result, /。也就是说，/);
  assert.equal(result.endsWith("。"), true);
});

test("StreamingRealtimeTextProcessor restores punctuation for casual chained questions", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  const result = processor.processStableSegment(
    "阴天了那就是快下了你带没带伞啊耳机都找没找着",
    createSettings(),
    { final: true }
  );

  assert.equal(result, "阴天了，那就是快下了。你带没带伞啊？耳机都找没找着？");
});

test("StreamingRealtimeTextProcessor uses comma for short contrast boundaries", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  const result = processor.processStableSegment("这个能用但是速度慢", createSettings(), { final: true });

  assert.equal(result, "这个能用，但是速度慢。");
});

test("StreamingRealtimeTextProcessor keeps question punctuation lightweight during stable pauses", () => {
  const processor = new StreamingRealtimeTextProcessor({
    textNormalizationEngine: new TextNormalizationEngine(),
    applyDictionary(text) {
      return text;
    },
    applyCodeSwitch(text) {
      return { text, matchedTerms: [], replacementCount: 0, highRiskCount: 0 };
    },
  });

  const result = processor.processPartial("这个方案能不能上线", createSettings(), { stablePause: true });

  assert.equal(result.stableText, "这个方案能不能上线？");
});
