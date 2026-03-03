/**
 * ============================================================
 *  YAHTZEE ADVISOR — GAME CONTROLLER (Manual Input Edition)
 *
 *  The user enters their real dice. After pressing "Analyze",
 *  the optimizer tells them exactly which dice to KEEP and,
 *  on the final roll, which CATEGORY to score.
 * ============================================================
 */

'use strict';

const Engine = window.YahtzeeEngine;

/* ─────────────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────────────── */
let G = {};

function createState() {
    const scorecard = {};
    for (const c of Engine.ALL_CATEGORIES) scorecard[c] = null;
    return {
        scorecard,
        turn: 0,         // 1–13
        rollPhase: 1,         // 1, 2, or 3
        dice: [0, 0, 0, 0, 0], // 0 = not set, 1–6 = value
        heldIndices: [],        // which dice are locked for next roll
        upperSum: 0,
        analyzed: false,     // has the user pressed Analyze this roll?
        pendingCategory: null,    // category suggested for scoring
        focusedDie: -1,        // for keyboard input
    };
}

/* ─────────────────────────────────────────────────────────────
   INIT
───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    G = createState();
    renderScorecard();
    renderDice();
    setRollIndicator(1);
    updateHeader();
    setupKeyboard();
    initDBBanner();
});

/* ─────────────────────────────────────────────────────────────
   DATABASE BANNER
───────────────────────────────────────────────────────────── */
async function initDBBanner() {
    setDBStatus('checking', 'Loading database file…');
    const meta = await YahtzeeDB.init();
    if (meta) {
        const kb = (meta.fileSizeBytes / 1024).toFixed(0);
        setDBStatus('ready', `⚡ DB loaded — ${(meta.entries / 1e6).toFixed(1)}M states (${kb} KB)`);
        setDBCount('O(1) lookup active', true);
        document.getElementById('db-build-btn').style.display = 'none';
        document.getElementById('db-export-btn').style.display = 'none';
    } else {
        const err = YahtzeeDB.loadError || 'file not found';
        setDBStatus('not-built', `⚠ DB not ready — ${err}`);
        setDBCount('Run: node generate_db.js');
        document.getElementById('db-build-btn').style.display = 'none';
        document.getElementById('db-export-btn').style.display = 'none';
    }
    // Hide import for file-based DB
    const imp = document.getElementById('db-import-label');
    if (imp) imp.style.display = 'none';
}

function setDBStatus(state, text) {
    document.getElementById('db-dot').className = 'db-status-dot ' + state;
    document.getElementById('db-status-text').textContent = text;
}

function setDBCount(text, ready = false) {
    const el = document.getElementById('db-entry-count');
    el.textContent = text;
    el.className = 'db-entry-count' + (ready ? ' ready' : '');
}

/* Stubs kept so the HTML onclick attributes don't error */
window.startBuildDatabase = () => { };
window.importDBFile = () => { };

/* ─────────────────────────────────────────────────────────────
   KEYBOARD INPUT
───────────────────────────────────────────────────────────── */
function setupKeyboard() {
    document.addEventListener('keydown', e => {
        const key = parseInt(e.key);
        if (key >= 1 && key <= 6) {
            const fi = G.focusedDie;
            if (fi >= 0 && fi <= 4) {
                setDieValue(fi, key);
            }
        }
        if (e.key === 'Tab') {
            e.preventDefault();
            const next = (G.focusedDie + 1) % 5;
            focusDie(next);
        }
        if (e.key === 'Enter' && !document.getElementById('analyze-btn').disabled) {
            analyze();
        }
    });
}

function focusDie(index) {
    // Remove previous focus
    if (G.focusedDie >= 0) {
        document.getElementById(`die-${G.focusedDie}`)?.classList.remove('focused');
    }
    G.focusedDie = index;
    const el = document.getElementById(`die-${index}`);
    if (el) {
        el.classList.add('focused');
        el.focus({ preventScroll: true });
    }
}

/* ─────────────────────────────────────────────────────────────
   DIE INPUT
───────────────────────────────────────────────────────────── */
function setDieValue(index, value) {
    // Locked dice cannot be changed
    if (G.rollPhase > 1 && G.heldIndices.includes(index)) return;

    G.dice[index] = value;
    G.analyzed = false;
    renderDiceIndex(index);
    checkAnalyzeReady();
}

