/**
 * generate_db.js  (v4 — True Bellman Equation DP)
 * ==================================================================
 * Run once with:  node generate_db.js
 *
 * Implements mathematically perfect Expected Value (Bellman Equation):
 *   EV(State, Cat) = Score(Dice, Cat) + EV_NewTurn(Remaining Cats)
 *   EV_NewTurn(C) = sum_{R} [ Prob(R) * EV_Roll2(R, C) ]
 *
 * File format (binary, little-endian):
 *   bytes  0– 7  : ASCII magic "YTZDB004"
 *   bytes  8–11  : uint32 N_DICE = 252
 *   bytes 12–15  : uint32 N_CATS = 32768
 *   bytes 16–?   : RL0  [252*32768] best catIdx  (rollsLeft=0)
 *   bytes  ?– ?  : RL1  [252*32768] best subsetIdx (rollsLeft=1)
 *   bytes  ?–end : RL2  [252*32768] best subsetIdx (rollsLeft=2)
 * Total ≈ 24.8 MB.
 */

'use strict';
const fs = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, 'yahtzee_perfect.ydb');
const MAGIC = 'YTZDB004';
const N_CATS = 32768;

const CAT_LIST = [
    'aces', 'twos', 'threes', 'fours', 'fives', 'sixes',
    'pair', 'two-pairs', 'three-of-a-kind', 'four-of-a-kind', 'full-house',
    'small-straight', 'large-straight', 'yahtzee', 'chance'
];

// ── DICE COMBOS ───────────────────────────────────────────────
const DICE_COMBOS = [];
const DICE_TO_IDX = {};
(function () {
    (function rec(r, minV, cur) {
        if (!r) { DICE_TO_IDX[cur.join('')] = DICE_COMBOS.length; DICE_COMBOS.push([...cur]); return; }
        for (let v = minV; v <= 6; v++) { cur.push(v); rec(r - 1, v, cur); cur.pop(); }
    })(5, 1, []);
})();
const N_DICE = DICE_COMBOS.length;

// ── UNIQUE MULTISET SUBSETS ───────────────────────────────────
const DICE_SUBSETS = DICE_COMBOS.map(dice => {
    const r = [[]];
    (function rec(s, cur) {
        for (let i = s; i < 5; i++) {
            if (i > s && dice[i] === dice[i - 1]) continue;
            cur.push(dice[i]); r.push([...cur]); rec(i + 1, cur); cur.pop();
        }
    })(0, []);
    return r;
});

// ── SORTED REROLL OUTCOMES ────────────────────────────────────
const FACT = [1, 1, 2, 6, 24, 120];
const OUTCOMES = (() => {
    const t = {};
    for (let k = 0; k <= 5; k++) {
        t[k] = k === 0 ? [{ d: [], w: 1 }] : []; if (!k) continue;
        (function rec(r, minV, cur) {
            if (!r) {
                const fr = {}; for (const v of cur) fr[v] = (fr[v] || 0) + 1;
                let w = FACT[k]; for (const c of Object.values(fr)) w /= FACT[c]; t[k].push({ d: [...cur], w }); return;
            }
            for (let v = minV; v <= 6; v++) { cur.push(v); rec(r - 1, v, cur); cur.pop(); }
        })(k, 1, []);
    } return t;
})();
const POW6 = [1, 6, 36, 216, 1296, 7776];

function mergeSorted(a, b) {
    const o = []; let i = 0, j = 0;
    while (i < a.length && j < b.length) o.push(a[i] <= b[j] ? a[i++] : b[j++]);
    while (i < a.length) o.push(a[i++]);
    while (j < b.length) o.push(b[j++]);
    return o;
}

