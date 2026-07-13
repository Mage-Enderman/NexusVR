const fs = require('fs');
const path = 'src/App.tsx';
let content = fs.readFileSync(path, 'utf8');

const marker = 'const disposers: Array<() => void> = [];';
const idx = content.indexOf(marker);
if (idx === -1) {
  console.error('Marker not found.');
  process.exit(1);
}
const insertAfter = idx + marker.length;
const insertText = `\n    // Resume the WebAudio context on the first user gesture; browsers
    // suspend it until a user interaction, which would silence peer voice.
    const resumeAudioContext = () => {
      avatarManager.audioListener.context.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', resumeAudioContext, { once: true });
    disposers.push(() => window.removeEventListener('pointerdown', resumeAudioContext));`;

if (content.includes('resumeAudioContext')) {
  console.log('Already inserted.');
} else {
  content = content.slice(0, insertAfter) + insertText + content.slice(insertAfter);
  fs.writeFileSync(path, content);
  console.log('Inserted AudioContext resume listener.');
}
