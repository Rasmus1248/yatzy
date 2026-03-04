window.YahtzeeDB = (() => {
    'use strict';

    const DB_FILE = 'yahtzee_perfect.ydb';
    const MAGIC = 'YTZDB005';
    const N_CATS = 32768;
    const MAX_UPPER = 64;

    const CAT_LIST = [
        'aces', 'twos', 'threes', 'fours', 'fives', 'sixes',
        'pair', 'two-pairs', 'three-of-a-kind', 'four-of-a-kind', 'full-house',
        'small-straight', 'large-straight', 'yahtzee', 'chance'
    ];

    let EV_NewTurn = null;
    let _isReady = false;
    let _loadError = null;

    async function init() {
        try {
            const res = await fetch(DB_FILE);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = await res.arrayBuffer();

            const magic = String.fromCharCode(...new Uint8Array(buf).slice(0, 8));
            if (magic !== MAGIC) throw new Error('Outdated .ydb file (run generate_db.js)');

            EV_NewTurn = new Float32Array(buf, 16, N_CATS * MAX_UPPER);
            _isReady = true;
            return { entries: N_CATS * MAX_UPPER, fileSizeBytes: buf.byteLength };
        } catch (e) {
            _loadError = e.message;
            return false;
        }
    }

    function getFutureEV(mask, upperSum) {
        if (!_isReady) return 0;
        return EV_NewTurn[mask * MAX_UPPER + Math.min(63, upperSum)];
    }

    return { init, getFutureEV, get isReady() { return _isReady; }, get loadError() { return _loadError; }, CAT_LIST };
})();
