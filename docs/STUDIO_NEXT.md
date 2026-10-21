# ClearVoice Studio: build order (from the new plan)

Done in this drop (`web-app/src/studio/`, 11 tests, strict typecheck): engine catalogue with honest availability labels,
append-only version history (immutable original, failures never delete results, memory budget), job coordinator
(queue, cancel, concurrency by device, output-alignment check), second-pass rules.

Next, in order:
1. Phase 1 evaluation: run all candidates on the same Bangla + English clips; fill docs/BASELINE.md; verify licenses of DeepFilterNet3 and DPDFNet weights.
2. Wrap the existing GTCRN pipeline (src/audio/pipeline.js) as an `EngineAdapter` so the UI runs through the coordinator.
3. Studio UI: drag-drop, waveform, version list, A/B between any two versions, WAV download of the selected one.
4. DeepFilterNet3 adapter (only after a WASM build is verified on your phone and PC).
5. Second-pass UI using checkSecondPass() + comparisonTargets().
6. Release hardening: long files, corrupt files, low memory, CSP, licenses page.