window.cycleDie = function (index) {
    if (G.rollPhase > 1 && G.heldIndices.includes(index)) {
        showToast('This die is locked for keeping!');
        return;
    }
    const cur = G.dice[index];
    const next = cur >= 6 ? 1 : cur + 1;
    setDieValue(index, next);
    focusDie(index);
    G.analyzed = false;
    hideAdvice();
    checkAnalyzeReady();
};

window.adjustDie = function (index, delta) {
    if (G.rollPhase > 1 && G.heldIndices.includes(index)) return;
    const cur = G.dice[index];
    let next = cur + delta;
    if (next < 1) next = 6;
    if (next > 6) next = 1;
    setDieValue(index, next);
    G.analyzed = false;
    hideAdvice();
    checkAnalyzeReady();
};

function checkAnalyzeReady() {
    const allSet = G.dice.every(d => d >= 1 && d <= 6);
    document.getElementById('analyze-btn').disabled = !allSet;
}

/* ─────────────────────────────────────────────────────────────
   ANALYZE
───────────────────────────────────────────────────────────── */
window.analyze = function () {
    const allSet = G.dice.every(d => d >= 1 && d <= 6);
    if (!allSet) { showToast('Set all 5 dice first!'); return; }

    G.turn = Math.max(G.turn, 1);
    G.analyzed = true;

    const available = getAvailable();
    const rollsLeft = 3 - G.rollPhase;

    // ── Try DB lookup first (O(1)) ──────────────────────────
    let decision = null;
    const dbResult = YahtzeeDB.lookup(G.dice, available, rollsLeft);
    if (dbResult) {
        decision = dbResult;
        decision._fromDB = true;
    } else {
        // Fallback: live EV optimizer
        decision = Engine.optimizerEngine(G.dice, available, rollsLeft, G.upperSum);
        decision._fromDB = false;
    }

    if (decision.action === 'keep' && rollsLeft > 0) {
        showKeepAdvice(decision);
    } else {
        showScoreAdvice(available, decision);
    }

    updateHeader();
};

function showKeepAdvice(decision) {
    const keepIdx = decision.keepIndices;
    const keepDice = decision.keepDice;
    const rerollCnt = decision.rerollCount;

    // Highlight dice
    G.heldIndices = keepIdx; // visually mark but not locked until "Next Roll"
    renderAllDice(keepIdx);

    const badge = document.getElementById('advice-badge');
    badge.textContent = 'KEEP ADVICE';
    badge.className = 'advice-badge keep';

    let headline, detail;

    if (rerollCnt === 0) {
        headline = '✅ Keep all 5 dice — stop rolling!';
        detail = `The current hand is already optimal. Score now.`;
    } else if (keepIdx.length === 0) {
        headline = `♻️ Reroll all 5 dice`;
        detail = `None of your current dice are worth keeping.`;
    } else {
        const vals = keepDice.join(', ');
        headline = `🔒 Keep <strong>[${vals}]</strong> — reroll ${rerollCnt} ${rerollCnt === 1 ? 'die' : 'dice'}`;
        detail = `Dice at positions ${keepIdx.map(i => i + 1).join(', ')} give the highest EV.`;
    }

    const srcTag = decision._fromDB
        ? '<span class="ev-chip" style="background:rgba(52,211,153,0.15);border-color:rgba(52,211,153,0.3);color:#34d399">⚡ DB lookup</span>'
        : `<span class="ev-chip">EV: ${(decision.ev ?? 0).toFixed(2)}</span>`;

    document.getElementById('advice-body').innerHTML = `
        <div class="advice-main">
            <div class="advice-headline">${headline}</div>
            <div class="advice-detail">${detail}</div>
            ${srcTag}
        </div>
    `;

    // Show/hide scoring options
    document.getElementById('scoring-section').style.display = 'none';

    // Show "Next Roll" button
    const nextBtn = document.getElementById('next-btn');
    if (G.rollPhase < 3) {
        nextBtn.style.display = '';
        nextBtn.querySelector('.btn-icon').textContent = '⏭';
        document.getElementById('next-btn-text').textContent =
            rerollCnt === 0 ? 'Score Now' : `I've rerolled — Roll ${G.rollPhase + 1}`;
    } else {
        nextBtn.style.display = 'none';
    }

    G.pendingCategory = null;
}