// ── SCORING ───────────────────────────────────────────────────
const sm = d => d.reduce((a, b) => a + b, 0);
const cnt = d => { const c = {}; for (const v of d) c[v] = (c[v] || 0) + 1; return c; };
const Ov = Object.values.bind(Object);
const S = {
    aces: d => d.filter(v => v === 1).reduce((a, b) => a + b, 0),
    twos: d => d.filter(v => v === 2).reduce((a, b) => a + b, 0),
    threes: d => d.filter(v => v === 3).reduce((a, b) => a + b, 0),
    fours: d => d.filter(v => v === 4).reduce((a, b) => a + b, 0),
    fives: d => d.filter(v => v === 5).reduce((a, b) => a + b, 0),
    sixes: d => d.filter(v => v === 6).reduce((a, b) => a + b, 0),
    'pair': d => { const c = cnt(d); const p = Object.keys(c).filter(k => c[k] >= 2).map(Number).sort((a, b) => b - a); return p.length > 0 ? p[0] * 2 : 0; },
    'two-pairs': d => {
        const c = cnt(d); const p = Object.keys(c).filter(k => c[k] >= 2).map(Number).sort((a, b) => b - a);
        if (p.length >= 2) return p[0] * 2 + p[1] * 2;
        const four = Object.keys(c).find(k => c[k] >= 4);
        return four ? parseInt(four) * 4 : 0;
    },
    'three-of-a-kind': d => { const c = cnt(d); const v = Object.keys(c).find(k => c[k] >= 3); return v ? parseInt(v) * 3 : 0; },
    'four-of-a-kind': d => { const c = cnt(d); const v = Object.keys(c).find(k => c[k] >= 4); return v ? parseInt(v) * 4 : 0; },
    'full-house': d => { const v = Ov(cnt(d)).sort(); return (v.length === 2 && v[0] === 2) ? sm(d) : 0; },
    'small-straight': d => { const u = [...new Set(d)].sort((a, b) => a - b).join(''); return u === '12345' ? 15 : 0; },
    'large-straight': d => { const u = [...new Set(d)].sort((a, b) => a - b).join(''); return u === '23456' ? 20 : 0; },
    'yahtzee': d => new Set(d).size === 1 ? 50 : 0,
    'chance': d => sm(d),
};

function progress(label, done, total) {
    const pct = ((done / total) * 100).toFixed(1).padStart(5);
    const bar = '█'.repeat(Math.round(done / total * 30)).padEnd(30, '░');
    process.stdout.write(`\r  ${label}  [${bar}] ${pct}%`);
    if (done === total) process.stdout.write('\n');
}

console.log('\nYahtzee Perfect DB generator v4 (True Bellman DP)');
console.log(`  Output: ${OUT_FILE}\n`);

const t0 = Date.now();

// ── PRECOMPUTE TRANSITIONS ────────────────────────────────────
console.log('Step 0/2 — Precomputing Transitions & Score Cache');
const T = []; // T[di][si][out_i] = {fdi, normW}
for (let di = 0; di < N_DICE; di++) {
    T[di] = [];
    const subsets = DICE_SUBSETS[di];
    for (let si = 0; si < subsets.length; si++) {
        const keep = subsets[si];
        const rc = 5 - keep.length;
        const outs = OUTCOMES[rc];
        const wt = POW6[rc];
        const list = [];
        for (const { d: rolled, w } of outs) {
            const full = mergeSorted(keep, rolled);
            const fdi = DICE_TO_IDX[full.join('')];
            list.push({ fdi, normW: w / wt });
        }
        T[di][si] = list;
    }
}

const SCORE_PER_CAT = DICE_COMBOS.map(d => CAT_LIST.map(c => S[c](d)));

// Fresh roll probabilities
const FRESH_PROBS = new Float32Array(N_DICE);
for (const { d, w } of OUTCOMES[5]) {
    FRESH_PROBS[DICE_TO_IDX[d.join('')]] = w / 7776;
}

// ── TRUE BELLMAN DP ──────────────────────────────────────────
console.log('Step 1/2 — Dynamic Programming (32,768 states)');
const tblSize = N_DICE * N_CATS;
const flat = (di, cm) => di * N_CATS + cm;
const RL0 = new Uint8Array(tblSize);
const RL1 = new Uint8Array(tblSize);
const RL2 = new Uint8Array(tblSize);

