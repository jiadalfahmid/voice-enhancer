// Kept in its own file on purpose: the bundler only touches '@breezystack/lamejs' when this module is
// actually requested (an MP3 export), so a missing package disables MP3 export instead of breaking the app.
export async function loadMp3() {
  return (await import('@breezystack/lamejs')).Mp3Encoder;
}
