// ==UserScript==
// @name         广东省国家工作人员学法考试平台学习助手
// @namespace    https://xfks.gdsf.gov.cn/
// @version      0.1.2
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
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '0.1.2';
    const STATE_KEY = 'gdsf_study_helper_state_v1';
    const TICK_MS = 1200;
    const DIRECTORY_CONFIRM_DELAY_MS = 1000;
    const COMPLETION_TIMEOUT_MS = 90 * 60 * 1000;
    const OUTER_COURSE_SELECTOR = 'li[cl]';
    const COURSE_LINK_SELECTOR = 'a.btn[href^="/study/course/"]';
    const CHAPTER_SCORE_SELECTOR = '.chapter-score';

    let timer = null;
    let panel = null;
    let lastActionAt = 0;
    let completionStartedAt = 0;

    function defaultState() {
        return {
            version: VERSION,
            status: 'idle', // idle | running | paused | stopped | complete
            phase: 'idle',  // outer | outer-selected | chapter-directory | chapter | await-score | confirm-directory
            message: '进入“年度学法”后点击开始。',
            outerIndex: 0,
            courseIndex: 0,
            chapterIndex: 0,
            currentOuterTitle: '',
            currentOuterKey: '',
            currentCourseTitle: '',
            currentChapterTitle: '',
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
        const next = { ...getState(), ...change, version: VERSION, updatedAt: Date.now() };
        GM_setValue(STATE_KEY, next);
        renderPanel(next);
        return next;
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
        return [...container.querySelectorAll(COURSE_LINK_SELECTOR)]
            .filter(isVisible)
            .map((node) => {
                // Pick the closest ancestor that contains exactly this course button,
                // rather than the outer category <li> which contains every course.
                let item = node.parentElement;
                while (item && item !== container) {
                    if (item.querySelectorAll(COURSE_LINK_SELECTOR).length === 1
                        && item.querySelector('h1, h2, h3, h4, h5, h6')) break;
                    item = item.parentElement;
                }
                return {
                    node,
                    href: new URL(node.href, location.origin).href,
                    title: cleanText(item?.querySelector('h1, h2, h3, h4, h5, h6')?.textContent || item?.textContent || node.parentElement?.textContent)
                };
            });
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
        setState({ status: 'running', phase: 'outer', message: '准备处理外层课程分类。', outerIndex: 0, courseIndex: 0, chapterIndex: 0 });
        tick();
    }

    function pause() {
        setState({ status: 'paused', message: '已暂停；不会打开下一项。' });
    }

    function resume() {
        const state = getState();
        if (state.status === 'complete') return;
        setState({ status: 'running', message: '已继续。' });
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
        const links = courseLinks(state.currentOuterKey);
        const next = selectNext(links, state.courseIndex, ({ title }) => !(state.skipPracticeBank && isPracticeBank(title)));
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
            currentCourseTitle: next.item.title,
            message: `进入二级课程：${next.item.title}`
        });
        // Keep each course in its own tab so closing it returns to the category/index tab.
        // If a browser blocks the popup, navigation remains a safe fallback.
        const child = window.open(next.item.href, '_blank');
        if (!child) location.assign(next.item.href);
    }

    function processChapterDirectory(state) {
        const rows = chapterRows();
        const next = selectNext(rows, state.chapterIndex, ({ completed, title }) => !completed && !(state.skipPracticeBank && isPracticeBank(title)));
        if (!next) {
            setState({
                phase: 'outer-selected',
                courseIndex: state.courseIndex + 1,
                chapterIndex: 0,
                message: `二级课程“${state.currentCourseTitle}”已完成，正在关闭课程标签页。`
            });
            setTimeout(() => {
                if (window.opener) window.close();
                else history.back();
            }, 500);
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
            if (['chapter', 'await-score', 'confirm-directory'].includes(state.phase)) processChapter(state);
            return;
        }
        setState({ status: 'paused', message: '当前不在学习平台的可识别页面。' });
    }

    function renderPanel(state) {
        if (!panel) return;
        panel.querySelector('[data-role="status"]').textContent = `状态：${state.status} / ${state.phase}`;
        panel.querySelector('[data-role="message"]').textContent = state.message;
        panel.querySelector('[data-role="current"]').textContent = [state.currentOuterTitle, state.currentCourseTitle, state.currentChapterTitle].filter(Boolean).join(' › ') || '尚未选择课程';
        panel.querySelector('[data-action="start"]').disabled = !isStudyIndex() || state.status === 'running';
        panel.querySelector('[data-action="resume"]').disabled = state.status === 'running' || state.status === 'complete';
    }

    function createPanel() {
        GM_addStyle(`
            #gdsf-study-helper { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; width: 340px; padding: 14px; border-radius: 12px; background: #102a53; color: #fff; font: 14px/1.45 system-ui, sans-serif; box-shadow: 0 10px 34px rgba(0,0,0,.3); }
            #gdsf-study-helper h2 { margin: 0 0 8px; font-size: 15px; }
            #gdsf-study-helper p { margin: 6px 0; word-break: break-word; }
            #gdsf-study-helper .muted { color: #bed0e8; font-size: 12px; }
            #gdsf-study-helper .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
            #gdsf-study-helper button { border: 0; border-radius: 6px; padding: 6px 9px; cursor: pointer; background: #fff; color: #102a53; }
            #gdsf-study-helper button.danger { background: #e75b5b; color: #fff; }
            #gdsf-study-helper button:disabled { opacity: .48; cursor: not-allowed; }
        `);
        panel = document.createElement('aside');
        panel.id = 'gdsf-study-helper';
        panel.innerHTML = `
            <h2>学法学习助手 <span class="muted">v${VERSION}</span></h2>
            <p data-role="status"></p>
            <p data-role="message"></p>
            <p class="muted" data-role="current"></p>
            <div class="actions">
                <button data-action="start">从年度学法开始</button>
                <button data-action="resume">继续</button>
                <button data-action="pause">暂停</button>
                <button class="danger" data-action="stop">停止</button>
                <button data-action="reset">重置进度</button>
            </div>`;
        panel.addEventListener('click', (event) => {
            const action = event.target.closest('button')?.dataset.action;
            if (action === 'start') start();
            if (action === 'resume') resume();
            if (action === 'pause') pause();
            if (action === 'stop') stop();
            if (action === 'reset') reset();
        });
        document.documentElement.appendChild(panel);
        renderPanel(getState());
    }

    createPanel();
    GM_addValueChangeListener(STATE_KEY, () => renderPanel(getState()));
    timer = window.setInterval(tick, TICK_MS);
    tick();
})();

