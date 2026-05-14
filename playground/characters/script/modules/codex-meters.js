/**
 * codex-meters.js — Scene Codex meter logic
 *
 * Pure logic module: keyword scoring, LLM scoring, DOM sync.
 * Receives dependencies at init time rather than importing from closure.
 */

let _qs, _state, _getApiKey, _fetchCompletion;
let _lastMeterScoredAt = 0;

export function initCodexMeters({ qs, state, getApiKey, fetchCompletion }) {
    _qs            = qs;
    _state         = state;
    _getApiKey     = getApiKey;
    _fetchCompletion = fetchCompletion;
}

export function setMeterDOM(t, i, d) {
    const $tb = _qs('#codex-tension-bar');  const $tv = _qs('#codex-tension-val');
    const $ib = _qs('#codex-intimacy-bar'); const $iv = _qs('#codex-intimacy-val');
    const $db = _qs('#codex-danger-bar');   const $dv = _qs('#codex-danger-val');
    if ($tb) $tb.style.width = `${t}%`; if ($tv) $tv.textContent = t;
    if ($ib) $ib.style.width = `${i}%`; if ($iv) $iv.textContent = i;
    if ($db) $db.style.width = `${d}%`; if ($dv) $dv.textContent = d;
}

export function applyStatusTags(text) {
    if (!text) return;
    const meterMap = {
        TENSION:  { bar: '#codex-tension-bar',  val: '#codex-tension-val'  },
        INTIMACY: { bar: '#codex-intimacy-bar', val: '#codex-intimacy-val' },
        DANGER:   { bar: '#codex-danger-bar',   val: '#codex-danger-val'   },
    };
    const tagRe = /\[([A-Z]+)\s*(\d{1,3})%?\]/g;
    let match;
    while ((match = tagRe.exec(text)) !== null) {
        const key = match[1].toUpperCase();
        const pct = Math.min(100, Math.max(0, parseInt(match[2], 10)));
        const ids = meterMap[key];
        if (!ids) continue;
        const $bar = _qs(ids.bar);
        const $val = _qs(ids.val);
        if ($bar) $bar.style.width = `${pct}%`;
        if ($val) $val.textContent = pct;
    }
}

export function keywordMeterScore(history) {
    const recent = history.slice(-10).map(m => m.content?.toLowerCase() || '').join(' ');
    const tensionKw  = ['stare','silence','tension','dare','challenge','confront','angry','afraid','edge','tense','hesitat','glare','clench','rigid','snap','snarl','warn'];
    const intimacyKw = ['touch','kiss','whisper','skin','warm','hold','close','breath','moan','intimate','caress','embrace','shiver','pulse','flush','naked','bare','soft','gentle','tender'];
    const dangerKw   = ['blood','weapon','kill','fight','danger','threat','stab','gun','blade','attack','pain','wound','die','death','scream','flee','trapped','hunt','aimed','shot'];
    const score = kws => Math.min(100, kws.filter(k => recent.includes(k)).length * 11 + 8);
    return { t: score(tensionKw), i: score(intimacyKw), d: score(dangerKw) };
}

export async function llmScoreMeters() {
    if (!_getApiKey()) return;
    const history   = _state.history;
    const recentMsgs = history.filter(m => m.role !== 'image').slice(-6);
    if (!recentMsgs.length) return;

    const cacheKey = `udmeter__${_state.chat?.id}__${recentMsgs.at(-1)?.id}`;
    try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            const { t, i, d } = JSON.parse(cached);
            setMeterDOM(t, i, d);
            return;
        }
    } catch (_) {}

    const excerpt = recentMsgs.map(m => {
        const who = m.role === 'user' ? (_state.config.userName || 'User') : (_state.loadedCharacters[m.botId]?.name || 'Character');
        return `${who}: ${m.content?.slice(0, 200)}`;
    }).join('\n');

    try {
        const { text } = await _fetchCompletion({
            model: _state.config.model || 'deepseek-r1',
            messages: [
                { role: 'system', content: 'You are a scene-analysis engine. Given a roleplay excerpt, score three dimensions 0-100 as integers. Return ONLY valid JSON: {"tension":N,"intimacy":N,"danger":N}. No explanation.' },
                { role: 'user',   content: `Score this scene:\n${excerpt}` }
            ],
            max_tokens: 30,
            temperature: 0.1
        });
        const parsed = JSON.parse(text.trim());
        const t = Math.min(100, Math.max(0, parseInt(parsed.tension,  10) || 0));
        const i = Math.min(100, Math.max(0, parseInt(parsed.intimacy, 10) || 0));
        const d = Math.min(100, Math.max(0, parseInt(parsed.danger,   10) || 0));
        setMeterDOM(t, i, d);
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ t, i, d })); } catch (_) {}
    } catch (_) { /* silent — meters stay at keyword estimate */ }
}

export function updateCodexMeters() {
    const history = _state.history;
    if (!history.length) return;

    const { t, i, d } = keywordMeterScore(history);
    setMeterDOM(t, i, d);

    const turns = _state.telemetry?.turns ?? 0;
    if (turns > 0 && turns % 3 === 0 && turns !== _lastMeterScoredAt) {
        _lastMeterScoredAt = turns;
        llmScoreMeters().catch(() => {});
    }
}