function showScoreAdvice(available, preDecision) {
    // Use pre-computed decision if provided (from DB or live pass-through),
    // otherwise compute now (fallback for edge-case calls).
    let decision = preDecision;
    if (!decision || decision.action !== 'score') {
        const dbr = YahtzeeDB.lookup(G.dice, available, 0);
        decision = dbr || Engine.optimizerEngine(G.dice, available, 0, G.upperSum);
        decision._fromDB = !!dbr;
    }
    const bestCat = decision.category;
    const bestScore = Engine.scoreFor(bestCat, G.dice);

    G.heldIndices = [0, 1, 2, 3, 4];
    G.pendingCategory = bestCat;
    renderAllDice([0, 1, 2, 3, 4]);

    const badge = document.getElementById('advice-badge');
    badge.textContent = 'SCORE NOW';
    badge.className = 'advice-badge score';

    const srcTag = decision._fromDB
        ? '<span class="ev-chip" style="background:rgba(52,211,153,0.15);border-color:rgba(52,211,153,0.3);color:#34d399">⚡ DB lookup</span>'
        : `<span class="ev-chip">EV: ${(decision.ev ?? 0).toFixed(2)}</span>`;

    document.getElementById('advice-body').innerHTML = `
        <div class="advice-main">
            <div class="advice-headline">✨ Score <strong>${formatCat(bestCat)}</strong></div>
            <div class="advice-detail">This is your highest-EV category for this hand.</div>
            <div style="margin-top:10px"><span class="advice-score-pill">+${bestScore} pts</span></div>
            ${srcTag}
        </div>
    `;

    highlightSuggestedRow(bestCat);
    renderScoringOptions(available, bestCat);
    document.getElementById('scoring-section').style.display = '';

    const nextBtn = document.getElementById('next-btn');
    nextBtn.style.display = '';
    nextBtn.querySelector('.btn-icon').textContent = '✅';
    document.getElementById('next-btn-text').textContent = `Score ${formatCat(bestCat)}`;
}

/* ─────────────────────────────────────────────────────────────
   SCORING OPTIONS LIST
───────────────────────────────────────────────────────────── */
function renderScoringOptions(available, bestCat) {
    const container = document.getElementById('scoring-options');
    container.innerHTML = '';

    // Build sorted list: best first, then descending score
    const options = available.map(cat => ({
        cat,
        score: Engine.scoreFor(cat, G.dice),
    })).sort((a, b) => b.score - a.score);

    for (const { cat, score } of options) {
        const div = document.createElement('div');
        div.className = 'score-option' +
            (cat === bestCat ? ' best-option' : '') +
            (score === 0 ? ' zero-option' : '');
        div.innerHTML = `
            <span class="score-option-name">${formatCat(cat)}</span>
            ${cat === bestCat ? '<span class="best-tag">BEST</span>' : ''}
            <span class="score-option-pts">${score}</span>
        `;
        div.onclick = () => scoreCategory(cat);
        container.appendChild(div);
    }
}

/* ─────────────────────────────────────────────────────────────
   NEXT PHASE
───────────────────────────────────────────────────────────── */
window.nextPhase = function () {
    if (!G.analyzed) {
        showToast('Press Analyze first!');
        return;
    }

    if (G.pendingCategory) {
        // We're in score mode — score the suggested category
        scoreCategory(G.pendingCategory);
    } else {
        // Advance to next roll
        G.rollPhase++;
        G.analyzed = false;

        // Lock held dice — clear non-held dice
        const newDice = [...G.dice];
        for (let i = 0; i < 5; i++) {
            if (!G.heldIndices.includes(i)) {
                newDice[i] = 0; // Clear for user to enter new value
            }
        }
        G.dice = newDice;

        setRollIndicator(G.rollPhase);
        renderAllDice(G.heldIndices);
        hideAdvice();
        checkAnalyzeReady();

        document.getElementById('next-btn').style.display = 'none';
        document.getElementById('scoring-section').style.display = 'none';

        if (G.heldIndices.length === 5) {
            // Kept all — go straight to scoring
            analyze();
        }
    }
};

