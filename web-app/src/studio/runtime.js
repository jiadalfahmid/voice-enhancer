// Builds the engines the app can actually run. To add a model: create its adapter, add it here, and flip its
// availability to 'browser-ready' in engines.ts (see docs/MODEL_INTEGRATION.md).
import { createFileJob } from '../audio/file-client.js';
import { ENGINE_CATALOG } from './engines.ts';
import { createPipelineEngine } from './pipeline-engine.js';

export function buildEngines() {
  const engines = new Map();
  for (const info of ENGINE_CATALOG) {
    if (info.availability === 'browser-ready') {
      engines.set(info.id, createPipelineEngine({ info, modelId: info.id, job: createFileJob() }));
    }
  }
  return engines;
}
