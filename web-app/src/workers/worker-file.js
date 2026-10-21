import { createFileWorkerCore } from './file-worker-core.js';
import { loadModel } from './load-model.js';

const core = createFileWorkerCore((msg, transfer) => self.postMessage(msg, transfer || []), { loadModel, loadMp3: async () => (await import('./load-mp3.js')).loadMp3() });
self.onmessage = (e) => { core.handle(e.data); };