/* ─────────────────────────────────────────────────────────────
   SCORING
───────────────────────────────────────────────────────────── */
function scoreCategory(cat) {
    if (G.scorecard[cat] !== null) {
        showToast('That category is already scored!');
        return;
    }

    const score = Engine.scoreFor(cat, G.dice);
    G.scorecard[cat] = score;

    if (Engine.UPPER_CATEGORIES.has(cat)) {
        G.upperSum += score;
    }

    // Flash
    flashScoreRow(cat, score);
    clearSuggestedRow();
    document.getElementById('scoring-section').style.display = 'none';

    showToast(`✨ ${formatCat(cat)}: +${score} pts`);

    if (score === 50) setTimeout(() => showToast('🎉 YAHTZEE!!'), 700);

    renderScorecard();
    updateHeader();

    // Check game over
    if (G.turn >= 13) {
        setTimeout(endGame, 700);
        return;
    }

    // Start next turn
    setTimeout(() => startNextTurn(), 600);
}

// Allow clicking scorecard rows to score manually
window.manualScore = function (cat) {
    if (G.scorecard[cat] !== null) return; // already scored
    if (!G.analyzed) {
        showToast('Analyze your dice first!');
        return;
    }

    // Confirm with user
    const score = Engine.scoreFor(cat, G.dice);
    const msg = `Score ${formatCat(cat)} for ${score} pts?`;
    if (confirm(msg)) {
        scoreCategory(cat);
    }
};

function startNextTurn() {
    G.rollPhase = 1;
    G.turn++;
    G.dice = [0, 0, 0, 0, 0];
    G.heldIndices = [];
    G.analyzed = false;
    G.pendingCategory = null;
    G.focusedDie = -1;

    clearSuggestedRow();
    setRollIndicator(1);
    renderAllDice([]);
    hideAdvice();

    document.getElementById('next-btn').style.display = 'none';
    document.getElementById('scoring-section').style.display = 'none';
    document.getElementById('analyze-btn').disabled = true;

    updateHeader();
}

window.resetTurn = function () {
    G.dice = [0, 0, 0, 0, 0];
    G.analyzed = false;
    G.pendingCategory = null;

    if (G.rollPhase === 1) {
        G.heldIndices = [];
    }

    clearSuggestedRow();
    renderAllDice(G.heldIndices);
    hideAdvice();
    checkAnalyzeReady();
    document.getElementById('next-btn').style.display = 'none';
    document.getElementById('scoring-section').style.display = 'none';
};

/* ─────────────────────────────────────────────────────────────
   NEW GAME
───────────────────────────────────────────────────────────── */
window.newGame = function () {
    document.getElementById('game-over-modal').classList.remove('visible');
    G = createState();
    renderScorecard();
    renderAllDice([]);
    setRollIndicator(1);
    hideAdvice();
    updateHeader();
    document.getElementById('next-btn').style.display = 'none';
    document.getElementById('scoring-section').style.display = 'none';
    document.getElementById('analyze-btn').disabled = true;
    clearSuggestedRow();
};

/* ─────────────────────────────────────────────────────────────
   END GAME
───────────────────────────────────────────────────────────── */
function endGame() {
    const upper = computeUpperTotal();
    const lower = computeLowerTotal();
    const bonus = upper >= 63 ? 35 : 0;
    const grand = upper + bonus + lower;

    renderScorecard();

    document.getElementById('final-score-value').textContent = grand;

    const stats = document.getElementById('modal-stats');
    const rating = getScoreRating(grand);
    stats.innerHTML = `
        <div class="modal-stat-line"><span>Upper Section</span><strong>${upper}</strong></div>
        <div class="modal-stat-line"><span>Upper Bonus</span><strong>${bonus > 0 ? '+35 ✅' : '0 ❌'}</strong></div>
        <div class="modal-stat-line"><span>Lower Section</span><strong>${lower}</strong></div>
        <div class="modal-stat-line" style="border-top:1px solid rgba(255,255,255,0.08);padding-top:6px;margin-top:2px">
            <span>Grand Total</span><strong style="color:var(--accent-gold)">${grand}</strong>
        </div>
        <div class="modal-stat-line" style="margin-top:4px;font-size:0.76rem">
            <span>Rating</span><strong>${rating}</strong>
        </div>
    `;

    document.getElementById('game-over-modal').classList.add('visible');
}

