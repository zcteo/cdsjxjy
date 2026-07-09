// ==UserScript==
// @name         成都市中小学教师继续教育网-线下培训助手
// @namespace    https://www.cdsjxjy.cn/
// @version      1.0.0
// @description  课程自动回放，观看记录页面自动完成问卷
// @author       zcteo.cn@gmail.com
// @match        https://www.cdsjxjy.cn/*
// @grant        GM_xmlhttpRequest
// @connect      www.cdsjxjy.cn
// @connect      view.csslcloud.net
// @connect      report.csslcloud.net
// @run-at       document-idle
// ==/UserScript==

// ***********************************特此声明***********************************************
// 仅供学习使用，作者不对该脚本产生的任何行为负责，严谨倒卖！！！
// 尊重作者权益，请勿在未经允许的情况下擅自修改代码和发布到其他平台！
// 仅支持 ad1a2087-a431-422f-a6cc-e28a8cb0dde8 问卷！
// 更新日期：2026-07-08
// ****************************************************************************************

(function () {
    'use strict';

    const COURSE_LEVEL_ID = '7CE980E9-FDC1-45DC-9033-D9D12E7EA432'; // 全学段
    const HEARTBEAT_INTERVAL = 10000; // 10s
    const KEEPALIVE_INTERVAL = 600000; // 10min，定时请求列表接口防止 token 失效
    const DEVICE_VERSION = '3.22.3';
    const LOGIN_DEVICE_VERSION = '1.0.0';

    // 问卷答案库：key 为 queId，value 为固定的 recordList（提交时仅 projectId 改为对应 classId）
    // 新增其他问卷时，按同样结构追加一条即可
    const QUESTIONNAIRE_ANSWERS = {
        'ad1a2087-a431-422f-a6cc-e28a8cb0dde8': [
            { itemId: 'b13d23ca-54e9-4d55-813e-42c5580fd653', optionId: '7149e3d4-10ef-41ab-80d4-238dae63db95', selectOther: ' ' },
            { itemId: '3031e271-3f62-4d07-a422-4ac35023eb17', optionId: 'a34847f5-3ae9-46db-b856-386e83183d12' },
            { itemId: 'c4b6abb2-1660-4c56-8019-081bca0d3633', selectOther: ' ' },
            { itemId: '23f605d9-73c0-4fa5-a9ec-0deaf1d9ba4a', selectOther: ' ' },
            { itemId: 'fe26f29c-cfd8-4557-ba26-2ca3a48f80d4', optionId: '9843bce9-d05b-4e01-b1d1-8b111abb73c9' },
            { itemId: '548ab5b8-f735-476a-913b-b6c2d21434ca', optionId: 'bad58bf3-e658-4c64-bdb0-fdb9ae85dfe7' },
            { itemId: 'ccc38053-8440-4120-99cf-08274e8bfdd4', optionId: 'd437516d-df3c-4220-8a3f-651ae71be39b' },
            { itemId: 'fdddc2a7-b83c-49f6-b965-eff8edc11eb1', optionId: '259f3179-11c1-435e-916b-ba5e0fc8ebbc' },
            { itemId: '017a362d-d792-442c-9326-48594b92ab77', optionId: 'f027887a-e961-4fcc-b5cd-ba8d4982a993' },
            { itemId: '678c854e-ad96-4a3c-9a16-9afbe0c02b3e', optionId: '23c35de1-2f30-4a6e-b2f3-2ca8238bccaf' },
            { itemId: 'beda00b4-bd49-415c-98e9-1af0255a7902', optionId: '28cce181-3ea3-4465-9849-3c65bf1f55fa' },
            { itemId: 'fd77d202-c9a6-458c-ad12-f611c1975e95', selectOther: ' ' },
            { itemId: 'd040232d-b35e-4a77-a30d-d37dde1096e2', selectOther: ' ' },
        ],
    };

    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const log = (...a) => console.log('[线下培训]', ...a);

    // ---------- 请求封装 ----------
    function gmRequest(opts) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: opts.method || 'GET',
                url: opts.url,
                headers: opts.headers || {},
                data: opts.data,
                responseType: opts.responseType,
                timeout: 20000,
                onload: (r) => resolve(r),
                onerror: (e) => reject(e),
                ontimeout: () => reject(new Error('timeout: ' + opts.url)),
            });
        });
    }

    // 本域接口鉴权：token 存于 localStorage.cdctetorage，header 名为 Token
    // 结构形如 {"user":{"session":{...,"token":"xxx"},"token":"xxx"}}
    function getToken() {
        try {
            const raw = localStorage.getItem('cdctetorage');
            if (!raw) return '';
            const obj = JSON.parse(raw);
            return (
                (obj && obj.token) ||
                (obj && obj.user && obj.user.token) ||
                (obj && obj.user && obj.user.session && obj.user.session.token) ||
                (obj && obj.session && obj.session.token) ||
                ''
            );
        } catch (e) {
            return '';
        }
    }

    function siteHeaders(json) {
        const h = {};
        if (json) h['Content-Type'] = 'application/json';
        const t = getToken();
        if (t) h['Token'] = t;
        return h;
    }

    // 从 GetRecordUrl 一次性解析 accountId(userid) 及登录用的 viewername/viewertoken
    async function fetchRecordUrl(recordid) {
        const r = await gmRequest({
            url: 'https://www.cdsjxjy.cn/prod/offlineLiveRecord/GetRecordUrl?recordid=' + encodeURIComponent(recordid),
            headers: siteHeaders(false),
            responseType: 'json',
        });
        const json = readJson(r);
        if (json.code !== 200 || !json.data) throw new Error('GetRecordUrl 返回: ' + json.msg);
        const q = new URL(json.data).searchParams;
        return {
            accountId: q.get('userid') || '',
            viewername: q.get('viewername') || '',
            viewertoken: q.get('viewertoken') || '',
        };
    }

    // 兼容不同油猴管理器：body 可能在 responseText，也可能在 response(字符串或对象)
    function readJson(r) {
        if (r && r.response && typeof r.response === 'object') return r.response;
        const txt =
            (r && r.responseText) ||
            (r && typeof r.response === 'string' ? r.response : '');
        if (!txt) throw new Error('空响应 (status ' + (r && r.status) + ')');
        return JSON.parse(txt);
    }

    // ---------- 接口 ----------
    async function fetchPlaybackList(pageNum, pageSize) {
        const body = {
            pageNum: Number(pageNum),
            pageSize: Number(pageSize),
            courseLevelId: COURSE_LEVEL_ID,
            courseSubjectId: '',
            isLive: '',
            className: '',
            date: '',
            courseType: '',
        };
        const r = await gmRequest({
            method: 'POST',
            url: 'https://www.cdsjxjy.cn/prod/offlinecourse/class/page/playback',
            headers: siteHeaders(true),
            data: JSON.stringify(body),
            responseType: 'json',
        });
        const json = readJson(r);
        if (json.code !== 200) throw new Error('列表接口返回: ' + json.msg);
        return (json.data && json.data.content) || [];
    }

    async function fetchStudentFirst(classId) {
        const r = await gmRequest({
            url: 'https://www.cdsjxjy.cn/prod/offlineLiveRecord/studentlist?id=' + encodeURIComponent(classId),
            headers: siteHeaders(false),
            responseType: 'json',
        });
        const json = readJson(r);
        if (json.code !== 200) throw new Error('studentlist 返回: ' + json.msg);
        const arr = json.data || [];
        return arr.length ? arr[0] : null;
    }

    // 完成判定：isnormal===1；或 isnormal!==1 时 watchtime > liveTimeLimit（两者可能为 null）
    function isCompleted(status) {
        if (status.isnormal === 1) return true;
        const wt = status.watchtime;
        const lt = status.liveTimeLimit;
        if (wt != null && lt != null && Number(wt) > Number(lt)) return true;
        return false;
    }

    // 查询回放学习状态：isnormal===1 表示已完成；否则用 liveTimeLimit/watchtime 算目标时长
    async function checkStatus(classId) {
        const r = await gmRequest({
            url: 'https://www.cdsjxjy.cn/prod/offlineLiveUserAction/checkPlaybackStatus?classId=' + encodeURIComponent(classId),
            headers: siteHeaders(false),
            responseType: 'json',
        });
        const json = readJson(r);
        if (json.code !== 200) throw new Error('checkPlaybackStatus 返回: ' + json.msg);
        return json.data || {};
    }

    // 回放登录，拿 token/viewerid/roomid；前几次可能 success:false，每 1s 重试到成功
    async function loginReplay(accountId, replayId, userName, userToken, onRetry) {
        const body = {
            accountId: accountId,
            replayId: replayId,
            deviceType: 'h5-pc',
            deviceVersion: LOGIN_DEVICE_VERSION,
            tpl: '20',
            userName: userName,
            userToken: userToken,
        };
        let attempt = 0;
        for (; ;) {
            if (stopped) throw new Error('已停止');
            attempt++;
            let json = null;
            try {
                const r = await gmRequest({
                    method: 'POST',
                    url: 'https://view.csslcloud.net/replay/user/login',
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify(body),
                    responseType: 'json',
                });
                json = readJson(r);
            } catch (e) {
                json = null;
            }
            if (json && json.success && json.data && json.data.user) {
                return json.data.user; // {id, name, token, roomId, replayId, accountId, tpl}
            }
            if (onRetry) onRetry(attempt);
            await sleep(1000);
        }
    }

    async function fetchMeta(accountId, replayId, token) {
        const url =
            'https://view.csslcloud.net/replay/data/meta?accountId=' +
            encodeURIComponent(accountId) +
            '&replayId=' +
            encodeURIComponent(replayId) +
            '&deviceType=h5-pc&deviceVersion=' +
            DEVICE_VERSION +
            '&terminal=3&tpl=20';
        const headers = {};
        if (token) headers['X-HD-Token'] = token;
        const r = await gmRequest({ url, headers, responseType: 'json' });
        const json = readJson(r);
        if (!json.success) throw new Error('meta 接口失败');
        return {
            viewerid: json.data.user.id,
            upid: json.data.upId,
        };
    }

    // play 之前先调用一次 login 上报（返回 204 无内容），参数同 play 但无 result
    function callLogin(c) {
        const url =
            'https://report.csslcloud.net/report/replay/login?userid=' +
            encodeURIComponent(c.accountId) +
            '&roomid=' + encodeURIComponent(c.roomid) +
            '&viewerid=' + encodeURIComponent(c.viewerid) +
            '&upid=' + encodeURIComponent(c.upid) +
            '&terminal=0&ua=1&recordid=' + encodeURIComponent(c.recordid) +
            '&time=' + Date.now();
        return gmRequest({ url });
    }

    function callPlay(c) {
        const url =
            'https://report.csslcloud.net/report/replay/play?userid=' +
            encodeURIComponent(c.accountId) +
            '&roomid=' + encodeURIComponent(c.roomid) +
            '&viewerid=' + encodeURIComponent(c.viewerid) +
            '&upid=' + encodeURIComponent(c.upid) +
            '&terminal=0&ua=1&recordid=' + encodeURIComponent(c.recordid) +
            '&time=' + Date.now() + '&result=0';
        return gmRequest({ url });
    }

    function callHeartbeat(c) {
        const url =
            'https://report.csslcloud.net/report/replay/heartbeat?userid=' +
            encodeURIComponent(c.accountId) +
            '&roomid=' + encodeURIComponent(c.roomid) +
            '&viewerid=' + encodeURIComponent(c.viewerid) +
            '&upid=' + encodeURIComponent(c.upid) +
            '&terminal=0&ua=1&recordid=' + encodeURIComponent(c.recordid) +
            '&time=' + Date.now() + '&result=0&vdrop=-1&avgbytes=-1&block=1';
        return gmRequest({ url });
    }

    // ---------- 问卷 ----------
    // 我的课程列表（含 lookdb / queId），用于筛选需要作答的问卷
    async function fetchMyPage(pageNum, pageSize) {
        const body = {
            className: '',
            pageNum: Number(pageNum),
            pageSize: Number(pageSize),
            isnormal: '0',
            isvote: '0',
        };
        const r = await gmRequest({
            method: 'POST',
            url: 'https://www.cdsjxjy.cn/prod/offlineLiveUserAction/mypage',
            headers: siteHeaders(true),
            data: JSON.stringify(body),
            responseType: 'json',
        });
        const json = readJson(r);
        if (json.code !== 200) throw new Error('mypage 返回: ' + json.msg);
        return (json.data && json.data.content) || [];
    }

    // 提交一份问卷答案（projectId 用课程 classId）
    async function submitQuestionnaire(classId, queId) {
        const body = {
            projectId: classId,
            queId: queId,
            recordList: QUESTIONNAIRE_ANSWERS[queId],
        };
        const r = await gmRequest({
            method: 'POST',
            url: 'https://www.cdsjxjy.cn/prod/questionnaireRecord/BatchRecord',
            headers: siteHeaders(true),
            data: JSON.stringify(body),
            responseType: 'json',
        });
        const json = readJson(r);
        if (json.code !== 200) throw new Error('BatchRecord 返回: ' + json.msg);
        return json.data;
    }

    // 一键完成问卷的实现见下方 UI 部分（buildSurveyPanel / querySurveys / doOneSurvey / onFillAll）

    // ---------- UI ----------
    let panel, tbody, statusEl;
    const courses = []; // 运行中的课程

    function buildUI() {
        panel = document.createElement('div');
        panel.style.cssText =
            'position:fixed;top:12px;right:12px;z-index:999999;width:520px;max-height:80vh;' +
            'overflow:auto;background:#fff;border:1px solid #ccc;border-radius:8px;' +
            'box-shadow:0 4px 16px rgba(0,0,0,.2);font-size:13px;color:#333;' +
            'font-family:Arial,Microsoft YaHei,sans-serif;';

        panel.innerHTML =
            '<div style="padding:8px 10px;background:#1677ff;color:#fff;border-radius:8px 8px 0 0;' +
            'display:flex;justify-content:space-between;align-items:center;cursor:move" id="ph_head">' +
            '<b>课程回放；自动回放过程中请勿刷新页面</b><span id="ph_close" style="cursor:pointer">✕</span></div>' +
            '<div style="padding:10px">' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
            'pageNum <input id="ph_pn" type="number" value="1" style="width:55px" />' +
            'pageSize <input id="ph_ps" type="number" value="10" style="width:55px" />' +
            '总页数 <input id="ph_tp" type="number" value="1" min="1" style="width:55px" />' +
            '<button id="ph_start" style="cursor:pointer">开始</button>' +
            '<button id="ph_stop" style="cursor:pointer" disabled>停止</button>' +
            '<button id="ph_clear" style="cursor:pointer" disabled>清除</button>' +
            '</div>' +
            '<div id="ph_status" style="margin-bottom:6px;color:#888">等待开始…</div>' +
            '<table style="width:100%;border-collapse:collapse">' +
            '<thead><tr>' +
            '<th style="text-align:left;border-bottom:1px solid #eee;padding:4px">className</th>' +
            '<th style="text-align:right;border-bottom:1px solid #eee;padding:4px;width:130px;white-space:nowrap">学习状态</th>' +
            '<th style="text-align:right;border-bottom:1px solid #eee;padding:4px;width:110px;white-space:nowrap">心跳(成功/失败)</th>' +
            '</tr></thead><tbody id="ph_tbody"></tbody></table>' +
            '</div>';

        document.body.appendChild(panel);
        tbody = panel.querySelector('#ph_tbody');
        statusEl = panel.querySelector('#ph_status');

        panel.querySelector('#ph_close').onclick = () => {
            panelClosedHash = location.hash;
            panel.style.display = 'none';
        };
        panel.querySelector('#ph_start').onclick = onStart;
        panel.querySelector('#ph_stop').onclick = onStop;
        panel.querySelector('#ph_clear').onclick = onClear;

        makeDraggable(panel, panel.querySelector('#ph_head'));
        applyRouteVisibility();
    }

    const TARGET_HASH = '#/offlineTraining/courseReplay';
    const SURVEY_HASH = '#/offlineTraining/viewingRecords';
    let panelClosedHash = null;  // 主面板手动关闭时的 hash；同一 hash 下不再自动出现
    let surveyClosedHash = null; // 问卷面板手动关闭时的 hash；同一 hash 下不再自动出现
    let surveyPanel = null;   // 一键完成问卷面板
    let surveyTbody = null;   // 问卷表格 tbody
    let surveyStatusEl = null; // 问卷状态栏
    let surveyBusy = false;   // 一键作答进行中，避免重复触发
    const surveys = [];       // 待作答问卷列表 [{classId, className, queId, status, error}]

    // 一键完成问卷面板：仅在 viewingRecords 路由显示
    function buildSurveyPanel() {
        surveyPanel = document.createElement('div');
        surveyPanel.style.cssText =
            'position:fixed;top:12px;right:12px;z-index:999999;width:460px;max-height:80vh;' +
            'overflow:auto;background:#fff;border:1px solid #ccc;border-radius:8px;' +
            'box-shadow:0 4px 16px rgba(0,0,0,.2);font-size:13px;color:#333;' +
            'font-family:Arial,Microsoft YaHei,sans-serif;';

        surveyPanel.innerHTML =
            '<div style="padding:8px 10px;background:#1677ff;color:#fff;border-radius:8px 8px 0 0;' +
            'display:flex;justify-content:space-between;align-items:center;cursor:move" id="ph_q_head">' +
            '<b>一键完成问卷</b><span id="ph_q_close" style="cursor:pointer">✕</span></div>' +
            '<div style="padding:10px">' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
            'pageNum <input id="ph_q_pn" type="number" value="1" style="width:55px" />' +
            'pageSize <input id="ph_q_ps" type="number" value="1000" style="width:60px" />' +
            '<button id="ph_q_query" style="cursor:pointer">查询</button>' +
            '<button id="ph_q_all" style="cursor:pointer" disabled>一键完成问卷</button>' +
            '</div>' +
            '<div id="ph_q_status" style="margin-bottom:6px;color:#888">请先点击查询…</div>' +
            '<table style="width:100%;border-collapse:collapse">' +
            '<thead><tr>' +
            '<th style="text-align:left;border-bottom:1px solid #eee;padding:4px">课程名称</th>' +
            '<th style="text-align:right;border-bottom:1px solid #eee;padding:4px;width:130px;white-space:nowrap">操作</th>' +
            '</tr></thead><tbody id="ph_q_tbody"></tbody></table>' +
            '</div>';

        document.body.appendChild(surveyPanel);
        surveyTbody = surveyPanel.querySelector('#ph_q_tbody');
        surveyStatusEl = surveyPanel.querySelector('#ph_q_status');

        surveyPanel.querySelector('#ph_q_close').onclick = () => {
            surveyClosedHash = location.hash;
            surveyPanel.style.display = 'none';
        };
        surveyPanel.querySelector('#ph_q_query').onclick = querySurveys;
        surveyPanel.querySelector('#ph_q_all').onclick = onFillAll;

        // 事件委托：点击某行「完成问卷」按钮
        surveyTbody.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-i]');
            if (!btn) return;
            const i = Number(btn.getAttribute('data-i'));
            doOneSurvey(i);
        });

        makeDraggable(surveyPanel, surveyPanel.querySelector('#ph_q_head'));
        applySurveyVisibility();
    }

    function setSurveyStatus(t) {
        if (surveyStatusEl) surveyStatusEl.textContent = t;
    }

    // 查询待作答问卷：mypage 中 lookdb===1 且有已知答案的
    async function querySurveys() {
        if (surveyBusy) return;
        const queryBtn = surveyPanel.querySelector('#ph_q_query');
        const allBtn = surveyPanel.querySelector('#ph_q_all');
        const pageNum = surveyPanel.querySelector('#ph_q_pn').value.trim() || '1';
        const pageSize = surveyPanel.querySelector('#ph_q_ps').value.trim() || '1000';
        queryBtn.disabled = true;
        allBtn.disabled = true;
        surveys.length = 0;
        renderSurveys();
        try {
            setSurveyStatus('查询课程列表…');
            const list = await fetchMyPage(pageNum, pageSize);
            const todo = list.filter(
                (item) => item.lookdb === 1 && QUESTIONNAIRE_ANSWERS[item.queId]
            );
            for (const item of todo) {
                surveys.push({
                    classId: item.classId,
                    className: item.className,
                    queId: item.queId,
                    status: 'pending', // pending | doing | done | fail
                    error: null,
                });
            }
            renderSurveys();
            setSurveyStatus('共 ' + surveys.length + ' 个待作答问卷');
            allBtn.disabled = surveys.length === 0;
        } catch (e) {
            setSurveyStatus('查询出错：' + ((e && e.message) || e));
        } finally {
            queryBtn.disabled = false;
        }
    }

    function renderSurveys() {
        if (!surveyTbody) return;
        surveyTbody.innerHTML = '';
        surveys.forEach((s, i) => {
            const tr = document.createElement('tr');
            let opHtml;
            if (s.status === 'done') {
                opHtml = '<span style="color:#52c41a">已完成</span>';
            } else if (s.status === 'fail') {
                opHtml = '<button data-i="' + i + '" style="cursor:pointer;color:#ff4d4f">失败·重试</button>';
            } else if (s.status === 'doing') {
                opHtml = '<button disabled>作答中…</button>';
            } else {
                opHtml = '<button data-i="' + i + '" style="cursor:pointer">完成问卷</button>';
            }
            tr.innerHTML =
                '<td style="padding:4px;border-bottom:1px solid #f2f2f2">' + escapeHtml(s.className) + '</td>' +
                '<td style="padding:4px;border-bottom:1px solid #f2f2f2;text-align:right">' + opHtml + '</td>';
            surveyTbody.appendChild(tr);
        });
    }

    // 完成单个问卷；成功→done，失败→fail
    async function doOneSurvey(i) {
        const s = surveys[i];
        if (!s || s.status === 'doing' || s.status === 'done') return true;
        s.status = 'doing';
        s.error = null;
        renderSurveys();
        try {
            await submitQuestionnaire(s.classId, s.queId);
            s.status = 'done';
            log('作答成功：' + s.className);
            renderSurveys();
            return true;
        } catch (e) {
            s.status = 'fail';
            s.error = (e && e.message) || '作答失败';
            log('作答失败：' + s.className, s.error);
            renderSurveys();
            return false;
        }
    }

    // 一键完成：逐个完成所有未完成的问卷
    async function onFillAll() {
        if (surveyBusy) return;
        if (surveys.length === 0) {
            setSurveyStatus('无待作答问卷，请先查询');
            return;
        }
        surveyBusy = true;
        const queryBtn = surveyPanel.querySelector('#ph_q_query');
        const allBtn = surveyPanel.querySelector('#ph_q_all');
        queryBtn.disabled = true;
        allBtn.disabled = true;
        let ok = 0, fail = 0;
        try {
            for (let i = 0; i < surveys.length; i++) {
                if (surveys[i].status === 'done') { ok++; continue; }
                setSurveyStatus('正在作答 ' + (i + 1) + '/' + surveys.length + '：' + surveys[i].className);
                const success = await doOneSurvey(i);
                if (success) ok++; else fail++;
            }
            setSurveyStatus('全部完成：成功 ' + ok + '，失败 ' + fail + '（共 ' + surveys.length + '）');
        } finally {
            surveyBusy = false;
            queryBtn.disabled = false;
            allBtn.disabled = false;
        }
    }

    function applySurveyVisibility() {
        if (!surveyPanel) return;
        const match = location.hash.indexOf(SURVEY_HASH) === 0;
        if (match) {
            if (location.hash === surveyClosedHash) return; // 已在此路由手动关闭，保持隐藏
            if (!document.body.contains(surveyPanel)) document.body.appendChild(surveyPanel);
            surveyPanel.style.display = '';
        } else {
            surveyClosedHash = null; // 离开该路由，重置关闭标记
            surveyPanel.style.display = 'none';
        }
    }

    function applyRouteVisibility() {
        applySurveyVisibility();
        if (!panel) return;
        const match = location.hash.indexOf(TARGET_HASH) === 0;
        if (match) {
            if (location.hash === panelClosedHash) return; // 已在此路由手动关闭，保持隐藏
            // SPA 切换路由可能把面板从 DOM 移除，这里确保重新挂载
            if (!document.body.contains(panel)) document.body.appendChild(panel);
            panel.style.display = '';
        } else {
            panelClosedHash = null; // 离开该路由，重置关闭标记
            panel.style.display = 'none';
        }
    }

    function makeDraggable(el, handle) {
        let sx, sy, ox, oy, drag = false;
        handle.addEventListener('mousedown', (e) => {
            drag = true; sx = e.clientX; sy = e.clientY;
            const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!drag) return;
            el.style.left = ox + (e.clientX - sx) + 'px';
            el.style.top = oy + (e.clientY - sy) + 'px';
            el.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => (drag = false));
    }

    function setStatus(t) {
        if (statusEl) statusEl.textContent = t;
    }

    function render() {
        if (!tbody) return;
        tbody.innerHTML = '';
        for (const c of courses) {
            const tr = document.createElement('tr');
            let statusText;
            if (c.error) {
                statusText = '⚠' + c.error;
            } else if (c.completed) {
                statusText = '已完成';
            } else if (c.playStartTs && c.targetSec != null) {
                const sec = Math.floor((Date.now() - c.playStartTs) / 1000);
                statusText = sec + '/' + c.targetSec;
            } else {
                statusText = '初始化中';
            }
            const name = c.className;
            const hb = c.hbStarted ? (c.hbOk || 0) + ' / ' + (c.hbFail || 0) : '-';
            tr.innerHTML =
                '<td style="padding:4px;border-bottom:1px solid #f2f2f2">' + escapeHtml(name) + '</td>' +
                '<td style="padding:4px;border-bottom:1px solid #f2f2f2;text-align:right">' + escapeHtml(statusText) + '</td>' +
                '<td style="padding:4px;border-bottom:1px solid #f2f2f2;text-align:right">' + hb + '</td>';
            tbody.appendChild(tr);
        }
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
    }

    // ---------- 主流程 ----------
    let started = false;
    let stopped = false;
    let renderTimer = null;
    let keepaliveTimer = null; // 每 10min 请求一次列表接口，防止 token 失效
    let curPage = null;    // 当前学习的页码
    let curPageEnd = null;   // 结束页码（含）
    let shared = null; // {accountId, viewername, viewertoken}，首个课程初始化时获取一次

    async function onStart() {
        if (started) {
            setStatus('已在运行中');
            return;
        }
        stopped = false;
        const pageNum = parseInt(panel.querySelector('#ph_pn').value.trim(), 10);
        const pageSize = panel.querySelector('#ph_ps').value.trim();
        const totalPages = parseInt(panel.querySelector('#ph_tp').value.trim(), 10) || 1;
        if (!pageNum || !pageSize) {
            alert('请填写 pageNum / pageSize');
            return;
        }

        started = true;
        panel.querySelector('#ph_start').disabled = true;
        panel.querySelector('#ph_stop').disabled = false;
        panel.querySelector('#ph_clear').disabled = true;

        // 每 10s 刷新显示（与 heartbeat 间隔一致）
        renderTimer = setInterval(render, HEARTBEAT_INTERVAL);

        // 每 10min 请求一次列表接口（pageNum/pageSize 均传 1），仅为保活 token，不处理结果
        keepaliveTimer = setInterval(() => {
            fetchPlaybackList(1, 1)
                .then(() => log('token 保活请求成功'))
                .catch((err) => console.warn('[线下培训] token 保活请求失败', err));
        }, KEEPALIVE_INTERVAL);

        try {
            // 从 pageNum 开始，连续学习 totalPages 页
            const lastPage = pageNum + totalPages - 1;
            for (let pn = pageNum; pn <= lastPage; pn++) {
                if (stopped) break;
                curPage = pn;
                curPageEnd = lastPage;
                await runPage(pn, pageSize);
                if (stopped) break;
                // 本页全部完成后，等待所有心跳到达目标时长（课程真正学满）
                await waitPageDone();
            }
            if (!stopped) {
                setStatus('全部 ' + totalPages + ' 页学习完成');
                // 收尾：关闭定时器、复位按钮
                if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }
                if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
                render();
                started = false;
                curPage = null;
                panel.querySelector('#ph_start').disabled = false;
                panel.querySelector('#ph_stop').disabled = true;
                panel.querySelector('#ph_clear').disabled = courses.length === 0;
            }
        } catch (e) {
            setStatus('出错：' + ((e && e.message) || e));
            started = false;
            if (renderTimer) {
                clearInterval(renderTimer);
                renderTimer = null;
            }
            if (keepaliveTimer) {
                clearInterval(keepaliveTimer);
                keepaliveTimer = null;
            }
            panel.querySelector('#ph_start').disabled = false;
            panel.querySelector('#ph_stop').disabled = true;
            panel.querySelector('#ph_clear').disabled = courses.length === 0;
        }
    }

    // 页码进度前缀，如「[1/3页] 」
    function pageTag() {
        if (curPage == null) return '';
        return '[' + curPage + '/' + curPageEnd + '页] ';
    }

    // 加载并初始化某一页的全部课程（初始化后各课程心跳持续到达标）
    async function runPage(pn, pageSize) {
        // 切换到新页：清空表格与上一页数据
        shared = null;
        for (const c of courses) {
            if (c.timer) { clearInterval(c.timer); c.timer = null; }
        }
        courses.length = 0;
        render();

        setStatus(pageTag() + '获取课程列表…');
        const list = await fetchPlaybackList(pn, pageSize);

        // 先把所有课程名铺进表格
        for (const item of list) {
            courses.push({
                classId: item.id,
                className: item.className,
                accountId: null,
                roomid: null,
                recordid: null,
                viewerid: null,
                upid: null,
                token: null,
                playStartTs: null,
                completed: false,
                targetSec: null,
                error: null,
                hbOk: 0,
                hbFail: 0,
            });
        }
        render();
        setStatus(pageTag() + '共 ' + list.length + ' 节课，开始逐个初始化…');

        // 再逐个初始化
        for (const c of courses) {
            if (stopped) break;
            try {
                await setupCourse(c);
            } catch (e) {
                c.error = (e && e.message) || '初始化失败';
                console.error('[心跳] 初始化失败', c.className, e);
            }
            render();
        }
        setStatus(pageTag() + '本页初始化完成，等待课程学满…');
    }

    // 等待当前页所有课程结束（completed 或 error）
    function waitPageDone() {
        return new Promise((resolve) => {
            const check = () => {
                if (stopped) { resolve(); return; }
                const total = courses.length;
                const done = courses.filter((c) => c.completed || c.error).length;
                if (total === 0 || done === total) { resolve(); return; }
                setStatus('正在学习 ' + curPage + '/' + curPageEnd + '页（本页已完成 ' + done + '/' + total + ' 节）');
                setTimeout(check, HEARTBEAT_INTERVAL);
            };
            check();
        });
    }

    function onStop() {
        stopped = true;
        for (const c of courses) {
            if (c.timer) {
                clearInterval(c.timer);
                c.timer = null;
            }
        }
        if (renderTimer) {
            clearInterval(renderTimer);
            renderTimer = null;
        }
        if (keepaliveTimer) {
            clearInterval(keepaliveTimer);
            keepaliveTimer = null;
        }
        render();
        started = false;
        curPage = null;
        panel.querySelector('#ph_start').disabled = false;
        panel.querySelector('#ph_stop').disabled = true;
        panel.querySelector('#ph_clear').disabled = courses.length === 0;
        setStatus('已停止（心跳已全部关闭）');
    }

    function onClear() {
        if (started) return; // 运行中不允许清除
        courses.length = 0;
        shared = null;
        render();
        panel.querySelector('#ph_clear').disabled = true;
        setStatus('已清除');
    }

    async function setupCourse(c) {
        log('开始初始化:', c.className);

        // 学习前先查状态
        const status = await checkStatus(c.classId);
        if (isCompleted(status)) {
            c.completed = true;
            log('已完成，跳过:', c.className, '(isnormal=', status.isnormal, 'watchtime=', status.watchtime, 'liveTimeLimit=', status.liveTimeLimit, ')');
            render();
            return;
        }
        c.targetSec = (Number(status.liveTimeLimit) + 10 - Number(status.watchtime)) * 60;
        log('未完成，目标学习秒数:', c.className, c.targetSec, '(liveTimeLimit=', status.liveTimeLimit, 'watchtime=', status.watchtime, ')');

        const stu = await fetchStudentFirst(c.classId);
        if (!stu) throw new Error('无回放记录');
        c.roomid = stu.roomid;
        c.recordid = stu.recordid;

        // 首个课程时获取一次 accountId / viewername / viewertoken（accountId 固定，全局复用）
        if (!shared) {
            shared = await fetchRecordUrl(c.recordid);
            log('GetRecordUrl 完成: accountId=', shared.accountId, 'viewername=', shared.viewername, 'viewertoken=', shared.viewertoken);
        }
        c.accountId = shared.accountId;

        // 先登录拿 token / viewerid / roomid（失败每 1s 重试）
        log('登录中:', c.className, 'replayId=', c.recordid);
        const user = await loginReplay(c.accountId, c.recordid, shared.viewername, shared.viewertoken, (n) => {
            c.error = '登录重试中(' + n + ')';
            render();
            log('登录重试:', c.className, '第', n, '次');
        });
        c.error = null;
        c.token = user.token;
        c.viewerid = user.id;
        if (user.roomId) c.roomid = user.roomId;
        log('登录成功:', c.className, 'viewerid=', c.viewerid, 'roomid=', c.roomid, 'token=', c.token);

        // meta 拿 upid
        const meta = await fetchMeta(c.accountId, c.recordid, c.token);
        c.upid = meta.upid;
        if (!c.viewerid) c.viewerid = meta.viewerid;
        log('meta 完成:', c.className, 'upid=', c.upid);

        await callLogin(c);
        log('login 上报已调用:', c.className);
        await callPlay(c);
        c.playStartTs = Date.now();
        log('play 已调用:', c.className);
        render();

        // 每 10s 一次心跳，持续不断
        c.timer = setInterval(() => {
            // 达到目标时长：标记已完成并停止心跳
            const sec = Math.floor((Date.now() - c.playStartTs) / 1000);
            if (c.targetSec != null && sec > c.targetSec) {
                c.completed = true;
                clearInterval(c.timer);
                c.timer = null;
                log('达到目标时长，已完成并停止心跳:', c.className, sec, '>', c.targetSec);
                render();
                return;
            }
            if (!c.hbStarted) {
                c.hbStarted = true;
                log('首次心跳:', c.className);
            }
            callHeartbeat(c)
                .then((r) => {
                    if (r.status >= 200 && r.status < 300) c.hbOk++;
                    else c.hbFail++;
                })
                .catch((err) => {
                    c.hbFail++;
                    console.warn('[线下培训] heartbeat 失败', c.className, err);
                });
        }, HEARTBEAT_INTERVAL);
    }

    // ---------- 启动 ----------
    function init() {
        if (document.getElementById('ph_tbody')) return;
        log('脚本已加载 @', location.href);
        buildUI();
        buildSurveyPanel();
        window.addEventListener('hashchange', applyRouteVisibility);
        window.addEventListener('popstate', applyRouteVisibility);
        // 兜底：SPA 用 history.pushState 切换路由不触发 hashchange，
        // 且可能把面板移出 DOM，这里每 500ms 校正一次显隐与挂载
        setInterval(applyRouteVisibility, 500);
    }

    if (document.body) init();
    else window.addEventListener('DOMContentLoaded', init);
})();

// 方案2，直接浏览器打开 GetRecordUrl 返回的地址
// btn = document.getElementById("cc_player_play_btn")
// btn.click()
