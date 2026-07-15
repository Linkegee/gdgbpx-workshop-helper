// ==UserScript==
// @name         广东省干部培训网络学院专题学习助手
// @namespace    https://gbpx.gd.gov.cn/
// @version      1.5.9
// @description  用户手动启动后，依次处理“专题学习-在学”课程；支持暂停、继续、停止、跳过、静音和可靠的正常时长学习。
// @author       User & Codex
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/Linkegee/gdgbpx-workshop-helper/main/gdgbpx-workshop-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/Linkegee/gdgbpx-workshop-helper/main/gdgbpx-workshop-helper.user.js
// @match        https://gbpx.gd.gov.cn/gdceportal/dist/*
// @match        https://wcs1.shawcoder.xyz/gdcecw/*
// @match        https://cs1.gdgbpx.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      127.0.0.1
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.5.9';
    const STATE_KEY = 'gdgbpx_workshop_helper_state_v1';
    const EVENT_KEY = 'gdgbpx_workshop_helper_event_v1';
    const PANEL_POSITION_KEY = 'gdgbpx_workshop_helper_panel_position_v1';
    const LOG_KEY = 'gdgbpx_workshop_helper_logs_v1';
    const UPDATE_CHECK_KEY = 'gdgbpx_workshop_helper_update_check_v1';
    const UPDATE_AVAILABLE_KEY = 'gdgbpx_workshop_helper_update_available_v1';
    const PLAYER_HEARTBEAT_KEY = 'gdgbpx_workshop_helper_player_heartbeat_v1';
    const PLAYER_IDENTITY_SESSION_KEY = 'gdgbpxPlayerIdentityV1';
    const UPDATE_URL = 'https://raw.githubusercontent.com/Linkegee/gdgbpx-workshop-helper/main/gdgbpx-workshop-helper.user.js';
    const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
    const LIST_SECTION_KEY = 'gdgbpx_workshop_helper_list_section_v1';
    const LIST_SECTION_TTL_MS = 30 * 60 * 1000;
    const MAX_LOG_ENTRIES = 600;
    const IMPORTANT_LOG_RESERVE = 180;
    const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
    const HIGH_FREQUENCY_LOG_INTERVAL_MS = 5000;
    const HIGH_FREQUENCY_LOG_EVENTS = new Set([
        'video-paused', 'video-playing', 'video-native-stalled',
        'video-started', 'player-start-attempt', 'player-event-received', 'publish-event'
    ]);
    const DEBUG_BRIDGE_URL = 'http://127.0.0.1:17891/ingest';
    const MAIN_HOST = 'gbpx.gd.gov.cn';
    const PLAYER_HOSTS = new Set(['wcs1.shawcoder.xyz', 'cs1.gdgbpx.com']);
    const TICK_MS = 1200;
    // Do not reload the visible Vue detail page while a player is active. The
    // hidden same-origin probe below is used for server-status polling instead.
    const SERVER_STATUS_PROBE_INTERVAL_MS = 6500;
    const SERVER_STATUS_PROBE_TIMEOUT_MS = 20000;
    const COMPLETED_CLOSE_RETRY_MS = 6000;
    const COMPLETED_CLOSE_GRACE_MS = 60000;
    const MAX_COMPLETED_CLOSE_RETRIES = 5;
    const PLAYER_REOPEN_COOLDOWN_MS = 3000;
    const PLAYER_HEARTBEAT_INTERVAL_MS = 1500;
    const PLAYER_CLOSE_HEARTBEAT_SILENCE_MS = 10000;
    const PLAYER_CLOSE_MIN_CONFIRM_MS = 4000;

    let mainTickTimer = null;
    let detailRefreshTimer = null;
    let panel = null;
    let playerVideo = null;
    let playerTimer = null;
    let lastPlayerProgressAt = Date.now();
    let lastPlayerTime = -1;
    let lastPlayerReportAt = 0;
    let lastHandledEventId = '';
    let playerEndedPublished = false;
    let playerSource = '';
    let playerPlaybackStarted = false;
    let lastPlayAttemptAt = 0;
    let lastPlayerWaitLogAt = 0;
    let lastDomSummary = '';
    let lastAutoScrolledLessonKey = '';
    let lastLessonSelectionSnapshot = '';
    let lastIgnoredDetailProgressSnapshot = '';
    let lastVisibleProbeSyncSnapshot = '';
    let bridgeQueue = [];
    let fallbackPlayerTab = null;
    let bridgeFlushTimer = null;
    let bridgeSending = false;
    let bridgeConnected = false;
    let menuSectionTrackingInstalled = false;
    let serverStatusFrame = null;
    let serverStatusFrameKey = '';
    let serverStatusFrameReady = false;
    let serverStatusMonitorTimer = null;
    let serverStatusProbeRetryTimer = null;
    let serverStatusProbeStartedAt = 0;
    let lastServerStatusSnapshot = '';
    const logThrottle = new Map();
    let playerLessonKey = '';
    let playerLessonTitle = '';
    let playerSessionId = '';
    let lastPlayerHeartbeatWriteAt = 0;
    let emptyStudyingListSeenAt = 0;
    let playerRecoverySeekApplied = false;

    function defaultState() {
        return {
            version: VERSION,
            status: 'idle',
            phase: 'idle',
            message: '请进入“专题学习 → 在学”，然后点击开始',
            currentWorkshopTitle: '',
            currentWorkshopLessonTitles: [],
            currentClassId: '',
            currentLessonTitle: '',
            currentLessonKey: '',
            currentLessonProgress: 0,
            beforeProgress: 0,
            currentPage: 1,
            lastActionAt: 0,
            refreshAttempts: 0,
            openAttempts: 0,
            fallbackOpenAttempted: false,
            finishedWorkshopTitles: [],
            skippedLessonKeys: [],
            skipRequestAt: 0,
            stopRequestAt: 0,
            completedCloseRequestAt: 0,
            completedCloseAttempts: 0,
            completedCloseStartedAt: 0,
            closingPlayerSessionId: '',
            closingPlayerLastSeenAt: 0,
            closingPlayerUnloadAt: 0,
            serverCompletedLessonKeys: [],
            settings: {
                playbackRate: 1,
                muted: true,
                autoResume: true,
                stallMinutes: 3,
                closeOnStall: false
            }
        };
    }

    function getState() {
        const saved = GM_getValue(STATE_KEY, null);
        const base = defaultState();
        if (!saved || typeof saved !== 'object') return base;
        const merged = {
            ...base,
            ...saved,
            settings: { ...base.settings, ...(saved.settings || {}) },
            finishedWorkshopTitles: Array.isArray(saved.finishedWorkshopTitles)
                ? saved.finishedWorkshopTitles
                : [],
            currentWorkshopLessonTitles: Array.isArray(saved.currentWorkshopLessonTitles)
                ? saved.currentWorkshopLessonTitles
                : [],
            skippedLessonKeys: Array.isArray(saved.skippedLessonKeys)
                ? saved.skippedLessonKeys
                : [],
            serverCompletedLessonKeys: Array.isArray(saved.serverCompletedLessonKeys)
                ? saved.serverCompletedLessonKeys
                : []
        };
        // v1.4.2 could treat a non-100% status label as complete. Convert that
        // one stale recovery state into a safe recheck instead of leaving playback paused.
        if (saved.version === '1.4.2' && merged.phase === 'completed-close-failed') {
            merged.status = 'running';
            merged.phase = 'checking-progress';
            merged.message = '已升级完成判定；正在重新核验服务器进度并恢复播放';
            merged.completedCloseRequestAt = 0;
            merged.completedCloseAttempts = 0;
        }
        // 实测站点按实际学习时长记进度，倍速会导致视频结束但课程仍未完成。
        merged.settings.playbackRate = 1;
        return merged;
    }

    function updateState(change) {
        const current = getState();
        const patch = typeof change === 'function' ? change(current) : change;
        if (!patch) return current;
        const next = {
            ...current,
            ...patch,
            version: VERSION,
            settings: { ...current.settings, ...(patch.settings || {}) }
        };
        next.settings.playbackRate = 1;
        GM_setValue(STATE_KEY, next);
        if (current.status !== next.status || current.phase !== next.phase || current.message !== next.message) {
            debugLog('info', 'state-change', {
                from: { status: current.status, phase: current.phase },
                to: { status: next.status, phase: next.phase },
                message: next.message,
                workshop: next.currentWorkshopTitle,
                lesson: next.currentLessonTitle
            });
        }
        if (location.hostname === MAIN_HOST && window.top === window) renderPanel(next);
        return next;
    }

    function publishEvent(type, detail = {}) {
        const event = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type,
            at: Date.now(),
            lessonKey: PLAYER_HOSTS.has(location.hostname) ? playerLessonKey : '',
            lessonTitle: PLAYER_HOSTS.has(location.hostname) ? playerLessonTitle : '',
            playerSessionId: PLAYER_HOSTS.has(location.hostname) ? playerSessionId : '',
            ...detail
        };
        debugLog('info', 'publish-event', { type, detail });
        GM_setValue(EVENT_KEY, event);
    }

    function contextName() {
        if (location.hostname === MAIN_HOST) return 'main';
        if (window.top === window) return 'player-top';
        return 'player-frame';
    }

    function sanitizedUrl() {
        return location.href
            .replace(/([?&#](?:token|access_token|authorization|callbackId|uid|session|sid|secret|sign|signature)=)[^&#]*/gi, '$1[redacted]')
            .slice(0, 500);
    }

    function isNewerVersion(candidate, current = VERSION) {
        const candidateParts = String(candidate).split('.').map((part) => Number.parseInt(part, 10));
        const currentParts = String(current).split('.').map((part) => Number.parseInt(part, 10));
        const length = Math.max(candidateParts.length, currentParts.length);
        for (let index = 0; index < length; index += 1) {
            const candidatePart = Number.isFinite(candidateParts[index]) ? candidateParts[index] : 0;
            const currentPart = Number.isFinite(currentParts[index]) ? currentParts[index] : 0;
            if (candidatePart > currentPart) return true;
            if (candidatePart < currentPart) return false;
        }
        return false;
    }

    function getAvailableUpdate() {
        const available = GM_getValue(UPDATE_AVAILABLE_KEY, null);
        if (!available || typeof available !== 'object' || !isNewerVersion(available.version)) {
            if (available) GM_deleteValue(UPDATE_AVAILABLE_KEY);
            return null;
        }
        return available;
    }

    function checkForScriptUpdate(force = false) {
        const now = Date.now();
        const lastCheckAt = Number(GM_getValue(UPDATE_CHECK_KEY, 0) || 0);
        if (!force && now - lastCheckAt < UPDATE_CHECK_INTERVAL_MS) return;
        GM_setValue(UPDATE_CHECK_KEY, now);
        debugLog('info', 'script-update-check-started', { force, currentVersion: VERSION });
        new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${UPDATE_URL}?_gbpx_update_check=${now}`,
                headers: { 'Cache-Control': 'no-cache' },
                timeout: 10000,
                anonymous: true,
                onload(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`HTTP ${response.status}`));
                        return;
                    }
                    resolve(response.responseText || '');
                },
                onerror() { reject(new Error('网络请求失败')); },
                ontimeout() { reject(new Error('检查更新超时')); }
            });
        }).then((source) => {
            const match = source.match(/^\/\/\s*@version\s+([^\s]+)\s*$/m);
            if (!match) throw new Error('远程脚本缺少 @version');
            const remoteVersion = match[1];
            if (isNewerVersion(remoteVersion)) {
                const available = { version: remoteVersion, url: UPDATE_URL, checkedAt: Date.now() };
                GM_setValue(UPDATE_AVAILABLE_KEY, available);
                debugLog('info', 'script-update-available', {
                    currentVersion: VERSION,
                    remoteVersion
                });
                renderPanel(getState());
                if (force) window.alert(`发现新版本 ${remoteVersion}，请点击助手面板中的“安装更新”。`);
                return;
            }
            GM_deleteValue(UPDATE_AVAILABLE_KEY);
            debugLog('info', 'script-update-current', {
                currentVersion: VERSION,
                remoteVersion
            });
            renderPanel(getState());
            if (force) window.alert(`当前已是最新版本 ${VERSION}。`);
        }).catch((error) => {
            debugLog('warn', 'script-update-check-failed', { force, error });
            if (force) window.alert(`检查更新失败：${error.message || error}`);
        });
    }

    function sanitizeLogValue(value, depth = 0) {
        if (depth > 4) return '[max-depth]';
        if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const scrubbed = value
                .replace(/([?&#](?:token|access_token|authorization|callbackId|uid|session|sid|secret|sign|signature)=)[^&#\s]*/gi, '$1[redacted]')
                .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
                .replace(/(cookie\s*[:=]\s*)[^\r\n,}]+/gi, '$1[redacted]');
            return scrubbed.length > 1000 ? `${scrubbed.slice(0, 1000)}…` : scrubbed;
        }
        if (value instanceof Error) {
            return { name: value.name, message: value.message, stack: String(value.stack || '').slice(0, 3000) };
        }
        if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeLogValue(item, depth + 1));
        if (typeof value === 'object') {
            const result = {};
            for (const [key, item] of Object.entries(value).slice(0, 50)) {
                if (/token|cookie|authorization|password|secret|session/i.test(key)) {
                    result[key] = '[redacted]';
                } else {
                    result[key] = sanitizeLogValue(item, depth + 1);
                }
            }
            return result;
        }
        return String(value);
    }

    function getLogs() {
        const logs = GM_getValue(LOG_KEY, []);
        return Array.isArray(logs) ? logs : [];
    }

    function compactStoredLogs(logs, now = Date.now()) {
        const fresh = logs.filter((entry) => {
            const time = Date.parse(entry?.time || '');
            return Number.isFinite(time) && now - time <= LOG_RETENTION_MS;
        });
        if (fresh.length <= MAX_LOG_ENTRIES) return fresh;
        const important = fresh.filter((entry) => ['warn', 'error'].includes(entry.level));
        const normal = fresh.filter((entry) => !['warn', 'error'].includes(entry.level));
        const retainedImportant = important.slice(-Math.min(IMPORTANT_LOG_RESERVE, MAX_LOG_ENTRIES));
        const retainedNormal = normal.slice(-(MAX_LOG_ENTRIES - retainedImportant.length));
        return [...retainedNormal, ...retainedImportant]
            .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
    }

    function throttleLog(level, event) {
        if (level !== 'info' || !HIGH_FREQUENCY_LOG_EVENTS.has(event)) return 0;
        const key = `${contextName()}:${event}`;
        const now = Date.now();
        const previous = logThrottle.get(key);
        if (previous && now - previous.at < HIGH_FREQUENCY_LOG_INTERVAL_MS) {
            previous.suppressed += 1;
            return -1;
        }
        const suppressed = previous?.suppressed || 0;
        logThrottle.set(key, { at: now, suppressed: 0 });
        return suppressed;
    }

    function debugLog(level, event, detail = {}) {
        try {
            const suppressedRepeats = throttleLog(level, event);
            if (suppressedRepeats < 0) return;
            const entry = {
                time: new Date().toISOString(),
                level,
                context: contextName(),
                event,
                url: sanitizedUrl(),
                detail: sanitizeLogValue(detail)
            };
            if (suppressedRepeats) entry.detail.suppressedRepeats = suppressedRepeats;
            const logs = compactStoredLogs([...getLogs(), entry]);
            GM_setValue(LOG_KEY, logs);
            const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
            console[method]('[GBP助手]', event, entry.detail);
            queueBridgeLog(entry);
            updateLogCount();
        } catch (error) {
            console.error('[GBP助手] 写入日志失败', error);
        }
    }

    function queueBridgeLog(entry) {
        bridgeQueue.push(entry);
        if (bridgeQueue.length > 200) bridgeQueue.splice(0, bridgeQueue.length - 200);
        if (!bridgeFlushTimer) bridgeFlushTimer = setTimeout(flushBridgeLogs, 800);
    }

    function flushBridgeLogs() {
        bridgeFlushTimer = null;
        if (bridgeSending || !bridgeQueue.length) return;
        const entries = bridgeQueue.splice(0, 50);
        bridgeSending = true;
        GM_xmlhttpRequest({
            method: 'POST',
            url: DEBUG_BRIDGE_URL,
            headers: {
                'Content-Type': 'application/json',
                'X-GBP-Logger': 'v1'
            },
            data: JSON.stringify({ scriptVersion: VERSION, sentAt: new Date().toISOString(), entries }),
            timeout: 2000,
            onload(response) {
                bridgeSending = false;
                bridgeConnected = response.status >= 200 && response.status < 300;
                if (!bridgeConnected) bridgeQueue.unshift(...entries);
                updateBridgeStatus();
                if (bridgeQueue.length) bridgeFlushTimer = setTimeout(flushBridgeLogs, bridgeConnected ? 250 : 10000);
            },
            onerror() {
                bridgeSending = false;
                bridgeConnected = false;
                bridgeQueue.unshift(...entries);
                if (bridgeQueue.length > 200) bridgeQueue.splice(0, bridgeQueue.length - 200);
                updateBridgeStatus();
                bridgeFlushTimer = setTimeout(flushBridgeLogs, 10000);
            },
            ontimeout() {
                bridgeSending = false;
                bridgeConnected = false;
                bridgeQueue.unshift(...entries);
                if (bridgeQueue.length > 200) bridgeQueue.splice(0, bridgeQueue.length - 200);
                updateBridgeStatus();
                bridgeFlushTimer = setTimeout(flushBridgeLogs, 10000);
            }
        });
    }

    function diagnosticBundle() {
        const state = getState();
        return {
            generatedAt: new Date().toISOString(),
            scriptVersion: VERSION,
            userAgent: navigator.userAgent,
            url: sanitizedUrl(),
            context: contextName(),
            state: sanitizeLogValue(state),
            logs: getLogs()
        };
    }

    function diagnosticText() {
        return JSON.stringify(diagnosticBundle(), null, 2);
    }

    function copyLogs() {
        const text = diagnosticText();
        GM_setClipboard(text, 'text');
        debugLog('info', 'logs-copied', { entries: getLogs().length });
        updateState({ message: `已复制 ${getLogs().length} 条诊断日志` });
    }

    function downloadLogs() {
        const blob = new Blob([diagnosticText()], { type: 'application/json;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `gdgbpx-helper-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        debugLog('info', 'logs-downloaded', { entries: getLogs().length });
    }

    function clearLogs() {
        GM_setValue(LOG_KEY, []);
        debugLog('info', 'logs-cleared');
        updateState({ message: '诊断日志已清空' });
    }

    function updateLogCount() {
        if (!panel || !document.contains(panel)) return;
        const element = panel.querySelector('[data-role="log-count"]');
        if (element) element.textContent = `日志：${getLogs().length}/${MAX_LOG_ENTRIES}`;
    }

    function updateBridgeStatus() {
        if (!panel || !document.contains(panel)) return;
        const element = panel.querySelector('[data-role="bridge-status"]');
        if (!element) return;
        element.textContent = bridgeConnected
            ? '本机调试桥：已连接，日志自动保存'
            : `本机调试桥：等待连接${bridgeQueue.length ? `（待传 ${bridgeQueue.length}）` : ''}`;
        element.classList.toggle('connected', bridgeConnected);
    }

    function installGlobalErrorLogging() {
        window.addEventListener('error', (event) => {
            debugLog('error', 'window-error', {
                message: event.message,
                filename: String(event.filename || '').replace(/([?&]token=)[^&]*/gi, '$1[redacted]'),
                line: event.lineno,
                column: event.colno,
                error: event.error
            });
        });
        window.addEventListener('unhandledrejection', (event) => {
            debugLog('error', 'unhandled-rejection', { reason: event.reason });
        });
    }

    function logDomSummary(name, detail) {
        const summary = JSON.stringify(sanitizeLogValue(detail));
        const key = `${name}:${summary}`;
        if (key === lastDomSummary) return;
        lastDomSummary = key;
        debugLog('info', name, detail);
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function isVisible(element) {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }

    function uniqueAppend(list, value) {
        return value && !list.includes(value) ? [...list, value] : list;
    }

    function isListRoute() {
        if (!location.hash.includes('/workshop/workshopindex/classList')) return false;
        const query = location.hash.includes('?') ? location.hash.split('?')[1] : '';
        const classType = new URLSearchParams(query).get('classType');
        if (classType) return ['3', '在学', 'study', 'studying'].includes(classType);

        const activeMenu = document.querySelector([
            '.el-menu-item.is-active',
            '.el-menu-item.active',
            '[role="menuitem"][aria-current="page"]',
            '[role="menuitem"][aria-selected="true"]'
        ].join(','));
        const activeText = normalizeText(activeMenu?.textContent);
        if (activeText) return activeText === '在学';

        const remembered = GM_getValue(LIST_SECTION_KEY, null);
        if (remembered?.section && Date.now() - Number(remembered.at || 0) <= LIST_SECTION_TTL_MS) {
            if (remembered.section === '在学') {
                logDomSummary('studying-list-route-remembered', {
                    section: remembered.section,
                    ageMs: Date.now() - Number(remembered.at || 0),
                    hash: sanitizedHash()
                });
                return true;
            }
        }

        // The maintenance update removed classType and the active class. Once
        // the user has started the assistant on this classList page, the
        // presence of the “进入” cards is the safest available fallback.
        const state = getState();
        const hasWorkshopCards = Boolean(document.querySelector(
            '.content-div .list_box .item_enter_button, .content-div .list_box button#enter_button'
        ));
        if (hasWorkshopCards) {
            logDomSummary('studying-list-route-inferred', {
                reason: 'classType-and-active-class-missing-after-maintenance',
                hash: sanitizedHash(),
                hasWorkshopCards,
                assistantStatus: state.status
            });
            return true;
        }
        return false;
    }

    function sanitizedHash() {
        return String(location.hash || '').replace(/([?&#](?:uid|token|session|sid)=)[^&#]*/gi, '$1[redacted]');
    }

    function installMenuSectionTracking() {
        if (menuSectionTrackingInstalled) return;
        menuSectionTrackingInstalled = true;
        document.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const item = target?.closest('.el-menu-item,[role="menuitem"]');
            if (!item) return;
            const section = normalizeText(item.textContent);
            if (!['进行中', '在学', '已学', '已截止', '检索'].includes(section)) return;
            GM_setValue(LIST_SECTION_KEY, { section, at: Date.now() });
            debugLog('info', 'workshop-menu-section-clicked', { section, hash: sanitizedHash() });
            scheduleMainTick();
        }, true);
    }

    function isAnyWorkshopListRoute() {
        return location.hash.includes('/workshop/workshopindex/classList');
    }

    function currentClassType() {
        const query = location.hash.includes('?') ? location.hash.split('?')[1] : '';
        return new URLSearchParams(query).get('classType') || '';
    }

    function isDetailRoute() {
        return location.hash.includes('/workshop/workshopindex/mergeClass');
    }

    function currentClassId() {
        const query = location.hash.includes('?') ? location.hash.split('?')[1] : '';
        return new URLSearchParams(query).get('classId') || '';
    }

    function getActivePageNumber() {
        const active = document.querySelector('.el-pagination .el-pager .number.active');
        const value = Number.parseInt(normalizeText(active?.textContent), 10);
        return Number.isFinite(value) ? value : 1;
    }

    function initMainPage() {
        if (window.top !== window) return;
        debugLog('info', 'main-init', { hash: location.hash });
        installPanel();
        installMenuSectionTracking();
        GM_registerMenuCommand('显示学习助手面板', () => {
            installPanel(true);
        });
        GM_registerMenuCommand('清除学习助手状态', () => {
            debugLog('warn', 'state-reset-from-menu');
            GM_deleteValue(STATE_KEY);
            location.reload();
        });
        GM_registerMenuCommand('复制诊断日志', copyLogs);
        GM_registerMenuCommand('下载诊断日志', downloadLogs);
        GM_registerMenuCommand('清空诊断日志', clearLogs);
        GM_registerMenuCommand('检查脚本更新', () => checkForScriptUpdate(true));

        GM_addValueChangeListener(EVENT_KEY, (_name, _oldValue, value) => {
            handlePlayerEvent(value);
        });

        window.addEventListener('hashchange', scheduleMainTick);
        window.addEventListener('focus', () => {
            const state = getState();
            if (state.status === 'running' && ['opening-video', 'watching-video'].includes(state.phase)) {
                updateState({ message: '主页面已获得焦点；播放器状态仍以对应会话心跳为准' });
            }
            scheduleMainTick();
        });

        const observer = new MutationObserver(scheduleMainTick);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        scheduleMainTick();
        setTimeout(() => checkForScriptUpdate(false), 3000);
        debugLog('info', 'server-progress-monitor-mode', {
            mode: 'hidden-same-origin-iframe',
            intervalMs: SERVER_STATUS_PROBE_INTERVAL_MS,
            completionSignal: 'status=已完成'
        });
    }

    function installPanel(forceShow = false) {
        if (panel && document.contains(panel)) {
            if (forceShow) panel.style.display = 'block';
            renderPanel(getState());
            return;
        }

        GM_addStyle(`
            #gbpx-helper-panel {
                position: fixed; left: 0; bottom: 12px; z-index: 2147483646;
                width: 330px; box-sizing: border-box; padding: 12px;
                color: #222; background: rgba(255,255,255,.97);
                border: 1px solid #d52b2b; border-radius: 8px;
                box-shadow: 0 5px 24px rgba(0,0,0,.22); font: 14px/1.45 sans-serif;
            }
            #gbpx-helper-panel * { box-sizing: border-box; }
            #gbpx-helper-panel .gbpx-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; cursor:move; touch-action:none; user-select:none; }
            #gbpx-helper-panel .gbpx-title { color:#a40000; font-weight:700; }
            #gbpx-helper-panel .gbpx-close { border:0; background:transparent; cursor:pointer; font-size:18px; }
            #gbpx-helper-panel .gbpx-status { padding:8px; margin:6px 0; background:#f7f7f7; border-radius:5px; word-break:break-all; }
            #gbpx-helper-panel .gbpx-update-notice { display:block; width:100%; margin:6px 0; padding:7px 8px; border:1px solid #d48b00; border-radius:5px; color:#7a4100; background:#fff5d6; cursor:pointer; font-weight:700; }
            #gbpx-helper-panel .gbpx-update-notice[hidden] { display:none; }
            #gbpx-helper-panel .gbpx-meta { color:#666; font-size:12px; margin:3px 0; word-break:break-all; }
            #gbpx-helper-panel .gbpx-buttons { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin:10px 0; }
            #gbpx-helper-panel button.gbpx-action { border:0; border-radius:4px; padding:7px 4px; color:#fff; cursor:pointer; background:#b30000; }
            #gbpx-helper-panel button.gbpx-action.secondary { background:#666; }
            #gbpx-helper-panel button.gbpx-action.warning { background:#e48300; }
            #gbpx-helper-panel button.gbpx-action:disabled { opacity:.4; cursor:not-allowed; }
            #gbpx-helper-panel .gbpx-settings { display:grid; grid-template-columns:auto 1fr; gap:7px 9px; align-items:center; border-top:1px solid #eee; padding-top:9px; }
            #gbpx-helper-panel .gbpx-log-tools { display:grid; grid-template-columns:1fr repeat(3,auto); gap:5px; align-items:center; margin-top:9px; padding-top:8px; border-top:1px solid #eee; }
            #gbpx-helper-panel .gbpx-log-tools button { border:1px solid #aaa; border-radius:4px; padding:4px 6px; color:#333; background:#fff; cursor:pointer; }
            #gbpx-helper-panel .gbpx-log-tools button:hover { background:#f3f3f3; }
            #gbpx-helper-panel .gbpx-log-count { color:#666; font-size:12px; }
            #gbpx-helper-panel .gbpx-bridge-status { margin-top:5px; color:#9a6700; font-size:11px; }
            #gbpx-helper-panel .gbpx-bridge-status.connected { color:#177245; }
            #gbpx-helper-panel select { width:100%; padding:3px; }
            #gbpx-helper-panel label { user-select:none; }
        `);

        panel = document.createElement('section');
        panel.id = 'gbpx-helper-panel';
        panel.innerHTML = `
            <div class="gbpx-head">
                <span class="gbpx-title">专题学习助手 v${VERSION}</span>
                <button class="gbpx-close" type="button" title="隐藏面板">×</button>
            </div>
            <div class="gbpx-status" data-role="status"></div>
            <button class="gbpx-update-notice" type="button" data-action="installupdate" hidden></button>
            <div class="gbpx-meta" data-role="workshop"></div>
            <div class="gbpx-meta" data-role="lesson"></div>
            <div class="gbpx-buttons">
                <button class="gbpx-action" data-action="start">开始</button>
                <button class="gbpx-action secondary" data-action="pause">暂停</button>
                <button class="gbpx-action" data-action="continue">继续</button>
                <button class="gbpx-action warning" data-action="skip">跳过当前</button>
                <button class="gbpx-action secondary" data-action="stop">停止</button>
                <button class="gbpx-action secondary" data-action="recheck">重新检查</button>
            </div>
            <div class="gbpx-settings">
                <label for="gbpx-muted">保持静音</label>
                <input id="gbpx-muted" type="checkbox" data-setting="muted">
                <label for="gbpx-resume">自动恢复暂停</label>
                <input id="gbpx-resume" type="checkbox" data-setting="autoResume">
                <span>无进度提醒</span>
                <select data-setting="stallMinutes">
                    <option value="2">2 分钟无进度</option>
                    <option value="3">3 分钟无进度</option>
                    <option value="5">5 分钟无进度</option>
                </select>
                <label for="gbpx-close-stall">卡死后自动重开</label>
                <input id="gbpx-close-stall" type="checkbox" data-setting="closeOnStall">
            </div>
            <div class="gbpx-log-tools">
                <span class="gbpx-log-count" data-role="log-count">日志：0/${MAX_LOG_ENTRIES}</span>
                <button type="button" data-action="copylog">复制</button>
                <button type="button" data-action="downloadlog">下载</button>
                <button type="button" data-action="clearlog">清空</button>
            </div>
            <div class="gbpx-bridge-status" data-role="bridge-status">本机调试桥：等待连接</div>
        `;
        document.body.appendChild(panel);
        restorePanelPosition();
        enablePanelDragging();

        panel.querySelector('.gbpx-close').addEventListener('click', () => {
            panel.style.display = 'none';
        });
        panel.addEventListener('click', (event) => {
            const button = event.target.closest('[data-action]');
            if (!button) return;
            handlePanelAction(button.dataset.action);
        });
        panel.addEventListener('change', (event) => {
            const name = event.target.dataset.setting;
            if (!name) return;
            let value = event.target.type === 'checkbox' ? event.target.checked : Number(event.target.value);
            updateState({ settings: { [name]: value }, message: `设置已更新：${name}` });
        });

        renderPanel(getState());
    }

    function restorePanelPosition() {
        const saved = GM_getValue(PANEL_POSITION_KEY, null);
        if (!saved || !Number.isFinite(saved.left) || !Number.isFinite(saved.top)) return;
        const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
        panel.style.left = `${Math.min(Math.max(0, saved.left), maxLeft)}px`;
        panel.style.top = `${Math.min(Math.max(0, saved.top), maxTop)}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }

    function enablePanelDragging() {
        const handle = panel.querySelector('.gbpx-head');
        let drag = null;

        handle.addEventListener('pointerdown', (event) => {
            if (event.target.closest('button')) return;
            const rect = panel.getBoundingClientRect();
            drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
            panel.style.left = `${rect.left}px`;
            panel.style.top = `${rect.top}px`;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            handle.setPointerCapture(event.pointerId);
            event.preventDefault();
        });

        handle.addEventListener('pointermove', (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
            const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
            const left = Math.min(Math.max(0, event.clientX - drag.offsetX), maxLeft);
            const top = Math.min(Math.max(0, event.clientY - drag.offsetY), maxTop);
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
        });

        const finishDrag = (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            const rect = panel.getBoundingClientRect();
            const snapLeft = rect.left < 24 ? 0 : rect.left;
            panel.style.left = `${snapLeft}px`;
            GM_setValue(PANEL_POSITION_KEY, { left: snapLeft, top: rect.top });
            drag = null;
        };
        handle.addEventListener('pointerup', finishDrag);
        handle.addEventListener('pointercancel', finishDrag);

        window.addEventListener('resize', () => {
            const rect = panel.getBoundingClientRect();
            const left = Math.min(Math.max(0, rect.left), Math.max(0, window.innerWidth - panel.offsetWidth));
            const top = Math.min(Math.max(0, rect.top), Math.max(0, window.innerHeight - panel.offsetHeight));
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        });
    }

    function renderPanel(state = getState()) {
        if (!panel || !document.contains(panel)) return;
        const statusNames = {
            idle: '未开始', running: '运行中', paused: '已暂停', stopped: '已停止', complete: '全部完成'
        };
        panel.querySelector('[data-role="status"]').textContent = `${statusNames[state.status] || state.status}：${state.message}`;
        const updateNotice = panel.querySelector('[data-action="installupdate"]');
        const availableUpdate = getAvailableUpdate();
        updateNotice.hidden = !availableUpdate;
        updateNotice.textContent = availableUpdate
            ? `发现新版本 ${availableUpdate.version}，点击安装更新`
            : '';
        panel.querySelector('[data-role="workshop"]').textContent = state.currentWorkshopTitle
            ? `专题：${state.currentWorkshopTitle}`
            : `页面：${isListRoute() ? '在学列表' : isDetailRoute() ? '专题详情' : '其他页面'}`;
        panel.querySelector('[data-role="lesson"]').textContent = state.currentLessonTitle
            ? `课程：${state.currentLessonTitle}（${state.currentLessonProgress || 0}%）`
            : `阶段：${state.phase}`;

        panel.querySelector('[data-setting="muted"]').checked = Boolean(state.settings.muted);
        panel.querySelector('[data-setting="autoResume"]').checked = Boolean(state.settings.autoResume);
        panel.querySelector('[data-setting="stallMinutes"]').value = String(state.settings.stallMinutes);
        panel.querySelector('[data-setting="closeOnStall"]').checked = Boolean(state.settings.closeOnStall);

        panel.querySelector('[data-action="pause"]').disabled = state.status !== 'running';
        panel.querySelector('[data-action="continue"]').disabled = state.status !== 'paused';
        panel.querySelector('[data-action="skip"]').disabled = !state.currentLessonTitle || !['running', 'paused'].includes(state.status);
        panel.querySelector('[data-action="stop"]').disabled = !['running', 'paused'].includes(state.status);
        updateLogCount();
        updateBridgeStatus();
    }

    function handlePanelAction(action) {
        const state = getState();
        debugLog('info', 'panel-action', { action, status: state.status, phase: state.phase });
        if (action === 'copylog') {
            copyLogs();
            return;
        }
        if (action === 'downloadlog') {
            downloadLogs();
            return;
        }
        if (action === 'clearlog') {
            clearLogs();
            return;
        }
        if (action === 'installupdate') {
            const availableUpdate = getAvailableUpdate();
            const updateUrl = availableUpdate?.url || UPDATE_URL;
            debugLog('info', 'script-update-install-opened', {
                currentVersion: VERSION,
                remoteVersion: availableUpdate?.version || 'unknown'
            });
            GM_openInTab(updateUrl, { active: true, insert: true, setParent: true });
            return;
        }
        if (action === 'start') {
            if (!isListRoute() && !isDetailRoute()) {
                updateState({ message: '请先手动进入“专题学习 → 在学”页面' });
                return;
            }
            const freshRun = ['idle', 'stopped', 'complete'].includes(state.status);
            const resetSkipped = freshRun || state.phase === 'all-unfinished-skipped';
            updateState({
                status: 'running',
                phase: isListRoute() ? 'list-ready' : 'detail-ready',
                message: '已启动，正在读取当前页面',
                lastActionAt: 0,
                refreshAttempts: 0,
                currentLessonTitle: freshRun ? '' : state.currentLessonTitle,
                currentLessonKey: freshRun ? '' : state.currentLessonKey,
                finishedWorkshopTitles: freshRun ? [] : state.finishedWorkshopTitles,
                skippedLessonKeys: resetSkipped ? [] : state.skippedLessonKeys,
                skipRequestAt: 0,
                stopRequestAt: 0,
                completedCloseRequestAt: 0,
                completedCloseAttempts: 0,
                completedCloseStartedAt: 0,
                closingPlayerSessionId: '',
                closingPlayerLastSeenAt: 0,
                closingPlayerUnloadAt: 0,
                serverCompletedLessonKeys: freshRun ? [] : state.serverCompletedLessonKeys,
                openAttempts: 0,
                fallbackOpenAttempted: false
            });
            scheduleMainTick();
            return;
        }

        if (action === 'pause') {
            updateState({ status: 'paused', message: '已暂停；播放器会暂停，点击“继续”恢复' });
            return;
        }
        if (action === 'continue') {
            const retryPlayerOpen = state.phase === 'player-open-failed' && isDetailRoute();
            const continueAfterManualClose = state.phase === 'completed-close-failed' && isDetailRoute();
            const recheckUnverifiedCompletion = state.phase === 'completion-unverified' && isDetailRoute();
            updateState({
                status: 'running',
                phase: retryPlayerOpen || continueAfterManualClose
                    ? 'detail-ready'
                    : recheckUnverifiedCompletion
                        ? 'checking-progress'
                        : state.phase,
                openAttempts: 0,
                fallbackOpenAttempted: false,
                currentLessonTitle: continueAfterManualClose ? '' : state.currentLessonTitle,
                currentLessonKey: continueAfterManualClose ? '' : state.currentLessonKey,
                completedCloseRequestAt: 0,
                completedCloseAttempts: 0,
                completedCloseStartedAt: 0,
                closingPlayerSessionId: '',
                closingPlayerLastSeenAt: 0,
                closingPlayerUnloadAt: 0,
                message: '继续运行'
            });
            if (retryPlayerOpen && openCurrentLessonFromUserGesture()) return;
            if (recheckUnverifiedCompletion) {
                location.reload();
                return;
            }
            scheduleMainTick();
            return;
        }
        if (action === 'stop') {
            updateState({
                status: 'stopped', phase: 'stopped', message: '已停止', stopRequestAt: Date.now()
            });
            return;
        }
        if (action === 'skip') {
            if (!state.currentLessonKey) return;
            updateState({
                status: 'running',
                phase: 'closing-player',
                skippedLessonKeys: uniqueAppend(state.skippedLessonKeys, state.currentLessonKey),
                skipRequestAt: Date.now(),
                completedCloseRequestAt: 0,
                completedCloseAttempts: 0,
                completedCloseStartedAt: 0,
                closingPlayerSessionId: '',
                closingPlayerLastSeenAt: 0,
                closingPlayerUnloadAt: 0,
                message: `本轮跳过：${state.currentLessonTitle}`,
                currentLessonTitle: '',
                currentLessonKey: '',
                refreshAttempts: 0
            });
            setTimeout(scheduleMainTick, 1500);
            return;
        }
        if (action === 'recheck') {
            updateState({
                status: state.status === 'paused' ? 'paused' : 'running',
                phase: isDetailRoute() ? 'checking-progress' : 'list-ready',
                message: '重新加载并检查服务器进度',
                refreshAttempts: 0
            });
            location.reload();
        }
    }

    function scheduleMainTick() {
        clearTimeout(mainTickTimer);
        mainTickTimer = setTimeout(mainTick, 250);
    }

    function mainTick() {
        renderPanel(getState());
        const state = getState();
        syncServerStatusMonitor(state);
        if (state.status !== 'running') return;

        if (isListRoute()) {
            handleListPage(state);
        } else if (isDetailRoute()) {
            handleDetailPage(state);
        } else if (isAnyWorkshopListRoute()) {
            logDomSummary('non-studying-list-ignored', { classType: currentClassType(), hash: location.hash });
            updateState({
                phase: 'waiting-studying-list',
                message: `当前列表 classType=${currentClassType() || '未知'}，不会按“在学”列表处理`
            });
        } else {
            updateState({ message: '等待用户进入“专题学习 → 在学”' });
        }
        clearTimeout(mainTickTimer);
        mainTickTimer = setTimeout(mainTick, TICK_MS);
    }

    function handleListPage(state) {
        const list = document.querySelector('.content-div .list_box');
        if (!list) {
            emptyStudyingListSeenAt = 0;
            logDomSummary('list-waiting', { hasContentDiv: Boolean(document.querySelector('.content-div')) });
            updateState({ phase: 'list-loading', message: '等待“在学”课程列表加载' });
            return;
        }

        const page = getActivePageNumber();
        const cards = [...list.querySelectorAll(':scope > .item_box')].map((box) => {
            const item = box.querySelector('.list_item') || box;
            return {
                box,
                title: normalizeText(item.querySelector('.title')?.textContent),
                button: item.querySelector('button.item_enter_button, button#enter_button')
            };
        }).filter((card) => card.title && card.button);

        if (!cards.length) {
            const loading = [...document.querySelectorAll('.el-loading-mask')].some(isVisible);
            if (!emptyStudyingListSeenAt) emptyStudyingListSeenAt = Date.now();
            const emptyForMs = Date.now() - emptyStudyingListSeenAt;
            logDomSummary('studying-list-empty-pending', { page, loading, emptyForMs });
            if (loading || emptyForMs < 8000) {
                updateState({
                    phase: 'list-loading',
                    message: `“在学”列表暂时为空，等待加载确认（${Math.ceil((8000 - emptyForMs) / 1000)} 秒）`
                });
                return;
            }
        } else {
            emptyStudyingListSeenAt = 0;
        }

        logDomSummary('list-read', {
            page,
            cardCount: cards.length,
            titles: cards.map((card) => card.title),
            nextEnabled: Boolean(document.querySelector('.el-pagination .btn-next:not([disabled])'))
        });

        const nextCard = cards.find((card) => !state.finishedWorkshopTitles.includes(card.title));
        if (nextCard) {
            if (state.phase === 'entering-workshop' && Date.now() - state.lastActionAt < 20000) return;
            updateState({
                phase: 'entering-workshop',
                message: `进入第 ${page} 页专题`,
                currentPage: page,
                currentWorkshopTitle: nextCard.title,
                currentWorkshopLessonTitles: [],
                currentClassId: '',
                currentLessonTitle: '',
                currentLessonKey: '',
                currentLessonProgress: 0,
                skippedLessonKeys: [],
                lastActionAt: Date.now()
            });
            debugLog('info', 'workshop-open-click', { page, title: nextCard.title });
            nextCard.button.click();
            return;
        }

        const nextButton = document.querySelector('.el-pagination .btn-next:not([disabled])');
        if (nextButton) {
            if (state.phase === 'changing-page' && Date.now() - state.lastActionAt < 5000) return;
            updateState({ phase: 'changing-page', message: `第 ${page} 页已处理，前往下一页`, lastActionAt: Date.now() });
            debugLog('info', 'pagination-next-click', { fromPage: page });
            nextButton.click();
            return;
        }

        updateState({
            status: 'complete', phase: 'complete', message: '“在学”列表中已没有待处理专题',
            currentWorkshopTitle: '', currentLessonTitle: '', currentLessonKey: ''
        });
        debugLog('info', 'studying-list-processing-complete', {
            page,
            emptyCardList: cards.length === 0,
            stableEmptyMs: cards.length === 0 ? Date.now() - emptyStudyingListSeenAt : 0
        });
    }

    function readLessons(rootDocument = document) {
        return [...rootDocument.querySelectorAll('#pane-required .item_box')].map((box, index) => {
            const titleElement = box.querySelector('.item_title');
            const progressElement = box.querySelector('[role="progressbar"][aria-valuenow]');
            const progress = Number.parseFloat(progressElement?.getAttribute('aria-valuenow') || '0');
            const status = normalizeText(box.querySelector('.item_status')?.textContent);
            const title = normalizeText(titleElement?.textContent);
            return {
                index,
                box,
                titleElement,
                title,
                progress: Number.isFinite(progress) ? progress : 0,
                status,
                // This site marks completion independently of the position bar (for
                // example, 95.68% can already be shown as 已完成). Use the explicit
                // server status only; percentage is diagnostic data, not a gate.
                complete: status.includes('已完成')
            };
        }).filter((lesson) => lesson.title && lesson.titleElement);
    }

    function syncVisibleDetailFromProbe(probeDocument, probeLessons) {
        if (!probeDocument || probeDocument === document || !isDetailRoute()) return;
        const visibleLessons = readLessons(document);
        if (!visibleLessons.length) return;

        const visibleByTitle = new Map(visibleLessons.map((lesson) => [lesson.title, lesson]));
        const changes = [];
        for (const probeLesson of probeLessons) {
            const visibleLesson = visibleByTitle.get(probeLesson.title);
            if (!visibleLesson) continue;

            const beforeProgress = visibleLesson.progress;
            const beforeStatus = visibleLesson.status;
            const sourceProgress = probeLesson.box.querySelector('[role="progressbar"][aria-valuenow]');
            const targetProgress = visibleLesson.box.querySelector('[role="progressbar"][aria-valuenow]');
            if (sourceProgress && targetProgress) {
                for (const attribute of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) {
                    const value = sourceProgress.getAttribute(attribute);
                    if (value !== null) targetProgress.setAttribute(attribute, value);
                }
                const sourceBar = sourceProgress.querySelector('.el-progress-bar__inner');
                const targetBar = targetProgress.querySelector('.el-progress-bar__inner');
                if (sourceBar && targetBar) {
                    targetBar.className = sourceBar.className;
                    targetBar.style.cssText = sourceBar.style.cssText;
                }
                const sourceText = sourceProgress.querySelector('.el-progress__text')
                    || probeLesson.box.querySelector('.el-progress__text');
                const targetText = targetProgress.querySelector('.el-progress__text')
                    || visibleLesson.box.querySelector('.el-progress__text');
                if (sourceText && targetText) {
                    targetText.textContent = sourceText.textContent;
                    targetText.style.cssText = sourceText.style.cssText;
                }
            }

            const sourceStatus = probeLesson.box.querySelector('.item_status');
            const targetStatus = visibleLesson.box.querySelector('.item_status');
            if (sourceStatus && targetStatus) {
                targetStatus.replaceChildren(...[...sourceStatus.childNodes].map((node) => node.cloneNode(true)));
                targetStatus.className = sourceStatus.className;
                targetStatus.style.cssText = sourceStatus.style.cssText;
            }

            if (beforeProgress !== probeLesson.progress || beforeStatus !== probeLesson.status) {
                changes.push({
                    lesson: probeLesson.title,
                    fromProgress: beforeProgress,
                    toProgress: probeLesson.progress,
                    fromStatus: beforeStatus,
                    toStatus: probeLesson.status
                });
            }
        }

        const sourceRequiredTab = probeDocument.querySelector('#tab-required');
        const targetRequiredTab = document.querySelector('#tab-required');
        if (sourceRequiredTab && targetRequiredTab
            && normalizeText(sourceRequiredTab.textContent) !== normalizeText(targetRequiredTab.textContent)) {
            targetRequiredTab.textContent = sourceRequiredTab.textContent;
        }

        if (changes.length) {
            const snapshot = JSON.stringify(changes.map((change) => [
                change.lesson, change.toProgress, change.toStatus
            ]));
            if (snapshot !== lastVisibleProbeSyncSnapshot) {
                lastVisibleProbeSyncSnapshot = snapshot;
                debugLog('info', 'visible-detail-synced-from-live-probe', {
                    changedCount: changes.length,
                    changes
                });
            }
        }
    }

    function serverStatusProbeIsActive(state = getState()) {
        return window.top === window
            && isDetailRoute()
            && state.status === 'running'
            && Boolean(state.currentLessonTitle)
            && ['opening-video', 'watching-video', 'checking-progress', 'refresh-delay'].includes(state.phase);
    }

    function serverStatusProbeUrl() {
        const [base, hash = ''] = String(location.href).split('#');
        const separator = base.includes('?') ? '&' : '?';
        return `${base}${separator}_gbpx_status_probe=${Date.now()}${hash ? `#${hash}` : ''}`;
    }

    function stopServerStatusMonitor(reason = 'inactive') {
        if (serverStatusMonitorTimer) {
            clearInterval(serverStatusMonitorTimer);
            serverStatusMonitorTimer = null;
        }
        if (serverStatusProbeRetryTimer) {
            clearTimeout(serverStatusProbeRetryTimer);
            serverStatusProbeRetryTimer = null;
        }
        if (serverStatusFrame) {
            serverStatusFrame.remove();
            serverStatusFrame = null;
        }
        if (serverStatusFrameKey) {
            debugLog('info', 'server-status-monitor-stopped', { reason });
        }
        serverStatusFrameKey = '';
        serverStatusFrameReady = false;
        serverStatusProbeStartedAt = 0;
        lastServerStatusSnapshot = '';
    }

    function reloadServerStatusFrame(reason = 'interval') {
        if (!serverStatusFrame) return false;
        if (serverStatusProbeRetryTimer) {
            clearTimeout(serverStatusProbeRetryTimer);
            serverStatusProbeRetryTimer = null;
        }
        serverStatusFrameReady = false;
        serverStatusProbeStartedAt = Date.now();
        serverStatusFrame.src = serverStatusProbeUrl();
        debugLog('info', 'server-status-probe-reload', {
            reason,
            lesson: getState().currentLessonTitle
        });
        return true;
    }

    function confirmServerCompletion(lesson, source = 'detail-dom') {
        const state = getState();
        if (!lesson?.complete || state.status !== 'running' || !state.currentLessonTitle) return false;
        if (lesson.title !== state.currentLessonTitle || state.phase === 'closing-completed-player') return false;
        const completedKey = lessonKey(state.currentClassId || currentClassId(), lesson.title);
        const completedLessonKeys = uniqueAppend(state.serverCompletedLessonKeys, completedKey);
        const now = Date.now();
        const heartbeat = getPlayerHeartbeat();
        const matchingHeartbeat = heartbeat?.lessonKey === completedKey ? heartbeat : null;
        updateState({
            phase: 'closing-completed-player',
            message: `服务器已确认完成：${lesson.title}；正在关闭播放器`,
            currentLessonProgress: lesson.progress,
            refreshAttempts: 0,
            lastActionAt: now,
            completedCloseRequestAt: now,
            completedCloseAttempts: 1,
            completedCloseStartedAt: now,
            closingPlayerSessionId: matchingHeartbeat?.sessionId || '',
            closingPlayerLastSeenAt: Number(matchingHeartbeat?.at || 0),
            closingPlayerUnloadAt: 0,
            serverCompletedLessonKeys: completedLessonKeys
        });
        debugLog('info', 'server-completion-confirmed-close-requested', {
            source,
            lessonKey: completedKey,
            lesson: lesson.title,
            status: lesson.status,
            progress: lesson.progress,
            playerSessionId: matchingHeartbeat?.sessionId || '',
            heartbeatAgeMs: matchingHeartbeat ? now - Number(matchingHeartbeat.at || 0) : null,
            serverCompletedLessonKeys: completedLessonKeys
        });
        stopServerStatusMonitor('completion-confirmed');
        return true;
    }

    function confirmCompletedPlayerClosed(state, reason, heartbeat = null) {
        clearTimeout(detailRefreshTimer);
        updateState({
            phase: 'detail-ready',
            message: '已确认播放器停止响应，准备下一节',
            currentLessonTitle: '',
            currentLessonKey: '',
            currentLessonProgress: 100,
            refreshAttempts: 0,
            completedCloseRequestAt: 0,
            completedCloseAttempts: 0,
            completedCloseStartedAt: 0,
            closingPlayerSessionId: '',
            closingPlayerLastSeenAt: 0,
            closingPlayerUnloadAt: 0,
            lastActionAt: Date.now()
        });
        debugLog('info', 'completed-player-close-confirmed', {
            lessonKey: state.currentLessonKey,
            playerSessionId: state.closingPlayerSessionId || heartbeat?.sessionId || '',
            reason,
            lastHeartbeatAt: heartbeat?.at || state.closingPlayerLastSeenAt || 0,
            heartbeatSilenceMs: heartbeat?.at ? Date.now() - Number(heartbeat.at) : null
        });
        setTimeout(scheduleMainTick, PLAYER_REOPEN_COOLDOWN_MS);
    }

    function readServerStatusProbeDocument() {
        if (!serverStatusFrame || !serverStatusFrame.contentDocument) return;
        const state = getState();
        if (!serverStatusProbeIsActive(state)) return;
        const lessons = readLessons(serverStatusFrame.contentDocument);
        if (!lessons.length) {
            if (Date.now() - serverStatusProbeStartedAt > SERVER_STATUS_PROBE_TIMEOUT_MS) {
                debugLog('warn', 'server-status-probe-empty-timeout', {
                    lesson: state.currentLessonTitle,
                    readyState: serverStatusFrame.contentDocument.readyState
                });
                serverStatusProbeStartedAt = Date.now();
                return;
            }
            if (!serverStatusProbeRetryTimer) {
                serverStatusProbeRetryTimer = setTimeout(() => {
                    serverStatusProbeRetryTimer = null;
                    readServerStatusProbeDocument();
                }, 500);
            }
            return;
        }
        syncVisibleDetailFromProbe(serverStatusFrame.contentDocument, lessons);
        const lesson = lessons.find((item) => item.title === state.currentLessonTitle);
        if (!lesson) {
            debugLog('warn', 'server-status-probe-current-lesson-missing', {
                lesson: state.currentLessonTitle,
                lessonCount: lessons.length,
                titles: lessons.map((item) => item.title)
            });
            return;
        }
        const snapshot = `${lesson.title}|${lesson.status}|${lesson.progress}`;
        if (snapshot !== lastServerStatusSnapshot) {
            lastServerStatusSnapshot = snapshot;
            debugLog('info', 'server-status-probe-result', {
                lesson: lesson.title,
                status: lesson.status,
                progress: lesson.progress,
                complete: lesson.complete
            });
        }
        if (confirmServerCompletion(lesson, 'live-server-status-probe')) return;
        if (state.currentLessonProgress !== lesson.progress) {
            updateState({ currentLessonProgress: lesson.progress });
            debugLog('info', 'panel-progress-synced-from-live-probe', {
                lesson: lesson.title,
                status: lesson.status,
                progress: lesson.progress
            });
        }
    }

    function syncServerStatusMonitor(state = getState()) {
        if (!serverStatusProbeIsActive(state)) {
            stopServerStatusMonitor('state-not-active');
            return;
        }
        const key = lessonKey(state.currentClassId, state.currentLessonTitle);
        if (serverStatusFrame && serverStatusFrameKey !== key) {
            stopServerStatusMonitor('lesson-changed');
        }
        if (!serverStatusFrame) {
            serverStatusFrameKey = key;
            serverStatusFrame = document.createElement('iframe');
            serverStatusFrame.setAttribute('aria-hidden', 'true');
            serverStatusFrame.tabIndex = -1;
            serverStatusFrame.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:2px;height:2px;border:0;opacity:0;pointer-events:none;';
            serverStatusFrame.addEventListener('load', () => {
                serverStatusFrameReady = true;
                debugLog('info', 'server-status-probe-loaded', {
                    lesson: getState().currentLessonTitle,
                    readyState: serverStatusFrame?.contentDocument?.readyState || 'unknown'
                });
                readServerStatusProbeDocument();
            });
            serverStatusFrame.addEventListener('error', () => {
                serverStatusFrameReady = false;
                debugLog('warn', 'server-status-probe-load-error', { lesson: getState().currentLessonTitle });
            });
            document.body.appendChild(serverStatusFrame);
            debugLog('info', 'server-status-monitor-started', {
                lesson: state.currentLessonTitle,
                classId: state.currentClassId,
                intervalMs: SERVER_STATUS_PROBE_INTERVAL_MS
            });
            reloadServerStatusFrame('initial');
            serverStatusMonitorTimer = setInterval(() => {
                const latest = getState();
                if (!serverStatusProbeIsActive(latest)) {
                    stopServerStatusMonitor('interval-state-not-active');
                    return;
                }
                reloadServerStatusFrame(serverStatusFrameReady ? 'interval' : 'not-ready-retry');
            }, SERVER_STATUS_PROBE_INTERVAL_MS);
        }
    }

    function lessonKey(classId, title) {
        return `${classId || 'unknown'}::${title}`;
    }

    const PLAYER_FALLBACK_URL = 'https://wcs1.shawcoder.xyz/gdcecw/play_pc/playdo_pc.html';

    function openPlayerFallbackTab() {
        try {
            if (fallbackPlayerTab && typeof fallbackPlayerTab.close === 'function') {
                debugLog('info', 'player-open-fallback-already-exists');
                return true;
            }
            const tab = GM_openInTab(PLAYER_FALLBACK_URL, {
                active: true,
                insert: true,
                setParent: true
            });
            fallbackPlayerTab = tab || null;
            debugLog('warn', 'player-open-fallback-tab', {
                url: PLAYER_FALLBACK_URL,
                hasCloseHandle: Boolean(tab && typeof tab.close === 'function')
            });
            return true;
        } catch (error) {
            debugLog('error', 'player-open-fallback-failed', { error });
            return false;
        }
    }

    function openCurrentLessonFromUserGesture() {
        const state = getState();
        if (!isDetailRoute() || !state.currentLessonTitle) return false;
        const lesson = readLessons().find((item) => item.title === state.currentLessonTitle);
        if (!lesson?.titleElement) {
            debugLog('warn', 'user-gesture-open-target-missing', { lesson: state.currentLessonTitle });
            return false;
        }
        updateState({
            phase: 'opening-video',
            message: '正在通过“继续”的用户点击重新打开播放器',
            lastActionAt: Date.now(),
            openAttempts: 0,
            fallbackOpenAttempted: false
        });
        debugLog('info', 'lesson-open-user-gesture', { title: lesson.title, index: lesson.index });
        lesson.titleElement.scrollIntoView({ block: 'center', behavior: 'auto' });
        lesson.titleElement.click();
        return true;
    }

    function handleDetailPage(state) {
        const lessons = readLessons();
        if (!lessons.length) {
            logDomSummary('detail-waiting', {
                hasRequiredPane: Boolean(document.querySelector('#pane-required')),
                itemBoxes: document.querySelectorAll('#pane-required .item_box').length
            });
            updateState({ phase: 'detail-loading', message: '等待必修课程列表加载' });
            return;
        }

        const classId = currentClassId();
        if (state.phase === 'detail-ready' && state.lastActionAt && Date.now() - state.lastActionAt < PLAYER_REOPEN_COOLDOWN_MS) {
            return;
        }
        logDomSummary('detail-read', {
            classId,
            lessonCount: lessons.length,
            completeCount: lessons.filter((lesson) => lesson.complete).length,
            lessons: lessons.map((lesson) => ({ title: lesson.title, progress: lesson.progress, status: lesson.status }))
        });
        const lessonTitles = lessons.map((lesson) => lesson.title);
        if (state.currentClassId !== classId) {
            lastLessonSelectionSnapshot = '';
            lastIgnoredDetailProgressSnapshot = '';
            state = updateState({
                currentClassId: classId,
                currentWorkshopLessonTitles: lessonTitles,
                phase: 'detail-ready',
                message: `已读取 ${lessons.length} 个必修课程`,
                serverCompletedLessonKeys: []
            });
        } else if (JSON.stringify(state.currentWorkshopLessonTitles) !== JSON.stringify(lessonTitles)) {
            state = updateState({ currentWorkshopLessonTitles: lessonTitles });
        }

        const currentLesson = lessons.find((lesson) => lesson.title === state.currentLessonTitle);
        if (currentLesson && state.currentLessonTitle && state.currentLessonProgress !== currentLesson.progress) {
            const currentProgress = Number(state.currentLessonProgress || 0);
            const visibleProgress = Number(currentLesson.progress || 0);
            const staleVisibleProgress = serverStatusProbeIsActive(state)
                && !currentLesson.complete
                && visibleProgress < currentProgress;
            if (staleVisibleProgress) {
                const snapshot = `${state.currentLessonKey}|${currentProgress}|${visibleProgress}|${currentLesson.status}`;
                if (snapshot !== lastIgnoredDetailProgressSnapshot) {
                    lastIgnoredDetailProgressSnapshot = snapshot;
                    debugLog('info', 'panel-progress-stale-detail-ignored', {
                        lesson: currentLesson.title,
                        lessonKey: state.currentLessonKey,
                        probeProgress: currentProgress,
                        visibleDetailProgress: visibleProgress,
                        visibleDetailStatus: currentLesson.status,
                        reason: 'live-probe-progress-is-newer'
                    });
                }
            } else {
                lastIgnoredDetailProgressSnapshot = '';
                state = updateState({
                    currentLessonProgress: currentLesson.progress
                });
                debugLog('info', 'panel-progress-synced-from-detail', {
                    lesson: currentLesson.title,
                    progress: currentLesson.progress,
                    status: currentLesson.status
                });
            }
        }
        if (currentLesson && state.currentLessonTitle) {
            const currentKey = lessonKey(classId, currentLesson.title);
            if (currentKey !== lastAutoScrolledLessonKey) {
                lastAutoScrolledLessonKey = currentKey;
                currentLesson.titleElement.scrollIntoView({ block: 'center', behavior: 'auto' });
                debugLog('info', 'current-lesson-auto-scrolled', {
                    lesson: currentLesson.title,
                    progress: currentLesson.progress,
                    status: currentLesson.status
                });
            }
        }
        // The explicit server status text is the source of truth. During playback
        // the hidden same-origin probe supplies a fresh detail DOM without
        // reloading or interrupting the visible page.
        if (state.phase === 'watching-video' && currentLesson?.complete) {
            confirmServerCompletion(currentLesson, 'visible-detail-dom');
            return;
        }
        if (state.phase === 'checking-progress' || state.phase === 'refresh-delay') {
            if (!currentLesson) {
                updateState({
                    status: 'paused',
                    phase: 'completion-unverified',
                    message: '刷新后找不到当前课程，无法确认完成状态；请检查后点“重新检查”',
                    refreshAttempts: 0
                });
                debugLog('warn', 'current-lesson-missing-before-completion-confirmation', {
                    lesson: state.currentLessonTitle,
                    lessonKey: state.currentLessonKey
                });
                return;
            } else if (currentLesson.complete) {
                // A media ended event is not proof of completion. Only the
                // explicit 已完成 status may request a player close.
                confirmServerCompletion(currentLesson, 'visible-detail-dom');
                return;
            } else {
                if (state.phase === 'refresh-delay' && Date.now() - state.lastActionAt < 6500) return;
                const attempt = Math.min(9999, Number(state.refreshAttempts || 0) + 1);
                updateState({
                    phase: 'refresh-delay',
                    message: `等待服务器标记“已完成”（第 ${attempt} 次实时复查）`,
                    currentLessonProgress: currentLesson.progress,
                    refreshAttempts: attempt,
                    lastActionAt: Date.now()
                });
                clearTimeout(detailRefreshTimer);
                debugLog('info', 'server-status-probe-rescheduled', {
                    attempt,
                    delayMs: 6500,
                    progress: currentLesson.progress,
                    status: currentLesson.status
                });
                detailRefreshTimer = setTimeout(() => {
                    const latest = getState();
                    if (latest.status !== 'running' || !isDetailRoute()) return;
                    updateState({ phase: 'checking-progress', message: '实时复查服务器“已完成”状态', lastActionAt: Date.now() });
                    reloadServerStatusFrame('retry-after-video-close');
                    scheduleMainTick();
                }, 6500);
                return;
            }
        }

        if (['opening-video', 'watching-video', 'closing-player', 'awaiting-detail-refresh', 'closing-completed-player'].includes(state.phase)) {
            const age = Date.now() - state.lastActionAt;
            if (state.phase === 'closing-completed-player') {
                const now = Date.now();
                const heartbeat = getPlayerHeartbeat();
                const heartbeatMatches = Boolean(heartbeat)
                    && (heartbeat.lessonKey === state.currentLessonKey
                        || (state.closingPlayerSessionId && heartbeat.sessionId === state.closingPlayerSessionId));
                if (heartbeatMatches && !state.closingPlayerSessionId && heartbeat.sessionId) {
                    state = updateState({
                        closingPlayerSessionId: heartbeat.sessionId,
                        closingPlayerLastSeenAt: Number(heartbeat.at || 0)
                    });
                }
                const lastSeenAt = Math.max(
                    Number(state.closingPlayerLastSeenAt || 0),
                    heartbeatMatches ? Number(heartbeat.at || 0) : 0
                );
                const closeStartedAt = Number(state.completedCloseStartedAt || state.completedCloseRequestAt || 0);
                const closeAge = closeStartedAt ? now - closeStartedAt : 0;
                const silenceAge = lastSeenAt ? now - lastSeenAt : 0;
                if (lastSeenAt
                    && closeAge >= PLAYER_CLOSE_MIN_CONFIRM_MS
                    && silenceAge >= PLAYER_CLOSE_HEARTBEAT_SILENCE_MS) {
                    confirmCompletedPlayerClosed(state, 'matching-player-heartbeat-silent', heartbeatMatches ? heartbeat : null);
                    return;
                }
            }
            if (state.phase === 'closing-completed-player' && age > COMPLETED_CLOSE_RETRY_MS && Number(state.completedCloseAttempts || 1) < MAX_COMPLETED_CLOSE_RETRIES) {
                const attempts = Number(state.completedCloseAttempts || 1) + 1;
                const requestAt = Date.now();
                updateState({
                    lastActionAt: requestAt,
                    completedCloseRequestAt: requestAt,
                    completedCloseAttempts: attempts,
                    message: `服务器已确认完成，正在重试关闭播放器 (${attempts}/${MAX_COMPLETED_CLOSE_RETRIES})`
                });
                debugLog('warn', 'completed-player-close-retry', {
                    lessonKey: state.currentLessonKey,
                    lesson: state.currentLessonTitle,
                    attempt: attempts,
                    waitedMs: age,
                    playerSessionId: state.closingPlayerSessionId,
                    heartbeat: getPlayerHeartbeat()
                });
                return;
            }
            if (state.phase === 'closing-completed-player' && age > COMPLETED_CLOSE_GRACE_MS) {
                updateState({
                    status: 'paused',
                    phase: 'completed-close-failed',
                    message: '服务器已确认课程完成，但播放器未确认关闭；请手动关闭播放器后点“继续”',
                    completedCloseRequestAt: 0
                });
                debugLog('warn', 'completed-player-close-not-confirmed', {
                    lessonKey: lessonKey(state.currentClassId, state.currentLessonTitle),
                    lesson: state.currentLessonTitle,
                    waitedMs: age,
                    phase: state.phase,
                    completedCloseAttempts: state.completedCloseAttempts
                });
                return;
            }
            if (state.phase === 'opening-video' && age > 30000) {
                const attempts = Number(state.openAttempts || 0) + 1;
                if (attempts >= 3) {
                    if (!state.fallbackOpenAttempted && openPlayerFallbackTab()) {
                        updateState({
                            phase: 'opening-video',
                            openAttempts: attempts,
                            fallbackOpenAttempted: true,
                            lastActionAt: Date.now(),
                            message: '常规弹窗未启动，已使用扩展标签页兜底打开播放器'
                        });
                        debugLog('warn', 'player-open-fallback-started', {
                            lesson: state.currentLessonTitle,
                            attempts
                        });
                    } else {
                        updateState({
                            status: 'paused',
                            phase: 'player-open-failed',
                            openAttempts: attempts,
                            message: '常规弹窗和标签页兜底均未启动；请确认播放器域名允许弹窗后点击“继续”'
                        });
                        debugLog('warn', 'player-open-retries-exhausted', {
                            lesson: state.currentLessonTitle,
                            attempts,
                            fallbackOpenAttempted: Boolean(state.fallbackOpenAttempted)
                        });
                    }
                } else {
                    updateState({
                        phase: 'detail-ready',
                        openAttempts: attempts,
                        message: `未检测到播放器启动，准备第 ${attempts + 1} 次尝试`,
                        lastActionAt: 0
                    });
                }
            }
            return;
        }

        const serverCompletedLessonKeys = Array.isArray(state.serverCompletedLessonKeys)
            ? state.serverCompletedLessonKeys
            : [];
        const selectionRows = lessons.map((lesson) => {
            const key = lessonKey(classId, lesson.title);
            const isServerCompleted = serverCompletedLessonKeys.includes(key);
            const isSkipped = state.skippedLessonKeys.includes(key);
            const reason = lesson.complete
                ? 'dom-complete'
                : isServerCompleted
                    ? 'server-completed-memory'
                    : isSkipped
                        ? 'skipped-memory'
                        : 'eligible';
            return {
                index: lesson.index,
                lessonKey: key,
                title: lesson.title,
                status: lesson.status,
                progress: lesson.progress,
                complete: lesson.complete,
                isServerCompleted,
                isSkipped,
                reason
            };
        });
        const selectionSnapshot = JSON.stringify({
            classId,
            phase: state.phase,
            currentLessonKey: state.currentLessonKey,
            rows: selectionRows.map((row) => [row.lessonKey, row.status, row.progress, row.reason])
        });
        if (selectionSnapshot !== lastLessonSelectionSnapshot) {
            lastLessonSelectionSnapshot = selectionSnapshot;
            debugLog('info', 'lesson-selection-evaluated', {
                classId,
                phase: state.phase,
                currentLessonKey: state.currentLessonKey,
                currentLessonTitle: state.currentLessonTitle,
                serverCompletedLessonKeys,
                skippedLessonKeys: state.skippedLessonKeys,
                rows: selectionRows
            });
        }
        const unfinished = lessons.filter((lesson) => {
            if (lesson.complete) return false;
            return !serverCompletedLessonKeys.includes(lessonKey(classId, lesson.title));
        });
        if (!unfinished.length) {
            const title = state.currentWorkshopTitle || `classId:${classId}`;
            updateState({
                phase: 'returning-list',
                message: `专题必修课已全部完成，返回“在学”`,
                finishedWorkshopTitles: uniqueAppend(state.finishedWorkshopTitles, title),
                currentLessonTitle: '', currentLessonKey: '', refreshAttempts: 0,
                lastActionAt: Date.now()
            });
            debugLog('info', 'workshop-all-lessons-complete', { classId, lessonCount: lessons.length });
            returnToStudyingList();
            return;
        }

        const nextLesson = unfinished.find((lesson) => {
            const key = lessonKey(classId, lesson.title);
            return !state.skippedLessonKeys.includes(key) && !serverCompletedLessonKeys.includes(key);
        });
        if (!nextLesson) {
            debugLog('warn', 'lesson-selection-no-candidate', {
                classId,
                lessonCount: lessons.length,
                serverCompletedLessonKeys,
                skippedLessonKeys: state.skippedLessonKeys,
                rows: selectionRows
            });
            updateState({
                status: 'paused', phase: 'all-unfinished-skipped',
                message: '当前专题剩余未完成课程均已被本轮跳过；点击“开始”可清除跳过记录重试'
            });
            return;
        }

        const key = lessonKey(classId, nextLesson.title);
        const sameLesson = state.currentLessonKey === key;
        updateState({
            phase: 'opening-video',
            message: `打开必修 ${nextLesson.index + 1}/${lessons.length}`,
            currentLessonTitle: nextLesson.title,
            currentLessonKey: key,
            currentLessonProgress: nextLesson.progress,
            beforeProgress: nextLesson.progress,
            fallbackOpenAttempted: sameLesson ? Boolean(state.fallbackOpenAttempted) : false,
            lastActionAt: Date.now(),
            refreshAttempts: 0,
            openAttempts: sameLesson ? Number(state.openAttempts || 0) : 0
        });
        debugLog('info', 'lesson-open-click', {
            classId,
            index: nextLesson.index,
            lessonKey: key,
            title: nextLesson.title,
            status: nextLesson.status,
            complete: nextLesson.complete,
            progress: nextLesson.progress,
            currentLessonKey: state.currentLessonKey,
            serverCompletedLessonKeys,
            skippedLessonKeys: state.skippedLessonKeys
        });
        nextLesson.titleElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(() => nextLesson.titleElement.click(), 350);
    }

    function returnToStudyingList() {
        const menuItems = [...document.querySelectorAll('.el-menu-item')];
        const studying = menuItems.find((item) => normalizeText(item.textContent) === '在学');
        if (studying) {
            studying.click();
            setTimeout(() => {
                if (isDetailRoute()) location.hash = '#/workshop/workshopindex/classList?classType=3';
            }, 2500);
        } else {
            location.hash = '#/workshop/workshopindex/classList?classType=3';
        }
    }

    function handlePlayerEvent(event) {
        if (!event || !event.id || event.id === lastHandledEventId) return;
        lastHandledEventId = event.id;
        const state = getState();
        debugLog('info', 'player-event-received', { event, status: state.status, phase: state.phase });

        if (event.lessonKey && state.currentLessonKey && event.lessonKey !== state.currentLessonKey) {
            debugLog('warn', 'stale-player-event-ignored', {
                type: event.type,
                eventLessonKey: event.lessonKey,
                currentLessonKey: state.currentLessonKey,
                currentLessonTitle: state.currentLessonTitle
            });
            return;
        }

        if (event.type === 'video-started' && state.status === 'running') {
            if (state.phase === 'closing-completed-player') {
                debugLog('info', 'completion-close-ignores-video-start', { lessonKey: event.lessonKey });
                return;
            }
            updateState({
                phase: 'watching-video',
                message: `播放器已开始（${event.rate || state.settings.playbackRate}×）`,
                lastActionAt: Date.now(),
                openAttempts: 0,
                fallbackOpenAttempted: false
            });
            return;
        }

        if (event.type === 'video-progress' && state.status === 'running') {
            if (state.phase === 'closing-completed-player') {
                debugLog('info', 'completion-close-ignores-video-progress', {
                    lessonKey: event.lessonKey,
                    currentTime: event.currentTime,
                    duration: event.duration
                });
                return;
            }
            updateState({
                phase: 'watching-video',
                message: `播放中：${formatClock(event.currentTime)} / ${formatClock(event.duration)}，${event.rate || 1}×`,
                lastActionAt: Date.now()
            });
            return;
        }

        if (event.type === 'manual-question') {
            updateState({ message: '播放器检测到课程提问，请在播放器窗口中手动完成' });
            return;
        }

        if (event.type === 'player-closing' && fallbackPlayerTab && typeof fallbackPlayerTab.close === 'function') {
            try {
                fallbackPlayerTab.close();
                debugLog('info', 'player-open-fallback-closed');
            } catch (error) {
                debugLog('warn', 'player-open-fallback-close-failed', { error });
            }
            fallbackPlayerTab = null;
        }

        if (event.type === 'video-stall-warning' && state.status === 'running') {
            if (state.phase === 'closing-completed-player') return;
            updateState({
                phase: 'watching-video',
                message: `播放器已有 ${event.minutes || state.settings.stallMinutes} 分钟无进度，保持窗口并继续尝试恢复`,
                lastActionAt: Date.now()
            });
            return;
        }

        if (['video-closed', 'player-unloading'].includes(event.type)
            && state.status === 'running'
            && state.phase === 'closing-completed-player') {
            updateState({
                message: '已收到播放器离开信号，等待对应会话心跳停止后再进入下一节',
                closingPlayerSessionId: state.closingPlayerSessionId || event.playerSessionId || '',
                closingPlayerUnloadAt: Number(event.at || Date.now())
            });
            debugLog('info', 'completed-player-unload-observed', {
                type: event.type,
                lessonKey: event.lessonKey,
                playerSessionId: event.playerSessionId,
                note: 'unload-is-not-proof-of-window-close'
            });
            return;
        }

        if (state.phase === 'closing-completed-player' && event.type !== 'video-closed') {
            debugLog('info', 'completion-close-ignores-player-event', {
                type: event.type,
                lessonKey: event.lessonKey
            });
            return;
        }

        if (['video-ended', 'video-closed', 'player-unloading', 'video-stalled'].includes(event.type) && state.status === 'running') {
            const reason = event.type === 'video-ended'
                ? '视频已结束'
                : event.type === 'video-stalled'
                    ? '播放器长时间无进度，等待服务器“已完成”状态'
                    : '播放器页面正在离开';
            updateState({
                phase: event.type === 'video-ended' ? 'watching-video' : 'checking-progress',
                message: `${reason}，实时等待服务器标记“已完成”`,
                lastActionAt: Date.now(),
                skipRequestAt: 0
            });
            clearTimeout(detailRefreshTimer);
            if (event.type === 'video-ended') {
                reloadServerStatusFrame('video-ended');
            } else {
                scheduleMainTick();
            }
        }
    }

    function formatClock(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
        const whole = Math.floor(seconds);
        const minutes = Math.floor(whole / 60);
        const secs = String(whole % 60).padStart(2, '0');
        return `${minutes}:${secs}`;
    }

    function createPlayerSessionId() {
        if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function readStoredPlayerIdentity() {
        try {
            const stored = JSON.parse(sessionStorage.getItem(PLAYER_IDENTITY_SESSION_KEY) || 'null');
            if (!stored || typeof stored !== 'object' || !stored.lessonKey || !stored.sessionId) return null;
            return stored;
        } catch (_error) {
            return null;
        }
    }

    function storePlayerIdentity(identity) {
        sessionStorage.setItem(PLAYER_IDENTITY_SESSION_KEY, JSON.stringify(identity));
        playerSessionId = identity.sessionId;
        playerLessonKey = identity.lessonKey;
        playerLessonTitle = identity.lessonTitle || '';
    }

    function initializePlayerIdentity(state = getState()) {
        const stored = readStoredPlayerIdentity();
        const identity = stored || {
            sessionId: createPlayerSessionId(),
            lessonKey: state.currentLessonKey || '',
            lessonTitle: state.currentLessonTitle || '',
            createdAt: Date.now()
        };
        storePlayerIdentity(identity);
        return { identity, source: stored ? 'session-storage' : 'state' };
    }

    function detectVisiblePlayerLessonTitle(state = getState()) {
        const visibleText = normalizeText(document.body?.innerText || '');
        if (!visibleText) return '';
        const candidates = uniqueAppend(
            Array.isArray(state.currentWorkshopLessonTitles) ? state.currentWorkshopLessonTitles : [],
            state.currentLessonTitle
        ).filter(Boolean).sort((left, right) => right.length - left.length);
        return candidates.find((title) => visibleText.includes(normalizeText(title))) || '';
    }

    function syncPlayerIdentityFromVisibleTitle(state = getState()) {
        const storedIdentity = readStoredPlayerIdentity();
        if (storedIdentity && storedIdentity.lessonKey !== playerLessonKey) {
            storePlayerIdentity(storedIdentity);
        }
        const detectedTitle = detectVisiblePlayerLessonTitle(state);
        if (!detectedTitle || !state.currentClassId) return;
        const detectedKey = lessonKey(state.currentClassId, detectedTitle);
        if (detectedKey === playerLessonKey) return;
        const previous = {
            sessionId: playerSessionId,
            lessonKey: playerLessonKey,
            lessonTitle: playerLessonTitle
        };
        const next = {
            sessionId: playerSessionId || createPlayerSessionId(),
            lessonKey: detectedKey,
            lessonTitle: detectedTitle,
            createdAt: Date.now()
        };
        storePlayerIdentity(next);
        debugLog('info', 'player-identity-updated-from-visible-title', {
            previous,
            next,
            documentTitle: document.title
        });
    }

    function writePlayerHeartbeat(force = false) {
        if (!playerLessonKey || !playerSessionId) return;
        const now = Date.now();
        if (!force && now - lastPlayerHeartbeatWriteAt < PLAYER_HEARTBEAT_INTERVAL_MS) return;
        lastPlayerHeartbeatWriteAt = now;
        GM_setValue(PLAYER_HEARTBEAT_KEY, {
            at: now,
            sessionId: playerSessionId,
            lessonKey: playerLessonKey,
            lessonTitle: playerLessonTitle,
            documentTitle: document.title,
            url: sanitizedUrl(),
            currentTime: Number(playerVideo?.currentTime || 0),
            duration: Number(playerVideo?.duration || 0),
            paused: Boolean(playerVideo?.paused)
        });
    }

    function getPlayerHeartbeat() {
        const heartbeat = GM_getValue(PLAYER_HEARTBEAT_KEY, null);
        return heartbeat && typeof heartbeat === 'object' ? heartbeat : null;
    }

    function initPlayerPage() {
        const initialState = getState();
        const identityResult = initializePlayerIdentity(initialState);
        syncPlayerIdentityFromVisibleTitle(initialState);
        debugLog('info', 'player-init', {
            topLevel: window.top === window,
            readyState: document.readyState,
            lessonKey: playerLessonKey,
            lessonTitle: playerLessonTitle,
            playerSessionId,
            identitySource: identityResult.source,
            beforeProgress: initialState.beforeProgress,
            currentLessonProgress: initialState.currentLessonProgress
        });
        GM_addValueChangeListener(STATE_KEY, (_name, _oldValue, value) => {
            applyPlayerState(value ? getState() : defaultState());
        });

        if (window.top === window) {
            window.addEventListener('beforeunload', () => {
                const state = getState();
                if (['running', 'paused'].includes(state.status)) {
                    publishEvent('player-unloading', {
                        documentTitle: document.title,
                        currentTime: Number(playerVideo?.currentTime || 0),
                        duration: Number(playerVideo?.duration || 0)
                    });
                }
            });
            const layerObserver = new MutationObserver(() => {
                const ending = [...document.querySelectorAll('.layui-layer-content')]
                    .find((node) => normalizeText(node.textContent).includes('视频即将结束'));
                if (ending && !playerEndedPublished) {
                    playerEndedPublished = true;
                    debugLog('info', 'player-ending-dialog-detected', { text: normalizeText(ending.textContent) });
                    publishEvent('video-ended');
                }
            });
            layerObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        }

        playerTimer = setInterval(playerTick, 1000);
        writePlayerHeartbeat(true);
        playerTick();
    }

    function playerTick() {
        const state = getState();
        syncPlayerIdentityFromVisibleTitle(state);
        writePlayerHeartbeat();
        dismissKnownContinuePrompt();
        const video = document.querySelector('video');
        if (video && video !== playerVideo) attachVideo(video);

        if (state.stopRequestAt || state.skipRequestAt || state.completedCloseRequestAt) {
            const requestAt = Math.max(
                state.stopRequestAt || 0,
                state.skipRequestAt || 0,
                state.completedCloseRequestAt || 0
            );
            const handledAt = Number(sessionStorage.getItem('gbpxHandledCloseRequest') || 0);
            if (requestAt > handledAt) {
                sessionStorage.setItem('gbpxHandledCloseRequest', String(requestAt));
                const reason = requestAt === state.completedCloseRequestAt
                    ? 'server-completion-confirmed'
                    : state.stopRequestAt >= state.skipRequestAt
                        ? 'stop-request'
                        : 'skip-request';
                debugLog('info', 'player-close-request', {
                    requestAt,
                    stop: state.stopRequestAt,
                    skip: state.skipRequestAt,
                    completed: state.completedCloseRequestAt,
                    reason
                });
                closePlayerWindow(reason);
                return;
            }
        }

        if (!playerVideo) return;
        applyPlayerState(state);
        recoverIncompleteEndPosition(playerVideo, state);

        const source = playerVideo.currentSrc || playerVideo.getAttribute('src') || '';
        if (source !== playerSource) {
            playerSource = source;
            playerPlaybackStarted = false;
            lastPlayerTime = Number(playerVideo.currentTime || 0);
            lastPlayerProgressAt = Date.now();
            lastPlayAttemptAt = 0;
            debugLog('info', 'player-source-changed', {
                hasSource: Boolean(source),
                source: source.slice(0, 500),
                readyState: playerVideo.readyState,
                networkState: playerVideo.networkState,
                duration: Number(playerVideo.duration || 0)
            });
        }

        const current = Number(playerVideo.currentTime || 0);
        if (current > lastPlayerTime + 0.2) {
            lastPlayerTime = current;
            lastPlayerProgressAt = Date.now();
        }

        const hasQuestion = hasBlockingQuestion();
        if (hasQuestion) {
            if (Date.now() - lastPlayerReportAt > 5000) {
                lastPlayerReportAt = Date.now();
                publishEvent('manual-question');
            }
            return;
        }

        if (state.status === 'running' && state.settings.autoResume && playerVideo.paused && !playerVideo.ended) {
            attemptPlayerStart(playerVideo);
        }

        const stallMs = Math.max(2, Number(state.settings.stallMinutes) || 3) * 60 * 1000;
        const shouldWatchForStall = playerPlaybackStarted && (!playerVideo.paused || state.settings.autoResume);
        if (state.status === 'running' && shouldWatchForStall && !playerVideo.ended && Date.now() - lastPlayerProgressAt > stallMs) {
            debugLog('warn', 'player-stall-timeout', {
                currentTime: current,
                duration: Number(playerVideo.duration || 0),
                readyState: playerVideo.readyState,
                networkState: playerVideo.networkState,
                waitedMs: Date.now() - lastPlayerProgressAt,
                closeOnStall: Boolean(state.settings.closeOnStall)
            });
            lastPlayerProgressAt = Date.now();
            if (state.settings.closeOnStall) {
                publishEvent('video-stalled', { currentTime: current, duration: Number(playerVideo.duration || 0) });
                closePlayerWindow('stall-auto-reopen');
            } else {
                publishEvent('video-stall-warning', {
                    currentTime: current,
                    duration: Number(playerVideo.duration || 0),
                    minutes: Math.round(stallMs / 60000)
                });
                lastPlayAttemptAt = 0;
                attemptPlayerStart(playerVideo);
            }
        }
    }

    function attachVideo(video) {
        playerVideo = video;
        if (!playerLessonKey) playerLessonKey = getState().currentLessonKey || '';
        lastPlayerTime = Number(video.currentTime || 0);
        lastPlayerProgressAt = Date.now();
        debugLog('info', 'video-attached', {
            id: video.id,
            readyState: video.readyState,
            networkState: video.networkState,
            hasSource: Boolean(video.currentSrc || video.getAttribute('src'))
        });

        video.addEventListener('play', () => {
            playerPlaybackStarted = true;
            const state = getState();
            applyPlayerState(state);
            publishEvent('video-started', { rate: video.playbackRate });
        });
        video.addEventListener('playing', () => {
            debugLog('info', 'video-playing', {
                currentTime: Number(video.currentTime || 0),
                duration: Number(video.duration || 0),
                rate: Number(video.playbackRate || 1)
            });
        });
        video.addEventListener('pause', () => {
            debugLog('info', 'video-paused', {
                currentTime: Number(video.currentTime || 0),
                ended: video.ended,
                readyState: video.readyState
            });
        });
        video.addEventListener('waiting', () => {
            debugLog('warn', 'video-waiting', {
                currentTime: Number(video.currentTime || 0),
                readyState: video.readyState,
                networkState: video.networkState
            });
        });
        video.addEventListener('stalled', () => {
            debugLog('warn', 'video-native-stalled', {
                currentTime: Number(video.currentTime || 0),
                readyState: video.readyState,
                networkState: video.networkState
            });
        });
        video.addEventListener('error', () => {
            debugLog('error', 'video-error', {
                code: video.error?.code,
                message: video.error?.message,
                currentSrc: String(video.currentSrc || '').slice(0, 500),
                readyState: video.readyState,
                networkState: video.networkState
            });
        });
        video.addEventListener('timeupdate', () => {
            if (Date.now() - lastPlayerReportAt < 15000) return;
            lastPlayerReportAt = Date.now();
            publishEvent('video-progress', {
                currentTime: Number(video.currentTime || 0),
                duration: Number(video.duration || 0),
                rate: Number(video.playbackRate || 1)
            });
        });
        video.addEventListener('ended', () => {
            const state = getState();
            if (recoverIncompleteEndPosition(video, state)) {
                debugLog('warn', 'ended-recovered-as-incomplete', {
                    lessonKey: playerLessonKey,
                    beforeProgress: state.beforeProgress,
                    currentLessonProgress: state.currentLessonProgress
                });
                setTimeout(() => attemptPlayerStart(video), 100);
                return;
            }
            playerEndedPublished = true;
            publishEvent('video-ended', {
                currentTime: Number(video.currentTime || 0), duration: Number(video.duration || 0)
            });
        });
        video.addEventListener('loadedmetadata', () => {
            debugLog('info', 'video-loadedmetadata', {
                duration: Number(video.duration || 0),
                currentTime: Number(video.currentTime || 0),
                readyState: video.readyState
            });
            recoverIncompleteEndPosition(video, getState());
            attemptPlayerStart(video);
        });
        video.addEventListener('canplay', () => {
            debugLog('info', 'video-canplay', {
                duration: Number(video.duration || 0),
                currentTime: Number(video.currentTime || 0),
                readyState: video.readyState
            });
            recoverIncompleteEndPosition(video, getState());
            attemptPlayerStart(video);
        });
        applyPlayerState(getState());
    }

    function attemptPlayerStart(video) {
        const state = getState();
        if (state.status !== 'running' || !state.settings.autoResume || video.ended || hasBlockingQuestion()) return;
        const source = video.currentSrc || video.getAttribute('src') || '';
        const durationReady = Number.isFinite(video.duration) && video.duration > 0;
        const metadataReady = video.readyState >= 1 && durationReady;
        if (!source || !metadataReady) {
            if (Date.now() - lastPlayerWaitLogAt >= 10000) {
                lastPlayerWaitLogAt = Date.now();
                debugLog('warn', 'player-not-ready', {
                    hasSource: Boolean(source),
                    duration: Number(video.duration || 0),
                    readyState: video.readyState,
                    networkState: video.networkState
                });
            }
            return;
        }
        if (Date.now() - lastPlayAttemptAt < 3000) return;

        lastPlayAttemptAt = Date.now();
        applyPlayerState(state);
        const bigPlayButton = document.querySelector('.vjs-big-play-button');
        debugLog('info', 'player-start-attempt', {
            bigPlayButtonVisible: isVisible(bigPlayButton),
            paused: video.paused,
            duration: Number(video.duration || 0),
            readyState: video.readyState,
            rate: video.playbackRate
        });
        if (bigPlayButton && isVisible(bigPlayButton)) bigPlayButton.click();
        setTimeout(() => {
            if (video.paused && !video.ended && !hasBlockingQuestion()) {
                video.play().catch((error) => {
                    debugLog('warn', 'video-play-rejected', { error });
                });
            }
        }, 250);
    }

    function applyPlayerState(state) {
        if (!playerVideo) return;
        if (state.settings.muted) {
            playerVideo.muted = true;
            playerVideo.volume = 0;
        }
        playerVideo.playbackRate = 1;

        if (state.status === 'paused' || ['stopped', 'idle', 'complete'].includes(state.status)) {
            if (!playerVideo.paused) playerVideo.pause();
        }
    }

    function hasBlockingQuestion() {
        const question = document.querySelector('.question');
        if (isVisible(question)) return true;
        const dialogs = [...document.querySelectorAll('.layui-layer-dialog .layui-layer-content')];
        return dialogs.some((dialog) => {
            const text = normalizeText(dialog.textContent);
            return isVisible(dialog) && text && !text.includes('视频即将结束');
        });
    }

    function dismissKnownContinuePrompt() {
        const contents = [...document.querySelectorAll('.layui-layer-content')];
        const prompt = contents.find((node) => {
            const text = normalizeText(node.textContent);
            return isVisible(node) && text.includes('实时在线学习') && text.includes('继续学习');
        });
        if (!prompt) return;
        const layer = prompt.closest('.layui-layer');
        const confirm = layer?.querySelector('.layui-layer-btn0');
        if (confirm) {
            debugLog('info', 'continue-prompt-confirmed', { text: normalizeText(prompt.textContent) });
            confirm.click();
        }
    }

    function recoverIncompleteEndPosition(video, state) {
        if (playerRecoverySeekApplied || !video) return false;
        const duration = Number(video.duration || 0);
        const currentTime = Number(video.currentTime || 0);
        const beforeProgress = Number(state.beforeProgress || 0);
        const currentLessonProgress = Number(state.currentLessonProgress || 0);
        const creditedProgress = Math.max(
            Number.isFinite(beforeProgress) ? beforeProgress : 0,
            Number.isFinite(currentLessonProgress) ? currentLessonProgress : 0
        );
        if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(creditedProgress)) return false;
        if (creditedProgress >= 99.9 || currentTime < duration - 2) return false;

        // 旧版倍速可能把 lesson_location 写到结尾，但服务器只累计了部分真实时长。
        // 回退到服务器已确认进度附近，并留 30 秒重叠，补足剩余正常学习时间。
        const targetTime = Math.max(0, Math.min(duration - 30, duration * Math.max(0, creditedProgress) / 100 - 30));
        playerRecoverySeekApplied = true;
        playerEndedPublished = false;
        video.currentTime = targetTime;
        lastPlayerTime = targetTime;
        lastPlayerProgressAt = Date.now();
        lastPlayAttemptAt = 0;
        debugLog('warn', 'incomplete-end-position-recovered', {
            creditedProgress,
            fromTime: currentTime,
            targetTime,
            duration,
            lessonKey: playerLessonKey
        });
        publishEvent('resume-position-corrected', { creditedProgress, fromTime: currentTime, targetTime, duration });
        return true;
    }

    function closePlayerWindow(reason = 'unspecified') {
        debugLog('info', 'player-close-invoked', {
            reason,
            lessonKey: playerLessonKey,
            currentTime: Number(playerVideo?.currentTime || 0),
            duration: Number(playerVideo?.duration || 0),
            ended: Boolean(playerVideo?.ended)
        });
        publishEvent('player-closing', { reason });
        try {
            const topDocument = window.top.document;
            const closeButton = topDocument.querySelector('#btnexit, button.instructions-close');
            if (closeButton) {
                debugLog('info', 'player-close-button-click', { selector: closeButton.id || closeButton.className });
                closeButton.click();
                return;
            }
        } catch (_error) {
            // 同源播放器通常允许访问；失败时使用 window.close 兜底。
        }
        debugLog('warn', 'player-window-close-fallback');
        try {
            window.top.close();
        } catch (_error) {
            window.close();
        }
    }

    installGlobalErrorLogging();
    debugLog('info', 'script-boot', {
        version: VERSION,
        hostname: location.hostname,
        topLevel: window.top === window,
        documentReadyState: document.readyState
    });

    if (location.hostname === MAIN_HOST) {
        initMainPage();
    } else if (PLAYER_HOSTS.has(location.hostname)) {
        initPlayerPage();
    }
})();