function getScoreRating(s) {
    if (s >= 400) return '🌟 Exceptional';
    if (s >= 350) return '🏆 Excellent';
    if (s >= 300) return '✅ Great';
    if (s >= 250) return '👍 Good';
    if (s >= 200) return '📈 Average';
    return '📊 Below Average';
}

/* ─────────────────────────────────────────────────────────────
   SCORING MATH
───────────────────────────────────────────────────────────── */
function getAvailable() {
    return Engine.ALL_CATEGORIES.filter(c => G.scorecard[c] === null);
}

function computeUpperTotal() {
    return [...Engine.UPPER_CATEGORIES].reduce((s, c) => s + (G.scorecard[c] ?? 0), 0);
}

function computeLowerTotal() {
    return Engine.ALL_CATEGORIES
        .filter(c => !Engine.UPPER_CATEGORIES.has(c))
        .reduce((s, c) => s + (G.scorecard[c] ?? 0), 0);
}

function computeGrand() {
    const u = computeUpperTotal();
    const l = computeLowerTotal();
    return u + (u >= 63 ? 50 : 0) + l;
}

/* ─────────────────────────────────────────────────────────────
   UI — DICE
───────────────────────────────────────────────────────────── */
// SVG pip layouts for each die value [cx, cy] in a 60x60 grid
const DIE_PIPS = {
    1: [[30, 30]],
    2: [[18, 18], [42, 42]],
    3: [[18, 18], [30, 30], [42, 42]],
    4: [[18, 18], [42, 18], [18, 42], [42, 42]],
    5: [[18, 18], [42, 18], [30, 30], [18, 42], [42, 42]],
    6: [[18, 14], [42, 14], [18, 30], [42, 30], [18, 46], [42, 46]],
};

