// ==UserScript==
// @name         广东省国家工作人员学法考试平台学习助手
// @namespace    https://xfks.gdsf.gov.cn/
// @version      0.1.14
// @description  按课程目录顺序正常学习：滚动阅读、等待平台计时确认学分、确认目录状态后继续。
// @author       User & Codex
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/Linkegee/gdgbpx-workshop-helper/main/gdsf-study-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/Linkegee/gdgbpx-workshop-helper/main/gdsf-study-helper.user.js
// @match        https://xfks.gdsf.gov.cn/study/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      raw.githubusercontent.com
// @connect      api.github.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '0.1.14';
    const STATE_KEY = 'gdsf_study_helper_state_v1';
    const LOG_KEY = 'gdsf_study_helper_logs_v1';
    const MAX_LOG_ENTRIES = 350;
    const TICK_MS = 1200;
    const DIRECTORY_CONFIRM_DELAY_MS = 1000;
    const COMPLETION_TIMEOUT_MS = 90 * 60 * 1000;
    const HOME_STATUS_REFRESH_MS = 60 * 1000;
    const OUTER_COURSE_SELECTOR = 'li[cl]';
    // Some categories expose the course title itself as the link, while others
    // use a separate “进入学习” button. Both forms must be discovered.
    const COURSE_LINK_SELECTOR = 'a[href^="/study/course/"]';
    const CHAPTER_SCORE_SELECTOR = '.chapter-score';
    const UPDATE_URL = 'https://raw.githubusercontent.com/Linkegee/gdgbpx-workshop-helper/main/gdsf-study-helper.user.js';
    const UPDATE_CHECK_URL = 'https://api.github.com/repos/Linkegee/gdgbpx-workshop-helper/contents/gdsf-study-helper.user.js';

    let timer = null;
    let panel = null;
    let lastActionAt = 0;
    let completionStartedAt = 0;
    let lastScoreSnapshot = '';
    let updateReady = false;
    let activeCourseTab = null;
    let homeStatusRefreshAt = 0;
    let homeStatusRefreshInFlight = false;

    function defaultState() {
        return {
            version: VERSION,
            status: 'idle', // idle | running | paused | stopped | complete
            phase: 'idle',  // outer | outer-selected | chapter-directory | chapter | await-score | confirm-directory
            message: '进入“年度学法”后点击开始。',
            outerIndex: 0,
            courseIndex: 0,
            chapterIndex: 0,
            closePreviousCourse: false,
            currentOuterTitle: '',
            currentOuterKey: '',
            currentCourseTitle: '',
            currentCourseHref: '',
            currentChapterTitle: '',
            completedCourseHrefs: [],
            homeCourseStatusByHref: {},
            homeStatusFetchedAt: 0,
            skipPracticeBank: true,
            openedOuterAt: 0,
            updatedAt: Date.now()
        };
    }

    function getState() {
        const state = GM_getValue(STATE_KEY, null);
        return state && typeof state === 'object' ? { ...defaultState(), ...state } : defaultState();
    }

    function setState(change) {
        const previous = getState();
        const next = { ...previous, ...change, version: VERSION, updatedAt: Date.now() };
        GM_setValue(STATE_KEY, next);
        if (previous.status !== next.status || previous.phase !== next.phase || previous.message !== next.message) {
            debugLog('info', 'state-change', {
                status: next.status,
                phase: next.phase,
                message: next.message,
                outer: next.currentOuterTitle,
                course: next.currentCourseTitle,
                chapter: next.currentChapterTitle
            });
        }
        renderPanel(next);
        return next;
    }

    function normalizeLogValue(value) {
        if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack?.slice(0, 800) };
        if (typeof value === 'string') return value.slice(0, 800);
        if (!value || typeof value !== 'object') return value;
        try {
            return JSON.parse(JSON.stringify(value, (_key, item) => {
                if (item instanceof Error) return { name: item.name, message: item.message };
                if (typeof item === 'string') return item.slice(0, 800);
                return item;
            }));
        } catch (_error) {
            return String(value).slice(0, 800);
        }
    }

    function debugLog(level, event, data = {}) {
        const entry = { at: new Date().toISOString(), level, event, data: normalizeLogValue(data), url: location.href };
        const logs = GM_getValue(LOG_KEY, []);
        const next = Array.isArray(logs) ? logs : [];
        next.push(entry);
        if (next.length > MAX_LOG_ENTRIES) next.splice(0, next.length - MAX_LOG_ENTRIES);
        GM_setValue(LOG_KEY, next);
        const writer = console[level] || console.log;
        writer.call(console, '[学法学习助手]', event, entry.data);
        renderLog();
    }

    function recentLogs(limit = 40) {
        const logs = GM_getValue(LOG_KEY, []);
        return (Array.isArray(logs) ? logs : []).slice(-limit);
    }

    function compareVersions(left, right) {
        const leftParts = String(left).split('.').map(Number);
        const rightParts = String(right).split('.').map(Number);
        const length = Math.max(leftParts.length, rightParts.length);
        for (let index = 0; index < length; index += 1) {
            const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
            if (difference) return difference;
        }
        return 0;
    }

    function renderUpdate(text = '', available = false) {
        if (!panel) return;
        const updateNode = panel.querySelector('[data-role="update"]');
        const updateButton = panel.querySelector('[data-action="update"]');
        if (updateNode) {
            updateNode.hidden = !text;
            updateNode.textContent = text;
        }
        if (updateButton) updateButton.hidden = !available;
    }

    function checkForUpdate() {
        updateReady = false;
        renderUpdate('正在检查更新…');
        debugLog('info', 'update-check-started', { version: VERSION });
        GM_xmlhttpRequest({
            method: 'GET',
            url: UPDATE_CHECK_URL,
            headers: { Accept: 'application/vnd.github+json' },
            onload: (response) => {
                let remoteSource = '';
                try {
                    const payload = JSON.parse(response.responseText || '{}');
                    remoteSource = atob(String(payload.content || '').replace(/\s/g, ''));
                } catch (error) {
                    debugLog('warn', 'update-response-parse-failed', { error });
                }
                const match = remoteSource.match(/^\/\/\s*@version\s+([^\s]+)/m);
                const remoteVersion = match?.[1] || '';
                if (response.status >= 200 && response.status < 300 && remoteVersion && compareVersions(remoteVersion, VERSION) > 0) {
                    updateReady = true;
                    renderUpdate(`发现 v${remoteVersion}，点击“更新”安装。`, true);
                    debugLog('info', 'update-available', { installed: VERSION, remote: remoteVersion });
                } else {
                    renderUpdate(remoteVersion ? '当前已是最新版本。' : '未读取到远程版本。');
                    debugLog('info', 'update-check-finished', { installed: VERSION, remote: remoteVersion, status: response.status });
                }
            },
            onerror: (error) => {
                renderUpdate('检查更新失败，请稍后重试。');
                debugLog('warn', 'update-check-failed', { error });
            }
        });
    }

    function installAvailableUpdate() {
        if (!updateReady) return;
        debugLog('info', 'update-install-opened');
        GM_openInTab(UPDATE_URL, { active: true, insert: true, setParent: true });
    }

    function closeActiveCourseTab() {
        const tab = activeCourseTab;
        activeCourseTab = null;
        if (!tab) return;
        try {
            tab.close();
            debugLog('info', 'course-tab-closed-by-parent');
        } catch (error) {
            debugLog('warn', 'parent-course-tab-close-failed', { error });
        }
    }

    function cleanText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function isVisible(node) {
        if (!node) return false;
        const style = window.getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
    }

    function isPracticeBank(text) {
        return cleanText(text).includes('练习题库');
    }

    function isChapterPage() {
        return /^\/study\/course\/\d+\/chapter\/\d+/.test(location.pathname);
    }

    function isCoursePage() {
        return /^\/study\/course\/\d+$/.test(location.pathname);
    }

    function isStudyIndex() {
        return location.pathname === '/study/index' || location.pathname === '/study/index/';
    }

    function throttle(ms = 700) {
        const now = Date.now();
        if (now - lastActionAt < ms) return false;
        lastActionAt = now;
        return true;
    }

    function outerCourses() {
        return [...document.querySelectorAll(OUTER_COURSE_SELECTOR)]
            .filter(isVisible)
            .map((node) => ({
                node,
                key: node.getAttribute('cl') || '',
                // Only navigation tabs have a direct <b>; the same `cl` is reused by content containers.
                title: cleanText(node.querySelector(':scope > b')?.textContent)
            }))
            .filter(({ title }) => title);
    }

    function courseLinks(outerKey) {
        if (!outerKey) return [];
        const containers = [...document.querySelectorAll(OUTER_COURSE_SELECTOR)]
            .filter((node) => node.getAttribute('cl') === outerKey)
            .filter((node) => node.querySelector(COURSE_LINK_SELECTOR));
        const container = containers[0];
        if (!container) return [];
        const state = getState();
        const knownComplete = new Set(state.completedCourseHrefs || []);
        const homeStatus = state.homeCourseStatusByHref || {};
        const uniqueLinks = new Map();
        for (const node of container.querySelectorAll(COURSE_LINK_SELECTOR)) {
            const href = new URL(node.href, location.origin).href;
            // Cards may contain both a title link and an “进入学习” link for the
            // same course. Keep the first link so its title remains meaningful.
            if (!uniqueLinks.has(href)) uniqueLinks.set(href, node);
        }
        return [...uniqueLinks.entries()].map(([href, node]) => {
            // Find the smallest card whose course links all point to this href.
            let item = node.parentElement;
            while (item && item !== container) {
                const hrefs = new Set([...item.querySelectorAll(COURSE_LINK_SELECTOR)]
                    .map((link) => new URL(link.href, location.origin).href));
                if (hrefs.size === 1) break;
                item = item.parentElement;
            }
            const cardText = cleanText(item?.textContent || node.parentElement?.textContent);
            const linkText = cleanText(node.textContent);
            const heading = cleanText(item?.querySelector('h1, h2, h3, h4, h5, h6')?.textContent);
            return {
                node,
                href,
                title: heading || (linkText !== '进入学习' ? linkText : cardText),
                completed: knownComplete.has(href) || homeStatus[href]?.completed || /已完成\s*100%/.test(cardText)
            };
        });
    }

    function readCourseStatusFromDocument(doc) {
        const result = {};
        for (const container of doc.querySelectorAll(OUTER_COURSE_SELECTOR)) {
            if (!container.querySelector(COURSE_LINK_SELECTOR)) continue;
            for (const node of container.querySelectorAll(COURSE_LINK_SELECTOR)) {
                const href = new URL(node.getAttribute('href'), location.origin).href;
                let item = node.parentElement;
                while (item && item !== container) {
                    const hrefs = new Set([...item.querySelectorAll(COURSE_LINK_SELECTOR)]
                        .map((link) => new URL(link.getAttribute('href'), location.origin).href));
                    if (hrefs.size === 1) break;
                    item = item.parentElement;
                }
                const text = cleanText(item?.textContent || node.parentElement?.textContent);
                result[href] = { completed: /已完成\s*100%/.test(text), text };
            }
        }
        return result;
    }

    function refreshHomeCourseStatuses() {
        if (!isStudyIndex() || homeStatusRefreshInFlight || Date.now() - homeStatusRefreshAt < HOME_STATUS_REFRESH_MS) return;
        homeStatusRefreshAt = Date.now();
        homeStatusRefreshInFlight = true;
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${location.origin}/study/index?_gdsf_status_sync=${Date.now()}`,
            headers: { 'Cache-Control': 'no-cache' },
            onload: (response) => {
                homeStatusRefreshInFlight = false;
                if (response.status < 200 || response.status >= 300) {
                    debugLog('warn', 'home-status-refresh-failed', { status: response.status });
                    return;
                }
                const snapshot = readCourseStatusFromDocument(new DOMParser().parseFromString(response.responseText, 'text/html'));
                if (!Object.keys(snapshot).length) {
                    debugLog('warn', 'home-status-refresh-empty');
                    return;
                }
                const state = getState();
                if (JSON.stringify(state.homeCourseStatusByHref || {}) !== JSON.stringify(snapshot)) {
                    setState({ homeCourseStatusByHref: snapshot, homeStatusFetchedAt: Date.now() });
                    debugLog('info', 'home-status-refreshed', { courses: Object.keys(snapshot).length });
                }
            },
            onerror: (error) => {
                homeStatusRefreshInFlight = false;
                debugLog('warn', 'home-status-refresh-error', { error });
            }
        });
    }

    function earliestPendingOuterIndex(state, categories) {
        for (let index = 0; index < state.outerIndex; index += 1) {
            const category = categories[index];
            if (!category || (state.skipPracticeBank && isPracticeBank(category.title))) continue;
            if (courseLinks(category.key).some(({ completed, title }) => !completed && !(state.skipPracticeBank && isPracticeBank(title)))) return index;
        }
        return -1;
    }

    function chapterRows() {
        // Each readable chapter has a direct /chapter/ link. Its enclosing table gains “获得X学分” on completion.
        return [...document.querySelectorAll('a[href*="/chapter/"]')]
            .filter(isVisible)
            .map((node) => {
                const title = cleanText(node.textContent);
                const container = node.closest('table') || node.parentElement;
                const text = cleanText(container?.textContent);
                return { node, container, title, completed: /获得\s*\d+(?:\.\d+)?\s*学分/.test(text) };
            });
    }

    function clickNode(node) {
        debugLog('info', 'click-node', { text: cleanText(node.textContent), href: node.href || null });
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => node.click(), 250);
    }

    function selectNext(items, index, accepts) {
        for (let cursor = Math.max(0, index); cursor < items.length; cursor += 1) {
            if (accepts(items[cursor])) return { item: items[cursor], index: cursor };
        }
        return null;
    }

    function start() {
        if (!isStudyIndex()) {
            setState({ status: 'paused', message: '请先进入“年度学法”主页后再开始。' });
            return;
        }
        setState({ status: 'running', phase: 'outer', message: '准备处理外层课程分类。', outerIndex: 0, courseIndex: 0, chapterIndex: 0, closePreviousCourse: false });
        tick();
    }

    function pause() {
        setState({ status: 'paused', message: '已暂停；不会打开下一项。' });
    }

    function resume() {
        const state = getState();
        if (state.status === 'complete') return;
        let phase = state.phase;
        if (phase === 'idle') {
            if (isChapterPage()) phase = 'await-score';
            else if (isCoursePage()) phase = 'chapter-directory';
            else if (isStudyIndex()) phase = state.currentOuterKey ? 'outer-selected' : 'outer';
            debugLog('info', 'phase-recovered-on-resume', { from: state.phase, to: phase, path: location.pathname });
        }
        setState({ status: 'running', phase, message: '已继续。' });
        tick();
    }

    function stop() {
        setState({ status: 'stopped', phase: 'idle', message: '已停止。' });
    }

    function reset() {
        GM_deleteValue(STATE_KEY);
        completionStartedAt = 0;
        renderPanel(defaultState());
    }

    function processIndex(state) {
        const categories = outerCourses();
        if (!categories.length) {
            setState({ status: 'paused', message: '未找到外层课程分类；请先点击“年度学法”。' });
            return;
        }
        const next = selectNext(categories, state.outerIndex, ({ title }) => !(state.skipPracticeBank && isPracticeBank(title)));
        if (!next) {
            setState({ status: 'complete', phase: 'idle', message: '外层课程分类已全部处理完毕。' });
            return;
        }
        setState({
            phase: 'outer-selected',
            outerIndex: next.index,
            courseIndex: 0,
            chapterIndex: 0,
            currentOuterTitle: next.item.title,
            currentOuterKey: next.item.key,
            message: `打开分类：${next.item.title}`,
            openedOuterAt: Date.now()
        });
        // The site renders every category in the same index page. A normal click changes the visible list.
        clickNode(next.item.node);
    }

    function processCourse(state) {
        // Only close an exact child tab after that child's directory has confirmed
        // every chapter complete. A manual restart while a chapter is timing must
        // never close the still-active course tab.
        if (state.closePreviousCourse) {
            closeActiveCourseTab();
        }
        // A prior run may have advanced past a partially completed category.
        // At a safe course boundary, return to the earliest such category.
        const earlierIndex = earliestPendingOuterIndex(state, outerCourses());
        if (earlierIndex >= 0) {
            setState({
                phase: 'outer',
                outerIndex: earlierIndex,
                courseIndex: 0,
                chapterIndex: 0,
                closePreviousCourse: false,
                message: '发现较早分类仍有未完成课程，返回按顺序继续。'
            });
            return;
        }
        const links = courseLinks(state.currentOuterKey);
        const next = selectNext(links, state.courseIndex, ({ title, completed }) => !completed && !(state.skipPracticeBank && isPracticeBank(title)));
        if (!next) {
            setState({
                phase: 'outer',
                outerIndex: state.outerIndex + 1,
                courseIndex: 0,
                chapterIndex: 0,
                message: `分类“${state.currentOuterTitle}”已完成，请返回年度学法主页继续。`
            });
            return;
        }
        setState({
            phase: 'chapter-directory',
            courseIndex: next.index,
            chapterIndex: 0,
            closePreviousCourse: false,
            currentCourseTitle: next.item.title,
            currentCourseHref: next.item.href,
            message: `进入二级课程：${next.item.title}`
        });
        // Open every secondary course in an extension-managed tab. This avoids popup blocking
        // and, crucially, never navigates the index tab away from the course list.
        try {
            activeCourseTab = GM_openInTab(next.item.href, { active: true, insert: true, setParent: true });
            debugLog('info', 'course-tab-opened', { href: next.item.href, title: next.item.title });
        } catch (error) {
            debugLog('error', 'course-tab-open-failed', { error, href: next.item.href });
            setState({ status: 'paused', message: '无法在新标签打开二级课程，请检查浏览器后继续。' });
        }
    }

    function processChapterDirectory(state) {
        const rows = chapterRows();
        const next = selectNext(rows, state.chapterIndex, ({ completed, title }) => !completed && !(state.skipPracticeBank && isPracticeBank(title)));
        if (!next) {
            const completedCourseHrefs = [...new Set([...(state.completedCourseHrefs || []), state.currentCourseHref].filter(Boolean))];
            setState({
                phase: 'outer-selected',
                courseIndex: state.courseIndex + 1,
                chapterIndex: 0,
                closePreviousCourse: true,
                completedCourseHrefs,
                message: `二级课程“${state.currentCourseTitle}”已完成，正在关闭课程标签页。`
            });
            return;
        }
        setState({
            phase: 'chapter',
            chapterIndex: next.index,
            currentChapterTitle: next.item.title,
            message: `打开章节：${next.item.title}`
        });
        clickNode(next.item.node);
    }

    function processChapter(state) {
        const score = document.querySelector(CHAPTER_SCORE_SELECTOR);
        if (!score) {
            setState({ status: 'paused', message: '未找到章节学分标记，请检查页面后再继续。' });
            return;
        }
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        const complete = score.classList.contains('chapter-score-suc');
        const scoreSnapshot = `${score.className}|${cleanText(score.textContent)}`;
        if (scoreSnapshot !== lastScoreSnapshot) {
            lastScoreSnapshot = scoreSnapshot;
            debugLog('info', 'chapter-score-observed', { className: score.className, text: cleanText(score.textContent), complete });
        }
        if (complete) {
            completionStartedAt = 0;
            setState({ phase: 'confirm-directory', message: `章节已获学分，返回目录确认：${state.currentChapterTitle}` });
            const returnButton = [...document.querySelectorAll('button')].find((button) => cleanText(button.textContent) === '返回目录');
            if (returnButton && throttle(DIRECTORY_CONFIRM_DELAY_MS)) setTimeout(() => returnButton.click(), 350);
            return;
        }
        if (!completionStartedAt) completionStartedAt = Date.now();
        if (Date.now() - completionStartedAt > COMPLETION_TIMEOUT_MS) {
            setState({ status: 'paused', message: `等待“${state.currentChapterTitle}”获得学分超时，请人工确认。` });
            return;
        }
        setState({ phase: 'await-score', message: `正在按平台规则等待章节计时完成：${state.currentChapterTitle}` });
    }

    function confirmDirectory(state) {
        const rows = chapterRows();
        const current = rows.find(({ title }) => title === state.currentChapterTitle);
        if (!current?.completed) {
            setState({ status: 'paused', message: `目录尚未确认“${state.currentChapterTitle}”获得学分，请稍后继续。` });
            return;
        }
        setState({
            phase: 'chapter-directory',
            chapterIndex: state.chapterIndex + 1,
            message: `已确认“${state.currentChapterTitle}”获得学分，继续下一节。`
        });
    }

    function tick() {
        const state = getState();
        renderPanel(state);
        if (state.status !== 'running') return;
        if (isStudyIndex()) {
            // Synchronize course-card status in the background without reloading
            // or navigating the persistent homepage tab.
            refreshHomeCourseStatuses();
            if (state.phase === 'outer') processIndex(state);
            else if (state.phase === 'outer-selected') processCourse(state);
            // Parent index tabs intentionally wait while their child course tab is active.
            return;
        }
        if (isCoursePage()) {
            if (state.phase === 'chapter-directory') processChapterDirectory(state);
            else if (state.phase === 'confirm-directory') confirmDirectory(state);
            // Course tabs intentionally wait while their child chapter page is active.
            return;
        }
        if (isChapterPage()) {
            if (state.phase === 'idle') {
                setState({ phase: 'await-score', message: '已从当前章节恢复学习流程。' });
                return;
            }
            if (['chapter', 'await-score', 'confirm-directory'].includes(state.phase)) processChapter(state);
            return;
        }
        // Other platform pages (such as the annual-exam notice) also match the
        // userscript. They must never change the shared study state.
        return;
    }

    function renderPanel(state) {
        if (!panel) return;
        panel.querySelector('[data-role="status"]').textContent = `状态：${state.status} / ${state.phase}`;
        panel.querySelector('[data-role="message"]').textContent = state.message;
        panel.querySelector('[data-role="current"]').textContent = [state.currentOuterTitle, state.currentCourseTitle, state.currentChapterTitle].filter(Boolean).join(' › ') || '尚未选择课程';
        panel.querySelector('[data-action="start"]').disabled = !isStudyIndex() || state.status === 'running';
        panel.querySelector('[data-action="resume"]').disabled = state.status === 'running' || state.status === 'complete';
        renderLog();
    }

    function renderLog() {
        if (!panel) return;
        const logNode = panel.querySelector('[data-role="log"]');
        if (!logNode || logNode.hidden) return;
        logNode.textContent = recentLogs().map((entry) => {
            const time = entry.at.slice(11, 19);
            const detail = entry.data && Object.keys(entry.data).length ? ` ${JSON.stringify(entry.data)}` : '';
            return `${time} [${entry.level}] ${entry.event}${detail}`;
        }).join('\n');
        logNode.scrollTop = logNode.scrollHeight;
    }

    function createPanel() {
        GM_addStyle(`
            #gdsf-study-helper { position: fixed; left: 14px; bottom: 14px; z-index: 2147483647; width: 265px; padding: 10px 11px; border-radius: 9px; background: rgba(16,42,83,.96); color: #fff; font: 13px/1.35 system-ui, sans-serif; box-shadow: 0 7px 22px rgba(0,0,0,.25); }
            #gdsf-study-helper h2 { margin: 0 0 5px; font-size: 14px; }
            #gdsf-study-helper p { margin: 4px 0; word-break: break-word; }
            #gdsf-study-helper .muted { color: #bed0e8; font-size: 11px; max-height: 32px; overflow: hidden; }
            #gdsf-study-helper .actions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
            #gdsf-study-helper button { border: 0; border-radius: 5px; padding: 5px 7px; cursor: pointer; background: #fff; color: #102a53; font-size: 12px; }
            #gdsf-study-helper button.danger { background: #e75b5b; color: #fff; }
            #gdsf-study-helper button:disabled { opacity: .48; cursor: not-allowed; }
            #gdsf-study-helper pre { max-height: 185px; margin: 7px 0 0; padding: 6px; overflow: auto; border-radius: 5px; background: rgba(0,0,0,.22); color: #d6e5f6; font: 10px/1.35 ui-monospace, Consolas, monospace; white-space: pre-wrap; }
        `);
        panel = document.createElement('aside');
        panel.id = 'gdsf-study-helper';
        panel.innerHTML = `
            <h2>学习助手 <span class="muted">v${VERSION}</span></h2>
            <p data-role="status"></p>
            <p data-role="message"></p>
            <p class="muted" data-role="current"></p>
            <p class="muted" data-role="update" hidden></p>
            <div class="actions">
                <button data-action="start">开始</button>
                <button data-action="resume">继续</button>
                <button data-action="pause">暂停</button>
                <button class="danger" data-action="stop">停止</button>
                <button data-action="reset">重置</button>
                <button data-action="logs">日志</button>
                <button data-action="check-update">检查更新</button>
                <button data-action="update" hidden>更新</button>
            </div>`;
        panel.addEventListener('click', (event) => {
            const action = event.target.closest('button')?.dataset.action;
            if (action === 'start') start();
            if (action === 'resume') resume();
            if (action === 'pause') pause();
            if (action === 'stop') stop();
            if (action === 'reset') reset();
            if (action === 'check-update') checkForUpdate();
            if (action === 'update') installAvailableUpdate();
            if (action === 'logs') {
                const logNode = panel.querySelector('[data-role="log"]');
                logNode.hidden = !logNode.hidden;
                renderLog();
            }
        });
        const logNode = document.createElement('pre');
        logNode.dataset.role = 'log';
        logNode.hidden = true;
        panel.appendChild(logNode);
        document.documentElement.appendChild(panel);
        renderPanel(getState());
    }

    window.addEventListener('error', (event) => debugLog('error', 'window-error', { message: event.message, filename: event.filename, line: event.lineno, column: event.colno, error: event.error }));
    window.addEventListener('unhandledrejection', (event) => debugLog('error', 'unhandled-rejection', { reason: event.reason }));
    debugLog('info', 'script-boot', { version: VERSION, path: location.pathname });
    createPanel();
    GM_addValueChangeListener(STATE_KEY, () => renderPanel(getState()));
    timer = window.setInterval(tick, TICK_MS);
    tick();
})();

