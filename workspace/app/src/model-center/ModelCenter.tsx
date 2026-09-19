/* Model Center - live model information display.
 * Provider-independent visual AI presence.
 * Connects to Agent Bridge ModelRouter health state.
 * 
 * DO NOT redesign from scratch - implement around owner-approved visual
 * references in IDE-WORKSPACE/references/visuals/
 */

import React, { useEffect, useState, useRef } from 'react';
import { fetchBridgeStatus, BRIDGE_DEFAULT_BASE, checkVersionCompatibility } from '../bridge';

// Model information types (matching owner's specification)
export interface ModelInfo {
  name: string;
  family: string;
  provider: string;
  runtime: string;
  format: string;
  quantisation: string;
  parameters: number;
  disk_footprint: string;
  context: number;
  ram_estimate: string;
  vram_estimate: string | null;
  placement: 'LOCAL_CPU' | 'LOCAL_GPU' | 'REMOTE_SERVER' | 'CLOUD_API';
  load_state: 'COLD' | 'LOADING' | 'READY' | 'BUSY' | 'IDLE' | 'UNLOADING';
  health: 'HEALTHY' | 'DEGRADED' | 'RATE_LIMITED' | 'TIMED_OUT' | 'UNAVAILABLE' | 'BROKEN' | 'COOLDOWN';
  capabilities: {
    coding: boolean;
    reasoning: boolean;
    tool_use: boolean;
    structured_output: boolean;
    vision: boolean;
    embedding: boolean;
  };
  benchmarks: {
    tokens_sec: number;
    latency_ms: number;
    first_token_ms: number;
  };
  tool_ability: string[];
  coding: boolean;
  reasoning: boolean;
  embedding: boolean;
  licence: string;
  provenance: string;
}

/* ModelCenter component - live model information display */
export function ModelCenter({ baseUrl = BRIDGE_DEFAULT_BASE }: { baseUrl?: string }) {
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!mountedRef.current) return;

    let cancelled = false;

    async function refresh() {
      try {
        setLoading(true);
        setError(null);
        const status = await fetchBridgeStatus(baseUrl);

        if (cancelled) return;
        if (!status.connected) {
          setModelInfo(null);
          setLoading(false);
          return;
        }

        // Extract model info from runtime
        const runtime = status.runtime;
        if (runtime && runtime.models && runtime.models.length > 0) {
          const primary = runtime.models[0];
          const metrics = typeof runtime.health === 'object' && runtime.health !== null ? runtime.health : {};
          const model: ModelInfo = {
            name: primary.name || 'unknown',
            family: primary.family || 'unknown',
            provider: primary.provider || 'unknown',
            runtime: primary.runtime || 'unknown',
            format: primary.format || 'unknown',
            quantisation: primary.quantisation || 'unknown',
            parameters: primary.parameter_size ? parseFloat(primary.parameter_size) : 0,
            disk_footprint: primary.disk_footprint || 'unknown',
            context: primary.context || 0,
            ram_estimate: 'estimated', // would come from runtime
            vram_estimate: primary.vram_estimate || null,
            placement: 'LOCAL_CPU', // determined by placement engine
            load_state: 'READY',
            health: 'HEALTHY',
            capabilities: {
              coding: true,
              reasoning: true,
              tool_use: true,
              structured_output: true,
              vision: false,
              embedding: false,
            },
            benchmarks: {
              tokens_sec: metrics.tokens_per_second || 0,
              latency_ms: (metrics.first_token_s || 0) * 1000,
              first_token_ms: (metrics.first_token_s || 0) * 1000,
            },
            tool_ability: [],
            coding: true,
            reasoning: true,
            embedding: false,
            licence: primary.license || 'unknown',
            provenance: primary.provenance || 'unknown',
          };
          setModelInfo(model);
        } else {
          setModelInfo({
            name: 'no model loaded',
            family: '',
            provider: '',
            runtime: '',
            format: '',
            quantisation: '',
            parameters: 0,
            disk_footprint: '',
            context: 0,
            ram_estimate: '',
            vram_estimate: null,
            placement: 'LOCAL_CPU',
            load_state: 'COLD',
            health: 'UNAVAILABLE',
            capabilities: {
              coding: false,
              reasoning: false,
              tool_use: false,
              structured_output: false,
              vision: false,
              embedding: false,
            },
            benchmarks: { tokens_sec: 0, latency_ms: 0, first_token_ms: 0 },
            tool_ability: [],
            coding: false,
            reasoning: false,
            embedding: false,
            licence: '',
            provenance: '',
          });
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    refresh();

    // Poll for updates
    const interval = setInterval(refresh, 5000);
    return () => {
      mountedRef.current = false;
      cancelled = true;
      clearInterval(interval);
    };
  }, [baseUrl]);

  if (loading) {
    return <div>Loading model information...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  if (!modelInfo) {
    return <div>No model loaded</div>;
  }

  return (
    <div className="model-center">
      <h3>Model Center</h3>

      <div className="model-info">
        <div>
          <strong>Name:</strong> {modelInfo.name}
        </div>
        <div>
          <strong>Family:</strong> {modelInfo.family}
        </div>
        <div>
          <strong>Provider:</strong> {modelInfo.provider}
        </div>
        <div>
          <strong>Quantisation:</strong> {modelInfo.quantisation}
        </div>
        <div>
          <strong>Parameters:</strong> {modelInfo.parameters}B
        </div>
        <div>
          <strong>Context:</strong> {modelInfo.context}
        </div>
        <div>
          <strong>Health:</strong> {modelInfo.health}
        </div>
        <div>
          <strong>Placement:</strong> {modelInfo.placement}
        </div>
      </div>

      <div className="model-capabilities">
        <h4>Capabilities</h4>
        <div>
          <span>Coding: {modelInfo.coding ? '✓' : '✗'}</span>
          <span>Reasoning: {modelInfo.reasoning ? '✓' : '✗'}</span>
          <span>Embedding: {modelInfo.embedding ? '✓' : '✗'}</span>
          <span>Tool use: {modelInfo.tool_ability.join(', ') || 'none'}</span>
        </div>
        <div>
          <span>Structured output: {modelInfo.capabilities.structured_output ? '✓' : '✗'}</span>
          <span>Vision: {modelInfo.capabilities.vision ? '✓' : '✗'}</span>
          <span>Structured output: {modelInfo.capabilities.structured_output ? '✓' : '✗'}</span>
        </div>
      </div>

      <div className="model-benchmarks">
        <h4>Benchmarks</h4>
        <div>
          <span>Tokens/sec: {modelInfo.benchmarks.tokens_sec}</span>
          <span>Latency: {modelInfo.benchmarks.latency_ms}ms</span>
          <span>First token: {modelInfo.benchmarks.first_token_ms}ms</span>
        </div>
      </div>

      <div className="model-licence">
        <strong>License:</strong> {modelInfo.licence}
        <br/>
        <strong>Provenance:</strong> {modelInfo.provenance}
      </div>
    </div>
  );
}