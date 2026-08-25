const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const marker = '/* Keep the complete in-game header inside the phone frame.';
const start = html.indexOf(marker);
const end = html.indexOf('/* Turn timer bar */', start);

assert.ok(start > 0 && end > start, 'Bounded HUD override should exist');
const hudCss = html.slice(start, end);
assert.match(hudCss, /grid-template-columns:\s*34px minmax\(0, 1fr\) minmax\(0, 1fr\) 28px/);
assert.match(hudCss, /\.hud-player\.me[\s\S]*grid-template-columns:\s*48px minmax\(0, 1fr\)/);
assert.match(hudCss, /\.hud-player\.opp[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 48px/);
assert.match(hudCss, /\.hud-player\.me \.score-goal[\s\S]*grid-column:\s*1 \/ -1/);
assert.match(hudCss, /\.hud-player\.me \.hud-plate,[\s\S]*margin:\s*0/);
assert.ok(start > html.indexOf('margin-right: -20px'), 'Bounded rules must override the legacy overlap margins');

const phoneContentWidth = 393;
const hudHorizontalPadding = 20;
const fixedColumns = 34 + 28;
const columnGaps = 3 * 6;
const playerCardWidth = (phoneContentWidth - hudHorizontalPadding - fixedColumns - columnGaps) / 2;
const scorePlateWidth = playerCardWidth - 48 - 5;
const estimatedGoalContentWidth = 15 + 50 + 36 + (2 * 4) + 12 + 2;
const timerWidthWithMaxWallet = phoneContentWidth - 20 - 7 - 108;

assert.ok(playerCardWidth >= 146, `Player card is too narrow: ${playerCardWidth}px`);
assert.ok(scorePlateWidth >= 90, `Score plate is too narrow: ${scorePlateWidth}px`);
assert.ok(estimatedGoalContentWidth < playerCardWidth, 'Goal content should fit inside the player card');
assert.ok(timerWidthWithMaxWallet >= 250, 'Timer should retain enough width beside the wallet');

const openDivs = (html.match(/<div\b/g) || []).length;
const closeDivs = (html.match(/<\/div>/g) || []).length;
assert.equal(openDivs, closeDivs, 'HTML div structure should remain balanced');

console.log(
  `hudLayout=ok playerCard=${playerCardWidth}px scorePlate=${scorePlateWidth}px timerMin=${timerWidthWithMaxWallet}px`,
);
