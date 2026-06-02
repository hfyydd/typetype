const assert = require("node:assert/strict");
const test = require("node:test");
const { rewriteWithPreferredLlm } = require("../dist-electron/llm-route.js");

const MINIMAX_CONFIG = {
  enabled: true,
  provider: "compatible",
  api_key: "api-token",
  base_url: "https://api.minimaxi.com/v1",
  model: "MiniMax-M2.7",
  temperature: 0.3,
  max_tokens: 4096,
};

const OPENAI_CONFIG = {
  enabled: true,
  provider: "openai",
  api_key: "openai-token",
  base_url: "https://api.openai.com/v1",
  model: "gpt-5.1",
  temperature: 0.3,
  max_tokens: 4096,
};

test("rewriteWithPreferredLlm uses the configured API key model", async () => {
  const calls = [];
  const result = await rewriteWithPreferredLlm("今天开会第一产品第二翻译", {
    llm_rewrite: MINIMAX_CONFIG,
  }, {
    createEngine: (config) => ({
      rewrite: async () => {
        calls.push(config.model);
        return { polished_text: "MiniMax 结构化润写结果" };
      },
    }),
    logger: { log() {}, error() {} },
  });

  assert.equal(result.source, "api-key");
  assert.equal(result.polishedText, "MiniMax 结构化润写结果");
  assert.deepEqual(calls, ["MiniMax-M2.7"]);
});

test("rewriteWithPreferredLlm supports GPT through OpenAI API key config", async () => {
  const calls = [];
  const result = await rewriteWithPreferredLlm("今天开会第一产品第二翻译", {
    llm_rewrite: OPENAI_CONFIG,
  }, {
    createEngine: (config) => ({
      rewrite: async () => {
        calls.push({
          provider: config.provider,
          baseUrl: config.base_url,
          model: config.model,
        });
        return { polished_text: "GPT 结构化润写结果" };
      },
    }),
    logger: { log() {}, error() {} },
  });

  assert.equal(result.source, "api-key");
  assert.equal(result.polishedText, "GPT 结构化润写结果");
  assert.deepEqual(calls, [{
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.1",
  }]);
});

test("rewriteWithPreferredLlm passes local dictionary terms to the rewrite engine", async () => {
  let receivedOptions = null;
  const result = await rewriteWithPreferredLlm("请整理typetype会议纪要", {
    llm_rewrite: OPENAI_CONFIG,
  }, {
    preserveTerms: ["typetype", "会议纪要"],
    createEngine: (_config, options) => ({
      rewrite: async () => {
        receivedOptions = options;
        return { polished_text: "typetype 会议纪要" };
      },
    }),
    logger: { log() {}, error() {} },
  });

  assert.equal(result.polishedText, "typetype 会议纪要");
  assert.deepEqual(receivedOptions, { preserveTerms: ["typetype", "会议纪要"] });
});
