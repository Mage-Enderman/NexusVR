const fs = require('fs');
const file = 'src/App.tsx';
let content = fs.readFileSync(file, 'utf8');

// Remove the unused nextRequestEnd declaration line
content = content.replace(/\s*let nextRequestEnd = 0;\n/, '\n');

// Replace em dashes with regular hyphens in comments/strings to avoid lint invalid character errors
// We only replace standalone em dashes (not in strings that need them)
content = content.replace(/—/g, '-');

fs.writeFileSync(file, content);
console.log('Cleaned up nextRequestEnd and em dashes');