function makeDieSVG(val, held) {
    if (!val || val < 1 || val > 6) {
        return `<svg viewBox="0 0 60 60" width="54" height="54" xmlns="http://www.w3.org/2000/svg">
            <text x="30" y="38" text-anchor="middle" font-size="22" fill="rgba(255,255,255,0.25)" font-family="Inter,sans-serif" font-weight="700">?</text>
        </svg>`;
    }
    const pipColor = held ? '#34d399' : '#f0f2ff';
    const pips = DIE_PIPS[val]
        .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="5.5" fill="${pipColor}"/>`)
        .join('');
    return `<svg viewBox="0 0 60 60" width="54" height="54" xmlns="http://www.w3.org/2000/svg">${pips}</svg>`;
}

function renderDice() {
    for (let i = 0; i < 5; i++) renderDiceIndex(i);
}

function renderDiceIndex(i) {
    const btn = document.getElementById(`die-${i}`);
    const face = document.getElementById(`face-${i}`);
    const valLabel = document.getElementById(`val-label-${i}`);
    const val = G.dice[i];
    const held = G.heldIndices.includes(i);
    const locked = G.rollPhase > 1 && held;

    btn.setAttribute('data-value', val);
    btn.setAttribute('data-held', held ? 'true' : 'false');

    face.innerHTML = makeDieSVG(val, held);
    valLabel.textContent = val >= 1 ? val : '—';

    btn.style.cursor = locked ? 'not-allowed' : 'pointer';
}

function renderAllDice(heldIndices) {
    G.heldIndices = heldIndices || [];
    renderDice();
}

/* ─────────────────────────────────────────────────────────────
   UI — SCORECARD
───────────────────────────────────────────────────────────── */
function renderScorecard() {
    const upper = computeUpperTotal();
    const lower = computeLowerTotal();
    const bonus = upper >= 63 ? 35 : 0;
    const grand = upper + bonus + lower;

    for (const cat of Engine.ALL_CATEGORIES) {
        const scoreEl = document.getElementById(`score-${cat}`);
        const rowEl = document.getElementById(`row-${cat}`);
        if (!scoreEl || !rowEl) continue;

        const val = G.scorecard[cat];
        if (val === null) {
            scoreEl.textContent = '—';
            scoreEl.style.color = '';
            rowEl.classList.remove('scored-row', 'zero-row');
        } else {
            scoreEl.textContent = val;
            rowEl.classList.remove('active-row');
            if (val > 0) { rowEl.classList.add('scored-row'); rowEl.classList.remove('zero-row'); }
            else { rowEl.classList.add('zero-row'); rowEl.classList.remove('scored-row'); }
        }
    }

    // Upper bonus
    const bonusEl = document.getElementById('score-upper-bonus');
    bonusEl.textContent = bonus > 0 ? '+35' : '—';
    bonusEl.style.color = bonus > 0 ? 'var(--accent-gold)' : '';

    document.getElementById('score-upper-total').textContent = upper + bonus;
    document.getElementById('score-lower-total').textContent = lower;
    document.getElementById('score-grand-total').textContent = grand;
    document.getElementById('total-score').textContent = grand;

    // Bonus tracker
    const tracker = document.getElementById('bonus-tracker');
    if (upper >= 63) {
        tracker.textContent = '✅ Bonus!';
        tracker.style.color = 'var(--accent-green)';
    } else {
        tracker.textContent = `${upper} / 63`;
        tracker.style.color = '';
    }
}

function highlightSuggestedRow(cat) {
    clearSuggestedRow();
    const row = document.getElementById(`row-${cat}`);
    if (row) row.classList.add('suggested-row');
}

function clearSuggestedRow() {
    document.querySelectorAll('.suggested-row').forEach(el => el.classList.remove('suggested-row'));
}

function flashScoreRow(cat, score) {
    const el = document.getElementById(`score-${cat}`);
    if (!el) return;
    el.textContent = score;
    el.classList.add('just-scored');
    setTimeout(() => el.classList.remove('just-scored'), 700);
}

/* ─────────────────────────────────────────────────────────────
   UI — ROLL INDICATOR
───────────────────────────────────────────────────────────── */
function setRollIndicator(phase) {
    for (let i = 0; i < 3; i++) {
        const pip = document.getElementById(`pip-${i}`);
        if (i < phase - 1) pip.className = 'pip done';
        else if (i === phase - 1) pip.className = 'pip active';
        else pip.className = 'pip';
    }

    const labels = {
        1: `Roll 1 of 3 — Enter your dice`,
        2: `Roll 2 of 3 — Enter new dice`,
        3: `Roll 3 of 3 — Final roll, must score`,
    };
    document.getElementById('roll-label').textContent = labels[phase] || '';
}

/* ─────────────────────────────────────────────────────────────
   UI — ADVICE
───────────────────────────────────────────────────────────── */
function hideAdvice() {
    document.getElementById('advice-body').innerHTML =
        '<p class="advice-placeholder">Enter all 5 dice values, then press <strong>Analyze</strong>.</p>';
    const badge = document.getElementById('advice-badge');
    badge.textContent = 'Waiting…';
    badge.className = 'advice-badge';
}

/* ─────────────────────────────────────────────────────────────
   UI — HEADER
───────────────────────────────────────────────────────────── */
function updateHeader() {
    const turn = G.scorecard
        ? Engine.ALL_CATEGORIES.filter(c => G.scorecard[c] !== null).length
        : 0;
    document.getElementById('turn-number').textContent = `${turn} / 13`;
    document.getElementById('total-score').textContent = computeGrand();
}

/* ─────────────────────────────────────────────────────────────
   UI — TOAST
───────────────────────────────────────────────────────────── */
let toastTimer = null;

function showToast(msg) {
    const t = document.getElementById('score-toast');
    t.innerHTML = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────── */
function formatCat(cat) {
    const n = {
        'aces': 'Aces', 'twos': 'Twos', 'threes': 'Threes', 'fours': 'Fours',
        'fives': 'Fives', 'sixes': 'Sixes', 'three-of-a-kind': '3 of a Kind',
        'four-of-a-kind': '4 of a Kind', 'full-house': 'Full House',
        'small-straight': 'Small Straight', 'large-straight': 'Large Straight',
        'yahtzee': 'Yahtzee', 'chance': 'Chance',
    };
    return n[cat] || cat;
}
