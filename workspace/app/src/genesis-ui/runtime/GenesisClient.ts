// Isolated IDE-to-Genesis adapter (Phase 12)
// Compatible with the existing genesis-ui useGenesisRuntime integration point.
// Does NOT modify production IDE. Drop into genesis-ui/runtime/ after review.

export type GenesisMessage = { role: "user" | "assistant" | "system"; content: string };

export type GenesisChatResult = {
  text: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export type GenesisAgentResult = {
  stopped_reason: string;
  steps: number;
  tool_calls: unknown[];
  tool_results: { tool: string; ok: boolean; output: unknown }[];
  answer: string;
};

export type GenesisHealth = {
  status: string;
  model: string;
  parameters: number;
  vocab_size: number;
  tools: string[];
};

export class GenesisClient {
  constructor(private baseUrl: string) {}

  async health(): Promise<GenesisHealth> {
    const r = await fetch(this.baseUrl + "/health");
    if (!r.ok) throw new Error(`health ${r.status}`);
    return r.json();
  }

  async models(): Promise<{ data: { id: string }[] }> {
    const r = await fetch(this.baseUrl + "/v1/models");
    if (!r.ok) throw new Error(`models ${r.status}`);
    return r.json();
  }

  async tools(): Promise<{ data: unknown[] }> {
    const r = await fetch(this.baseUrl + "/v1/tools");
    if (!r.ok) throw new Error(`tools ${r.status}`);
    return r.json();
  }

  async chat(messages: GenesisMessage[], opts?: { temperature?: number; max_tokens?: number; tools?: boolean }): Promise<GenesisChatResult> {
    const r = await fetch(this.baseUrl + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, temperature: opts?.temperature ?? 0.7, max_tokens: opts?.max_tokens ?? 256, tools: opts?.tools ?? true }),
    });
    if (!r.ok) throw new Error(`chat ${r.status}: ${await r.text()}`);
    return r.json();
  }

  async agent(task: string, opts?: { max_steps?: number }): Promise<GenesisAgentResult> {
    const r = await fetch(this.baseUrl + "/v1/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, max_steps: opts?.max_steps ?? 6 }),
    });
    if (!r.ok) throw new Error(`agent ${r.status}: ${await r.text()}`);
    return r.json();
  }
}

// Honest boundaries: no streaming, no cancellation, no session persistence endpoint in Genesis.
// Adapter must not claim these capabilities. Session state is client-side only.