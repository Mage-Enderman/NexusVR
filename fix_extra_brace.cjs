const fs = require('fs');
const file = 'src/App.tsx';
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

// Line 199 (1-indexed) is index 198
if (lines[198].trim() === '}' && lines[197].trim() === '}') {
  lines.splice(198, 1);
  fs.writeFileSync(file, lines.join('\n'));
  console.log('Removed extra brace at line 199');
} else {
  console.log('Could not find extra brace. Lines 197-199:');
  for (let i = 196; i <= 199; i++) {
    console.log((i + 1) + ': ' + JSON.stringify(lines[i]));
  }
}
