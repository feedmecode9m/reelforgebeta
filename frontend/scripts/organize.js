const fs = require('fs');
const path = require('path');

console.log('🎬 Organizing ReelForge project structure...');

const srcDir = path.join(__dirname, '../src');
const componentsDir = path.join(srcDir, 'components');

// Ensure directories exist
const dirs = [
  componentsDir,
  path.join(componentsDir, 'stages'),
  path.join(componentsDir, 'education'),
  path.join(componentsDir, 'ui'),
  path.join(componentsDir, 'utils'),
  path.join(srcDir, 'stores'),
  path.join(srcDir, 'types'),
  path.join(srcDir, 'assets')
];

dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created: ${dir}`);
  }
});

console.log('✅ Project structure organized!');
console.log('\nRecommended file placement:');
console.log('1. Reusable UI components → src/components/ui/');
console.log('2. Stage components → src/components/stages/');
console.log('3. Educational components → src/components/education/');
console.log('4. Utility functions → src/components/utils/');
console.log('5. State management → src/stores/');
console.log('6. Type definitions → src/types/');
console.log('7. Images/fonts → src/assets/');
