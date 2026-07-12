// ==UserScript==
// @name         成都市中小学教师继续教育网-线下培训助手
// @namespace    https://github.com/zcteo
// @version      1.2.0
// @description  课程自动回放，观看记录页面自动完成问卷
// @author       zcteo.cn@gmail.com
// @license      AGPL-3.0-only
// @match        https://www.cdsjxjy.cn/*
// @match        https://view.csslcloud.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      www.cdsjxjy.cn
// @run-at       document-idle
// ==/UserScript==

// ***********************************特此声明***********************************************
// 仅供学习使用，作者不对该脚本产生的任何行为负责，严谨倒卖！！！
// 尊重作者权益，请勿在未经允许的情况下擅自修改代码和发布到其他平台！
// 仅支持 ad1a2087-a431-422f-a6cc-e28a8cb0dde8 问卷！
// 更新日期：2026-07-12
// ****************************************************************************************

; (function () {
    'use strict'
    const COURSE_LEVEL_ID = '7CE980E9-FDC1-45DC-9033-D9D12E7EA432' // 全学段
    const RENDER_INTERVAL = 2000 // 主面板刷新 + 窗口监控
    const KEEPALIVE_INTERVAL = 600000 // 10min，定时请求列表接口防止 token 失效
    const WORKER_PROBE_INTERVAL = 2000 // 播放窗口探测播放按钮（兼计时步长）

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

    // ---------- 通用 ----------

    // 日志前缀：人类可读时间到秒 + 标识，如「2026-07-12 13:01:02 [线下培训]」
    // 仅返回字符串、不调 console，故各调用点的 console.log 仍能在控制台定位到真实行号
    function logpre() {
        const d = new Date()
        const p2 = (n) => String(n).padStart(2, '0')
        const date = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
        const time = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds())
        return date + ' ' + time + ' [线下培训]'
    }

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
            })
        })
    }

    // 本域接口鉴权：token 存于 localStorage.cdctetorage，header 名为 Token
    // 结构形如 {"user":{"session":{...,"token":"xxx"},"token":"xxx"}}
    function getToken() {
        try {
            const raw = localStorage.getItem('cdctetorage')
            if (!raw) return ''
            const obj = JSON.parse(raw)
            return (
                (obj && obj.token) ||
                (obj && obj.user && obj.user.token) ||
                (obj && obj.user && obj.user.session && obj.user.session.token) ||
                (obj && obj.session && obj.session.token) ||
                ''
            )
        } catch (e) {
            return ''
        }
    }

    function siteHeaders(json) {
        const h = {}
        if (json) h['Content-Type'] = 'application/json'
        const t = getToken()
        if (t) h['Token'] = t
        return h
    }

    // 兼容不同油猴管理器：body 可能在 responseText，也可能在 response(字符串或对象)
    function readJson(r) {
        if (r && r.response && typeof r.response === 'object') return r.response
        const txt = (r && r.responseText) || (r && typeof r.response === 'string' ? r.response : '')
        if (!txt) throw new Error('空响应 (status ' + (r && r.status) + ')')
        return JSON.parse(txt)
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m])
    }

    // ---------- 本地进度（GM 跨域共享）----------
    // progress[classId] = { className, recordid, watchedSec, targetSec, finishedAt }
    // finishedAt：本地刷满时的时间戳（毫秒，仅刷满时写入），用于 2 天安全阀
    const PROGRESS_KEY = 'cdsjxjy_progress'
    const STALE_MS = 2 * 86400000 // 本地刷满但服务端仍未确认，超过 2 天判定刷课失败、重刷

    function getProgress() {
        return GM_getValue(PROGRESS_KEY, {}) || {}
    }
    function saveProgress(p) {
        GM_setValue(PROGRESS_KEY, p)
    }
    // 按 recordid 反查 classId（播放窗口只知 recordid）
    function findClassIdByRecordid(progress, recordid) {
        for (const k in progress) {
            if (progress[k] && progress[k].recordid === recordid) return k
        }
        return null
    }

    // ==================================================================
    // 播放窗口 worker：仅在 view.csslcloud.net 生效
    // 职责：每 WORKER_PROBE_INTERVAL 探测播放按钮；可见就点击，隐藏(正在播)则累加 watchedSec
    // 规则：进度里找不到对应 recordid → 不接管；当日已刷满 → 不接管
    // ==================================================================
    function runWorker() {
        function getUrlParam(name) {
            const r = new RegExp('(?:^|&)' + name + '=([^&]*)', 'i').exec(location.search.substr(1))
            return r ? decodeURIComponent(r[1]).split('?')[0] : ''
        }
        const recordid = getUrlParam('recordid')
        if (!recordid) return

        const RELOAD_GRACE = 3000 // 页面加载后给 SDK 自检时间，避免打断初始化
        const loadTs = Date.now()
        let probeTimer = null

        function readEntry() {
            const p = getProgress()
            const cid = findClassIdByRecordid(p, recordid)
            if (!cid) return null
            return { classId: cid, data: p[cid] }
        }

        function stopAll() {
            if (probeTimer) {
                clearInterval(probeTimer)
                probeTimer = null
            }
        }

        function playBtn() {
            return document.getElementsByClassName('iconfont iconbofang')[0] || null
        }
        function btnVisible(el) {
            return !!el && window.getComputedStyle(el).display !== 'none'
        }

        // 每 WORKER_PROBE_INTERVAL：拿不到按钮且超宽限期 → 刷新重试；
        // 按钮可见 → 点击；按钮已隐藏(正在播) → 累加 watchedSec。
        probeTimer = setInterval(() => {
            const e = readEntry()
            if (!e) return // 不是本工具排进度的课，不打扰
            if (e.data.watchedSec >= e.data.targetSec) {
                stopAll()
                return
            } // 已刷满
            const el = playBtn()
            if (!el) {
                // 按钮未渲染：宽限期内等 SDK 初始化，超过则判定登录失败、刷新重试
                console.log(logpre(), '按钮未渲染, 等待SDK:', e.data.className)
                if (Date.now() - loadTs > RELOAD_GRACE) {
                    console.log(logpre(), '超宽限期仍未渲染, 刷新页面:', e.data.className)
                    location.reload()
                }
                return
            }
            if (btnVisible(el)) {
                el.click()
                console.log(logpre(), '点击播放(按钮可见):', e.data.className)
            } else {
                // 按钮已隐藏 = 正在播放，累加 watchedSec（与探测同频）
                const p = getProgress()
                const d = p[e.classId]
                if (d && d.watchedSec < d.targetSec) {
                    d.watchedSec = (d.watchedSec || 0) + WORKER_PROBE_INTERVAL / 1000
                    p[e.classId] = d
                    saveProgress(p)
                }
                // 已刷满
                if (d && d.watchedSec >= d.targetSec) {
                    stopAll()
                    return
                }
            }
            // 按钮仍可见会在下个 tick 继续点击，直到播放成功按钮隐藏
        }, WORKER_PROBE_INTERVAL)

        console.log(logpre(), 'worker 已加载, recordid=' + recordid)
    }

    // ==================================================================
    // 主站控制台：仅在 www.cdsjxjy.cn 生效
    // ==================================================================

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
        }
        const r = await gmRequest({
            method: 'POST',
            url: 'https://www.cdsjxjy.cn/prod/offlinecourse/class/page/playback',
            headers: siteHeaders(true),
            data: JSON.stringify(body),
            responseType: 'json',
        })
        const json = readJson(r)
        if (json.code !== 200) throw new Error('列表接口返回: ' + json.msg)
        return (json.data && json.data.content) || []
    }

    async function fetchStudentFirst(classId) {
        const r = await gmRequest({
            url: 'https://www.cdsjxjy.cn/prod/offlineLiveRecord/studentlist?id=' + encodeURIComponent(classId),
            headers: siteHeaders(false),
            responseType: 'json',
        })
        const json = readJson(r)
        if (json.code !== 200) throw new Error('studentlist 返回: ' + json.msg)
        const arr = json.data || []
        return arr.length ? arr[0] : null
    }

    // 完成判定：isnormal===1；或 isnormal!==1 时 watchtime > liveTimeLimit（两者可能为 null）
    function isCompleted(status) {
        if (status.isnormal === 1) return true
        const wt = status.watchtime
        const lt = status.liveTimeLimit
        if (wt != null && lt != null && Number(wt) > Number(lt)) return true
        return false
    }

    async function checkStatus(classId) {
        const r = await gmRequest({
            url:
                'https://www.cdsjxjy.cn/prod/offlineLiveUserAction/checkPlaybackStatus?classId=' + encodeURIComponent(classId),
            headers: siteHeaders(false),
            responseType: 'json',
        })
        const json = readJson(r)
        if (json.code !== 200) throw new Error('checkPlaybackStatus 返回: ' + json.msg)
        return json.data || {}
    }

    // 取真实回放 URL（直接 window.open 它，等同手动打开播放窗口）
    async function fetchRecordUrl(recordid) {
        const r = await gmRequest({
            url: 'https://www.cdsjxjy.cn/prod/offlineLiveRecord/GetRecordUrl?recordid=' + encodeURIComponent(recordid),
            headers: siteHeaders(false),
            responseType: 'json',
        })
        const json = readJson(r)
        if (json.code !== 200 || !json.data) throw new Error('GetRecordUrl 返回: ' + json.msg)
        return json.data
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
        }
        const r = await gmRequest({
            method: 'POST',
            url: 'https://www.cdsjxjy.cn/prod/offlineLiveUserAction/mypage',
            headers: siteHeaders(true),
            data: JSON.stringify(body),
            responseType: 'json',
        })
        const json = readJson(r)
        if (json.code !== 200) throw new Error('mypage 返回: ' + json.msg)
        return (json.data && json.data.content) || []
    }

    // 提交一份问卷答案（projectId 用课程 classId）
    async function submitQuestionnaire(classId, queId) {
        const body = {
            projectId: classId,
            queId: queId,
            recordList: QUESTIONNAIRE_ANSWERS[queId],
        }
        const r = await gmRequest({
            method: 'POST',
            url: 'https://www.cdsjxjy.cn/prod/questionnaireRecord/BatchRecord',
            headers: siteHeaders(true),
            data: JSON.stringify(body),
            responseType: 'json',
        })
        const json = readJson(r)
        if (json.code !== 200) throw new Error('BatchRecord 返回: ' + json.msg)
        return json.data
    }

    // ---------- UI ----------
    let panel, tbody, statusEl
    const courses = [] // 显示用：{classId, className, status, watchedSec, targetSec, recordid, url, error, note}
    const queue = [] // 待开窗课程
    const active = [] // {win, classId, openTs}

    function buildUI() {
        panel = document.createElement('div')
        panel.style.cssText =
            'position:fixed;top:12px;right:12px;z-index:999999;width:520px;max-height:80vh;' +
            'overflow:auto;background:#fff;border:1px solid #ccc;border-radius:8px;' +
            'box-shadow:0 4px 16px rgba(0,0,0,.2);font-size:13px;color:#333;' +
            'font-family:Arial,Microsoft YaHei,sans-serif;'

        panel.innerHTML =
            '<div style="padding:8px 10px;background:#1677ff;color:#fff;border-radius:8px 8px 0 0;' +
            'display:flex;justify-content:space-between;align-items:center;cursor:move" id="ph_head">' +
            '<b>课程回放；刷课过程中请勿刷新页面，并允许本站弹窗</b><span id="ph_close" style="cursor:pointer">✕</span></div>' +
            '<div style="padding:10px">' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
            '刷课门数 <input id="ph_count" type="number" value="10" min="1" style="width:60px" />' +
            '同时窗口数 <input id="ph_conc" type="number" value="1" min="1" style="width:55px" />' +
            '<button id="ph_start" style="cursor:pointer">开始</button>' +
            '<button id="ph_stop" style="cursor:pointer" disabled>停止</button>' +
            '<button id="ph_clear" style="cursor:pointer">清除进度</button>' +
            '</div>' +
            '<div id="ph_status" style="margin-bottom:6px;color:#888">等待开始…</div>' +
            '<table style="width:100%;border-collapse:collapse">' +
            '<thead><tr>' +
            '<th style="text-align:left;border-bottom:1px solid #eee;padding:4px">className</th>' +
            '<th style="text-align:right;border-bottom:1px solid #eee;padding:4px;width:120px;white-space:nowrap">状态</th>' +
            '<th style="text-align:right;border-bottom:1px solid #eee;padding:4px;width:120px;white-space:nowrap">已刷/目标(秒)</th>' +
            '</tr></thead><tbody id="ph_tbody"></tbody></table>' +
            '</div>'

        document.body.appendChild(panel)
        tbody = panel.querySelector('#ph_tbody')
        statusEl = panel.querySelector('#ph_status')

        panel.querySelector('#ph_close').onclick = () => {
            panelClosedHash = location.hash
            panel.style.display = 'none'
        }
        panel.querySelector('#ph_start').onclick = onStart
        panel.querySelector('#ph_stop').onclick = onStop
        panel.querySelector('#ph_clear').onclick = onClear

        makeDraggable(panel, panel.querySelector('#ph_head'))
        applyRouteVisibility()
    }

    const TARGET_HASH = '#/offlineTraining/courseReplay'
    const SURVEY_HASH = '#/offlineTraining/viewingRecords'
    let panelClosedHash = null // 主面板手动关闭时的 hash；同一 hash 下不再自动出现
    let surveyClosedHash = null // 问卷面板手动关闭时的 hash；同一 hash 下不再自动出现
    let surveyPanel = null // 一键完成问卷面板
    let surveyTbody = null // 问卷表格 tbody
    let surveyStatusEl = null // 问卷状态栏
    let surveyBusy = false // 一键作答进行中，避免重复触发
    const surveys = [] // 待作答问卷列表 [{classId, className, queId, status, error}]

    // 一键完成问卷面板：仅在 viewingRecords 路由显示
    function buildSurveyPanel() {
        surveyPanel = document.createElement('div')
        surveyPanel.style.cssText =
            'position:fixed;top:12px;right:12px;z-index:999999;width:460px;max-height:80vh;' +
            'overflow:auto;background:#fff;border:1px solid #ccc;border-radius:8px;' +
            'box-shadow:0 4px 16px rgba(0,0,0,.2);font-size:13px;color:#333;' +
            'font-family:Arial,Microsoft YaHei,sans-serif;'

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
            '</div>'

        document.body.appendChild(surveyPanel)
        surveyTbody = surveyPanel.querySelector('#ph_q_tbody')
        surveyStatusEl = surveyPanel.querySelector('#ph_q_status')

        surveyPanel.querySelector('#ph_q_close').onclick = () => {
            surveyClosedHash = location.hash
            surveyPanel.style.display = 'none'
        }
        surveyPanel.querySelector('#ph_q_query').onclick = querySurveys
        surveyPanel.querySelector('#ph_q_all').onclick = onFillAll

        // 事件委托：点击某行「完成问卷」按钮
        surveyTbody.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-i]')
            if (!btn) return
            const i = Number(btn.getAttribute('data-i'))
            doOneSurvey(i)
        })

        makeDraggable(surveyPanel, surveyPanel.querySelector('#ph_q_head'))
        applySurveyVisibility()
    }

    function setSurveyStatus(t) {
        if (surveyStatusEl) surveyStatusEl.textContent = t
    }

    // 查询待作答问卷：mypage 中 lookdb===1 且有已知答案的
    async function querySurveys() {
        if (surveyBusy) return
        const queryBtn = surveyPanel.querySelector('#ph_q_query')
        const allBtn = surveyPanel.querySelector('#ph_q_all')
        const pageNum = surveyPanel.querySelector('#ph_q_pn').value.trim() || '1'
        const pageSize = surveyPanel.querySelector('#ph_q_ps').value.trim() || '1000'
        queryBtn.disabled = true
        allBtn.disabled = true
        surveys.length = 0
        renderSurveys()
        try {
            setSurveyStatus('查询课程列表…')
            const list = await fetchMyPage(pageNum, pageSize)
            const todo = list.filter((item) => item.lookdb === 1 && QUESTIONNAIRE_ANSWERS[item.queId])
            for (const item of todo) {
                surveys.push({
                    classId: item.classId,
                    className: item.className,
                    queId: item.queId,
                    status: 'pending', // pending | doing | done | fail
                    error: null,
                })
            }
            renderSurveys()
            setSurveyStatus('共 ' + surveys.length + ' 个待作答问卷')
            allBtn.disabled = surveys.length === 0
        } catch (e) {
            setSurveyStatus('查询出错：' + ((e && e.message) || e))
        } finally {
            queryBtn.disabled = false
        }
    }

    function renderSurveys() {
        if (!surveyTbody) return
        surveyTbody.innerHTML = ''
        surveys.forEach((s, i) => {
            const tr = document.createElement('tr')
            let opHtml
            if (s.status === 'done') {
                opHtml = '<span style="color:#52c41a">已完成</span>'
            } else if (s.status === 'fail') {
                opHtml = '<button data-i="' + i + '" style="cursor:pointer;color:#ff4d4f">失败·重试</button>'
            } else if (s.status === 'doing') {
                opHtml = '<button disabled>作答中…</button>'
            } else {
                opHtml = '<button data-i="' + i + '" style="cursor:pointer">完成问卷</button>'
            }
            tr.innerHTML =
                '<td style="padding:4px;border-bottom:1px solid #f2f2f2">' +
                escapeHtml(s.className) +
                '</td>' +
                '<td style="padding:4px;border-bottom:1px solid #f2f2f2;text-align:right">' +
                opHtml +
                '</td>'
            surveyTbody.appendChild(tr)
        })
    }

    // 完成单个问卷；成功→done，失败→fail
    async function doOneSurvey(i) {
        const s = surveys[i]
        if (!s || s.status === 'doing' || s.status === 'done') return true
        s.status = 'doing'
        s.error = null
        renderSurveys()
        try {
            await submitQuestionnaire(s.classId, s.queId)
            s.status = 'done'
            console.log(logpre(), '作答成功：' + s.className)
            renderSurveys()
            return true
        } catch (e) {
            s.status = 'fail'
            s.error = (e && e.message) || '作答失败'
            console.log(logpre(), '作答失败：' + s.className, s.error)
            renderSurveys()
            return false
        }
    }

    // 一键完成：逐个完成所有未完成的问卷
    async function onFillAll() {
        if (surveyBusy) return
        if (surveys.length === 0) {
            setSurveyStatus('无待作答问卷，请先查询')
            return
        }
        surveyBusy = true
        const queryBtn = surveyPanel.querySelector('#ph_q_query')
        const allBtn = surveyPanel.querySelector('#ph_q_all')
        queryBtn.disabled = true
        allBtn.disabled = true
        let ok = 0,
            fail = 0
        try {
            for (let i = 0; i < surveys.length; i++) {
                if (surveys[i].status === 'done') {
                    ok++
                    continue
                }
                setSurveyStatus('正在作答 ' + (i + 1) + '/' + surveys.length + '：' + surveys[i].className)
                const success = await doOneSurvey(i)
                if (success) ok++
                else fail++
            }
            setSurveyStatus('全部完成：成功 ' + ok + '，失败 ' + fail + '（共 ' + surveys.length + '）')
        } finally {
            surveyBusy = false
            queryBtn.disabled = false
            allBtn.disabled = false
        }
    }

    function applySurveyVisibility() {
        if (!surveyPanel) return
        const match = location.hash.indexOf(SURVEY_HASH) === 0
        if (match) {
            if (location.hash === surveyClosedHash) return // 已在此路由手动关闭，保持隐藏
            if (!document.body.contains(surveyPanel)) document.body.appendChild(surveyPanel)
            surveyPanel.style.display = ''
        } else {
            surveyClosedHash = null // 离开该路由，重置关闭标记
            surveyPanel.style.display = 'none'
        }
    }

    function applyRouteVisibility() {
        applySurveyVisibility()
        if (!panel) return
        const match = location.hash.indexOf(TARGET_HASH) === 0
        if (match) {
            if (location.hash === panelClosedHash) return // 已在此路由手动关闭，保持隐藏
            // SPA 切换路由可能把面板从 DOM 移除，这里确保重新挂载
            if (!document.body.contains(panel)) document.body.appendChild(panel)
            panel.style.display = ''
        } else {
            panelClosedHash = null // 离开该路由，重置关闭标记
            panel.style.display = 'none'
        }
    }

    function makeDraggable(el, handle) {
        let sx, sy, ox, oy, drag = false
        handle.addEventListener('mousedown', (e) => {
            drag = true
            sx = e.clientX
            sy = e.clientY
            const r = el.getBoundingClientRect()
            ox = r.left
            oy = r.top
            e.preventDefault()
        })
        document.addEventListener('mousemove', (e) => {
            if (!drag) return
            el.style.left = ox + (e.clientX - sx) + 'px'
            el.style.top = oy + (e.clientY - sy) + 'px'
            el.style.right = 'auto'
        })
        document.addEventListener('mouseup', () => (drag = false))
    }

    function setStatus(t) {
        if (statusEl) statusEl.textContent = t
    }

    function render() {
        if (!tbody) return
        tbody.innerHTML = ''
        for (const c of courses) {
            const tr = document.createElement('tr')
            let statusText
            if (c.error) {
                statusText = '⚠' + c.error
            } else if (c.status === 'skipped') {
                statusText = '已跳过' + (c.note ? '(' + c.note + ')' : '')
            } else if (c.status === 'done') {
                statusText = '已完成'
            } else if (c.status === 'running') {
                statusText = '刷课中'
            } else {
                statusText = '排队中'
            }
            const progress = (c.watchedSec || 0) + ' / ' + (c.targetSec || 0)
            tr.innerHTML =
                '<td style="padding:4px;border-bottom:1px solid #f2f2f2">' +
                escapeHtml(c.className) +
                '</td>' +
                '<td style="padding:4px;border-bottom:1px solid #f2f2f2;text-align:right">' +
                escapeHtml(statusText) +
                '</td>' +
                '<td style="padding:4px;border-bottom:1px solid #f2f2f2;text-align:right">' +
                escapeHtml(progress) +
                '</td>'
            tbody.appendChild(tr)
        }
    }

    // ---------- 主流程 ----------
    let started = false
    let stopped = false
    let concurrency = 1 // 同时打开的播放窗口数（pump/monitorTick 共用，需在模块作用域）
    let renderTimer = null
    let monitorTimer = null
    let keepaliveTimer = null // 每 10min 请求一次列表接口，防止 token 失效

    async function onStart() {
        if (started) {
            setStatus('已在运行中')
            return
        }
        stopped = false
        const totalCount = parseInt(panel.querySelector('#ph_count').value.trim(), 10)
        concurrency = parseInt(panel.querySelector('#ph_conc').value.trim(), 10) || 1
        if (!totalCount) {
            alert('请填写刷课门数')
            return
        }

        started = true
        panel.querySelector('#ph_start').disabled = true
        panel.querySelector('#ph_stop').disabled = false
        panel.querySelector('#ph_clear').disabled = true

        renderTimer = setInterval(render, RENDER_INTERVAL)
        keepaliveTimer = setInterval(() => {
            fetchPlaybackList(1, 1)
                .then(() => console.log(logpre(), 'token 保活请求成功'))
                .catch((err) => console.warn(logpre(), 'token 保活请求失败', err))
        }, KEEPALIVE_INTERVAL)

        try {
            setStatus('获取课程列表…')
            const list = await fetchPlaybackList(1, totalCount)
            courses.length = 0
            queue.length = 0
            active.length = 0
            for (const item of list) {
                courses.push({
                    classId: item.id,
                    className: item.className,
                    status: 'pending',
                    watchedSec: 0,
                    targetSec: 0,
                    recordid: null,
                    url: null,
                    error: null,
                    note: null,
                })
            }
            render()

            setStatus('判定学习状态…')
            for (const c of courses) {
                if (stopped) break
                try {
                    const status = await checkStatus(c.classId)
                    const p = getProgress()
                    const ex = p[c.classId]

                    if (isCompleted(status)) {
                        c.status = 'skipped'
                        c.note = '服务端已完成'
                        if (ex) {
                            // 服务端已确认，本地记录已完成使命，清掉
                            delete p[c.classId]
                            saveProgress(p)
                        }
                        render()
                        continue
                    }
                    c.targetSec = (Number(status.liveTimeLimit) + 10 - Number(status.watchtime)) * 60
                    console.log(logpre(), '未完成，目标学习秒数:', c.className, c.targetSec)

                    // 服务端未确认，但本地已刷满：
                    //   距刷满 < 2 天 → 跳过（等服务端刷新，不重复刷）
                    //   距刷满 ≥ 2 天 → 服务端仍未认，判定刷课失败，重刷
                    if (ex && (ex.watchedSec || 0) >= ex.targetSec) {
                        const age = Date.now() - (ex.finishedAt || 0)
                        if (age < STALE_MS) {
                            c.status = 'skipped'
                            c.note = '本地已刷满，待服务端刷新'
                            c.watchedSec = ex.watchedSec
                            render()
                            continue
                        }
                        console.log(logpre(), '本地已刷满超 2 天服务端仍未确认，重刷:', c.className)
                    } else if (ex) {
                        // 本地未刷满 → 沿用已刷 watchedSec 续刷
                        c.watchedSec = ex.watchedSec || 0
                    }

                    const stu = await fetchStudentFirst(c.classId)
                    if (!stu || !stu.recordid) {
                        c.status = 'error'
                        c.error = '无回放记录'
                        render()
                        continue
                    }
                    c.recordid = stu.recordid
                    c.url = await fetchRecordUrl(c.recordid)
                    queue.push(c)
                } catch (e) {
                    c.status = 'error'
                    c.error = (e && e.message) || '初始化失败'
                    console.error(logpre(), '初始化失败', c.className, e)
                }
                render()
            }

            if (stopped) {
                finishRun('已停止')
                return
            }
            setStatus('开始刷课…')
            pump()
            monitorTimer = setInterval(monitorTick, RENDER_INTERVAL)
        } catch (e) {
            setStatus('出错：' + ((e && e.message) || e))
            finishRun()
        }
    }

    // 按并发数从队列开窗；开窗前先把进度写入 GM，供 worker 接管
    // 串行起播：同一时间只允许一个"已开但未确认起播"的窗口，避免多窗口初始化竞争
    function pump() {
        if (stopped) return
        // 已有窗口尚未起播时，等它起播再开下一个
        const pendingStart = active.some((a) => !a.started)
        if (pendingStart) return
        while (!stopped && active.length < concurrency && queue.length) {
            const c = queue.shift()
            const p = getProgress()
            p[c.classId] = {
                className: c.className,
                recordid: c.recordid,
                watchedSec: c.watchedSec || 0,
                targetSec: c.targetSec,
            }
            saveProgress(p)

            const win = window.open(c.url)
            if (!win) {
                c.status = 'error'
                c.error = '弹窗被拦截，请允许本站弹窗'
                render()
                continue // 继续尝试下一门
            }
            active.push({
                win,
                classId: c.classId,
                openTs: Date.now(),
                startWatchedSec: c.watchedSec || 0, // 起播判定基线
                started: false, // watchedSec 增长后置 true
            })
            c.status = 'running'
            console.log(logpre(), '已打开播放窗口:', c.className)
            render()
            break // 开一个就停，等它起播（或它已在前台立即起播由 monitorTick 确认后继续）
        }
    }

    // 每 RENDER_INTERVAL：读 watchedSec 判起播/到点关窗；窗口提前关闭则标记错误；空位则 pump
    function monitorTick() {
        if (stopped) return
        const p = getProgress()
        for (let i = active.length - 1; i >= 0; i--) {
            const a = active[i]
            const c = courses.find((x) => x.classId === a.classId)
            const entry = p[a.classId]
            if (entry) c.watchedSec = entry.watchedSec || 0

            // watchedSec 相比开窗时增长 → 确认已起播，允许开下一个窗口
            if (!a.started && c.watchedSec > a.startWatchedSec) {
                a.started = true
                console.log(logpre(), '已确认起播:', c.className, 'watchedSec=', c.watchedSec)
            }

            let closed = false
            try {
                closed = a.win.closed
            } catch (e) {
                closed = true
            }

            // 到目标时长 → 主窗口关窗（跨域允许 close 自己 open 的窗）
            if (!closed && c.watchedSec >= c.targetSec) {
                try {
                    a.win.close()
                } catch (e) { }
                closed = true
                c.status = 'done'
                // 由主窗口写 finishedAt：关窗与 worker 写入存在竞态，主窗口写更可靠
                const entryDone = p[a.classId]
                if (entryDone) {
                    entryDone.finishedAt = Date.now()
                    saveProgress(p)
                }
                console.log(logpre(), '达到目标时长，已关闭窗口:', c.className, c.watchedSec, '>=', c.targetSec)
            }

            if (closed) {
                // 关闭但未达标 → 标记错误（不自动重开，避免循环）
                if (c.status !== 'done') {
                    c.status = 'error'
                    c.error = '窗口提前关闭'
                }
                active.splice(i, 1)
            }
        }

        pump()

        // 队列空、活动窗口空、无排队中课程 → 全部完成
        const allDone = courses.every((c) => c.status === 'done' || c.status === 'skipped' || c.status === 'error')
        if (!stopped && queue.length === 0 && active.length === 0 && allDone) {
            finishRun('全部刷课完成')
        }
        render()
    }

    function finishRun(msg) {
        started = false
        if (renderTimer) {
            clearInterval(renderTimer)
            renderTimer = null
        }
        if (monitorTimer) {
            clearInterval(monitorTimer)
            monitorTimer = null
        }
        if (keepaliveTimer) {
            clearInterval(keepaliveTimer)
            keepaliveTimer = null
        }
        for (const a of active) {
            try {
                a.win.close()
            } catch (e) { }
        }
        active.length = 0
        queue.length = 0
        panel.querySelector('#ph_start').disabled = false
        panel.querySelector('#ph_stop').disabled = true
        panel.querySelector('#ph_clear').disabled = false
        if (msg) setStatus(msg)
        render()
    }

    function onStop() {
        stopped = true
        finishRun('已停止')
    }

    function onClear() {
        if (started) return // 运行中不允许清除
        saveProgress({})
        courses.length = 0
        render()
        setStatus('已清除本地进度')
    }

    // ---------- 启动 ----------
    // 播放窗口：仅运行 worker
    if (location.host.indexOf('view.csslcloud.net') === 0) {
        runWorker()
        return
    }

    function init() {
        if (document.getElementById('ph_tbody')) return
        console.log(logpre(), '脚本已加载 @', location.href)
        buildUI()
        buildSurveyPanel()
        window.addEventListener('hashchange', applyRouteVisibility)
        window.addEventListener('popstate', applyRouteVisibility)
        // 兜底：SPA 用 history.pushState 切换路由不触发 hashchange，
        // 且可能把面板移出 DOM，这里每 500ms 校正一次显隐与挂载
        setInterval(applyRouteVisibility, 500)
    }

    if (document.body) init()
    else window.addEventListener('DOMContentLoaded', init)
})()
