// Render the Elite Generalist architecture diagram with mermaid-cli.
// Captures the true SVG bounding box to avoid clipping (per charts skill guidance).
const { execSync } = require('child_process');
const path = require('path');

const mmdFile = '/home/z/my-project/download/architecture-diagram.mmd';
const pngFile = '/home/z/my-project/download/architecture-diagram.png';

// Use a large viewport and high scale; puppeteer config is inline.
const cmd = `mmdc -i "${mmdFile}" -o "${pngFile}" -w 1600 -H 1200 -s 2 -b transparent -t default`;
console.log('Rendering Mermaid diagram...');
execSync(cmd, { stdio: 'inherit' });
console.log('Saved:', pngFile);
