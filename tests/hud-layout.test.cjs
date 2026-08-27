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

const analyticsMarker = '/* Shared BR economy analytics */';
const analyticsStart = html.indexOf(analyticsMarker);
const analyticsEnd = html.indexOf('/* Public games list */', analyticsStart);
assert.ok(analyticsStart > 0 && analyticsEnd > analyticsStart, 'Analytics screen styles should exist');
const analyticsCss = html.slice(analyticsStart, analyticsEnd);
assert.match(analyticsCss, /\.economy-trigger[\s\S]*top:\s*19px[\s\S]*right:\s*22px/);
assert.match(analyticsCss, /\.economy-panel[\s\S]*inset:\s*0[\s\S]*overflow:\s*hidden/);
assert.match(analyticsCss, /\.economy-body[\s\S]*overflow-y:\s*auto/);
assert.match(analyticsCss, /\.economy-summary[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
assert.ok(html.includes('id="economyPanel"'), 'Analytics screen should be mounted inside the lobby');
assert.ok(html.includes('id="economyTrigger"'), 'Lobby should expose the analytics shortcut');

const achievementMarker = '/* Weekly achievements */';
const achievementStart = html.indexOf(achievementMarker);
const achievementEnd = html.indexOf('/* Shared BR economy analytics */', achievementStart);
assert.ok(achievementStart > 0 && achievementEnd > achievementStart, 'Achievement screen styles should exist');
const achievementCss = html.slice(achievementStart, achievementEnd);
assert.match(achievementCss, /\.achievement-panel[\s\S]*inset:\s*0[\s\S]*overflow:\s*hidden/);
assert.match(achievementCss, /\.achievement-body[\s\S]*overflow-y:\s*auto/);
assert.match(achievementCss, /\.achievement-grid[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
assert.match(achievementCss, /\.achievement-card\.complete \.achievement-stamp[\s\S]*opacity:\s*0\.94/);
assert.ok(html.includes('id="achievementPanel"'), 'Achievement screen should be mounted inside the lobby');
assert.ok(html.includes('id="achievementTrigger"'), 'Daily goal should expose the achievement shortcut');

const loginMarker = '/* Persistent prototype identity */';
const loginStart = html.indexOf(loginMarker);
const loginEnd = html.indexOf('/* Pattern background', loginStart);
assert.ok(loginStart > 0 && loginEnd > loginStart, 'Persistent profile styles should exist');
const loginCss = html.slice(loginStart, loginEnd);
assert.match(loginCss, /\.login-screen[\s\S]*position:\s*absolute[\s\S]*inset:\s*0/);
assert.match(loginCss, /\.room-tools-account[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
assert.ok(html.includes('id="loginScreen"'), 'Scopely login should be mounted inside the phone');
assert.ok(html.includes('id="roomToolsAccountEmail"'), 'Room tools should show the active profile');
assert.ok(html.includes('id="resetEconomyButton"'), 'Admin should expose the economy reset control');

assert.match(
  html,
  /\.lobby:not\(\.hidden\) \.lobby-daily-preview::after\s*\{[\s\S]*?animation:\s*daily-preview-shine 1\.75s ease-in-out infinite/,
  'Daily preview shine should loop only while the lobby is visible',
);
assert.match(html, /@keyframes daily-preview-shine/, 'Daily preview shine keyframes should exist');

const openDivs = (html.match(/<div\b/g) || []).length;
const closeDivs = (html.match(/<\/div>/g) || []).length;
assert.equal(openDivs, closeDivs, 'HTML div structure should remain balanced');

console.log(
  `hudLayout=ok playerCard=${playerCardWidth}px scorePlate=${scorePlateWidth}px timerMin=${timerWidthWithMaxWallet}px`,
);