// Reusable scratch arrays for exactly 1 category mask (size 252)
// This fits entirely in L1 cache = ludicrous speed
const SCORE_EV = new Float32Array(N_DICE);
const RL1_EV = new Float32Array(N_DICE);
const RL2_EV = new Float32Array(N_DICE);
const EV_NewTurn = new Float32Array(N_CATS);

// cm=0 => 0 EV.
for (let cm = 1; cm < N_CATS; cm++) {
    // 1. RL0: Score category + NewTurn EV of remainder
    for (let di = 0; di < N_DICE; di++) {
        const scores = SCORE_PER_CAT[di];
        let bestCat = -1, bestEV = -Infinity;
        for (let ci = 0; ci < 15; ci++) {
            if (!(cm & (1 << ci))) continue;
            let raw = scores[ci];
            let immediate = raw;
            // Upper bonus expectation heuristic (50/63 pts per upper pip)
            if (ci < 6 && raw > 0) immediate += raw * (50 / 63);

            const remMask = cm & ~(1 << ci);
            const totalEV = immediate + EV_NewTurn[remMask];

            if (totalEV > bestEV) { bestEV = totalEV; bestCat = ci; }
        }
        RL0[flat(di, cm)] = bestCat;
        SCORE_EV[di] = bestEV;
    }

    // 2. RL1: Keep state -> Roll to RL0
    for (let di = 0; di < N_DICE; di++) {
        const subsets = T[di];
        let bestEV = -Infinity, bestSi = subsets.length - 1;
        for (let si = 0; si < subsets.length; si++) {
            let ev = 0;
            const outs = subsets[si];
            for (let o = 0; o < outs.length; o++) {
                ev += outs[o].normW * SCORE_EV[outs[o].fdi];
            }
            if (ev > bestEV) { bestEV = ev; bestSi = si; }
        }
        RL1[flat(di, cm)] = bestSi;
        RL1_EV[di] = bestEV;
    }

    // 3. RL2: Keep state -> Roll to RL1
    for (let di = 0; di < N_DICE; di++) {
        const subsets = T[di];
        let bestEV = -Infinity, bestSi = subsets.length - 1;
        for (let si = 0; si < subsets.length; si++) {
            let ev = 0;
            const outs = subsets[si];
            for (let o = 0; o < outs.length; o++) {
                ev += outs[o].normW * RL1_EV[outs[o].fdi];
            }
            if (ev > bestEV) { bestEV = ev; bestSi = si; }
        }
        RL2[flat(di, cm)] = bestSi;
        RL2_EV[di] = bestEV;
    }

    // 4. EV_NewTurn: Average of RL2 over all fresh roll outcomes
    let newTurnEV = 0;
    for (let di = 0; di < N_DICE; di++) {
        newTurnEV += FRESH_PROBS[di] * RL2_EV[di];
    }
    EV_NewTurn[cm] = newTurnEV;

    if (cm % 500 === 0 || cm === N_CATS - 1) progress('DP ', cm, N_CATS - 1);
}

// ── WRITE FILE ────────────────────────────────────────────────
console.log('Step 2/2 — Writing yahtzee_perfect.ydb…');
const header = Buffer.allocUnsafe(16);
Buffer.from(MAGIC, 'ascii').copy(header, 0);
header.writeUInt32LE(N_DICE, 8);
header.writeUInt32LE(N_CATS, 12);
fs.writeFileSync(OUT_FILE, Buffer.concat([
    header,
    Buffer.from(RL0.buffer),
    Buffer.from(RL1.buffer),
    Buffer.from(RL2.buffer),
]));

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const sizeKB = (fs.statSync(OUT_FILE).size / 1024).toFixed(0);
console.log(`\n✓ Done in ${elapsed}s — ${sizeKB} KB written to ${OUT_FILE}\n`);
