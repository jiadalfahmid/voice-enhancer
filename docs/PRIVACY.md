# Privacy Policy: ClearVoice Studio

**Effective Date:** October 21, 2026  
**Contact:** privacy@clearvoice.studio

**In short:** Your audio never leaves your device. We do not have accounts, ads, trackers, or analytics.

---

### 1. Your Audio
When you choose a file, your browser decodes it locally and the AI speech enhancement models run directly on your device (in your browser, using WebAssembly and Web Workers). The original file, the processed audio, and every version you create exist solely in your device's memory. They are not uploaded, stored on any server, or shared with anyone. When you close or reload the page, all in-memory audio is discarded, unless you explicitly downloaded it to your device. The application's Content Security Policy (`connect-src 'self'`) strictly blocks the browser from transmitting data to external servers or domains.

---

### 2. What We Collect
Nothing about you or your audio. We do not ask for your name, email, account, or location.

---

### 3. What the Hosting Provider Sees
ClearVoice Studio is delivered as static files via static web hosting (e.g., Cloudflare Pages). Like any website host, the infrastructure may log standard technical HTTP request data (such as IP address, user-agent, and requested file paths) for security and network delivery. That data never includes your audio content.

---

### 4. Data Kept in Your Browser
- **Model Binaries:** Model weight files are downloaded from this site the first time you invoke a model and are cached by your browser's HTTP cache so subsequent runs load instantly. You can clear them at any time by clearing your browser cache.
- **Cookies & Storage:** We do not use cookies, localStorage, indexedDB, or tracking pixels. No user data is stored on your device.

---

### 5. Third Parties
No third-party scripts, external fonts, analytics engines, ad networks, or social trackers are loaded or contacted.

---

### 6. Models and Licenses
Speech enhancement runs locally with open-source models:
- GTCRN (MIT)
- DeepFilterNet3 (MIT or Apache-2.0)
- DPDFNet 16 kHz and 48 kHz (Apache-2.0)
- ONNX Runtime Web (MIT)
- MP3 export uses lamejs (LGPL-3.0)

For full licenses and copyright notices, see [/THIRD-PARTY-NOTICES.txt](/THIRD-PARTY-NOTICES.txt) and [/licenses/](/licenses/).

---

### 7. Children
ClearVoice Studio does not collect personal information from any user, including children.

---

### 8. Changes to This Policy
If this policy changes, the effective date at the top will be updated.

---

### 9. Contact
For any questions regarding privacy, please contact: `privacy@clearvoice.studio`.
