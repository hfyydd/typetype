import { LlmRewriteConfig, LlmRewriteResponse } from './types';

const DEFAULT_SYSTEM_PROMPT = `You are a voice-to-text assistant. Transform raw speech transcription into clean, polished text.

Rules:
1. PUNCTUATION: Add appropriate punctuation where speech pauses naturally.
2. CLEANUP: Remove filler words (um, uh, 嗯, 那个, 就是说, like, you know).
3. LISTS: Format enumerated items as numbered lists, each on its own line.
4. PARAGRAPHS: Separate distinct topics with blank lines.
5. Preserve the original language and all substantive content exactly.
6. Output ONLY the processed text. No explanations, no quotes.
7. Do NOT add content that was not in the original speech.

The user text will be enclosed in <transcription> tags.`;

export class LlmRewriteEngine {
  private config: LlmRewriteConfig;

  constructor(config: LlmRewriteConfig) {
    this.config = config;
  }

  async rewrite(rawText: string): Promise<LlmRewriteResponse> {
    if (!rawText.trim()) {
      return { polished_text: rawText };
    }

    const systemPrompt = this.buildSystemPrompt();
    const userMessage = this.buildUserMessage(rawText);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    let apiUrl = this.config.base_url;
    // Support both /v1/chat/completions and raw base_url
    if (!apiUrl.endsWith('/chat/completions')) {
      apiUrl = apiUrl.replace(/\/$/, '') + '/chat/completions';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.api_key}`,
    };

    // Anthropic requires different headers
    if (this.config.provider === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
      delete headers['Content-Type'];
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature ?? 0.3,
      max_tokens: this.config.max_tokens ?? 4096,
    };

    // Anthropic uses messages format, OpenAI compatible uses messages
    // Both use the same messages structure, so body is similar

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`LLM API error (${response.status}): ${errorText || response.statusText}`);
      }

      const data = await response.json();
      const polishedText = this.extractPolishedText(data);

      return { polished_text: polishedText || rawText };
    } catch (error) {
      console.error('[llm-rewrite] API call failed:', error);
      throw error;
    }
  }

  private extractPolishedText(data: unknown): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;

    // OpenAI compatible format
    const openAiText = d?.choices?.[0]?.message?.content;
    if (typeof openAiText === 'string') {
      return openAiText.trim();
    }

    // Anthropic format
    const anthropicText = d?.content?.[0]?.text;
    if (typeof anthropicText === 'string') {
      return anthropicText.trim();
    }

    return '';
  }

  private buildSystemPrompt(): string {
    return DEFAULT_SYSTEM_PROMPT;
  }

  private buildUserMessage(rawText: string): string {
    return `<transcription>\n${rawText}\n</transcription>`;
  }
}

export async function testLlmConnection(config: LlmRewriteConfig): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const start = Date.now();
  try {
    const engine = new LlmRewriteEngine(config);
    // Send a minimal test request
    await engine.rewrite('测试连接');
    return { ok: true, latency_ms: Date.now() - start };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - start, error: String(e) };
  }
}
