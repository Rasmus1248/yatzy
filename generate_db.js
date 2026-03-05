'use strict';
const fs = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, 'yatzy_perfect.ydb');
const MAGIC = 'YTZDB005'; // Version 5
const N_CATS = 32768;
const MAX_UPPER = 64; // Scores 0 to 63

const CAT_LIST = [
    'aces', 'twos', 'threes', 'fours', 'fives', 'sixes',
    'pair', 'two-pairs', 'three-of-a-kind', 'four-of-a-kind', 'full-house',
    'small-straight', 'large-straight', 'yahtzee', 'chance'
];

const DICE_COMBOS = [];
const DICE_TO_IDX = {};
(function () {
    (function rec(r, minV, cur) {
        if (!r) { DICE_TO_IDX[cur.join('')] = DICE_COMBOS.length; DICE_COMBOS.push([...cur]); return; }
        for (let v = minV; v <= 6; v++) { cur.push(v); rec(r - 1, v, cur); cur.pop(); }
    })(5, 1, []);
})();
const N_DICE = DICE_COMBOS.length;

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
        const four = Object.keys(c).find(k => c[k] >= 4); return four ? parseInt(four) * 4 : 0;
    },
    'three-of-a-kind': d => { const c = cnt(d); const v = Object.keys(c).find(k => c[k] >= 3); return v ? parseInt(v) * 3 : 0; },
    'four-of-a-kind': d => { const c = cnt(d); const v = Object.keys(c).find(k => c[k] >= 4); return v ? parseInt(v) * 4 : 0; },
    'full-house': d => { const v = Ov(cnt(d)).sort(); return (v.length === 2 && v[0] === 2) ? sm(d) : 0; },
    'small-straight': d => { const u = [...new Set(d)].sort((a, b) => a - b).join(''); return u === '12345' ? 15 : 0; },
    'large-straight': d => { const u = [...new Set(d)].sort((a, b) => a - b).join(''); return u === '23456' ? 20 : 0; },
    'yahtzee': d => new Set(d).size === 1 ? 50 : 0,
    'chance': d => sm(d),
};

console.log('\nYahtzee Perfect DB generator v5 (Full Upper Sum tracking)');
const t0 = Date.now();

const T = [];
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
            list.push({ fdi: DICE_TO_IDX[full.join('')], normW: w / wt });
        }
        T[di][si] = list;
    }
}

const SCORE_PER_CAT = DICE_COMBOS.map(d => CAT_LIST.map(c => S[c](d)));
const FRESH_PROBS = new Float32Array(N_DICE);
for (const { d, w } of OUTCOMES[5]) FRESH_PROBS[DICE_TO_IDX[d.join('')]] = w / 7776;

const EV_NewTurn = new Float32Array(N_CATS * MAX_UPPER);
const SCORE_EV = new Float32Array(N_DICE);
const RL1_EV = new Float32Array(N_DICE);
const RL2_EV = new Float32Array(N_DICE);

for (let cm = 1; cm < N_CATS; cm++) {
    for (let u = 0; u < MAX_UPPER; u++) {

        // RL0
        for (let di = 0; di < N_DICE; di++) {
            let bestEV = -Infinity;
            for (let ci = 0; ci < 15; ci++) {
                if (!(cm & (1 << ci))) continue;
                let raw = SCORE_PER_CAT[di][ci];
                let immediate = raw;
                let nextU = u;

                if (ci < 6) {
                    nextU = u + raw;
                    if (u < 63 && nextU >= 63) immediate += 50; // EXACT BONUS! No heuristics.
                    if (nextU > 63) nextU = 63;
                }

                const remMask = cm ^ (1 << ci);
                const totalEV = immediate + EV_NewTurn[remMask * MAX_UPPER + nextU];
                if (totalEV > bestEV) bestEV = totalEV;
            }
            SCORE_EV[di] = bestEV;
        }

        // RL1
        for (let di = 0; di < N_DICE; di++) {
            const subsets = T[di];
            let bestEV = -Infinity;
            for (let si = 0; si < subsets.length; si++) {
                let ev = 0;
                const outs = subsets[si];
                for (let o = 0; o < outs.length; o++) ev += outs[o].normW * SCORE_EV[outs[o].fdi];
                if (ev > bestEV) bestEV = ev;
            }
            RL1_EV[di] = bestEV;
        }

        // RL2
        for (let di = 0; di < N_DICE; di++) {
            const subsets = T[di];
            let bestEV = -Infinity;
            for (let si = 0; si < subsets.length; si++) {
                let ev = 0;
                const outs = subsets[si];
                for (let o = 0; o < outs.length; o++) ev += outs[o].normW * RL1_EV[outs[o].fdi];
                if (ev > bestEV) bestEV = ev;
            }
            RL2_EV[di] = bestEV;
        }

        let nt = 0;
        for (let di = 0; di < N_DICE; di++) nt += FRESH_PROBS[di] * RL2_EV[di];
        EV_NewTurn[cm * MAX_UPPER + u] = nt;
    }
    if (cm % 500 === 0) process.stdout.write(`\r  DP [${cm}/${N_CATS}]`);
}

const header = Buffer.allocUnsafe(16);
Buffer.from(MAGIC, 'ascii').copy(header, 0);
header.writeUInt32LE(N_CATS, 8);
header.writeUInt32LE(MAX_UPPER, 12);
fs.writeFileSync(OUT_FILE, Buffer.concat([header, Buffer.from(EV_NewTurn.buffer)]));
console.log(`\n✓ Done! DB is now ${(EV_NewTurn.byteLength / 1024 / 1024).toFixed(1)} MB\n`);
