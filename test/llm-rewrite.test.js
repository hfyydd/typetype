const test = require("node:test");
const assert = require("node:assert/strict");

const { LlmRewriteEngine } = require("../dist-electron/llm-rewrite.js");

const BASE_CONFIG = {
  enabled: true,
  provider: "compatible",
  api_key: "test-key",
  base_url: "https://api.example.test/v1",
  model: "MiniMax-M2.7",
  temperature: 0.2,
  max_tokens: 512,
};

test("LlmRewriteEngine keeps rewrite behavior and removes MiniMax think blocks", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "<think>internal reasoning</think>\n\n今天我们测试语音输入。",
            },
          },
        ],
      }),
    };
  };

  const engine = new LlmRewriteEngine(BASE_CONFIG);
  const result = await engine.rewrite("嗯今天我们测试语音输入");

  assert.equal(result.polished_text, "今天我们测试语音输入。");
  assert.match(requestBody.messages[0].content, /PUNCTUATION/i);
  assert.match(requestBody.messages[0].content, /CLEANUP/i);
  assert.match(requestBody.messages[0].content, /STRUCTURE/i);
  assert.match(requestBody.messages[0].content, /action items/i);
});
