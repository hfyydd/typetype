const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { TextNormalizationEngine } = require("../dist-electron/text-normalization-engine.js");

const engine = new TextNormalizationEngine();

function normalize(input, options = {}) {
  return engine.normalize(input, {
    mode: "non_streaming",
    strength: "conservative",
    ...options,
  });
}

test("TextNormalizationEngine converts high-confidence phone and id numbers", () => {
  assert.equal(normalize("我的手机号是一三八一二三四五六七八"), "我的手机号是13812345678");
  assert.equal(normalize("客服电话是四零零八零零一二三四"), "客服电话是4008001234");
  assert.equal(normalize("座机是零二一六八八八九九九九"), "座机是02168889999");
  assert.equal(normalize("分机号八零六"), "分机号806");
  assert.equal(normalize("订单号是一二三四五六"), "订单号是123456");
});

test("TextNormalizationEngine keeps weekday numerals in Chinese while normalizing time", () => {
  assert.equal(normalize("周一上午十点开会"), "周一上午10点开会");
  assert.equal(normalize("周二下午两点 review"), "周二下午2点 review");
  assert.equal(normalize("星期三晚上八点直播"), "星期三晚上8点直播");
  assert.equal(normalize("周一周二都可以"), "周一周二都可以");
});

test("TextNormalizationEngine converts conservative date, time, money, percent and version forms", () => {
  assert.equal(normalize("六月十一号下午三点半开 meeting"), "6月11号下午3点半开 meeting");
  assert.equal(normalize("二零二六年六月十一日"), "2026年6月11日");
  assert.equal(normalize("零一五年三月八日"), "2015年3月8日");
  assert.equal(normalize("今天 ROI 是百分之三十"), "今天 ROI 是30%");
  assert.equal(normalize("预算是一万二千元"), "预算是12000元");
  assert.equal(normalize("这个版本是三点二点一"), "这个版本是3.2.1");
});

test("TextNormalizationEngine avoids idiom and incomplete streaming partial false positives", () => {
  assert.equal(normalize("一心一意做好服务"), "一心一意做好服务");
  assert.equal(normalize("三三两两的人过来"), "三三两两的人过来");
  assert.equal(
    normalize("我的手机号是一三八", { mode: "streaming_partial" }),
    "我的手机号是一三八"
  );
  assert.equal(
    normalize("我的手机号是一三八一二三四五六七八", { mode: "streaming_final" }),
    "我的手机号是13812345678"
  );
});

test("TextNormalizationEngine preserves protected AI and compliance terms", () => {
  assert.equal(
    normalize("DeepSeek R1 和 Qwen3 要进 review，ISO 27001 不要拆", {
      preserveTerms: ["DeepSeek R1", "Qwen3", "ISO 27001"],
    }),
    "DeepSeek R1 和 Qwen3 要进 review，ISO 27001 不要拆"
  );
});

test("TextNormalizationEngine does not let dictionary date fragments block ITN", () => {
  assert.equal(
    normalize("二零一五年，三月八日。", {
      mode: "streaming_final",
      preserveTerms: ["五年", "三月", "八日", "一五"],
    }),
    "2015年，3月8日。"
  );
  assert.equal(
    normalize("一九八七年出生。", {
      mode: "streaming_final",
      preserveTerms: ["一九八七年", "八七年", "出生", "一九"],
    }),
    "1987年出生。"
  );
});

test("ASR quality corpus matches the conservative ITN expectations", () => {
  const corpus = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", "asr-quality-corpus.json"), "utf8")
  );

  for (const item of corpus.cases) {
    assert.equal(
      normalize(item.input, { mode: item.mode }),
      item.expected,
      `${item.category}: ${item.input}`
    );
  }
});
