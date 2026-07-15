'use strict';

const fs = require('fs');
const path = require('path');

const endpoint = process.argv[2] || 'http://127.0.0.1:9222';
const watchedHosts = new Set(['gbpx.gd.gov.cn', 'wcs1.shawcoder.xyz', 'cs1.gdgbpx.com']);
const pendingTimeoutMs = 5000;

function sanitizeUrl(value) {
    try {
        const url = new URL(String(value || ''));
        return `${url.origin}${url.pathname}${url.hash ? `#${url.hash.replace(/^#/, '').split('?')[0]}` : ''}`;
    } catch {
        return String(value || '').split('?')[0];
    }
}

class CdpSession {
    constructor(webSocketUrl) {
        this.socket = new WebSocket(webSocketUrl);
        this.nextId = 1;
        this.pending = new Map();
        this.events = [];
        this.socket.addEventListener('message', ({ data }) => {
            const message = JSON.parse(String(data));
            if (message.id && this.pending.has(message.id)) {
                const entry = this.pending.get(message.id);
                this.pending.delete(message.id);
                clearTimeout(entry.timer);
                if (message.error) entry.reject(new Error(message.error.message));
                else entry.resolve(message.result || {});
                return;
            }
            if (message.method) this.recordEvent(message);
        });
    }

    async open() {
        if (this.socket.readyState === WebSocket.OPEN) return;
        await new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true });
        });
    }

    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} 超时`));
            }, pendingTimeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    recordEvent(message) {
        if (message.method === 'Runtime.consoleAPICalled') {
            this.events.push({
                type: 'console',
                level: message.params.type,
                text: (message.params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 1000)
            });
        } else if (message.method === 'Log.entryAdded') {
            const entry = message.params.entry || {};
            this.events.push({ type: 'log', level: entry.level, text: String(entry.text || '').slice(0, 1000), url: sanitizeUrl(entry.url) });
        } else if (message.method === 'Network.loadingFailed') {
            this.events.push({
                type: 'loading-failed',
                errorText: message.params.errorText,
                canceled: Boolean(message.params.canceled),
                blockedReason: message.params.blockedReason || ''
            });
        } else if (message.method === 'Page.javascriptDialogOpening') {
            this.events.push({ type: 'dialog', dialogType: message.params.type, message: String(message.params.message || '').slice(0, 1000) });
        }
        if (this.events.length > 100) this.events.shift();
    }

    close() {
        this.socket.close();
    }
}

const snapshotExpression = `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const visible = (element) => Boolean(element && element.getClientRects().length);
    const sanitizeForPage = (value) => {
        try {
            const url = new URL(value, location.href);
            return url.origin + url.pathname;
        } catch {
            return String(value || '').split('?')[0];
        }
    };
    return {
        title: document.title,
        url: sanitizeForPage(location.href),
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
        panel: normalize(document.querySelector('#gbpx-helper-panel')?.innerText).slice(0, 2000),
        dialogs: [...document.querySelectorAll('.layui-layer-content, .el-message-box, [role="dialog"]')]
            .filter(visible).map((node) => normalize(node.innerText || node.textContent).slice(0, 1000)),
        videos: [...document.querySelectorAll('video')].map((video) => ({
            currentTime: Number(video.currentTime || 0),
            duration: Number(video.duration || 0),
            paused: video.paused,
            ended: video.ended,
            muted: video.muted,
            playbackRate: video.playbackRate,
            readyState: video.readyState,
            networkState: video.networkState,
            error: video.error ? { code: video.error.code, message: video.error.message } : null
        })),
        iframes: [...document.querySelectorAll('iframe')].map((frame) => sanitizeForPage(frame.src)),
        bodyText: normalize(document.body?.innerText).slice(0, 3000)
    };
})()`;

async function snapshotTarget(target) {
    const session = new CdpSession(target.webSocketDebuggerUrl);
    await session.open();
    await Promise.all([
        session.send('Runtime.enable'),
        session.send('Log.enable'),
        session.send('Network.enable'),
        session.send('Page.enable')
    ]);
    const evaluated = await session.send('Runtime.evaluate', {
        expression: snapshotExpression,
        returnByValue: true,
        awaitPromise: true
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    session.close();
    return {
        targetId: target.id,
        type: target.type,
        title: target.title,
        url: sanitizeUrl(target.url),
        page: evaluated.result?.value || null,
        events: session.events
    };
}

(async () => {
    const targets = await fetch(`${endpoint}/json/list`).then((response) => {
        if (!response.ok) throw new Error(`CDP 返回 HTTP ${response.status}`);
        return response.json();
    });
    const relevantTargets = targets.filter((target) => {
        try {
            return target.type === 'page' && watchedHosts.has(new URL(target.url).hostname);
        } catch {
            return false;
        }
    });
    const results = [];
    for (const target of relevantTargets) {
        try {
            results.push(await snapshotTarget(target));
        } catch (error) {
            results.push({ targetId: target.id, title: target.title, url: sanitizeUrl(target.url), error: error.message });
        }
    }
    const output = {
        capturedAt: new Date().toISOString(),
        endpoint,
        targetCount: relevantTargets.length,
        targets: results
    };
    const logsDir = path.join(__dirname, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const outputPath = path.join(logsDir, 'chrome-cdp-snapshot-latest.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(JSON.stringify({
        outputPath,
        targetCount: relevantTargets.length,
        targets: results.map((item) => ({ title: item.title, url: item.url, error: item.error || '' }))
    }, null, 2));
})().catch((error) => {
    console.error(`CDP 快照失败：${error.message}`);
    process.exitCode = 1;
});
