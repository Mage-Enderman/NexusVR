const fs = require('fs');
const path = 'src/App.tsx';
let content = fs.readFileSync(path, 'utf8');

const marker = '    const disposers: Array<() => void> = [];\n';
const insert = `    // Resume the WebAudio context on the first user gesture; browsers
    // suspend it until a user interaction, which would silence peer voice.
    const resumeAudioContext = () => {
      avatarManager.audioListener.context.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', resumeAudioContext, { once: true });
    disposers.push(() => window.removeEventListener('pointerdown', resumeAudioContext));

`;

if (!content.includes(insert.trim())) {
  if (content.includes(marker)) {
    content = content.replace(marker, marker + insert);
    fs.writeFileSync(path, content);
    console.log('Inserted AudioContext resume listener.');
  } else {
    console.error('Marker not found.');
    process.exit(1);
  }
} else {
  console.log('Already inserted.');
}
